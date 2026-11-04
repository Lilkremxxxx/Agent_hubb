import json
import os
import shutil
import subprocess

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
PLUG = ".claude/plugins/cache/mk/plug"
OR = ".gemini/config/plugins/office-rules"


def touch(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)


def office_rules_links(profile, vi):
    d = f"{profile}/{OR}"
    os.makedirs(d)
    for n in ("hooks.json", "plugin.json", "rules-hook"):
        os.symlink(f"{vi}/agy-plugin/office-rules/{n}", f"{d}/{n}")


@pytest.fixture
def box(tmp_path):
    h = str(tmp_path / "home")
    vi = str(tmp_path / "Vi-Habblaud" / "tools" / "agy")
    for f in ("bin/agy-as", "bin/worker-ask", "bin/agy-up", "bin/rules-hook",
              "agy-plugin/office-rules/hooks.json", "agy-plugin/office-rules/plugin.json",
              "agy-plugin/office-rules/rules-hook", "skills/agy-orchestrator/SKILL.md", "skills/office-rules/SKILL.md"):
        touch(f"{vi}/{f}")
    b = f"{h}/.local/bin"
    os.makedirs(b)
    for n, t in (("agy-as", f"{vi}/bin/agy-as"), ("agy-ask", f"{vi}/bin/worker-ask"), ("claude-ask", "agy-ask"),
                 ("agy-up", f"{vi}/bin/agy-up"), ("rules-hook", f"{vi}/bin/rules-hook"), ("browser", "/opt/else/browser")):
        os.symlink(t, f"{b}/{n}")
    touch(f"{b}/uv", "x")
    os.makedirs(f"{h}/.claude/skills")
    for n in ("agy-orchestrator", "office-rules"):
        os.symlink(f"{vi}/skills/{n}", f"{h}/.claude/skills/{n}")
    touch(f"{h}/.claude/skills/mine/SKILL.md")
    for acc in ("acc1", "acc2"):
        p = f"{h}/.agy_profiles/{acc}"
        touch(f"{p}/.gemini/GEMINI.md", "rules")
        touch(f"{p}/.gemini/config/plugins/other/plugin.json")
        office_rules_links(p, vi)
    touch(f"{h}/.agy_profiles/acc2/{OR}/notes.txt")
    for v in ("1.2.0", "1.10.0"):
        for s in ("a", "b"):
            touch(f"{h}/{PLUG}/{v}/skills/{s}/SKILL.md")

    class B:
        pass

    x = B()
    x.h, x.vi, x.tmp = h, vi, str(tmp_path)

    def run(*args, env_extra=None):
        # scratch env only: nothing from the caller's shell (HABBLAUD_*, CLAUDE_CONFIG_DIR) may reach the script
        ev = {"HOME": h, "PATH": f"{h}/.local/bin:" + os.environ["PATH"], **(env_extra or {})}
        r = subprocess.run(["bash", f"{REPO}/tools/install.sh", *args], capture_output=True, text=True, env=ev)
        return r.returncode, r.stdout, r.stderr

    x.run = run
    return x


def test_links_point_to_this_repo(box):
    h = box.h
    assert box.run()[0] == 0
    for n in ("worker-ask", "agy-as", "bang-init", "advisor"):
        assert os.readlink(f"{h}/.local/bin/{n}") == f"{REPO}/tools/agy/bin/{n}"
    for n in ("agy-ask", "claude-ask"):
        assert os.path.realpath(f"{h}/.local/bin/{n}") == os.path.realpath(f"{REPO}/tools/agy/bin/worker-ask")


def test_vi_habblaud_leftovers_go_and_nothing_else(box):
    h = box.h
    code, out, _ = box.run()
    assert code == 0
    for n in ("agy-up", "rules-hook"):
        assert not os.path.lexists(f"{h}/.local/bin/{n}")
    # uv-like link, plain file: not ours
    assert open(f"{h}/.local/bin/uv").read() == "x" and os.readlink(f"{h}/.local/bin/browser") == "/opt/else/browser"
    for n in ("agy-orchestrator", "office-rules"):
        assert not os.path.lexists(f"{h}/.claude/skills/{n}")
    assert os.path.isfile(f"{h}/.claude/skills/mine/SKILL.md")
    assert not os.path.lexists(f"{h}/.agy_profiles/acc1/{OR}")
    assert os.listdir(f"{h}/.agy_profiles/acc2/{OR}") == ["notes.txt"]
    assert "left" in out and "acc2" in out
    assert open(f"{h}/.agy_profiles/acc1/.gemini/GEMINI.md").read() == "rules"
    assert os.path.isfile(f"{h}/.agy_profiles/acc1/.gemini/config/plugins/other/plugin.json")
    assert not os.path.exists(f"{h}/.claude-worker")


def test_real_skill_dir_and_foreign_links_in_claude_skills_stay(box):
    h = box.h
    os.makedirs(f"{h}/other")
    os.symlink(f"{h}/other", f"{h}/.claude/skills/elsewhere")
    os.remove(f"{h}/.claude/skills/office-rules")
    os.makedirs(f"{h}/.claude/skills/office-rules")  # a real dir with that name stays
    assert box.run()[0] == 0
    assert os.path.islink(f"{h}/.claude/skills/elsewhere") and os.path.isdir(f"{h}/.claude/skills/office-rules")
    assert not os.path.islink(f"{h}/.claude/skills/office-rules")


