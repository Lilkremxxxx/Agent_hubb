#!/usr/bin/env python3
"""Tests of bin/worker-ask (agy-ask / claude-ask) against a fake office.

Run: python3 tests/test_worker_ask.py. Nothing real runs: HABBLAUD_DATA_DIR is a temp folder holding team.json,
HABBLAUD_URL a fake server that answers every job at once, and `agy-as` / `claude` are fake scripts."""
import http.server, json, os, shutil, subprocess, sys, tempfile, threading, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "bin", "worker-ask")


class Office(http.server.BaseHTTPRequestHandler):
    bodies = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Office.bodies.append(body)
        if body["prompt"] == "busy":  # the seat is on another job
            return self.reply({"error": "BUSY", "message": "W1 is busy"}, 409)
        self.reply({"job": {"id": "j1", "status": "done", "answer": "pong"}})

    def reply(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


# What a headless fake reports: where it ran, its arguments and the environment the seat gave it.
REPORT = ('json.dumps({"cwd": os.getcwd(), "args": sys.argv[1:], "slot": os.environ.get("BANG_SLOT"), '
          '"office": os.environ.get("BANG_OFFICE"), "conf": os.environ.get("CLAUDE_CONFIG_DIR")})')
# Fake `agy-as` (next to the worker-ask copy): the stream-json events agy prints.
FAKE_AGY_AS = f"""#!/usr/bin/env python3
import json, os, sys
print(json.dumps({{"event": "init", "conversation_id": "c1"}}, separators=(",", ":")))
print(json.dumps({{"event": "result", "result": {{"status": "SUCCESS", "response": {REPORT}}}}}, separators=(",", ":")))
"""
# Fake `claude`: `-p` answers at once; anything else runs as a command (a fake ancestor for "anyone may give jobs").
FAKE_CLAUDE = f"""#!/bin/bash
if [ "$1" = "-p" ]; then
  exec python3 -c 'import json, os, sys; print(json.dumps({{"subtype": "success", "result": {REPORT}, "usage": {{}}}}))' "$@"
fi
"$@"
"""


class Seats(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = os.path.realpath(tempfile.mkdtemp(prefix="worker-ask-test-"))
        cls.home = os.path.join(cls.tmp, "home")
        cls.data = os.path.join(cls.tmp, "data")
        cls.folder = os.path.join(cls.tmp, "proj")
        for d in (cls.home, cls.data, cls.folder, os.path.join(cls.home, ".claude-worker"), os.path.join(cls.home, ".claude")):
            os.makedirs(d)
        cls.bin = os.path.join(cls.tmp, "bin")
        os.makedirs(cls.bin)
        for name in ("agy-ask", "claude-ask"):
            shutil.copy(SRC, os.path.join(cls.bin, name))
        for name, body in (("agy-as", FAKE_AGY_AS), ("claude", FAKE_CLAUDE)):
            path = os.path.join(cls.bin, name)
            with open(path, "w") as f:
                f.write(body)
            os.chmod(path, 0o755)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Office)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.tmp)

    def setUp(self):
        Office.bodies.clear()
        self.write_team(self.folder)

    def write_team(self, folder):
        with open(os.path.join(self.data, "team.json"), "w") as f:
            json.dump({"folder": folder, "boss": {"kind": "claude", "account": "default"},
                       "workers": [{"name": "W1", "kind": "agy", "account": "acc1"},
                                   {"name": "W2", "kind": "agy", "account": "acc1"},
                                   {"name": "C1", "kind": "claude", "account": "worker"},
                                   {"name": "D1", "kind": "claude", "account": "default"}]}, f)

    def ask(self, args, via=None, office=True, tool="agy-ask", env=None):
        """(exit code, stdout, stderr) of `<tool> <args>`, started by the fake `via` agent when given."""
        e = {k: v for k, v in os.environ.items() if not k.startswith(("AGY_", "BANG_", "CLAUDE"))}
        e.update(HABBLAUD_DATA_DIR=self.data, HOME=self.home,
                 HABBLAUD_URL=f"http://127.0.0.1:{self.server.server_port if office else 9}")
        e.update(env or {})
        if not office:
            e["PATH"] = f"{self.bin}:{e['PATH']}"
        cmd = [os.path.join(self.bin, tool)] + args
        if via:
            cmd = [os.path.join(self.bin, via)] + cmd
        p = subprocess.run(cmd, env=e, capture_output=True, text=True, timeout=30, cwd=self.tmp)
        return p.returncode, p.stdout, p.stderr

    def test_seat_job_goes_to_the_office_by_name(self):
        code, out, err = self.ask(["W2", "ping"])
        self.assertEqual((code, out.strip()), (0, "pong"), err)
        body = Office.bodies[-1]
        self.assertEqual(body["worker"], "W2")
        for k in ("by", "callerPid", "office", "cwd", "lean"):
            self.assertNotIn(k, body)

    def test_any_caller_may_give_jobs(self):  # started under a fake `claude` ancestor: no team rule
        code, _, err = self.ask(["W1", "ping"], via="claude")
        self.assertEqual(code, 0, err)

    def test_unknown_seat_lists_the_seats(self):
        code, _, err = self.ask(["acc1", "ping"])
        self.assertEqual(code, 1)
        self.assertIn("no seat acc1 (seats: W1, W2, C1, D1)", err)

    def test_headless_agy_runs_in_the_folder_with_the_seat_env(self):
        code, out, err = self.ask(["W2", "ping", "--mode", "plan"], office=False)
        r = json.loads(out)
        self.assertEqual((code, r["cwd"], r["slot"], r["office"], r["args"][0]), (0, self.folder, "W2", self.folder, "acc1"), err)

    def test_headless_claude_full_by_default_lean_on_request(self):
        r = json.loads(self.ask(["C1", "ping", "--max", "500"], office=False)[1])
        self.assertEqual((r["conf"], r["slot"], r["cwd"]), (os.path.join(self.home, ".claude-worker"), "C1", self.folder))
        self.assertNotIn("--strict-mcp-config", r["args"])
        r = json.loads(self.ask(["C1", "ping", "--max", "900", "--lean"], office=False)[1])
        self.assertIn("--strict-mcp-config", r["args"])
        self.assertIn("under 900 characters", r["args"][r["args"].index("--append-system-prompt") + 1])

    def test_office_job_is_lean_only_with_the_flag_and_sends_cwd_only_when_given(self):
        self.ask(["C1", "ping", "--lean", "--cwd", self.tmp])
        self.assertEqual((Office.bodies[-1]["lean"], Office.bodies[-1]["cwd"]), (True, self.tmp))

    def test_lean_keeps_the_callers_own_tools(self):
        r = json.loads(self.ask(["C1", "ping", "--lean", "--tools", "Read"], office=False)[1])
        self.assertEqual(r["args"].count("--tools"), 1)
        self.assertEqual(r["args"][r["args"].index("--tools") + 1], "Read")

    def test_default_account_does_not_set_the_config_dir(self):
        code, out, err = self.ask(["D1", "ping"], office=False, env={"CLAUDE_CONFIG_DIR": "/leaked"})  # an inherited one must not reach the seat
        self.assertEqual(code, 0, err)
        self.assertIsNone(json.loads(out)["conf"])

    def test_busy_seat_exits_3(self):
        code, _, err = self.ask(["W1", "busy"])
        self.assertEqual(code, 3, err)

    def test_claude_seat_without_lean_sends_no_lean_key(self):
        self.ask(["C1", "ping"])
        self.assertNotIn("lean", Office.bodies[-1])

    def test_no_folder_no_cwd_fails_before_any_job(self):
        self.write_team("")
        code, _, err = self.ask(["W1", "ping"])
        self.assertEqual(code, 1)
        self.assertIn("has no folder", err)
        self.assertEqual(Office.bodies, [])

    def test_seats_are_filtered_like_the_server(self):
        with open(os.path.join(self.data, "team.json"), "w") as f:
            json.dump({"folder": self.folder, "workers": [{"name": "X1", "kind": "gpt", "account": "a"},
                                                         {"name": "W1", "kind": "agy", "account": "acc1"},
                                                         {"name": "W1", "kind": "claude", "account": "other"}]}, f)
        code, _, err = self.ask(["X1", "ping"])
        self.assertEqual(code, 1)
        self.assertIn("no seat X1 (seats: W1)", err)
        code, out, _ = self.ask(["W1", "ping"], office=False)
        self.assertEqual(json.loads(out)["args"][0], "acc1")  # the first duplicate won

    def test_relative_folder_is_no_folder_and_office_env_is_normalized(self):
        self.write_team("rel/dir")
        code, _, err = self.ask(["W1", "ping"])
        self.assertEqual(code, 1)
        self.assertIn("has no folder", err)
        self.write_team(self.folder + "/./")
        code, out, err = self.ask(["W2", "ping"], office=False)
        self.assertEqual((code, json.loads(out)["office"]), (0, self.folder), err)

    def test_missing_team_file_fails(self):
        os.remove(os.path.join(self.data, "team.json"))
        code, _, err = self.ask(["W1", "ping"])
        self.assertEqual(code, 1)
        self.assertIn("no team file", err)

    def test_team_prints_folder_boss_and_seats(self):
        code, out, err = self.ask(["team"])
        self.assertEqual(code, 0, err)
        for line in (f"folder: {self.folder}", "boss: claude (default)", "W1  agy  acc1", "C1  claude  worker"):
            self.assertIn(line, out)

    def test_rules_subcommand_is_gone(self):
        code, _, err = self.ask(["rules", "show"])
        self.assertEqual(code, 1)
        self.assertIn("rules", err.lower())


class BossRulesHook(unittest.TestCase):
    """agy-plugin/agy-boss/boss-rules: the SessionStart hook that makes an agy started by Habblaud a boss."""
    HOOK = os.path.join(HERE, "..", "agy-plugin", "agy-boss", "boss-rules")

    def hook(self, env):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "team.json"), "w") as f:
                json.dump({"offices": [{"id": "o7", "name": "Glass shop", "folder": "/x/glass", "workers": []}]}, f)
            e = {k: v for k, v in os.environ.items() if not k.startswith("AGY_")}
            e.update(env, HABBLAUD_AGY_PROFILES=root)
            p = subprocess.run([sys.executable, self.HOOK], input="{}", env=e, capture_output=True, text=True, timeout=10)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)

    def test_nothing_without_agy_boss(self):
        self.assertEqual(self.hook({}), {})

    def test_boss_rules_and_office(self):
        msg = self.hook({"AGY_BOSS": "1", "AGY_OFFICE": "o7"})["injectSteps"][0]["systemMessage"]["systemMessage"]
        self.assertTrue(msg.startswith("# You are the boss here"))
        self.assertIn("boss of the office Glass shop (id o7), project folder /x/glass.", msg)


if __name__ == "__main__":
    unittest.main(verbosity=1)
