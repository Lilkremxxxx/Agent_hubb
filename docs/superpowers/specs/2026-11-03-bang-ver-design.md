# Bang_ver — thiết kế bản siêu tối giản của Vi-Habblaud

_Ngày 2026-11-03 · Nguồn: `Agent_Hub/Vi-Habblaud` (HEAD d916cf1, fork tiếng Việt của marmottajr/habblaud) · Người quyết định: nhatbang_

## 1. Mục đích và lý do

Một văn phòng pixel duy nhất. Một boss (Claude hoặc agy) giao việc cho các worker (Claude hoặc agy). Người dùng nhìn trang web là biết ai đang làm gì. Worker trao đổi kiến thức với nhau qua `task_board.md`, hỏi lại boss bằng `/advisor`, và "học" qua mục Bài học mà boss ghi sau mỗi lần review. Cài đặt gần bằng không: không plugin Claude, không đụng profile agy, bốn lệnh trong `~/.local/bin`, một script khởi tạo cho mỗi dự án.

Vì sao: Vi-Habblaud có ≈105k dòng. Khoảng 60% là tính năng một người dùng không cần (World, Codex, remote, timelapse, Docker…). Cài đặt hiện cần 3 plugin Claude và sửa 8 profile agy. Người dùng muốn giữ phần lõi, bỏ phần thừa và thêm năm thứ nhỏ: ghế dùng chung tài khoản, skill nạp theo dự án, prompt giao việc 6 phần, vòng review → Bài học, `/advisor`.

Kịch bản mẫu: boss nhận việc "OCR 100 văn bản hành chính", chia cho W1 và W2. W2 gặp 10 văn bản bị xoay ngang mà W1 đã xử lý xong. W2 đọc Ghi chú kỹ thuật của W1 trong `task_board.md`; nếu vẫn kẹt thì `/advisor` hỏi boss; boss trả lời hoặc chuyển câu hỏi cho W1.

## 2. Quyết định đã chốt

Người dùng chốt (2026-11-03):

1. Giữ văn phòng pixel (renderer, nhân vật, phòng).
2. Bỏ Codex hoàn toàn: không boss, không worker, không hiển thị phiên Codex.
3. Skill: toàn bộ skill Claude hiện có nạp cho mọi agent, qua thư mục dự án. (Lúc hỏi tôi nêu "≈1k"; đếm lại là ≈390 thư mục skill, con số cũ tính cả file lồng trong ecc.)
4. Mỗi tài khoản mặc định 1 ghế, thêm ghế khi cần; hai ghế chung tài khoản chia nhau quota.
5. Boss tự chạy lệnh kiểm trong review, tối đa 2 vòng sửa rồi hỏi người dùng.
6. Worker chỉ sửa dòng việc của mình và thêm Ghi chú; boss tạo dòng việc và ghi Bài học.
7. Worker có cả `--mode auto` (mặc định) và `--mode plan` (người dùng duyệt).
8. Thêm lệnh `/advisor` để worker hỏi lại boss khi không hiểu.
9. Kiểm thử: Claude làm boss, agy làm worker, kèm trường hợp tách 1 tài khoản Claude thành nhiều worker.

Quyết định của tôi (người dùng có thể đổi):

- Worker = "ghế" `{name, kind, account}` trong `team.json`; bận tính theo ghế. (§6)
- Luật worker và Bài học nằm trong lời mở đầu mà `worker-ask` ghép vào mọi prompt, giống nhau cho cả hai loại agent và cho headless. (§12)
- `/advisor` hỏi boss thật qua terminal boss, không hỏi một mô hình thay thế. (§13)
- `worker-ask` từ chối prompt thiếu một trong 6 tiêu đề; `--raw` bỏ kiểm. (§11)
- Một lệnh `worker-ask <ghế> "<prompt>"` cho mọi loại; `agy-ask`, `claude-ask` giữ làm alias. (§15)
- Ghế Claude chạy "đủ" mặc định (có Skill tool, plugin, slash command); `--lean` chạy nhẹ như fork. Đảo mặc định của fork vì quyết định 3. (§7)
- agy nạp skill qua manifest `.agents/skills.json` trỏ đường dẫn tuyệt đối tới các thư mục skill sẵn có, không tạo 390 symlink trong dự án. (§8)
- Claude Code không đọc `.agents/skills/`, nên ba skill riêng của Bang_ver vào `<folder>/.claude/skills/` (3 link); ≈390 skill plugin không link thêm cho ghế Claude trên `~/.claude` vì đã có. (§8, §9)
- Trang vẫn hiện mọi phiên Claude đang mở trên máy, phòng theo thư mục, như upstream; chỉ lọc phiên quan sát của claude-mem. Boss = terminal mở từ nút "Mở boss" hoặc phiên được tiếp quản vào trang. (§6, §13)
- Không `git clone` vào `Bang_ver`; `git init` + fetch từ Vi-Habblaud để giữ lịch sử. (§4)

Chốt thêm khi duyệt (2026-11-03, "ok làm đi"):

