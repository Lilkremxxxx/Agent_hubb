# Bang_ver — Kế hoạch 6/6: cổng remote sau Cloudflare, đăng nhập bằng passkey, runbook go-live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cổng remote 4748 chạy được sau Cloudflare Tunnel cho `hub.finstar.pp.ua` (HTTP thuần trên loopback, cookie `Secure`, kiểm Origin, giới hạn thử theo IP, phiên 7 ngày), đăng nhập bằng passkey (`@simplewebauthn` đóng gói lúc build), mật khẩu bị tắt khi đã có passkey, trang đăng nhập và trang "Bảo mật" theo Ocean Depth, `remote:setup --behind-proxy` ghi `hub.env`, `office.sh` nạp nó; dừng ở runbook go-live và nghiệm thu trên cổng giả loopback. Không bước nào tạo tunnel, bản ghi DNS, dùng `CLF_API_KEY` hay mở gì ra Internet.

**Architecture:** Trước khi xây trên `remote.ts`, gỡ phần Docker/host-helper còn sót và quyền remote `spawn` (bàn giao I6 của Kế hoạch 1). Một biến duy nhất bật chế độ "sau proxy": `HABBLAUD_REMOTE_DOMAIN`; khi có nó, cổng remote nghe HTTP thuần trên loopback bất kể cert trên đĩa, cookie `Secure; SameSite=Lax`, mọi POST phải có `Origin: https://<domain>`, IP lấy từ `CF-Connecting-IP`, và passkey bật với `rpID = <domain>`. Passkey là một module mới `server/remote/passkeys.ts` (kho file JSON + challenge trong RAM + `PasskeyService` bọc bốn hàm của `@simplewebauthn/server`, tiêm được trong test); route `/api/remote/passkeys/*` nằm trong `createRemoteGate`. Hai trang HTML do server dựng (`server/remote/pages.ts`, chữ qua `tr()` phía server, một CSS dùng chung) và một bundle trình duyệt nhỏ `client/src/remote/auth.ts` (esbuild → `/assets/remote/auth.js`, không vào bundle office). Phần mạng (tunnel, DNS, unit systemd) chỉ là file mẫu trong `deploy/` và runbook `docs/deploy.md`.

