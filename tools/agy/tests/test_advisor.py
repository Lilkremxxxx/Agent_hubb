"""Tests of bin/advisor against a fake office (nothing real runs)."""
import http.server, json, os, subprocess, sys, threading
from urllib.parse import urlparse

import pytest

BIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "advisor")


class Fake(http.server.BaseHTTPRequestHandler):
    posts, gets = [], []
    REFUSE = {"noboss": (409, {"code": "no-boss", "error": "no boss terminal: open the boss from the page"}),
              "waiting": (409, {"code": "boss-waiting", "error": "the boss is waiting for you: approve a permission"}),
              "gone": (404, {"error": "no such route"}), "down": (503, {"error": "worker terminals need the interactive terminal"}),
              "odd": (409, {"code": "weird", "error": "something odd happened"}), "nocode": (409, {"error": "plain conflict"}),
              "stuck": (409, {"code": "boss-starting", "error": "the boss is still starting: retry in a few seconds"}),
              "bad": (400, {"error": "W9 is not a seat in team.json"})}
    END = {"late": {"status": "timeout", "error": "no answer after 10 min"},
           "plain": {"status": "untagged", "error": "the boss replied without the tag [ADVISOR W2 -]"}}
    starting = 0  # the first POST of "starting" says boss-starting

    def reply(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Fake.posts.append(b)
        q = b["question"].split()[0]
        if q == "starting" and Fake.starting == 0:
            Fake.starting = 1
            return self.reply(409, {"code": "boss-starting", "error": "the boss is still starting: retry in a few seconds"})
        if q in Fake.REFUSE:
            return self.reply(*Fake.REFUSE[q])
        self.reply(200, {"question": {"id": q, "status": "queued"}})

    def do_GET(self):
        Fake.gets.append(self.path)
        id_ = urlparse(self.path).path.rsplit("/", 1)[1]
        seen = sum(1 for g in Fake.gets if g.split("?")[0].endswith("/" + id_))
        self.reply(200, {"question": {"id": id_, "status": "asking"} if seen < 2
                         else {"id": id_, **Fake.END.get(id_, {"status": "answered", "answer": "Use a.csv."})}})

    def log_message(self, *_):
        pass


@pytest.fixture(scope="module")
def office_url():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture
def run(office_url):
    def go(args, env=None, url=None):
        e = {k: v for k, v in os.environ.items() if not k.startswith(("AGY_", "BANG_", "CLAUDE", "HABBLAUD_"))}
        e.update({"BANG_SLOT": "W2", "BANG_OFFICE": "/w/proj", "HABBLAUD_URL": url or office_url, **(env or {})})
        p = subprocess.run([sys.executable, BIN, *args], capture_output=True, text=True, env=e, timeout=60)
        return p.returncode, p.stdout, p.stderr
    return go


def test_the_answer_comes_after_the_long_poll_and_the_body_names_seat_question_and_office(run):
    Fake.gets.clear()
    code, out, err = run(["ok", "which", "file?"])
    assert (code, out) == (0, "Use a.csv.\n"), err
    assert Fake.posts[-1] == {"slot": "W2", "question": "ok which file?", "office": "/w/proj"}
    assert len(Fake.gets) == 2 and all("wait=" in g for g in Fake.gets)  # queued, then asking, then the answer


@pytest.mark.parametrize("question,code,text", [
    ("noboss", 2, "no boss terminal"), ("waiting", 3, "approve a permission"),
    ("late", 4, "no answer after 10 min"), ("plain", 5, "without the tag"), ("bad", 1, "not a seat")])
def test_each_failure_has_its_exit_and_says_to_write_blocked(run, question, code, text):
    c, out, err = run([question])
    assert (c, out) == (code, "")
    assert text in err and "blocked:" in err


def test_a_boss_that_is_still_starting_is_retried(run):
    Fake.starting = 0
    c, out, err = run(["starting", "q"])
    assert (c, out) == (0, "Use a.csv.\n"), err
    assert [p["question"] for p in Fake.posts[-2:]] == ["starting q"] * 2


def test_no_seat_no_question_or_no_office_never_reach_a_boss(run):
    n = len(Fake.posts)
    assert run(["q"], env={"BANG_SLOT": ""})[0] == 1
    assert run([])[0] == 1 and run(["--help"])[0] == 1
    c, _, err = run(["q"], url="http://127.0.0.1:9")
    assert c == 2 and "not running" in err
    assert len(Fake.posts) == n


@pytest.mark.parametrize("question,code,text", [
    ("gone", 2, "no such route"), ("down", 2, "interactive terminal"),
    ("odd", 1, "something odd"), ("nocode", 1, "plain conflict")])
def test_other_refusals_map_to_their_exit_with_the_server_message(run, question, code, text):
    c, out, err = run([question])
    assert (c, out) == (code, "") and text in err


def test_a_boss_that_never_finishes_starting_exits_2_with_the_reason(run):
    c, out, err = run(["stuck"], env={"ADVISOR_START_MAX": "0.5", "ADVISOR_START_WAIT": "0.1"})
    assert (c, out) == (2, "") and "still starting" in err and "blocked:" in err


def test_an_empty_habblaud_url_falls_back_to_the_default():
    # Import only (no request): a real run would hit the user's office on the default port.
    code = f"import runpy; print(runpy.run_path({BIN!r}, run_name='advisor')['URL'])"
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env={**os.environ, "HABBLAUD_URL": ""})
    assert p.stdout.strip() == "http://127.0.0.1:4747", p.stderr