- Ghế Claude dùng thư mục cấu hình riêng `~/.claude-worker`, đăng nhập cùng tài khoản một lần, không plugin; skill nhận qua link (§6, §8, §15). Bản thiết kế được duyệt với mọi quyết định của tôi ở trên.

## 3. Mục tiêu, không làm, phản mục tiêu

Mục tiêu:

- G1 Một office: nhân vật = mỗi ghế + boss; trạng thái rảnh/đang làm/cần người; feed hoạt động; drawer chi tiết; terminal PTY trong trang.
- G2 Giao việc tới ghế bất kỳ bằng một lệnh; mỗi việc là hội thoại mới; kết quả trả về CLI; chạy headless khi office tắt.
- G3 Nhiều ghế trên một tài khoản, cho Claude và agy.
- G4 `task_board.md` + `project_proposal.md` làm bộ nhớ dài hạn và kênh worker ↔ worker; Bài học do boss ghi, có trong mọi prompt.
- G5 Skill nạp theo thư mục dự án `.agents/skills/`, tự áp cho mọi agent mở trong thư mục đó.
- G6 Skill `giao-viec` ép prompt 6 phần; vòng review ≤2 lần; `/advisor` cho worker.
- G7 Cài đặt: `npm install && npm run build && npm run office`; `tools/install.sh`; `bang-init <folder>`.

Không làm: Codex (nguồn hiển thị và mod); nhiều office; nội quy (rules engine); World; remote/điện thoại/TLS; Docker; timelapse/My day; social sim; theme mùa; duyệt permission hay gửi tin từ trang web; usage Claude trên thanh trên.

Phản mục tiêu (thành công kỹ thuật nhưng vẫn là thất bại): thêm plugin Claude; sửa file trong `~/.agy_profiles/accN/.gemini/`; mất khả năng headless; một tính năng mới vượt 300 dòng; server idle nặng hơn hiện tại.

## 4. Tạo repo

- `Agent_Hub/Bang_ver/` đã chứa tài liệu này. Tạo repo: trong `Bang_ver`, `git init`, `git fetch ../Vi-Habblaud main`, `git checkout -b bang-ver FETCH_HEAD`, rồi commit `docs/`. Không `git clone` (thư mục không rỗng). Lịch sử giữ để `git diff` với fork.
- Mỗi hệ con xoá là một commit. Sau mỗi commit: `npm run typecheck && npx vitest run`.
- Sau khi repo chạy, `tools/install.sh` trỏ lại các link trong `~/.local/bin` (hiện trỏ về Vi-Habblaud).

## 5. Ràng buộc

- Node ≥ 22 (máy chạy 25.7); bỏ `engine-strict=true` trong `.npmrc`. Không thêm runtime dependency.
- Giữ cấu trúc fork: `server/` (Node, không deps), `client/` (Vite + TS, canvas), `shared/`, `tools/`.
- Tiếng Việt mặc định qua `tr()` + `shared/locales/vi.ts`; tiếng Anh vẫn chạy.
- Máy nhỏ (i3-7100T, 2C/4T, 12GB): server idle không nặng hơn fork (≈100MB, ≈1% CPU).
- Tài khoản: boss Claude = tài khoản Claude mặc định; worker agy = `~/.agy_profiles/accN` (7 tài khoản đã đăng nhập); worker Claude dùng chung tài khoản mặc định.

## 6. Ghế (slot)

`team.json` (một chỗ: `~/.agy_profiles/team.json` như hiện tại, hoặc `~/.habblaud/team.json`, builder chọn):

```json
{
  "folder": "/home/nhatbang/du-an/ocr",
  "boss": { "kind": "claude", "account": "default" },
  "workers": [
    { "name": "W1", "kind": "agy",    "account": "acc1" },
    { "name": "W2", "kind": "agy",    "account": "acc1" },
    { "name": "C1", "kind": "claude", "account": "default" },
    { "name": "C2", "kind": "claude", "account": "default" }
  ]
}
```