**Tech Stack:** Node ≥22 + TypeScript + vitest; esbuild (đã có) đóng gói `@simplewebauthn/server` và `@simplewebauthn/browser` (devDependencies mới); sh (`scripts/office.sh`); systemd user unit và cloudflared chỉ ở dạng mẫu.

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-deploy-design.md` (toàn bộ; §3 là lõi, §3.9 mức (a) "chỉ xem" đã chốt, §5 kiểm nghiệm, §6 rủi ro, §7 để lại cho builder). Ngữ cảnh: `docs/superpowers/specs/2026-11-03-bang-ver-design.md` §21 (deploy là spec riêng, phơi terminal cần người dùng duyệt) và §18. Bàn giao: "Để lại cho kế hoạch sau → Kế hoạch 6" của `2026-11-03-bang-ver-1-cat.md` và I1/I4/I6 của `2026-11-03-bang-ver-1-cat-final-review.md`; "Kế hoạch 6 (remote)" của `2026-11-04-bang-ver-3-skills.md`; "Để lại cho Kế hoạch 6" của `2026-11-04-bang-ver-5-advisor.md` (mục 1 ràng buộc).

Phán quyết của người dùng và controller (ràng buộc như spec):
- **CHỈ VIẾT VÀ CODE.** Không bước nào tạo Cloudflare tunnel, bản ghi DNS, đọc hay dùng `CLF_API_KEY`, chạy `cloudflared`, `systemctl`, hay mở gì ra Internet. Task cuối dừng ở runbook go-live (`docs/deploy.md`: lệnh chính xác cho người dùng/controller chạy SAU khi có lệnh "go" rõ ràng) và nghiệm thu cục bộ với một cổng remote giả trên loopback.
- Không bao giờ đọc, in hay commit `Bang_ver/.env`.
- Mức (a) cho v1: xem office, feed, drawer, terminal chỉ đọc (`HABBLAUD_REMOTE_ALLOW=terminal`); luật cấm PTY trên cổng remote giữ nguyên. Passkey bắt buộc khi đã đăng ký; phiên 7 ngày; `@simplewebauthn` đóng gói.
- Rào `/api/advisor` (và `/api/workers/*`, `/api/team`, `/api/pty`) giữ 403 cho cổng remote, có test qua cổng remote (Kế hoạch 5, mục 1).

## Global Constraints

- Không thêm runtime dependency: `package.json` vẫn không có `dependencies`. `@simplewebauthn/server` và `@simplewebauthn/browser` chỉ là `devDependencies`, esbuild đóng gói vào `dist/`. Cài từ npm cần mạng (máy chỉ có `@simplewebauthn/browser@14` trong store pnpm của dự án khác, không có `server`): **bước cài ở Task 4 cần controller duyệt**; bị từ chối thì Task 4–5 chặn, Task 1–3, 6, 7 (trừ phần passkey) vẫn làm được.
- Mọi chữ hiển thị (trang, log server, `remote-setup`) qua `tr('English text')`; bản dịch duy nhất ở `shared/locales/vi.ts`; `npm run i18n:check` 0 thiếu, 0 khoá thừa (khoá chết sau khi gỡ phải xoá).
- Code, comment, tài liệu (`docs/deploy.md`, `deploy/*`, README, CHANGELOG) bằng tiếng Anh. Kế hoạch tiếng Việt. Mỗi thay đổi nhìn thấy được thêm một dòng vào "Unreleased" của `CHANGELOG.md`.
- Sau mỗi task: `npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)` xanh, cộng `sh -n scripts/office.sh` khi task sửa nó. Được phép đỏ chỉ các test flaky đã biết: `server/sources/tail.test.ts > detects replaced file (rotation) even if larger`, `server/sources/watcher.test.ts > tracks transcript appends and registry status`, `server/sources/watcher.test.ts > /clear: same process, new session — same character, reset tasks`, `art.test.ts > floor chunks` khi máy đang tải. Không sửa, không `skip` chúng.
- Mỗi task một commit (Task 7 hai commit); `git add` theo đường dẫn cụ thể, KHÔNG `git add -A` hay `git add .`. Mọi commit kết thúc bằng đúng hai dòng:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKo78y8zx9LkivRuQac
  ```
- Không `npm run build`, `npm run office`, `node scripts/build-server.mjs` trong repo chính: server 4747 của người dùng chạy từ `dist/` của repo này. Không dừng, không khởi động lại nó. Build và chạy thử chỉ trong worktree `~/bang-ver-accept6` (Task 4, Task 7), cổng chính 4749, cổng remote giả 4758, cổng phụ 4759. Không bao giờ nghe trên 4748 (để dành cho go-live). Không `pkill -f`; pid lấy bằng `ss`.
- Không đụng `~/.claude*`, `~/.local/bin`, `~/.agy_profiles`, `~/.habblaud`, `~/.cloudflared`, `~/.config/systemd`, `~/.config/finstar-console`, `~/.config/bang-hub`. Dữ liệu thử chỉ dưới `~/.bang-test-data/plan6/` (`HABBLAUD_DATA_DIR`).
- Phản mục tiêu: không gỡ luật cấm PTY trên cổng remote (`server/http/app.ts` `pty: !!deps.pty && !remote`, `server/http/pty.ts`, `client/src/ui/drawer.ts`); không tự viết CBOR/COSE/attestation; không đăng ký tài khoản mới; không dùng chung gì với FinSTAR Console; không tải font hay script từ bên thứ ba.
- Số dòng: thêm ròng ≤ +600 dòng không-test (`server client shared scripts`, trừ `*.test.ts`; ước tính: Task 1 ≈ −180, Task 2 ≈ +90, Task 3 ≈ +80, Task 4 ≈ +170, Task 5 ≈ +260 gồm CSS, Task 6 ≈ +60, `vi.ts` ≈ +70 → ≈ +550). Vượt → báo controller, không cắt test.
- Ngoài phạm vi: mức (b) (gõ từ web, ping SSE cho PTY); Cloudflare Access/WAF; nhiều người dùng; TOTP; cắt chế độ LAN/mDNS/TLS tự ký (câu hỏi 4); mọi bàn giao Kế hoạch 5 mục 2–12 (ghi ở "Bàn giao đã nhận"); test flaky.

## Quyết định của người viết kế hoạch (controller xem lại)

1. **`hub.env` và `passkeys.json` theo `HABBLAUD_DATA_DIR`** (mặc định `~/.habblaud`): `<dataDir>/hub.env`, `<dataDir>/remote/passkeys.json`. Lệch spec §3.2/§3.5 ("`~/.habblaud/...`") chỉ ở chỗ thư mục đổi được; nhờ vậy nghiệm thu ghi vào `~/.bang-test-data/plan6/` mà không đụng `~/.habblaud`. Unit systemd vẫn dùng `%h/.habblaud/hub.env`.
2. **Chế độ sau proxy = có `HABBLAUD_REMOTE_DOMAIN`.** Không thêm `HABBLAUD_REMOTE_TLS`. Có domain: `tls` luôn `undefined` (cert cũ trên đĩa bị bỏ qua → không có vòng 308, rủi ro §6), không cần `HABBLAUD_REMOTE_INSECURE_HTTP`, `host` mặc định `127.0.0.1`; `HABBLAUD_REMOTE_HOST` không phải loopback hoặc domain sai dạng → remote tắt kèm cảnh báo. Không có domain: hành vi LAN cũ giữ nguyên, không passkey. Chế độ LAN của `remote-setup` thôi ghi `HABBLAUD_REMOTE_DOMAIN` (trước đây nó ghi, server không đọc).
3. **Route:** `/api/remote/passkeys/*` (không phải `/remote/passkeys/*` như gợi ý §7): nằm dưới `/api/` nên guard đòi `Content-Type: application/json` cho POST và nhánh "chưa đăng nhập → 401 JSON" có sẵn. Trang: `/login` (sẵn có) và `/remote/security`. Không có route đổi tên (đặt tên khi đăng ký là đủ cho "đặt tên" của §3.6).
4. **Giới hạn thử:** thêm `FailureWindow` theo IP (5 lần sai trong 10 phút → 429), áp cho đăng nhập mật khẩu và passkey; GIỮ `LoginThrottle` toàn cục (tuần tự hoá scrypt, chặn dò mật khẩu từ nhiều IP). IP = `CF-Connecting-IP` chỉ khi sau proxy (cổng chỉ nghe loopback nên chỉ cloudflared hay người trên máy đặt được header), không thì `socket.remoteAddress`.
5. **Origin:** sau proxy, mọi request không phải GET/HEAD/OPTIONS trên cổng remote (kể cả `/api/remote/login`, logout) phải có `Origin` đúng bằng `https://<domain>`; thiếu hoặc khác → 403. Kiểm ở đầu `createRemoteGate`, sau guard.
6. **Cookie và phiên:** `SameSite=Lax` (spec §3.7; trước là `Strict`), `Secure` khi `tls` hoặc domain, `SESSION_MS` = 7 ngày. Cookie 30 ngày đã phát không bị thu hồi (máy này chưa bật remote nên chưa có cookie nào; không đổi định dạng token).
7. **Chính sách mật khẩu:** `passkeys.count() > 0` và không `HABBLAUD_REMOTE_PASSWORD_LOGIN=1` → `POST /api/remote/login` trả 403 "Password sign-in is off…" TRƯỚC khi chạy scrypt (không lộ mật khẩu đúng hay sai, không tính là lần sai); trang `/login` ẩn form mật khẩu. `passkeys.json` hỏng hoặc không đọc được → coi là rỗng + `log.warn` (đúng ngữ nghĩa lối thoát "xoá file"; ghi đè chỉ khi đăng ký passkey mới).
8. **Quyền remote `spawn` bỏ** (`RemoteFeature = 'terminal'`; `parseAllow` lặng lẽ bỏ `spawn` như mọi tên lạ). `POST /api/spawn` local giữ, chỉ còn chế độ mở trực tiếp (hết hàng đợi helper). `AccessInfo.spawn` giữ (luôn `false` trên cổng remote).
9. **Trang:** HTML do server dựng (`tr()` phía server, như `loginPage` hiện tại), CSS là một hằng dùng chung nhúng `<style>`, chữ cho JS đi trong `<script type="application/json" id="auth-t">`; JS là MỘT file `/assets/remote/auth.js` (esbuild, đường cố định, công khai trước đăng nhập qua `PUBLIC_STATIC`). Font: `Inter, system-ui, …` và `'JetBrains Mono', ui-monospace, …` không tải (dùng nếu máy có). Logo `UI_UX/logo_finstar.png` chép nguyên (711 KB) thành `client/public/assets/brand/finstar.png` (regex công khai sẵn có khớp). Link trong settings hiện mọi khi `access().remote`; ở chế độ LAN `/remote/security` trả 404 (chấp nhận, comment shortcut).
10. **esbuild:** bỏ `packages: 'external'`, `external: ['vite', 'node-pty', '@xterm/headless', '@xterm/addon-serialize']` (spec §6 chỉ nêu `vite`, nhưng ba gói kia là `import()` động của module native/tuỳ chọn ở `server/pty/manager.ts:654`, `server/pty/screen.ts:26-27`), thêm banner `createRequire` cho dependency CJS trong bundle ESM. Build thứ hai: `client/src/remote/auth.ts` → `dist/client/assets/remote/auth.js` (sau `vite build`, vì Vite xoá `dist/client`).
11. **Unit systemd (mẫu):** `ExecStart` dùng đường node tuyệt đối `%h/.nvm/versions/node/v25.7.0/bin/node` (`/usr/bin/env node` của spec §3.10 không thấy node nvm trong unit user); nâng node → sửa unit (runbook nói). Mẫu KHÔNG có `MemoryMax=400M` của spec: giới hạn áp cho cả cgroup, gồm mọi tiến trình PTY con (boss `claude`, ghế agy) → dễ bị OOM-kill (câu hỏi 2).
12. **Không có nghi thức WebAuthn thật trước go-live:** test vitest tiêm hàm verify giả; một test gọi thư viện thật để sinh options (rpID, `userVerification: 'required'`, `residentKey: 'required'`); nghi thức thật (đăng ký, đăng nhập passwordless) là bước nghiệm thu trong runbook sau go-live.

## Review Focus

1. **Cert tự ký cũ còn trong thư mục TLS + `HABBLAUD_REMOTE_DOMAIN`**: cổng vẫn HTTP thuần, không 308. → Task 2 (test parse) + Task 7 Step 2 (cert rác trong `HABBLAUD_REMOTE_TLS_DIR`).
2. **Host lạ, Origin thiếu hoặc khác, `CF-Connecting-IP` đổi liên tục**: guard 403; POST thiếu/sai Origin 403; IP khác không bị chặn bởi IP này nhưng `LoginThrottle` toàn cục vẫn hãm. → Task 2 (hai test) + Task 7 Step 3.
3. **`passkeys.json` hỏng, không ghi được**: server vẫn chạy, danh sách rỗng + cảnh báo; ghi lỗi → đăng ký trả lỗi JSON, không 500, passkey không được coi là đã lưu. → Task 3.
4. **Challenge hết hạn, dùng lại, sai loại, credential lạ, body hỏng, thư viện ném lỗi**: 401/400, không bao giờ 500, challenge dùng một lần. → Task 4.
5. **Gọi dồn `login/options` không cần đăng nhập**: bản đồ challenge bị chặn trần (`MAX_CHALLENGES`), không phình RAM. → Task 3.

---

### Task 1: Gỡ phần Docker/host-helper còn sót, bỏ quyền remote `spawn`, ghim rào qua cổng remote

**Files:**
- Modify: `server/config.ts` (bỏ `inDocker`, `detectDocker`; `terminalOffReason(env, host)`), `server/index.ts` (:73, :144–164, :324, :434, :445–463), `server/http/app.ts` (`inDocker` dep :29, `docker` trong health :281, `isLocalOnlyPath` :104–106/:259, route `/api/host/spawn/*` :404–425, GET `/api/spawn` trả `{ available: true }`), `server/http/remote.ts` (`FEATURES`, `RemoteFeature`, `defaultTlsDir(env)`, `parseRemoteConfig(env, exists?)`, comment đầu file bỏ Docker), `server/sources/watcher.ts` (bỏ option `inDocker`, `checkPid: true`), `server/spawn/spawn.ts` (bỏ chế độ helper: `poll`, `ack`, `PolledSpawn`, `hostSeenAt`, hằng thời gian chờ helper, `mode()`; `SpawnServiceOptions.opener` bắt buộc), `server/spawn/attachments.ts` (comment), `shared/types.ts` (trường `docker` nếu có trong kiểu health), `shared/locales/vi.ts` (xoá khoá chết), `CHANGELOG.md`
- Delete: `.dockerignore`
- Test: `server/http/remote.test.ts`, `server/spawn/spawn.test.ts`, `server/http/http.test.ts`, `server/http/sessions.test.ts`, `server/http/terminal.test.ts`, `server/sources/watcher.test.ts`, `server/sources/github-live.test.ts`

**Interfaces:**
- Produces:
  - `export type RemoteFeature = 'terminal';`
  - `export function defaultTlsDir(env: NodeJS.ProcessEnv): string` → `HABBLAUD_REMOTE_TLS_DIR` hoặc `~/.habblaud/remote-tls/server`.
  - `export function parseRemoteConfig(env: NodeJS.ProcessEnv, exists?: (path: string) => boolean): { config?: RemoteConfig; warning?: string }` (Task 2 mở rộng).
  - `new SpawnService({ opener, cli?, attachments?, now?, newId? })` — `opener` bắt buộc.
- Không còn: `config.inDocker`, `/api/host/*`, chuỗi "host helper"/"Docker" trong `server/`, `client/`, `shared/` (trừ `server/remote/tls.ts` nếu chỉ là comment không liên quan).

- [ ] **Step 1: Test (thất bại)** — trong `server/http/remote.test.ts`: harness `start()` bỏ `inDocker`, dùng `new SpawnService({ opener: async () => {} })`, thêm stub ghi lại lời gọi cho `advisor`, `workers`, `team` (`calls: string[]`; ép kiểu `as never` khi kiểu rộng) để 403 chắc chắn đến từ rào chứ không phải từ "thiếu dep". Sửa hai test parse cho chữ ký mới (`parseRemoteConfig(env, TLS_FILES)`; xoá test "in Docker ignores port and host"). Thêm:
```ts
it('HABBLAUD_REMOTE_ALLOW knows only terminal now', () => {
  expect([...parseAllow('spawn, Terminal, bogus')]).toEqual(['terminal']);
});

it('logged in: advisor, workers, team, pty and spawn never pass over the remote port, even with Host localhost and --allow terminal', async () => {
  const s = await start(['terminal']);
  const headers = { Cookie: await login(s.remoteBase), Host: 'localhost' };
  const blocked: Array<[string, string, unknown?]> = [
    ['POST', '/api/advisor', { slot: 'W2', question: 'x' }],
    ['GET', '/api/advisor/q1'],
    ['GET', '/api/workers/jobs/w1'],
    ['POST', '/api/workers/cancel', { worker: 'W1' }],
    ['POST', '/api/team', { openBoss: true }],
    ['POST', '/api/spawn', { folder: '/p', prompt: 'hi' }],
    ['GET', '/api/pty'],
    ['POST', '/api/pty/x/input', {}],
    ['POST', '/api/agents/a1/stop', {}],
  ];
  for (const [method, path, body] of blocked) {
    expect((await request(s.remoteBase, path, { method, headers, ...(body ? { body } : {}) })).status, `${method} ${path}`).toBe(403);
  }
  expect(s.calls).toEqual([]);
  expect(s.ptyCalls).toEqual([]);
  expect(JSON.parse((await request(s.remoteBase, '/api/access', { headers })).body)).toMatchObject({ remote: true, terminal: true, spawn: false });
  expect((await request(s.localBase, '/api/host/spawn/poll', { method: 'POST', body: {} })).status).toBe(404);
});
```
Xoá test "new agent: only with spawn enabled on phone…" và test Docker của `spawn.test.ts` ("Docker: rejects without helper…", "host: request carries base64 attachments…", phần helper của "SpawnService: direct mode with claude and helper ack…"); test `HABBLAUD_REMOTE_ALLOW=spawn enables spawn…` đổi thành `spawn` bị bỏ qua và trang chỉ xem. `http.test.ts`: health không còn khoá `docker`.
Run: `npx vitest run server/http/remote.test.ts server/spawn/spawn.test.ts` → FAIL (`parseAllow` còn trả `spawn`, chữ ký cũ, route helper còn 200/403).

- [ ] **Step 2: Cài** theo Files/Interfaces. `npm run typecheck` là máy dò chỗ còn `inDocker`. Xoá khoá `vi.ts` chết (vd `"unavailable in Docker (run with npm start)"`, `"the computer's helper isn't running (Habblaud is in Docker)"`, `"published via HABBLAUD_REMOTE_BIND"`, `'   Remote access: "spawn" allowed, but New agent is off (turn it on with HABBLAUD_PTY=1).'`) theo báo cáo của `npm run i18n:check`. CHANGELOG: "Removed: Docker runtime mode, the host helper routes and the remote `spawn` permission."

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung; `grep -rn "inDocker\|/api/host/\|host helper" server client shared scripts` → không còn dòng nào.

- [ ] **Step 4: Commit**
```bash
git add server shared CHANGELOG.md && git rm -q .dockerignore
git commit -m "refactor(remote): drop Docker mode, the host helper and the remote spawn permission; pin the remote 403s for advisor, workers, team and pty"
```

---

### Task 2: Cổng remote sau proxy — `HABBLAUD_REMOTE_DOMAIN`, Origin, cookie `Lax`, phiên 7 ngày, giới hạn theo IP, log đăng nhập

**Files:**
- Modify: `server/http/remote.ts`, `server/index.ts` (gate deps, dòng log khởi động), `shared/locales/vi.ts`, `CHANGELOG.md`
- Test: `server/http/remote.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseRemoteConfig(env, exists?)`).
- Produces (trong `server/http/remote.ts`):
  - `RemoteConfig` thêm `domain?: string` (chữ thường; có = sau proxy) và `passwordLogin: boolean` (`HABBLAUD_REMOTE_PASSWORD_LOGIN` truthy).
  - `parseRemoteConfig`: theo Quyết định 2. Domain kiểm bằng `isValidDomain` (`server/remote/tls.ts:332`); host kiểm bằng `isLoopbackBind` (`server/config.ts:88`). `config.ts:9` đã import `remote.ts`: vòng import này lỗi ở typecheck/vitest → chuyển `isLoopbackBind` sang `server/http/guard.ts` cạnh `isLoopbackHost` và import từ đó ở cả hai file. Cảnh báo: `tr('remote access off: invalid HABBLAUD_REMOTE_DOMAIN "{0}"', [raw])`, `tr('remote access off: behind a proxy (HABBLAUD_REMOTE_DOMAIN) the remote port listens on loopback only; HABBLAUD_REMOTE_HOST={0}', [host])`.
  - `export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;`
  - `export class FailureWindow { constructor(limit = 5, windowMs = 10 * 60_000, now: () => number = Date.now); retryAfter(key: string): number; fail(key: string): void; clear(key: string): void }` — `retryAfter` = 0 khi chưa đủ `limit` lần sai trong cửa sổ, ngược lại số giây tới khi lần sai cũ nhất hết hạn (≥1); tối đa 1000 khoá (đầy → xoá khoá cũ nhất).
  - `export function clientIp(req: IncomingMessage, behindProxy: boolean): string` — sau proxy: `cf-connecting-ip` (chuỗi, trim, ≤64 ký tự) nếu có; không thì `req.socket.remoteAddress ?? '-'`.
  - `RemoteGateDeps` thêm: `domain?: string`, `failures?: FailureWindow`, `log?: { info(m: string): void; warn(m: string): void }`. `secure` do `index.ts` tính `!!remote.tls || !!remote.domain`.
  - `cookieHeader(...)` → `SameSite=Lax`.
  - Đầu gate: `domain` có và method ∉ {GET, HEAD, OPTIONS} và `req.headers.origin !== 'https://' + domain` → `req.resume()`, 403 `{ error: tr('cross-site request refused') }`.
  - `/api/remote/login`: `failures.retryAfter(ip) > 0` → 429 (`Retry-After`) trước `LoginThrottle`; sai → `failures.fail(ip)` + `log.warn(tr('Remote sign-in failed ({0}) from {1}, {2}', ['password', ip, ua]))`; đúng → `failures.clear(ip)` + `log.info(tr('Remote sign-in ok ({0}) from {1}, {2}', ['password', ip, ua]))`; `ua` = user-agent bỏ ký tự điều khiển, ≤80 ký tự, thiếu → `-`.
  - Log khởi động (`index.ts`): sau proxy scheme = `tr('HTTP behind a proxy for {0}', [domain])`.

- [ ] **Step 1: Test (thất bại)** — `remote.test.ts`:
```ts
it('behind a proxy: plain HTTP even with a certificate on disk, loopback by default, refuses a LAN host or a bad domain', () => {
  const env = { ...base, HABBLAUD_REMOTE_DOMAIN: 'Hub.Finstar.pp.ua' };
  const { config } = parseRemoteConfig(env, TLS_FILES);
  expect(config).toMatchObject({ host: '127.0.0.1', port: 4748, domain: 'hub.finstar.pp.ua', passwordLogin: false });
  expect(config?.tls).toBeUndefined();
  expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_HOST: '0.0.0.0' }, TLS_FILES).warning).toMatch(/loopback/);
  expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_HOST: '::1' }, TLS_FILES).config?.host).toBe('::1');
  expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_DOMAIN: 'not a domain' }, TLS_FILES).warning).toMatch(/HABBLAUD_REMOTE_DOMAIN/);
  expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_PASSWORD_LOGIN: '1' }, TLS_FILES).config?.passwordLogin).toBe(true);
  expect(SESSION_MS).toBe(7 * 24 * 60 * 60 * 1000);
});

it('FailureWindow: five failures in ten minutes block that key only, success clears it', () => {
  let now = 0;
  const w = new FailureWindow(5, 600_000, () => now);
  for (let i = 0; i < 5; i++) { expect(w.retryAfter('a')).toBe(0); w.fail('a'); now += 10_000; }
  expect(w.retryAfter('a')).toBe(550);
  expect(w.retryAfter('b')).toBe(0);
  now += 560_000;
  expect(w.retryAfter('a')).toBe(0);
  w.fail('a'); w.clear('a');
  expect(w.retryAfter('a')).toBe(0);
});
```
Một test qua HTTP với gate dựng riêng (như "Secure cookie and CA download"): `createRemoteGate({ config: CFG, sessions, secure: true, domain: 'hub.finstar.pp.ua', failures: new FailureWindow(5, 600_000, () => now), throttle: new LoginThrottle(() => now), log })`, `O = { Origin: 'https://hub.finstar.pp.ua' }`:
```ts
it('behind a proxy: POST needs the exact Origin; five bad passwords from one CF-Connecting-IP give 429 to that IP only; the cookie is Secure, HttpOnly, Lax, 7 days; sign-ins are logged', async () => {
  // POST /api/remote/login without Origin → 403; Origin http://hub.finstar.pp.ua → 403; Origin https://evil.example → 403
  // 5 × wrong password with {...O, 'CF-Connecting-IP': '203.0.113.7'}, now += 10_000 each → 401 each; 6th → 429 with Retry-After
  // correct password from 203.0.113.8 → 200, set-cookie matches /HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/
  // correct password from 203.0.113.7 → still 429
  // log lines: one 'ok (password) from 203.0.113.8', five 'failed (password) from 203.0.113.7'
});
```
Sửa helper `login()` (`SameSite=Strict` → `SameSite=Lax`).
Run: `npx vitest run server/http/remote.test.ts` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; nối `index.ts` (`secure`, `domain`, `log`, `failures: new FailureWindow()`); khoá `vi.ts`; CHANGELOG: "Remote port behind a proxy (`HABBLAUD_REMOTE_DOMAIN`): loopback plain HTTP, Secure Lax cookie, Origin check, 5 failed sign-ins per IP in 10 minutes, 7-day sessions."

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add server/http/remote.ts server/http/remote.test.ts server/index.ts shared/locales/vi.ts CHANGELOG.md
git commit -m "feat(remote): behind-proxy mode with HABBLAUD_REMOTE_DOMAIN, exact Origin, Lax Secure cookie, 7-day sessions, per-IP sign-in limit and sign-in log"
```

---

### Task 3: Kho passkey và challenge (thuần, chưa cần npm)

**Files:**
- Create: `server/remote/passkeys.ts`, `server/remote/passkeys.test.ts`

**Interfaces:**
- Produces (đầu file: comment 3 dòng — passkey của chủ office, file `<dataDir>/remote/passkeys.json` mode 600, challenge chỉ trong RAM; nguồn: deploy spec §3.3–§3.5):
  - `export interface StoredPasskey { id: string; publicKey: string /* base64url */; counter: number; transports?: string[]; name: string; createdAt: number; lastUsedAt?: number }`
  - `export const CHALLENGE_TTL_MS = 120_000; export const MAX_CHALLENGES = 50; export const MAX_PASSKEYS = 20; export const NAME_MAX = 60;`
  - `export class PasskeyStore { constructor(file: string, log?: { warn(m: string): void }); list(): readonly StoredPasskey[]; count(): number; get(id: string): StoredPasskey | undefined; add(p: StoredPasskey): boolean; touch(id: string, counter: number, at: number): void; remove(id: string): boolean }` — đọc file một lần trong constructor (thiếu → rỗng; JSON hỏng/không phải mảng/phần tử thiếu `id`/`publicKey` → rỗng + `log.warn(tr('passkeys.json is unreadable; no passkeys loaded ({0})', [msg]))`); mỗi thay đổi ghi `${file}.tmp` mode 600 rồi `renameSync`, thư mục tạo với mode 700; `add` trả `false` khi đã đủ `MAX_PASSKEYS`, trùng `id`, hoặc ghi lỗi (khi ghi lỗi trạng thái trong RAM quay lại như trước).
  - `export function cleanName(raw: unknown, at: number): string` — chuỗi: bỏ ký tự điều khiển, gộp khoảng trắng, trim, cắt `NAME_MAX`; rỗng hoặc không phải chuỗi → `tr('Passkey {0}', [YYYY-MM-DD của at])`.
  - `export class Challenges { constructor(now: () => number = Date.now); add(kind: 'login' | 'register', challenge: string): void; take(kind: 'login' | 'register', challenge: string): boolean }` — `take` đúng một lần, đúng loại, còn hạn; `add` dọn mục hết hạn, đầy `MAX_CHALLENGES` → bỏ mục cũ nhất.

- [ ] **Step 1: Test (thất bại)** — `passkeys.test.ts` (dùng `tempDir()` của `server/test/fixtures`):
```ts
const pk = (id: string): StoredPasskey => ({ id, publicKey: 'AQID', counter: 0, transports: ['internal'], name: id, createdAt: 1 });

