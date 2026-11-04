# Bang_ver — Kế hoạch 4/6: `giao-viec`, lời mở đầu worker, kiểm 6 tiêu đề, vòng review, chế độ worker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boss giao việc có kỷ luật: `worker-ask` từ chối prompt thiếu 6 phần (`--raw` bỏ kiểm), ghép lời mở đầu §12 (luật ghế + "Bài học" của `task_board.md`) trước mọi prompt, office lẫn headless; ghế agy chạy `auto` mặc định; skill `giao-viec` viết lại theo §11 (mẫu 6 phần, chạy nền, review bằng lệnh, ≤2 vòng sửa, Bài học); `bang-init` ghi bản `task_board.md` không còn dòng ví dụ (M13); boss gõ sai trong `team.json` không đóng terminal boss agy (M8).

**Architecture:** Mọi thứ của prompt nằm một chỗ: `parse()` trong `tools/agy/bin/worker-ask` (:104–149). Kiểm tiêu đề chạy trên chữ của boss (`a["task"]`); lời mở đầu ghép vào `a["prompt"]`, mà cả đường office (`via_office`, :201) lẫn headless (`headless_agy` :308, `headless_claude` :370) đều đọc. Server chỉ đổi ba chỗ nhỏ: trần prompt tính theo byte (prompt là MỘT đối số argv của agy/claude), trường `task` để bảng việc hiện chữ của boss thay vì lời mở đầu, và AgySource lấy chữ việc headless từ dòng start của `worker-ask`. Vòng review là chữ trong skill cho boss, không phải code.

**Tech Stack:** Python 3 + pytest (`tools/agy/tests`), bash, Node ≥22 + TypeScript + vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-design.md` (§10 mẫu, §11 `giao-viec`, §12 lời mở đầu, §14 chế độ worker là lõi; §2, §3, §13 làm ngữ cảnh, §17 bước 4, 6, 7, 8, §18, §20). Bàn giao: mục "Để lại cho kế hoạch sau → Kế hoạch 4" của `2026-11-04-bang-ver-3-skills.md`; "Plan 4 / advisor-spike readiness", M8, M13, M14 của `2026-11-04-bang-ver-3-skills-final-review.md`; "Default agy `--mode plan` … Plan 4" của `2026-11-04-bang-ver-2-ghe-final-review.md`.

Phán quyết của controller và người dùng (ràng buộc như spec):
- Ai cũng giao được việc; một lệnh `worker-ask <ghế> "<prompt>"` (`agy-ask`, `claude-ask` là link).
- Lời mở đầu ghép MỘT lần trong `parse()` của `worker-ask`; chữ của boss là `a["task"]`; Bài học đọc từ `<folder office>/task_board.md`, không từ `--cwd`; lời mở đầu nêu tên ghế (= `BANG_SLOT`) và folder.
- Thiếu một tiêu đề → exit 1, liệt kê tiêu đề thiếu; `--raw` bỏ kiểm và phải được parse rõ ràng (cờ lạ hiện đi thẳng vào agy/claude, `worker-ask:128–129`).
- Vòng review là chữ trong skill (≤2 vòng rồi hỏi người dùng). `--mode plan` theo §14; headless `plan` trả bản kế hoạch rồi kết thúc.
- Nâng trần 20k ở `service.ts:247`, kiểm cả đường `/api/agy/jobs`.
- `templates/` giữ nguyên văn; M13 sửa ở bản chép của `bang-init`; `bang-init` chạy lại an toàn như nay.
- M8 làm cùng kế hoạch này. Nghiệm thu trên 4749 từ worktree; phần boss Claude thật chạy được ở thư mục Claude đã tin cậy hoặc ghi "chờ người dùng".

## Global Constraints

- Không thêm runtime dependency; `dependencies` trong `package.json` vẫn không có.
- Mọi chữ hiển thị trên trang qua `tr('English text')`; bản dịch duy nhất ở `shared/locales/vi.ts`; `npm run i18n:check` phải 0 thiếu, 0 khoá thừa. CLI Python/bash in tiếng Anh.
- Code, comment, tài liệu, nội dung SKILL.md bằng tiếng Anh. Tiếng Việt nguyên văn spec ở ba chỗ: lời mở đầu §12 (Task 4), mẫu 6 phần §11 trong `giao-viec` (Task 7), tiêu đề mục của `task_board.md`. Kế hoạch tiếng Việt.
- Sau mỗi task: `npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)` xanh, cộng `bash -n` cho mọi script bash task đó sửa (không `py_compile` `worker-ask`: nó sẽ để lại `__pycache__` trong `tools/agy/bin` và `git add -A` sẽ commit). Được phép đỏ chỉ các test flaky đã biết: `server/sources/tail.test.ts > detects replaced file (rotation) even if larger`, `server/sources/watcher.test.ts > tracks transcript appends and registry status`, `server/sources/watcher.test.ts > /clear: same process, new session — same character, reset tasks`, `art.test.ts > floor chunks` khi máy đang tải. Không sửa, không `skip` chúng.
- Mỗi task một commit; mọi commit kết thúc bằng đúng hai dòng:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKo78y8zx9LkivRuQac
  ```
- Phản mục tiêu §3 là giới hạn cứng: không plugin Claude; code của ta không ghi gì dưới `~/.agy_profiles/accN/.gemini/` (đoạn dọn hội thoại headless có sẵn ở `worker-ask:329–335` không đụng tới); giữ đường headless; không tính năng nào thêm ròng quá 300 dòng; RSS rảnh của server: HEAD ≤ mốc aa3cb17 + 3 %, đo A/B xen kẽ trong cùng một phiên, ít nhất 3 cặp.
- Không chạy `npm run build` hay `npm run office` trong repo chính: server 4747 của người dùng chạy từ `dist/` của repo này. Không dừng, không khởi động lại nó. Build và chạy thử chỉ trong worktree (Task 9).
- Không đụng `~/.claude*`, `~/.local/bin`, `~/.agy_profiles`, `~/.habblaud`. Ngoại lệ, chỉ ở Task 9: việc agy thật trên `acc1` (người dùng đã duyệt); CHỈ ĐỌC transcript mới nhất của `acc1` và `~/.agy_profiles/agy-ask.log.jsonl`; `bang-init` chỉ qua `~/.local/bin/bang-init` (link vào repo chính), không bao giờ từ worktree, và chỉ trên `~/bang-test-office`. Test Python dựng env mới, không để lọt `HABBLAUD_*`, `CLAUDE_CONFIG_DIR` của người chạy.
- Ngoài phạm vi: lệnh và cơ chế `advisor`, thẻ `[ADVISOR …]` trong cách boss trả lời (Kế hoạch 5); M2; deploy (Kế hoạch 6); test flaky; đổi mặc định của ghế Claude sang `auto` (câu hỏi mở 1); lời mở đầu cho việc gõ trên trang vào terminal ghế (Quyết định 6).

## Quyết định của người viết kế hoạch (controller xem lại)