- `account`: agy = tên profile trong `~/.agy_profiles/`; claude = `default` (`~/.claude`) hoặc tên thư mục `~/.claude-<x>` (đặt `CLAUDE_CONFIG_DIR`).
- Thư mục cấu hình cho ghế Claude (đã chốt: `~/.claude-worker`): `~/.claude` của người dùng có ≈27 hook đăng ký trong `settings.json`: GateGuard của ecc chặn Bash/Edit/Write cho tới khi agent trình bày "facts", claude-mem ghi mọi PreToolUse/PostToolUse/Stop của worker vào bộ nhớ của người dùng, superpowers chạy ở SessionStart; mỗi hook là một tiến trình `node -e` trên máy 2 nhân, và hook chạy cả ở chế độ lean. Đề xuất: ghế Claude dùng `~/.claude-worker`, đăng nhập cùng tài khoản một lần (`CLAUDE_CONFIG_DIR=~/.claude-worker claude`), không cài plugin; skill thì nhận qua link (§8). Phương án kia: giữ `~/.claude` và đặt `ECC_GATEGUARD=off` trong env của worker; claude-mem thì không có công tắc tương tự đã biết.
- Một ghế = một nhân vật, một terminal PTY (mở khi có việc hoặc khi bấm), một việc tại một thời điểm. Fork khoá "một việc mỗi tài khoản" tại `server/workers/service.ts:11` và `:264`; đổi thành khoá theo ghế.
- Quota theo tài khoản; hai ghế chung tài khoản chia quota (người dùng chấp nhận).
- Đã kiểm 2026-11-03: hai `agy-as acc1 -p … --output-format stream-json` chạy song song trên cùng profile đều SUCCESS, hai `conversation_id` khác nhau, 16 giây tổng. Chữ "one agy per profile" trong fork là lựa chọn của server, không phải giới hạn của agy.
- Chạy đua agy: server tìm hội thoại của việc bằng cách chờ thư mục hội thoại mới xuất hiện (`service.ts:155`). Hai ghế cùng profile khởi động cách nhau vài giây sẽ gán nhầm. Giải pháp: xếp hàng khởi động theo tài khoản bằng tập `this.starting` sẵn có (khoá theo account), còn việc giữ theo ghế. Claude không có vấn đề này (session id theo terminal).
- Thêm hay bớt ghế = sửa `team.json`; server theo dõi file. Không có dialog tạo office; không có "seats theo office" của fork (xoá).
- Thư mục làm việc: mọi terminal và mọi việc chạy trong `folder`. Fork hiện mở worker agy ở `config.agy.room` (`server/pty/manager.ts:275`) và việc không có `--cwd` chạy ở `this.opts.room` (`service.ts:275`); đổi cả hai về `folder`. Bắt buộc, vì skill dự án và `CLAUDE.md` chỉ nạp khi cwd là thư mục dự án.
- Env cho tiến trình worker (PTY lẫn headless): `BANG_SLOT=<name>`, `BANG_OFFICE=<folder>`, để `advisor` biết mình là ai.
- Nút "Mở boss" mở terminal boss theo `boss.kind` (fork đã có `openProgram` với `AGY_BOSS=1`, `server/index.ts:473`).
- Tên nhân vật = `name` của ghế; `names.conf` xoá.
- Hiển thị: như upstream, mọi phiên Claude đang mở trên máy hiện thành nhân vật, phòng theo thư mục (`server/sources/watcher.ts`); thêm một bộ lọc bỏ phiên quan sát của claude-mem (`~/.claude-mem/observer-sessions/*`, hiện ra thành phòng "31"/"32"). Không lọc theo `folder`: người dùng vẫn thấy việc khác của mình, và đó là ít code nhất.
- Boss: sau khi bỏ team rule và dò `/proc`, server chỉ biết boss là terminal nó mở từ nút "Mở boss" (PTY, env `AGY_BOSS=1`) hoặc một phiên Claude được "tiếp quản" vào trang (fork đã có, `server/pty/manager.ts:398–421`). Boss chạy ở terminal ngoài vẫn giao việc được, nhưng `/advisor` không gõ được vào nó (CLI trả exit 1). Skill `giao-viec` nhắc boss mở từ trang.

## 7. Hai loại agent, cách chạy (giữ như fork)

| | Terminal trong office | Headless (office tắt) | Kết quả việc đọc từ |
|---|---|---|---|
| claude | `claude` trong `folder`, env `CLAUDE_CONFIG_DIR` theo `account`; một phiên mới mỗi việc | `claude -p "<prompt>" --output-format json --no-session-persistence [--permission-mode …]` (worker-ask:696) | transcript phiên (`server/sources/transcript.ts`) |
| agy | `agy-as <acc>` trong `folder`; mỗi việc một hội thoại mới | `agy-as <acc> -p "<prompt>" --output-format stream-json [--mode …]` (worker-ask:635) | thư mục hội thoại của profile (`server/sources/agy/`) |

Mới so với fork: cwd = `folder`, env `BANG_SLOT`, và ghế Claude chạy "đủ" mặc định. Fork chạy ghế Claude "lean" (`--disable-slash-commands --strict-mcp-config --tools Bash,Read,Edit,Write,WebFetch,WebSearch`, worker-ask:29–31, `service.ts:62–68`): không có Skill tool nên không nạp skill nào, trái quyết định 3. Bang_ver đảo lại: mặc định đủ; `--lean` giữ cách cũ cho việc nhỏ (rẻ hơn ≈16k token/việc, không skill).

## 8. Skill