it('store: add, touch and remove persist through a restart with mode 600; duplicates and the cap are refused', () => {
  const s = new PasskeyStore(file);
  expect(s.add(pk('a'))).toBe(true);
  expect(s.add(pk('a'))).toBe(false);
  s.touch('a', 7, 99);
  const again = new PasskeyStore(file);
  expect(again.get('a')).toMatchObject({ counter: 7, lastUsedAt: 99 });
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(again.remove('a')).toBe(true);
  expect(new PasskeyStore(file).count()).toBe(0);
  for (let i = 0; i < MAX_PASSKEYS; i++) again.add(pk(`k${i}`));
  expect(again.add(pk('one-more'))).toBe(false);
});

it('store: a corrupt file loads as empty with a warning; an unwritable folder refuses the add and keeps memory unchanged', () => {
  writeFileSync(file, '{not json');
  const warn: string[] = [];
  expect(new PasskeyStore(file, { warn: (m) => warn.push(m) }).count()).toBe(0);
  expect(warn[0]).toMatch(/passkeys\.json/);
  const blocked = new PasskeyStore(join(fileThatIsADirectoryParent, 'passkeys.json'));
  expect(blocked.add(pk('a'))).toBe(false);
  expect(blocked.count()).toBe(0);
});

it('challenges: once, same kind, within two minutes; the map is capped', () => {
  let now = 0;
  const c = new Challenges(() => now);
  c.add('login', 'x');
  expect(c.take('register', 'x')).toBe(false);
  expect(c.take('login', 'x')).toBe(true);
  expect(c.take('login', 'x')).toBe(false);
  c.add('login', 'y'); now += CHALLENGE_TTL_MS + 1;
  expect(c.take('login', 'y')).toBe(false);
  for (let i = 0; i <= MAX_CHALLENGES; i++) c.add('login', `c${i}`);
  expect(c.take('login', 'c0')).toBe(false);
  expect(c.take('login', `c${MAX_CHALLENGES}`)).toBe(true);
});

