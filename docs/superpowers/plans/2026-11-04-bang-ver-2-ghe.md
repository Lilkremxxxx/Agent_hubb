# Bang_ver — Kế hoạch 2/6: ghế

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay "nhiều office + team rule + một việc mỗi tài khoản" của fork bằng một office duy nhất có ghế: `~/.habblaud/team.json` phẳng (`{folder, boss, workers[]}`), mỗi ghế một nhân vật mang tên ghế, bận tính theo ghế, khởi động agy xếp hàng theo tài khoản, mọi terminal và việc chạy trong `folder` với `BANG_SLOT`/`BANG_OFFICE`, nút "Mở boss", ai cũng giao được việc.

**Architecture:** `server/team.ts` viết lại: đọc file phẳng (nhập một lần từ `~/.agy_profiles/team.json` khi chưa có, không bao giờ ghi file cũ), đọc lại file mỗi giây trong tick sẵn có, giữ boss đang mở trong bộ nhớ. `WorkerService` giữ một session mỗi ghế (khoá BUSY theo ghế) và một cổng khởi động mỗi tài khoản (`starting`, khoá theo account) để việc agy thứ hai chỉ chụp danh sách hội thoại sau khi hội thoại của việc thứ nhất đã hiện. `AgySource` nhận danh sách ghế (không còn office, không còn mặc định "mọi profile"). Client bỏ tab/menu/dialog office; server vẫn gửi `team.offices` có đúng một phần tử nên phần còn lại của client giữ nguyên. `worker-ask` tra ghế trong team.json, bỏ dò `/proc`.

**Tech Stack:** Node ≥22, TypeScript, Vite, vitest; Python 3 + pytest cho `tools/agy`; bash.

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-design.md` (§6 ghế là lõi; §2, §3, §5, §7, §16 các dòng "Nhiều office", "Team rule", "herdr…names.conf" và ghi chú builder, §17 bước 1–3 và 8, §20). Bàn giao từ Kế hoạch 1: mục "Để lại cho kế hoạch sau" của `2026-11-03-bang-ver-1-cat.md` và I5 + M-list của `2026-11-03-bang-ver-1-cat-final-review.md`.

Phán quyết của controller (ràng buộc như spec): file ghế ở `~/.habblaud/team.json` (`<dataDir>/team.json`, `HABBLAUD_DATA_DIR` đổi được); lần đầu không có file này thì nhập `offices[0]` của `~/.agy_profiles/team.json` rồi ghi file mới; Vi-Habblaud vẫn dùng file cũ nên Bang_ver không bao giờ ghi nó. Ghế Claude của người dùng là `~/.claude-worker`.

## Global Constraints

- Không thêm runtime dependency; `dependencies` trong `package.json` vẫn không có.
- Mọi chữ hiển thị qua `tr('English text')`; bản dịch duy nhất ở `shared/locales/vi.ts`; `npm run i18n:check` phải xanh: 0 thiếu, 0 khoá thừa (khoá của chữ đã xoá thì xoá).
- Code, comment, doc trong repo bằng tiếng Anh; kế hoạch tiếng Việt.
- Sau mỗi task: `npm run typecheck && npx vitest run && npm run i18n:check` xanh (cộng `cd tools/agy && python3 -m pytest -q tests` khi task đụng `tools/`). Được phép đỏ chỉ ba test flaky đã biết: `server/sources/tail.test.ts > detects replaced file (rotation) even if larger`, `server/sources/watcher.test.ts > tracks transcript appends and registry status`, `server/sources/watcher.test.ts > /clear: same process, new session — same character, reset tasks`. Không sửa, không `skip` hai test watcher đó; test mới của watcher là một `it` riêng.
- Mỗi task một commit; mọi commit kết thúc bằng đúng hai dòng:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKo78y8zx9LkivRuQac
  ```
- Phản mục tiêu §3 là giới hạn cứng: không plugin Claude; không ghi gì dưới `~/.agy_profiles/accN/.gemini/` (vì thế server và `worker-ask` gọi `agy-as` của repo, không gọi link `~/.local/bin/agy-as` đang trỏ về Vi-Habblaud, bản đó ghi plugin `agy-boss` vào profile khi `AGY_BOSS=1`); giữ đường headless; không tính năng mới nào thêm ròng quá 300 dòng; server idle ≤110 MB.
- Không bao giờ ghi `~/.agy_profiles/team.json` (chỉ đọc một lần để nhập).
- Không chạy `npm run build` hay `npm run office` trong thư mục repo: server office của người dùng đang chạy trên cổng 4747 từ `dist/` của chính repo này (pid đọc bằng `ss -ltnp | grep 4747`); build sẽ thay client nó đang phục vụ. Không dừng, không khởi động lại server 4747. Build và chạy thử chỉ trong worktree ở Task 10.
- Không đụng `~/.claude/`, `~/.local/bin`, `~/.claude-worker` (người dùng tự đăng nhập ở Task 10), profile agy.
- Ngoài phạm vi: skill/`bang-init`/mẫu (Kế hoạch 3), `giao-viec`/lời mở đầu/kiểm 6 tiêu đề/review/nâng giới hạn 20k ký tự (Kế hoạch 4), `/advisor` (Kế hoạch 5), deploy và phần Docker/host-helper còn sót I6 (Kế hoạch 6), link `tools/install.sh` (Kế hoạch 3), thế giới nhiều toà nhà ở client (`client/src/world/**` đọc `room.office`/`agent.office`; server thôi đặt hai trường này nên chỉ còn một toà).

## Quyết định của người viết kế hoạch (controller xem lại)

1. `folder` rỗng (file cũ của máy này có `"folder": ""`, nên lần nhập đầu ra rỗng) → server và `worker-ask` từ chối việc và "Mở boss" với 400/exit 1 chỉ tới `team.json`; nhân vật vẫn hiện (phòng = home). Không lặng lẽ dùng `~/Workspace/agy-hub`.
2. Boss Claude đang mở chỉ giữ trong bộ nhớ (terminal PTY chết cùng server); `team.json` chỉ có `{kind, account}`.
3. Hàng đợi khởi động trả ngay job `queued` (tick 1 giây khởi động nó), không giữ HTTP: `worker-ask` coi POST quá 10 giây là office chết và chạy headless. Trần chờ `START_SETTLE_MS` = 30 giây tính từ lúc mở terminal; Task 10 Step 7 đo khoảng thật để chỉnh.
4. Ghế đầu của một tài khoản agy giữ id `agy:<acc>` (bảng việc, việc `/proc`, level dựa vào id đó); ghế sau `agy:<acc>@<tên>`; ghế Claude `claude-worker:<tên>`; boss agy `agy-boss:<acc>`.
5. Server và `worker-ask` gọi `tools/agy/bin/agy-as` của repo ngay trong kế hoạch này (link `~/.local/bin` trỏ Vi-Habblaud, bản đó ghi plugin vào profile); `AgySource.assign` gọi `tools/agy/bin/worker-ask` của repo.
6. Terminal agy "bấm để mở" khi ghế rảnh (`PtyManager.openAgy`, `POST /api/pty {agy}`) không có client nào gọi → xoá; terminal của ghế mở khi có việc và xem được trong drawer.
7. Nghiệm thu build và chạy trong `git worktree` trên cổng 4749 với `HABBLAUD_DATA_DIR` riêng, vì `npm run build` trong repo sẽ thay client của server 4747.
8. Thế giới nhiều toà nhà ở client (`room.office`, `agent.office`, `focusOffice`) để nguyên: server thôi đặt nên chỉ còn một toà.

## Review Focus

Người review mỗi task và review cuối nhánh phải kiểm riêng các điểm sau; mỗi dòng có test ở task sở hữu.

1. **Khoá theo ghế khác cổng khởi động theo tài khoản.** W1 và W2 cùng `acc1` chạy song song; W2 không được chụp `known` (service.ts:484) trước khi hội thoại của W1 xuất hiện, nếu không `newDirs` (service.ts:635) gán nhầm hội thoại W1 cho W2. `ask` thứ hai không được chặn HTTP (worker-ask chờ POST 10 giây rồi chuyển headless): nó trả ngay job `queued`. W1 đang làm mà nhận việc nữa → 409 BUSY; ghế khác của cùng tài khoản thì không. → Task 5.
2. **cwd = `folder` ở mọi chỗ:** việc qua terminal (service.ts:261), terminal boss (index.ts:265), headless của `worker-ask` (`parse()` :106 dùng `os.getcwd()`), và `openAgy` ở `pty/manager.ts:275` (bị xoá vì không còn ai gọi). `folder` rỗng hoặc không phải thư mục có thật → 400 với thông báo chỉ tới `team.json`, không mở terminal ở chỗ khác. → Task 2, 3, 5, 7.
3. **Không ghi file cũ, không ghi đè file mới hỏng.** Nhập chỉ khi `~/.habblaud/team.json` không tồn tại; byte và mtime của `~/.agy_profiles/team.json` y nguyên; file mới đang có mà JSON hỏng thì không ghi đè, giữ đội cũ trong bộ nhớ; người dùng lưu dở (JSON hỏng giữa chừng) không làm mất ghế hay huỷ việc đang chạy. → Task 2.
4. **Bảng việc trong phòng còn sống.** `AgySource.publishBoard` tìm phòng bằng nhân vật `agy:<acc>`; với hai ghế cùng tài khoản, ghế đầu của tài khoản giữ id `agy:<acc>` nên bảng vẫn publish, việc `/proc` (headless) hiện trên ghế đầu, việc terminal hiện đúng ghế; tài khoản chỉ có ghế boss (`agy-boss:<acc>`) đứng đầu danh sách cũng không làm bảng mất. Hủy job đang `queued` không gõ ESC vào terminal rảnh. → Task 5, Task 6 (test riêng).
5. **i18n và chữ cũ.** Chữ "office tab", "＋ Worker", "agy-ask refuse everyone else", "registered worker" không còn ở trang hay CLI; mọi chữ mới có bản Việt; `i18n:check` 0/0. → Task 4, 9.

---

### Task 1: Gỡ máy "visit" chết và việc vặt còn lại của Kế hoạch 1

