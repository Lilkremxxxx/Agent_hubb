import json
import os
import shutil
import subprocess
import tempfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
BANG_INIT = os.path.join(REPO, "tools", "agy", "bin", "bang-init")
SKILL_DIRS = os.path.join(REPO, "tools", "agy", "bin", "skill-dirs")
PLUG = ".claude/plugins/cache/mk"


def touch(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)


@pytest.fixture
def env(tmp_path):
    h = str(tmp_path / "home")
    d = str(tmp_path / "data")
    touch(f"{h}/.claude/skills/own/SKILL.md")
    os.makedirs(f"{h}/.claude/skills/learned")
    touch(f"{h}/{PLUG}/plug/1.2.0/skills/a/SKILL.md")
    touch(f"{h}/{PLUG}/plug/1.10.0/skills/a/SKILL.md")
    touch(f"{h}/{PLUG}/bare/0.1.0/README")
    os.makedirs(d)
    proj = str(tmp_path / "new" / "proj")

    class E:
        pass

    e = E()
    e.h, e.d, e.proj, e.tmp = h, d, proj, str(tmp_path)

    def run(args, home=h, data=d):
        ev = {"HOME": home, "PATH": os.environ["PATH"]}
        if data is not None:
            ev["HABBLAUD_DATA_DIR"] = data
        r = subprocess.run([BANG_INIT, *args], capture_output=True, text=True, env=ev)
        return r.returncode, r.stdout, r.stderr

    def team(obj):
        json.dump(obj, open(f"{d}/team.json", "w"))

    e.run, e.team = run, team
    e.read = lambda *p: open(os.path.join(*p), encoding="utf-8").read()
    e.real = os.path.realpath
    return e


def test_skill_dirs_takes_the_newest_version_by_number(env):
    ev = {"HOME": env.h, "PATH": os.environ["PATH"]}
    out = subprocess.run([SKILL_DIRS, env.h], capture_output=True, text=True, env=ev).stdout.split()
    assert out == [f"{env.h}/.claude/skills", f"{env.h}/{PLUG}/plug/1.10.0/skills"]


def test_fresh_folder_gets_templates_manifest_links_and_gemini(env):
    h, proj = env.h, env.proj
    env.team({"folder": "", "boss": {"kind": "claude", "account": "default"}, "workers": []})
    code, out, err = env.run([proj])
    assert code == 0, err
    tb = env.read(proj, "task_board.md")
    for f in ("task_board.md", "project_proposal.md"):
        want = open(f"{REPO}/templates/{f}", encoding="utf-8").read()
        want = want.replace("<tên dự án>", "proj").replace("<tên>", "proj").replace("<folder>", env.real(proj))
        assert env.read(proj, f) == want
    assert tb.startswith("# Task board — proj\n") and f"_Office: {env.real(proj)} · Boss:" in tb
    assert env.read(proj, "project_proposal.md").startswith("# Đề xuất dự án — proj\n")
    assert json.load(open(f"{proj}/.agents/skills.json")) == {"entries": [
        {"path": f"{h}/.claude/skills"}, {"path": f"{h}/{PLUG}/plug/1.10.0/skills"}, {"path": f"{REPO}/skills"}]}
    for n in ("giao-viec", "advisor", "bang-task"):
        assert os.readlink(f"{proj}/.claude/skills/{n}") == f"{REPO}/skills/{n}"
    assert os.readlink(f"{proj}/GEMINI.md") == "CLAUDE.md" and env.read(proj, "CLAUDE.md") == "Chạy /init để điền\n"
    assert "giao-viec" in out and "/init" in out


