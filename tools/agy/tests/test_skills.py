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


def test_giao_viec_carries_the_spec_template_and_the_review_loop():
    assert not os.path.exists(os.path.join(REPO, "tools", "agy", "skills"))
    spec = open(os.path.join(REPO, "docs", "superpowers", "specs", "2026-11-03-bang-ver-design.md"), encoding="utf-8").read()
    template = re.search(r"Mẫu prompt, nguyên văn:\n\n```\n(.*?)```", spec, re.S).group(1)
    g = read("giao-viec")
    assert template in g
    for s in ("worker-ask team", "| 3 | BUSY", "--raw", "--mode plan", "--mode auto", "run_in_background", "## Kết quả review lần trước",
              "- Khi <tình huống> → <làm gì> (vì …) [", "agy-as <acc>", "retrying cannot help", "ask the user", "100 kB",
              "## 5. Answer a seat's question", "[ADVISOR W2 T2]", "text only", "❓ Ghế W2 hỏi (việc T2)", "NOTHING before"):
        assert s in g, s
    for s in ("(Habblaud)", "not available", "agy-ask", "claude-ask"):
        assert s not in g, s


def test_bang_task_carries_the_board_rules():
    b = read("bang-task")
    for s in ("Việc đang làm", "Ghi chú kỹ thuật", "Bài học", "Hỏi đáp", "Đã xong", "`blocked:", "task_board.archive.md"):
        assert s in b
    assert "EXE101" not in b and "version:" not in b


def test_advisor_says_how_to_ask_and_what_each_exit_means():
    a = read("advisor")
    for s in ('advisor "', "blocked:", "STOP", "timeout: 600000", "| 0 |", "| 5 |", "approve", "Hỏi đáp", "retries"):
        assert s in a, s
    assert "placeholder" not in a