**Files:**
- Delete: `client/src/world/sim/visitor.ts`
- Modify: `client/src/world/sim/sim.ts` (import :35; `SimMode.visit` + `VisitLight` :49–59; trường `visit`/`visitor`/`visitorIntent`/`visitLight` :155–169; nhánh `this.visit` :262–263, :519–520, :775, :809, :983, :2039–2040; khối visitor/visit light ≈:2073–2220 và :2295; `Provider` import không dùng, M1), `client/src/world/index.ts` (import :16–17; `VisitWorld` :25–39; tuỳ chọn `visit` :43–46; `visitMode` và các nhánh :51–53, :183, :204–215, :222, :235, :264, :312–313, :428; `setSuspended` :438–451; thành viên `visit` :469–495; biến `assets` không đọc :56, M1), `client/src/world/api.ts` và `client/src/world/input.ts` (kiểu/tuỳ chọn chỉ phục vụ visit, nếu `grep -n -i visit` còn ra), `client/src/world/render/overlay.ts` (:342–352, :380, :742, :785–786, :982–983, :1049, :1101–1104), `client/src/world/render/renderer.ts` (tham chiếu visitor; `isArea`, `RECEPTION_ID` không dùng, M1), `client/src/ui/drawer.ts:51` (import `richText` không dùng, M1), `client/src/ui/termtabs.ts:108` (bỏ `!a.id.startsWith('demo:')`, M2), `client/src/ui/context.ts:25` (comment "alternative source"), `client/src/ui/overload.ts:120` (toast "Save the work to the HANDOFF file" → "Save your work and start a new session", M3), `shared/locales/vi.ts` (dòng ≈1363 `--allow`: "(mặc định: terminal)" → "(mặc định: none, chỉ xem)"; xoá khoá của chữ visit đã bỏ như `visitor`, `Waiting for the owner`; sửa khoá toast M3), `.gitignore` (xoá dòng `docker-compose.override.yml` và `HANDOFF*.md`, M11)
- Delete: `docs/screenshots/seasonal-christmas.png`, `seasonal-halloween.png`, `social-drawer.png`, `social-kitchen.png`, `social-lounge.gif`, `social-mirror.png`, `social-rps.png` (M11; trước khi xoá chạy `grep -rn "seasonal-\|social-" README.md docs CHANGELOG.md` và sửa tham chiếu nếu có)

**Interfaces:**
- Produces: `createWorld(canvas, store, o?)` trả `WorldApi & { debug: WorldDebug }` (không còn `visit`, `setSuspended`); `Sim` không còn tham số `mode`/`SimMode`. Không task sau nào dùng visit.

- [ ] **Step 1: Xoá**

`client/src/app.ts:26` gọi `createWorld(worldCanvas, store)` không có `visit`, nên mọi nhánh trên không bao giờ chạy. Xoá theo danh sách Files; số dòng là của HEAD 8ddb811, dò lại bằng `grep -n -i "visit\|setSuspended" client/src/world -r`.

- [ ] **Step 2: Kiểm sạch**

Run: `grep -rn -i "visitor\|visitmode\|visitlight\|VisitWorld\|setSuspended" client/src | wc -l`
Expected: `0`.
Run: `npx tsc --noEmit --noUnusedLocals -p tsconfig.json 2>&1 | grep "declared but" `
Expected: chỉ còn `client/src/ui/topbar.ts` (có từ upstream); không dòng nào trỏ vào file đã sửa ở task này.

- [ ] **Step 3: Kiểm chung**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
Expected: typecheck sạch; vitest xanh trừ flaky đã biết; i18n 0 thiếu 0 thừa.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(cut): remove the dead visit machinery and plan 1 leftovers"
```

---

### Task 2: Ghế — `team.json` phẳng ở `~/.habblaud`, nhập một lần, đọc lại khi sửa

**Files:**
- Rewrite: `server/team.ts`, `server/team.test.ts`
- Modify: `server/index.ts` (dựng `TeamService` :89–131; `seatsOf`/`targets` :199–236; xoá `appointAgyBoss` :238–253 và vòng mở terminal boss agy lúc khởi động :268–277, giữ `openAgyBossTerminal` cho `reopen`; route team :297–306), `server/http/app.ts` (`ApiDeps.team` :66–77 chỉ còn `appoint`; route `/api/team` :474–531 chỉ còn `{boss: agentId | null, pendingAccount?}`), `server/model/office.ts` (xoá `setPlacement`, `setRoomLabels`, `roomOffices`, `roomLabels`: :213–216, :575–602, :992, :1066 — dòng 1066 còn `this.deps.roomAlias?.(path)`)

**Interfaces:**
- Produces (trong `server/team.ts`; task sau dùng đúng tên):
```ts
export interface SeatRecord { name: string; kind: WorkerKind; account: string }
export interface TeamFile { folder: string; boss: { kind: WorkerKind; account: string }; workers: SeatRecord[] }
export interface Seat extends SeatRecord { agentId: string }
export const SEAT_NAME = /^[A-Za-z][\w-]{0,15}$/;
export function parseTeam(text: string): TeamFile;      // throws on bad JSON or a non-object
export function importTeam(oldText: string): TeamFile;  // ~/.agy_profiles/team.json: v3 offices[0], or v2 {boss, workers}
export function teamSeats(workers: readonly SeatRecord[]): Seat[];
export function claudeConfigDir(account: string, home: string): string; // 'default' -> <home>/.claude, 'x' -> <home>/.claude-x
export const agyBossId = (acc: string): string => `agy-boss:${acc}`;
export type TeamResult = { ok: true } | { ok: false; status: number; error: string };
export interface TeamServiceOptions {
  office: Office;
  file: string;          // <dataDir>/team.json
  oldFile?: string;      // <agy root>/team.json: read once to import, never written
  home: string;
  profiles?: () => Array<{ acc: string; account: string }>;
  onChange?: () => void; // seats or boss changed (after a reload)
  extra?: () => Pick<TeamInfo, 'sessions' | 'jobs'>;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  isDir?: (path: string) => boolean;
}
export class TeamService {
  constructor(opts: TeamServiceOptions);
  start(): void; stop(): void;
  get folder(): string;            // the file's folder if absolute and an existing dir, else ''
  get boss(): TeamFile['boss'];
  seats(): Seat[];
  seat(name: string): Seat | undefined;
  bossAgentId(): string | undefined; // the crowned boss character, else the pending one ("<account>:<pid>" of the PTY just opened)
  appoint(agentId: string | null, pending?: { account: string }): TeamResult;
  reload(): boolean;               // re-reads the file; true when the team changed
  sync(): void; publish(): void;
}
```
- Quy tắc agentId của ghế: agy, ghế đầu tiên của tài khoản → `agy:<acc>`, các ghế sau → `agy:<acc>@<name>`; claude → `claude-worker:<name>`. (Giữ `agy:<acc>` cho ghế đầu vì `AgySource` gắn bảng việc, việc `/proc`, level và full house vào id đó; Review Focus 4.)
- `parseTeam`: `folder` là chuỗi tuyệt đối thì chuẩn hoá bằng `officeFolder` cũ (đổi tên thành hàm nội bộ), khác → `''`; `boss` thiếu/hỏng → `{ kind: 'claude', account: 'default' }`; ghế bỏ nếu `name` không khớp `SEAT_NAME`, `kind` không là `claude|agy`, `account` không khớp `/^[\w.-]+$/`, hoặc trùng tên (giữ cái đầu).
- `importTeam` (bảng chuyển, `oldText` có thể là v3 `{offices:[…]}` hay v2 `{boss, workers}`):

| cũ | mới |
|---|---|
| `offices[0].folder` | `folder` (rỗng nếu thiếu) |
| boss `{kind:'agy', acc}` | `{kind:'agy', account: acc}` |
| boss Claude `account: '.claude'` / `'.claude-x'` | `{kind:'claude', account: 'default'}` / `'x'` |
| không boss | `{kind:'claude', account:'default'}` |
| worker `'accN'` | `{name:'accN', kind:'agy', account:'accN'}` |
| worker `'claude:.claude-x'` / `'claude:.claude'` | `{name:'x', kind:'claude', account:'x'}` / `{name:'claude', kind:'claude', account:'default'}` |

- Boss: `kind: 'agy'` → nhân vật `agyBossId(acc)` được đội vương miện mỗi khi có mặt; `kind: 'claude'` → bản ghi trong bộ nhớ do `appoint` (👑 Make boss, hoặc "Mở boss" với `pending`) tạo, giữ logic cũ: pending có pid chết thì bỏ, phiên đã bổ nhiệm đóng lại thì `waitingBoss`, `--resume` tìm lại theo account + session id. Không còn `boss.json`, không còn ghi boss vào file.
- `publish()` gửi `TeamInfo` = `{ offices: [{ id: 'main', name: basename(folder) || 'Office', folder, workers: <tên ghế>, bossKind, bossAccount?, bossAgentId?, pendingBoss?, waitingBoss?, roomId? }], workers: <tên ghế>, agy: profiles(), ...extra() }` (client hiện tại đọc được nguyên dạng này; `claude` và `workersRoomId` thôi gửi).
- Đọc lại: trong tick 1 giây có sẵn, `reload()` đọc nguyên văn file (file nhỏ) và so với lần trước; khác thì parse; parse lỗi → giữ đội cũ, `log.warnOnce`, không gọi `onChange`. Comment: `// shortcut: re-reads the small file every tick, use fs.watch if it ever grows`.
- Consumes (index.ts, tạm thời đến Task 5–6): `WorkerService` hiện có với target một-ghế-một-target (`id` = tên ghế, `name` = tên ghế, không truyền `seats`, `offices`), `room: team.folder || config.home`; `agy.setTeam(<acc của ghế agy>, <acc boss agy>, agySeats())` với `agySeats()` = ghế agy `{acc: s.account, agentId: s.agentId, name: s.name, room: team.folder || config.home, office: s.name}` (tạm đặt `office: s.name` để `sessionId` của nhân vật trong `AgySource.syncCharacters` không trùng giữa hai ghế; Task 6 đổi cách đặt) cộng boss agy `{acc, agentId: agyBossId(acc), name: <nhãn profile>, room}`. Target Claude dựng từ tên tài khoản, không cần tài khoản đã đăng nhập: `configDir = claudeConfigDir(s.account, config.home)`, `isDefault = s.account === 'default'`, `account = accounts.addDir(configDir) ?? basename(configDir)` (nhân vật C1/C2 có mặt ngay cả trước khi `~/.claude-worker` tồn tại).

- [ ] **Step 1: Viết test (thất bại)**

`server/team.test.ts` viết lại (giữ khung `setup()` dùng `Office` thật và `mkdtempSync`; `oldFile` và `file` trong thư mục tạm; `isDir: (p) => p.startsWith('/w')`). Các `it` và khẳng định:

```ts
it('parseTeam: flat file; bad seats dropped (name, kind, account, duplicate); boss defaults to claude/default', () => {
  const t = parseTeam(JSON.stringify({ folder: '/w/ocr/', workers: [
    { name: 'W1', kind: 'agy', account: 'acc1' }, { name: 'W1', kind: 'agy', account: 'acc2' },
    { name: '7x', kind: 'agy', account: 'acc1' }, { name: 'C1', kind: 'codex', account: 'x' },
    { name: 'C2', kind: 'claude', account: 'a b' }, { name: 'C3', kind: 'claude', account: 'worker' } ] }));
  expect(t).toEqual({ folder: '/w/ocr', boss: { kind: 'claude', account: 'default' }, workers: [
    { name: 'W1', kind: 'agy', account: 'acc1' }, { name: 'C3', kind: 'claude', account: 'worker' } ] });
  expect(parseTeam(JSON.stringify({ folder: 'rel/path' })).folder).toBe('');
  expect(() => parseTeam('{"folder": ')).toThrow();
});
it('importTeam: offices[0] of the old file (v3) and a v2 file become the flat file', () => {
  expect(importTeam(JSON.stringify({ offices: [
    { id: 'main', folder: '/w/p', boss: { kind: 'claude', id: '.claude-w:1', account: '.claude-w' }, workers: ['acc1', 'claude:.claude-w', 'claude:.claude'] },
    { id: 'two', folder: '/w/q', workers: ['acc9'] } ] }))).toEqual({ folder: '/w/p', boss: { kind: 'claude', account: 'w' }, workers: [
    { name: 'acc1', kind: 'agy', account: 'acc1' }, { name: 'w', kind: 'claude', account: 'w' }, { name: 'claude', kind: 'claude', account: 'default' } ] });
  expect(importTeam(JSON.stringify({ boss: { kind: 'agy', acc: 'acc5' }, workers: ['acc2'] }))).toEqual({
    folder: '', boss: { kind: 'agy', account: 'acc5' }, workers: [{ name: 'acc2', kind: 'agy', account: 'acc2' }] });
});
it('teamSeats: the first seat of an agy account keeps agy:<acc>; later ones and Claude seats are per name', () => {
  expect(teamSeats([{ name: 'W1', kind: 'agy', account: 'acc1' }, { name: 'W2', kind: 'agy', account: 'acc1' }, { name: 'C1', kind: 'claude', account: 'worker' }]).map((s) => s.agentId))
    .toEqual(['agy:acc1', 'agy:acc1@W2', 'claude-worker:C1']);
  expect(claudeConfigDir('default', '/h')).toBe('/h/.claude');
  expect(claudeConfigDir('worker', '/h')).toBe('/h/.claude-worker');
});
it('first run imports the old file once and writes the new one; the old file is never written', () => {
  const t = setup();
  writeFileSync(t.oldFile, JSON.stringify({ offices: [{ id: 'main', folder: '/w/p', workers: ['acc1'] }] }));
  const before = readFileSync(t.oldFile, 'utf8');
  const mtime = statSync(t.oldFile).mtimeMs;
  const svc = t.team();
  svc.start();
  svc.appoint('.claude:1');
  svc.reload();
  svc.stop();
  expect(t.saved()).toEqual({ folder: '/w/p', boss: { kind: 'claude', account: 'default' }, workers: [{ name: 'acc1', kind: 'agy', account: 'acc1' }] });
  expect(readFileSync(t.oldFile, 'utf8')).toBe(before);
  expect(statSync(t.oldFile).mtimeMs).toBe(mtime);
  // the new file exists now: the old one is not read again
  writeFileSync(t.oldFile, JSON.stringify({ offices: [{ id: 'main', folder: '/w/q', workers: ['acc9'] }] }));
  expect(t.team().seats().map((s) => s.name)).toEqual(['acc1']);
});
it('no file anywhere: writes an empty team to fill in', () => {
  // expect(saved()).toEqual({ folder: '', boss: { kind: 'claude', account: 'default' }, workers: [] }); expect(svc.folder).toBe('');
});
it('a broken team.json at start is not overwritten; fixing it is picked up by reload()', () => {
  // writeFileSync(file, '{ broken'); construct; expect(readFileSync(file,'utf8')).toBe('{ broken'); expect(svc.seats()).toEqual([]);
  // writeFileSync(file, valid with W1); expect(svc.reload()).toBe(true); expect(svc.seats().map((s) => s.name)).toEqual(['W1']);
});
it('reload: an edit adds or removes seats and calls onChange once; a half-saved file keeps the team', () => {
  const t = setup();
  const seat = (name: string) => ({ name, kind: 'agy', account: 'acc1' });
  writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1')] }));
  const svc = t.team();
  svc.start();
  writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1'), seat('W2')] }));
  expect(svc.reload()).toBe(true);
  expect(t.changes()).toBe(1);
  expect(svc.reload()).toBe(false);
  writeFileSync(t.file, '{"folder": "/w/p", "workers": [');
  expect(svc.reload()).toBe(false);
  expect(svc.seats().map((s) => s.name)).toEqual(['W1', 'W2']);
  expect(t.changes()).toBe(1);
  expect(readFileSync(t.file, 'utf8')).toBe('{"folder": "/w/p", "workers": [');
  svc.stop();
});
it('folder: an existing absolute folder, else empty', () => {
  // folder '/w/p' -> svc.folder '/w/p'; folder '/nope/p' (isDir false) -> ''
});
it('boss: appoint a Claude session, pending until it walks in, dropped when its process died; null steps down', () => {
  // port of the old "nobody is the boss…", "＋ Boss… pending", "exits before showing up" tests, without office ids;
  // expect(crowned()).toEqual([...]); expect(svc.bossAgentId()).toBe('.claude:1') after sync
});
it('an Antigravity boss is crowned whenever its character agy-boss:<acc> is in', () => {
  // file boss {kind:'agy', account:'acc5'}; office.addMain({ id: 'agy-boss:acc5', provider: 'agy', ... }); svc.sync(); expect(crowned()).toEqual(['agy-boss:acc5'])
});
it('publish: one office with the folder, the seat names and the boss character', () => {
  // expect(office.commit().snapshot.team).toMatchObject({ workers: ['W1', 'C1'], offices: [{ id: 'main', name: 'p', folder: '/w/p', workers: ['W1', 'C1'], bossAgentId: '.claude:1' }] })
});
```
(`setup()` trả thêm `oldFile`, `file`, `saved()`, `changes()` = số lần `onChange`. Các `it` có comment là khung bắt buộc: người viết điền theo comment, giữ đúng khẳng định nêu ra. Thêm vào test boss: sau "Mở boss" với `pending`, `bossAgentId()` trả id pending ngay, trước khi nhân vật xuất hiện.)

- [ ] **Step 2: Chạy, thấy đỏ**

Run: `npx vitest run server/team.test.ts`
Expected: FAIL (`parseTeam`/`importTeam`/`teamSeats` chưa có dạng mới).

- [ ] **Step 3: Viết `server/team.ts` mới**

Theo Interfaces. Header comment mới (tiếng Anh): một office, một thư mục, các ghế; file do người dùng sửa; `worker-ask` đọc cùng file. Giữ lại và dùng `canBeBoss`, `findBoss`, `pidOf` của bản cũ. Xoá: `OfficeRecord`, `officeSlug`, `teamSeats` cũ, `seatSuffix`, `workerAccount`, `workerAgentId`, `CLAUDE_WORKER`, `FIRST_OFFICE`, `createOffice/renameOffice/setFolder/deleteOffice/setWorker/appointAgy/checkFolder/place`, `legacyBossFile`. Ghi file chỉ ở hai chỗ: nhập lần đầu, và file không tồn tại (mẫu rỗng), qua `.tmp` + `rename` như cũ.

Chữ mới qua `tr()` + `vi.ts`, ví dụ `'team.json ({0}) could not be read: {1}'` → `'Không đọc được team.json ({0}): {1}'`.

- [ ] **Step 4: Nối dây**

`server/index.ts`: `new TeamService({ office, file: join(config.dataDir, 'team.json'), oldFile: join(agyRoot, 'team.json'), home: config.home, profiles: () => agy?.profiles() ?? [], onChange: () => { agy?.setTeam(…); late.workers?.sync(); }, extra })` (luôn ở `dataDir`, kể cả khi tắt Antigravity). Target và `agySeats()` như Interfaces. `reopen` của `PtyManager` tìm boss agy bằng `team.boss.kind === 'agy' && id === agyBossId(team.boss.account)`. `openAgyBossTerminal(acc)`: cwd = `team.folder`, env chỉ `{ AGY_BOSS: '1' }` (bỏ `AGY_OFFICE`, xem I2 của review Kế hoạch 1). `server/http/app.ts`: route `/api/team` còn `{boss, pendingAccount?}` → `deps.team.appoint(b.boss, …)`; mọi khoá khác → 400 `expected {boss}`. `server/model/office.ts`: xoá phần placement như Files.

- [ ] **Step 5: Kiểm**

