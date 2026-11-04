# Bang_ver — Kế hoạch 3/6: thư mục skill, `bang-init`, hai mẫu file, `tools/install.sh`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi dự án có office chỉ cần `bang-init <folder>`: hai mẫu `task_board.md`/`project_proposal.md`, `.agents/skills.json` cho agy (≈390 skill qua đường dẫn tuyệt đối), 3 link skill riêng của Bang_ver trong `.claude/skills/`, `GEMINI.md` → `CLAUDE.md`, và `folder` trong `team.json`; `tools/install.sh` chuyển máy hẳn sang Bang_ver (link `~/.local/bin`, gỡ phần Vi-Habblaud để lại, `--worker` cho `~/.claude-worker`); `scripts/office.sh start|stop|restart`; dọn backlog Kế hoạch 2 (M4, M7, M8, M9).

**Architecture:** Ba skill nằm ở `skills/` gốc repo. Một helper `tools/agy/bin/skill-dirs` in danh sách thư mục nguồn skill (`~/.claude/skills` + thư mục `skills` của phiên bản mới nhất mỗi plugin trong cache), dùng chung cho `bang-init` (viết `entries[]`) và `install.sh --worker` (link từng skill). `bang-init` là bash; phần JSON và chép mẫu chạy trong một khối `python3` (Python 3 đã là yêu cầu của `worker-ask`). `team.json` tính đường đúng như `worker-ask:44` và `server/config.ts:139`, ghi bằng tmp + rename. `office.sh stop` chỉ dừng tiến trình đang nghe cổng của nó khi `/proc/<pid>/cwd` là chính repo này và cmdline là `dist/server/index.js`.

**Tech Stack:** bash/sh, Python 3 + pytest (`tools/agy/tests`), Node ≥22 + TypeScript + vitest cho phần server/client.

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-design.md` (§8 skill, §9 `bang-init`, §10 hai mẫu nguyên văn, §15 cài đặt là lõi; §2, §3, §5, §6 ý `~/.claude-worker`, §13 đoạn cuối cho skill `advisor`, §17, §18, §19, §20). Bàn giao: mục "Để lại cho kế hoạch sau" của `2026-11-04-bang-ver-2-ghe.md` và M4, M7, M8, M9, "Plan 3 readiness" của `2026-11-04-bang-ver-2-ghe-final-review.md` (I1, I2, I3, M1, M3, M5, M6 đã sửa ở 4d175d4).

Phán quyết của controller và người dùng (ràng buộc như spec):
- Người dùng chuyển hẳn sang Bang_ver: `tools/install.sh` ghi đè các link `~/.local/bin` đang trỏ Vi-Habblaud, gỡ `office-rules` trong 8 profile `~/.agy_profiles/acc1..8/.gemini/config/plugins/` (chỉ link, không đụng file khác trong profile), gỡ `~/.claude/skills/agy-orchestrator`.
- Ghế Claude dùng `~/.claude-worker`; `install.sh --worker` link ≈390 skill vào `~/.claude-worker/skills/` và in lệnh đăng nhập; người dùng tự đăng nhập.
- Đường `team.json` giống hệt ở server, `worker-ask`, `bang-init`: `HABBLAUD_DATA_DIR` (trim) hoặc `~/.habblaud`, + `team.json`. `bang-init` ghi qua tmp+rename, không bao giờ ghi `~/.agy_profiles/team.json`.
- Nghiệm thu trên cổng 4749 từ git worktree (pid bằng `ss -ltnp`, không `pkill -f dist/server/index.js`). Server 4747 của người dùng không bị dừng hay khởi động lại bởi kế hoạch; bước cuối là hỏi người dùng.
- Chạy `tools/install.sh` thật chỉ trong một task riêng gần cuối (Task 9), sau khi script đã qua test với HOME giả, có danh sách thay đổi trước/sau.

## Global Constraints

- Không thêm runtime dependency; `dependencies` trong `package.json` vẫn không có.
- Mọi chữ hiển thị trên trang qua `tr('English text')`; bản dịch duy nhất ở `shared/locales/vi.ts`; `npm run i18n:check` phải 0 thiếu, 0 khoá thừa. CLI bash/Python in tiếng Anh như `worker-ask`.
- Code, comment, doc, nội dung SKILL.md bằng tiếng Anh (tiêu đề mục tiếng Việt của `task_board.md` trích nguyên văn); hai mẫu ở `templates/` là tiếng Việt nguyên văn spec §10; kế hoạch tiếng Việt.
- Sau mỗi task: `npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)` xanh, cộng `bash -n` / `sh -n` cho mọi script shell task đó sửa. Được phép đỏ chỉ các test flaky đã biết: `server/sources/tail.test.ts > detects replaced file (rotation) even if larger`, `server/sources/watcher.test.ts > tracks transcript appends and registry status`, `server/sources/watcher.test.ts > /clear: same process, new session — same character, reset tasks`, `art.test.ts > floor chunks` khi máy đang tải. Không sửa, không `skip` chúng.
- Mỗi task một commit; mọi commit kết thúc bằng đúng hai dòng:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKo78y8zx9LkivRuQac
  ```
- Phản mục tiêu §3 là giới hạn cứng: không plugin Claude; không ghi gì dưới `~/.agy_profiles/accN/.gemini/` ngoài việc Task 9 gỡ đúng các link `office-rules` (người dùng đã duyệt); giữ đường headless; không tính năng mới nào thêm ròng quá 300 dòng; server idle ≤110 MB (112 640 kB).
- Không bao giờ ghi `~/.agy_profiles/team.json`.
- Không chạy `npm run build` hay `npm run office` trong thư mục repo chính: server 4747 của người dùng chạy từ `dist/` của repo này (pid: `ss -Hltnp 'sport = :4747'`). Không dừng, không khởi động lại nó. Build và chạy thử chỉ trong worktree ở Task 8.
- Không đụng `~/.claude*` (gồm `~/.claude-worker`), `~/.local/bin`, `~/.agy_profiles`, `~/.habblaud` trừ Task 9. `~/.codex/skills/bang_task` chỉ đọc (Task 1). Mọi test của `install.sh`/`bang-init`/`skill-dirs` chạy với `HOME` tạm và xoá `HABBLAUD_AGY_PROFILES`, `HABBLAUD_DATA_DIR`, `CLAUDE_CONFIG_DIR`, `HABBLAUD_URL` khỏi env con.
- Ngoài phạm vi: nội dung thật của `giao-viec` (mẫu 6 phần, vòng review), lời mở đầu worker, kiểm 6 tiêu đề, giới hạn 20k ký tự (Kế hoạch 4); lệnh và cơ chế `advisor` (Kế hoạch 5 / spike); deploy và phần Docker/host-helper còn sót (Kế hoạch 6); M2 (tráo hội thoại boss agy, làm cùng advisor); thế giới nhiều toà nhà ở client.

## Quyết định của người viết kế hoạch (controller xem lại)