1. **Danh sách kiểm = tiêu đề + 6 mục** (7 dòng): `# Việc <ID> — <tên>`, `## Bối cảnh`, `## Input`, `## Skill dùng`, `## Cách làm`, `## Output`, `## Tiêu chí review`. Spec §11 nói "6 tiêu đề" nhưng ID trong tiêu đề là thứ nối prompt với dòng việc, nên kiểm cả nó. Khớp đầu dòng, sau `unicodedata.normalize("NFC", …)`, không phân biệt hoa thường, cho phép chữ sau tiêu đề trên cùng dòng (mẫu §11 viết `## Bối cảnh    ≤3 dòng…`); tiêu đề việc chỉ cần `# Việc <ID>` (gạch nối kiểu gì cũng được). Không kiểm thứ tự, không kiểm mục rỗng. Mục thêm (`## Kết quả review lần trước`) được phép.
2. **`--raw` chỉ bỏ kiểm.** Lời mở đầu luôn được ghép (spec §12: "mọi prompt").
3. **Folder của lời mở đầu = folder office (`a["folder"]`), không có thì `--cwd`.** Bài học = các dòng giữa dòng bắt đầu bằng `## Bài học` và tiêu đề `## ` kế tiếp, nguyên văn, bỏ dòng trống hai đầu; không có file, không có mục hoặc mục rỗng → `(chưa có)`. Không cắt số dòng (luật ≤20 dòng là của boss, skill nhắc).
4. **Bảng việc hiện chữ của boss, không phải lời mở đầu.** Nếu không sửa, mọi việc trên bảng và feed sẽ là "Bạn là ghế W1 trong office /home/…". `worker-ask` gửi thêm `task` (≤1000 ký tự đầu của `a["task"]`); server dùng `task ?? prompt` để hiện và ghi log. Việc headless: AgySource đang lấy prompt từ argv của tiến trình agy (`source.ts:601–608`), đổi sang dòng start của `worker-ask` (đã chứa `a["task"][:200]`, `worker-ask:283`) khi có.
5. **Trần = 100 000 byte UTF-8, ở cả `worker-ask` (trước mọi lời gọi, hai đường) và `service.ts` (`PROMPT_MAX_BYTES`).** Lý do: prompt là MỘT đối số của `agy-as … -i/-p` và `claude … <prompt>`; Linux giới hạn mỗi đối số 128 KiB (MAX_ARG_STRLEN). 20 000 ký tự đếm theo ký tự thì sai đơn vị (chữ Việt 2–3 byte). Headless hiện không kiểm: quá cỡ → `OSError: Argument list too long` thành traceback. `worker-ask` gửi JSON với `ensure_ascii=False` (thân request ≈ số byte UTF-8 thay vì tới 6 byte/ký tự), nên thân luôn dưới `MAX_BODY` 256 KiB (`app.ts:106`). `AGY_PROMPT_MAX` (`source.ts:97`, ô gõ trên trang, 20 000 ký tự, khớp `maxlength` ở `agy-panel.ts:67`) giữ nguyên: lời mở đầu được ghép SAU kiểm đó, bên trong `worker-ask`.
6. **Việc gõ trên trang.** Ghế có terminal (mọi ghế trong Bang_ver) → trang POST thẳng `/api/workers/ask` (`agy-panel.ts:134`), không qua `worker-ask`: không kiểm, không lời mở đầu (việc tay của người dùng). Ghế không có phiên → `/api/agy/jobs` → `AgySource.assign` chạy `worker-ask` → phải thêm `--raw`, không thì nút "Send a job" chết im lặng (exit 1 bị bỏ qua ở `source.ts:672–675`). Không thêm lời mở đầu phía server (sẽ là chỗ ghép thứ hai).
7. **Chế độ (§14):** ghế agy không nói `--mode` và không có `defaults.json` → `auto` (nay `plan`, `worker-ask:139`). Bảng "Defaults for jobs" trên trang thêm lựa chọn `auto` (nhãn `tr('Automatic')`, khoá đã có ở `vi.ts:192`) và hiện `auto` khi chưa đặt; `AGY_MODES` thêm `'auto'`. Ghế Claude giữ `default` (chế độ của claude) tới khi có ghế Claude kiểm được (câu hỏi mở 1). Không code cho "plan headless": agy/claude `-p` ở chế độ plan tự trả bản kế hoạch rồi dừng; Task 9 kiểm.
8. **M13:** bản chép `task_board.md` của `bang-init` ghi boss và ghế thật vào dòng 2 và bỏ ba dòng ví dụ (`templates/task_board.md:11`, `:16`, `:19`). Bảng đã có không bị sửa; nếu còn dòng ví dụ thì `bang-init` in cảnh báo. Lời mở đầu đọc Bài học nguyên văn, không lọc ví dụ.
9. **M8:** mục `boss` có mặt nhưng sai (kind lạ, account có dấu cách) → giữ boss trước đó, như file lưu dở giữ cả đội; không có `boss` → Claude mặc định như nay. README :116–117 đã hứa "close it only on a valid entry".
10. **M14 đi kèm (rẻ):** helper `ask()` của `test_worker_ask.py:92` bỏ thêm `HABBLAUD_*` khỏi env chép từ người chạy.
11. **Nghiệm thu bước 6:** người chạy Task 9 đóng vai boss và làm đúng từng bước của `skills/giao-viec/SKILL.md` (Claude, tài khoản mặc định); không cần ghế Claude hay boss mở từ trang. Một boss Claude thật tự đọc skill là bước tuỳ chọn (Task 9 Step 9), mặc định "chờ người dùng" (gộp với nghiệm thu Kế hoạch 5, vốn cần boss trong trang).

## Review Focus

1. **Nút "Send a job" của trang không bị kiểm 6 tiêu đề chặn**: ghế không có phiên đi qua `/api/agy/jobs` → `worker-ask … --raw`; người dùng gõ chữ tự do vẫn chạy. → Task 1 (args chính xác ở `source.test.ts:629`).
2. **Bảng việc và feed hiện chữ của boss** (`# Việc T1 — …`), không phải dòng đầu lời mở đầu, cả việc trong terminal lẫn việc headless. → Task 3 (hai test), Task 9 Step 4, 7 (đọc `/api/snapshot`).
3. **Prompt dài tiếng Việt** (job sửa kèm diff): quá 100 000 byte → `worker-ask` exit 1 với lời khuyên "đưa vào file", trước mọi lời gọi; dưới trần thì đi qua office (không 413) và headless (không E2BIG). → Task 3 (server, 30 000 và 34 000 ký tự `ệ`), Task 4 (CLI, thân UTF-8).
4. **`task_board.md` không có, không có mục Bài học, mục rỗng, có mục khác sau đó, việc chạy với `--cwd` khác**: lời mở đầu vẫn dựng được, Bài học lấy từ folder office, rỗng thì `(chưa có)`. → Task 4.
5. **Boss gõ sai trong `team.json` không đóng terminal boss agy đang chạy** (M8). → Task 5.

---

### Task 1: `worker-ask` kiểm 6 tiêu đề, `--raw`; "Send a job" của trang dùng `--raw`

**Files:**
- Modify: `tools/agy/bin/worker-ask` (docstring :2 và đoạn mới sau :21; hằng số sau :59; `parse` :112–129), `server/sources/agy/source.ts` (`assign` :664), `server/sources/agy/source.test.ts` (:629), `tools/agy/tests/test_worker_ask.py` (helper `ask` :89–101, test mới)

**Interfaces:**
- Produces:
  - `HEADINGS = ("# Việc <ID> — <tên>", "## Bối cảnh", "## Input", "## Skill dùng", "## Cách làm", "## Output", "## Tiêu chí review")` (thứ tự của mẫu §11).
  - `missing_headings(task: str) -> list[str]`: các phần tử của `HEADINGS` không tìm thấy, giữ thứ tự. Tiêu đề việc khớp `^#[ \t]+Việc[ \t]+\S`; mục `h` khớp `^##[ \t]+<h không có "## ">`; `re.M | re.I` trên `unicodedata.normalize("NFC", task)`.
  - `a["raw"]: bool` (mặc định `False`); `--raw` không vào `a["extra"]`.
  - Từ chối: `die(f"the prompt lacks {', '.join(miss)}: write the job in the 6 parts of the giao-viec skill, or pass --raw to send it as is")` (exit 1), đặt ngay sau vòng parse cờ (:129), trước mọi kiểm khác về mode/folder, không gọi office.
  - Docstring dòng 1 thêm `[--raw]`; một đoạn: "The prompt must have the giao-viec headings (…); --raw sends it as is."
  - `AgySource.assign`: `args = [seat.name, prompt, '--raw', '--role', …]`.
  - Test helper: `ask(self, args, via=None, office=True, tool="agy-ask", env=None, raw=True)` thêm `"--raw"` vào cuối `args` khi `raw`; env bỏ khoá bắt đầu bằng `("AGY_", "BANG_", "CLAUDE", "HABBLAUD_")` (M14). Hằng `JOB` ở đầu file (Task 4 dùng lại):
    ```python
    JOB = "# Việc T1 — đếm\n## Bối cảnh x\n## Input x\n## Skill dùng không\n## Cách làm x\n## Output x\n## Tiêu chí review x\n"
    ```