- Nguồn: mọi skill Claude hiện có trên máy: `~/.claude/skills/*` (31) và `~/.claude/plugins/cache/<marketplace>/<plugin>/<phiên bản mới nhất>/skills/*` (ecc 311, superpowers 15, ponytail 6, claude-mem 27, impeccable 1), ≈390 skill. Không có tên trùng giữa các nguồn (đếm 2026-11-03), nên không cần luật đổi tên. Người dùng chốt "toàn bộ là ổn".
- agy đọc `{workspace}/.agents/skills/<name>/SKILL.md` (xác minh trong binary agy) và `~/.gemini/config/skills/` của profile.
- Claude Code (2.1.317) không đọc `.agents/skills/` (chuỗi đó trong binary chỉ thuộc phần nhập từ Cursor). Ghế Claude và boss trên `~/.claude` đã có ≈390 skill qua plugin; ba skill riêng của Bang_ver được `bang-init` link vào `<folder>/.claude/skills/` (3 link, mọi phiên Claude trong thư mục đều thấy; symlink skill Claude nạp bình thường, ví dụ `~/.claude/skills/agy-orchestrator` hiện là symlink). Nếu ghế Claude dùng `~/.claude-worker` (§6), `tools/install.sh --worker` link ≈390 skill vào `~/.claude-worker/skills/` một lần; không link vào `<folder>/.claude/skills/` để boss không thấy mỗi skill hai lần.
- Cách nạp cho agy: `bang-init` viết `<folder>/.agents/skills.json` thay cho symlink. Đã kiểm 2026-11-03 bằng `agy-as acc1 -p … --output-format stream-json`: agy nạp các thư mục nêu trong `entries[].path` (quét một cấp), gộp skill trùng tên (mỗi tên hiện một lần), và `include_only` lọc đúng. Đường dẫn phải tuyệt đối: entry `~/.claude/skills` không được nạp, `/home/nhatbang/.claude/skills` thì được. Mẫu:
  ```json
  { "entries": [
      { "path": "/home/nhatbang/.claude/skills" },
      { "path": "/home/nhatbang/.claude/plugins/cache/ecc/ecc/2.2.3/skills" },
      { "path": "/home/nhatbang/.claude/plugins/cache/superpowers-dev/superpowers/7.0.0/skills" },
      { "path": "…/ponytail/5.3.2/skills" }, { "path": "…/claude-mem/13.41.0/skills" }, { "path": "…/impeccable/4.6.0/skills" },
      { "path": "/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver/skills" }
  ] }
  ```
  `bang-init` tính phiên bản plugin mới nhất lúc chạy; đổi phiên bản thì chạy lại. `skills.list` (nếu có) thành `include_only` trên từng entry. Repo dự án không nhận 390 link; `.agents/skills.json` nên vào git của dự án.
- Symlink thư mục skill cũng được agy nạp (đã kiểm với một thư mục link trong `.agents/skills/` và với `~/.claude/skills/agy-orchestrator`), nên 3 link trong `<folder>/.claude/skills/` và `~/.claude-worker/skills/` dùng symlink được. (Plugin thì agy bỏ qua symlink, `tools/agy/install.sh:16`; skill thì không.)
- Mất chấp nhận: skill Claude dựa vào hook, agent, MCP hay `${CLAUDE_PLUGIN_ROOT}` không chạy trên agy; mỗi việc agy mang thêm ≈390 mô tả skill trong prompt. Đo 2026-11-03 (token đầu vào của một việc "liệt kê skill"): 9 skill → 8.977; 19 skill (thêm superpowers, mô tả ngắn) → 9.714; 40 skill (thêm `~/.claude/skills`, nhiều mô tả dài) → 26.830. Ngoại suy cho 390 skill: ≈30–60k token mỗi việc, tuỳ độ dài mô tả. Thoát: `skills.list` → `include_only`, ví dụ chỉ các skill boss hay nêu trong "Skill dùng". Thoát: nếu thư mục dự án có `skills.list` (mỗi dòng một tên), `bang-init` chỉ nạp các tên đó.
- Skill riêng của Bang_ver, trong `Bang_ver/skills/` và cũng được link vào `.agents/skills/`: `giao-viec` (boss, §11), `advisor` (worker, §13), `bang-task` (luật đọc và ghi `task_board.md`, thừa kế skill `bang_task` của người dùng ở `~/.codex/skills/bang_task`).

## 9. `bang-init`

`bang-init <folder>`: bash, ≈30 dòng, chạy lại an toàn.

1. Tạo `<folder>` nếu chưa có; chép mẫu `task_board.md` và `project_proposal.md` nếu chưa có.
2. Viết `.agents/skills.json` cho agy theo §8, và tạo `.claude/skills/` với 3 link `giao-viec`, `advisor`, `bang-task` cho Claude.
3. `GEMINI.md` là symlink tới `CLAUDE.md` (agy đọc `GEMINI.md`); nếu `CLAUDE.md` chưa có, tạo với một dòng "Chạy /init để điền".
4. Ghi `folder` vào `team.json` nếu chưa có office.
5. In hướng dẫn: mở boss Claude trong thư mục → `/init` → điền `project_proposal.md` → giao việc bằng skill `giao-viec`. Boss agy viết `CLAUDE.md` theo prompt tương đương `/init`.

## 10. Mẫu `task_board.md` và `project_proposal.md`

`task_board.md`:

```markdown
# Task board — <tên dự án>
_Office: <folder> · Boss: <kind/account> · Ghế: W1 agy/acc1, W2 agy/acc1, C1 claude/default_
_Cập nhật lần cuối: YYYY-MM-DD HH:MM (ai)_

## Bối cảnh
≤3 dòng. Chi tiết ở project_proposal.md.

## Việc đang làm
| ID | Việc | Ai | Trạng thái | Xong khi | Cập nhật |
|---|---|---|---|---|---|
| T1 | OCR 50 văn bản đầu (docs/001–050) | W1 | doing: 12/50 | out/001–050.txt có text, review ✅ | 11-03 15:20 |

## Ghi chú kỹ thuật
| Ngày | Ai | Vấn đề | Cách xử lý | Ở đâu |
|---|---|---|---|---|
| 11-03 | W1 | ảnh xoay 90° OCR ra rỗng | thử 4 góc xoay, chọn góc nhiều từ có nghĩa nhất | ocr.py:40 |

## Bài học (chỉ boss ghi; ≤20 dòng; dòng cũ chuyển sang task_board.archive.md)
- Khi OCR ra rỗng hoặc toàn ký tự lạ → thử xoay 90/180/270 trước khi đổi engine (vì 10/100 văn bản scan ngang) [T1]

## Hỏi đáp (advisor ghi tự động)
| Lúc | Ai | Hỏi | Trả lời |
|---|---|---|---|

## Đã xong
| ID | Việc | Xong lúc | Kết quả / đường dẫn | Review |
|---|---|---|---|---|

## Luật cho agent
1. Đọc file này trước khi làm. Chỉ sửa dòng việc của mình và thêm dòng vào Ghi chú kỹ thuật. Boss tạo dòng việc, ghi Review và Bài học, chuyển việc sang Đã xong.
2. Trạng thái một dòng: `todo` | `doing: <đến đâu>` | `blocked: <cần gì>` | `done`.
3. Giải quyết việc không hiển nhiên → một dòng Ghi chú kỹ thuật, có file:line.
4. Kẹt → đọc Ghi chú kỹ thuật của người khác trước; vẫn kẹt → `/advisor`; advisor không trả lời → ghi `blocked:` và DỪNG, không đoán.
5. Đường dẫn tương đối từ thư mục office. Đã xong quá 20 dòng → chuyển sang task_board.archive.md.
```

`project_proposal.md`:

```markdown
# Đề xuất dự án — <tên>
_Ngày · Người yêu cầu · Boss_

## Mục tiêu (1–2 câu, đo được)
## Phạm vi
- Trong:
- Ngoài:
## Input (ở đâu, định dạng, số lượng, một mẫu)
## Output (ở đâu, định dạng, ví dụ một file)
## Tiêu chí nghiệm thu (mỗi dòng = một lệnh kiểm được + kết quả mong đợi)
## Ràng buộc (công cụ, không cài gì, thời gian, quota)
## Phân chia dự kiến (ghế → phần việc)
## Rủi ro đã biết
```

## 11. Skill `giao-viec` (boss)

Luật: một việc = một dòng trong `task_board.md`; mọi phần suy từ `project_proposal.md` và kế hoạch boss vừa lập bằng skill của mình. Mẫu prompt, nguyên văn:

```
# Việc <ID> — <tên>              (ID trùng dòng trong task_board.md)
## Bối cảnh    ≤3 dòng, trỏ tới project_proposal.md §…
## Input       đường dẫn tương đối, định dạng, số lượng, 1 mẫu cụ thể; cái KHÔNG được đụng
## Skill dùng  <tên>: đọc .agents/skills/<tên>/SKILL.md trước; dùng ở bước nào
## Cách làm    bước đánh số; điều kiện dừng: gặp X → ghi "blocked: …" vào task_board và DỪNG, không đoán;
               giới hạn: chỉ sửa trong <thư mục>, không cài dependency, không commit
## Output      file + đường dẫn chính xác + định dạng; cập nhật dòng <ID> trong task_board (done | blocked: …);
               1 dòng Ghi chú kỹ thuật nếu giải quyết việc không hiển nhiên; báo cáo cuối ≤10 dòng
## Tiêu chí review  mỗi tiêu chí kèm LỆNH kiểm được
               vd: python ocr.py --in samples/ --out out/ → 10/10 file có text, rotated_01.png đọc đúng
```

Quy trình trong skill:

1. Tạo dòng việc trong `task_board.md`, rồi `worker-ask <ghế> "<prompt>" [--mode plan]`. Luôn chạy nền (Claude: `run_in_background`; agy: `&`) để boss rảnh trả lời `/advisor`.
2. Việc về: boss tự chạy từng lệnh trong "Tiêu chí review" trên sản phẩm, không tin báo cáo của worker. Ghi ✅ hoặc ❌ kèm lỗi cụ thể vào dòng việc.
3. ❌ → job sửa cho cùng ghế: đủ 6 phần + mục "Kết quả review lần trước" (đường dẫn, diff, lệnh đã chạy và output), vì worker là hội thoại mới. Tối đa 2 vòng; lần thứ ba hỏi người dùng.
4. ✅ → chuyển dòng sang Đã xong; nếu có điều đáng nhớ → một dòng Bài học dạng `Khi <tình huống> → <làm gì> (vì …) [ID]`.
5. Dùng `--mode plan` khi việc xoá hay ghi ngoài thư mục output, chạm dữ liệu gốc, hoặc cài gì; còn lại `auto`.

