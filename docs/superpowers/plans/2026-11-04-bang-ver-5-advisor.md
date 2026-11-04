# Bang_ver — Kế hoạch 5/6: lệnh `advisor` (worker hỏi lại boss)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker kẹt chạy `advisor "<câu hỏi>"`; server gõ câu hỏi vào terminal boss Claude theo khung đã kiểm ở spike, đọc câu trả lời có thẻ `[ADVISOR <ghế> <việc>]` trong transcript của boss, trả nguyên văn cho CLI (exit 0; 1–5 khi lỗi), hiện câu hỏi trên feed và trên nhân vật, ghi câu hỏi vào việc đang chạy của ghế và một dòng vào "Hỏi đáp" của `task_board.md`; skill `giao-viec` dạy boss cách trả lời, skill `advisor` thành bản thật.

**Architecture:** Một module mới `server/workers/advisor.ts`: vài hàm thuần (làm sạch câu hỏi, khung dán, khớp thẻ, chèn dòng Hỏi đáp) và lớp `Advisor` giữ các câu hỏi đang mở, với `tick()` 500 ms chỉ chạy khi có câu hỏi. Nó không biết `TeamService`, `PtyManager` hay `Office`: `index.ts` đưa vào vài hàm nhỏ (boss gõ được hay lý do không, `typeTo`, ghế + việc đang chạy, ghi activity, folder). Hai route `POST /api/advisor`, `GET /api/advisor/<id>?wait=` sau cùng rào loopback với `/api/workers/`. CLI `tools/agy/bin/advisor` là Python không deps, nói chuyện với server như `worker-ask`. Phía boss chỉ là chữ trong skill.

**Tech Stack:** Node ≥22 + TypeScript + vitest; Python 3 + pytest (`tools/agy/tests`); Markdown (skills, docs).

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-design.md` (§13 là lõi; §6 env `BANG_SLOT`/`BANG_OFFICE` và "boss = terminal server mở hoặc tiếp quản", §12 lời mở đầu nêu lệnh, §17 bước 5, §18, §20 làm ngữ cảnh). Cơ chế ĐÃ KIỂM: `docs/superpowers/plans/2026-11-04-advisor-spike.md` (dán bracketed paste + `\r`, chỉ khớp `type == "assistant"`, gõ lại một lần khi câu hỏi bị nuốt trong lượt có công cụ, không gõ khi boss `waiting`/pending/không PTY, làm sạch ESC và ký tự điều khiển, trần ~1500 ký tự, gợi ý exit 2/3/4/5, hai người hỏi được trả lời trong một tin). Bàn giao: "Để lại cho kế hoạch sau" và "Kết quả" của `2026-11-04-bang-ver-4-giao-viec.md`.

Phán quyết của controller và người dùng (ràng buộc như spec):
- CLI `advisor "<câu hỏi>"` ở `tools/agy/bin/advisor` (Python như `worker-ask`, không deps): đọc `BANG_SLOT`/`BANG_OFFICE` (+`HABBLAUD_URL`), `POST /api/advisor {slot, question}`, long-poll `GET /api/advisor/:id?wait=`, in câu trả lời, exit 0; exit 1 lỗi chung/cách dùng, 2 không có terminal boss, 3 boss đang chờ người dùng, 4 hết giờ (mặc định 10 phút), 5 trả lời không có thẻ. `install.sh` link nó vào `~/.local/bin`, chỉ thử trong HOME tạm (cài thật do controller chạy sau).
- Module server nhỏ, file riêng, có test: gõ khung theo spike, cổng trạng thái boss, khớp transcript với `FileTail.seekEnd()` trước khi gõ, gõ lại một lần sau khi boss rảnh, hết giờ, làm sạch; ghi câu hỏi vào việc đang chạy của ghế, một dòng feed (`❓ W2 …`) và dấu hiệu chờ boss trên nhân vật; một dòng vào "Hỏi đáp" của `<folder office>/task_board.md` (nguyên tử, chỉ mục đó, an toàn khi thiếu). Chữ hiển thị qua `tr()` + `vi.ts`.
- Phía boss: `giao-viec` thêm mục ngắn: trả lời khung ❓ thế nào (mở đầu đúng thẻ, chỉ chữ, ngắn), vẫn giao việc chạy nền; `advisor/SKILL.md` bản cuối; lời mở đầu trong `worker-ask` đã nêu lệnh (kiểm khớp).
- Nghiệm thu (task áp chót) trên 4749 từ worktree, boss/ghế giả khi bản thật cần người dùng đăng nhập; boss Claude thật chỉ khi `~/bang-test-office` đã được tin cậy, không thì "chờ người dùng"; §17 bước 5; kiểm M2 (boss agy/worker tráo hội thoại) trong chừng mực an toàn; ghi vào `## Kết quả`. Task cuối: danh sách bàn giao cho Kế hoạch 6.

## Global Constraints