def test_second_run_keeps_what_the_user_wrote(env):
    proj = env.proj
    assert env.run([proj])[0] == 0
    for f in ("task_board.md", "CLAUDE.md"):
        with open(f"{proj}/{f}", "a") as fh:
            fh.write("x")
    links = {n: os.readlink(f"{proj}/.claude/skills/{n}") for n in os.listdir(f"{proj}/.claude/skills")}
    assert env.run([proj])[0] == 0
    assert env.read(proj, "task_board.md").endswith("x") and env.read(proj, "CLAUDE.md").endswith("x")
    assert links == {n: os.readlink(f"{proj}/.claude/skills/{n}") for n in os.listdir(f"{proj}/.claude/skills")}


def test_skills_list_becomes_include_only_except_the_bang_skills(env):
    proj = env.proj
    touch(f"{proj}/skills.list", "a\n# note\n\nown\n")
    assert env.run([proj])[0] == 0
    entries = json.load(open(f"{proj}/.agents/skills.json"))["entries"]
    for e in entries:
        if e["path"] == f"{REPO}/skills":
            assert "include_only" not in e
        else:
            assert e["include_only"] == ["a", "own"]
    assert len(entries) == 3


def test_empty_folder_in_team_json_is_set_atomically(env):
    env.team({"folder": "", "boss": {"kind": "agy", "account": "acc1"},
              "workers": [{"name": "W1", "kind": "agy", "account": "acc1"}]})
    env.run([env.proj])
    t = json.load(open(f"{env.d}/team.json"))
    assert list(t) == ["folder", "boss", "workers"] and t["folder"] == env.real(env.proj) and t["workers"][0]["name"] == "W1"
    assert os.listdir(env.d) == ["team.json"]


def test_another_office_folder_is_kept(env):
    other = os.path.join(env.tmp, "other")
    os.makedirs(other)
    env.team({"folder": other, "workers": []})
    before = open(f"{env.d}/team.json", "rb").read()
    code, out, _ = env.run([env.proj])
    assert code == 0 and open(f"{env.d}/team.json", "rb").read() == before and other in out


def test_missing_team_json_is_not_created(env):
    code, out, _ = env.run([env.proj])
    assert code == 0 and not os.path.exists(f"{env.d}/team.json") and "start the office once" in out


def test_broken_team_json_is_left_alone(env):
    open(f"{env.d}/team.json", "w").write("{bad")
    code, _, err = env.run([env.proj])
    assert code == 1 and open(f"{env.d}/team.json").read() == "{bad" and "team.json" in err
    assert os.path.exists(f"{env.proj}/.agents/skills.json")


def test_next_steps_say_each_agy_account_trusts_the_folder_once(env):
    env.team({"folder": "", "workers": [{"name": "W1", "kind": "agy", "account": "acc2"}, {"name": "W2", "kind": "agy", "account": "acc1"},
                                        {"name": "W3", "kind": "agy", "account": "acc2"}, {"name": "C1", "kind": "claude", "account": ".claude-w"}]})
    _, out, _ = env.run([env.proj])
    assert f"Antigravity seats: BEFORE the first job in this folder, once per account (acc1, acc2): cd {env.real(env.proj)} && agy-as <acc>" in out and ".claude-w" not in out
    _, out, _ = env.run([env.proj], data=env.tmp + "/none")  # no team.json: generic wording
    assert "each agy account in team.json" in out and "BEFORE the first job" in out
    env.team({"folder": "", "workers": [{"name": "C1", "kind": "claude", "account": ".claude-w"}]})
    _, out, _ = env.run([env.proj])
    assert "Antigravity seats" not in out  # a Claude-only team


def test_blank_data_dir_means_home_habblaud(env):
    touch(f"{env.h}/.habblaud/team.json", json.dumps({"folder": ""}))
    code, _, err = env.run([env.proj], data="   ")
    assert code == 0, err
    assert json.load(open(f"{env.h}/.habblaud/team.json"))["folder"] == env.real(env.proj)