- [ ] **Step 1: Test (thất bại)** — trong `Seats`:
```python
def test_a_job_without_the_six_parts_is_refused_naming_what_is_missing(self):
    code, _, err = self.ask(["W1", "# Việc T1 — x\n## Bối cảnh a\n## Output b\n"], raw=False)
    self.assertEqual(code, 1)
    self.assertIn("lacks ## Input, ## Skill dùng, ## Cách làm, ## Tiêu chí review:", err)
    self.assertIn("--raw", err)
    self.assertEqual(Office.bodies, [])

def test_a_free_text_prompt_lacks_the_title_too(self):
    code, _, err = self.ask(["W1", "ping"], raw=False)
    self.assertEqual(code, 1)
    self.assertIn("lacks # Việc <ID> — <tên>, ## Bối cảnh,", err)

def test_six_parts_pass_in_any_case_dash_or_unicode_form(self):
    for task in (JOB, JOB.replace("—", "-").replace("## Input", "##  input"), unicodedata.normalize("NFD", JOB)):
        code, _, err = self.ask(["W1", task], raw=False)
        self.assertEqual(code, 0, err)

def test_raw_skips_the_check_and_never_reaches_the_agent(self):
    code, out, err = self.ask(["W2", "ping", "--raw"], office=False, raw=False)
    self.assertEqual(code, 0, err)
    self.assertNotIn("--raw", json.loads(out)["args"])
```
(`import unicodedata` ở đầu file.) Trong `source.test.ts:629`, mảng mong đợi thành `[folder, 'W2', 'x', '--raw', '--role', 'manual', '--max', '2000', '--mode', 'plan']`.
Run: `cd tools/agy && python3 -m pytest -q tests/test_worker_ask.py` → 4 FAIL; `npx vitest run server/sources/agy/source.test.ts` → 1 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — hai lệnh trên xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(worker-ask): refuse a job without the six giao-viec headings; --raw sends it as is"
```

---

### Task 2: Chế độ worker — ghế agy chạy `auto` mặc định; trang có lựa chọn `auto`

**Files:**
- Modify: `tools/agy/bin/worker-ask` (:139; docstring :26–28), `server/sources/agy/source.ts` (`AGY_MODES` :94), `client/src/ui/agy-panel.ts` (`Mode` :21, `segmented` :190–195, `render` :222–223), `server/sources/agy/source.test.ts`, `tools/agy/tests/test_worker_ask.py`

**Interfaces:**
- Produces:
  - `worker-ask`: `a["mode"] = a["mode"] or d.get("mode") or ("auto" if agy else "default")`. Docstring: "else mode auto (agy; the office folder needs no rules) or default (Claude)".
  - `AGY_MODES = ['auto', 'plan', 'default', 'accept-edits'] as const`.
  - `agy-panel.ts`: `type Mode = 'auto' | 'plan' | 'default' | 'accept-edits'`; lựa chọn đầu `['auto', tr('Automatic')]`; `render` dùng `?? 'auto'`, comment `// worker-ask's own default mode is auto.` Không khoá i18n mới.

- [ ] **Step 1: Test (thất bại)**
```python
def test_an_agy_seat_runs_auto_unless_told_a_claude_seat_keeps_its_own(self):
    r = json.loads(self.ask(["W2", "ping"], office=False)[1])
    self.assertEqual(r["args"][r["args"].index("--mode") + 1], "auto")
    self.ask(["W1", "ping"])
    self.assertEqual(Office.bodies[-1]["mode"], "auto")
    r = json.loads(self.ask(["W2", "ping", "--mode", "plan"], office=False)[1])
    self.assertEqual(r["args"][r["args"].index("--mode") + 1], "plan")
    self.assertNotIn("--permission-mode", json.loads(self.ask(["C1", "ping"], office=False)[1])["args"])
```
```ts
// source.test.ts
it('auto is a mode of the page defaults (AGY_MODES, also checked by assign)', () => {
  const t = setup(['acc2']);
  expect(t.source.setDefaults('agy:acc2', { mode: 'auto' })).toEqual({ ok: true });
});
```
Run: hai file test → 2 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh; `grep -n "own default mode is plan" client/src/ui/agy-panel.ts | wc -l` → `0`; kiểm chung (i18n vẫn 0/0).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(modes): Antigravity seats run auto unless told; the page offers Automatic"
```

---

### Task 3: Server — trần prompt theo byte; bảng việc hiện chữ của boss

**Files:**
- Modify: `server/workers/service.ts` (`AskInput` :80–92; `ask` :247, :259; `launch` :305), `server/http/app.ts` (:223), `server/sources/agy/source.ts` (`jobStarted` :592–597), `server/workers/service.test.ts`, `server/sources/agy/source.test.ts`

**Interfaces:**
- Produces:
  - `service.ts`: `export const PROMPT_MAX_BYTES = 100_000;` với comment một dòng: the prompt is one argv string of agy/claude (Linux: 128 KiB each). `:247` thành `if (!prompt || Buffer.byteLength(prompt, 'utf8') > PROMPT_MAX_BYTES)` (giữ khoá `tr('prompt empty or too long')`).
  - `AskInput.task?: string` — `/** The boss's own text (worker-ask sends it without the seat preamble): shown on the board and logged. */`.
  - Job: `prompt: truncate(maskSecrets((input.task ?? prompt).replace(/\s+/g, ' ')), 300)`; dòng log start ở `launch` dùng `prompt: job.prompt.slice(0, 200)`. Chương trình của ghế vẫn nhận `prompt` đầy đủ.
  - `app.ts:223`: `for (const k of ['cwd', 'role', 'mode', 'effort', 'task'] as const)`.
  - `AgySource.jobStarted`: dòng đầu thân hàm: `const start = job.ppid !== undefined ? this.starts.get(job.ppid) : undefined; if (start?.prompt) job.prompt = start.prompt;` (comment: worker-ask's start line has the boss's text; the argv has the seat preamble in front); `role` lấy từ `start?.role`.

- [ ] **Step 1: Test (thất bại)**
```ts
// service.test.ts
it('a prompt is capped in UTF-8 bytes, not 20k characters; the board and the log show the task, the seat gets everything', async () => {
  const t = setup();
  expect(await t.svc.ask({ worker: 'W1', prompt: 'ệ'.repeat(30_000) })).toMatchObject({ ok: true }); // 90 000 bytes
  expect(await t.svc.ask({ worker: 'W2', prompt: 'ệ'.repeat(34_000) })).toMatchObject({ ok: false, status: 400 }); // 102 000 bytes
  await t.svc.ask({ worker: 'C1', prompt: 'Bạn là ghế C1 trong office /w.\n---\n# Việc T1 — x', task: '# Việc T1 — x' });
  expect(t.svc.jobs().find((j) => j.worker === 'C1')?.prompt).toBe('# Việc T1 — x');
  expect(t.open.get('claude-worker:C1')?.args.at(-1)).toBe('Bạn là ghế C1 trong office /w.\n---\n# Việc T1 — x');
  expect(t.log().at(-1)).toMatchObject({ event: 'start', prompt: '# Việc T1 — x' }); // C1's launch wrote last
});
// source.test.ts
it('a headless job of worker-ask shows the task of its start line, not the seat preamble of its argv', () => {
  const t = setup();
  t.source.start();
  t.start(51, 'acc2', { prompt: '# Việc T1 — đếm số' });
  t.job(51, 'acc2', 'Bạn là ghế W1 trong office /w. Luật: …\n---\n# Việc T1 — đếm số');
  t.source.poll();
  expect(t.agent('acc2')?.activity).toMatchObject({ kind: 'prompt', text: '# Việc T1 — đếm số' });
  expect(t.office.commit().snapshot.rooms.flatMap((r) => r.board?.items ?? []).map((i) => i.text)).toEqual(['# Việc T1 — đếm số']);
});
```
Run: `npx vitest run server/workers/service.test.ts server/sources/agy/source.test.ts` → 2 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — hai test xanh; `grep -n "20_000" server/workers/service.ts` chỉ còn dòng `max:` (:262, trần câu trả lời, không đổi); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "fix(workers): cap prompts in bytes (100 kB) and show the boss's task, not the seat preamble"
```

---

### Task 4: Lời mở đầu worker + Bài học, trần byte ở CLI, gửi `task`

**Files:**
- Modify: `tools/agy/bin/worker-ask` (docstring; hằng số; hàm mới cạnh `parse`; cuối `parse` sau :148; `http` :179; `via_office` :205), `tools/agy/tests/test_worker_ask.py` (fake `Office.do_POST` :15–20, test mới)