Ép buộc: `worker-ask` từ chối prompt thiếu một trong 6 tiêu đề (exit 1, in tiêu đề thiếu); `--raw` bỏ kiểm. Khoảng 5 dòng.

## 12. Lời mở đầu worker

Thay `apply_rules` (worker-ask:472–492). Ghép trước mọi prompt, office lẫn headless, cùng nội dung cho cả hai loại agent:

```
Bạn là ghế <name> trong office <folder>. Luật: đọc task_board.md trước khi làm; chỉ sửa dòng việc của mình;
kẹt thì đọc Ghi chú kỹ thuật, rồi chạy lệnh `advisor "<câu hỏi>"` và chờ trả lời; advisor thoát khác 0 (không có trả lời) thì ghi `blocked: <câu hỏi>` vào dòng việc của mình và dừng, thoát 0 thì làm theo câu trả lời; xong thì cập nhật dòng việc + báo cáo ≤10 dòng.

## Bài học (từ task_board.md)
<nội dung mục Bài học, nguyên văn>
---
<prompt của boss>
```

`install.sh` không còn đụng `GEMINI.md` hay plugin trong profile agy.

## 13. `/advisor` cho worker

Mục đích: worker không hiểu chỗ nào thì hỏi lại boss ngay trong việc, không phải dừng và đoán.

Luồng:

1. Worker (loại nào cũng được) chạy lệnh `advisor "<câu hỏi>"` qua công cụ shell. Lời mở đầu §12 nêu thẳng lệnh này nên agy và Claude lean cũng dùng được; skill `/advisor` chỉ là hướng dẫn hỏi cho đúng.
2. CLI đọc `BANG_SLOT`, `POST /api/advisor {slot, question}`, rồi long-poll `GET /api/advisor/:id?wait=` (như job hiện tại).
3. Server ghi câu hỏi vào việc đang chạy của ghế, hiện trong feed ("❓ W2 hỏi: …") và trên nhân vật (trạng thái cần boss), rồi gõ vào PTY boss:
   ```
   ❓ Ghế W2 hỏi (việc T2): <câu hỏi>
   → Trả lời ngắn, mở đầu đúng bằng thẻ [ADVISOR W2 T2]; đoạn trả lời đó được chuyển nguyên văn cho W2.
   ```
   Server chờ trong transcript boss (fork đã tail: `server/sources/transcript.ts`, `server/turns.ts`) một tin của assistant bắt đầu bằng thẻ `[ADVISOR W2 T2]`, không phải "lượt kế tiếp": boss giao việc chạy nền nên lượt kế tiếp có thể là phản ứng với thông báo việc T1 xong. Lấy tin có thẻ làm câu trả lời, ghi một dòng vào mục Hỏi đáp của `task_board.md`. Đây là cơ chế duy nhất trong thiết kế chưa kiểm trên máy.
4. CLI in câu trả lời, exit 0. Hết giờ (mặc định 10 phút), hoặc không có terminal boss do server mở hay tiếp quản (§6) → exit 1 kèm lý do.

Skill `/advisor` (worker) nói: dùng khi prompt mơ hồ, mâu thuẫn, thiếu input; hỏi một câu cụ thể kèm điều đã thử; exit 1 → ghi `blocked: <câu hỏi>` và dừng.

Lưu ý: nếu boss đang giữa một lượt, câu hỏi vào hàng đợi của Claude Code và được trả lời sau lượt đó; vì §11 bắt boss giao việc chạy nền nên boss thường rảnh. Boss agy: builder xác minh gõ vào PTY giữa lượt. Không dùng mô hình "advisor" headless thay boss trong v1 vì người dùng muốn hỏi lại boss; cân nhắc sau nếu boss hay vắng.

## 14. Chế độ worker

`--mode auto` mặc định trong thư mục office (không còn nội quy). `--mode plan` theo từng việc do boss chọn (§11); người dùng duyệt trong terminal PTY của ghế trên trang. Headless (office tắt) không có ai duyệt: việc `plan` trả về bản kế hoạch rồi kết thúc, boss đọc và giao lại bằng `auto` nếu đồng ý. "Cần người" phát hiện qua transcript như fork, không cần plugin.

## 15. Cài đặt