def test_second_run_removes_nothing(box):
    box.run()
    code, out, _ = box.run()
    assert code == 0 and "removed" not in out


def test_env_from_the_caller_is_not_used(box):
    # The profiles root comes from HABBLAUD_AGY_PROFILES. Tests never inherit it; when it is set it wins over ~/.agy_profiles.
    other = f"{box.tmp}/other-profiles"
    office_rules_links(f"{other}/acc9", box.vi)
    assert box.run(env_extra={"HABBLAUD_AGY_PROFILES": other})[0] == 0
    assert not os.path.lexists(f"{other}/acc9/{OR}")
    assert os.listdir(f"{box.h}/.agy_profiles/acc1/{OR}")  # untouched this run
    assert box.run()[0] == 0  # default root: now acc1 goes
    assert not os.path.lexists(f"{box.h}/.agy_profiles/acc1/{OR}")


def test_worker_links_every_skill_once_and_prints_the_login(box):
    h = box.h
    os.makedirs(f"{h}/.habblaud")
    json.dump({"folder": f"{h}/proj"}, open(f"{h}/.habblaud/team.json", "w"))
    code, out, _ = box.run("--worker")
    w = f"{h}/.claude-worker/skills"
    assert code == 0 and sorted(os.listdir(w)) == ["a", "b", "mine"]
    assert os.readlink(f"{w}/a") == f"{h}/{PLUG}/1.10.0/skills/a"
    assert f"cd {h}/proj && CLAUDE_CONFIG_DIR={h}/.claude-worker claude" in out
    assert "linked 3 skills" in out


def test_worker_rerun_follows_a_plugin_update_and_keeps_real_folders(box):
    h = box.h
    w = f"{h}/.claude-worker/skills"
    box.run("--worker")
    for s in ("a", "b"):
        touch(f"{h}/{PLUG}/1.11.0/skills/{s}/SKILL.md")
    os.remove(f"{w}/a")
    os.makedirs(f"{w}/own")
    os.symlink("/opt/else/x", f"{w}/elsewhere")
    assert box.run("--worker")[0] == 0
    for s in ("a", "b"):
        assert os.readlink(f"{w}/{s}") == f"{h}/{PLUG}/1.11.0/skills/{s}"
    assert all(os.path.exists(f"{w}/{n}") for n in os.listdir(w) if n != "elsewhere")
    assert os.path.isdir(f"{w}/own") and not os.path.islink(f"{w}/own")
    assert os.readlink(f"{w}/elsewhere") == "/opt/else/x"
    assert os.readlink(f"{w}/mine") == f"{h}/.claude/skills/mine"


def test_worker_without_team_json_prints_a_placeholder_folder(box):
    assert "cd <office folder> && CLAUDE_CONFIG_DIR=" in box.run("--worker")[1]


def test_unknown_argument_is_refused(box):
    code, _, err = box.run("--nope")
    assert code == 1 and "usage" in err
    assert not os.path.exists(f"{box.h}/.local/bin/worker-ask")


def test_real_file_or_dir_in_local_bin_is_never_replaced(box):
    b = f"{box.h}/.local/bin"
    os.remove(f"{b}/agy-ask")
    touch(f"{b}/bang-init", "mine")
    os.makedirs(f"{b}/agy-ask")
    code, out, err = box.run()
    assert code == 0
    assert open(f"{b}/bang-init").read() == "mine" and not os.path.islink(f"{b}/bang-init")
    assert os.listdir(f"{b}/agy-ask") == [] and not os.path.islink(f"{b}/agy-ask")
    assert "left" in err and "bang-init" in err and "agy-ask" in err
    assert "agy-ask" not in box.run()[1]


def test_worker_second_run_prints_nothing_to_change(box):
    box.run("--worker")
    code, out, _ = box.run("--worker")
    assert code == 0 and "removed" not in out and "linked" not in out.split("Sign in")[0]


def test_link_into_a_look_alike_folder_is_not_removed(box):
    b = f"{box.h}/.local/bin"
    os.symlink("/x/Vi-Habblaud-backup/agy-up", f"{b}/keep-me")
    box.run()
    assert os.readlink(f"{b}/keep-me") == "/x/Vi-Habblaud-backup/agy-up"


def test_a_clone_under_a_vi_habblaud_path_keeps_its_own_links(box):
    clone = f"{box.tmp}/Vi-Habblaud/fork"
    os.makedirs(f"{clone}/tools/agy")
    shutil.copy(f"{REPO}/tools/install.sh", f"{clone}/tools/install.sh")
    shutil.copytree(f"{REPO}/tools/agy/bin", f"{clone}/tools/agy/bin")
    ev = {"HOME": box.h, "PATH": f"{box.h}/.local/bin:" + os.environ["PATH"]}
    for _ in range(2):
        r = subprocess.run(["bash", f"{clone}/tools/install.sh"], capture_output=True, text=True, env=ev)
        assert r.returncode == 0, r.stderr
        for n in ("worker-ask", "agy-as", "bang-init"):
            assert os.readlink(f"{box.h}/.local/bin/{n}") == f"{clone}/tools/agy/bin/{n}"
        assert os.path.realpath(f"{box.h}/.local/bin/agy-ask") == os.path.realpath(f"{clone}/tools/agy/bin/worker-ask")
    assert not os.path.lexists(f"{box.h}/.local/bin/agy-up")  # the real Vi-Habblaud leftovers still go