- Không thêm runtime dependency; `dependencies` trong `package.json` vẫn không có.
- Mọi chữ hiển thị trên trang và mọi chữ server gõ cho boss qua `tr('English text')`; bản dịch duy nhất ở `shared/locales/vi.ts`; `npm run i18n:check` 0 thiếu, 0 khoá thừa. CLI Python in tiếng Anh.
- Code, comment, tài liệu, nội dung SKILL.md bằng tiếng Anh. Tiếng Việt nguyên văn spec chỉ ở: bản dịch `vi.ts` của khung câu hỏi (spec §13), tên mục `task_board.md` (`## Hỏi đáp`), dòng ví dụ tiếng Việt của khung trong `giao-viec`. Kế hoạch tiếng Việt.
- Sau mỗi task: `npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)` xanh, cộng `bash -n` cho mọi script bash task đó sửa. Không `py_compile` `advisor` hay `worker-ask` (để lại `__pycache__` trong `tools/agy/bin`). Được phép đỏ chỉ các test flaky đã biết: `server/sources/tail.test.ts > detects replaced file (rotation) even if larger`, `server/sources/watcher.test.ts > tracks transcript appends and registry status`, `server/sources/watcher.test.ts > /clear: same process, new session — same character, reset tasks`, `art.test.ts > floor chunks` khi máy đang tải. Không sửa, không `skip` chúng.
- Mỗi task một commit; mọi commit kết thúc bằng đúng hai dòng:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKo78y8zx9LkivRuQac
  ```
- Phản mục tiêu §3 là giới hạn cứng: không plugin Claude; code của ta không ghi gì dưới `~/.agy_profiles/accN/.gemini/`; giữ đường headless; tính năng này thêm ròng ≤ 300 dòng code không-test (`server client shared tools scripts`, trừ `*.test.ts` và `tools/agy/tests`; ước tính: `advisor.ts` ≈150, CLI ≈65, route ≈22, nối ở `index.ts` ≈18, `service.ts` ≈12, `vi.ts` ≈13, types 1 → ≈280); server rảnh không nặng hơn: không có timer nào khi không có câu hỏi đang mở.
- Không chạy `npm run build` hay `npm run office` trong repo chính: server 4747 của người dùng chạy từ `dist/` của repo này. Không dừng, không khởi động lại nó. Build và chạy thử chỉ trong worktree (Task 6). Không `pkill -f`; pid lấy bằng `ss`.
- Không đụng `~/.claude*`, `~/.local/bin`, `~/.agy_profiles`, `~/.habblaud`. Ngoại lệ, chỉ ở Task 6: (a) đọc MỘT khoá của `~/.claude.json` (CHỈ ĐỌC); (b) nếu thư mục đã tin cậy: mở MỘT boss Claude thật (tài khoản mặc định) từ trang 4749 trong `~/bang-test-office` (Claude Code tự ghi phiên của nó dưới `~/.claude/projects/` như spike; controller đã cho phép), chỉ gõ vào terminal boss này (và terminal boss agy mở ở Task 6 Step 6), đóng chúng ở cuối; (c) việc agy trên `acc1` (đã duyệt ở Kế hoạch 4), CHỈ ĐỌC transcript của acc1 và `~/.agy_profiles/agy-ask.log.jsonl`; (d) bước M2 sửa `~/.bang-test-data/team.json` (dữ liệu thử) có sao lưu và trả lại đúng md5. Không bao giờ duyệt hộp thoại quyền trong terminal của ghế thay người dùng. Test Python dựng env mới, bỏ `AGY_*`, `BANG_*`, `CLAUDE*`, `HABBLAUD_*` của người chạy; `install.sh` chỉ chạy trong HOME tạm.
- Ngoài phạm vi: deploy (Kế hoạch 6); boss agy gõ được (advisor từ chối boss agy, exit 2) trừ khi đã kiểm; mô hình "advisor" headless thay boss; sửa M2 (chỉ kiểm); đổi chữ lời mở đầu §12 (ghi ở "Spec cần sửa"); test flaky; ghế Claude mặc định `auto` (câu hỏi mở 1 của Kế hoạch 4).

## Quyết định của người viết kế hoạch (controller xem lại)

1. **Thẻ.** `[ADVISOR <ghế> <ref>]`; `ref` = ID dòng việc lấy từ tiêu đề việc đang chạy của ghế (`# Việc T2 — …` → `T2`, khớp `[\w.-]{1,20}`), không có thì id WorkerJob (`w…`), không có việc nào thì `-`. Không bắt buộc có việc: ghế mở tay và nghiệm thu (hỏi từ shell với `BANG_SLOT=W2`) không có việc. Cùng ghế + cùng `ref` hỏi lần thứ n (n ≥ 2) trong đời server → `ref#n` (`T2#2`), để câu trả lời muộn của câu trước không thành câu trả lời của câu sau. Thẻ đi vào khung như một tham số `{3}`, nên bản dịch không làm sai nó; regex khớp không bao giờ dịch.
2. **Khung.** Qua `tr()`: khoá tiếng Anh là chữ của spike, bản `vi` là chữ spec §13 nguyên văn (boss thấy tiếng Việt khi server chạy tiếng Việt). Tuân thủ thẻ 7/7 ở spike chỉ đo bằng tiếng Anh: Task 6 đo bằng ngôn ngữ thật của server và ghi lại. Không thêm câu "No preface, no footer" (chưa kiểm, lệch spec); đuôi `Skipped: …` do hook của người dùng đi kèm câu trả lời, chấp nhận. Gõ hai lần: dán `ESC[200~…ESC[201~` ngay khi qua cổng, `\r` ở tick kế tiếp chỉ khi boss không `waiting` (rủi ro là `\r` chọn "Yes" ở một hộp thoại; spike 1e: `\r` tách rời vẫn gửi được); còn `waiting` thì `\r` chờ tới khi hết hoặc hết giờ. Hai câu hỏi trong cùng một tick đi chung một tin (boss trả lời hai thẻ, spike 4); `\r` thừa trên ô trống vô hại.
3. **Cổng: từ chối ngay, không gõ, không ghi gì** (409 kèm `code`). Boss là agy → `no-boss`, "the boss is an Antigravity account: advisor reaches only a Claude Code boss for now". Không có id boss, boss đang pending (chưa vào office), không có PTY đang chạy của nó, hoặc trạng thái không thuộc `idle | working | shell | waiting` → `no-boss`, "no boss terminal: open the boss from the page (the + beside Boss)". `waiting` → `boss-waiting`, "the boss is waiting for you: <waitingFor>". Gõ khi `idle`, `working` (Claude Code xếp hàng), `shell` (lượt xong, việc nền đang chạy: trạng thái thường gặp của boss làm theo `giao-viec`).
4. **Đọc câu trả lời.** Mỗi câu hỏi một `FileTail` trên transcript boss, `seekEnd()` ngay trước khi dán; đường dẫn = `agents.transcriptPathOf(boss)`, không có thì `claudeTranscriptPath(<thư mục tài khoản>, <thư mục phòng>, sessionId)` (boss mới mở chưa có file tới prompt đầu; `FileTail` đọc từ 0 khi file xuất hiện). Chỉ khối `text` của dòng `type == "assistant"`; thẻ ở đầu dòng (cho phép khoảng trắng trước); câu trả lời = chữ sau thẻ tới `\n<khoảng trắng>[ADVISOR ` kế tiếp hoặc hết, trim. Thẻ giữa dòng không tính (boss trích lại khung).
5. **Máy trạng thái, mốc giờ** (`ADVISOR_TIMING`): tick 500 ms; trần 10 phút (server giữ); sau `\r`, thấy boss `working` thì "vũ trang" việc gõ lại; đã vũ trang mà boss `idle|shell` liền 5 s không có thẻ → dán lại MỘT lần (cùng hai bước); chưa từng thấy `working` 20 s sau `\r` (dán không được gửi) → cũng gõ lại một lần; sau lần gõ lại, 60 s kể từ `\r` mà boss không `working` và không có thẻ → `untagged`; PTY boss mất hoặc boss đổi → `no-boss`.
6. **"Chờ boss" trên nhân vật = bong bóng + feed, không đổi `AgentStatus`.** Lúc hỏi: activity `{kind: 'wait', icon: '❓', text: tr('Asks the boss: {0}'), detail: <câu hỏi>}` trên nhân vật của ghế → feed hiện "W2 ❓ Asks the boss: …" và bong bóng giữ tới khi có activity mới. Có trả lời: `{kind: 'communicate', icon: '💬', text: tr('The boss answered'), detail: <câu trả lời>}`. Thất bại: `{kind: 'error', icon: '⚠️', text: tr('No answer from the boss'), detail: <lý do>, error: true}`. Không dùng `setStatus(…, 'waiting')`: nó bật thông báo cảnh báo "✋ W2 needs you" cho NGƯỜI DÙNG (sai người, boss mới là người được gõ), và `AgySource.poll` (`source.ts:418–422`) lẫn `WorkerService.showClaude` đặt lại trạng thái mỗi lượt, nên phải nối thêm ba chỗ (`statusOf`, AgySource, showClaude) ≈10 dòng trong khi trần 300 dòng đã sát. Controller có thể đảo.
7. **Ghi vào việc:** `WorkerJob.question?: string` = câu hỏi gần nhất của ghế trong việc này (≤300 ký tự, che bí mật), thấy ở `/api/snapshot` (`team.jobs`) và `GET /api/workers/jobs/<id>`; không UI mới.
8. **Dòng Hỏi đáp chỉ khi có trả lời** (spec §13). `| MM-DD HH:MM | W2 (T2) | <hỏi> | <trả lời> |` (giờ máy; `ref == '-'` → cột Ai chỉ là `W2`); ô: xuống dòng → dấu cách, `|` → `\|`, mỗi ô ≤300 ký tự. Chèn sau dòng bảng cuối của mục bắt đầu bằng `## Hỏi đáp`; bảng chỉ có tiêu đề vẫn được. Không file, không mục, mục không có dòng bảng nào → bỏ qua + `log.warnOnce`; câu hỏi vẫn trả lời. Ghi tmp + rename trong cùng thư mục, phần còn lại của file giữ nguyên từng byte. Ghi lỗi không bao giờ làm hỏng câu hỏi. Hai người ghi cùng lúc: rủi ro §18 đã chấp nhận.
9. **CLI.** Các đối số nối bằng dấu cách; rỗng hoặc bắt đầu bằng `-` → in cách dùng, exit 1. `BANG_SLOT` bắt buộc (thiếu → exit 1); `BANG_OFFICE` gửi thành `office` khi có (server: 400 nếu không phải folder office). Exit: 0 in câu trả lời ra stdout; 1 cách dùng, thiếu `BANG_SLOT`, 400, 403, mất office giữa chừng, lỗi khác; 2 `no-boss`, office không chạy (từ chối kết nối) hoặc 404/503 (office không có terminal); 3 `boss-waiting`; 4 `timeout` (của server, hoặc CLI tự dừng sau 11 phút); 5 `untagged`. Mọi exit khác 0 in lý do và "write blocked: <your question> in your row of task_board.md and stop". Không có `--timeout`: server giữ trần. Giết CLI không huỷ câu hỏi: câu trả lời muộn vẫn vào feed và bảng (không có route huỷ, YAGNI).
10. **Long-poll:** `Advisor.wait(id, s)` kiểm lại mỗi 200 ms tới khi câu hỏi xong hoặc hết `s` (≤60); không có bản đồ waiter.
11. **Lời mở đầu §12 giữ nguyên văn** (Kế hoạch 4 đã chép nó vào `worker-ask` và `PRE` của test); skill `advisor` nói rõ "không có trả lời → `blocked:`". Câu "rồi ghi `blocked:` và dừng" vào "Spec cần sửa".
12. **`install.sh` không đổi** (dòng 26 đã link `advisor` khi file có); chỉ lật `test_install.py:77` và sửa comment dòng 2.
13. **Ghế agy hỏi thật:** `advisor` là lệnh shell; trong terminal office, agy dừng ở "Run this command?" cho mọi lệnh (chẩn đoán Kế hoạch 4), người dùng duyệt trên trang. Skill `advisor` nói vậy. Nghiệm thu giả ghế từ shell của người chạy; bản ghế thật là bước tuỳ chọn, mặc định "chờ người dùng duyệt". Ghế Claude: Bash tool mặc định 2 phút → skill bảo gọi với `timeout: 600000`.
14. **M2 chỉ kiểm, không sửa** (Task 6 bước tuỳ chọn): boss agy nằm ngoài phạm vi advisor.

## Review Focus

1. **Câu hỏi chứa `\x1b[201~`, `\r`, `\x9b`, `\t`, `|`, xuống dòng**: dán không bị kết thúc sớm, không ký tự điều khiển nào tới terminal boss, bảng Hỏi đáp không vỡ. → Task 1 (hai test).
2. **Boss chuyển sang `waiting` giữa lúc dán và `\r`**: `\r` bị giữ, không bao giờ gửi vào một hộp thoại. → Task 2 (test "the Enter waits").
3. **Hai ghế hỏi trong một lượt boss**: một tin, hai thẻ, mỗi ghế nhận đúng phần của mình; cùng ghế cùng việc hỏi lại thành `T2#2`. → Task 1 (`findAnswer`) + Task 2.
4. **Câu hỏi bị nuốt trong lượt có công cụ**: gõ lại một lần chỉ sau `working` rồi `idle|shell` 5 s; không gõ lại khi boss còn `idle` trước lượt; trượt lần hai → `untagged`. → Task 2.
5. **`task_board.md` không có, không có mục Hỏi đáp, bảng chỉ tiêu đề, mục khác phía sau**: chỉ mục đó đổi, ghi nguyên tử, câu trả lời vẫn về CLI, bảng không bị tạo mới. → Task 1 + Task 2.

---

### Task 1: Hàm thuần — làm sạch câu hỏi, khung dán, khớp thẻ, dòng Hỏi đáp

**Files:**
- Create: `server/workers/advisor.ts`, `server/workers/advisor.test.ts`
- Modify: `shared/locales/vi.ts` (khoá khung)