1. **`team.json` chưa có → `bang-init` không tạo nó.** Server chỉ nhập `~/.agy_profiles/team.json` khi `team.json` chưa tồn tại (team.ts:346–352); nếu `bang-init` tạo trước thì đội cũ không bao giờ được nhập. Máy này chưa có `~/.habblaud/team.json` (server 4747 là bản build Kế hoạch 1). `bang-init` in "start the office once (it writes team.json), then run bang-init again" và vẫn exit 0 (bước 1–3 đã xong).
2. **`folder` đã đặt sang chỗ khác → giữ nguyên**, in folder hiện tại và cách đổi (sửa `team.json`). Không có cờ ép.
3. **`skills.list` → `include_only` trên mọi entry trừ entry `Bang_ver/skills`**: ba skill riêng luôn nạp, người dùng không phải liệt kê chúng. Dòng trống và dòng bắt đầu bằng `#` bỏ qua.
4. **`agy-orchestrator` gộp vào `giao-viec`** (thân tạm của `giao-viec` = nội dung `agy-orchestrator` đổi sang `worker-ask`), xoá `tools/agy/skills/`. Lý do: sau kế hoạch này không gì link `tools/agy/skills` nữa (install.sh thôi link vào `~/.claude/skills`, `bang-init` link đúng 3 skill), nên giữ lại là code chết; boss cần ngay hướng dẫn giao việc. Kế hoạch 4 viết lại `giao-viec` (mẫu 6 phần, review). `advisor` là thân tạm: luật hỏi của spec §13 + "lệnh lỗi hoặc chưa có → `blocked:` và dừng" (lệnh có ở Kế hoạch 5).
5. **`bang-init` điền ba chỗ trong bản chép**: `<tên dự án>` và `<tên>` = tên thư mục, `<folder>` = đường tuyệt đối. File trong `templates/` giữ nguyên văn spec. Các dòng ví dụ (T1, ghi chú W1, Bài học OCR) giữ nguyên; Kế hoạch 4 (lời mở đầu ghép Bài học vào mọi prompt) phải xử lý dòng Bài học ví dụ.
6. **`install.sh` không link `advisor`** (chưa có file; link sẽ treo). Vòng link chỉ link file có thật, nên Kế hoạch 5 thêm `tools/agy/bin/advisor` là đủ.
7. **`install.sh` gỡ thêm các link `~/.local/bin` khác trỏ vào `*/Vi-Habblaud/*`** (máy này: `agy-up`, `agy-mode`, `agy-sync`, `office_rules.py`, `rules-hook`; công cụ đã cắt, không có bản Bang_ver) **và `~/.claude/skills/office-rules`** (link vào Vi-Habblaud, skill nội quy đã cắt; nếu giữ, nó vào mọi `skills.json` và `~/.claude-worker/skills`). Phán quyết hiện tại nói "nothing else": hai mục này cần controller duyệt; nếu không duyệt, bỏ vòng gỡ tương ứng và các assert của nó ở Task 3, danh sách ở Task 9 bớt theo.
8. **`office-rules` trong profile là thư mục thật chứa 3 symlink** (Vi-Habblaud `tools/agy/install.sh:16–23` tạo vì agy bỏ qua plugin là symlink), không phải một link. Gỡ = xoá các symlink trong đó có đích chứa `/Vi-Habblaud/`, rồi `rmdir` chỉ khi thư mục rỗng; không bao giờ `rm -rf`. Còn file khác → để lại và in cảnh báo.
9. **`office.sh` không dùng file pid** (Kế hoạch 2: `$!` sau `setsid nohup … &` là pid của `setsid`). Không tham số = `start`, nên `npm run office` không đổi; `npm run office -- stop|restart`. `restart` build trước rồi mới dừng (build hỏng thì server cũ vẫn chạy). Log ở `${HABBLAUD_DATA_DIR:-$HOME/.habblaud}/office.log`.
10. **`package.json` không tỉa.** Ngoài danh sách §15 còn `dev:client`, `build:client`, `build:server` (bước con của `dev`/`build`) và `remote:setup`, `remote:mdns` (remote giữ theo §21, Kế hoạch 6).
11. **M7 sửa trong AgySource:** bảng việc ở phòng của `folder` nếu phòng đó có, nếu không thì phòng của nhân vật agy đầu tiên như cũ. Đội chỉ có Claude có bảng; `HABBLAUD_AGY=0` (không có AgySource, index.ts:76) vẫn không có bảng — ghi nhận, không sửa (máy người dùng luôn bật agy).
12. **Ghế Claude và skill:** `--worker` link ≈390 skill (thư mục có `SKILL.md` từ `skill-dirs`), không link 3 skill Bang_ver (chúng đến qua `<folder>/.claude/skills`, spec §8:118). Lần chạy lại xoá trước mọi symlink trong `~/.claude-worker/skills` trỏ vào `~/.claude/` (phiên bản plugin đổi thì đích cũ mất), không đụng thư mục thật hay link trỏ chỗ khác.

## Review Focus

1. **Test không được chạm nhà thật.** Test của `install.sh`/`bang-init` mà quên `HOME` tạm, hoặc để lọt `HABBLAUD_AGY_PROFILES`/`HABBLAUD_DATA_DIR` từ shell của người chạy, sẽ gỡ link thật của 8 profile hay ghi `~/.habblaud/team.json`. Mỗi test dựng env từ đầu (`env={"HOME": h, "PATH": os.environ["PATH"]}` + biến cần thiết). → Task 2, Task 3 (test `test_env_from_the_caller_is_not_used`).
2. **`team.json` không bao giờ hỏng hay bị tạo sai.** JSON hỏng → byte y nguyên, exit 1; folder khác → y nguyên; không có file → không tạo; ghi xong không còn file `.tmp`; các khoá khác và thứ tự khoá giữ nguyên; `HABBLAUD_DATA_DIR` chỉ toàn khoảng trắng → `~/.habblaud` như server. → Task 2.
3. **Phiên bản plugin mới nhất theo số, không theo chữ:** `1.10.0` thắng `1.2.0`; plugin không có `skills/` bị bỏ; `bang-init` chạy bên trong `agy-as` (HOME = `~/.agy_profiles/accN`) vẫn viết đường dẫn theo nhà thật. → Task 2.
4. **Gỡ chỉ đúng thứ của Vi-Habblaud.** Link `~/.local/bin` khác (`browser` → uv), file thường (`uv`), `GEMINI.md` của profile, plugin khác trong profile, skill thật trong `~/.claude/skills`, thư mục thật trong `~/.claude-worker/skills` đều y nguyên; chạy lại lần hai không gỡ gì. → Task 3.
5. **`office.sh stop` không giết nhầm server.** Server nghe cổng đó nhưng chạy từ thư mục khác (worktree vs repo chính) → từ chối, exit 1, server còn sống; 4747 luôn còn đúng 1 listener sau mọi bước. → Task 4 (sh -n), Task 8 Step 2 (chạy thật).

---

### Task 1: Thư mục `skills/` — `giao-viec`, `advisor`, `bang-task`; gộp `agy-orchestrator`

**Files:**
- Create: `skills/giao-viec/SKILL.md`, `skills/advisor/SKILL.md`, `skills/bang-task/SKILL.md`, `tools/agy/tests/test_skills.py`
- Delete: `tools/agy/skills/` (`git rm -r`; nội dung chuyển vào `skills/giao-viec/SKILL.md`)

**Interfaces:**
- Produces: `<repo>/skills/<name>/SKILL.md` với frontmatter `name: <name>` và `description:` không rỗng. Task 2 (`bang-init`) link đúng ba thư mục này và đưa `<repo>/skills` vào `skills.json`; Kế hoạch 4/5 thay thân `giao-viec`/`advisor`.

- [ ] **Step 1: Test (thất bại)** — `tools/agy/tests/test_skills.py`. Mọi file test mới của kế hoạch (Task 1–3) định nghĩa `REPO = os.path.realpath(os.path.join(HERE, "..", "..", ".."))` (realpath: script tính đường bằng `readlink -f`, so chuỗi với `..` sẽ sai):
```python
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
```
Run: `cd tools/agy && python3 -m pytest -q tests/test_skills.py` → FAIL (chưa có `skills/`).

- [ ] **Step 2: `giao-viec`** — `mkdir -p skills/giao-viec && git mv tools/agy/skills/agy-orchestrator/SKILL.md skills/giao-viec/SKILL.md`, rồi: frontmatter `name: giao-viec`, `description: Give jobs to the office's seats with worker-ask <seat> (Antigravity or Claude Code), check what a worker returned, run work in parallel. Use when the user asks to delegate/giao việc/chia việc, or before splitting project work among seats.`; tiêu đề `# giao-viec`; mọi `agy-ask`/`claude-ask` → `worker-ask` (hai dòng ví dụ ở :15–16 gộp một dòng `worker-ask <seat> "<prompt>" --role … --mode … --effort … [--model M] [--lean] [--cwd DIR] [--max 2000] [--timeout 900]`, ghi rằng `--model` chỉ cho ghế Claude); thêm một dòng đầu mục "Giving jobs": "One job = one row in task_board.md (create it first; see the bang-task skill)." Phần còn lại giữ nguyên (Kế hoạch 4 viết lại).

- [ ] **Step 3: `advisor` (thân tạm)** — đúng nội dung:
```markdown
---
name: advisor
description: For a worker seat - what to do when your job is unclear, contradictory or missing input; how to ask the boss with the advisor command.
---

# advisor

Use it when the prompt is vague, contradicts itself or the files, or an input it names is missing.

1. Read the "Ghi chú kỹ thuật" of task_board.md first: another seat may have solved it.
2. Ask ONE concrete question, with what you already tried: `advisor "<question> — tried: <what>"`. It waits for the boss's answer (up to 10 minutes) and prints it.
3. The command fails, is missing, or times out → write `blocked: <question>` in your row of task_board.md and STOP. Do not guess.
```

- [ ] **Step 4: `bang-task`** — thừa kế ý "đọc bảng việc trước, làm nốt việc dở" của `~/.codex/skills/bang_task/SKILL.md` (chỉ đọc), luật lấy từ spec §10 "Luật cho agent". Đúng nội dung:
```markdown
---
name: bang-task
description: Rules for reading and writing the office's task_board.md (task rows, statuses, technical notes, lessons). Use at the start of every job in a Bang_ver office and whenever you update your task row.
---

# bang-task

`task_board.md` in the office folder is the team's long-term memory and the channel between seats.
`project_proposal.md` holds the goal, scope and acceptance criteria.

## At the start of every job
1. Read task_board.md before anything else: "Bối cảnh", your rows in "Việc đang làm", "Ghi chú kỹ thuật", "Bài học".
2. A row of yours still `doing:` or `blocked:` from before: finish it first, or say in your report why not.
3. Read only the part of project_proposal.md your job points to.

## Who writes what
- A worker (`BANG_SLOT` is set): edit only the rows whose "Ai" is your seat; add rows to "Ghi chú kỹ thuật". Never create task rows, never write "Bài học", the review column or "Đã xong".
- The boss: creates task rows, writes the review (✅/❌) and "Bài học", moves rows to "Đã xong".
- "Hỏi đáp" is written by the advisor command, not by hand.

## A row's status
Exactly one of `todo` | `doing: <how far>` | `blocked: <what you need>` | `done`. Set "Cập nhật" to `MM-DD HH:MM` and update the "_Cập nhật lần cuối_" line with the time and your name.

## Technical notes
Solved something that was not obvious → one row: date, seat, problem, fix, `file:line`.

## Stuck
Read the other seats' technical notes first; still stuck → `advisor "<question>"`; no answer → `blocked: <question>` and STOP. Never guess.

## Housekeeping
Paths are relative to the office folder. Edit the tables in place, keep them valid Markdown, never delete another seat's row. Two seats may write in the same minute: re-read the file right before you write and change only your own line. More than 20 rows in "Đã xong" or "Bài học" (boss) → move the oldest to `task_board.archive.md`.
```