**Interfaces:**
- Consumes: `JOB`, `raw=` của helper (Task 1); `task` và `PROMPT_MAX_BYTES` = 100 000 của server (Task 3).
- Produces:
  - Lời mở đầu, nguyên văn spec §12 (chỉ thay `<name>`, `<folder>`, nội dung Bài học):
    ```python
    PREAMBLE = ("Bạn là ghế {seat} trong office {folder}. Luật: đọc task_board.md trước khi làm; chỉ sửa dòng việc của mình;\n"
                "kẹt thì đọc Ghi chú kỹ thuật, rồi chạy lệnh `advisor \"<câu hỏi>\"` và chờ trả lời, rồi ghi `blocked:` và dừng; "
                "xong thì cập nhật dòng việc + báo cáo ≤10 dòng.\n\n## Bài học (từ task_board.md)\n{lessons}\n---\n")
    PROMPT_MAX = 100_000  # bytes, as the office (service.ts PROMPT_MAX_BYTES): the prompt is one argv string (128 KiB each)
    ```
  - `lessons(folder: str) -> str`: mục Bài học của `<folder>/task_board.md` theo Quyết định 3 (đọc `encoding="utf-8", errors="replace"`, NFC); `""` khi không có.
  - `preamble(seat: str, folder: str) -> str` = `PREAMBLE.format(seat=seat, folder=folder, lessons=lessons(folder) or "(chưa có)")`.
  - Cuối `parse`: `a["prompt"] = preamble(a["worker"], a["folder"] or a["cwd"]) + a["task"]`; rồi `n = len(a["prompt"].encode())`; `n > PROMPT_MAX` → `die(f"the prompt is {n} bytes with the seat preamble, over {PROMPT_MAX}: put long parts (diffs, logs) in a file and give its path")`.
  - `via_office` body thêm `"task": a["task"][:1000]` (comment: the board shows 300 characters of it). `http()`: `json.dumps(body, ensure_ascii=False).encode()`.
  - Docstring: một đoạn "Every prompt starts with the seat preamble: the seat and office, the worker rules and the "Bài học" lines of <folder>/task_board.md."
  - Fake office: lưu thân thô vào `Office.raw` (list bytes); nhánh BUSY so `body.get("task") == "busy"`.

- [ ] **Step 1: Test (thất bại)** — `PRE = "Bạn là ghế {} trong office {}. Luật: đọc task_board.md trước khi làm; chỉ sửa dòng việc của mình;\nkẹt thì đọc Ghi chú kỹ thuật, rồi chạy lệnh `advisor \"<câu hỏi>\"` và chờ trả lời, rồi ghi `blocked:` và dừng; xong thì cập nhật dòng việc + báo cáo ≤10 dòng.\n\n## Bài học (từ task_board.md)\n{}\n---\n"` ở đầu file; `board(self, folder, text)` ghi `<folder>/task_board.md` và đăng ký một cleanup xoá file nếu nó còn (gọi nhiều lần trong một test vẫn an toàn).
```python
def test_every_job_starts_with_the_seat_preamble_and_the_office_lessons(self):
    self.board(self.folder, "# Task board\n\n## Bài học (chỉ boss ghi)\n\n- Khi A → B (vì C) [T1]\n\n- Khi D → E [T2]\n\n## Hỏi đáp\n| x |\n")
    code, out, err = self.ask(["W2", JOB], office=False, raw=False)
    self.assertEqual(code, 0, err)
    self.assertEqual(json.loads(out)["args"][2], PRE.format("W2", self.folder, "- Khi A → B (vì C) [T1]\n\n- Khi D → E [T2]") + JOB)

def test_through_the_office_the_task_travels_apart_and_the_body_is_utf8(self):
    self.ask(["W1", JOB], raw=False)
    b = Office.bodies[-1]
    self.assertEqual((b["task"], b["prompt"]), (JOB, PRE.format("W1", self.folder, "(chưa có)") + JOB))
    self.assertIn("Bạn là ghế".encode(), Office.raw[-1])

def test_lessons_come_from_the_office_folder_not_from_cwd(self):
    self.board(self.folder, "## Bài học\n- Khi X → Y [T1]\n")
    self.board(self.tmp, "## Bài học\n- Khi SAI → SAI [T9]\n")
    p = json.loads(self.ask(["W2", "ping", "--cwd", self.tmp], office=False)[1])["args"][2]
    self.assertTrue(p.startswith(f"Bạn là ghế W2 trong office {self.folder}."))
    self.assertIn("- Khi X → Y [T1]\n---\n", p)
    self.assertNotIn("SAI", p)

def test_no_board_no_section_or_an_empty_one_says_none_yet(self):
    for text in (None, "# Task board\n## Việc đang làm\n", "## Bài học (chỉ boss ghi)\n\n## Hỏi đáp\n- not a lesson\n"):
        if text is not None:
            self.board(self.folder, text)
        p = json.loads(self.ask(["W2", "ping"], office=False)[1])["args"][2]
        self.assertIn("## Bài học (từ task_board.md)\n(chưa có)\n---\nping", p)

def test_a_prompt_over_100000_bytes_is_refused_before_any_call(self):
    code, _, err = self.ask(["W1", "ệ" * 34_000])
    self.assertEqual(code, 1)
    self.assertIn("over 100000", err)
    self.assertEqual(Office.bodies, [])
```
(`test_busy_seat_exits_3` không đổi: helper thêm `--raw`, fake office so `task`.)
Run: `cd tools/agy && python3 -m pytest -q tests/test_worker_ask.py` → 5 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh; `wc -l tools/agy/bin/worker-ask` (ghi vào commit; Task 1+4 cộng lại ≲ +50 dòng); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(worker-ask): every job starts with the seat preamble and the board's lessons"
```

---

### Task 5: M8 — boss gõ sai giữ boss cũ

**Files:**
- Modify: `server/team.ts` (`cleanTeam` :86–101, `parseTeam` :103–105, `reload` :298), `server/team.test.ts`

**Interfaces:**
- Produces: `parseTeam(text: string, keep?: TeamFile['boss']): TeamFile`; `cleanTeam(raw, keep = { kind: 'claude', account: 'default' })`: `boss` hợp lệ → nó; `r.boss == null` → Claude mặc định; có mà sai → `keep`. `reload` gọi `parseTeam(text, this.team.boss)`; `load` và `importTeam` không đổi. Comment một dòng: a typo keeps the boss it had (its agy terminal stays), like a half-saved file keeps the team.

- [ ] **Step 1: Test (thất bại)**
```ts
it('a typo in boss keeps the boss it had (no onChange, its agy terminal stays); no boss key means the Claude default', () => {
  const t = setup();
  writeFileSync(t.file, JSON.stringify({ folder: '/w/p', boss: { kind: 'agy', account: 'acc1' }, workers: [] }));
  const svc = t.team();
  for (const boss of [{ kind: 'Agy', account: 'acc1' }, { kind: 'agy', account: 'a b' }]) {
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', boss, workers: [] }));
    expect(svc.reload()).toBe(false);
    expect(svc.boss).toEqual({ kind: 'agy', account: 'acc1' });
  }
  expect(t.changes()).toBe(0);
  writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [] }));
  expect(svc.reload()).toBe(true);
  expect(svc.boss).toEqual({ kind: 'claude', account: 'default' });
});
```
Run: `npx vitest run server/team.test.ts` → 1 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh (test `parseTeam` cũ ở :49 vẫn xanh: không có `boss` → mặc định); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "fix(team): a typo in boss keeps the boss it had, so its agy terminal stays"
```

---

### Task 6: M13 — `bang-init` chép bảng việc với ghế thật, không dòng ví dụ

**Files:**
- Modify: `tools/agy/bin/bang-init` (khối Python :19–59), `tools/agy/tests/test_bang_init.py` (`test_fresh_folder_gets_templates_manifest_links_and_gemini` :60–79, test mới)

**Interfaces:**
- Produces (trong khối Python, thứ tự mới):
  1. Đọc `team.json` trước khi chép mẫu: `t = {}`; file có → `json.load`; hỏng hoặc không phải object → nhớ lỗi, `t = {}`, chép mẫu và ghi `skills.json` như cũ, rồi mới in lỗi và `sys.exit(1)` (hành vi `test_broken_team_json_is_left_alone` giữ nguyên).
  2. Bản chép `task_board.md` (chỉ khi chưa có) = mẫu với: `<tên dự án>` → tên thư mục; `<folder>` → folder; `<kind/account>` → `f"{b.get('kind') or 'claude'}/{b.get('account') or 'default'}"` (`b` = `t["boss"]` nếu là dict, không thì `{}`); chuỗi `W1 agy/acc1, W2 agy/acc1, C1 claude/default` → `", ".join(f"{w['name']} {w['kind']}/{w['account']}")` của các worker là dict có ba khoá chuỗi, rỗng → `chưa có`; bỏ mọi dòng ví dụ = dòng bắt đầu bằng `| ` hoặc `- ` nằm ngay sau một dòng bắt đầu bằng `|---` hoặc `## Bài học` (đúng `:11`, `:16`, `:19` của mẫu). `project_proposal.md` như cũ.
  3. `task_board.md` đã có và chứa nguyên một dòng ví dụ nào trong ba dòng đó → in `task_board.md still has the template's example rows (T1, W1's note, the OCR lesson): delete them, or the seats take them for real work`; không sửa file.