it('names: control characters dropped, capped, empty gets a dated default', () => {
  expect(cleanName(' My\u0007  phone\n ', 0)).toBe('My phone');
  expect(cleanName('x'.repeat(100), 0)).toHaveLength(NAME_MAX);
  expect(cleanName('', Date.UTC(2026, 10, 4))).toBe('Passkey 2026-11-04');
});
```
(`fileThatIsADirectoryParent` = đường dẫn tới một FILE thường, nên `mkdir` thư mục con thất bại.)
Run: `npx vitest run server/remote/passkeys.test.ts` → FAIL (module chưa có).

- [ ] **Step 2: Cài** theo Interfaces; khoá `vi.ts`.

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung.

- [ ] **Step 4: Commit**
```bash
git add server/remote/passkeys.ts server/remote/passkeys.test.ts shared/locales/vi.ts
git commit -m "feat(remote): passkey store (600, atomic) and one-time challenges"
```

---

### Task 4: `@simplewebauthn` — cài (controller duyệt), `PasskeyService`, route `/api/remote/passkeys/*`, chính sách mật khẩu, đóng gói esbuild

**Files:**
- Modify: `package.json`, `package-lock.json` (devDependencies), `server/remote/passkeys.ts`, `server/http/remote.ts` (route, chính sách, `/login` nhận cờ), `server/index.ts`, `scripts/build-server.mjs`, `shared/locales/vi.ts`, `CHANGELOG.md`
- Test: `server/remote/passkeys.test.ts`, `server/http/remote.test.ts`

**Interfaces:**
- Consumes: Task 2 (`domain`, `failures`, `log`, `clientIp`, `passwordLogin`), Task 3.
- Produces:
  - `passkeys.ts`:
    - `export type WebAuthnLib = Pick<typeof import('@simplewebauthn/server'), 'generateRegistrationOptions' | 'verifyRegistrationResponse' | 'generateAuthenticationOptions' | 'verifyAuthenticationResponse'>;` mặc định = `import * as webauthn from '@simplewebauthn/server'`.
    - `export interface PasskeyView { id: string; name: string; createdAt: number; lastUsedAt?: number }`
    - `export class PasskeyService { constructor(o: { domain: string; user: string; store: PasskeyStore; lib?: WebAuthnLib; now?: () => number }); count(): number; list(): PasskeyView[]; loginOptions(): Promise<object>; verifyLogin(body: unknown): Promise<boolean>; registerOptions(): Promise<object>; verifyRegister(body: unknown): Promise<{ ok: true; passkey: PasskeyView } | { ok: false; error: string }>; remove(id: string): boolean }`
    - Giá trị cố định: `rpID = domain`, `expectedOrigin = 'https://' + domain`, `rpName: 'Bang_ver hub'`, `userName = user`, `userID = new TextEncoder().encode(user)`, `attestationType: 'none'`, `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`, `excludeCredentials` = các id đã lưu (kèm `transports`), đăng nhập `allowCredentials: []` + `userVerification: 'required'`, `timeout: CHALLENGE_TTL_MS`, `requireUserVerification: true`; challenge của options lưu bằng `Challenges.add`, kiểm bằng `expectedChallenge: (c) => challenges.take(kind, c)`. `verifyLogin`: `body.id` không có trong kho → `false`; thành công → `store.touch(id, newCounter, now())`. `verifyRegister(body)`: body `{ response, name }`; lưu `publicKey` dạng base64url, `name = cleanName(body.name, now())`; `store.add` trả false → `{ ok: false, error: tr("Couldn't save the passkey.") }`. Hai hàm verify bắt mọi lỗi (không bao giờ ném).
  - Route trong `createRemoteGate` khi có `deps.passkeys?: PasskeyService` (chỉ khi `domain`), `RemoteGateDeps.passwordLogin?: boolean`:
    | Route | Đăng nhập? | Trả |
    |---|---|---|
    | `POST /api/remote/passkeys/login/options` | không | 200 options; IP đang bị 429 → 429 |
    | `POST /api/remote/passkeys/login/verify` | không | 200 + Set-Cookie; sai → `failures.fail(ip)`, log, 401 `tr('Passkey not recognized.')`; 429 như mật khẩu |
    | `GET /api/remote/passkeys` | có | `{ passkeys: PasskeyView[] }` |
    | `POST /api/remote/passkeys/register/options` | có | 200 options |
    | `POST /api/remote/passkeys/register/verify` | có | 200 `{ passkey }` / 400 `{ error }` |
    | `POST /api/remote/passkeys/delete` `{ id }` | có | 200 / 404 |
    Không có `deps.passkeys` → mọi `/api/remote/passkeys/*` 404. Body hỏng → 400. Method sai → 405.
  - Chính sách (Quyết định 7) ở đầu `/api/remote/login`: `deps.passkeys?.count()` > 0 và `!deps.passwordLogin` → 403 `{ error: tr('Password sign-in is off while a passkey is registered: use your passkey.') }`.
  - `index.ts`: khi `remote.domain`: `new PasskeyService({ domain, user: remote.user, store: new PasskeyStore(join(config.dataDir, 'remote', 'passkeys.json'), log) })`; log khởi động thêm `tr('   Remote access: {0} passkey(s); password sign-in {1}.', [n, on|off])`.
  - `scripts/build-server.mjs`: Quyết định 10 (`external` bốn gói, banner `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`, bỏ `packages: 'external'`).

- [ ] **Step 1: Cài gói (CONTROLLER DUYỆT, cần mạng)**
```bash
npm install --save-dev --ignore-scripts @simplewebauthn/server@latest @simplewebauthn/browser@latest
npm ls @simplewebauthn/server @simplewebauthn/browser
node -e "import('node-pty').then(() => console.log('pty ok'))"
git diff --stat package.json
```
Expected: hai gói cùng major; `pty ok` (`--ignore-scripts` để không build lại module native); `package.json` chỉ đổi `devDependencies`, không có khoá `dependencies`. Tên API trong `.d.ts` đã cài khác Interfaces (bản 13: `registrationInfo.credential { id, publicKey, counter, transports }`, `verifyAuthenticationResponse({ credential })` → `authenticationInfo.newCounter`, `expectedChallenge` nhận hàm) → sửa chỉ trong `PasskeyService`, ghi vào `## Kết quả`. Controller từ chối → dừng Task 4–5, báo.

- [ ] **Step 2: Test (thất bại)** — `passkeys.test.ts` (lib giả cho verify, lib thật cho options):
```ts
const DOMAIN = 'hub.finstar.pp.ua';
const fakeLib = (challenge: () => string, ok = true): WebAuthnLib => ({
  ...webauthn,
  verifyRegistrationResponse: (async (o: any) => {
    if (!(await o.expectedChallenge(challenge()))) throw new Error('challenge');
    expect(o).toMatchObject({ expectedOrigin: `https://${DOMAIN}`, expectedRPID: DOMAIN, requireUserVerification: true });
    return { verified: ok, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } };
  }) as never,
  verifyAuthenticationResponse: (async (o: any) => {
    if (!(await o.expectedChallenge(challenge()))) throw new Error('challenge');
    expect(o.credential).toMatchObject({ id: 'cred-1', counter: 0 });
    return { verified: ok, authenticationInfo: { newCounter: 7 } };
  }) as never,
});

it('options from the real library: rpID, user verification required, discoverable, nothing allowed by id', async () => {
  const s = new PasskeyService({ domain: DOMAIN, user: 'bang', store });
  const reg = (await s.registerOptions()) as any;
  expect(reg.rp.id).toBe(DOMAIN);
  expect(reg.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
  const login = (await s.loginOptions()) as any;
  expect(login).toMatchObject({ rpId: DOMAIN, userVerification: 'required' });
  expect(login.allowCredentials ?? []).toEqual([]);
});

it('register then sign in: named, counter advances, lastUsedAt set, each challenge works once', async () => { /* registerOptions → verifyRegister({ response: { id: 'cred-1' }, name: ' Phone ' }) → { ok: true, passkey: { name: 'Phone' } }; same challenge again → { ok: false }; loginOptions → verifyLogin({ id: 'cred-1' }) → true; store.get('cred-1') counter 7, lastUsedAt set; replay → false; registerOptions().excludeCredentials ids = ['cred-1'] */ });