Run: `npx vitest run server/team.test.ts && npm run typecheck && npx vitest run && npm run i18n:check`
Expected: xanh (trừ flaky). `grep -rn "createOffice\|deleteOffice\|setPlacement\|seatSuffix\|CLAUDE_WORKER" server` → 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(seats): flat team.json in ~/.habblaud, imported once, re-read on edit"
```

---

### Task 3: "Mở boss" phía server

**Files:**
- Modify: `server/index.ts` (hàm `openBoss`), `server/http/app.ts` (`ApiDeps.team.openBoss`, body `{openBoss: true}`), `server/http/http.test.ts` (một `describe` mới)

**Interfaces:**
- Consumes: `team.folder`, `team.boss`, `team.bossAgentId()`, `team.appoint(id, { account })`, `claudeConfigDir` (Task 2); `ptys.create({cwd, account})`, `ptys.ofAgent(id)`; `openAgyBossTerminal(acc)`.
- Produces: `ApiDeps.team = { appoint(agentId: string | null, pending?: { account: string }): TeamResult; openBoss?: () => Promise<{ ok: true; pty: PtyInfo } | { ok: false; status: number; error: string }> }`. `POST /api/team {"openBoss": true}` → 200 `{ok: true, pty}`; không có `openBoss` (PTY tắt) → 503 `the interactive terminal is off (HABBLAUD_PTY=1)`; qua remote hoặc Host lạ → 403 như các route team khác. Task 4 gọi route này.

- [ ] **Step 1: Test (thất bại)**

```ts
describe('POST /api/team {openBoss}', () => {
  it('opens the boss through deps.team.openBoss and returns its terminal; 503 without it; errors pass through', async () => {
    const pty = { id: 'p1-9', pid: 9, cwd: '/w/p', account: '.claude', agentId: '.claude:9', startedAt: 1 };
    const env = await start({ team: { appoint: () => ({ ok: true }), openBoss: async () => ({ ok: true, pty }) } });
    const post = (body: unknown) => fetch(`${env.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
    const r = await post({ openBoss: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, pty });
    await env.close(); env.cleanup();
    const off = await start({ team: { appoint: () => ({ ok: true }) } });
    expect((await fetch(`${off.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: '{"openBoss":true}' })).status).toBe(503);
    await off.close(); off.cleanup();
    const bad = await start({ team: { appoint: () => ({ ok: true }), openBoss: async () => ({ ok: false, status: 400, error: 'no folder' }) } });
    const b = await fetch(`${bad.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: '{"openBoss":true}' });
    expect([b.status, ((await b.json()) as { error: string }).error]).toEqual([400, 'no folder']);
    await bad.close(); bad.cleanup();
  });
});
```

- [ ] **Step 2: Chạy, thấy đỏ** — `npx vitest run server/http/http.test.ts` → FAIL (route chưa biết `openBoss`).

- [ ] **Step 3: Cài**

`app.ts`: nhánh `b.openBoss === true` trước nhánh `boss`. `index.ts` `openBoss()`:
1. `ptys` không có → `{ok:false, 503}`. `team.folder` rỗng → `{ok:false, 400, tr('the office has no folder yet: set "folder" in {0}', [teamFile])}`.
2. Boss đã có terminal mở (`ptys.ofAgent(team.bossAgentId() ?? '')`) → trả terminal đó (không mở hai boss).
3. `boss.kind === 'claude'`: `dir = claudeConfigDir(boss.account, config.home)`; `account = accounts.entries().find((e) => resolve(e.dir) === dir)?.id ?? accounts.addDir(dir)`; không có → 404 `tr('Claude Code account folder not found: {0}', [dir])`; `pty = ptys.create({ cwd: team.folder, account })`; `team.appoint(pty.agentId, { account: pty.account })`; trả `pty`.
4. `boss.kind === 'agy'`: profile không có → 404 `tr('Antigravity account not found: {0}', [acc])`; trả `openAgyBossTerminal(acc)` (cwd `team.folder`, env `AGY_BOSS=1`, file = `agyBin`).
Lỗi ném ra (`PtyError`) → `{ok:false, status: err.status ?? 500, error}`.

- [ ] **Step 4: Kiểm** — `npx vitest run server/http/http.test.ts && npm run typecheck && npx vitest run && npm run i18n:check` xanh.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(seats): open the boss terminal by boss.kind in the office folder"
```

---

### Task 4: Client — bỏ nhiều office, nút "Mở boss"

**Files:**
- Delete: `client/src/ui/office-tabs.ts`, `client/src/ui/office-menu.ts`, `client/src/ui/office-menu.test.ts`, `client/src/ui/team-dialogs.ts`
- Modify: `client/src/ui/index.ts` (import :37, :39; `officeId`/`OFFICE_KEY`/`showOffice` :77–90; `selectOffice` :161–172; `OfficeTabs` :255–261, :272, :282–283; `officeOfSelection` :333–335; `BuildingsWorld` :53–54), `client/src/ui/context.ts` (bỏ `selectOffice` :79; giữ `selectedOffice`, `officeFocus`), `client/src/ui/overload.ts:129` (bỏ nhánh `selectOffice`), `client/src/ui/sidebar.ts` (TeamDialogs :16, :95–101, :161–163, :182; nút ＋ :230–236, :284–291; ghi chú :425–434; header comment :1–6), `client/src/ui/drawer.ts` (bỏ `workerBtn`/`removeWorker` :217, :305–318, :506–520, :586; `toggleBoss` :527–544 và nhãn :578–584 không còn office), `client/src/ui/agy-panel.ts:18,135` (không gửi `office`), `client/src/ui/workers-api.ts` (+ `.test.ts`), `client/src/ui/offices.ts` (+ `.test.ts`), `client/src/ui/pty.ts`, `client/src/ui/termtabs.ts` (thay `sessionAgents(s)` bằng `[s.agentId]`), `client/src/world/sim/sim.ts:189` (`[s.agentId]`), `client/src/ui/help.ts` (chữ nói về tab office, ＋ Worker, team rule — `grep -n -i "office tab\|＋ Worker\|refuse" client/src/ui/help.ts`), `client/src/ui/styles.css` (khối CSS của các class chỉ file đã xoá dùng), `shared/types.ts` (xoá `TeamInfo.claude`, `OfficeInfo.workersRoomId`; sửa comment `TeamInfo.offices`/`OfficeInfo` thành "the one office"), `shared/locales/vi.ts`

**Interfaces:**
- Consumes: `POST /api/team {openBoss: true}` → `{ok, pty}` (Task 3); `{boss: agentId | null}` (Task 2).
- Produces (`client/src/ui/workers-api.ts`): `openBoss(): Promise<PtyInfo | undefined>`; `AskRequest = { worker: string; prompt: string; role?: string; mode?: string; effort?: string }`; `askWorker(req)` gửi đúng `req` (không `by`, không `office`); `sessionOfAgent(team, agentId)` chỉ so `s.agentId`; `workerOfAgent(team, a)` = `sessionOfAgent(team, a.id)?.worker`. Xoá: `appointAgyBoss`, `setWorker`, `createOffice`, `renameOffice`, `setOfficeFolder`, `deleteOffice`, `freeWorkers`, `WorkerChoice`, `sessionAgentIn`, `sessionAgents`, `inOffice`. `offices.ts` giữ `OfficeFocus`, `teamOffices`, `pickOffice`, `officeBoss`, `officeFocus`, `sameFocus`, `agentOfficeId`, `roomOfficeId` (world còn dùng); xoá phần còn lại khi `grep` không còn người gọi.

- [ ] **Step 1: Test (thất bại)**

`workers-api.test.ts`: xoá test của hàm bị xoá; thêm:
```ts
it('a seat\'s session is found by its one character', () => {
  const team = { sessions: [{ worker: 'W2', kind: 'agy' as const, agentId: 'agy:acc1@W2', account: 'agy:acc1' }] };
  expect(sessionOfAgent(team, 'agy:acc1@W2')?.worker).toBe('W2');
  expect(workerOfAgent({ ...team, workers: ['W2'] }, { id: 'agy:acc1', provider: 'agy' })).toBeUndefined();
});
```
Run: `npx vitest run client/src/ui/workers-api.test.ts` → FAIL (fallback `agy:` cũ trả `acc1`).

- [ ] **Step 2: Cắt và nối**

Sidebar: nhóm Boss giữ ＋, nhãn/aria `tr('Open the boss')`, bấm → `openBoss()` rồi `this.ctx.terminals?.showPty?.(pty)` và `ctx.announce(tr('The boss is opening in the terminal…'))`; lỗi → `ctx.announce(tr("Didn't work: {0}", [msg]))`. Nhóm Workers không có ＋. Ghi chú nhóm trống: Boss → `tr('Nobody yet: ＋ opens the boss in the office folder, or press “👑 Make boss” on an open Claude session.')`; Workers → `tr('No seats yet: add them to ~/.habblaud/team.json.')`. Gợi ý nhóm (`roleHint`): Workers → `tr('The seats in ~/.habblaud/team.json: each one gets jobs from the boss or from you.')`. Bản dịch Việt cho mỗi chữ mới, ví dụ `'Open the boss'` → `'Mở boss'`.

- [ ] **Step 3: Kiểm**

Run: `grep -rn "office-tabs\|office-menu\|team-dialogs\|createOffice\|deleteOffice\|setOfficeFolder\|freeWorkers\|sessionAgentIn\|sessionAgents\|s\.agentIds\|selectOffice" client shared | wc -l`
Expected: `0` (`OfficeFocus.agentIds` trong `world/` và `offices.ts` là trường khác, giữ).
Run: `npm run typecheck && npx vitest run && npm run i18n:check`
Expected: xanh; i18n 0/0 (khoá của tab, menu, dialog đã xoá).
CSS chết: chạy lại lệnh Step 2 Task 15 của Kế hoạch 1 (`grep -o "\.ui-[a-z-]*" client/src/ui/styles.css | sort -u …`) và xoá khối của class không còn trong TypeScript.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(seats): one office on the page; the boss button opens the boss; no office tabs or team dialogs"
```

---

### Task 5: WorkerService — khoá theo ghế, cổng khởi động theo tài khoản, cwd = folder, env

**Files:**
- Modify: `server/workers/service.ts`, `server/workers/service.test.ts`, `server/http/app.ts` (parser `ask` :226–246 bỏ `by`, `callerPid`, `office`; kiểu `cancel` :82), `server/index.ts` (tuỳ chọn `folder`), `shared/types.ts` (xoá `WorkerJob.by`, `WorkerJob.office`, `WorkerSession.agentIds`, `JobBoardItem.by`, `JobBoardItem.office`), `server/sources/agy/source.ts` (thôi đặt `by`/`office` cho mục bảng: :520, :525, :636–639, `AgyAskLine.office` :78), `server/sources/agy/source.test.ts:474,483` (bỏ `by`, `office` trong dữ liệu và kỳ vọng)

**Interfaces:**
- Consumes: target một-ghế từ index (Task 2).
- Produces:
```ts
export const START_SETTLE_MS = 30_000;
export interface WorkerTarget { id: string /* seat name */; kind: WorkerKind; agentId: string; account: string; name: string; acc?: string; stateDir?: string; configDir?: string; isDefault?: boolean }
export interface AskInput { worker: string; prompt: string; cwd?: string; role?: string; mode?: string; effort?: string; model?: string; max?: number; lean?: boolean }
// WorkerServiceOptions: `room: string` -> `folder: () => string` ('' = no folder); `offices` removed
```
- Hành vi:
  - `ask`: ghế lạ → 400 (giữ chữ cũ); `!input.cwd && !folder()` → 400 `tr('the office has no folder yet: set "folder" in ~/.habblaud/team.json')`; ghế có job live → 409 `busy: 'job'`.
  - `private readonly starting = new Map<string, Job>()` khoá theo `t.account` (tài khoản agy hay Claude); cổng **rảnh** khi không có job, job không còn live, job đã có `conv`, hoặc `now - job.launchedAt >= START_SETTLE_MS` (`launchedAt` đặt khi terminal của job mở, cùng lúc `ptyPid`; đo từ lúc mở chứ không từ `startedAt`, vì `restart()` có thể chờ tới 8 giây). Cổng rảnh → đặt cổng = job này, khởi động ngay (await như hiện nay, lỗi → 500). Cổng bận → `job.status = 'queued'`, đẩy `{s, job, prompt}` vào hàng FIFO, trả ngay `{ok: true, job}`.
  - `tick()` trước khi kiểm job: với mỗi mục hàng còn live mà cổng tài khoản của nó rảnh → đặt cổng, `status = 'working'`, `void this.launch(…).catch(err => this.finish(job, 'failed', 'ERROR', errMsg(err)))`.
  - `launch(s, job, prompt)`: `restart` + `jobProgram` rồi dòng log `start`, bảng, activity, `changed` (chuyển từ `ask` ra).
  - Job dùng `cwd = input.cwd ?? folder()`; `open()` thêm env `BANG_SLOT: t.id`, `BANG_OFFICE: folder()` (giữ `CLAUDE_CONFIG_DIR` như cũ). Nhân vật Claude của ghế: `cwd = folder() || homedir()`, `name = t.name`.
  - Huỷ một job chưa có terminal (`ptyPid === undefined`, tức đang `queued` hoặc đang chờ terminal cũ đóng) → `finish` thẳng, không gõ ESC (ESC vào terminal agy rảnh của ghế làm agy thoát).
  - Bỏ: `seatsOf`, `officeOfJob`, `cancel({office})`, `agentIds`, `by`, `callerPid`, `claude_pid`/`office` trong dòng log. Comment :11 → "One job per seat at a time (BUSY); seats on one account start one after another." Comment `restart` :468 → "one terminal per seat".

- [ ] **Step 1: Sửa `setup()` của test**

Target: `W1 {id:'W1', kind:'agy', agentId:'agy:acc2', account:'agy:acc2', name:'W1', acc:'acc2', stateDir}`, `W2 {id:'W2', agentId:'agy:acc2@W2', …cùng acc2/stateDir}`, `C1 {id:'C1', kind:'claude', agentId:'claude-worker:C1', account:'.claude-w', name:'C1', configDir}`; `folder: () => folder` với `let folder = root` và `setFolder(f)` trong helper; `office.addMain` cho `agy:acc2` và `agy:acc2@W2`. Thêm `const settle = () => new Promise((r) => setImmediate(r));`. Đổi tên trong test cũ: `'acc2'` → `'W1'`, `'claude:.claude-w'` → `'C1'`, `'claude-worker:.claude-w'` → `'claude-worker:C1'`; xoá hai test `offices:` và `seats:` (:373–407) và mọi `by`/`callerPid`/`claude_pid`.

- [ ] **Step 2: Test mới (thất bại)**

```ts
it('two seats on one agy account: the second waits for the first conversation, then each reads its own', async () => {
  const t = setup();
  expect(await t.svc.ask({ worker: 'W1', prompt: 'one' })).toMatchObject({ ok: true, job: { status: 'working' } });
  expect(await t.svc.ask({ worker: 'W2', prompt: 'two' })).toMatchObject({ ok: true, job: { status: 'queued' } });
  expect(t.open.has('agy:acc2@W2')).toBe(false);
  t.agyWrites([{ type: 'USER_INPUT', status: 'DONE', content: 'one' }], CONV);
  t.svc.tick();
  await settle();
  expect(t.svc.jobs().find((j) => j.worker === 'W2')?.status).toBe('working');
  expect(t.open.get('agy:acc2@W2')?.args).toEqual(['acc2', '-i', 'two']);
  t.agyWrites(answer('two done'), CONV2);   // CONV2 = '3b094ff8-a5b3-44d7-82d5-ac4ec8b1b6cc'
  t.svc.tick();
  expect(t.svc.jobs().find((j) => j.worker === 'W2')).toMatchObject({ status: 'done', answer: 'two done' });
  expect(t.svc.jobs().find((j) => j.worker === 'W1')?.status).toBe('working');
  t.agyWrites(answer('one done'), CONV);
  t.svc.tick();
  expect(t.svc.jobs().find((j) => j.worker === 'W1')).toMatchObject({ status: 'done', answer: 'one done' });
});
it('a seat on a job answers BUSY; the other seat of the account and a Claude seat do not', async () => {
  const t = setup();
  await t.svc.ask({ worker: 'W1', prompt: 'a' });
  expect(await t.svc.ask({ worker: 'W1', prompt: 'b' })).toMatchObject({ ok: false, status: 409, busy: 'job' });
  expect((await t.svc.ask({ worker: 'W2', prompt: 'c' })).ok).toBe(true);
  expect(await t.svc.ask({ worker: 'C1', prompt: 'd', cwd: t.root })).toMatchObject({ ok: true, job: { status: 'working' } });
});
it('no conversation within START_SETTLE_MS: the queued seat starts anyway', async () => {
  const t = setup();
  await t.svc.ask({ worker: 'W1', prompt: 'a' });
  await t.svc.ask({ worker: 'W2', prompt: 'b' });
  t.advance(START_SETTLE_MS - 1); t.svc.tick(); await settle();
  expect(t.open.has('agy:acc2@W2')).toBe(false);
  t.advance(2); t.svc.tick(); await settle();
  expect(t.open.has('agy:acc2@W2')).toBe(true);
});
it('a queued job cancelled before its start never opens a terminal', async () => {
  const t = setup();
  await t.svc.ask({ worker: 'W1', prompt: 'a' });
  const r = await t.svc.ask({ worker: 'W2', prompt: 'b' });
  expect(t.svc.cancel({ job: (r as { job: { id: string } }).job.id })).toBe(1);
  t.advance(START_SETTLE_MS); t.svc.tick(); await settle();
  expect(t.open.has('agy:acc2@W2')).toBe(false);
  expect(t.typed).toEqual([]);
});
it('every job runs in the office folder with BANG_SLOT and BANG_OFFICE; no folder and no cwd = 400', async () => {
  const t = setup();
  await t.svc.ask({ worker: 'W1', prompt: 'a' });
  expect(t.open.get('agy:acc2')).toMatchObject({ cwd: t.root, env: { BANG_SLOT: 'W1', BANG_OFFICE: t.root } });
  await t.svc.ask({ worker: 'C1', prompt: 'b' });
  expect(t.open.get('claude-worker:C1')).toMatchObject({ cwd: t.root, env: { BANG_SLOT: 'C1', BANG_OFFICE: t.root, CLAUDE_CONFIG_DIR: t.configDir } });
  expect(t.office.get('claude-worker:C1')?.name).toBe('C1');
  t.setFolder('');
  expect(await t.svc.ask({ worker: 'W2', prompt: 'c' })).toMatchObject({ ok: false, status: 400 });
});
```
Run: `npx vitest run server/workers/service.test.ts` → FAIL.

- [ ] **Step 3: Cài** theo Interfaces. Không dùng `setTimeout` cho cổng (cổng chỉ do `tick()` và đồng hồ `now` quyết, nên test xác định được).

- [ ] **Step 4: Kiểm** — `npx vitest run server/workers/service.test.ts && npm run typecheck && npx vitest run && npm run i18n:check` xanh.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(seats): one job per seat; seats on one account start in turn; jobs run in the office folder with BANG_SLOT"
```

---

### Task 6: AgySource theo ghế; bỏ `names.conf` và terminal agy thủ công; `agy-as` của repo

**Files:**
- Modify: `server/sources/agy/source.ts`, `server/sources/agy/source.test.ts`, `server/sources/agy/profiles.ts` (xoá `parseNamesConf`, `AgyProfile.name`, đọc `names.conf`; `workerName` = phần trước `@`/`.` của e-mail, else acc), `server/workers/service.ts` (`statusOf(agentId)`), `server/pty/manager.ts` (xoá `PtyAgy`, tuỳ chọn `agy`, `openAgy` :69–77, :85, :254–282 — không client nào gọi), `server/http/pty.ts` (nhánh `{agy}` :90 và dòng doc :4), `server/pty/manager.test.ts` nếu có tham chiếu, `server/index.ts`
- Modify (M12): `server/sources/agy/source.ts:611` ngoặc thừa.

**Interfaces:**
- Produces:
```ts
export interface AgySeat { acc: string; agentId: string; name: string; room: string; boss?: boolean }
class AgySource {
  setTeam(seats: readonly AgySeat[]): void;          // replaces (workers, bossAccs, seats); no seats = no characters
  setExternal(fn: (agentId: string) => { busy: boolean; role?: string } | undefined): void;
  assign(agentId: string, job: AgyJobInput): AgyJobResult; // runs `<askBin> <seat name> <prompt> --role … --max 2000` in folder()
  stopJobs(agentId: string): number; setDefaults(agentId: string, d: AgyDefaults): AgyJobResult; // resolve the seat's acc
}
// AgySourceOptions: remove `room`, `jobsDir`; add `askBin: string; folder: () => string`
// WorkerService: statusOf(agentId: string): { busy: boolean; role?: string } | undefined
```
- `publishBoard` tìm phòng bằng nhân vật đầu tiên trong `this.shown` (không dùng `this.present[0].id`: tài khoản chỉ có ghế boss thì không có nhân vật `agy:<acc>`). `sessionId` của nhân vật trong `syncCharacters`: ghế đầu của tài khoản giữ `agy-<acc>` như cũ (tên/dáng đã lưu trong `names.json` theo sessionId), ghế khác và ghế boss dùng `agy-<agentId>` (duy nhất mỗi ghế).
- Xoá trong `AgySource`: `team`, `bossAccs`, `seatList | undefined` (mặc định "mọi profile"), `seed()`, `worker()`, `env.AGY_ASK_FROM_OFFICE`. `present` = profile có ít nhất một ghế. Tiêu đề "boss" theo `seat.boss`, không theo acc. Việc `/proc` và level vẫn gắn `w.id` = `agy:<acc>` (ghế đầu của tài khoản, Task 2). Comment "One agy per profile" ở `refreshUsage` (:783) → "an account whose agy is running waits for the next round".
- `index.ts`: `agyBin = join(config.rootDir, 'tools', 'agy', 'bin', 'agy-as')` dùng cho `WorkerService`, `openAgyBossTerminal` và `createAccountsRoutes` (:338); `askBin = join(config.rootDir, 'tools', 'agy', 'bin', 'worker-ask')`; `agy.setTeam(agySeats())`; `agy.setExternal((id) => workers.statusOf(id))`; bỏ `agy` khỏi `new PtyManager`.

- [ ] **Step 1: Test (thất bại)**

`setup()` của `source.test.ts` thêm helper `seats(accs: string[])` = `accs.map((acc) => ({ acc, agentId: `agy:${acc}`, name: `${acc} (Agy)`, room: '/w/agy-hub' }))` và gọi `source.setTeam(seats(names))` trước khi trả; các test cũ gọi `setTeam(['acc2'])` đổi thành `setTeam(t.seats(['acc2']))`; test "team:" bỏ `seed()` và `worker()`; test "seats:" (:550–571) thay bằng:
```ts
it('two seats on one account: named by seat in the folder room; the board still shows; a terminal job only on its seat', () => {
  const t = setup();
  let busy = '';
  t.source.setExternal((id) => ({ busy: id === busy }));
  t.source.setTeam([
    { acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: '/w/ocr' },
    { acc: 'acc2', agentId: 'agy:acc2@W2', name: 'W2', room: '/w/ocr' },
  ]);
  t.source.start();
  const get = (id: string) => t.office.commit().snapshot.agents.find((a) => a.id === id);
  expect(get('agy:acc2')).toMatchObject({ name: 'W1', roomId: '/w/ocr' });
  expect(get('agy:acc2@W2')).toMatchObject({ name: 'W2', roomId: '/w/ocr', provider: 'agy' });
  busy = 'agy:acc2@W2';
  t.source.poll();
  expect([get('agy:acc2')?.status, get('agy:acc2@W2')?.status]).toEqual(['idle', 'working']);
  t.source.upsertJob({ id: 'agy:acc2@W2#w1', agentId: 'agy:acc2@W2', worker: 'W2', text: 'two', status: 'working', at: 1 });
  expect(t.office.commit().snapshot.rooms.find((r) => r.id === '/w/ocr')?.board?.items.map((i) => i.worker)).toEqual(['W2']);
  // a headless agy of acc2 (seen in /proc) shows on the account's first seat
  t.job(41, 'acc2', 'Hello');
  t.source.poll();
  expect(get('agy:acc2')?.status).toBe('working');
});
it('an Antigravity boss seat is titled boss; the worker seat of the same account is not', () => {
  // setTeam([{acc:'acc2', agentId:'agy:acc2', name:'W1', room:'/w/ocr'}, {acc:'acc2', agentId:'agy-boss:acc2', name:'two (Agy)', room:'/w/ocr', boss:true}])
  // expect titles: 'agy-boss:acc2' -> 'boss', 'agy:acc2' -> 'free'
});
it('an account with only the boss seat sorts first: the board still publishes', () => {
  // setup(['acc1', 'acc2']); setTeam([{acc:'acc1', agentId:'agy-boss:acc1', name:'boss', room:'/w/ocr', boss:true}, {acc:'acc2', agentId:'agy:acc2', name:'W1', room:'/w/ocr'}]);
  // start(); upsertJob({... agentId:'agy:acc2', worker:'W1' ...}); expect(board of room '/w/ocr' items).toHaveLength(1)
});
it('assign runs worker-ask with the seat name in the office folder', async () => {
  // folder() = t.root (a real temp folder; spawn needs an existing cwd), seats' room = t.root
  // askBin = temp script: #!/bin/sh\nprintf '%s\n' "$PWD" "$@" > "$OUT"   (OUT passed through opts.env)
  // t.source.assign('agy:acc2@W2', { prompt: 'x', mode: 'plan' }) -> { ok: true }; wait for the file;
  // expect(lines).toEqual([folder, 'W2', 'x', '--role', 'manual', '--max', '2000', '--mode', 'plan'])
});
```
Và test tên (`:77–85`): `names.conf` không còn được đọc — `workerName({acc:'acc2', email:'alice.nguyen@gmail.com'})` = `'alice'`, `workerName({acc:'acc2'})` = `'acc2'`; có file `names.conf` thì `discoverAgyProfiles(root).map(workerName)` vẫn ra tên theo e-mail.
Run: `npx vitest run server/sources/agy` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces.

- [ ] **Step 3: Kiểm**

Run: `grep -rn "names.conf\|parseNamesConf\|openAgy\|PtyAgy\|AGY_ASK_FROM_OFFICE\|\.local', 'bin', 'agy-as'" server | wc -l`
Expected: `0`.
Run: `npm run typecheck && npx vitest run && npm run i18n:check` → xanh.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(seats): Antigravity characters per seat; drop names.conf and the manual agy terminal; run the repo's agy-as"
```

---

### Task 7: `worker-ask` — ghế theo tên, bỏ team rule, `--lean`

**Files:**
- Modify: `tools/agy/bin/worker-ask`, `tools/agy/tests/test_worker_ask.py` (viết lại lớp `TeamRule` thành `Seats`; giữ nguyên lớp `BossRulesHook`, số phận plugin `agy-boss` để Kế hoạch 4), `tools/agy/README.md` (cách dùng), `tools/agy/skills/agy-orchestrator/SKILL.md` (ví dụ dùng tên ghế, bỏ đoạn team rule/boss-only nếu có)

**Interfaces:**
- Consumes: định dạng `team.json` (Task 2); `POST /api/workers/ask {worker, prompt, max, mode?, role?, effort?, model?, cwd?, lean?}` (Task 5).
- Produces (CLI): `worker-ask <seat> "<prompt>" [--mode plan|accept-edits|auto|default] [--effort …] [--model M] [--lean] [--role NAME] [--cwd DIR] [--max N] [--timeout SEC]`; `worker-ask team` in `folder`, `boss`, từng ghế. `agy-ask`/`claude-ask` chỉ là tên khác của cùng file; loại agent lấy từ ghế. Mã thoát: 0 xong; 1 lỗi/timeout/ghế lạ/không có folder; 2 office trả 403; 3 BUSY; 4 bị huỷ.
- Hành vi:
  - `TEAM = f"{os.environ.get('HABBLAUD_DATA_DIR') or HOME + '/.habblaud'}/team.json"`; không có file hoặc JSON hỏng → `die("no team file {TEAM}: start the office once or write it")`. Ghế lạ → `die(f"no seat {name} (seats: W1, W2, …)")`.
  - `cwd` = `--cwd` nếu có, else `folder` của team; folder rỗng/không phải thư mục và không có `--cwd` → `die('the office has no folder yet: set "folder" in …/team.json')`. Gửi `cwd` lên office chỉ khi có `--cwd` (server tự dùng folder).
  - Headless: env thêm `BANG_SLOT=<seat>`, `BANG_OFFICE=<folder>`, chạy trong `cwd`; agy gọi `os.path.join(os.path.dirname(os.path.realpath(__file__)), "agy-as")` (bản của repo), giữ việc bỏ `BOSS_VARS` khỏi env; Claude: account `default` → bỏ `CLAUDE_CONFIG_DIR`, `x` → `~/.claude-x` (thư mục không có → die như cũ).
  - Claude chạy đủ mặc định; `--lean` mới thêm `--strict-mcp-config --disable-slash-commands --append-system-prompt <WORKER_RULE> [--tools LEAN_TOOLS]` (headless) hoặc `"lean": true` (office). `--full` bị bỏ.
  - `defaults.json` chỉ áp cho ghế agy, theo `account`.
  - Xoá: `worker_id`, `parent`, `env_of`, `caller`, `team` cũ, `norm_worker`, `boss_of`, `workers_of`, `boss_worker`, `is_boss`, `office_of_caller`, `same_account`, `office_label`, `check_team`, `print_team` cũ, `by`/`callerPid`/`office` trong body, `claude_pid`/`office` trong dòng log. Giữ `rules` → exit 1.

- [ ] **Step 1: Test (thất bại)**

Lớp `Seats` dùng lại `Office` giả, ghi `team.json` vào `HABBLAUD_DATA_DIR` tạm: `{"folder": <tmp>/proj, "boss": {"kind":"claude","account":"default"}, "workers": [W1 agy acc1, W2 agy acc1, C1 claude worker]}`. Trong thư mục `bin` tạm, cạnh bản sao `worker-ask`, đặt `agy-as` giả và `claude` giả (trên PATH) in `{"cwd": os.getcwd(), "args": sys.argv[1:], "slot": BANG_SLOT, "office": BANG_OFFICE, "conf": CLAUDE_CONFIG_DIR}` thành kết quả (`agy-as`: dòng `{"event":"init","conversation_id":"c1"}` rồi `{"event":"result","result":{"status":"SUCCESS","response": <json đó>}}`; `claude -p`: `{"subtype":"success","result": <json đó>}`).
```python
def test_seat_job_goes_to_the_office_by_name(self):
    code, out, err = self.ask(["W2", "ping"])
    self.assertEqual((code, out.strip()), (0, "pong"), err)
    body = Office.bodies[-1]
    self.assertEqual(body["worker"], "W2")
    for k in ("by", "callerPid", "office", "cwd", "lean"):
        self.assertNotIn(k, body)
def test_any_caller_may_give_jobs(self):            # started under a fake `claude` ancestor: no team rule
    code, _, err = self.ask(["W1", "ping"], via="claude")
    self.assertEqual(code, 0, err)
def test_unknown_seat_lists_the_seats(self):
    code, _, err = self.ask(["acc1", "ping"])
    self.assertEqual(code, 1)
    self.assertIn("no seat acc1 (seats: W1, W2, C1)", err)
def test_headless_agy_runs_in_the_folder_with_the_seat_env(self):
    code, out, err = self.ask(["W2", "ping", "--mode", "plan"], office=False)
    r = json.loads(out)
    self.assertEqual((code, r["cwd"], r["slot"], r["office"], r["args"][0]), (0, self.folder, "W2", self.folder, "acc1"), err)
def test_headless_claude_full_by_default_lean_on_request(self):
    r = json.loads(self.ask(["C1", "ping", "--max", "500"], office=False)[1])
    self.assertEqual((r["conf"], r["slot"], r["cwd"]), (os.path.join(self.home, ".claude-worker"), "C1", self.folder))
    self.assertNotIn("--strict-mcp-config", r["args"])
    r = json.loads(self.ask(["C1", "ping", "--max", "500", "--lean"], office=False)[1])
    self.assertIn("--strict-mcp-config", r["args"])
    self.assertIn("under 500 characters", r["args"][r["args"].index("--append-system-prompt") + 1])
def test_office_job_is_lean_only_with_the_flag_and_sends_cwd_only_when_given(self):
    self.ask(["C1", "ping", "--lean", "--cwd", self.tmp])
    self.assertEqual((Office.bodies[-1]["lean"], Office.bodies[-1]["cwd"]), (True, self.tmp))
def test_no_folder_no_cwd_fails_before_any_job(self):
    # team.json with "folder": "" -> exit 1, "has no folder" in stderr, Office.bodies == []
def test_team_prints_folder_boss_and_seats(self):
    # out contains "folder: <proj>", "boss: claude (default)", "W1  agy  acc1", "C1  claude  worker"
def test_rules_subcommand_is_gone(self):          # unchanged
```
(`self.ask(args, via=None, office=True)`: `office=False` đặt `HABBLAUD_URL=http://127.0.0.1:9`, `HOME=self.home` có `.claude-worker/`, và `PATH=<bin tạm>:$PATH` để `claude` giả được tìm thấy; `agy-as` giả nằm cạnh bản sao `worker-ask` nên được gọi theo đường dẫn.)
Run: `cd tools/agy && python3 -m pytest -q tests` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; cập nhật docstring đầu file (dòng 1–37) cho đúng hành vi mới.

- [ ] **Step 3: Kiểm**

Run: `cd tools/agy && python3 -m pytest -q tests && python3 -m py_compile bin/worker-ask && grep -c "/proc" bin/worker-ask`
Expected: pytest xanh; grep in `0`.
Run: `npm run typecheck && npx vitest run && npm run i18n:check` → xanh.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(seats): worker-ask takes a seat name, anyone may give jobs, Claude seats run full unless --lean"
```

---

### Task 8: Lọc phiên quan sát của claude-mem

**Files:**
- Modify: `server/sources/watcher.ts` (`WatcherOptions` :48–61, `poll` :281–283), `server/sources/watcher.test.ts` (`setup()` truyền `home: tmp.dir`; một `it` mới), `server/index.ts:72` (truyền `home: config.home`)

**Interfaces:**
- Produces: `export function isObserverSession(cwd: string, home: string): boolean` (đúng khi `cwd` nằm dưới `<home>/.claude-mem/observer-sessions/`); `WatcherOptions.home?: string`; `poll` bỏ qua entry như vậy trước `ignore`.

- [ ] **Step 1: Test (thất bại)** — `it` mới, không sửa hai test flaky:
```ts
it('claude-mem observer sessions are not shown', () => {
  const ctx = setup();
  ctx.openSession(301, 'obs', { cwd: join(ctx.tmp.dir, '.claude-mem', 'observer-sessions', '31') });
  ctx.openSession(302, 'real');
  ctx.poll();
  expect(ctx.office.list().map((a) => a.sessionId)).toEqual(['real']);
  expect(isObserverSession('/h/.claude-mem/observer-sessions/32', '/h')).toBe(true);
  expect(isObserverSession('/h/.claude-mem', '/h')).toBe(false);
});
```
Run: `npx vitest run server/sources/watcher.test.ts -t "observer"` → FAIL.

- [ ] **Step 2: Cài.** Một hàm thuần + một dòng `continue` trong `poll`.

- [ ] **Step 3: Kiểm**

Run: `npx vitest run server/sources/watcher.test.ts -t "observer" && npm run typecheck && npx vitest run && npm run i18n:check` → xanh (trừ flaky).
Run (dữ liệu thật, chỉ đọc): `grep -l "observer-sessions" ~/.claude/sessions/*.json 2>/dev/null | wc -l`
Expected: một số ≥0; ghi số đó vào thông điệp commit để Task 10 so.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(office): hide claude-mem observer sessions"
```

---

### Task 9: CHANGELOG và tài liệu

**Files:**
- Modify: `CHANGELOG.md` (mục `## [Unreleased]`), `README.md` (phần team/office/worker), `server/README.md` (bảng API: `/api/team`), `CLAUDE.md` và `AGENTS.md` (câu "a single office with a boss and seats" giờ đúng; thêm một câu: seats live in `~/.habblaud/team.json`), `tools/agy/README.md` nếu Task 7 chưa sửa hết

- [ ] **Step 1: CHANGELOG**

`### Removed` thêm: nhiều office (tab, menu, tạo/xoá/đổi tên office, dialog ＋ Boss/＋ Worker); team rule (chỉ boss được giao việc, dò tiến trình gọi); `names.conf`; terminal agy thủ công không ai gọi. `### Added`: seats (`~/.habblaud/team.json`: `folder`, `boss`, `workers[]`; sửa file là thêm/bớt ghế); nút mở boss; ẩn phiên quan sát claude-mem; `BANG_SLOT`/`BANG_OFFICE` cho mọi tiến trình worker. `### Changed`: một việc mỗi ghế (không còn mỗi tài khoản), ghế cùng tài khoản agy khởi động lần lượt; mọi terminal và việc chạy trong `folder`; `worker-ask <seat>`; ghế Claude chạy đủ, `--lean` để chạy nhẹ; nhập một lần từ `~/.agy_profiles/team.json`, không ghi lại file đó; server chạy `agy-as` của repo. Xoá các gạch đầu dòng "Added" mô tả tính năng đã bỏ (M9: office folders never overlap, office tab menu, herdr `blocked`, "uploaded to Habblaud World", job board "click it to open enlarged", "the agy plugins"; tìm bằng `grep -n -i "office tab\|overlap\|herdr\|World\|enlarged\|agy plugins" CHANGELOG.md` trong mục Unreleased).

- [ ] **Step 2: README** — một mục "Seats" ngắn với ví dụ `team.json` của spec §6 (đường dẫn `~/.habblaud/team.json`), cách mở boss, `worker-ask W1 "…"`; xoá chữ về office tabs, ＋ Worker, team rule.

- [ ] **Step 3: Kiểm** — `npm run typecheck && npx vitest run && npm run i18n:check` xanh (test CHANGELOG nếu có).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: seats, the boss button and worker-ask after plan 2"
```

---

### Task 10: Nghiệm thu (spec §17 bước 1–3 và 8)

**Files:**
- Create (ngoài repo): `~/bang-test-office/` (dự án thử), `~/.bang-test-data/` (data dir của server thử: `team.json`, `office.log`, `pid`), worktree `~/bang-ver-accept/`
- Modify: cuối file kế hoạch này, mục `## Kết quả`

Server thử chạy từ worktree trên cổng 4749 với data dir riêng, nên `~/.habblaud/` (của server 4747) không bị đụng. Hai server vẫn dùng chung `~/.agy_profiles/agy-ask.log.jsonl` và cùng thấy tiến trình agy/claude của nhau: server 4747 có thể hiện acc1 "đang làm" trong lúc thử; đó là hiển thị, không phải lỗi.

- [ ] **Step 1: Hỏi người dùng (một lần, không chặn các bước agy)**

Gửi người dùng đúng hai lệnh, chạy trong terminal của họ, rồi tiếp tục Step 2–7 trong lúc chờ:
```bash
mkdir -p ~/bang-test-office && cd ~/bang-test-office && claude          # trả lời "Yes" ở câu hỏi tin cậy thư mục, rồi /exit (cho boss)
cd ~/bang-test-office && CLAUDE_CONFIG_DIR=~/.claude-worker claude     # đăng nhập cùng tài khoản, trả lời "Yes" tin cậy, rồi /exit (cho C1, C2)
```
Phần boss được đội vương miện (Step 5) và Step 8 chỉ chạy sau khi người dùng báo xong; nếu chưa, ghi "chờ người dùng" vào Kết quả.

- [ ] **Step 2: Worktree và build**

```bash
cd /home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver
git worktree add ~/bang-ver-accept HEAD
cd ~/bang-ver-accept && ln -s /home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver/node_modules node_modules && npm run build
```
Expected: `dist/server/index.js` và `dist/client/` trong `~/bang-ver-accept`. Nếu build lỗi vì link `node_modules`: `rm node_modules && npm ci --prefer-offline` rồi build lại.

- [ ] **Step 3: Dự án thử và team.json**

```bash
mkdir -p ~/bang-test-office ~/.bang-test-data
printf '# bang-test-office\n' > ~/bang-test-office/README.md
cat > ~/.bang-test-data/team.json <<EOF
{
  "folder": "$HOME/bang-test-office",
  "boss": { "kind": "claude", "account": "default" },
  "workers": [
    { "name": "W1", "kind": "agy", "account": "acc1" },
    { "name": "W2", "kind": "agy", "account": "acc1" },
    { "name": "C1", "kind": "claude", "account": "worker" },
    { "name": "C2", "kind": "claude", "account": "worker" }
  ]
}
EOF
```

- [ ] **Step 4: Chạy server thử, kiểm bước 1 (nhân vật, phòng)**

```bash
cd ~/bang-ver-accept
export HABBLAUD_PORT=4749 HABBLAUD_DATA_DIR=$HOME/.bang-test-data HABBLAUD_URL=http://127.0.0.1:4749 PATH=$HOME/bang-ver-accept/tools/agy/bin:$PATH
HABBLAUD_PTY=1 setsid nohup node dist/server/index.js > ~/.bang-test-data/office.log 2>&1 < /dev/null &
echo $! > ~/.bang-test-data/pid; sleep 8
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4749/
curl -s http://127.0.0.1:4749/api/snapshot | python3 -c "
import json,sys,os; s=json.load(sys.stdin); f=os.path.expanduser('~/bang-test-office')
room={r['id']:r['path'] for r in s['rooms']}
for a in s['agents']: print(a['id'], a['name'], room.get(a['roomId']), a['status'])
print('observer rooms:', [p for p in room.values() if '/observer-sessions/' in p])
print('team:', s['team']['offices'][0]['folder'], s['team']['workers'])"
```
Ghi RSS lúc chưa có việc nào (cổng chặn phản mục tiêu, so được với ≈106 MB của Kế hoạch 1): `sleep 60; ps -o rss= -p $(cat ~/.bang-test-data/pid)`.
Expected: HTTP 200; log không có stack trace; bốn nhân vật tên `W1`, `W2`, `C1`, `C2` với phòng `~/bang-test-office`; các phiên Claude khác của máy (ví dụ phiên đang chạy kế hoạch này) ở phòng khác; `observer rooms: []`; team folder đúng. Không dùng `pkill -f dist/server/index.js` ở bất kỳ bước nào (khớp cả server 4747); chỉ dùng pid trong `~/.bang-test-data/pid`.

- [ ] **Step 5: Mở boss**

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"openBoss":true}' http://127.0.0.1:4749/api/team
```
Expected: `{"ok":true,"pty":{…,"cwd":"/home/nhatbang/bang-test-office",…}}`; `readlink /proc/<pty.pid>/cwd` = thư mục đó; snapshot có `team.offices[0].pendingBoss`. Sau khi người dùng đã tin cậy thư mục (Step 1): trong ≤20 giây nhân vật boss có `boss: true` trong phòng `~/bang-test-office`. Gọi lại lệnh trên trả cùng `pty.id` (không mở boss thứ hai).

- [ ] **Step 6: Ảnh chụp**

Lệnh ảnh của Task 16 Kế hoạch 1 với `http://127.0.0.1:4749/` và đường ảnh `docs/superpowers/plans/plan2-office.png` (ghi vào repo chính, không phải worktree).
Expected: một office, không có thanh tab office, nhóm Boss có nút ＋ "Mở boss", nhóm Workers có W1 W2 C1 C2; `pageerrors []`.

- [ ] **Step 7: Bước 2 — W1, W2 song song trên acc1; BUSY**

Cùng shell với Step 4 (cần `PATH`, `HABBLAUD_URL`, `HABBLAUD_DATA_DIR` đã export):
```bash
cd ~/bang-test-office; o=~/.bang-test-data
( time worker-ask W1 "Trả lời đúng một dòng: T1-OK" --mode plan --timeout 300 ) > $o/w1.out 2>&1 &
( time worker-ask W2 "Trả lời đúng một dòng: T2-OK" --mode plan --timeout 300 ) > $o/w2.out 2>&1 &
sleep 5; worker-ask W1 "Trả lời đúng một dòng: T3-OK" --timeout 30; echo "exit=$?"
```
Trong lúc chạy: snapshot cho `agy:acc1` và `agy:acc1@W2` cùng `working`; `team.jobs` có hai job (một có thể `queued` vài giây đầu); với pid terminal của mỗi ghế (`snapshot.ptys` theo `agentId`): `tr '\0' '\n' < /proc/<pid>/environ | grep BANG_` ra `BANG_SLOT=W1`/`W2` và `BANG_OFFICE=$HOME/bang-test-office`, `readlink /proc/<pid>/cwd` = folder.
Expected: lệnh T3 in BUSY và `exit=3`; `w1.out` chứa `T1-OK`, `w2.out` chứa `T2-OK` (không tráo); `ls -t ~/.agy_profiles/acc1/.gemini/antigravity-cli/brain | head -2` là hai thư mục mới khác nhau; thời gian thật của hai việc chồng lên nhau (song song). Ghi khoảng từ lúc W1 `working` tới lúc W2 chuyển `queued` → `working` (lấy `startedAt` của job và log server) để chỉnh `START_SETTLE_MS`.

- [ ] **Step 8: Bước 3 — C1, C2 song song (sau khi người dùng đăng nhập `~/.claude-worker`)**

```bash
worker-ask C1 "Trả lời đúng một dòng: C1-OK" --timeout 300 > $o/c1.out 2>&1 & worker-ask C2 "Trả lời đúng một dòng: C2-OK" --timeout 300 > $o/c2.out 2>&1 & wait
```
Expected: `C1-OK`, `C2-OK`; trong lúc chạy terminal boss vẫn sống (`snapshot.ptys` của boss không có `exitedAt`) và `POST /api/pty/<boss pty id>/input {"data":""}` trả 2xx. Chưa đăng nhập: việc thất bại nhanh với "does not trust the folder" hoặc lỗi đăng nhập — ghi "chờ người dùng", không coi là lỗi của kế hoạch.

- [ ] **Step 9: Bước 8 — test, RSS, giới hạn dòng**

```bash
cd /home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver
npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)
sleep 60; ps -o rss= -p $(cat ~/.bang-test-data/pid)
git diff --shortstat 8ddb811..HEAD -- server client shared tools ':!*.test.ts' ':!tools/agy/tests'
```
Expected: xanh (trừ flaky); RSS ở Step 4 (chưa việc nào) ≤ 112640 kB (110 MB) là cổng phản mục tiêu; RSS ở đây (còn bốn terminal ghế mở tới `IDLE_CLOSE_MS` 20 phút) chỉ ghi để tham khảo; số dòng thêm ròng (insertions − deletions) của code không-test ≤ +300 (mong đợi âm). Ghi cả ba con số.

- [ ] **Step 10: Dọn và ghi kết quả**

```bash
kill $(cat ~/.bang-test-data/pid); sleep 2; ss -ltnp | grep -c ':4747 '   # phải còn 1: server của người dùng vẫn chạy
git worktree remove --force ~/bang-ver-accept
```
Giữ `~/bang-test-office` và `~/.bang-test-data` (Kế hoạch 3–5 dùng lại). Ghi vào cuối file này mục `## Kết quả`: số test, hai số RSS, khoảng chờ W2 đo ở Step 7, số dòng, kết quả từng bước 1–3, 8, điều còn chờ người dùng.
```bash
git add docs/superpowers/plans && git commit -m "docs: plan 2 acceptance results"
```

---

## Tự kiểm sau khi viết

Spec §6, từng ý:
- `team.json` dạng phẳng `{folder, boss, workers[]}`, chỗ ở `~/.habblaud/team.json` (builder chọn, controller chốt), nhập một lần từ file cũ: Task 2.
- `account`: agy = profile; claude = `default` hay `~/.claude-<x>` (`CLAUDE_CONFIG_DIR`): Task 2 (`claudeConfigDir`), Task 5 (env), Task 7 (headless).
- Ghế Claude dùng `~/.claude-worker`: dữ liệu nghiệm thu Task 10; đăng nhập là bước hỏi người dùng Task 10 Step 1.
- Một ghế = một nhân vật, một terminal, một việc; khoá theo ghế thay "một việc mỗi tài khoản" (service.ts:11, :250): Task 5.
- Quota theo tài khoản, ghế chung chia quota: không cần code (ghế chung `account`).
- Chạy đua hội thoại agy → cổng khởi động theo tài khoản (`starting`), việc giữ theo ghế; Claude không cần: Task 5.
- Thêm/bớt ghế = sửa file, server theo dõi; không dialog tạo office; xoá seats theo office: Task 2 (reload), Task 4 (UI), Task 6 (AgySource).
- cwd = `folder` cho mọi terminal và việc (terminal agy thủ công ở manager.ts:275 bị xoá vì không ai gọi; việc không `--cwd` ở service.ts:261): Task 3, 5, 6, 7.
- Env `BANG_SLOT`, `BANG_OFFICE` cho PTY và headless: Task 5, Task 7.
- Nút "Mở boss" theo `boss.kind`: Task 3 (server), Task 4 (nút).
- Tên nhân vật = `name` của ghế; xoá `names.conf`: Task 5 (Claude), Task 6 (agy, profiles.ts).
- Mọi phiên Claude vẫn hiện như upstream, lọc phiên quan sát claude-mem: Task 8.
- Boss = terminal từ nút hoặc phiên được "Make boss"/tiếp quản; bỏ team rule và dò `/proc`: Task 2 (boss trong bộ nhớ), Task 7.

Spec §7: cwd/env mới và ghế Claude "đủ" mặc định, `--lean` giữ cờ cũ: Task 5, Task 7 (lean chỉ là xử lý tham số của `worker-ask`; server đã coi `lean` là tuỳ chọn bật).

Spec §16: "Nhiều office" Task 2, 4, 6; "Team rule" Task 5, 7; `names.conf` Task 6; ghi chú builder "team.json phẳng" Task 2, "one agy per profile" và `restart()` Task 5, 6 và Task 2 (index.ts:246 bỏ cùng `appointAgyBoss`); nâng 20k ký tự để Kế hoạch 4.

Spec §17: bước 1 Task 10 Step 4–6; bước 2 Step 7; bước 3 Step 8; bước 8 Step 9.

Bàn giao Kế hoạch 1: I5 visit Task 1; dòng `vi.ts --allow` Task 1; M1, M2, M3, M11 Task 1; M8 Task 7 (fixture viết lại); M9 Task 9; M12 (`source.ts` ngoặc) Task 6; M14 Task 2 (không bao giờ ghi file cũ). Để lại: M4, M5, M6, M10, M13, `install.sh` một-phần-tử (Kế hoạch 3), M7 (Kế hoạch 4), I6 (Kế hoạch 6), ba test flaky (trước khi ký v1).

## Kết quả

Chạy trên worktree `~/bang-ver-accept` (HEAD e83d5ba), server thử cổng 4749, data dir `~/.bang-test-data`.

- **Bước 1 (Step 2–4):** build xong; HTTP 200; log không có stack trace; bốn nhân vật `W1` (`agy:acc1`), `W2` (`agy:acc1@W2`), `C1`, `C2` (`claude-worker:*`) đều ở phòng `~/bang-test-office`; hai phiên Claude khác của máy ở phòng `Agent_4_me`; `observer rooms: []`; team folder đúng. Đạt.
- **Boss (Step 5):** `openBoss` trả `pty.cwd` = `~/bang-test-office`, `readlink /proc/<pid>/cwd` giống; lần gọi thứ hai trả cùng `pty.id`; boss đã đóng lại qua `POST /api/pty/<id>/close` (204). Vương miện (boss `boss: true` sau khi tin cậy thư mục): chờ người dùng.
- **Ảnh chụp (Step 6):** `plan2-office.png`: một office, không có thanh tab, nhóm Boss có nút ＋, nhóm Workers có W1 W2 C1 C2; `pageerrors []`. Đạt.
- **Bước 2 (Step 7):** W1, W2 song song trên acc1. T3 vào W1 đang bận: `exit=3` (BUSY). `w1.out` có `T1-OK`, `w2.out` có `T2-OK`, mỗi việc 12.5 s thật, chồng nhau. Hai hội thoại khác nhau: `eed0b4f9-...` (T1-OK) và `cace978a-...` (T2-OK). Env terminal: `BANG_SLOT=W1/W2`, `BANG_OFFICE=~/bang-test-office`, cwd = folder. Khoảng chờ W2: job W2 `queued` ở giây 2 và `working` ở giây 4 (mẫu 2 giây), tức dưới 4 s, xa trần `START_SETTLE_MS` 30 s; chưa cần chỉnh. Đạt.
- **Bước 3 (Step 8, C1/C2):** chờ người dùng (chưa đăng nhập `~/.claude-worker`, chưa tin cậy thư mục).
- **Bước 8 (Step 9):** typecheck xanh; vitest 79 file, 938 test xanh; i18n 1253/1253; pytest 16 passed. RSS chưa việc nào (Step 4): 108876 kB (≤112640, đạt); RSS sau khi chạy hết việc: 91512 kB (tham khảo). Dòng thêm ròng không-test: +745 −3694 = −2949 (≤ +300, đạt).
- **Dọn:** server 4749 dừng, server 4747 vẫn chạy (1 listener), worktree đã xoá; giữ `~/bang-test-office` và `~/.bang-test-data`.
- **Còn chờ người dùng:** Step 1 (tin cậy thư mục cho boss, đăng nhập `~/.claude-worker`), vương miện boss, C1/C2 song song.
- **Lưu ý:** `echo $!` sau `setsid nohup ... &` lưu pid của `setsid` (đã thoát), không phải server; đã sửa tay file pid bằng pid listener cổng 4749.

Sau review toàn nhánh (`2026-11-04-bang-ver-2-ghe-final-review.md`), commit `4d175d4` sửa: nhân vật và bảng việc đi theo khi sửa `team.json` (đặt `folder`, đổi tên ghế; `Office.relocate`); đổi ghế/tài khoản dưới một việc đang chạy thì việc kết thúc với thông báo nêu `team.json` và terminal cũ đóng; ba dòng CHANGELOG sai; `HABBLAUD_URL` cho mọi tiến trình ghế; `worker-ask` lọc ghế như server; chữ "registered worker"; README chỗ ở `team.json`. vitest 940 (+ test flaky đã biết), pytest 18, i18n 1254/1254.

## Để lại cho kế hoạch sau

- **Chờ người dùng:** tin cậy `~/bang-test-office` cho `~/.claude` và đăng nhập `~/.claude-worker`; sau đó chạy lại Task 10 bước 5 (vương miện boss) và bước 8 (C1/C2 song song).
- **Spike `/advisor` (trước Kế hoạch 4):** boss Claude có đủ chỗ dựa (`team.bossAgentId()` + `ptys.ofAgent`, `ptys.typeTo`, `agents.transcriptPathOf`); cần thêm `WorkerService.jobOf(seat)`; boss agy chưa đọc được transcript (`AgySource.transcriptPathOf` trả undefined); CLI advisor trên ghế agy cần mẹo `real_home()` vì `agy-as` đổi HOME.
- **M2 (làm cùng đường boss agy/advisor):** boss agy và worker cùng tài khoản có thể tráo hội thoại (terminal boss agy không lấy cổng khởi động); sau 30 s settle hai việc có thể nhận cùng một hội thoại (`newDirs` không có tập "đã nhận") — chặn bằng cách chỉ nhận hội thoại có USER_INPUT đầu tiên trùng prompt.
- **Kế hoạch 3:** `bang-init` ghi `folder` qua tmp+rename (là chỗ thứ ba tính đường `team.json` — dùng chung một quy tắc với `server/config.ts` và `worker-ask`); `install.sh` còn link skill vào `~/.claude/skills` (spec §15 bảo gỡ) và phải gỡ 8 link plugin office-rules (người dùng đã duyệt); M4 (code client chết `workerKind`/`sessionOf`, comment `WorkerId`), M7 (đội chỉ có Claude không có bảng việc), M8 (xoá ghế làm việc của nó báo "cancelled by you"), M9 (đổi `boss.kind` để lại terminal boss agy cũ), comment "registered worker" còn ở `service.ts`/`shared/types.ts`, chữ "＋ Worker" không tới được trong `overlay.ts`.
- **Nghiệm thu các kế hoạch sau:** lấy pid server thử bằng `ss -ltnp | grep :4749` (không phải `echo $!` sau `setsid nohup … &`); đo lại RSS lúc rảnh (Kế hoạch 2: 108.876 kB, trần 112.640 kB, chỉ còn 3,3%).
- **Test flaky** (trước khi ký v1): tail rotation; hai test thời gian của watcher; `art.test.ts > floor chunks` quá giờ khi cả bộ chạy trên máy 2 nhân.