- [ ] **Step 1: Test (thất bại)** — helper trong file test:
```python
def board_copy(folder, boss, seats):
    lines = open(f"{REPO}/templates/task_board.md", encoding="utf-8").read().split("\n")
    del lines[18], lines[15], lines[10]          # template lines 19, 16, 11: the OCR lesson, W1's note, the T1 row
    return ("\n".join(lines).replace("<tên dự án>", os.path.basename(folder)).replace("<folder>", folder)
            .replace("<kind/account>", boss).replace("W1 agy/acc1, W2 agy/acc1, C1 claude/default", seats))
```
`test_fresh_folder_…`: vòng so mẫu chỉ còn `project_proposal.md`; thêm `assert env.read(proj, "task_board.md") == board_copy(env.real(proj), "claude/default", "chưa có")`.
```python
def test_board_copy_names_the_real_boss_and_seats_and_has_no_example_rows(env):
    env.team({"folder": "", "boss": {"kind": "agy", "account": "acc1"},
              "workers": [{"name": "W1", "kind": "agy", "account": "acc1"}, {"name": "C1", "kind": "claude", "account": "worker"}, "bad"]})
    assert env.run([env.proj])[0] == 0
    tb = env.read(env.proj, "task_board.md")
    assert tb == board_copy(env.real(env.proj), "agy/acc1", "W1 agy/acc1, C1 claude/worker")
    assert "OCR" not in tb and "| T1 |" not in tb and "ocr.py" not in tb

def test_an_existing_board_with_the_example_rows_is_warned_about_not_changed(env):
    tpl = open(f"{REPO}/templates/task_board.md", encoding="utf-8").read()
    touch(f"{env.proj}/task_board.md", tpl)
    code, out, _ = env.run([env.proj])
    assert code == 0 and "example rows" in out and env.read(env.proj, "task_board.md") == tpl
```
Run: `cd tools/agy && python3 -m pytest -q tests/test_bang_init.py` → 3 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh; `bash -n tools/agy/bin/bang-init`; mẫu vẫn nguyên văn spec (chạy lại script kiểm của Kế hoạch 3 Task 2 Step 2 → `verbatim`); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "fix(init): the board copy names the real boss and seats and drops the template's example rows"
```

---

### Task 7: Skill `giao-viec` viết lại (§11)

**Files:**
- Modify: `skills/giao-viec/SKILL.md` (thay toàn bộ :1–55), `tools/agy/tests/test_skills.py` (thay `test_agy_orchestrator_is_folded_into_giao_viec` :21–25)

**Interfaces:**
- Consumes: `--raw`, thông báo tiêu đề (Task 1); `auto` mặc định (Task 2); lời mở đầu, trần 100 kB (Task 3–4).

- [ ] **Step 1: Test (thất bại)**
```python
def test_giao_viec_carries_the_spec_template_and_the_review_loop():
    assert not os.path.exists(os.path.join(REPO, "tools", "agy", "skills"))
    spec = open(os.path.join(REPO, "docs", "superpowers", "specs", "2026-11-03-bang-ver-design.md"), encoding="utf-8").read()
    template = re.search(r"Mẫu prompt, nguyên văn:\n\n```\n(.*?)```", spec, re.S).group(1)
    g = read("giao-viec")
    assert template in g
    for s in ("worker-ask team", "| 3 | BUSY", "--raw", "--mode plan", "--mode auto", "run_in_background", "## Kết quả review lần trước",
              "- Khi <tình huống> → <làm gì> (vì …) [", "agy-as <acc>", "retrying cannot help", "ask the user", "100 kB"):
        assert s in g, s
    for s in ("(Habblaud)", "not available", "agy-ask", "claude-ask"):
        assert s not in g, s
```
Run: `cd tools/agy && python3 -m pytest -q tests/test_skills.py` → FAIL.

- [ ] **Step 2: Viết `skills/giao-viec/SKILL.md`** — đúng nội dung dưới đây; chỗ `<MẪU>` là dòng 208–217 của spec, chép từng byte (test so).
````markdown
---
name: giao-viec
description: For the boss of a Bang_ver office - give each job to a seat with worker-ask as a 6-part prompt, run it in the background, review the result by running its review commands yourself, send at most 2 fix jobs, then close the row and write the lesson. Use whenever you delegate, giao việc or chia việc to the office's seats.
---

# giao-viec

You are the boss. The seats are in team.json: `worker-ask team` prints the office folder, the boss and the seats. An Antigravity seat runs Gemini 3.8 Flash (cheap); a Claude Code seat is expensive, so give it only what Flash cannot do well. Do trivial one-liners yourself. Open yourself from the page (the + beside Boss): a worker's `advisor` question only reaches a boss terminal the office opened or took over.

Every job is a fresh conversation: the worker knows only your prompt, task_board.md and project_proposal.md. worker-ask puts the seat rules and the "Bài học" lines of task_board.md in front of your prompt, so do not repeat them. Never run bare `agy`: always `worker-ask` (each account gets its own HOME).

## 1. One row per job
Plan the work from project_proposal.md with your own skills. Before you send a job, add its row to "Việc đang làm" in task_board.md (the bang-task skill): `| T3 | <job> | W1 | todo | <done when> | MM-DD HH:MM |`. The ID in the prompt's title is that row's ID.

## 2. The prompt: these 6 parts
worker-ask refuses a prompt without the title or any of the six headings (exit 1, naming the missing ones):

```
<MẪU>
```

- Paths are relative to the office folder. Name the exact files, paste one real sample, say what must not be touched.
- "Skill dùng": the skill's name. Seats load skills by name (Antigravity through `.agents/skills.json`, Claude through `.claude/skills` and its plugins); there is no `.agents/skills/` folder. "không" if none.
- "Tiêu chí review": every line is a command you will run yourself, with the output you expect.
- `--raw` sends a prompt without the headings: only for a one-line question, never for project work.
- The prompt, with the seat rules in front, must stay under 100 kB: put long diffs or logs in a file and give its path.

## 3. Send it in the background
```bash
worker-ask <seat> "$(cat <<'EOF'
# Việc T3 — …
…
EOF
)" --role impl --effort medium [--mode plan] [--timeout 1800]
```
- Always in the background, so you stay free for `advisor` questions: Claude Code with `run_in_background`; an Antigravity boss appends `> /tmp/T3.out 2>&1 &` and reads the file when it is done. Several seats in parallel are fine; never two seats on one file.
- `--mode auto` is the default in the office folder. Pass `--mode plan` when the job deletes, writes outside its output folder, touches the source data, or installs anything. With the office running the user approves the plan in the seat's terminal on the page; headless (office off) a plan job returns its plan and ends: read it, and if you agree give the same job again with `--mode auto`.
- `--effort low|medium|high` (Claude seats also take `xhigh|max`); `--model` only for Claude seats. Claude seats run full; `--lean` (no MCP, skills or slash commands) for small jobs.
- `--cwd` only when the worker must write outside the office folder. Killing the command, or `--timeout` (seconds), cancels the job.

## 4. Review: run the criteria yourself
When the job returns (exit 0), do not trust the worker's report: run every command of "Tiêu chí review" on the product.
- ✅ → move the row to "Đã xong" (`| T3 | <job> | MM-DD HH:MM | <result path> | ✅ |`). Something worth remembering → one line in "Bài học": `- Khi <tình huống> → <làm gì> (vì …) [T3]`. Every later prompt carries it; keep "Bài học" at 20 lines or fewer (move the oldest to task_board.archive.md).
- ❌ → set the row to `doing: sửa 1/2 — review ❌ <what failed>` and give the same seat a fix job: all 6 parts again plus a section `## Kết quả review lần trước` with the paths, the diff, every command you ran and its output. The worker remembers nothing.
- At most 2 fix rounds. A third ❌: stop and ask the user, with the three review results.