**Interfaces:**
- Produces (đầu file `advisor.ts`: comment 3–5 dòng nói luồng: seat → POST → paste vào terminal boss → thẻ trong transcript boss → CLI; nguồn: spec §13, spike):
  - `export const QUESTION_MAX = 1500;`
  - `sanitizeQuestion(s: string): string`: `\r\n`/`\r` → `\n`; `\t` → dấu cách; bỏ mọi ký tự `[\u0000-\u0008\u000b-\u001f\u007f-\u009f]` (ESC, C1 như `\x9b` CSI); trim; `truncate(…, QUESTION_MAX)`.
  - `advisorTag(seat: string, ref: string): string` → `` `[ADVISOR ${seat} ${ref}]` ``.
  - `advisorPaste(seat: string, ref: string, question: string): string` → `'\x1b[200~' + tr('❓ Seat {0} asks (job {1}): {2}\n→ Reply briefly, starting exactly with the tag {3}; that reply is passed verbatim to {0}.', [seat, ref, question, advisorTag(seat, ref)]) + '\x1b[201~'` (không có `\r`: Task 2 gửi riêng). `vi.ts`: `"❓ Ghế {0} hỏi (việc {1}): {2}\n→ Trả lời ngắn, mở đầu đúng bằng thẻ {3}; đoạn trả lời đó được chuyển nguyên văn cho {0}."`.
  - `findAnswer(lines: readonly string[], tag: string): string | undefined` theo Quyết định 4; dòng không phải JSON bỏ qua; câu trả lời đầu tiên khớp thắng.
  - `qaRow(at: number, who: string, question: string, answer: string): string` theo Quyết định 8 (một dòng, không `\n` cuối).
  - `withQaRow(board: string, row: string): string | undefined`: chia theo `\n`; mục = dòng có `line.normalize('NFC').startsWith('## Hỏi đáp')` tới dòng `## ` kế tiếp; chèn `row` sau dòng cuối bắt đầu bằng `|` trong mục; không mục hoặc không dòng `|` → `undefined`.

- [ ] **Step 1: Test (thất bại)** — `advisor.test.ts`:
```ts
const line = (o: object) => JSON.stringify(o);
const say = (text: string) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

it('a question loses control characters and the paste end, keeps its lines, and is capped', () => {
  expect(sanitizeQuestion('a\x1b[201~b\r\nc\td\x9b1m\x07')).toBe('a[201~b\nc d1m');
  expect(sanitizeQuestion('  \x1b x \x00 ')).toBe('x');
  expect(sanitizeQuestion('é'.repeat(2000)).length).toBeLessThanOrEqual(QUESTION_MAX);
});

it('the paste is one bracketed block naming the seat, the job and the exact tag, in every language', () => {
  const p = advisorPaste('W2', 'T2', 'which file?\nline two');
  expect(p.startsWith('\x1b[200~❓ Seat W2 asks (job T2): which file?\nline two\n→ Reply briefly')).toBe(true);
  expect(p.endsWith('.\x1b[201~')).toBe(true);
  expect(p).toContain('starting exactly with the tag [ADVISOR W2 T2]; that reply is passed verbatim to W2.');
  expect(p.slice(6, -6)).not.toContain('\x1b');
  const vi = Object.entries(VI).find(([k]) => k.startsWith('❓ Seat {0} asks'));
  expect(vi?.[1]).toContain('{3}');
});

it('only assistant text after the exact tag at a line start; the next tag ends it; frames, thinking and other tags do not count', () => {
  const frame = '❓ Seat W2 asks (job T2): q\n→ … [ADVISOR W2 T2] …';
  const lines = [
    line({ type: 'user', message: { role: 'user', content: frame } }),
    line({ type: 'queue-operation', operation: 'enqueue', content: frame }),
    line({ type: 'attachment', attachment: { type: 'queued_command', prompt: frame } }),
    'not json',
    say('see [ADVISOR W2 T2] inline'),
    say('[ADVISOR W2 T2#2] the later one'),
    line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '[ADVISOR W2 T2] no' }, { type: 'text', text: 'Sure.\n\n  [ADVISOR W2 T2] Use a.csv.\nIt has the header.\n\n[ADVISOR W3 T5] Skip it.\n\nSkipped: x' }] } }),
  ];
  expect(findAnswer(lines, '[ADVISOR W2 T2]')).toBe('Use a.csv.\nIt has the header.');
  expect(findAnswer(lines, '[ADVISOR W3 T5]')).toBe('Skip it.\n\nSkipped: x');
  expect(findAnswer(lines, '[ADVISOR W2 T2#2]')).toBe('the later one');
  expect(findAnswer(lines.slice(0, 5), '[ADVISOR W2 T2]')).toBeUndefined();
});

it('the row goes after the last line of the Hỏi đáp table and nothing else changes', () => {
  const head = '# Task board\n\n## Hỏi đáp (advisor ghi tự động)\n| Lúc | Ai | Hỏi | Trả lời |\n|---|---|---|---|\n';
  const tail = '\n## Đã xong\n| ID |\n|---|\n| T1 |\n';
  expect(withQaRow(head + tail, '| r1 |')).toBe(`${head}| r1 |\n${tail}`);
  expect(withQaRow(`${head}| r1 |\n${tail}`, '| r2 |')).toBe(`${head}| r1 |\n| r2 |\n${tail}`);
  expect(withQaRow(head, '| r1 |')).toBe(`${head}| r1 |\n`);
  expect(withQaRow('# Task board\n## Đã xong\n| a |\n', '| r |')).toBeUndefined();
  expect(withQaRow('## Hỏi đáp\nno table yet\n## Đã xong\n| a |\n', '| r |')).toBeUndefined();
});

it('a row is one table line: lines joined, pipes escaped, cells capped', () => {
  const r = qaRow(new Date(2026, 10, 4, 15, 7).getTime(), 'W2 (T2)', 'a|b\nc', 'x'.repeat(400));
  expect(r.startsWith('| 11-04 15:07 | W2 (T2) | a\\|b c | xxx')).toBe(true);
  expect(r.includes('\n')).toBe(false);
  expect(r.length).toBeLessThan(360);
});
```
Run: `npx vitest run server/workers/advisor.test.ts` → FAIL (module chưa có).

- [ ] **Step 2: Cài** theo Interfaces; thêm khoá khung vào `vi.ts`.

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(advisor): question frame, tag matcher and Hỏi đáp row helpers"
```

---

### Task 2: Lớp `Advisor` — cổng, gõ hai bước, đọc transcript, gõ lại một lần, hết giờ; việc, feed, bảng

**Files:**
- Modify: `server/workers/advisor.ts`, `server/workers/advisor.test.ts`, `server/workers/service.ts` (hai phương thức mới cạnh `statusOf` :223; `view()` :644 thêm `'question'`), `server/workers/service.test.ts`, `shared/types.ts` (`WorkerJob` :374–392), `shared/locales/vi.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `shared/types.ts` `WorkerJob`: `/** The seat's last question to the boss during this job (advisor), ≤300 characters. */ question?: string;`
  - `WorkerService`:
    - `seatRef(worker: string): { agentId: string; ref: string } | undefined` — nhân vật của ghế và `ref` theo Quyết định 1 (ID từ `/^#\s*Việc\s+([\w.-]{1,20})/u` trên `job.prompt.normalize('NFC')` của việc đang chạy, rồi `job.id`, rồi `'-'`; không có hậu tố `#n`); `undefined` = không phải ghế.
    - `noteQuestion(worker: string, text: string): void` — `job.question = truncate(maskSecrets(text.replace(/\s+/g, ' ')), 300)` trên việc đang chạy (không có thì thôi), rồi `onChange()`.
  - `advisor.ts`:
```ts
export const ADVISOR_TIMING = { pollMs: 500, timeoutMs: 10 * 60_000, idleGraceMs: 5_000, unstartedMs: 20_000, retryWaitMs: 60_000 };
export interface AdvisorBoss { agentId: string; status: AgentStatus; waitingFor?: string; transcript: string }
export type AdvisorStatus = 'asking' | 'answered' | 'no-boss' | 'timeout' | 'untagged';
export interface AdvisorQuestion { id: string; slot: string; ref: string; question: string; status: AdvisorStatus; askedAt: number; endedAt?: number; answer?: string; error?: string }
export type AdvisorAsk = { ok: true; question: AdvisorQuestion } | { ok: false; status: number; error: string; code?: 'no-boss' | 'boss-waiting' };
export interface AdvisorDeps {
  /** The boss the office can type to, or why there is none (shown to the seat). */
  boss: () => AdvisorBoss | string;
  typeTo: (agentId: string, data: string) => boolean;
  seat: (slot: string) => { agentId: string; ref: string } | undefined;
  note: (slot: string, question: string) => void;
  activity: (agentId: string, a: Activity) => void;
  /** The office folder ('' = none): its task_board.md gets the Hỏi đáp row. */
  folder: () => string;
  now?: () => number;
  /** pollMs 0 = no own timer (tests call tick()). */
  timing?: Partial<typeof ADVISOR_TIMING>;
}
export class Advisor {
  constructor(deps: AdvisorDeps);
  ask(input: { slot: string; question: string; office?: string }): AdvisorAsk;
  wait(id: string, waitS: number): Promise<AdvisorQuestion | undefined>;
  tick(): void;
  stop(): void;
}
```
  - `ask`: thứ tự kiểm — `slot` khớp `SEAT_NAME` (`server/team.ts:40`) và `seat(slot)` có, không thì 400 `tr('{0} is not a seat in team.json, or its account is not signed in', [slot])` (khoá đã có); câu hỏi sau `sanitizeQuestion` rỗng → 400 `tr('empty question')`; `office` có mà `resolve(office) !== resolve(folder())` → 400 `tr('{0} asks for the office {1}, not this one ({2})', …)`; cổng theo Quyết định 3 → 409 + `code`. Qua cổng: `ref` thêm `#n` (Map `"<slot> <ref>"` → số lần), `new FileTail(boss.transcript).seekEnd()`, `typeTo(paste)` (false → 409 `no-boss`), `note`, activity ❓, câu hỏi `asking`, bật timer (`setInterval(pollMs)`, `unref`) nếu chưa chạy. Id `a<now base36><seq base36>`; giữ 50 câu hỏi gần nhất.
  - `tick` cho mỗi câu hỏi `asking`, theo Quyết định 5: `boss()` là chuỗi hoặc `agentId` khác → `no-boss`; đọc tail tới khi `more` false, `findAnswer` → `answered`; quá `timeoutMs` từ lúc hỏi → `timeout` (`tr('no answer after {0} min', …)`, khoá đã có); chưa gửi `\r` → gửi nếu boss không `waiting`; `working` → vũ trang; `waiting` → chờ; `idle|shell` → đếm thời gian rảnh từ tick đầu thấy nó, gõ lại hoặc `untagged` (`tr('the boss replied without the tag {0}', [tag])`). Kết thúc: activity 💬 hoặc ⚠️ (Quyết định 6), `answered` → ghi dòng bảng (Quyết định 8; lỗi/thiếu → `log.warnOnce`), tắt timer khi không còn câu hỏi `asking`.
  - Khoá `vi.ts` mới, chỉ những chữ `advisor.ts` tự gọi `tr()`: `Asks the boss: {0}`, `The boss answered`, `No answer from the boss`, `empty question`, câu khác office, `the boss is waiting for you: {0}`, `the boss terminal closed`, `the boss replied without the tag {0}`. Hai lý do "không có boss" của Quyết định 3 do `index.ts` gọi `tr()` nên vào ở Task 3 (thêm sớm sẽ là khoá thừa).