- `tools/install.sh`: link `worker-ask` (+ alias `agy-ask`, `claude-ask`), `agy-as`, `advisor`, `bang-init` vào `~/.local/bin`, ghi đè link hiện trỏ về Vi-Habblaud; gỡ link `~/.claude/skills/agy-orchestrator` (tạo lúc chạy thử 2026-11-03, trỏ vào Vi-Habblaud). Ngoài đó không đụng `~/.claude/skills`, không đụng profile agy.
- `tools/install.sh --worker` (chỉ khi người dùng chọn `~/.claude-worker`, §6): tạo `~/.claude-worker/skills/` với link tới ≈390 skill, rồi in lệnh đăng nhập một lần `CLAUDE_CONFIG_DIR=~/.claude-worker claude`. Lệnh đó phải chạy trong `<folder>` và chấp nhận tin cậy thư mục: fork dừng việc Claude mà tài khoản chưa tin cậy `cwd` (`service.ts:41,148,446–453`), nếu không mọi việc của C1/C2 chết ở TRUST_WAIT.
- `npm install && npm run build && npm run office` (`scripts/office.sh` có start|stop|restart; `HABBLAUD_PTY=1` mặc định).
- Không plugin Claude. `package.json` còn: `dev`, `build`, `start`, `office`, `typecheck`, `test`, `i18n:check`.
- Tuỳ chọn, chỉ khi người dùng muốn chạy từ lúc khởi động: systemd user unit, 10 dòng.

## 16. Cắt từ fork

| Hệ con | Vị trí | ≈dòng | Mất gì |
|---|---|---|---|
| World (thành phố, visit, coins, toà nhà) | `client/src/world/visit`, `client/src/ui/world`, `server/world*`, `shared/world` | 22.4k | thăm văn phòng người khác |
| Timelapse + My day | `*lapse*`, `*day*` | 5.8k | xem lại một ngày |
| Codex: nguồn hiển thị + mod | `server/sources/codex/` (7 file + test), `mod/habblaud-codex`, `codex` trong `server/config.ts:258` và `HABBLAUD_CODEX` | 4.6k | hiện phiên Codex trong office |
| `mod/` (3 plugin Claude) + `server/permissions` + `server/messages` + `server/deliveries` | | 2.3k+ | duyệt permission và gửi tin từ trang; usage Claude thanh trên; `/habblaud` |
| ~~Remote, điện thoại, TLS, mDNS~~ GIỮ (xem §21) | `server/remote/`, `server/http/remote.ts`, `client/src/net/access.ts`, `scripts/remote-*.ts` | 1.6k | không cắt: là lớp token truy cập cho deploy web |
| Installer cũ, Docker, release/shot tooling | `scripts/`, `docker/` | 2.5k | |
| Social sim + coins | | 2.2k | cảnh tụ tập bếp |
| Theme mùa, dictation, update checker, demo mode | | 1.8k+ | `?mock=1` để chụp demo |
| Nội quy | `shared/rules.ts`, `tools/agy/bin/office_rules.py`, `rules-hook`, `server/rules-log.ts`, proposals/limits/rev, `agy-ask rules`, `tools/agy/agy-plugin/office-rules`, `tools/agy/skills/office-rules` | | rào worker sửa ngoài thư mục; thay bằng `--mode plan` |
| Nhiều office | tabs, team dialogs, tạo/xoá office, seats theo office trong `server/team.ts`, `sources/agy/source.ts` | | |
| Team rule | `check_team`, `caller`, `is_boss`, dò `/proc`, `by`/`callerPid` trong worker-ask và server | | ai cũng giao được việc; giữ BUSY |
| Board UI + `server/sources/handoff.ts` | | | đọc `task_board.md` trực tiếp |
| herdr, `agy-up`, `agy-mode`, `agy-sync`, `roles.conf`, `names.conf` | `tools/agy/` | | |

Giữ dù tên gợi ngược: `client/src/world/{index,api,sim,render,layout,path}` là lõi vẽ office. `client/src/art/character/appearance.ts` import từ `shared/world/`: chuyển `appearance-flat.ts` vào `art/` trước khi xoá `shared/world`. Giữ `tr()` + `vi.ts` (3.5k dòng dữ liệu, tỉa khoá thừa bằng `i18n:check` hoặc để nguyên), ghosts (103 dòng).

Thứ tự xoá, theo số điểm import tăng dần: release/shots → docker → installer cũ → remote → dictation → update → demo → Codex (mod rồi nguồn) → timelapse/My day → social → World → mod + permissions/messages/deliveries → nội quy → nhiều office → team rule → Board. CSS theo prefix `.ui-world`, `.ui-visit`, `.ui-city`, `.ui-social`, `.ui-day`, `.ui-lapse`.

Kết quả kỳ vọng: ≈36–41k dòng; typecheck sạch; vitest còn lại xanh (xoá test của hệ con đã xoá; test CHANGELOG-version: builder quyết).

Ghi chú cho builder, từ lần kiểm tra thiết kế 2026-11-03:

- Nâng giới hạn 20k ký tự cho prompt việc (`server/workers/service.ts:262`): lời mở đầu + Bài học + "Kết quả review lần trước" dễ vượt.
- Bỏ đoạn `agy-as` ghi plugin `agy-boss` vào profile khi `AGY_BOSS=1` (`tools/agy/bin/agy-as:12–16`): phản mục tiêu "không đụng profile agy".
- `team.json` chuyển sang dạng phẳng ở §6; không giữ `offices[]`.
- Những nơi fork ghi "one agy per profile" (`server/team.ts:15`, `server/index.ts:453`, `service.ts:482`, `sources/agy/source.ts:854`) và `restart()` chờ terminal cũ chết: đổi theo mô hình ghế (§6).