it('unknown credential, expired or wrong-kind challenge, malformed body, verified=false or a throwing library: false or an error, never a throw', async () => { /* verifyLogin({ id: 'nope' }) false; verifyLogin(null) false; login challenge used for register → { ok: false }; now += CHALLENGE_TTL_MS + 1 → false; fakeLib(…, false) → false; lib that throws → false */ });
```
`remote.test.ts` (gate có `domain`, `passkeys: new PasskeyService({ … lib: fakeLib(…) })`, header Origin đúng):
```ts
it('passkeys: options are public, registration needs a session, verify signs in with the 7-day cookie', async () => { /* login/options 200 without cookie; GET /api/remote/passkeys without cookie 401; register/options without cookie 401; with password cookie: register → 200 { passkey }; list has 1; login/verify → 200, set-cookie Lax Secure; delete { id: 'nope' } 404 */ });
it('a registered passkey turns password sign-in off (403, scrypt not run) unless HABBLAUD_REMOTE_PASSWORD_LOGIN=1; /login hides the password form', async () => { /* verify spy counts 0 calls on the 403 */ });
it('failed passkey sign-ins count toward the per-IP limit; without a domain every passkey route is 404', async () => { /* 5 × verify false from one CF IP → 6th 429 */ });
```
Run: `npx vitest run server/remote/passkeys.test.ts server/http/remote.test.ts` → FAIL.

- [ ] **Step 3: Cài** theo Interfaces; khoá `vi.ts`; CHANGELOG: "Passkey sign-in on the remote port (WebAuthn via @simplewebauthn, bundled at build time); password sign-in turns off once a passkey exists unless HABBLAUD_REMOTE_PASSWORD_LOGIN=1."

- [ ] **Step 4: Kiểm** — test xanh; kiểm chung.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json server/remote/passkeys.ts server/remote/passkeys.test.ts server/http/remote.ts server/http/remote.test.ts server/index.ts scripts/build-server.mjs shared/locales/vi.ts CHANGELOG.md
git commit -m "feat(remote): passkey routes with @simplewebauthn, password sign-in off once a passkey exists, server bundle includes its dependencies"
```

- [ ] **Step 6: Kiểm bundle trong worktree** (không đụng `dist/` của repo chính)
```bash
B=/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver; W=~/bang-ver-accept6; D=~/.bang-test-data/plan6/build
cd $B && git worktree add $W HEAD && cd $W && ln -s $B/node_modules node_modules && npm run build
grep -c 'node_modules/@simplewebauthn/server' dist/server/index.js; grep -c 'from "@simplewebauthn' dist/server/index.js; ls -l dist/server/index.js
mkdir -p $D && HABBLAUD_DATA_DIR=$D HABBLAUD_PORT=4759 HABBLAUD_PTY=1 timeout 12 node dist/server/index.js > $D/start.log 2>&1; grep -c '🏢' $D/start.log; grep -ci 'dynamic require\|cannot find module\|ERR_' $D/start.log; grep -i 'terminal' $D/start.log | head -2
cd $B && git worktree remove --force $W; ss -Hltn 'sport = :4747' | wc -l
```
Expected: ≥1; `0`; kích thước ghi lại (spec ước +1 MB); `1`; `0`; dòng Terminal "on" (node-pty vẫn nạp từ `node_modules` qua `external`); `1`. Lỗi `Dynamic require` hay `Cannot find module` → sửa `build-server.mjs`, commit riêng `fix(build): …`, chạy lại bước này.

---

### Task 5: Trang đăng nhập và "Bảo mật" (Ocean Depth), bundle trình duyệt, link trong settings

**Files:**
- Create: `server/remote/pages.ts`, `server/remote/pages.test.ts`, `client/src/remote/auth.ts`, `client/src/remote/auth.test.ts`, `client/public/assets/brand/finstar.png` (chép từ `/home/nhatbang/FPT_Capstone/UI_UX/logo_finstar.png`)
- Modify: `server/http/remote.ts` (`loginPage` chuyển sang `pages.ts`; `/remote/security`; `PUBLIC_STATIC`), `scripts/build-server.mjs` (build thứ hai), `client/src/ui/settings.ts` (một dòng trong nhóm remote), `shared/locales/vi.ts`, `CHANGELOG.md`
- Test: `server/http/remote.test.ts` (một test)

**Interfaces:**
- Consumes: Task 4 (route và cờ), `getLocale`, `tr`.
- Produces:
  - `pages.ts`:
    - `export function jsonBlock(texts: Record<string, string>): string` → `<script type="application/json" id="auth-t">…</script>` với `<` thành `<`.
    - `export function loginPage(o: { caDownload: boolean; passkeys: boolean; password: boolean }): string` — logo `/assets/brand/finstar.png`, tiêu đề `tr('Bang_ver hub')`, nút chính `tr('Sign in with a passkey')` (chỉ khi `passkeys`), form user + mật khẩu (chỉ khi `password`), vùng lỗi `role="alert"`, link CA như cũ, `<body data-page="login">`.
    - `export function securityPage(): string` — `<body data-page="security">`: danh sách passkey (rỗng: `tr('No passkeys yet.')`), ô tên + nút `tr('Add a passkey')`, nút xoá từng dòng, ghi chú `tr('Lost your only passkey? At the computer: npm run remote:setup -- --reset-passkeys, then restart the office.')`, link `tr('Back to the office')` → `/`.
    - Cả hai: `<meta name="viewport" …>`, CSS dùng chung (token Ocean Depth nguyên văn spec §3.6: nền `#04101f`, chữ `rgb(226 240 250)`, chữ phụ `rgb(140 170 192)`, nút chính `linear-gradient(135deg, #3ec7d3, #6a8cff)` chữ `#04101f`, card `background: rgb(255 255 255 / 0.08)`, `backdrop-filter: blur(24px)`, viền `1px solid rgb(120 220 240 / 0.18)`, `border-radius: 22px`; font `Inter, system-ui, sans-serif` / `'JetBrains Mono', ui-monospace, monospace`; card `width: 100%; max-width: 380px`, body `padding: 16px`; vào trang `opacity 0→1, translateY(24px)→0` 450 ms; `@media (prefers-reduced-motion: reduce)` tắt animation), đúng hai thẻ `<script`: `jsonBlock(...)` và `<script type="module" src="/assets/remote/auth.js">`. Không script nội tuyến.
  - `remote.ts`: `PUBLIC_STATIC = /^\/(manifest\.webmanifest|assets\/brand\/[\w.@-]+\.png|assets\/remote\/auth\.js)$/`; `/login` → `loginPage({ caDownload, passkeys: !!deps.passkeys, password: !deps.passkeys?.count() || !!deps.passwordLogin })`; `GET /remote/security`: không có `deps.passkeys` → 404 (comment `shortcut: LAN mode has no passkeys, the settings link 404s there; hide it if LAN mode is ever used`), chưa đăng nhập → 302 `/login`, có → `securityPage()`.
  - `client/src/remote/auth.ts` (không import `tr`; chữ từ `#auth-t`):
    - `export interface Texts { failed: string; cancelled: string; offline: string }`
    - `export type Post = (path: string, body: unknown) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;`
    - `export type Ceremony = (o: { optionsJSON: never }) => Promise<unknown>;`
    - `export async function signInWithPasskey(post: Post, start: Ceremony, t: Texts): Promise<string | undefined>` — options → `start` → verify; `undefined` = thành công, chuỗi = lỗi (lỗi server: `body.error`; `start` ném → `t.cancelled`; mạng → `t.offline`).
    - `export async function addPasskey(name: string, post: Post, start: Ceremony, t: Texts): Promise<string | undefined>` — register/options → `start` → register/verify `{ response, name }`.
    - `export async function signInWithPassword(user: string, password: string, post: Post, t: Texts): Promise<string | undefined>`
    - Khởi động DOM chỉ khi `typeof document !== 'undefined'`: `data-page` chọn trang; trang security nạp `GET /api/remote/passkeys`, vẽ bằng `textContent` (không `innerHTML`), xoá qua `POST /api/remote/passkeys/delete`. `start` = `startAuthentication` / `startRegistration` của `@simplewebauthn/browser`, nạp bằng `import()` động BÊN TRONG hàm khởi động DOM (không import ở đầu file: `auth.test.ts` chạy trong môi trường node, ba hàm export không phụ thuộc thư viện). Thành công đăng nhập → `location.replace('/')`.
  - `build-server.mjs`: `build({ entryPoints: ['client/src/remote/auth.ts'], outfile: 'dist/client/assets/remote/auth.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2020', minify: true })`.
  - `settings.ts`: trong `remoteGroup`, một hàng `ui-set` với nhãn `tr('Passkeys')`, gợi ý `tr('Add or remove the passkeys that sign you in from outside.')` và `<a class="ui-btn" href="/remote/security">` chữ `tr('Manage')`.