- [ ] **Step 5: Kiểm** — `cd tools/agy && python3 -m pytest -q tests` xanh; `grep -rn "tools/agy/skills" --include=*.sh --include=*.ts --include=*.py . | grep -v node_modules` → `0` dòng (`tools/agy/install.sh:14` link `"$here"/skills/*/`; Task 3 viết lại file đó). Kiểm chung (Global Constraints).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(skills): giao-viec, advisor and bang-task in skills/; agy-orchestrator folded into giao-viec"
```

---

### Task 2: Hai mẫu, `skill-dirs`, `bang-init`

**Files:**
- Create: `templates/task_board.md`, `templates/project_proposal.md` (nguyên văn hai khối của spec §10, dòng 148–182 và 188–200, không có dấu ``` bao ngoài, kết thúc bằng một `\n`), `tools/agy/bin/skill-dirs`, `tools/agy/bin/bang-init` (cả hai `chmod +x`), `tools/agy/tests/test_bang_init.py`

**Interfaces:**
- Consumes: `skills/{giao-viec,advisor,bang-task}` (Task 1).
- Produces:
  - `skill-dirs <home>` → stdout, mỗi dòng một thư mục có thật, theo thứ tự: `<home>/.claude/skills` (nếu là thư mục), rồi với mỗi `<home>/.claude/plugins/cache/<m>/<p>/` (sắp theo đường dẫn) thư mục `<phiên bản lớn nhất theo sort -V>/skills` nếu có. Exit 0 kể cả khi không in gì. Task 3 (`--worker`) dùng lại.
  - `bang-init <folder>`: exit 0 xong; exit 1 khi thiếu tham số (`usage: bang-init <folder>`) hoặc `team.json` có mà không đọc được (bước 1–3 vẫn đã làm). Không cần office chạy.
  - Quy tắc nhà và data dir (giống `worker-ask:33–45`): `home=$HOME`, nếu HOME khớp `*/.agy_profiles/<acc>` thì lấy phần trước `/.agy_profiles`; `data = (HABBLAUD_DATA_DIR.strip() or home + "/.habblaud")`; `team = data + "/team.json"`.
  - Repo = `$(dirname "$(readlink -f "$0")")/../../..` (chạy qua link `~/.local/bin/bang-init` vẫn đúng).
- Hành vi `bang-init <folder>`:
  1. `mkdir -p`, rồi `folder=$(cd "$1" && pwd -P)`; `name=$(basename "$folder")`. Chép `templates/task_board.md` và `templates/project_proposal.md` nếu file đích chưa có, thay `<tên dự án>`, `<tên>` → `name`, `<folder>` → `folder` (thay chuỗi trong Python, không sed).
  2. `.agents/skills.json` (ghi lại mỗi lần chạy): `{"entries": [{"path": d} for d in skill-dirs] + [{"path": "<repo>/skills"}]}`, `json.dumps(…, indent=2) + "\n"`. Có `<folder>/skills.list` → mỗi entry trừ entry `<repo>/skills` thêm `"include_only": [tên…]` (bỏ dòng trống và dòng `#`, strip). `.claude/skills/<n>` với n ∈ {giao-viec, advisor, bang-task}: `ln -sfn <repo>/skills/<n>` khi đích là symlink hoặc chưa có; đích là thư mục/file thật → để nguyên, in một dòng `left .claude/skills/<n>: not a link`.
  3. `CLAUDE.md` chưa có → tạo với đúng `Chạy /init để điền\n`. `GEMINI.md` chưa có (kể cả link treo thì coi là có) → `ln -s CLAUDE.md GEMINI.md` (link tương đối). `GEMINI.md` thật → để nguyên.
  4. `team.json`: không có → in `no <team> yet: start the office once (it writes team.json), then run bang-init again`; JSON hỏng hoặc không phải object → stderr `bang-init: <team> could not be read: …`, exit 1, byte y nguyên; `folder` thiếu hoặc `""` → đặt `folder`, ghi `<team>.bang-init.tmp` rồi `os.replace`, `json.dumps(t, indent=2, ensure_ascii=False) + "\n"`, in `office folder set in <team>`; `folder` == folder này → in `already the office folder`; khác → in `the office folder is <x>: edit <team> to change it`, không ghi.
  5. In bước tiếp theo (tiếng Anh): mở boss ở `<folder>` (nút ＋ cạnh Boss trên trang, hoặc `cd <folder> && claude`), chạy `/init`; điền `project_proposal.md`; giao việc với skill `giao-viec` (`worker-ask <seat> "…"`); boss agy: bảo nó viết `CLAUDE.md` như `/init`; nếu `<home>/.claude-worker` có: một lần `cd <folder> && CLAUDE_CONFIG_DIR=<home>/.claude-worker claude`, đăng nhập, tin cậy thư mục, `/exit` (spec §15: thiếu bước này mọi việc C1/C2 dừng ở TRUST_WAIT).
  Shortcut được phép: `# shortcut: …` cho mọi giới hạn biết trước. Mục tiêu ≈50 dòng tính cả khối Python; vượt 80 dòng là dấu hiệu làm thừa.

- [ ] **Step 1: Test (thất bại)** — `tools/agy/tests/test_bang_init.py`. Fixture: `h` = HOME tạm có `.claude/skills/own/SKILL.md`, `.claude/skills/learned/` (rỗng), cache `mk/plug/1.2.0/skills/a/SKILL.md`, `mk/plug/1.10.0/skills/a/SKILL.md`, `mk/bare/0.1.0/README` (không `skills/`); `d` = data dir tạm; `run(args, home=h, data=d)` gọi `tools/agy/bin/bang-init` với `env={"HOME": home, "PATH": os.environ["PATH"], "HABBLAUD_DATA_DIR": data}` (bỏ khoá nếu `data is None`). `team(obj)` ghi `d/team.json`.
```python
def test_skill_dirs_takes_the_newest_version_by_number():
    out = subprocess.run([SKILL_DIRS, h], capture_output=True, text=True).stdout.split()
    assert out == [f"{h}/.claude/skills", f"{h}/.claude/plugins/cache/mk/plug/1.10.0/skills"]

def test_fresh_folder_gets_templates_manifest_links_and_gemini():
    team({"folder": "", "boss": {"kind": "claude", "account": "default"}, "workers": []})
    code, out, err = run([proj])            # proj = tmp/new/proj, not created yet
    assert code == 0, err
    tb = read(proj, "task_board.md")
    assert tb.startswith("# Task board — proj\n") and f"_Office: {real(proj)} · Boss:" in tb
    assert read(proj, "project_proposal.md").startswith("# Đề xuất dự án — proj\n")
    assert json.load(open(f"{proj}/.agents/skills.json")) == {"entries": [
        {"path": f"{h}/.claude/skills"}, {"path": f"{h}/.claude/plugins/cache/mk/plug/1.10.0/skills"}, {"path": f"{REPO}/skills"}]}
    for n in ("giao-viec", "advisor", "bang-task"):
        assert os.readlink(f"{proj}/.claude/skills/{n}") == f"{REPO}/skills/{n}"
    assert os.readlink(f"{proj}/GEMINI.md") == "CLAUDE.md" and read(proj, "CLAUDE.md") == "Chạy /init để điền\n"
    assert "giao-viec" in out and "/init" in out

def test_second_run_keeps_what_the_user_wrote():
    # run, append "x" to task_board.md and CLAUDE.md, run again: exit 0, both files keep the "x", links unchanged

def test_skills_list_becomes_include_only_except_the_bang_skills():
    # proj/skills.list = "a\n# note\n\nown\n" -> every entry but {REPO}/skills has include_only == ["a", "own"]; that one has no include_only

def test_empty_folder_in_team_json_is_set_atomically():
    team({"folder": "", "boss": {"kind": "agy", "account": "acc1"}, "workers": [{"name": "W1", "kind": "agy", "account": "acc1"}]})
    run([proj])
    t = json.load(open(f"{d}/team.json"))
    assert list(t) == ["folder", "boss", "workers"] and t["folder"] == real(proj) and t["workers"][0]["name"] == "W1"
    assert os.listdir(d) == ["team.json"]

def test_another_office_folder_is_kept():           # folder = an existing other dir: bytes unchanged, that path in stdout
def test_missing_team_json_is_not_created():         # no d/team.json: exit 0, still absent, "start the office once" in stdout
def test_broken_team_json_is_left_alone():           # "{bad": exit 1, bytes unchanged, "team.json" in stderr; proj/.agents/skills.json exists
def test_blank_data_dir_means_home_habblaud():       # h/.habblaud/team.json pre-written with folder ""; HABBLAUD_DATA_DIR="   ": that file gets the folder
def test_inside_an_agy_profile_paths_use_the_real_home():  # HOME=h/.agy_profiles/acc1 (exists): skills.json paths start with h/.claude
def test_existing_gemini_file_and_real_skill_dir_are_left():  # GEMINI.md real file, .claude/skills/advisor real dir: both unchanged
def test_no_argument_prints_usage():                 # exit 1, "usage: bang-init <folder>" in stderr
```
(Thân các test có comment thì viết theo đúng comment.) Run: `cd tools/agy && python3 -m pytest -q tests/test_bang_init.py` → FAIL.