def test_inside_an_agy_profile_paths_use_the_real_home(env):
    prof = f"{env.h}/.agy_profiles/acc1"
    os.makedirs(prof)
    code, _, err = env.run([env.proj], home=prof)
    assert code == 0, err
    paths = [e["path"] for e in json.load(open(f"{env.proj}/.agents/skills.json"))["entries"]]
    assert paths[0] == f"{env.h}/.claude/skills"


def test_existing_gemini_file_and_real_skill_dir_are_left(env):
    proj = env.proj
    touch(f"{proj}/GEMINI.md", "mine")
    os.makedirs(f"{proj}/.claude/skills/advisor")
    code, out, _ = env.run([proj])
    assert code == 0 and env.read(proj, "GEMINI.md") == "mine"
    assert os.path.isdir(f"{proj}/.claude/skills/advisor") and not os.path.islink(f"{proj}/.claude/skills/advisor")
    assert "left .claude/skills/advisor: not a link" in out


def test_no_argument_prints_usage(env):
    code, _, err = env.run([])
    assert code == 1 and "usage: bang-init <folder>" in err


def test_skill_dirs_one_version_with_skills_and_a_newer_one_without(env):
    shutil.rmtree(f"{env.h}/{PLUG}/plug/1.10.0")
    touch(f"{env.h}/{PLUG}/plug/latest/README")
    ev = {"HOME": env.h, "PATH": os.environ["PATH"]}
    out = subprocess.run([SKILL_DIRS, env.h], capture_output=True, text=True, env=ev).stdout.split()
    assert out == [f"{env.h}/.claude/skills", f"{env.h}/{PLUG}/plug/1.2.0/skills"]


def test_skills_list_with_only_comments_is_no_list(env):
    touch(f"{env.proj}/skills.list", "# nothing yet\n\n   \n")
    assert env.run([env.proj])[0] == 0
    entries = json.load(open(f"{env.proj}/.agents/skills.json"))["entries"]
    assert len(entries) == 3 and all("include_only" not in e for e in entries)


def test_cdpath_does_not_redirect_the_folder(env):
    cd = os.path.join(env.tmp, "cdp")
    work = os.path.join(env.tmp, "work")
    os.makedirs(f"{cd}/p3")
    os.makedirs(work)
    env.team({"folder": "", "workers": []})
    ev = {"HOME": env.h, "PATH": os.environ["PATH"], "HABBLAUD_DATA_DIR": env.d, "CDPATH": cd}
    r = subprocess.run([BANG_INIT, "p3"], capture_output=True, text=True, env=ev, cwd=work)
    assert r.returncode == 0, r.stderr
    assert os.path.exists(f"{work}/p3/.agents/skills.json") and os.listdir(f"{cd}/p3") == []
    assert json.load(open(f"{env.d}/team.json"))["folder"] == env.real(f"{work}/p3")


def test_next_steps_warn_about_the_skill_cost_and_skills_list(env):
    _, out, _ = env.run([env.proj])
    assert f"Antigravity jobs carry every skill description (~25k tokens); list the ones you want in {env.real(env.proj)}/skills.list (one name per line) and run bang-init again" in out


def test_same_folder_spelled_differently_is_the_office_folder(env):
    os.makedirs(env.proj)
    os.symlink(env.proj, f"{env.tmp}/ln")
    env.team({"folder": f"{env.tmp}/ln/", "workers": []})
    _, out, _ = env.run([env.proj])
    assert "already the office folder" in out and "edit" not in out


def test_relative_folder_in_team_json_counts_as_empty(env):
    env.team({"folder": "rel/dir", "workers": []})
    _, out, _ = env.run([env.proj])
    assert json.load(open(f"{env.d}/team.json"))["folder"] == env.real(env.proj) and "office folder set" in out


def test_unset_home_is_a_clear_error(env):
    r = subprocess.run([BANG_INIT, env.proj], capture_output=True, text=True, env={"PATH": os.environ["PATH"]})
    assert r.returncode != 0 and "HOME" in r.stderr and not os.path.exists(env.proj)