- [ ] **Step 1: Test (thất bại)** — `pages.test.ts`:
```ts
it('login page: Ocean Depth tokens, reduced motion, phone width, two scripts, passkey button and password form by flag', () => {
  const both = loginPage({ caDownload: false, passkeys: true, password: true });
  for (const s of ['#04101f', '#3ec7d3', '#6a8cff', 'blur(24px)', 'border-radius: 22px', 'prefers-reduced-motion: reduce', 'max-width: 380px', '/assets/brand/finstar.png', 'data-page="login"']) expect(both).toContain(s);
  expect(both.match(/<script/g)).toHaveLength(2);
  expect(both).toContain('src="/assets/remote/auth.js"');
  expect(both).toContain('Sign in with a passkey');
  expect(loginPage({ caDownload: false, passkeys: true, password: false })).not.toContain('type="password"');
  expect(loginPage({ caDownload: false, passkeys: false, password: true })).not.toContain('Sign in with a passkey');
});

it('the text block cannot close its script tag', () => {
  const b = jsonBlock({ a: '</script><b>' });
  expect(b.indexOf('</script>')).toBe(b.length - '</script>'.length);
});

it('security page: list, add, reset hint, back link, same scripts', () => {
  const p = securityPage();
  for (const s of ['data-page="security"', 'Add a passkey', '--reset-passkeys', 'href="/"']) expect(p).toContain(s);
  expect(p.match(/<script/g)).toHaveLength(2);
});
```
`auth.test.ts`:
```ts
const T = { failed: 'F', cancelled: 'C', offline: 'O' };
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

it('passkey sign-in: options, then the ceremony, then verify with what the ceremony returned', async () => {
  const calls: Array<[string, unknown]> = [];
  const post: Post = async (p, b) => { calls.push([p, b]); return p.endsWith('/options') ? res(200, { challenge: 'c' }) : res(200, { ok: true }); };
  expect(await signInWithPasskey(post, async (o) => ({ id: 'cred-1', echo: o.optionsJSON }), T)).toBeUndefined();
  expect(calls).toEqual([['/api/remote/passkeys/login/options', {}], ['/api/remote/passkeys/login/verify', { id: 'cred-1', echo: { challenge: 'c' } }]]);
});

it('a cancelled ceremony, a server refusal and no network become texts, never throws', async () => {
  const ok: Post = async () => res(200, {});
  expect(await signInWithPasskey(ok, async () => { throw new Error('NotAllowedError'); }, T)).toBe('C');
  expect(await signInWithPasskey(async (p) => (p.endsWith('/options') ? res(200, {}) : res(401, { error: 'Passkey not recognized.' })), async () => ({}), T)).toBe('Passkey not recognized.');
  expect(await signInWithPassword('u', 'p', async () => { throw new TypeError('fetch'); }, T)).toBe('O');
});

it('adding a passkey sends the name with the ceremony response', async () => {
  const calls: Array<[string, unknown]> = [];
  const post: Post = async (p, b) => { calls.push([p, b]); return res(200, {}); };
  expect(await addPasskey('Phone', post, async () => ({ id: 'n' }), T)).toBeUndefined();
  expect(calls[1]).toEqual(['/api/remote/passkeys/register/verify', { response: { id: 'n' }, name: 'Phone' }]);
});
```
`remote.test.ts`: `it('the login script and the logo load before sign-in; /remote/security needs a session', …)` — GET `/assets/remote/auth.js` và `/assets/brand/finstar.png` không cookie qua gate → không bị chuyển hướng (harness `page` trả 200); `/remote/security` không cookie → 302 `/login`; có cookie → 200 chứa `data-page="security"`.
Run: `npx vitest run server/remote/pages.test.ts client/src/remote/auth.test.ts server/http/remote.test.ts` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; chép logo; khoá `vi.ts` (chữ trang, settings); CHANGELOG: "New sign-in page and Passkeys page for the remote port (Ocean Depth look); settings link to manage passkeys."

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung; `npx esbuild client/src/remote/auth.ts --bundle --format=esm --platform=browser --minify --outfile=$(mktemp -d)/auth.js --log-level=warning` → không lỗi (kiểm import `@simplewebauthn/browser`, không ghi `dist/`).

- [ ] **Step 4: Commit**
```bash
git add server/remote/pages.ts server/remote/pages.test.ts client/src/remote/auth.ts client/src/remote/auth.test.ts client/public/assets/brand/finstar.png server/http/remote.ts server/http/remote.test.ts scripts/build-server.mjs client/src/ui/settings.ts shared/locales/vi.ts CHANGELOG.md
git commit -m "feat(remote): Ocean Depth sign-in and Passkeys pages with one small browser bundle; settings link"
```

---

### Task 6: `remote:setup` ghi `hub.env` (`--behind-proxy`, `--reset-passkeys`); `office.sh` nạp `hub.env` và nhường cho unit

**Files:**
- Modify: `scripts/remote-setup.ts`, `scripts/office.sh`, `shared/locales/vi.ts` (USAGE đổi → khoá mới), `CHANGELOG.md`
- Test: `server/remote/remote.test.ts` (nhóm `.env` và `setup and announcement`)

**Interfaces:**
- Consumes: Task 2 (biến `HABBLAUD_REMOTE_DOMAIN`, `HABBLAUD_REMOTE_HOST`, `HABBLAUD_REMOTE_PASSWORD_LOGIN`), Task 3 (đường `passkeys.json`).
- Produces (`scripts/remote-setup.ts`):
  - `export function dataDirOf(env: NodeJS.ProcessEnv): string` → `HABBLAUD_DATA_DIR` (trim) hoặc `<HOME>/.habblaud`; `export function hubEnvPath(env): string` → `<dataDir>/hub.env`; `export function passkeysPath(env): string` → `<dataDir>/remote/passkeys.json`. Hằng `ENV_FILE = join(ROOT, '.env')` bị XOÁ: script không bao giờ đọc hay ghi `.env` của repo (nơi có `CLF_API_KEY`).
  - `SetupArgs` thêm `behindProxy: boolean`, `resetPasskeys: boolean`; cờ `--behind-proxy`, `--reset-passkeys`.
  - `export function proxyEnv(current: string, s: { user: string; hash: string; domain: string; port: number; allow?: string }): string` → `updateEnv` với `HABBLAUD_REMOTE_USER`, `HABBLAUD_REMOTE_PASSWORD: null`, `HABBLAUD_REMOTE_PASSWORD_HASH`, `HABBLAUD_REMOTE_HOST: '127.0.0.1'`, `HABBLAUD_REMOTE_PORT`, `HABBLAUD_REMOTE_DOMAIN`, `HABBLAUD_ALLOWED_HOSTS: addToList(<cũ>, domain)`, `HABBLAUD_REMOTE_ALLOW: s.allow ?? <cũ> ?? 'terminal'`, `HABBLAUD_REMOTE_BIND/NAME/HTTP_PORT: null`.
  - `remoteEnv` (LAN): `HABBLAUD_REMOTE_DOMAIN: null`, `HABBLAUD_REMOTE_BIND: null` (Docker cũ); tên tuỳ chỉnh vẫn vào cert và `HABBLAUD_ALLOWED_HOSTS`.
  - `REMOTE_KEYS` thêm `HABBLAUD_REMOTE_HOST`, `HABBLAUD_REMOTE_PASSWORD_LOGIN` (`--off` xoá cả hai).
  - `main()`: `--reset-passkeys` → `rmSync(passkeysPath, { force: true })`, in `tr('[remote-setup] Passkeys removed. Restart the office: systemctl --user restart bang-hub (or npm run office -- restart).')`, thoát, không hỏi gì. `--behind-proxy` → bắt buộc `--domain` (hỏi nếu thiếu và có TTY; `--password-stdin` mà thiếu → lỗi), `port = args.port ?? 4748` (không dò 443), KHÔNG sinh cert, KHÔNG cài dịch vụ mDNS, ghi `proxyEnv`, in bước tiếp `tr('  Next: docs/deploy.md (go-live runbook).')`. Ghi file: `mkdirSync(dataDir, { recursive: true, mode: 0o700 })`, `writeFileSync(tmp, …, { mode: 0o600 })` + `renameSync`. `--allow` help: `terminal, none` (bỏ `spawn`); USAGE nói `hub.env` thay vì `.env`.
- `scripts/office.sh`:
  - `hub="${HABBLAUD_DATA_DIR:-$HOME/.habblaud}/hub.env"`; trong `launch()`: `( if [ -f "$hub" ]; then set -a; . "$hub"; set +a; fi; HABBLAUD_PTY=1 setsid nohup node dist/server/index.js > "$log" 2>&1 < /dev/null & )` và in thêm `(remote settings: $hub)` khi file có.
  - Trước `case`: nếu `[ "$port" = 4747 ]` và `systemctl --user is-enabled --quiet bang-hub.service 2>/dev/null` → `echo "bang-hub.service runs the office: systemctl --user start|stop|restart bang-hub (logs: journalctl --user -u bang-hub)"; exit 1` cho cả `start|stop|restart`.

- [ ] **Step 1: Test (thất bại)** — `server/remote/remote.test.ts`:
```ts
it('behind a proxy: loopback, domain, view-only terminal by default, LAN keys removed, the rest kept', () => {
  const cur = '# mine\nHABBLAUD_REMOTE_BIND=0.0.0.0\nHABBLAUD_REMOTE_NAME=habblaud\nHABBLAUD_ALLOWED_HOSTS=habblaud.local\nOTHER=1\n';
  const out = proxyEnv(cur, { user: 'bang', hash: 'scrypt:x', domain: 'hub.finstar.pp.ua', port: 4748 });
  expect(out).toContain('# mine\n');
  expect(out).toContain('OTHER=1');
  expect(readEnvValue(out, 'HABBLAUD_REMOTE_HOST')).toBe('127.0.0.1');
  expect(readEnvValue(out, 'HABBLAUD_REMOTE_DOMAIN')).toBe('hub.finstar.pp.ua');
  expect(readEnvValue(out, 'HABBLAUD_REMOTE_ALLOW')).toBe('terminal');
  expect(readEnvValue(out, 'HABBLAUD_ALLOWED_HOSTS')).toBe('habblaud.local,hub.finstar.pp.ua');
  for (const k of ['HABBLAUD_REMOTE_BIND', 'HABBLAUD_REMOTE_NAME', 'HABBLAUD_REMOTE_PASSWORD']) expect(readEnvValue(out, k)).toBeUndefined();
  expect(readEnvValue(proxyEnv('HABBLAUD_REMOTE_ALLOW=none\n', { user: 'b', hash: 'h', domain: 'd.example', port: 4748 }), 'HABBLAUD_REMOTE_ALLOW')).toBe('none');
});

it('files live in the data dir, never in the repo .env', () => {
  expect(hubEnvPath({ HOME: '/h' })).toBe('/h/.habblaud/hub.env');
  expect(hubEnvPath({ HOME: '/h', HABBLAUD_DATA_DIR: '/t/d ' })).toBe('/t/d/hub.env');
  expect(passkeysPath({ HOME: '/h' })).toBe('/h/.habblaud/remote/passkeys.json');
  expect(readFileSync(new URL('../../scripts/remote-setup.ts', import.meta.url), 'utf8')).not.toMatch(/['"]\.env['"]/);
});

it('flags: --behind-proxy, --reset-passkeys', () => {
  expect(parseArgs(['--behind-proxy', '--domain', 'Hub.Finstar.pp.ua'])).toMatchObject({ behindProxy: true, domain: 'hub.finstar.pp.ua' });
  expect(parseArgs(['--reset-passkeys']).resetPasskeys).toBe(true);
});
```
Sửa test `setup remoteEnv` cũ: không còn `HABBLAUD_REMOTE_BIND`, không `HABBLAUD_REMOTE_DOMAIN`.
Run: `npx vitest run server/remote/remote.test.ts` → FAIL.