- [ ] **Step 2: Mẫu** — chép hai khối spec §10 vào `templates/`. Kiểm nguyên văn:
```bash
python3 - <<'EOF'
import re
spec = open("docs/superpowers/specs/2026-11-03-bang-ver-design.md", encoding="utf-8").read()
blocks = re.findall(r"```markdown\n(.*?)```", spec.split("## 10.")[1].split("## 11.")[0], re.S)
assert blocks[0] == open("templates/task_board.md", encoding="utf-8").read()
assert blocks[1] == open("templates/project_proposal.md", encoding="utf-8").read()
print("verbatim")
EOF
```
Expected: `verbatim`.

- [ ] **Step 3: Cài `skill-dirs` rồi `bang-init`** theo Interfaces.

- [ ] **Step 4: Kiểm**
Run: `cd tools/agy && python3 -m pytest -q tests && bash -n bin/bang-init bin/skill-dirs && wc -l bin/bang-init bin/skill-dirs`
Expected: xanh; ghi số dòng vào thông điệp commit. Kiểm chung.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(init): bang-init writes the board templates, the agy skill manifest, the skill links and the office folder"
```

---

### Task 3: `tools/install.sh` (thay `tools/agy/install.sh`), `--worker`

**Files:**
- Move + rewrite: `git mv tools/agy/install.sh tools/install.sh` (dòng 1–17 hiện tại viết lại hết)
- Create: `tools/agy/tests/test_install.py`

**Interfaces:**
- Consumes: `tools/agy/bin/{worker-ask,agy-as,bang-init,skill-dirs}`; quy tắc data dir của Task 2 (để in `cd <folder>`).
- Produces (CLI): `tools/install.sh [--worker]`; tham số khác → `usage: tools/install.sh [--worker]`, exit 1. Mỗi thay đổi in một dòng `linked <path>` / `removed <path>` / `left <path>: <why>`; chạy lại khi đã cài không in `removed`. Exit 0.
- Hành vi (env: `HOME`, `HABBLAUD_AGY_PROFILES` mặc định `$HOME/.agy_profiles`; dùng `if`, không `a && b` ở cuối thân vòng, vì `set -eu`):
  1. `~/.local/bin`: `ln -sfn` từ `tools/agy/bin/` cho mỗi file có thật trong `worker-ask agy-as bang-init advisor`; `agy-ask` → `worker-ask`, `claude-ask` → `worker-ask` (link tương đối).
  2. Mọi symlink còn lại trong `~/.local/bin` có `readlink` khớp `*/Vi-Habblaud/*` → xoá (Quyết định 7; comment một dòng: migration from Vi-Habblaud, harmless elsewhere).
  3. `~/.claude/skills/agy-orchestrator` và `~/.claude/skills/office-rules`: xoá nếu là symlink có đích khớp `*/Vi-Habblaud/*`; thư mục thật để nguyên. Không link gì vào `~/.claude/skills`.
  4. Mỗi `$root/acc*/.gemini/config/plugins/office-rules`: là symlink → xoá; là thư mục → xoá các symlink bên trong có đích khớp `*/Vi-Habblaud/*`, `rmdir` nếu rỗng, còn gì → `left <dir>: holds files the old installer did not make`. Không đụng gì khác trong profile.
  5. `--worker`: `w=$HOME/.claude-worker/skills`; `mkdir -p`; xoá mọi symlink trực tiếp trong `w` có đích bắt đầu bằng `$HOME/.claude/`; với mỗi thư mục con `s` (có `SKILL.md`) của từng dòng `skill-dirs "$HOME"`: `w/<tên>` đã có → `left …: already there`, không thì `ln -s`. In `linked <N> skills into <w>` rồi lệnh đăng nhập `cd <folder> && CLAUDE_CONFIG_DIR=$HOME/.claude-worker claude` (folder lấy từ `team.json` bằng một dòng `python3 -c`, không có thì `<office folder>`) kèm "sign in with the same account, trust the folder, then /exit".
  6. Cuối: `case ":$PATH:"` như cũ → `Add ~/.local/bin to your PATH.`

- [ ] **Step 1: Test (thất bại)** — `tools/agy/tests/test_install.py`. Fixture HOME tạm `h`, `vi = <tmp>/Vi-Habblaud/tools/agy` có file `bin/{agy-as,worker-ask,agy-up,rules-hook}`, `agy-plugin/office-rules/{hooks.json,plugin.json,rules-hook}`, `skills/{agy-orchestrator,office-rules}/SKILL.md`. Trong `h`:
  - `.local/bin`: `agy-as`→`vi/bin/agy-as`, `agy-ask`→`vi/bin/worker-ask`, `claude-ask`→`agy-ask`, `agy-up`→`vi/bin/agy-up`, `rules-hook`→`vi/bin/rules-hook`, `uv` (file thường `x`), `browser`→`/opt/else/browser`.
  - `.claude/skills`: `agy-orchestrator`, `office-rules` → thư mục tương ứng trong `vi`; `mine/SKILL.md` thật.
  - `.agy_profiles/acc1/.gemini/{GEMINI.md (file "rules"), config/plugins/office-rules/<3 link vào vi/agy-plugin/office-rules>, config/plugins/other/plugin.json}`; `acc2` như acc1 phần office-rules, thêm file thường `office-rules/notes.txt`.
  - cache `.claude/plugins/cache/mk/plug/{1.2.0,1.10.0}/skills/{a,b}/SKILL.md`.
  - `run(*args, env_extra={})`: `subprocess.run(["bash", f"{REPO}/tools/install.sh", *args], env={"HOME": h, "PATH": f"{h}/.local/bin:" + os.environ["PATH"], **env_extra})`.
```python
def test_links_point_to_this_repo():
    assert run()[0] == 0
    for n in ("worker-ask", "agy-as", "bang-init"):
        assert os.readlink(f"{h}/.local/bin/{n}") == f"{REPO}/tools/agy/bin/{n}"
    for n in ("agy-ask", "claude-ask"):
        assert os.path.realpath(f"{h}/.local/bin/{n}") == os.path.realpath(f"{REPO}/tools/agy/bin/worker-ask")
    assert not os.path.lexists(f"{h}/.local/bin/advisor")

def test_vi_habblaud_leftovers_go_and_nothing_else():
    code, out, _ = run()
    for n in ("agy-up", "rules-hook"): assert not os.path.lexists(f"{h}/.local/bin/{n}")
    assert open(f"{h}/.local/bin/uv").read() == "x" and os.readlink(f"{h}/.local/bin/browser") == "/opt/else/browser"
    assert not os.path.lexists(f"{h}/.claude/skills/agy-orchestrator") and not os.path.lexists(f"{h}/.claude/skills/office-rules")
    assert os.path.isfile(f"{h}/.claude/skills/mine/SKILL.md")
    assert not os.path.lexists(f"{h}/.agy_profiles/acc1/.gemini/config/plugins/office-rules")
    assert os.listdir(f"{h}/.agy_profiles/acc2/.gemini/config/plugins/office-rules") == ["notes.txt"]
    assert "left" in out and "acc2" in out
    assert open(f"{h}/.agy_profiles/acc1/.gemini/GEMINI.md").read() == "rules"
    assert os.path.isfile(f"{h}/.agy_profiles/acc1/.gemini/config/plugins/other/plugin.json")
    assert not os.path.exists(f"{h}/.claude-worker")

def test_second_run_removes_nothing():
    run(); code, out, _ = run()
    assert code == 0 and "removed" not in out

def test_env_from_the_caller_is_not_used():
    # HABBLAUD_AGY_PROFILES=<tmp>/other-profiles (with an acc9 office-rules folder of Vi links): that one goes, h's acc1 stays
    # (proves the root comes from the variable, so tests must always set it or drop it)

def test_worker_links_every_skill_once_and_prints_the_login():
    team = {"folder": f"{h}/proj"}; os.makedirs(f"{h}/.habblaud"); json.dump(team, open(f"{h}/.habblaud/team.json", "w"))
    code, out, _ = run("--worker")
    w = f"{h}/.claude-worker/skills"
    assert sorted(os.listdir(w)) == ["a", "b", "mine"]
    assert os.readlink(f"{w}/a") == f"{h}/.claude/plugins/cache/mk/plug/1.10.0/skills/a"
    assert f"cd {h}/proj && CLAUDE_CONFIG_DIR={h}/.claude-worker claude" in out

def test_worker_rerun_follows_a_plugin_update_and_keeps_real_folders():
    # run --worker; add cache .../1.11.0/skills/{a,b}/SKILL.md; make w/own a real dir; run --worker again:
    # w/a and w/b -> 1.11.0, no link in w is dangling, w/own is still a real dir, mine still linked

def test_unknown_argument_is_refused():               # run("--nope"): exit 1, "usage" in stderr, h/.local/bin not created
```
Run: `cd tools/agy && python3 -m pytest -q tests/test_install.py` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; comment đầu file nói nó làm gì và nó gỡ gì của Vi-Habblaud.

- [ ] **Step 3: Kiểm**
Run: `cd tools/agy && python3 -m pytest -q tests && bash -n ../install.sh`
Expected: xanh. Kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(install): tools/install.sh links worker-ask, agy-as and bang-init, removes the Vi-Habblaud leftovers; --worker links the skills for ~/.claude-worker"
```

---

### Task 4: `scripts/office.sh start|stop|restart`

**Files:**
- Modify: `scripts/office.sh` (dòng 1–16, viết lại)

**Interfaces:**
- Produces (CLI): `sh scripts/office.sh [start|stop|restart]` (`npm run office`, `npm run office -- stop|restart`); tham số khác → `usage: office.sh [start|stop|restart]`, exit 1. `port=${HABBLAUD_PORT:-4747}`, `log=${HABBLAUD_DATA_DIR:-$HOME/.habblaud}/office.log`.
  - `start`: như :8–16 hiện tại (đang chạy → `The office is already running: <url>`, exit 0; else build, khởi động `HABBLAUD_PTY=1 setsid nohup node dist/server/index.js`, in url và log).
  - `stop`: `pid` = pid đầu tiên trong `ss -Hltnp "sport = :$port"`; không có → `The office is not running on port <port>`, exit 0. Từ chối (exit 1, `port <port> belongs to another server (pid <pid>, <cwd>): not stopped`) trừ khi `readlink /proc/$pid/cwd` = `pwd -P` của repo và `/proc/$pid/cmdline` (NUL → space) kết thúc bằng `dist/server/index.js`. Đúng thì `kill $pid` (TERM; server có `shutdown` ở index.ts:464), chờ tối đa 10 s tới khi cổng hết nghe; còn nghe → exit 1 với pid.
  - `restart`: `npm run build --silent` trước; build lỗi → exit khác 0, server cũ không bị đụng; rồi `stop` (lỗi → dừng), rồi phần khởi động của `start` (không build lại).
- Không file pid; không `pkill`.

- [ ] **Step 1: Viết** theo Interfaces (hàm sh `running`, `stop_office`, `launch`).

- [ ] **Step 2: Kiểm tĩnh**
Run: `sh -n scripts/office.sh && grep -c "pkill\|killall" scripts/office.sh`
Expected: `0`. Không chạy script trong repo chính (nó build). Hành vi kiểm ở Task 8 Step 1–2 trong worktree.
Run (chỉ đọc, xác nhận điều kiện nhận diện khớp server thật): `p=$(ss -Hltnp 'sport = :4747' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); readlink /proc/$p/cwd; tr '\0' ' ' < /proc/$p/cmdline`
Expected: `/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver` và `node dist/server/index.js ` (khoảng trắng cuối do NUL cuối: script phải bỏ nó trước khi so).

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(office): office.sh start|stop|restart; stop only touches this repo's server on its port"
```

---

### Task 5: Server — bảng việc ở phòng `folder` (M7), xoá ghế báo đúng lý do (M8), đổi boss đóng terminal boss agy cũ (M9)

**Files:**
- Modify: `server/sources/agy/source.ts` (`publishBoard` :455–458; import `normalizeCwd` từ `../../model/rooms`), `server/sources/agy/source.test.ts` (một `it` mới), `server/workers/service.ts` (`cancel` :318–328; `sync` :353–357), `server/workers/service.test.ts` (một `it` mới, theo mẫu :481), `server/team.ts` (hàm thuần mới), `server/team.test.ts` (một `it` mới), `server/index.ts` (`onChange` của `TeamService` :96–99), `shared/locales/vi.ts` (khoá mới)

**Interfaces:**
- Produces:
  - `AgySource.publishBoard`: `roomId` = `this.opts.office.roomList().find((r) => normalizeCwd(r.path) === this.opts.folder())?.id` khi `folder()` khác rỗng, nếu không có thì phòng của nhân vật đầu tiên trong `shown` như cũ.
  - `WorkerService.cancel(p: { job?: string; worker?: string; all?: boolean }, reason: string = tr('cancelled by you')): number`; `sync` gọi `this.cancel({ worker: id }, tr('{0} was removed from team.json while this job ran', [s.t.name]))`.
  - `server/team.ts`: `export function staleAgyBosses(open: readonly Pick<PtyInfo, 'agentId' | 'exitedAt'>[], boss: TeamFile['boss']): string[]` — các `agentId` bắt đầu bằng `agy-boss:`, chưa `exitedAt`, khác `agyBossId(boss.account)` khi `boss.kind === 'agy'` (khi boss là Claude: mọi `agy-boss:*` đang mở).
  - `index.ts` `onChange`: thêm `for (const id of staleAgyBosses(late.ptys?.list() ?? [], team.boss)) late.ptys?.closeAgent(id);` (`ptys` khai báo ở :167, sau `team`; dùng holder `late` sẵn có ở :50 như `late.workers`).
  - `vi.ts`: `"{0} was removed from team.json while this job ran": "{0} đã bị xoá khỏi team.json khi việc này đang chạy"`.

- [ ] **Step 1: Test (thất bại)**
```ts
// source.test.ts
it('a Claude-only team: a terminal job shows on the board of the folder room', () => {
  const t = setup([], { folder: '/w/ocr' });
  t.source.setTeam([]);
  t.office.addMain({ id: 'claude-worker:C1', account: '.claude-w', sessionId: 'claude-worker:C1', cwd: '/w/ocr', role: 'Worker', name: 'C1', startedAt: 1, status: 'idle' });
  t.source.upsertJob({ id: 'claude-worker:C1#j1', agentId: 'claude-worker:C1', worker: 'C1', text: 'one', status: 'working', at: 1 });
  expect(t.office.commit().snapshot.rooms.find((r) => r.id === '/w/ocr')?.board?.items.map((i) => i.worker)).toEqual(['C1']);
});
// service.test.ts
it('removing a seat in team.json ends its job naming team.json, not "cancelled by you"', async () => {
  const t = setup(['W1', 'W2']);
  await t.svc.ask({ worker: 'W2', prompt: 'two' });
  t.retarget(() => [{ id: 'W1', kind: 'agy', agentId: 'agy:acc2', account: 'agy:acc2', name: 'W1', acc: 'acc2', stateDir: t.stateDir }]);
  t.svc.sync();
  expect(t.svc.jobs()[0].error).toContain('team.json');
  expect(t.svc.jobs()[0].error).not.toContain('cancelled by you');
  expect([...t.open.keys()]).toEqual([]);
});
// team.test.ts
it('staleAgyBosses: the old agy boss terminal goes when boss.kind or boss.account changes', () => {
  const open = [{ agentId: 'agy-boss:acc1' }, { agentId: 'agy-boss:acc2', exitedAt: 5 }, { agentId: 'claude-worker:C1' }];
  expect(staleAgyBosses(open, { kind: 'claude', account: 'default' })).toEqual(['agy-boss:acc1']);
  expect(staleAgyBosses(open, { kind: 'agy', account: 'acc1' })).toEqual([]);
  expect(staleAgyBosses(open, { kind: 'agy', account: 'acc3' })).toEqual(['agy-boss:acc1']);
});
```
(Nếu `setup` của source.test.ts không nhận `[]`, dùng `setup(['acc2'], { folder: '/w/ocr' })` rồi `setTeam([])`.)
Run: `npx vitest run server/sources/agy/source.test.ts server/workers/service.test.ts server/team.test.ts` → 3 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — ba test xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "fix(seats): the job board lives in the folder room, a removed seat's job says team.json, a boss switch closes the old agy boss terminal"
```

---

### Task 6: Dọn code chết và chữ cũ (M4, "registered worker", "＋ Worker")

**Files:**
- Modify:
  - `client/src/ui/workers-api.ts` (xoá `workerKind` :59–61 và `sessionOf` :68–70), `client/src/ui/workers-api.test.ts` (bỏ import `workerKind` :3; helper `session` :5–11 lấy `kind: 'agy'`; xoá `it('kind from the worker id')` :14–17)
  - `shared/types.ts` (:368 comment team → `server/team.ts, <dataDir>/team.json: the seats`; :369–372 `WorkerId` → "Worker id: a seat name from team.json (e.g. "W1")"; :397, :446, :460 "registered workers" → "seats")
  - `client/src/ui/agy-panel.ts:6` ("every registered worker" → "every seat"; `POST /api/agy/jobs … agy-ask` → `worker-ask <seat>`), `client/src/ui/model.ts:445` ("registered workers" → "seats")
  - `server/workers/service.ts:1`, `:107`, `:334`, `server/index.ts:186` ("registered worker(s)" → "seat(s)")
  - `client/src/world/render/overlay.ts` (bỏ chữ gợi ý: `BUILDING_HINT_FONT` :43, comment :647–648 phần "＋ Boss / ＋ Worker", `hint`/`sub` :666–669, khối `if (sub)` :683–687; khung luôn cao 22), `shared/locales/vi.ts:1187` (xoá khoá `Empty: ＋ Boss / ＋ Worker`)

- [ ] **Step 1: Sửa** theo danh sách (số dòng của HEAD aa3cb17; dò lại bằng grep ở Step 2).

- [ ] **Step 2: Kiểm sạch**
Run: `grep -rn "registered worker\|workerKind\|＋ Worker\|claude:<\|BUILDING_HINT_FONT" server shared client/src tools --include=*.ts | wc -l`
Expected: `0`.
Run: `grep -rn "\bsessionOf(" client/src --include=*.ts | grep -v agentorder | wc -l` → `0`.
Kiểm chung (i18n phải 0/0 sau khi xoá khoá).

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "chore(seats): drop dead worker helpers, the unreachable '+ Worker' sign and the 'registered worker' wording"
```

---

### Task 7: Tài liệu và CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (mục `## [Unreleased]`, dòng 9–), `README.md` (:73–74 cài đặt; bước 2 :89–110 thêm `bang-init`; :114 bước 4; :121–139 "Run it every day"; bảng :163, :165), `tools/agy/README.md` (:9–17 cài đặt; bảng :30–35), `CLAUDE.md` và `AGENTS.md` (một câu: a project gets its office files with `bang-init <folder>`; the office's own skills live in `skills/`)

- [ ] **Step 1: CHANGELOG** — `### Added`: `skills/` với `giao-viec`, `advisor` (tạm), `bang-task`; `bang-init <folder>` (mẫu `task_board.md`/`project_proposal.md`, `.agents/skills.json` cho agy với phiên bản plugin mới nhất, `skills.list` → `include_only`, 3 link `.claude/skills`, `GEMINI.md` → `CLAUDE.md`, đặt `folder` khi office chưa có); `tools/install.sh --worker`; `npm run office -- stop|restart`. `### Changed`: `tools/install.sh` thay `tools/agy/install.sh`, link thêm `bang-init`, gỡ phần Vi-Habblaud để lại (link `~/.local/bin`, `agy-orchestrator`/`office-rules` trong `~/.claude/skills`, plugin `office-rules` trong profile agy) và không còn link skill vào `~/.claude/skills`; bảng việc ở phòng của `folder` (cả đội chỉ có Claude); xoá ghế khi đang có việc → việc báo `team.json`; đổi boss trong `team.json` đóng terminal boss agy cũ. `### Removed`: skill `agy-orchestrator` (nay là `giao-viec`).

- [ ] **Step 2: README** — cài đặt: `npm install && npm run build && npm run office`, `tools/install.sh` (và `tools/install.sh --worker` nếu ghế Claude dùng `~/.claude-worker`); bước mới "Start a project: `bang-init <folder>`" (nó làm gì, `skills.list`, chạy lại khi plugin lên phiên bản); "Run it every day": thay lệnh `kill "$(ss …)"` bằng `npm run office -- restart` / `npm run office -- stop`, giữ câu "sessions in the page's terminals end too"; bảng: "The skills of the office" → `skills/`, "Project templates" → `templates/`. Không còn chữ `tools/agy/install.sh`, `tools/agy/skills`.

- [ ] **Step 3: Kiểm**
Run: `grep -rn "tools/agy/install.sh\|tools/agy/skills\|agy-orchestrator" README.md tools/agy/README.md CLAUDE.md AGENTS.md CONTRIBUTING.md | wc -l`
Expected: `0`. Kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "docs: bang-init, skills/, tools/install.sh and office.sh stop/restart"
```

---

### Task 8: Nghiệm thu trên cổng 4749 (spec §17 phần Kế hoạch 3 mở được, bước 7, bước 8)

**Files:**
- Ngoài repo: worktree `~/bang-ver-accept`, `~/bang-test-office/` (dự án thử của Kế hoạch 2), `~/.bang-test-data/` (data dir thử, đã có `team.json` của Kế hoạch 2: W1, W2 agy acc1; C1, C2 claude worker; folder `~/bang-test-office`)
- Modify: cuối file kế hoạch này, mục `## Kết quả`

Server thử chạy từ worktree; `bang-init` và `worker-ask` chạy từ **repo chính** (`skills.json` phải trỏ `…/Bang_ver/skills`, không trỏ worktree sắp xoá). Trong mọi bước: `B=/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver; export HABBLAUD_DATA_DIR=$HOME/.bang-test-data HABBLAUD_URL=http://127.0.0.1:4749`.

- [ ] **Step 1: Worktree, build, start bằng `office.sh`**
```bash
cd $B && git worktree add ~/bang-ver-accept HEAD
cd ~/bang-ver-accept && ln -s $B/node_modules node_modules
HABBLAUD_PORT=4749 sh scripts/office.sh start; sleep 8
pid=$(ss -Hltnp 'sport = :4749' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); echo $pid
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4749/
HABBLAUD_PORT=4749 sh scripts/office.sh start      # again
sleep 60; ps -o rss= -p $pid                         # idle RSS, no job yet
```
Expected: build xong, `200`, lần start thứ hai in `already running`, log `~/.bang-test-data/office.log` không có stack trace; RSS ≤ 112640 kB (cổng phản mục tiêu; Kế hoạch 2: 108876). Build lỗi vì link `node_modules` → `rm node_modules && npm ci --prefer-offline` trong worktree.

- [ ] **Step 2: `stop` chỉ dừng server của chính nó**
```bash
cd $B && HABBLAUD_PORT=4749 sh scripts/office.sh stop; echo "exit=$?"; ss -Hltn 'sport = :4749' | wc -l
cd ~/bang-ver-accept && HABBLAUD_PORT=4749 sh scripts/office.sh restart; sleep 8; ss -Hltnp 'sport = :4749'
ss -Hltn 'sport = :4747' | wc -l
```
Expected: lệnh từ repo chính in `belongs to another server`, `exit=1`, 4749 còn `1`; `restart` từ worktree: build, dừng, chạy lại với pid mới; 4747 còn `1`.

- [ ] **Step 3: `bang-init` trên dự án thử**
```bash
printf 'systematic-debugging\n' > ~/bang-test-office/skills.list
$B/tools/agy/bin/bang-init ~/bang-test-office; echo "exit=$?"
ls -la ~/bang-test-office ~/bang-test-office/.claude/skills; cat ~/bang-test-office/.agents/skills.json
```
Expected: exit 0; `task_board.md`, `project_proposal.md` (tên `bang-test-office`), `CLAUDE.md` ("Chạy /init để điền"), `GEMINI.md -> CLAUDE.md`, 3 link vào `$B/skills`; `skills.json` có `/home/nhatbang/.claude/skills`, 5 entry plugin (ecc 2.2.3, impeccable 4.6.0, ponytail 5.3.2, superpowers 7.0.0, claude-mem 13.41.0) mỗi cái `include_only: ["systematic-debugging"]`, và `$B/skills` không `include_only`; stdout `already the office folder`. Chạy lại lần hai: cùng kết quả, mẫu không bị ghi đè.
Ghi đường đặt folder (bằng data dir tạm, không đụng `~/.bang-test-data/team.json`):
```bash
t=$(mktemp -d); printf '{"folder": "", "boss": {"kind": "claude", "account": "default"}, "workers": []}\n' > $t/team.json
HABBLAUD_DATA_DIR=$t $B/tools/agy/bin/bang-init ~/bang-test-office && cat $t/team.json; rm -r $t
```
Expected: `"folder": "/home/nhatbang/bang-test-office"`.

- [ ] **Step 4: Việc agy thấy skill dự án**
```bash
cd ~/bang-test-office
$B/tools/agy/bin/worker-ask W1 "List the names of every skill you have, comma-separated, nothing else." --mode plan --timeout 300
```
Expected: có `giao-viec`, `advisor`, `bang-task`, `systematic-debugging`; không có `gsap-core`, `writing-plans`, `brainstorming` (đã lọc). Skill riêng của profile acc1 (`~/.gemini/config/skills`: ponytail, ponytail-review, test-driven-development, verification-before-completion) có thể xuất hiện — đúng như spec §8. Ghi token đầu vào nếu log có (so với 26 830 của spec với 40 skill).

- [ ] **Step 5: Ghế Claude thấy 3 skill (nếu người dùng đã đăng nhập `~/.claude-worker`)**
```bash
$B/tools/agy/bin/worker-ask C1 "Do you have skills named giao-viec, advisor and bang-task? Answer yes/no for each, one line." --timeout 300
```
Expected: ba `yes`. Chưa đăng nhập hoặc chưa tin cậy thư mục → lỗi nhanh; ghi "chờ người dùng", không coi là lỗi.

- [ ] **Step 6: Bước 7 — headless vẫn chạy khi office tắt**
```bash
HABBLAUD_URL=http://127.0.0.1:9 $B/tools/agy/bin/worker-ask W1 "Trả lời đúng một dòng: H-OK" --mode plan --timeout 300; echo "exit=$?"
```
Expected: `H-OK`, `exit=0`.

- [ ] **Step 7: Bước 8 — test, giới hạn dòng**
```bash
cd $B && npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)
git diff --shortstat aa3cb17..HEAD -- server client shared tools scripts ':!*.test.ts' ':!tools/agy/tests'
```
Expected: xanh (trừ flaky); dòng thêm ròng (insertions − deletions) của code không-test ≤ +300. Ghi số test và số dòng.

- [ ] **Step 8: Dọn và ghi kết quả**
```bash
cd ~/bang-ver-accept && HABBLAUD_PORT=4749 sh scripts/office.sh stop; ss -Hltn 'sport = :4749' | wc -l; ss -Hltn 'sport = :4747' | wc -l
cd $B && git worktree remove --force ~/bang-ver-accept
```
Expected: `0` rồi `1`. Giữ `~/bang-test-office` (giờ có file của `bang-init`, `skills.list`) và `~/.bang-test-data` cho Kế hoạch 4–5. Ghi vào `## Kết quả`: RSS, kết quả Step 1–7, token Step 4, điều còn chờ người dùng.
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 3 acceptance results"
```

---

### Task 9: Cài thật trên máy người dùng, rồi hỏi người dùng khởi động lại office 4747

**Files:**
- Ngoài repo (chỉ task này): `~/.local/bin`, `~/.claude/skills/{agy-orchestrator,office-rules}`, `~/.agy_profiles/acc1..8/.gemini/config/plugins/office-rules`, `~/.claude-worker/skills`
- Modify: mục `## Kết quả` của file này

`o=$HOME/.bang-test-data/install; mkdir -p $o`.

- [ ] **Step 1: Ảnh trước**
```bash
ls -la ~/.local/bin > $o/bin.before; ls -la ~/.claude/skills > $o/skills.before
for i in 1 2 3 4 5 6 7 8; do echo "== acc$i"; ls -la ~/.agy_profiles/acc$i/.gemini/config/plugins/ ~/.agy_profiles/acc$i/.gemini/config/plugins/office-rules 2>&1; done > $o/plugins.before
md5sum ~/.agy_profiles/acc*/.gemini/GEMINI.md > $o/gemini.md5; ls -la ~/.claude-worker > $o/worker.before 2>&1
```

- [ ] **Step 2: Chạy**
```bash
/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver/tools/install.sh --worker | tee $o/install.out; echo "exit=${PIPESTATUS[0]}"
```
Expected: `exit=0`.

- [ ] **Step 3: Ảnh sau và đối chiếu**
```bash
ls -la ~/.local/bin > $o/bin.after; ls -la ~/.claude/skills > $o/skills.after
for i in 1 2 3 4 5 6 7 8; do echo "== acc$i"; ls -la ~/.agy_profiles/acc$i/.gemini/config/plugins/ 2>&1; done > $o/plugins.after
diff <(awk '{print $9,$10,$11}' $o/bin.before) <(awk '{print $9,$10,$11}' $o/bin.after)
diff <(awk '{print $9,$10,$11}' $o/skills.before) <(awk '{print $9,$10,$11}' $o/skills.after)
md5sum -c $o/gemini.md5; ls ~/.claude-worker/skills | wc -l; find ~/.claude-worker/skills -xtype l | wc -l
```
Expected, và không gì khác:
- `~/.local/bin`: `agy-as`, `agy-ask`, `claude-ask` đổi đích sang Bang_ver (`agy-ask`, `claude-ask` → `worker-ask`); thêm `worker-ask`, `bang-init`; mất `agy-up`, `agy-mode`, `agy-sync`, `office_rules.py`, `rules-hook` (Quyết định 7). `agy`, `uv`, `browser*`, `claude-mem`, `hermes`… y nguyên.
- `~/.claude/skills`: mất `agy-orchestrator` và `office-rules` (Quyết định 7); 31 mục còn lại y nguyên.
- 8 profile: không còn `office-rules` trong `config/plugins/` (nếu có dòng `left`, chép vào Kết quả); `md5sum -c` toàn `OK`.
- `~/.claude-worker/skills`: 389 link (391 − 2 skill đã gỡ), `0` link treo.

- [ ] **Step 4: Kiểm sau cài**
```bash
command -v worker-ask bang-init; readlink -f "$(command -v agy-ask)"
HABBLAUD_DATA_DIR=$HOME/.bang-test-data HABBLAUD_URL=http://127.0.0.1:9 worker-ask W1 "Trả lời đúng một dòng: I-OK" --mode plan --timeout 300; echo "exit=$?"
```
Expected: `~/.local/bin/…`; `…/Bang_ver/tools/agy/bin/worker-ask`; `I-OK`, `exit=0`. (`worker-ask team` không có `HABBLAUD_DATA_DIR` sẽ báo chưa có `~/.habblaud/team.json` cho tới khi 4747 chạy bản mới: đúng.)

- [ ] **Step 5: Ghi kết quả và commit**
Ghi vào `## Kết quả` danh sách thay đổi đúng như diff Step 3 và output Step 4.
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 3 install on the user's machine"
```

- [ ] **Step 6: Hỏi người dùng (controller gửi, không tự làm)**
Gửi nguyên văn ý sau rồi dừng kế hoạch:
> `~/.local/bin` giờ trỏ về Bang_ver. Office 4747 của bạn vẫn chạy bản build Kế hoạch 1, không hiểu tên ghế: `worker-ask` mới gửi việc vào nó sẽ thất bại cho tới khi khởi động lại. Khi tiện (mọi terminal trong trang, kể cả boss, sẽ đóng; phiên Claude mở lại bằng `claude --resume`):
> ```bash
> cd /home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver && npm run office -- restart
> ```
> Lần đầu, server mới nhập `~/.agy_profiles/team.json` (7 ghế agy `acc1`…`acc7`, folder rỗng) vào `~/.habblaud/team.json`: sửa tên/ghế theo ý, rồi `bang-init <thư mục dự án>` để đặt folder. Ghế Claude: một lần `cd <thư mục dự án> && CLAUDE_CONFIG_DIR=~/.claude-worker claude` (đăng nhập cùng tài khoản, tin cậy thư mục, `/exit`).

---

## Tự kiểm sau khi viết

Spec §8:
- Nguồn ≈390 skill (`~/.claude/skills` + phiên bản plugin mới nhất): Task 2 (`skill-dirs`), Task 3 (`--worker`).
- agy nạp qua `.agents/skills.json`, đường dẫn tuyệt đối, không symlink trong dự án: Task 2; kiểm thật Task 8 Step 4.
- Claude không đọc `.agents/skills/` → 3 link `<folder>/.claude/skills`: Task 2; `--worker` link ≈390 vào `~/.claude-worker/skills`, không link 3 skill riêng: Task 3 (Quyết định 12).
- Tính phiên bản mới nhất lúc chạy, chạy lại khi đổi: Task 2 (test `1.10.0`), Task 3 (test cập nhật plugin).
- `skills.list` → `include_only`: Task 2 (Quyết định 3); kiểm thật Task 8 Step 3–4.
- Ba skill riêng `giao-viec`, `advisor`, `bang-task` (thừa kế `~/.codex/skills/bang_task`): Task 1.

Spec §9: bước 1 (tạo folder, chép mẫu) Task 2; bước 2 (skills.json, 3 link) Task 2; bước 3 (`GEMINI.md` → `CLAUDE.md`, "Chạy /init để điền") Task 2; bước 4 (`folder` khi chưa có office, tmp+rename, cùng quy tắc đường) Task 2 (Quyết định 1, 2); bước 5 (in hướng dẫn, boss agy) Task 2; "chạy lại an toàn" Task 2 test lần hai.

Spec §10: hai mẫu nguyên văn Task 2 Step 2 (kiểm bằng script so với spec).

Spec §15:
- `tools/install.sh` link `worker-ask` (+ `agy-ask`, `claude-ask`), `agy-as`, `bang-init` vào `~/.local/bin`, ghi đè link Vi-Habblaud: Task 3, chạy thật Task 9. `advisor`: để Kế hoạch 5 (Quyết định 6).
- Gỡ `~/.claude/skills/agy-orchestrator`: Task 3, Task 9. Không đụng `~/.claude/skills` khác: Task 3 test (trừ `office-rules`, Quyết định 7 chờ duyệt).
- `--worker` + lệnh đăng nhập chạy trong `<folder>` và tin cậy thư mục: Task 3; nhắc lại ở `bang-init` (Task 2) và bước hỏi người dùng (Task 9 Step 6).
- `npm install && npm run build && npm run office`, `office.sh start|stop|restart`: Task 4, kiểm Task 8 Step 1–2; docs Task 7.
- `package.json` còn các script của §15: Quyết định 10.
- systemd unit tuỳ chọn: không làm (người dùng chưa yêu cầu).

Phán quyết người dùng/controller: 8 thư mục `office-rules` (chỉ link) Task 3, Task 9 (Quyết định 8); `~/.claude-worker` Task 3, Task 9; quy tắc đường `team.json` Task 2; nghiệm thu 4749 + pid bằng `ss` Task 8; một task cài thật có ảnh trước/sau Task 9; hỏi người dùng khởi động lại 4747 Task 9 Step 6; `office.sh stop` không `pkill` Task 4.

Spec §17: phần Kế hoạch 3 mở được (`bang-init` ghi đúng file, việc agy thấy skill dự án) Task 8 Step 3–5; bước 7 (headless) Task 8 Step 6, Task 9 Step 4; bước 8 (test, RSS) Task 8 Step 1, 7. Bước 2–6 còn lại thuộc Kế hoạch 2/4/5.

Backlog Kế hoạch 2: M4 Task 6; M7 Task 5 (Quyết định 11); M8 Task 5; M9 Task 5; "registered worker", "＋ Worker" Task 6; `bang-init` tmp+rename và quy tắc đường thứ ba Task 2; `install.sh` thôi link `~/.claude/skills` và gỡ 8 plugin Task 3; pid bằng `ss` Task 8; đo lại RSS Task 8 Step 1. Để lại: M2 (Kế hoạch 5), chờ người dùng đăng nhập `~/.claude-worker` / tin cậy thư mục, test flaky (trước khi ký v1).

## Kết quả

### Task 9 — cài thật

Chạy `tools/install.sh --worker` từ `/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver` đúng một lần: `exit=0`, không có dòng `left`. Ảnh trước/sau ở `~/.bang-test-data/install/` (`*.before`, `*.after`, `install.out`, `step4.out`). Cổng 4747: 1 listener trước và sau, không đụng tới.

- `~/.local/bin`, đổi đích sang Bang_ver: `agy-as`; `agy-ask` và `claude-ask` → `worker-ask` (link tương đối). Thêm: `worker-ask`, `bang-init`. Mất: `agy-mode`, `agy-sync`, `agy-up`, `office_rules.py`, `rules-hook`. Phần còn lại y nguyên. Không có link treo.
- `~/.claude/skills`: mất `agy-orchestrator`, `office-rules`; các mục khác y nguyên.
- 8 profile `acc1..8`: gỡ 3 link (`hooks.json`, `plugin.json`, `rules-hook`) rồi `rmdir` thư mục `config/plugins/office-rules`; `md5sum -c` 8/8 `OK` (GEMINI.md không đổi).
- `~/.claude-worker/skills`: 389 link, 0 link treo.
- Step 4: `command -v` → `~/.local/bin/worker-ask`, `~/.local/bin/bang-init`; `agy-ask` → `.../Bang_ver/tools/agy/bin/worker-ask`; `worker-ask W1 "Trả lời đúng một dòng: I-OK" --mode plan --timeout 300` (HABBLAUD_URL chết) in `I-OK`, `exit=0`.
- Đích cũ của mọi link đã gỡ/đổi (đều dưới `Vi-Habblaud/tools/agy/`) nằm trong `task-9-report.md` và `bin.before`/`skills.before`/`plugins.before`.

## Để lại cho kế hoạch sau

_(Điền khi xong Task 9.)_

## Kết quả (Task 8)

Chạy trên worktree `~/bang-ver-accept3` (HEAD 38139bb), cổng 4749, data dir `~/.bang-test-data`. Chi tiết: `.superpowers/sdd/2026-11-04-bang-ver-3-skills/task-8-report.md`.

- **Step 1:** build xong, HTTP 200, `start` lần hai in `already running`, log sạch. **RSS rảnh 113 812 kB, vượt trần 112 640 kB khoảng 1,2 MB (Kế hoạch 2: 108 876).** Không đạt.
- **Step 2:** `stop` từ repo chính: `belongs to another server`, exit 1, server còn sống; `restart` từ worktree đổi pid; 4747 vẫn 1 listener. Đạt.
- **Step 3:** `bang-init` exit 0, đủ file mẫu, link `.claude/skills`, `GEMINI.md`, `skills.json` đúng 5 plugin + `$B/skills`; chạy lại không ghi đè; `team.json` thử không đổi; đường đặt `folder` đúng. Đạt.
- **Step 4:** **Không đạt.** W1 liệt kê: `agy-customizations, antigravity-guide, ponytail, ponytail-review, systematic-debugging, test-driven-development, verification-before-completion`; hỏi thẳng: `giao-viec: no; advisor: no; bang-task: no`. Skill của `$B/skills` không tới được agy (chưa tìm nguyên nhân; `systematic-debugging` cũng có sẵn trong profile acc1 nên không chứng minh `skills.json` được nạp). Token đầu vào ≈ 8–9 k.
- **Step 5:** chờ người dùng (Claude chưa đăng nhập/tin cậy).
- **Step 6:** headless `H-OK`, exit 0. Đạt.
- **Step 7:** typecheck xanh; vitest 943 xanh + 1 flaky đã biết (tail rotation); i18n 1254/1254; pytest 46. Dòng thêm ròng không-test +243 −131 = +112 (≤ +300). Đạt.
- **Step 8:** 4749 dừng (0), 4747 còn 1, worktree xoá, giữ `~/bang-test-office`, `~/.bang-test-data`.
- **Việc còn lại:** điều tra vì sao agy không thấy skill dự án (§8 đã kiểm 2026-11-03 nhưng giờ không tái hiện); cắt ≥1,2 MB RSS hoặc nới trần; Claude seat chờ người dùng.

## Kết quả — lần chạy lại (Task 8c)

Chạy trên worktree HEAD 90dc3f6 và base aa3cb17, cổng 4749, data dir `~/.bang-test-data` (`team.json` khôi phục đúng từng byte). Chi tiết: `.superpowers/sdd/2026-11-04-bang-ver-3-skills/task-8c-report.md`.

- **Phần 1 (skill tới việc W1 ở thư mục đã tin cậy): đạt.** `worker-ask W1` (12 s) liệt kê 3 skill Bang_ver cùng 7 skill có sẵn và trả `bang-task=yes giao-viec=yes advisor=yes`. Việc Task 8 hỏng là do lần `-i` đầu tiên ở thư mục chưa tin cậy.
- **Phần 2 (thông báo lỗi khi thư mục chưa tin cậy): không như kỳ vọng.** Ở thư mục mới tinh `~/bang-trust-test` (và thư mục thứ hai có `.agents/skills.json`) việc W2 **không** bị fail: trả `T-OK` sau 6–8 s, exit 0, không treo. Màn hình thật của ghế: `Accessing workspace: … Do you trust the contents of this project? Antigravity CLI requires permission to read, edit, and execute files here. > Yes, I trust this folder  No, exit` (regex của 8b khớp chữ này). Nhưng agy `-i` vẫn chạy lời nhắc ngay dưới hộp thoại và ghi hội thoại, nên `checkTrust` (chỉ chạy khi chưa có hội thoại) không bao giờ chạy. Hệ quả: việc **thành công mà không có skill Bang_ver** (`bang-task=no giao-viec=no advisor=no`, 18,8 s) và hộp thoại vẫn nằm trên terminal ghế. Thông báo 8b chưa từng xuất hiện; cần sửa ở kế hoạch sau (kiểm màn hình cả khi đã có hội thoại, hoặc ngay sau khi khởi chạy). Không ai trả lời hộp thoại; không sửa mã.
- **Phần 3 (RSS rảnh, 60 s sau khi lên, 3 lần đọc cách 10 s, xen kẽ base/HEAD/base/HEAD):** base 113 456 và 113 196 kB; HEAD 114 188 và 113 508 kB. Trung vị chung: **base 113 336, HEAD 113 846 kB (+510 kB, ~0,45 %)**, nhỏ bằng độ nhiễu giữa các lần chạy. Cả hai đều vượt trần 112 640 kB; Kế hoạch 2 đo 108 876 giờ không tái hiện trên máy này, nên phần lớn là máy lệch chứ không phải Kế hoạch 3 làm tăng (tối đa ~0,5 MB). Lưu ý: aa3cb17 chưa có `office.sh stop` (lần chạy đầu bị lệch vì vậy, đã bỏ; base được dừng bằng `kill` đúng pid sau khi kiểm `cwd`).
- **Dọn:** worktree đã xoá; 4747 vẫn 1 listener, 4749 trống; giữ `~/bang-test-office`, `~/.bang-test-data`, `~/bang-trust-test` (rỗng).

## Kết quả — lần chạy lại (Task 8d, từ chối khi chưa tin cậy)

Worktree HEAD fadf77b, cổng 4749, data dir `~/.bang-test-data` (`team.json` khôi phục đúng từng byte). Chi tiết: `.superpowers/sdd/2026-11-04-bang-ver-3-skills/task-8d-report.md`.

- **Bước 1 (đạt):** `folder` -> `~/bang-trust-test` (chưa tin cậy), `worker-ask W2 ...` thoát exit 1 sau 0,1 s: `agy-ask: Antigravity account acc1 does not trust the folder /home/nhatbang/bang-trust-test: run "agy-as acc1" there once, answer yes, then give the job again`. Không mở terminal nào (`/api/snapshot` ptys rỗng), `brain` của acc1 không thêm hội thoại, thư mục fixture vẫn rỗng.
- **Bước 2 (đạt):** thư mục tin cậy vẫn chạy, 12,8 s, `bang-task=yes giao-viec=yes advisor=yes`. Lần đầu ra `no no no` vì `.agents/skills.json` của fixture còn trỏ tới worktree cũ đã xoá (accept4); chạy lại `bang-init ~/bang-test-office` thì đúng (lỗi fixture, không phải mã).
- **Bước 3 (đạt):** `--cwd ~/bang-test-office/` (dấu `/` cuối) chạy, `C-OK` 6,2 s; `--cwd ~/bang-test-office/..` (thư mục home) bị từ chối, exit 1, cùng thông báo, 0,1 s.
- **Bước 4 (đạt):** gợi ý của `bang-init` có team.json: "Antigravity seats: BEFORE the first job in this folder, once per account (acc1): ... agy-as <acc> ... until then worker-ask refuses the job."; không có team.json: cùng câu nhưng "(each agy account in team.json)".
- **Dọn:** server 4749 dừng, worktree xoá, 4747 = 1, 4749 = 0, `team.json` giống bản sao lưu (md5 243ce1cc...), `~/bang-trust-test` không đổi.