- [ ] **Step 1: Test (thất bại)** — `advisor.test.ts`, fake bằng hàm, transcript và bảng là file thật trong thư mục tạm (`T0`, `dirs` và `afterEach` dọn thư mục như `service.test.ts:13–17`; `line`/`say` của Task 1):
```ts
const BOARD = '# Task board\n\n## Hỏi đáp (advisor ghi tự động)\n| Lúc | Ai | Hỏi | Trả lời |\n|---|---|---|---|\n\n## Đã xong\n| ID |\n|---|\n';
function setup(o: { board?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-advisor-'));
  dirs.push(dir);
  const transcript = join(dir, 'boss.jsonl');
  writeFileSync(transcript, `${say('[ADVISOR W2 T2] an old answer')}\n`);
  if (o.board !== null) writeFileSync(join(dir, 'task_board.md'), o.board ?? BOARD);
  let now = T0;
  const boss: { v: AdvisorBoss | string } = { v: { agentId: '.claude:9', status: 'idle', transcript } };
  const typed: string[] = [], notes: string[] = [], acts: Array<[string, Activity]> = [];
  const seats: Record<string, { agentId: string; ref: string }> = { W2: { agentId: 'agy:acc1@W2', ref: 'T2' }, W3: { agentId: 'agy:acc1@W3', ref: 'T5' } };
  const advisor = new Advisor({
    boss: () => boss.v, typeTo: (_id, d) => (typed.push(d), true), seat: (s) => seats[s], note: (s, q) => void notes.push(`${s}:${q}`),
    activity: (id, a) => void acts.push([id, a]), folder: () => dir, now: () => now, timing: { pollMs: 0 },
  });
  const id = (r: AdvisorAsk) => (r.ok ? r.question.id : '');
  return {
    advisor, boss, typed, notes, acts, dir, transcript, id,
    reply: (text: string) => appendFileSync(transcript, `${say(text)}\n`),
    at: (ms: number) => ((now += ms), advisor.tick()),
    status: (s: AgentStatus) => void ((boss.v as AdvisorBoss).status = s),
    q: async (r: AdvisorAsk) => (await advisor.wait(id(r), 0))!,
  };
}

it('an idle boss gets the paste, then the Enter on the next tick; the tagged reply after it is the answer, on the feed and in Hỏi đáp', async () => {
  const t = setup();
  const r = t.advisor.ask({ slot: 'W2', question: 'a.csv or b.csv?', office: t.dir });
  expect(r).toMatchObject({ ok: true, question: { status: 'asking', ref: 'T2' } });
  expect(t.typed).toEqual([advisorPaste('W2', 'T2', 'a.csv or b.csv?')]);
  t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
  t.status('working'); t.at(500);
  t.reply('[ADVISOR W2 T2] Use a.csv.'); t.at(500);
  expect(await t.q(r)).toMatchObject({ status: 'answered', answer: 'Use a.csv.' }); // not "an old answer": seekEnd before typing
  expect(t.notes).toEqual(['W2:a.csv or b.csv?']);
  expect(t.acts.map(([id, a]) => [id, a.icon, a.detail])).toEqual([['agy:acc1@W2', '❓', 'a.csv or b.csv?'], ['agy:acc1@W2', '💬', 'Use a.csv.']]);
  const after = readFileSync(join(t.dir, 'task_board.md'), 'utf8');
  expect(after.replace(/^\| \d\d-\d\d \d\d:\d\d \| W2 \(T2\) \| a\.csv or b\.csv\? \| Use a\.csv\. \|\n/m, '')).toBe(BOARD);
});

it('refused at once, nothing typed or recorded: not a seat, empty question, another office, the boss at a prompt, no boss', () => {
  const t = setup();
  expect(t.advisor.ask({ slot: 'X9', question: 'q' })).toMatchObject({ ok: false, status: 400 });
  expect(t.advisor.ask({ slot: 'W2', question: ' \x1b\x07 ' })).toMatchObject({ ok: false, status: 400 });
  expect(t.advisor.ask({ slot: 'W2', question: 'q', office: '/elsewhere' })).toMatchObject({ ok: false, status: 400 });
  t.boss.v = { ...(t.boss.v as AdvisorBoss), status: 'waiting', waitingFor: 'approve a permission' };
  expect(t.advisor.ask({ slot: 'W2', question: 'q' })).toMatchObject({ ok: false, status: 409, code: 'boss-waiting', error: expect.stringContaining('approve a permission') });
  t.boss.v = 'no boss terminal: open the boss from the page (the + beside Boss)';
  expect(t.advisor.ask({ slot: 'W2', question: 'q' })).toMatchObject({ ok: false, status: 409, code: 'no-boss', error: t.boss.v });
  expect([t.typed, t.notes, t.acts]).toEqual([[], [], []]);
});

it('the Enter waits while the boss is at a prompt', () => {
  const t = setup();
  t.advisor.ask({ slot: 'W2', question: 'q' });
  t.status('waiting'); t.at(500); t.at(500);
  expect(t.typed).toHaveLength(1);
  t.status('shell'); t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
});

it('a question swallowed by a tool turn is typed once more after the boss goes idle; no tag after that is untagged', async () => {
  const t = setup();
  const r = t.advisor.ask({ slot: 'W2', question: 'q' });
  t.at(500); t.at(3_000);
  expect(t.typed).toHaveLength(2); // still idle before its turn: no retype
  t.status('working'); t.at(500);
  t.status('idle'); t.at(500); t.at(4_000);
  expect(t.typed).toHaveLength(2); // idle 4 s
  t.at(1_500);
  expect(t.typed.slice(2)).toEqual([advisorPaste('W2', 'T2', 'q')]);
  t.at(500);
  expect(t.typed.at(-1)).toBe('\r');
  t.at(59_000);
  expect((await t.q(r)).status).toBe('asking');
  t.at(1_500);
  expect(await t.q(r)).toMatchObject({ status: 'untagged', error: expect.stringContaining('[ADVISOR W2 T2]') });
  expect(t.typed).toHaveLength(4);
  expect(t.acts.at(-1)?.[1]).toMatchObject({ icon: '⚠️', error: true });
});

it('two seats in one boss message get their own text; the same seat and job again is #2; boss gone is no-boss; 10 minutes is timeout', async () => {
  const t = setup();
  const a = t.advisor.ask({ slot: 'W2', question: 'q1' });
  const b = t.advisor.ask({ slot: 'W3', question: 'q2' });
  t.at(500);
  t.reply('[ADVISOR W2 T2] A\n\n[ADVISOR W3 T5] B'); t.at(500);
  expect([(await t.q(a)).answer, (await t.q(b)).answer]).toEqual(['A', 'B']);
  const c = t.advisor.ask({ slot: 'W2', question: 'q3' });
  expect(c).toMatchObject({ ok: true, question: { ref: 'T2#2' } });
  t.boss.v = 'gone'; t.at(500);
  expect(await t.q(c)).toMatchObject({ status: 'no-boss' });
  t.boss.v = { agentId: '.claude:9', status: 'working', transcript: t.transcript };
  const d = t.advisor.ask({ slot: 'W3', question: 'q4' });
  t.at(500); t.at(10 * 60_000);
  expect(await t.q(d)).toMatchObject({ status: 'timeout' });
});

it('no board file: the answer still comes back and no board is created', async () => {
  const t = setup({ board: null });
  const r = t.advisor.ask({ slot: 'W2', question: 'q' });
  t.at(500); t.reply('[ADVISOR W2 T2] ok'); t.at(500);
  expect(await t.q(r)).toMatchObject({ status: 'answered', answer: 'ok' });
  expect(existsSync(join(t.dir, 'task_board.md'))).toBe(false);
});
```
`service.test.ts`:
```ts
it('a seat question goes on its running job; the tag reference is the job title ID, else the job id, else "-"', async () => {
  const t = setup();
  expect(t.svc.seatRef('W1')).toEqual({ agentId: 'agy:acc2', ref: '-' });
  expect(t.svc.seatRef('nobody')).toBeUndefined();
  await t.svc.ask({ worker: 'W1', prompt: 'Bạn là ghế W1…\n---\n# Việc T7 — đếm', task: '# Việc T7 — đếm\n## Bối cảnh x' });
  expect(t.svc.seatRef('W1')?.ref).toBe('T7');
  t.svc.noteQuestion('W1', 'which file?\nthe first');
  expect(t.svc.jobs().find((j) => j.worker === 'W1')?.question).toBe('which file? the first');
  await t.svc.ask({ worker: 'C1', prompt: 'no title' });
  expect(t.svc.seatRef('C1')?.ref).toBe(t.svc.jobs().find((j) => j.worker === 'C1')?.id);
});
```
Run: `npx vitest run server/workers/advisor.test.ts server/workers/service.test.ts` → 7 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh; `npm run i18n:check` 0/0; `grep -c "" server/workers/advisor.ts` (ghi vào commit; mục tiêu ≈150 dòng); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(advisor): ask the boss through its terminal, read the tagged reply, retype once, record it on the job, the feed and Hỏi đáp"
```

---

### Task 3: Route `/api/advisor` và nối vào server

**Files:**
- Modify: `server/http/app.ts` (`ApiDeps` sau `workers` :73–77; route ngay trước `/api/workers/` :492), `server/index.ts` (sau `late.workers = workers;` :216), `server/http/http.test.ts`, `server/README.md` (:188), `shared/locales/vi.ts`

**Interfaces:**
- Consumes: `Advisor`, `AdvisorAsk`, `AdvisorQuestion` (Task 2); `WorkerService.seatRef/noteQuestion` (Task 2); `claudeTranscriptPath` (`server/workers/turns.ts:64`).
- Produces:
  - `ApiDeps.advisor?: Pick<Advisor, 'ask' | 'wait'>` — `/** Worker questions to the boss (/api/advisor, server/workers/advisor.ts): this computer only. */`
  - Route (cùng rào với `/api/workers/`: `isRemote(req) || !trusted(req)` → 403 `tr('worker questions only from this computer (http://localhost)')`; không có `deps.advisor` → 503 `tr('worker terminals need the interactive terminal (HABBLAUD_PTY=1)')`, khoá đã có):
    - `POST /api/advisor` `{slot: string, question: string, office?: string}` (sai kiểu → 400 `tr('expected {slot, question}')`) → `ok` 200 `{question}`; có `code` → 409 `{error, code}`; còn lại `{error}` với `status`.
    - `GET /api/advisor/<id>?wait=N` (N ≤ 60, `waitOf`) → 200 `{question}` | 404 `tr('question not found')`. Phương thức khác → 405.
  - `index.ts`: `const advisor = ptys && workers ? new Advisor({...}) : undefined;` truyền `advisor` vào `createApiHandler`. `boss()`:
```ts
boss: () => {
  if (team.boss.kind === 'agy') return tr('the boss is an Antigravity account: advisor reaches only a Claude Code boss for now');
  const id = team.bossAgentId();
  const a = id ? office.get(id) : undefined;
  const dir = a && accounts.find(a.account)?.dir;
  // shortcut: a boss that /clears mid-question keeps the old transcript, the question times out
  const transcript = id && (agents.transcriptPathOf(id) ?? (a && dir ? claudeTranscriptPath(dir, office.roomPath(a.roomId) ?? team.folder, a.sessionId) : undefined));
  if (!id || !a || !ptys.ofAgent(id) || !transcript || !['idle', 'working', 'shell', 'waiting'].includes(a.status)) return tr('no boss terminal: open the boss from the page (the + beside Boss)');
  return { agentId: id, status: a.status, waitingFor: a.waitingFor, transcript };
},
```
    các hàm còn lại: `typeTo: (id, d) => ptys.typeTo(id, d)`, `seat: (s) => workers.seatRef(s)`, `note: (s, q) => workers.noteQuestion(s, q)`, `activity: (id, act) => office.addActivity(id, act, true)`, `folder: () => team.folder`.
  - `server/README.md:188`: thêm `advisor.ts` (a seat's question typed into the boss's terminal, its tagged answer read back).
  - Khoá `vi.ts` mới: `worker questions only from this computer (http://localhost)`, `expected {slot, question}`, `question not found`, và hai lý do của `boss()`: `the boss is an Antigravity account: advisor reaches only a Claude Code boss for now`, `no boss terminal: open the boss from the page (the + beside Boss)`.

- [ ] **Step 1: Test (thất bại)** — `http.test.ts`, dùng `start()` có sẵn:
```ts
it('POST /api/advisor and GET /api/advisor/:id: the question, 409 with its code, 404, and only from this computer', async () => {
  const q = { id: 'a1', slot: 'W2', ref: 'T2', question: 'q', status: 'answered' as const, askedAt: 1, answer: 'A' };
  const env = await start({
    advisor: {
      ask: (i) => (i.question === 'busy' ? { ok: false, status: 409, code: 'boss-waiting', error: 'the boss is waiting for you: x' } : { ok: true, question: { ...q, question: i.question } }),
      wait: async (id) => (id === 'a1' ? q : undefined),
    },
  });
  try {
    const post = (body: unknown) => fetch(`${env.base}/api/advisor`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
    let r = await post({ slot: 'W2', question: 'which?', office: '/w' });
    expect([r.status, ((await r.json()) as { question: { question: string } }).question.question]).toEqual([200, 'which?']);
    r = await post({ slot: 'W2', question: 'busy' });
    expect([r.status, await r.json()]).toEqual([409, { error: 'the boss is waiting for you: x', code: 'boss-waiting' }]);
    expect((await post({ slot: 'W2' })).status).toBe(400);
    expect((await fetch(`${env.base}/api/advisor/a1?wait=1`)).status).toBe(200);
    expect((await fetch(`${env.base}/api/advisor/nope`)).status).toBe(404);
    expect((await raw(env.base, '/api/advisor/a1', { headers: { Host: 'habblaud.lan' } })).status).toBe(403);
  } finally {
    await env.close();
    env.cleanup();
  }
});
```
Run: `npx vitest run server/http/http.test.ts` → 1 FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm** — xanh; `npm run typecheck`; `npm run i18n:check` 0/0; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(advisor): POST /api/advisor and GET /api/advisor/:id, wired to the boss terminal and the seats"
```

---

### Task 4: CLI `advisor`

**Files:**
- Create: `tools/agy/bin/advisor` (chế độ 755), `tools/agy/tests/test_advisor.py`
- Modify: `tools/agy/tests/test_install.py` (:73–78), `tools/install.sh` (comment :2)

**Interfaces:**
- Consumes: route Task 3 (`{question: {id, status, answer?, error?}}`, 409 `{error, code}`).
- Produces:
  - Docstring dòng 1 (cũng là cách dùng): `advisor "<question>"     ask the office's boss from a seat's job and print its answer`; một đoạn: env `BANG_SLOT` (bắt buộc), `BANG_OFFICE`, `HABBLAUD_URL` (mặc định `http://127.0.0.1:4747`); bảng exit theo Quyết định 9.
  - `OK, FAIL, NO_BOSS, BOSS_WAITING, TIMEOUT, UNTAGGED = 0, 1, 2, 3, 4, 5`; `EXIT = {"answered": 0, "no-boss": 2, "boss-waiting": 3, "timeout": 4, "untagged": 5}`; `WAIT_MAX = 11 * 60` (giây: trần server + 1 phút).
  - `die(msg, code)`: stderr `advisor: <msg>` rồi `advisor: write blocked: <your question> in your row of task_board.md and stop; do not guess`, exit `code`.
  - `http(method, path, body=None, timeout=10) -> (status, dict)` như `worker-ask:239–254` (`ensure_ascii=False`); `NoOffice` khi từ chối kết nối.
  - Luồng: POST; `NoOffice` → `die("the office is not running at <URL>: no boss to ask", 2)`; 404/503 → exit 2; 409 → `EXIT.get(code, 1)`; khác ≥300 → exit 1. Vòng `GET …?wait=60` (timeout 75 s) khi `status == "asking"`; 3 lần `NoOffice` liên tiếp → exit 1; quá `WAIT_MAX` → exit 4. `answered` → in câu trả lời, exit 0; còn lại → `die(error or status, EXIT.get(status, 1))`.
  - `install.sh:2`: `# Links worker-ask (also agy-ask, claude-ask), agy-as, bang-init and advisor from this repo into ~/.local/bin, …`.

- [ ] **Step 1: Test (thất bại)** — `test_advisor.py` (pytest), một office giả trả lời theo chữ câu hỏi:
```python
class Fake(http.server.BaseHTTPRequestHandler):
    posts, gets = [], []
    REFUSE = {"noboss": (409, {"code": "no-boss", "error": "no boss terminal: open the boss from the page"}),
              "waiting": (409, {"code": "boss-waiting", "error": "the boss is waiting for you: approve a permission"}),
              "bad": (400, {"error": "W9 is not a seat in team.json"})}
    END = {"late": {"status": "timeout", "error": "no answer after 10 min"},
           "plain": {"status": "untagged", "error": "the boss replied without the tag [ADVISOR W2 -]"}}
    # POST: refuse, or {question: {id: <question>, status: asking}}; GET /api/advisor/<id>: asking once, then the end
    # (END[id], else answered with "Use a.csv."); records posts (bodies) and gets (paths).

def run(args, env=None, url=None):  # (code, stdout, stderr) of the advisor script in a scrubbed env
    e = {k: v for k, v in os.environ.items() if not k.startswith(("AGY_", "BANG_", "CLAUDE", "HABBLAUD_"))}
    e.update(BANG_SLOT="W2", BANG_OFFICE="/w/proj", HABBLAUD_URL=url or OFFICE_URL, **(env or {}))
    ...

def test_the_answer_comes_after_the_long_poll_and_the_body_names_seat_question_and_office():
    code, out, err = run(["ok", "which", "file?"])
    assert (code, out) == (0, "Use a.csv.\n"), err
    assert Fake.posts[-1] == {"slot": "W2", "question": "ok which file?", "office": "/w/proj"}
    assert len(Fake.gets) == 2

@pytest.mark.parametrize("question,code,text", [
    ("noboss", 2, "no boss terminal"), ("waiting", 3, "approve a permission"),
    ("late", 4, "no answer after 10 min"), ("plain", 5, "without the tag"), ("bad", 1, "not a seat")])
def test_each_failure_has_its_exit_and_says_to_write_blocked(question, code, text):
    c, out, err = run([question])
    assert (c, out) == (code, "")
    assert text in err and "blocked:" in err

def test_no_seat_no_question_or_no_office_never_reach_a_boss():
    n = len(Fake.posts)
    assert run(["q"], env={"BANG_SLOT": ""})[0] == 1
    assert run([])[0] == 1 and run(["--help"])[0] == 1
    c, _, err = run(["q"], url="http://127.0.0.1:9")
    assert c == 2 and "not running" in err
    assert len(Fake.posts) == n
```
`test_install.py`: vòng `for n in ("worker-ask", "agy-as", "bang-init", "advisor"):` (readlink trỏ `tools/agy/bin/<n>` của repo) và bỏ dòng `assert not os.path.lexists(f"{h}/.local/bin/advisor")`.
Run: `cd tools/agy && python3 -m pytest -q tests/test_advisor.py tests/test_install.py` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; `chmod 755 tools/agy/bin/advisor`.

- [ ] **Step 3: Kiểm** — xanh; `git ls-files -s tools/agy/bin/advisor` sau `git add` → `100755`; `bash -n tools/install.sh`; `grep -c "" tools/agy/bin/advisor` (mục tiêu ≈65); kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(advisor): the advisor command for seats (exit 0-5), linked by install.sh"
```

---

### Task 5: Skill `advisor` bản cuối, mục trả lời trong `giao-viec`, tài liệu

**Files:**
- Modify: `skills/advisor/SKILL.md` (thay toàn bộ), `skills/giao-viec/SKILL.md` (mục mới "## 5" trước "## Exit codes" :56), `tools/agy/tests/test_skills.py` (thay `test_advisor_placeholder_says_blocked_when_the_command_fails` :41–43; thêm chuỗi vào test `giao-viec` :27–28), `CHANGELOG.md` (`## [Unreleased]`), `README.md` (bước 5 :126–135), `tools/agy/README.md` (bảng "What is here" :34–40)

**Interfaces:**
- Consumes: exit 0–5 và khung (Task 1, 4); lời mở đầu `worker-ask:67–69` không đổi (Quyết định 11).

- [ ] **Step 1: Test (thất bại)**
```python
def test_advisor_says_how_to_ask_and_what_each_exit_means():
    a = read("advisor")
    for s in ('advisor "', "blocked:", "STOP", "timeout: 600000", "| 0 |", "| 5 |", "approve", "Hỏi đáp"):
        assert s in a, s
    assert "placeholder" not in a
```
Trong `test_giao_viec_carries_the_spec_template_and_the_review_loop`, thêm vào bộ chuỗi bắt buộc: `"## 5. Answer a seat's question"`, `"[ADVISOR W2 T2]"`, `"text only"`, `"❓ Ghế W2 hỏi (việc T2)"`.
Run: `cd tools/agy && python3 -m pytest -q tests/test_skills.py` → 2 FAIL.

- [ ] **Step 2: Viết `skills/advisor/SKILL.md`** — đúng nội dung:
````markdown
---
name: advisor
description: For a worker seat of a Bang_ver office - when your job is unclear, contradicts itself or the files, or misses an input, ask the boss with the advisor command and wait for the answer; what to do when it fails.
---

# advisor

Use it when the prompt is vague, contradicts itself or the files, or an input it names is missing. Not for what you can check yourself.

1. Read "Ghi chú kỹ thuật" in task_board.md first: another seat may have solved it.
2. Ask ONE concrete question with what you already tried, in the foreground, and wait:
   `advisor "<question> — tried: <what>"`
   The office types it into the boss's terminal and prints the boss's answer: usually within a minute, at most 10 minutes. Claude Code: give that Bash call `timeout: 600000`. Antigravity: the office may ask the user to approve the command in your terminal; wait for it.
3. Exit 0: the output is the boss's answer, verbatim. Follow it and go on with the job.
4. Any other exit: write `blocked: <question>` in your row of task_board.md and STOP. Do not guess, do not ask again.

| Exit | Meaning |
| --- | --- |
| 0 | the boss's answer is printed |
| 1 | not inside a seat's job (`BANG_SLOT` unset), empty question, refused, or the office was lost while waiting |
| 2 | no boss terminal: the boss was not opened from the page, it is an Antigravity boss, or the office is not running |
| 3 | the boss is waiting for the user at a prompt |
| 4 | no answer in 10 minutes |
| 5 | the boss replied without the `[ADVISOR …]` tag |

The office writes your question and the answer to "Hỏi đáp" in task_board.md; never write that section yourself.
````

- [ ] **Step 3: Thêm mục vào `skills/giao-viec/SKILL.md`** (trước "## Exit codes"), đúng nội dung:
````markdown
## 5. Answer a seat's question
A stuck seat runs `advisor`. The office types its question into your terminal as one message: `❓ Seat W2 asks (job T2): <question>` (in Vietnamese `❓ Ghế W2 hỏi (việc T2): <câu hỏi>`), then a line naming the tag to start with.
- Reply at once, text only (no tools in that reply), starting exactly with that tag: `[ADVISOR W2 T2] Use docs/a.csv; skip the header row.` Everything after the tag, up to the next tag, goes to the seat verbatim: short and concrete.
- Two questions in one message: answer each under its own tag in the same reply.
- You do not know: say so under the tag and tell the seat to write `blocked:`; point to another seat's "Ghi chú kỹ thuật" when it holds the answer.
- The office writes the question and your answer to "Hỏi đáp" in task_board.md; do not write it yourself.
- It only reaches you while you run in a terminal the office opened or took over, and while your jobs run in the background (section 3).
````

- [ ] **Step 4: Tài liệu**
  - `CHANGELOG.md` `### Added`: một dòng **`advisor "<question>"` for worker seats**: the office types the question into the boss's terminal (opened or taken over from the page), passes back the reply that starts with `[ADVISOR <seat> <job>]`, shows the question and the answer in the feed and on the seat, notes it on the running job and adds a row to "Hỏi đáp" in `task_board.md`; exits 2–5 say why there is no answer (no boss terminal, boss waiting for you, 10-minute timeout, reply without the tag). Dòng `skills/` (:13): bỏ "(a placeholder until the command exists)"; thêm "`giao-viec` says how the boss answers a seat's question".
  - `README.md` bước 5: một đoạn: a stuck seat runs `advisor "<question>"`; it only reaches a boss opened from the page (the + beside Boss) and needs `tools/install.sh` to have linked `advisor`; Antigravity seats ask the user to approve the command in their terminal.
  - `tools/agy/README.md` bảng: `| bin/advisor | Run by a seat inside a job: asks the office's boss, prints its answer (exit 2-5: no boss, boss waiting, timeout, untagged) |`.

- [ ] **Step 5: Kiểm** — `pytest tests/test_skills.py` xanh; `grep -rn "placeholder until the command" CHANGELOG.md skills/ | wc -l` → `0`; kiểm chung.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "docs(skills): advisor final, giao-viec answers a seat's question; changelog and readmes"
```

---

### Task 6: Nghiệm thu trên cổng 4749 (spec §17 bước 5, kiểm M2)

**Files:**
- Ngoài repo: worktree `~/bang-ver-accept5` (HEAD), `~/bang-test-office/` (thêm `docs/r01.txt`), `~/.bang-test-data/` (team.json W1, W2 agy acc1; C1, C2 claude worker; folder `~/bang-test-office`), `~/.bang-test-data/plan5/` (sao lưu, ghi chép)
- Modify: cuối file kế hoạch này, mục `## Kết quả`

Trong mọi bước: `B=/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver; P=~/.bang-test-data/plan5; O=~/bang-test-office; U=http://127.0.0.1:4749; export HABBLAUD_DATA_DIR=$HOME/.bang-test-data HABBLAUD_URL=$U`. Ghế giả: `ask() { BANG_SLOT=${2:-W2} BANG_OFFICE=$O $B/tools/agy/bin/advisor "$1"; }`. Activity của W2: `acts() { curl -s $U/api/agents/agy%3Aacc1%40W2 | python3 -c 'import json,sys; [print(a["icon"], a["at"], a["text"]) for a in json.load(sys.stdin)["history"] if a["icon"] in "❓💬⚠️"]'; }`. Pid server: `pid=$(ss -Hltnp 'sport = :4749' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)`.

- [ ] **Step 1: Sao lưu, worktree, build, start**
```bash
mkdir -p $P && md5sum ~/.bang-test-data/team.json > $P/team.md5 && cp ~/.bang-test-data/team.json $P/team.before.json && cp $O/task_board.md $P/task_board.before.md
cd $B && git worktree add ~/bang-ver-accept5 HEAD && cd ~/bang-ver-accept5 && ln -s $B/node_modules node_modules
HABBLAUD_PORT=4749 sh scripts/office.sh start; sleep 8; curl -s -o /dev/null -w '%{http_code}\n' $U/
ss -Hltn 'sport = :4747' | wc -l
```
Expected: `200`; `1`. Build lỗi vì link `node_modules` → `rm node_modules && npm ci --prefer-offline` trong worktree.

- [ ] **Step 2: Điều kiện (CHỈ ĐỌC) và fixture**
```bash
readlink -f ~/.local/bin/advisor || echo MISSING
python3 -c 'import json; p=json.load(open("/home/nhatbang/.claude.json")).get("projects",{}).get("/home/nhatbang/bang-test-office",{}); print(p.get("hasTrustDialogAccepted"))'
grep -c '^## Hỏi đáp' $O/task_board.md
mkdir -p $O/docs && printf 'gnohk ,iul aig auq tah\n2 gnart\n' > $O/docs/r01.txt
```
Expected: `$B/tools/agy/bin/advisor` hoặc `MISSING` (→ ghi "controller chạy `tools/install.sh`"; Step 6 cần nó); `True` (→ chạy Step 4–5) hoặc khác (→ Step 4–6 "chờ người dùng tin cậy `~/bang-test-office` cho tài khoản mặc định", xem câu hỏi cho controller 2); `1`.

- [ ] **Step 3: Không có boss — từ chối ngay, không gõ, không ghi**
```bash
ask "probe: is there a boss?"; echo "exit=$?"
env -u BANG_SLOT $B/tools/agy/bin/advisor "x"; echo "exit=$?"
HABBLAUD_URL=http://127.0.0.1:9 ask "x"; echo "exit=$?"
acts | wc -l; cmp $O/task_board.md $P/task_board.before.md && echo SAME
```
Expected: `no boss terminal: open the boss from the page (the + beside Boss)` + dòng `blocked:`, `exit=2`; `BANG_SLOT`, `exit=1`; `not running`, `exit=2`; `0`; `SAME`.

- [ ] **Step 4: §17 bước 5 với boss Claude thật, ghế giả** (chỉ khi Step 2 in `True`)
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"openBoss":true}' $U/api/team
for i in $(seq 60); do b=$(curl -s $U/api/snapshot | python3 -c 'import json,sys; o=json.load(sys.stdin)["team"]["offices"][0]; print(o.get("bossAgentId",""))'); [ -n "$b" ] && break; sleep 1; done; echo "boss=$b"
t0=$(date +%s); ask "File docs/r01.txt có các dòng bị đảo ngược (văn bản xoay). Đảo lại từng dòng rồi mới OCR, hay bỏ qua file? — đã thử: đọc Ghi chú kỹ thuật, không có ghi chú nào"; echo "exit=$? sec=$(( $(date +%s) - t0 ))"
acts; diff $P/task_board.before.md $O/task_board.md
```
Expected: `boss=<account>:<pid>` (trống sau 60 s = boss kẹt ở hộp thoại tin cậy → đóng PTY đó bằng `POST /api/pty/<id>/close`, ghi "chờ người dùng", bỏ Step 4–5); câu trả lời của boss in ra, `exit=0`, `sec` < 120; `acts` có `❓` rồi `💬`; `diff` chỉ thêm một dòng `| MM-DD HH:MM | W2 | File docs/r01.txt … | <trả lời> |` trong "Hỏi đáp". Ghi: ngôn ngữ của khung boss đã nhận (đọc prompt cuối trong `GET $U/api/agents/<boss>` `history`), câu trả lời có mở đầu bằng thẻ không, `sec`.
Hai ghế cùng lúc, và boss bận:
```bash
ask "Câu hỏi A: trả lời đúng một từ ALPHA" W1 > $P/a.out 2>&1 & p=$!; ask "Câu hỏi B: trả lời đúng một từ BETA" W2 > $P/b.out 2>&1; wait $p; cat $P/a.out $P/b.out
```
Expected: `a.out` có `ALPHA`, `b.out` có `BETA` (không lẫn); hai dòng Hỏi đáp mới. Rồi gõ vào terminal boss (bracketed paste + `\r` qua `POST $U/api/pty/<ptyId>/input`) một lượt có công cụ: "Dùng công cụ Read đọc lần lượt README.md, CLAUDE.md, task_board.md, project_proposal.md rồi tóm mỗi file một dòng"; 4 s sau `ask "Câu hỏi C: trả lời đúng một từ GAMMA"`. Expected: `GAMMA`, `exit=0`; ghi số prompt bắt đầu bằng `❓` trong `history` của boss (2 = server đã gõ lại; 1 = boss trả lời ngay).

- [ ] **Step 5: Ghế agy thật hỏi** (tuỳ chọn; cần Step 2 không `MISSING` và boss từ Step 4)
Người chạy giao T2 cho W2 bằng `worker-ask` (chạy nền), 6 phần, "Cách làm" bước 1: `Chạy lệnh shell: advisor "docs/r01.txt bị xoay: đảo dòng hay bỏ qua?"` và làm theo câu trả lời; "Output" `out/r01.txt`. Sau 60 s đọc màn hình W2 (`timeout 3 curl -sN $U/api/pty/<ptyId của W2>/stream | strings | grep -c "Run this command"`, như chẩn đoán Kế hoạch 4). Expected: `≥1` → KHÔNG duyệt, huỷ (`POST $U/api/workers/cancel {"worker":"W2"}`), ghi "chờ người dùng: duyệt `advisor` trong terminal W2 trên trang". `0` và W2 chạy được lệnh → `acts` có `❓` rồi `💬` cách nhau < 120 s, việc T2 trả về (exit 0).

- [ ] **Step 6: M2 — boss agy và ghế cùng acc1** (tuỳ chọn, chỉ khi controller đồng ý: tốn quota acc1)
```bash
python3 -c 'import json,os; f=os.path.expanduser("~/.bang-test-data/team.json"); t=json.load(open(f)); t["boss"]={"kind":"agy","account":"acc1"}; open(f+".tmp","w").write(json.dumps(t,indent=2)+"\n"); os.replace(f+".tmp",f)'
sleep 3; ask "x"; echo "exit=$?"
curl -s -X POST -H 'Content-Type: application/json' -d '{"openBoss":true}' $U/api/team
```
Expected: `the boss is an Antigravity account`, `exit=2`; terminal `agy-boss:acc1` mở (rảnh). Rồi `worker-ask W1 "Dùng công cụ ghi file (không dùng lệnh shell) tạo out/m2-w1.txt chứa W1-OK, rồi trả lời đúng một dòng: W1-OK" --raw --timeout 300 &` và trong 1 s gõ vào terminal boss agy `Trả lời đúng một dòng: BOSS-OK` + `\r`. Expected: W1 in `W1-OK` (không phải `BOSS-OK`), `out/m2-w1.txt` = `W1-OK`. Ghi kết quả (một lần chạy không chứng minh cuộc đua không xảy ra). Trả lại: `cp $P/team.before.json ~/.bang-test-data/team.json && md5sum -c $P/team.md5`; sau 3 s `curl -s $U/api/pty` không còn `agy-boss:` đang chạy.

- [ ] **Step 7: Test, số dòng, RSS tham khảo**
```bash
cd $B && npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)
git diff --shortstat 8c0e278..HEAD -- server client shared tools scripts ':!*.test.ts' ':!tools/agy/tests'
```
Expected: xanh (trừ flaky); thêm ròng ≤ +300 (vượt → báo controller, không cắt test). RSS: không đo A/B (Quyết định 5: không timer khi rảnh); sau khi đóng boss ở Step 8, đọc `ps -o rss= -p $pid` 3 lần cách 10 s, ghi cạnh trung vị HEAD Kế hoạch 4 (113132 KB) để tham khảo.

- [ ] **Step 8: Dọn và ghi kết quả**
```bash
curl -s -X POST $U/api/pty/<ptyId của boss>/close -H 'Content-Type: application/json' -d '{}'
cd ~/bang-ver-accept5 && HABBLAUD_PORT=4749 sh scripts/office.sh stop; ss -Hltn 'sport = :4749' | wc -l; ss -Hltn 'sport = :4747' | wc -l
cd $B && git worktree remove --force ~/bang-ver-accept5
md5sum -c $P/team.md5
```
Expected: `0`, `1`, `team.json: OK`. Giữ `~/bang-test-office` (có các dòng Hỏi đáp, `docs/r01.txt`) và `~/.bang-test-data`. Ghi vào `## Kết quả`: bảng Step 1–8 (exit, output chính, `sec`, ngôn ngữ khung, tuân thủ thẻ, có gõ lại không, dòng Hỏi đáp), số test, số dòng, RSS, điều còn chờ người dùng/controller.
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 5 acceptance results"
```

---

### Task 7: Bàn giao cho Kế hoạch 6

**Files:**
- Modify: cuối file kế hoạch này, mục `## Để lại cho Kế hoạch 6`