- [ ] **Step 2: Cài** theo Interfaces; khoá `vi.ts`; CHANGELOG: "`npm run remote:setup` writes `<data dir>/hub.env` (never the repo `.env`); `--behind-proxy` for the Cloudflare hub, `--reset-passkeys`; `npm run office` loads `hub.env` and defers to `bang-hub.service` when it is enabled."

- [ ] **Step 3: Kiểm** — test xanh; kiểm chung; `sh -n scripts/office.sh`; thử nhánh unit không cần systemd thật:
```bash
S=$(mktemp -d); printf '#!/bin/sh\nexit 0\n' > $S/systemctl; chmod +x $S/systemctl
PATH=$S:$PATH sh scripts/office.sh start; echo "exit=$?"
PATH=$S:$PATH HABBLAUD_PORT=4749 sh scripts/office.sh stop; echo "exit=$?"; rm -r $S
```
Expected: `bang-hub.service runs the office: …`, `exit=1` (không build, không chạy gì); với 4749: `The office is not running on port 4749`, `exit=0`.

- [ ] **Step 4: Commit**
```bash
git add scripts/remote-setup.ts scripts/office.sh server/remote/remote.test.ts shared/locales/vi.ts CHANGELOG.md
git commit -m "feat(remote-setup): hub.env in the data dir, --behind-proxy and --reset-passkeys; office.sh loads hub.env and defers to bang-hub.service"
```

---

### Task 7: Mẫu deploy, runbook go-live, nghiệm thu trên cổng remote giả loopback, bàn giao

**Files:**
- Create: `deploy/bang-hub.service`, `deploy/bang-hub-cloudflared.service`, `deploy/cloudflared.yml.example`, `docs/deploy.md`
- Modify: `README.md` (mục remote: hai câu + link `docs/deploy.md`, bỏ chữ "`.env`" và "New agent"), `CHANGELOG.md`, cuối file kế hoạch này (`## Kết quả`, `## Để lại cho go-live`)
- Ngoài repo: worktree `~/bang-ver-accept6`, `~/.bang-test-data/plan6/`

**Interfaces:**
- `deploy/bang-hub.service`: `[Unit] Description=Bang_ver office (hub.finstar.pp.ua)`, `After=network-online.target`, `Wants=network-online.target`; `[Service] WorkingDirectory=%h/Agent_4_me/Agent_Hub/Bang_ver`, `EnvironmentFile=%h/.habblaud/hub.env`, `Environment=HABBLAUD_PTY=1`, `ExecStart=%h/.nvm/versions/node/v25.7.0/bin/node %h/Agent_4_me/Agent_Hub/Bang_ver/dist/server/index.js`, `Restart=always`, `RestartSec=5`, comment một dòng về `MemoryMax` (Quyết định 11); `[Install] WantedBy=default.target`.
- `deploy/bang-hub-cloudflared.service`: theo mẫu `finstar-console-cloudflared.service`: `After=network-online.target bang-hub.service`, `ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --config %h/.config/bang-hub/cloudflared.yml run bang-hub`, `Restart=always`, `RestartSec=5`, `MemoryMax=150M`, `WantedBy=default.target`.
- `deploy/cloudflared.yml.example`: `tunnel: <TUNNEL_ID>`, `credentials-file: /home/nhatbang/.cloudflared/<TUNNEL_ID>.json`, ingress `hostname: hub.finstar.pp.ua` → `service: http://127.0.0.1:4748`, cuối `service: http_status:404`.
- `docs/deploy.md` (tiếng Anh), mở đầu bằng: "Run nothing in this file until the owner says go. Every step changes this machine or the public internet." Mục:
  1. Preconditions (branch merged, `npm test` green, `git status` clean, no `.env` staged).
  2. Remote settings: `npm run remote:setup -- --behind-proxy --domain hub.finstar.pp.ua --user nhatbang` (owner types the password) → `~/.habblaud/hub.env` mode 600.
  3. Office as a service: `npm run build`, `npm run office -- stop`, `mkdir -p ~/.config/systemd/user && cp deploy/bang-hub.service ~/.config/systemd/user/`, `systemctl --user daemon-reload && systemctl --user enable --now bang-hub`; check `ss -Hltnp '( sport = :4747 or sport = :4748 )'` (both `127.0.0.1`) and `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: hub.finstar.pp.ua' http://127.0.0.1:4748/login` → `200`. Node upgrade → edit `ExecStart`.
  4. Tunnel and DNS: `cloudflared tunnel create bang-hub`; `ID=$(cloudflared tunnel list --name bang-hub --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')`; `mkdir -p ~/.config/bang-hub && sed "s/<TUNNEL_ID>/$ID/g" deploy/cloudflared.yml.example > ~/.config/bang-hub/cloudflared.yml`; `cloudflared tunnel --config ~/.config/bang-hub/cloudflared.yml ingress validate`; `cloudflared tunnel route dns bang-hub hub.finstar.pp.ua`; `cp deploy/bang-hub-cloudflared.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now bang-hub-cloudflared`. Không có lệnh nào đọc `Bang_ver/.env`.
  5. First passkey: sign in with the password, Settings → Passkeys → Manage → Add a passkey; sign out; sign in with the passkey; a password-only sign-in now answers "Password sign-in is off…".
  6. Acceptance: deploy spec §5 items 1–7, each with its exact command (curl/ss/stat/journalctl), level (a) wording for item 2.
  7. Rollback: `systemctl --user disable --now bang-hub-cloudflared` (site off, 4747 untouched); remove the `hub` DNS record in the Cloudflare dashboard (the owner; `route dns` cannot delete) then `cloudflared tunnel delete bang-hub`; back to the old way: `systemctl --user disable --now bang-hub && npm run office`.
  8. Lost passkey: at the computer `npm run remote:setup -- --reset-passkeys && systemctl --user restart bang-hub`, or `HABBLAUD_REMOTE_PASSWORD_LOGIN=1` in `hub.env` then restart.

Trong mọi bước nghiệm thu: `B=/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver; W=~/bang-ver-accept6; D=~/.bang-test-data/plan6; R=http://127.0.0.1:4758; H='Host: hub.finstar.pp.ua'; O='Origin: https://hub.finstar.pp.ua'; export HABBLAUD_DATA_DIR=$D HABBLAUD_REMOTE_TLS_DIR=$D/tls`. `post() { curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" -H 'Content-Type: application/json' "$@"; }`. Mật khẩu thử `plan6-test-pass` chỉ cho `$D`.

- [ ] **Step 1: Viết mẫu và runbook** theo Interfaces; README; CHANGELOG ("Go-live runbook `docs/deploy.md` and unit templates in `deploy/`."). Kiểm: `grep -c CLF_API_KEY docs/deploy.md deploy/*` → `0` mỗi file; `systemd-analyze --user verify deploy/bang-hub.service deploy/bang-hub-cloudflared.service 2>&1 | grep -v 'EnvironmentFile\|No such file'` → rỗng (chỉ đọc file, không cài).
```bash
git add deploy docs/deploy.md README.md CHANGELOG.md
git commit -m "docs(deploy): go-live runbook and unit, tunnel templates (nothing installed)"
```

- [ ] **Step 2: Worktree, `hub.env` thử, cert rác, start**
```bash
cd $B && git worktree add $W HEAD && cd $W && ln -s $B/node_modules node_modules
mkdir -p $D/tls && echo junk > $D/tls/server.key && echo junk > $D/tls/server.crt
printf 'plan6-test-pass\n' | npm run --silent remote:setup -- --behind-proxy --domain hub.finstar.pp.ua --port 4758 --user bang --password-stdin
stat -c %a $D/hub.env; grep -c '^HABBLAUD_REMOTE_HOST=127.0.0.1$' $D/hub.env; git -C $B status --short | grep -c '\.env'
HABBLAUD_PORT=4749 sh scripts/office.sh start; sleep 10
ss -Hltn 'sport = :4758'; ss -Hltn 'sport = :4747' | wc -l; ss -Hltn 'sport = :4748' | wc -l; grep -i 'remote access' $D/office.log
```
Expected: `600`; `1`; `0`; một dòng `127.0.0.1:4758`; `1`; `0`; log "HTTP behind a proxy for hub.finstar.pp.ua", "0 passkey(s); password sign-in on" (cert rác không làm cổng bật TLS).

- [ ] **Step 3: Guard, gate, giới hạn**
```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H "$H" $R/
curl -s -H "$H" $R/login | grep -c 'Sign in with a passkey'
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: khac.example' $R/
post $R/api/remote/login -d '{"user":"bang","password":"plan6-test-pass"}'
post -H 'Origin: https://evil.example' $R/api/remote/login -d '{"user":"bang","password":"plan6-test-pass"}'
for i in 1 2 3 4 5 6; do post -H "$O" -H 'CF-Connecting-IP: 203.0.113.7' $R/api/remote/login -d '{"user":"bang","password":"wrong-wrong"}'; sleep 3; done
sleep 3; curl -s -D - -o /dev/null -X POST -H "$H" -H "$O" -H 'CF-Connecting-IP: 203.0.113.8' -H 'Content-Type: application/json' $R/api/remote/login -d '{"user":"bang","password":"plan6-test-pass"}' | grep -i set-cookie | tee $D/cookie.hdr
```
Expected: `302 …/login`; `1`; `403`; `403` (không Origin); `403`; `401` ×5 rồi `429`; `set-cookie: habblaud_remote=…; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`. Lấy `C="Cookie: $(sed -n 's/.*\(habblaud_remote=[^;]*\).*/\1/p' $D/cookie.hdr)"`.

