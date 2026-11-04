import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.realpath(os.path.join(HERE, "..", "..", ".."))
SKILLS = os.path.join(REPO, "skills")


def read(n):
    return open(os.path.join(SKILLS, n, "SKILL.md"), encoding="utf-8").read()


def test_the_three_bang_skills_have_frontmatter_named_after_their_folder():
    assert sorted(os.listdir(SKILLS)) == ["advisor", "bang-task", "giao-viec"]
    for n in os.listdir(SKILLS):
        head = open(os.path.join(SKILLS, n, "SKILL.md"), encoding="utf-8").read().split("---")[1]
        assert re.search(rf"^name: {n}$", head, re.M)
        assert re.search(r"^description: \S", head, re.M)


def test_agy_orchestrator_is_folded_into_giao_viec():
    assert not os.path.exists(os.path.join(REPO, "tools", "agy", "skills"))
    g = read("giao-viec")
    assert "worker-ask team" in g and "| 3 | BUSY" in g
    assert "agy-ask" not in g and "claude-ask" not in g


def test_bang_task_carries_the_board_rules():
    b = read("bang-task")
    for s in ("Việc đang làm", "Ghi chú kỹ thuật", "Bài học", "Hỏi đáp", "Đã xong", "`blocked:", "task_board.archive.md"):
        assert s in b
    assert "EXE101" not in b and "version:" not in b


def test_advisor_placeholder_says_blocked_when_the_command_fails():
    a = read("advisor")
    assert 'advisor "' in a and "blocked:" in a