- [ ] **Step 1: Viết danh sách** — mỗi mục một dòng, có nguồn (bước nghiệm thu, file:dòng). Tối thiểu, cập nhật theo `## Kết quả`:
  - Deploy: `/api/advisor` gõ chữ vào terminal boss = chạy lệnh trên máy; phải giữ rào `isRemote(req) || !trusted(req)` như `/api/pty` và `/api/workers/` khi đưa trang ra Internet, và test 403 qua cổng remote.
  - Ghế agy chạy `advisor` cần người dùng duyệt trong terminal (Step 5); cách cho phép lệnh `advisor` trong profile agy chưa có (cú pháp `command(...)` của allow không chạy, Kế hoạch 4).
  - Boss agy: advisor từ chối; không có đọc transcript boss agy; kết quả M2 (Step 6) hoặc "chưa kiểm".
  - Tuân thủ thẻ bằng ngôn ngữ thật của server (Step 4); nếu boss bỏ thẻ: dùng khung tiếng Anh hoặc thêm câu "No preface, no footer".
  - Giết CLI không huỷ câu hỏi; ghế Claude cần `timeout: 600000` (chưa có lần chạy C1 thật).
  - Còn mở từ Kế hoạch 4: ghế Claude `auto` (câu hỏi mở 1), việc gõ trên trang không có lời mở đầu (câu hỏi mở 2), Step 9 boss tự đọc skill (một phần đã chạy ở Step 4 nếu có boss).
  - Mô hình advisor headless (khi boss hay vắng): ngoài v1.
  - Các mục "Spec cần sửa" bên dưới chưa sửa trong spec.