- [ ] **Step 4: Đã đăng nhập — chỉ xem, rào, passkey options, tài nguyên**
```bash
curl -s -H "$H" -H "$C" $R/api/access
for p in /api/advisor /api/team /api/workers/cancel /api/pty; do post -H "$O" -H "$C" $R$p -d '{}'; done
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H "$C" $R/api/workers/jobs/w1
curl -s -X POST -H "$H" -H "$O" -H 'Content-Type: application/json' $R/api/remote/passkeys/login/options -d '{}' | python3 -c 'import json,sys; o=json.load(sys.stdin); print(o["rpId"], o["userVerification"], len(o.get("allowCredentials") or []))'
curl -s -X POST -H "$H" -H "$O" -H "$C" -H 'Content-Type: application/json' $R/api/remote/passkeys/register/options -d '{}' | python3 -c 'import json,sys; o=json.load(sys.stdin); print(o["rp"]["id"], o["authenticatorSelection"]["residentKey"])'
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H "$C" $R/remote/security
for a in /assets/remote/auth.js /assets/brand/finstar.png; do curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H "$H" $R$a; done
```
Expected: `{"remote":true,"local":false,"terminal":true,"spawn":false}`; `403` ×5; `hub.finstar.pp.ua required 0`; `hub.finstar.pp.ua required`; `200`; `200 …javascript…`, `200 image/png`. Nghi thức WebAuthn thật: "CHỜ GO-LIVE" (runbook mục 5).

- [ ] **Step 5: Chính sách mật khẩu, lối thoát, phiên sống qua khởi động lại** (spec §5.2c, §5.5)
```bash
mkdir -p $D/remote && printf '[{"id":"fake","publicKey":"AQID","counter":0,"name":"fake","createdAt":1}]' > $D/remote/passkeys.json && chmod 600 $D/remote/passkeys.json
HABBLAUD_PORT=4749 sh scripts/office.sh restart; sleep 10
post -H "$O" $R/api/remote/login -d '{"user":"bang","password":"plan6-test-pass"}'
curl -s -H "$H" $R/login | grep -c 'type="password"'
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" -H "$C" $R/api/access
npm run --silent remote:setup -- --reset-passkeys; test -e $D/remote/passkeys.json; echo "exists=$?"
HABBLAUD_PORT=4749 sh scripts/office.sh restart; sleep 10
post -H "$O" $R/api/remote/login -d '{"user":"bang","password":"plan6-test-pass"}'
```
Expected: `403`; `0`; `200` (cookie cũ còn hiệu lực sau restart); `exists=1`; `200`.

- [ ] **Step 6: Trang ở 390 px** (tuỳ chọn: chỉ khi có công cụ trình duyệt, vd skill `playwright-cli`) — mở `http://127.0.0.1:4758/login` (Host là IP nên guard cho qua) ở 390×844, `document.documentElement.scrollWidth <= 390`, ảnh `docs/superpowers/plans/plan6-login.png`; bật `prefers-reduced-motion: reduce` → `getComputedStyle(card).animationName === 'none'`. Không có công cụ → ghi "chưa kiểm, xem test chuỗi CSS ở Task 5".

- [ ] **Step 7: Test, số dòng, RSS tham khảo, dọn**
```bash
pid=$(ss -Hltnp 'sport = :4749' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); for i in 1 2 3; do ps -o rss= -p $pid; sleep 10; done
HABBLAUD_PORT=4749 sh scripts/office.sh stop; ss -Hltn 'sport = :4758' | wc -l; ss -Hltn 'sport = :4747' | wc -l
cd $B && git worktree remove --force $W
npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)
git diff --shortstat 3b6d21d..HEAD -- server client shared scripts ':!*.test.ts'
git status --short | grep -c '\.env'
```
Expected: ba số RSS (tham khảo, so với 112.4 MB của Kế hoạch 5); `0`; `1`; xanh (trừ flaky); ròng ≤ +600 (vượt → báo); `0`. Giữ `$D` (dữ liệu thử).

- [ ] **Step 8: Ghi `## Kết quả` và `## Để lại cho go-live`** — bảng Step 1–7 (lệnh, kết quả chính, lệch), kích thước `dist/server/index.js`, số test, số dòng, RSS; danh sách bàn giao mỗi mục một dòng có nguồn, tối thiểu: chạy `docs/deploy.md` sau lệnh "go"; nghi thức passkey thật (§5.3) và Cloudflare SSE 3 phút (§5.2) chỉ kiểm được sau go-live; câu hỏi cho controller còn mở; mục "Bàn giao đã nhận" chưa làm.
```bash
git add docs/superpowers/plans/2026-11-04-bang-ver-6-deploy.md docs/superpowers/plans/plan6-login.png 2>/dev/null; git add docs/superpowers/plans/2026-11-04-bang-ver-6-deploy.md
git commit -m "docs: plan 6 local acceptance results and go-live hand-over"
```

---

## Bàn giao đã nhận

- Kế hoạch 1 (I6, `spawn` remote): Task 1. Dòng `vi.ts` "(mặc định: terminal)": đã sửa trước đây (`vi.ts:1256` ghi "none, chỉ xem"), bỏ qua; chữ `spawn` trong help `--allow` bỏ ở Task 6.
- Kế hoạch 2 (đo RSS lúc rảnh): Task 7 Step 7, chỉ tham khảo.
- Kế hoạch 3 (`hub.env`, `office.sh` chỉ dò `127.0.0.1`): Task 6; dò `127.0.0.1:<port>` vẫn đúng vì cổng chính không đổi.
- Kế hoạch 5 mục 1 (rào `/api/advisor` qua cổng remote): Task 1 (test) + Task 7 Step 4. Mục 2–12 (nghiệm thu advisor với boss thật, M2, số dòng advisor, vặt review, ghế agy duyệt lệnh, boss agy, tuân thủ thẻ, CLI timeout, câu hỏi mở Kế hoạch 4, RSS, advisor headless): không thuộc deploy, chuyển nguyên vào `## Để lại cho go-live` mục "còn mở từ Kế hoạch 5".

## Tự kiểm sau khi viết

Deploy spec:
- §3.1 mạng (tunnel `bang-hub`, ingress, unit cloudflared, `route dns`, không code đọc `CLF_API_KEY`): mẫu + runbook Task 7; không task nào chạy chúng (phán quyết).
- §3.2 server và env (4748 loopback, không TLS, `HABBLAUD_REMOTE_DOMAIN` → rpID/origin/`Secure`, `ALLOWED_HOSTS`, `hub.env` 600, `office.sh` nạp, unit `EnvironmentFile`): Task 2, 6, 7; lệch thư mục: Quyết định 1.
- §3.3 đăng nhập (mật khẩu scrypt giữ; passkey đăng ký khi đã đăng nhập, đặt tên, xoá; passwordless `userVerification: required`; mật khẩu tắt khi có passkey trừ `PASSWORD_LOGIN=1`): Task 4, 5.
- §3.4 thư viện đóng gói, không tự viết CBOR: Task 4 (cài, bundle, kiểm worktree), Task 5 (browser).
- §3.5 lưu trữ (trường, tmp+rename, 600, challenge RAM 2 phút): Task 3.
- §3.6 giao diện (token, card, font, motion, reduced motion, logo, `tr()`, trang `/remote/security` riêng, link trong settings, không kéo `@simplewebauthn/browser` vào office, lối thoát, 4747 không có UI passkey): Task 5, Task 6 (`--reset-passkeys`).
- §3.7 hardening (cookie, Origin, 5 lần/10 phút theo `CF-Connecting-IP` → 429, log, không đăng ký tài khoản, 7 ngày): Task 2, 4.
- §3.9 mức (a): Global Constraints + test Task 1 + Task 7 Step 4. §3.10 unit + `office.sh` nhường: Task 6, 7 (Quyết định 11 lệch `/usr/bin/env node` và `MemoryMax`).
- §5 kiểm nghiệm: 1 (Host lạ, 302/200 cục bộ) Task 7 Step 3; 2 (429, cookie, chỉ đọc) Step 3–4, phần qua Cloudflare chờ go-live; 2b reboot: runbook; 2c Step 5; 3 passkey thật: runbook; 4 tunnel: runbook; 5 Step 5; 6 `ss`, `git status`, mode 600: Step 2, 7, Task 3 test; 7 trang 390 px, reduced motion: Task 5 test + Step 6.
- §6 rủi ro: bundle +1 MB và ESM/CJS (Task 4 Step 6), cert cũ 308 (Quyết định 2, Review Focus 1), host `0.0.0.0` (Task 2 test), `remote.test.ts` cập nhật (Task 1).

## Câu hỏi cho controller

1. **Cài `@simplewebauthn/server` và `@simplewebauthn/browser` từ npm** (Task 4 Step 1, cần mạng, đổi `package-lock.json`): duyệt?
2. **`MemoryMax=400M` của spec §3.10**: bỏ (mẫu hiện tại), nâng (vd `3G`), hay giữ 400M dù giết cả boss/ghế khi vượt?
3. **Đường node trong unit**: `%h/.nvm/versions/node/v25.7.0/bin/node` (phải sửa khi nâng node) hay một symlink ổn định do người dùng tạo (vd `~/.local/bin/node`)?
4. **Chế độ LAN cũ** (mDNS `scripts/remote-mdns.ts`, dịch vụ announce, cert tự ký, ~600 dòng): giữ như spec §4 nói, hay cắt trong một kế hoạch sau khi hub chạy ổn?
5. **`POST /api/spawn` local** không có UI gọi: giữ (Kế hoạch 6 chỉ bỏ quyền remote và hàng đợi helper) hay xoá cả hệ con spawn sau?