## Exit codes
| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | done, answer printed | review it (section 4) |
| 1 | failed, timeout, missing headings, unknown seat, no folder, untrusted folder | read the message. "does not trust the folder": ask the user to run `cd <folder> && agy-as <acc>` once and answer yes; retrying cannot help. Missing headings: fix the prompt. Otherwise retry once, or do it yourself |
| 2 | refused by the office | do not retry, do not work around it |
| 3 | BUSY: the seat is on another job | wait until that job returns, or give this one to a free seat; never cancel another job to make room |
| 4 | the user cancelled the job | do not resend it unasked; tell the user |

## Pitfalls
- Flash over-claims on audits: re-check every serious finding before you report it.
- Steps, not the mode, drive the cost: name exact files so the worker does not explore.
````

- [ ] **Step 3: Kiểm** — xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(skills): giao-viec - the 6-part prompt, background jobs, review by command, at most 2 fix rounds, lessons"
```

---

### Task 8: Tài liệu và CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` :9–), `README.md` (:33, :116–117, bước 5 :126–135), `tools/agy/README.md` (:39–51, bảng "What is here")

- [ ] **Step 1: CHANGELOG** —
  - `### Added`: `worker-ask` từ chối việc thiếu tiêu đề hay một trong 6 mục của `giao-viec` (exit 1, nêu mục thiếu), `--raw` gửi nguyên văn; mọi việc của `worker-ask` mở đầu bằng lời mở đầu của ghế (ghế, folder, luật worker, các dòng "Bài học" của `task_board.md`), office lẫn headless; skill `giao-viec` viết lại (mẫu 6 phần, chạy nền, review bằng lệnh, ≤2 vòng sửa, Bài học, bảng exit có từ chối tin cậy).
  - `### Changed`: ghế agy chạy `auto` khi không nói `--mode` (trước là `plan`), bảng "Defaults for jobs" có Automatic; trần prompt 100 kB UTF-8 (trước 20 000 ký tự), `worker-ask` báo ngay khi vượt; bảng việc và feed hiện chữ của boss, không phải lời mở đầu; việc gửi từ trang tới ghế không có terminal chạy `--raw`; bản `task_board.md` của `bang-init` ghi boss và ghế thật, không còn dòng ví dụ, và cảnh báo bảng cũ còn dòng ví dụ; boss gõ sai trong `team.json` giữ boss cũ (terminal boss agy không bị đóng).
  - Dòng `skills/` cũ: bỏ "for now the old `agy-orchestrator` guide, rewritten in a later plan".

- [ ] **Step 2: README** — :116–117: thay câu "makes the server treat the boss as unset, and it closes … (A later plan …)" bằng "keeps the boss it had (its Antigravity terminal stays open) until the entry is valid again". Bước 5: ví dụ thành `worker-ask W1 "Read src/ and list the TODOs" --raw --mode plan`, thêm hai câu: a job for project work is written in the 6 parts of the `giao-viec` skill (worker-ask refuses one without them; `--raw` sends a quick question as is); every job starts with the seat's preamble and the board's "Bài học" lines; Antigravity seats run `auto` unless the job or the page's defaults say otherwise. `tools/agy/README.md`: hai ví dụ :46–47 thêm `--raw`; một câu về 6 phần và lời mở đầu; bảng "What is here" thêm `bin/skill-dirs` (M12).

- [ ] **Step 3: Kiểm**
Run: `grep -rn "list the TODOs\" --mode\|treat the boss as unset\|rewritten in a later plan" README.md tools/agy/README.md CHANGELOG.md | wc -l`
Expected: `0`. Kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "docs: the 6-part job, the seat preamble, auto mode and the boss typo rule"
```

---

### Task 9: Nghiệm thu trên cổng 4749 (spec §17 bước 4, 6, 7, 8)

**Files:**
- Ngoài repo: worktree `~/bang-ver-accept4` (HEAD) và `~/bang-ver-anchor` (aa3cb17), `~/bang-test-office/`, `~/.bang-test-data/` (`team.json`: W1, W2 agy acc1; C1, C2 claude worker; folder `~/bang-test-office`), `~/.bang-test-data/plan4/` (sao lưu, ghi chép)
- Modify: cuối file kế hoạch này, mục `## Kết quả`

Trong mọi bước: `B=/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver; P=~/.bang-test-data/plan4; export HABBLAUD_DATA_DIR=$HOME/.bang-test-data HABBLAUD_URL=http://127.0.0.1:4749`. `worker-ask` chạy từ repo chính (`$B/tools/agy/bin/worker-ask`), `bang-init` chỉ qua `~/.local/bin/bang-init`. Pid server luôn lấy bằng `pid=$(ss -Hltnp 'sport = :4749' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)`; không `pkill -f`.

- [ ] **Step 1: Sao lưu, worktree, build, start**
```bash
mkdir -p $P && md5sum ~/.bang-test-data/team.json > $P/team.md5 && cp ~/bang-test-office/task_board.md $P/task_board.before.md
cd $B && git worktree add ~/bang-ver-accept4 HEAD && cd ~/bang-ver-accept4 && ln -s $B/node_modules node_modules
HABBLAUD_PORT=4749 sh scripts/office.sh start; sleep 8; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4749/
ss -Hltn 'sport = :4747' | wc -l
```
Expected: `200`; `1`. Build lỗi vì link `node_modules` → `rm node_modules && npm ci --prefer-offline` trong worktree.

- [ ] **Step 2: Làm mới fixture bằng `bang-init` mới (M13, I4)**
```bash
readlink -f ~/.local/bin/bang-init
rm ~/bang-test-office/task_board.md && ~/.local/bin/bang-init ~/bang-test-office; echo "exit=$?"
sed -n 2p ~/bang-test-office/task_board.md; grep -c "OCR\|| T1 |" ~/bang-test-office/task_board.md
grep -c '"/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver/skills"' ~/bang-test-office/.agents/skills.json
mkdir -p ~/bang-test-office/data ~/bang-test-office/out && printf '3\n5\n34\n' > ~/bang-test-office/data/nums.txt
```
Expected: `$B/tools/agy/bin/bang-init`; `exit=0`, `already the office folder`; dòng 2 `_Office: /home/nhatbang/bang-test-office · Boss: claude/default · Ghế: W1 agy/acc1, W2 agy/acc1, C1 claude/worker, C2 claude/worker_`; `0`; `1`. Bảng cũ có dòng ví dụ được cảnh báo:
```bash
x=$(mktemp -d); cp $P/task_board.before.md $x/task_board.md
HABBLAUD_DATA_DIR=$x ~/.local/bin/bang-init $x | grep -c "example rows"; cmp $P/task_board.before.md $x/task_board.md && echo SAME; rm -r $x
```
Expected: `1`, `SAME`.

- [ ] **Step 3: Bước 4 — thiếu tiêu đề bị từ chối, không có việc nào**
```bash
n0=$(curl -s http://127.0.0.1:4749/api/snapshot | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("team",{}).get("jobs",[])))')
$B/tools/agy/bin/worker-ask W1 "Trả lời đúng một dòng: R-OK"; echo "exit=$?"
curl -s http://127.0.0.1:4749/api/snapshot | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("team",{}).get("jobs",[])))'
```
Expected: stderr `the prompt lacks # Việc <ID> — <tên>, ## Bối cảnh, ## Input, ## Skill dùng, ## Cách làm, ## Output, ## Tiêu chí review: … --raw …`, `exit=1`, số việc vẫn bằng `n0`.

- [ ] **Step 4: Bước 4 — `--raw` qua; `auto` mặc định ghi được file; bảng hiện chữ của boss**
```bash
$B/tools/agy/bin/worker-ask W1 "Tạo file out/auto-probe.txt chứa đúng chữ A-OK, rồi trả lời đúng một dòng: A-OK" --raw --timeout 300; echo "exit=$?"
cat ~/bang-test-office/out/auto-probe.txt
curl -s http://127.0.0.1:4749/api/snapshot | python3 -c 'import json,sys; s=json.load(sys.stdin); print(s["team"]["jobs"][0]["prompt"][:40]); print(sum(i["text"].startswith("Bạn là ghế") for r in s["rooms"] for i in (r.get("board") or {}).get("items", [])))'
```
Expected: `A-OK`, `exit=0`; file `A-OK`; dòng bắt đầu bằng `Tạo file out/auto-probe.txt`; `0`. **Nếu `auto` bị agy từ chối trên acc1: dừng nghiệm thu, ghi nguyên văn lỗi vào Kết quả và hỏi controller** (Quyết định 7 sai).