- [ ] **Step 2: Commit**
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 5 hand-over for plan 6"
```

---

## Tự kiểm sau khi viết

Spec §13:
- Bước 1 (worker loại nào cũng chạy `advisor` qua shell; lời mở đầu nêu lệnh): CLI Task 4; lời mở đầu `worker-ask:67–69` đã nêu `advisor "<câu hỏi>"` (Quyết định 11); agy cần duyệt lệnh (Quyết định 13, Task 6 Step 5).
- Bước 2 (đọc `BANG_SLOT`, POST, long-poll): Task 4 + Task 3; `BANG_OFFICE` → `office` (Quyết định 9).
- Bước 3 (ghi vào việc đang chạy, feed "❓ W2 hỏi", trên nhân vật, gõ khung vào PTY boss, chờ tin assistant có thẻ chứ không phải "lượt kế", ghi Hỏi đáp): Task 2 (`noteQuestion`, activity ❓, Quyết định 6, 7), Task 1 (khung, `findAnswer`, `withQaRow`), Task 2 (tail, gõ hai bước); thật ở Task 6 Step 4.
- Bước 4 (in câu trả lời, exit 0; hết giờ 10 phút; không có terminal boss): Task 2 (trần), Task 4 (exit 0–5, lệch spec: "Spec cần sửa").
- Skill `/advisor` (khi nào hỏi, một câu cụ thể kèm điều đã thử, lỗi → `blocked:`): Task 5.
- Lưu ý boss giữa lượt (Claude xếp hàng; lượt có công cụ nuốt câu hỏi → gõ lại): Task 2 test, Task 6 Step 4. Boss agy: Quyết định 3, Task 6 Step 6. Không dùng mô hình headless: Global Constraints.
- Spec §6 (env `BANG_SLOT`/`BANG_OFFICE` đã đặt ở `service.ts:540`; boss = terminal mở/tiếp quản; boss ngoài trang không gõ được): cổng Quyết định 3. §17 bước 5: Task 6 Step 4 (ghế giả, boss thật, < 2 phút) + Step 5 (ghế thật, tuỳ chọn). §18 (hai người ghi bảng cùng lúc): Quyết định 8. §3 phản mục tiêu: Global Constraints, Task 6 Step 7.
- Spike: bracketed paste + `\r` tách (Quyết định 2), chỉ `assistant` (Task 1 test), gõ lại một lần (Task 2 test), không gõ khi `waiting`/pending/không PTY (Task 2 test, wiring Task 3), làm sạch + trần 1500 (Task 1 test), exit 2–5 (Task 4 test), hai người hỏi một tin (Task 1, 2 test).

## Câu hỏi cho controller

1. **Trạng thái "chờ boss" trên nhân vật** (Quyết định 6): bong bóng ❓ + feed, không đổi `AgentStatus`. Muốn trạng thái `waiting` thật (kèm thông báo "✋ cần bạn" cho người dùng) thì thêm ≈10 dòng ở `statusOf`, `AgySource.poll`, `showClaude`.
2. **Boss thật khi `~/bang-test-office` chưa được tin cậy**: chờ người dùng, hay đặt một office thử dưới `/home/nhatbang/Agent_4_me` (đã tin cậy; cha tin cậy thì con cũng được) — đổi lại là một thư mục không theo dõi trong dự án của người dùng.
3. **Task 6 Step 6 (M2)** tốn quota acc1 và đổi tạm `team.json` thử: chạy hay bỏ.
4. **Ghế agy chạy `advisor`** dừng ở hộp thoại quyền (Kế hoạch 4): chấp nhận "người dùng duyệt trên trang" cho v1, hay tìm cách cho phép lệnh trong profile (đụng `~/.agy_profiles`, cần người dùng).

## Spec cần sửa

- §13 bước 4 "hết giờ … hoặc không có terminal boss … → exit 1": nay 2 (không boss, kể cả office không chạy), 3 (boss chờ người dùng), 4 (hết giờ), 5 (trả lời không thẻ); 1 cho lỗi cách dùng và lỗi chung.
- §13 bước 3 khung: gõ bằng bracketed paste + `\r` riêng (chữ thường + `\r` không gửi được, spike 1b/1d); thẻ có thể mang `#n` khi cùng ghế cùng việc hỏi lại; ghế không có việc dùng `-`.
- §13 "trên nhân vật (trạng thái cần boss)": bong bóng ❓, không đổi trạng thái (Quyết định 6).
- §13 boss agy: advisor từ chối (exit 2) tới khi có đọc transcript boss agy.
- §12 "rồi chạy lệnh advisor … và chờ trả lời, rồi ghi `blocked:` và dừng": ý đúng là "không có trả lời thì ghi `blocked:`" (lời mở đầu giữ nguyên văn, skill `advisor` nói rõ).