## 17. Kiểm thử nghiệm thu

Theo kịch bản người dùng: boss Claude (tài khoản mặc định) mở trong `<folder>`; ghế W1, W2 = agy `acc1` (cùng tài khoản); C1, C2 = claude `default`. Bài toán giả OCR: `docs/` có 20 file text, 5 file "xoay" (dòng đảo ngược); `project_proposal.md` điền sẵn.

1. Trang hiện 1 boss (mở từ nút "Mở boss") + 4 nhân vật worker, tên theo ghế, trong phòng của `folder`; phiên Claude khác đang mở trên máy hiện ở phòng khác như upstream; terminal mỗi ghế mở được.
2. Boss giao T1 → W1 và T2 → W2 cùng lúc: cả hai chạy song song trên `acc1`; việc hiện đúng nhân vật; giao T3 cho W1 đang bận → BUSY.
3. C1 và C2 chạy song song cùng tài khoản Claude; boss vẫn gõ được.
4. Prompt thiếu tiêu đề bị `worker-ask` từ chối; `--raw` qua.
5. W2 gặp file xoay → `/advisor` → câu hỏi hiện trên trang và trong Hỏi đáp → boss trả lời → W2 nhận trong dưới 2 phút.
6. Boss review ❌ → job sửa → ✅ → dòng sang Đã xong; Bài học được ghi; việc kế tiếp của W1 có Bài học trong prompt (xem transcript).
7. Tắt office → `worker-ask W1 "…"` chạy headless, vẫn có lời mở đầu.
8. `npm run typecheck`, `npx vitest run`, `pytest tools/` xanh; server idle ≤ 110MB.

## 18. Rủi ro đã biết, không giải quyết trong v1

- Hai ghế ghi `task_board.md` cùng phút có thể ghi đè nhau. v1: luật "chỉ sửa dòng của mình, chỉ thêm dòng". v2: ghi qua `worker-ask` → server, một người ghi.
- Chạy đua hội thoại agy cùng profile → xếp hàng khởi động theo tài khoản (§6).
- ≈390 skill → thêm ≈30–60k token mỗi việc agy (đo được 26,8k với 40 skill) và ≈16k cho ghế Claude chạy đủ; `skills.list` và `--lean` để tỉa.
- Nếu người dùng giữ `~/.claude` cho ghế Claude (§6): GateGuard có thể chặn việc `auto` cho tới khi worker trình bày "facts"; claude-mem ghi việc của worker vào bộ nhớ người dùng; ≈27 hook `node -e` mỗi lần gọi công cụ trên máy 2 nhân. `ECC_GATEGUARD=off` trong env worker gỡ được GateGuard, chưa biết công tắc cho claude-mem.
- Xoá ≈45k dòng upstream khoá vĩnh viễn việc merge upstream (fork đã mất khả năng này từ bản dịch).

## 19. Để lại cho builder

- Thứ tự xoá chi tiết; cập nhật test, fixture, i18n sau mỗi bước.
- Vị trí `team.json`; định dạng `skills.list`; tên env (`BANG_SLOT`); cách chờ lượt boss trong transcript.
- Có xoá test CHANGELOG-version hay không; có tỉa `vi.ts` hay không.
- systemd unit (tuỳ chọn).

## 20. Thứ tự thực hiện

1. Repo + cắt (không có gì mới, mọi thứ vẫn chạy).
2. Ghế.
3. Thư mục skill + `bang-init` + hai mẫu file.
4. `giao-viec` + lời mở đầu + kiểm 6 tiêu đề + vòng review.
5. `/advisor`.

v1 = cả 5 bước.

## 21. Bổ sung tối 2026-11-03: deploy web và đăng nhập (thiết kế riêng, Kế hoạch 6)

Người dùng yêu cầu thêm sau khi duyệt: đưa office lên `hub.finstar.pp.ua` (subdomain của `finstar.pp.ua`, DNS trên Cloudflare, máy đã có `cloudflared` và mẫu `~/.config/finstar-console/cloudflared.yml` + systemd user unit), khoá API Cloudflare nằm ở `Bang_ver/.env` (`CLF_API_KEY`, không commit), và có đăng nhập + passkey theo thiết kế trong `/home/nhatbang/FPT_Capstone/UI_UX/`. Hệ quả cho bản này: hệ con `remote` không cắt (§16); "Không làm: remote/điện thoại/TLS" ở §3 bỏ. Thiết kế chi tiết (tunnel, xác thực, passkey không thêm runtime dependency hay có, Cloudflare Access làm lớp ngoài hay không) viết thành spec riêng `2026-11-0x-bang-ver-deploy-design.md` sau khi xem thư mục UI_UX; cần người dùng duyệt vì phơi terminal của máy ra Internet.