- [ ] **Step 5: Bước 6 — người chạy làm boss theo `skills/giao-viec/SKILL.md`, vòng ❌ → sửa → ✅**
Đọc `$B/skills/giao-viec/SKILL.md` và làm đúng từng mục của nó, trong `~/bang-test-office`:
1. Thêm dòng `| T1 | Tổng các số trong data/nums.txt | W1 | todo | out/sum.txt đúng, review ✅ | <giờ> |` vào "Việc đang làm".
2. Giao T1 cho W1, chạy nền (`run_in_background`), prompt đúng nguyên văn dưới đây. "Output" cố ý không nói định dạng mà tiêu chí đòi, để lần review đầu ❌:
```
# Việc T1 — Tổng các số trong data/nums.txt
## Bối cảnh    Bài thử nghiệm thu Kế hoạch 4: vòng review của boss.
## Input       data/nums.txt: 3 dòng, mỗi dòng một số nguyên (mẫu: "3"). KHÔNG sửa gì trong data/.
## Skill dùng  bang-task: khi cập nhật dòng T1 trong task_board.md.
## Cách làm    1. Đọc data/nums.txt. 2. Cộng các số. 3. Ghi kết quả vào out/sum.txt.
               Gặp dòng không phải số → ghi "blocked: dòng lạ" vào dòng T1 và DỪNG, không đoán.
               Chỉ ghi trong out/ và dòng T1; không cài gì, không commit.
## Output      out/sum.txt chứa tổng; cập nhật dòng T1 (done | blocked: …); báo cáo ≤10 dòng.
## Tiêu chí review  test "$(cat out/sum.txt)" = "TOTAL=42" && echo PASS || echo FAIL → PASS
```
3. Việc về: tự chạy lệnh tiêu chí trong `~/bang-test-office`. Mong đợi `FAIL` → dòng T1 thành `doing: sửa 1/2 — review ❌ out/sum.txt là "<nội dung>", cần "TOTAL=42"`.
4. Job sửa cho W1: đủ 6 phần (Output sửa thành `out/sum.txt đúng một dòng dạng TOTAL=<tổng>`) + `## Kết quả review lần trước` (lệnh, output `FAIL`, nội dung file). Review lại → `PASS`.
5. ✅: chuyển T1 sang "Đã xong" (`| T1 | Tổng các số trong data/nums.txt | <giờ> | out/sum.txt | ✅ sau 1 lần sửa |`), thêm vào "Bài học": `- Khi giao việc ghi file kết quả → ghi định dạng chính xác của file trong ## Output (vì T1 ghi "<nội dung lần 1>" thay vì "TOTAL=42") [T1]`.
6. Giao T2 cho W1 (6 phần, không chứa chữ `TOTAL`): đếm số dòng của `data/nums.txt`, ghi `out/count.txt` đúng một dòng `LINES=<n>`; tiêu chí `test "$(cat out/count.txt)" = "LINES=3" && echo PASS`. Khi xong, CHỈ ĐỌC transcript của hội thoại mới nhất của acc1:
```bash
t=$(ls -td ~/.agy_profiles/acc1/.gemini/antigravity-cli/brain/*/ | head -1).system_generated/logs/transcript.jsonl
python3 -c 'import json,sys; s=next(json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if "\"USER_INPUT\"" in l); c=json.dumps(s, ensure_ascii=False); print("preamble" if "Bạn là ghế W1 trong office /home/nhatbang/bang-test-office" in c else "NO preamble", "lesson" if "TOTAL=42" in c else "NO lesson", "task" if "# Việc T2" in c else "NO task")' "$t"
```
Expected: `preamble lesson task`. Ghi vào Kết quả: hai prompt đã gửi, output review từng vòng, các dòng T1/T2/Bài học cuối cùng của `task_board.md`. Lần review đầu đã `PASS` (không ❌) → ghi "nhánh ❌ chưa được thử" và báo controller, không bịa lỗi.

- [ ] **Step 6: Bước 7 — headless vẫn có lời mở đầu; `plan` headless trả kế hoạch rồi dừng**
```bash
HABBLAUD_URL=http://127.0.0.1:9 $B/tools/agy/bin/worker-ask W2 "Chép nguyên văn dòng đầu tiên của tin nhắn bạn nhận được, và dòng đầu tiên nằm dưới tiêu đề '## Bài học (từ task_board.md)' trong tin nhắn đó. Không làm gì khác." --raw --timeout 300; echo "exit=$?"
tail -n 2 ~/.agy_profiles/agy-ask.log.jsonl | grep -c '"prompt": "Bạn là ghế'
HABBLAUD_URL=http://127.0.0.1:9 $B/tools/agy/bin/worker-ask W2 "Tạo file out/plan-probe.txt chứa chữ P" --raw --mode plan --timeout 300; echo "exit=$?"
test -e ~/bang-test-office/out/plan-probe.txt && echo EXISTS || echo ABSENT
```
Expected: câu trả lời có `Bạn là ghế W2 trong office /home/nhatbang/bang-test-office` và `- Khi giao việc ghi file kết quả`, `exit=0`; `0` (log ghi chữ của boss); lần hai in một bản kế hoạch, `exit=0`; `ABSENT`. Đọc `/api/snapshot` của 4749 như Step 4: không mục bảng nào bắt đầu bằng `Bạn là ghế` (AgySource thấy việc headless của acc1).

- [ ] **Step 7: Bước 8 — test, số dòng**
```bash
cd $B && npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)
git diff --shortstat 89d38d5..HEAD -- server client shared tools scripts ':!*.test.ts' ':!tools/agy/tests'
git diff --shortstat 89d38d5..HEAD -- skills templates
```
Expected: xanh (trừ flaky); dòng thêm ròng của code không-test ≤ +300 (ước tính ≈ +90); ghi số test và số dòng.

- [ ] **Step 8: Bước 8 — RSS rảnh, A/B với mốc aa3cb17**
```bash
cd $B && git worktree add ~/bang-ver-anchor aa3cb17 && cd ~/bang-ver-anchor && ln -s $B/node_modules node_modules && npm run build
cd ~/bang-ver-accept4 && HABBLAUD_PORT=4749 sh scripts/office.sh stop
```
Ba cặp xen kẽ, mốc trước. Hai bản chạy cùng một cách, không qua `office.sh` (bản aa3cb17 build lại mỗi lần start và ghi đè `~/.habblaud/office.log` của người dùng): `wt` = `~/bang-ver-anchor` hoặc `~/bang-ver-accept4`; `(cd $wt && HABBLAUD_PORT=4749 HABBLAUD_PTY=1 setsid nohup node dist/server/index.js > $P/rss-$(basename $wt)-$i.log 2>&1 < /dev/null &)`, `sleep 60`, đọc `ps -o rss= -p $pid` 3 lần cách 10 s, rồi dừng bằng `[ "$(readlink /proc/$pid/cwd)" = "$wt" ] && kill $pid` và chờ tới khi `ss -Hltn 'sport = :4749' | wc -l` là `0`. Sau mỗi lượt `ss -Hltn 'sport = :4747' | wc -l` → `1`.
Expected: trung vị HEAD ≤ trung vị mốc × 1,03. Ghi 18 số đọc.