## Kết quả

Nghiệm thu trên cổng 4749 (worktree `~/bang-ver-accept5` tại 7990626, đã gỡ). Không mở boss, không sửa `~/.claude.json` (`hasTrustDialogAccepted` của `~/bang-test-office` cho tài khoản mặc định là None).

| Bước | Kết quả |
|---|---|
| 1 Sao lưu, worktree, build, start | Xong. `GET /` 200; cổng 4747 vẫn đúng 1 listener. |
| 2 Điều kiện, fixture | `~/.local/bin/advisor` -> `tools/agy/bin/advisor` (OK); mục `## Hỏi đáp` có 1; không ghi `docs/r01.txt` (chỉ phục vụ Bước 4). Trust: chưa tin cậy. |
| 3 Không boss | `ask` -> "no boss terminal: open the boss from the page (the + beside Boss)" + dòng `blocked:`, exit 2. Thiếu `BANG_SLOT` -> exit 1. `HABBLAUD_URL=...:9` -> "the office is not running", exit 2. Activity ❓/💬/⚠️ của W2 = 0; `task_board.md` không đổi (cmp SAME). |
| 3 (thêm) 400 trên server thật | POST `/api/advisor` body `{bad` -> 400 `invalid JSON`; body `{"slot":"W2"}` -> 400 `expected {slot, question}`; GET `/api/advisor/%E0%A4%A` và `/api/advisor/%ZZ?s=1` -> 400 `invalid id`; id không tồn tại -> 404 `question not found`. |
| 4 Boss Claude thật, ghế giả, hai ghế, gõ lại | CHỜ NGƯỜI DÙNG (thư mục chưa tin cậy). |
| 5 Ghế agy thật hỏi | CHỜ NGƯỜI DÙNG (cần boss từ Bước 4 và duyệt `advisor` trong terminal W2). |
| 6 M2 boss agy | CHỜ NGƯỜI DÙNG / controller (tuỳ chọn, tốn quota acc1; cần quyết định). |
| 7 Test, dòng, RSS | typecheck xanh; vitest 985 pass, 1 fail = `art.test.ts > floor chunks` (timeout 5 s, flaky đã biết); i18n 1274/1274; pytest tools/agy 89 pass. Dòng không-test thêm so với 8c0e278: 469 thêm, 4 xoá (ròng +465; `advisor.ts` 284, CLI 94) - vượt trần 300 (số ghi nhận, chưa cắt). RSS server 4749 rảnh: 112412 / 112416 / 112424 KB (HEAD Kế hoạch 4: 113132 KB), đo khi chưa mở boss nào. |
| 8 Dọn | `office.sh stop` -> 4749 còn 0 listener, 4747 còn 1; worktree gỡ; `team.json` md5 OK (không đổi). Không có boss/PTY nào để đóng. |

Người dùng cần làm: tin cậy `~/bang-test-office` cho tài khoản Claude mặc định (mở `claude` một lần trong thư mục đó và chọn "Yes, I trust this folder"), rồi chạy lại Bước 4-5 (và Bước 6 nếu muốn). Chưa đo: ngôn ngữ khung boss nhận, tuân thủ thẻ, gõ lại, thời gian trả lời, dòng Hỏi đáp thật.

## Để lại cho Kế hoạch 6

(Task 7 ghi.)