- [ ] **Step 9 (tuỳ chọn): boss Claude thật tự đọc skill**
Mặc định ghi "chờ người dùng (gộp nghiệm thu Kế hoạch 5: boss mở từ trang trong `~/bang-test-office` sau khi người dùng tin cậy thư mục cho tài khoản mặc định)". Chỉ chạy khi controller đồng ý (câu hỏi mở 3), từ thư mục Claude đã tin cậy:
```bash
cd /home/nhatbang/Agent_4_me && timeout 1800 env -u CLAUDECODE -u AI_AGENT -u CLAUDE_PID -u CLAUDE_EFFORT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_SESSION_ID \
  -u CLAUDE_CODE_SESSION_ATTENDED -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SSE_PORT \
  claude -p "You are the boss of the Bang_ver office in /home/nhatbang/bang-test-office. Read /home/nhatbang/bang-test-office/.claude/skills/giao-viec/SKILL.md and follow it to have W2 write out/max.txt with the largest number of data/nums.txt (job T3). Run worker-ask in the foreground. At the end print the T3 row and the Bài học section of task_board.md." \
  --add-dir /home/nhatbang/bang-test-office --permission-mode auto --output-format json
```
Expected: T3 ở "Đã xong" với ✅; không có lần `worker-ask` nào exit 1 vì thiếu tiêu đề (xem `~/.agy_profiles/agy-ask.log.jsonl` hoặc snapshot). Lỗi quyền/hook/timeout → ghi "chờ người dùng" kèm lỗi, không coi là lỗi của kế hoạch.

- [ ] **Step 10: Dọn và ghi kết quả**
```bash
cd ~/bang-ver-accept4 && HABBLAUD_PORT=4749 sh scripts/office.sh stop 2>/dev/null; ss -Hltn 'sport = :4749' | wc -l; ss -Hltn 'sport = :4747' | wc -l
cd $B && git worktree remove --force ~/bang-ver-accept4 && git worktree remove --force ~/bang-ver-anchor
md5sum -c $P/team.md5
```
Expected: `0`, `1`, `team.json: OK`. Giữ `~/bang-test-office` (giờ có bảng mới, `data/`, `out/`) và `~/.bang-test-data` cho Kế hoạch 5. Ghi vào `## Kết quả`: Step 2–9 (exit, output chính, prompt và review của Step 5, 18 số RSS, số test, số dòng), điều còn chờ người dùng.
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 4 acceptance results"
```

---

## Tự kiểm sau khi viết

Spec §10 (mẫu): `templates/` giữ nguyên văn (Task 6 Step 3 chạy lại script kiểm); bản chép không còn dòng ví dụ, có ghế thật (Task 6, Quyết định 8); kiểm thật Task 9 Step 2.

Spec §11 (`giao-viec`):
- Mẫu 6 phần nguyên văn trong skill: Task 7 (test so với spec).
- Quy trình 1 (tạo dòng việc trước; chạy nền `run_in_background`/`&`): Task 7 mục 1, 3.
- Quy trình 2 (boss tự chạy lệnh tiêu chí, ghi ✅/❌ vào dòng): Task 7 mục 4; kiểm thật Task 9 Step 5.
- Quy trình 3 (❌ → job sửa đủ 6 phần + "Kết quả review lần trước"; ≤2 vòng, lần ba hỏi người dùng): Task 7; Task 9 Step 5.
- Quy trình 4 (✅ → Đã xong + một dòng Bài học `Khi … → … (vì …) [ID]`): Task 7; Task 9 Step 5.
- Quy trình 5 (`--mode plan` khi xoá/ghi ngoài output/chạm dữ liệu gốc/cài): Task 7 mục 3.
- Ép buộc (từ chối thiếu tiêu đề, exit 1, in tiêu đề thiếu; `--raw`): Task 1 (Quyết định 1, 2); Task 9 Step 3–4.

Spec §12 (lời mở đầu): ghép một lần ở `parse()`, nguyên văn, cả hai loại agent, office lẫn headless: Task 4; Bài học từ folder office: Task 4 (test `--cwd`); tên ghế + folder: Task 4; kiểm thật Task 9 Step 5 (transcript) và Step 6 (headless). Bảng việc không hiện lời mở đầu: Task 3 (Quyết định 4). Trần 20k: Task 3 + Task 4 (Quyết định 5); đường `/api/agy/jobs` đã xét (Quyết định 5, 6).

Spec §14 (chế độ): `auto` mặc định cho agy: Task 2 (Quyết định 7), kiểm thật Task 9 Step 4; `plan` theo việc do boss chọn: Task 7; plan headless trả kế hoạch rồi kết thúc: Task 9 Step 6; ghế Claude: câu hỏi mở 1.

Spec §17: bước 4 Task 9 Step 3–4; bước 6 Task 9 Step 5 (+ Step 9 tuỳ chọn); bước 7 Task 9 Step 6; bước 8 Task 9 Step 7–8 (cổng RSS theo mốc aa3cb17 + 3 %, A/B, 3 cặp).

Spec §3 (phản mục tiêu): không plugin, không ghi dưới `.gemini` (Task 9 chỉ đọc), headless giữ (Task 9 Step 6), ≤300 dòng (Task 9 Step 7), RSS (Task 9 Step 8).

Bàn giao Kế hoạch 3: lời mở đầu ở một chỗ, Bài học từ folder office (Task 4); M13 (Task 6); `--raw` parse rõ ràng, kiểm trên `a["task"]` (Task 1); trần 20k + `/api/agy/jobs` (Task 3, Quyết định 5); viết lại `giao-viec`: bảng exit có từ chối tin cậy, bỏ "(Habblaud)" và "auto is not available" (Task 7 test); `bang-init` chỉ qua `~/.local/bin` (Global Constraints, Task 9 Step 2); fixture trỏ repo chính (Task 9 Step 2); M8 (Task 5); M14 (Task 1, Quyết định 10); M12 phần `skill-dirs` trong bảng (Task 8). Bàn giao Kế hoạch 2: mặc định agy `plan` → `auto` (Task 2). Để lại: lời nhắc dùng 7 ghế khi 4747 khởi động lại (đã có trong `bang-init`), M2, dọn hội thoại headless dưới `.gemini`.

## Câu hỏi mở (đề xuất của người viết)

1. **Ghế Claude mặc định `auto`?** Spec §14 nói `auto` cho mọi worker; `claude --permission-mode auto` có trong CLI nhưng chưa ghế Claude nào chạy được trên máy này. Đề xuất: giữ `default` ở Kế hoạch 4, đổi sau lần chạy thật đầu tiên của C1 (Kế hoạch 5).
2. **Việc gõ trên trang vào terminal ghế không có lời mở đầu** (Quyết định 6). Đề xuất: chấp nhận (việc tay của người dùng); nếu muốn có, trang gửi qua `worker-ask` thay vì POST thẳng — để sau v1.
3. **Step 9 (boss Claude headless từ `/home/nhatbang/Agent_4_me`, tài khoản mặc định, qua hook và claude-mem của người dùng)**: đề xuất không chạy; gộp vào nghiệm thu Kế hoạch 5 với boss mở từ trang.

## Spec cần sửa

- §11 "6 tiêu đề": mẫu có tiêu đề việc + 6 mục; kế hoạch kiểm cả 7 (Quyết định 1).
- §11 mẫu, dòng "Skill dùng": "đọc .agents/skills/<tên>/SKILL.md" không còn đúng: skill nạp theo tên qua `.agents/skills.json` (§8) và `.claude/skills`; không có thư mục `.agents/skills/`. Skill `giao-viec` ghi chú điều này dưới mẫu (mẫu giữ nguyên văn).
- §12 "Thay `apply_rules` (worker-ask:472–492)": hàm đó không còn (file 449 dòng); chỗ ghép là `parse()` :104–149.
- §12 câu "rồi chạy lệnh advisor … và chờ trả lời, rồi ghi `blocked:` và dừng" đọc như luôn ghi `blocked:` sau khi hỏi; ý đúng là "không có trả lời thì". Giữ nguyên văn; Kế hoạch 5 sửa cả spec lẫn lời mở đầu nếu cần.
- §16 "giới hạn 20k ở `service.ts:262`": ở :247 (:262 là trần câu trả lời), và phải tính theo byte vì argv (Quyết định 5).
- §7 bảng: `worker-ask:696`, `:635` là số dòng của fork (nay :370, :308).
- §17 bước 8 "≤ 110MB": thay bằng cổng theo mốc (đã ghi ở Kế hoạch 3).

## Để lại cho kế hoạch sau

_(Điền khi xong Task 9.)_ Đã biết trước: thẻ `[ADVISOR …]` và cách boss trả lời advisor trong `giao-viec` (Kế hoạch 5); câu hỏi mở 1–3; `worker-ask` tự xưng `agy-ask:` trong mọi thông báo khi chạy dưới tên `worker-ask` (`CMD`, :47); dọn hội thoại headless dưới `.gemini` (`worker-ask:329–335`) đối chiếu phản mục tiêu §3.

## Kết quả

_(Task 9 ghi vào đây.)_
