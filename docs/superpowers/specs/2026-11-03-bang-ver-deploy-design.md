# Bang_ver — thiết kế deploy web `hub.finstar.pp.ua` với đăng nhập và passkey

_Ngày 2026-11-03 · Bổ sung cho `2026-11-03-bang-ver-design.md` §21 · Người quyết định: nhatbang_

## 1. Mục đích

Mở office Bang_ver từ Internet tại `https://hub.finstar.pp.ua`, đăng nhập bằng mật khẩu và passkey, trang đăng nhập theo thiết kế "Ocean Depth" của FinSTAR Console. Máy vẫn chỉ nghe loopback; Cloudflare Tunnel làm TLS và lớp mạng. Việc của worker (`worker-ask`, `advisor`) không đổi: vẫn gọi `127.0.0.1:4747` nội bộ.

Vì sao: người dùng muốn theo dõi và điều khiển office từ ngoài nhà. Office có terminal PTY (shell của tài khoản `nhatbang`), nên lớp đăng nhập phải chống phishing: passkey.

## 2. Sự thật đã kiểm (2026-11-03)

- DNS `finstar.pp.ua` ở Cloudflare (zone `9fa47aba61e820f378890a67e79e65d2`). `*.finstar.pp.ua` là bản ghi A proxied → `135.181.41.169` (máy khác của người dùng), nên `hub.finstar.pp.ua` hiện trỏ về đó. `finstar.pp.ua` và `www` là CNAME tới tunnel `1b0ac0be…` (tunnel `finstar-console`). Một bản ghi CNAME riêng cho `hub` ghi đè wildcard mà không đụng bản ghi khác.
- `Bang_ver/.env` có `CLF_API_KEY`: API token scoped, trạng thái active (xác minh qua `/user/tokens/verify`), liệt kê được 7 tunnel của account. Đủ để tạo bản ghi DNS qua API. File không commit (`.gitignore`).
- Máy có `cloudflared` (`/usr/local/bin`), `~/.cloudflared/cert.pem` (đã `cloudflared login`), 7 tunnel đang healthy. Mẫu đang chạy: `~/.config/finstar-console/cloudflared.yml` + unit user `finstar-console-cloudflared.service` (`Restart=always`, `MemoryMax=150M`); mẫu locally managed trong `FPT_Capstone/UI_UX/deploy/cloudflared.yml.example`.
- Upstream Habblaud đã có lớp remote, Kế hoạch 1 giữ nguyên: cổng riêng `HABBLAUD_REMOTE_PORT` (mặc định 4748), user + mật khẩu scrypt (`HABBLAUD_REMOTE_USER`, `HABBLAUD_REMOTE_PASSWORD_HASH`, `server/remote/password.ts`), cookie phiên ký `habblaud_remote` 30 ngày có thu hồi khi đăng xuất (`server/http/remote.ts`), `HABBLAUD_REMOTE_ALLOW` (sau Kế hoạch 1 còn `terminal`, `spawn`), TLS tự ký tuỳ chọn, chặn DNS rebinding bằng `HABBLAUD_ALLOWED_HOSTS` (`server/http/guard.ts`); `scripts/remote-setup.ts` ghi các biến này vào `.env` ở gốc repo, thứ chỉ Docker Compose đọc (server Node chỉ đọc `process.env`, không có dotenv). Biến bind thật là `HABBLAUD_REMOTE_HOST` (mặc định `0.0.0.0`), không phải `HABBLAUD_REMOTE_BIND`.
- Upstream **cấm terminal tương tác (PTY) trên cổng remote** bằng luật cứng, không phải cờ: `server/http/app.ts` (`pty: !!deps.pty && !remote`, chú thích "never allowed over remote port"), `server/http/pty.ts` (`ptyRequestProblem` đòi Host loopback), client ẩn nút mở terminal khi `access().remote` (`client/src/ui/drawer.ts:715`). `HABBLAUD_REMOTE_ALLOW=terminal` chỉ cho **xem** terminal trực tiếp chỉ đọc qua SSE (`server/http/terminal.ts`, ping 15 giây); `spawn` cho form "New agent". Stream PTY là SSE, `server/pty/manager.ts attach` không ping.
- Cookie `Secure` hiện gắn với `!!remote.tls` (`server/index.ts`); `remote-setup` luôn sinh cert tự ký, và nếu cert tồn tại thì 4748 bật TLS → cloudflared gọi HTTP thuần sẽ nhận 308 lặp. Server không đọc `HABBLAUD_REMOTE_DOMAIN`. `server/index.ts` có `import('vite')` động cho dev.
- `office.sh` chạy `setsid nohup node …`: sống qua đóng shell, không sống qua reboot hay crash. Máy đã bật `loginctl enable-linger` (các unit user của finstar đang chạy).
- FinSTAR Console (`FPT_Capstone/UI_UX`): FE React + Tailwind, BE FastAPI với `webauthn` 3.x, `pyjwt`, `pwdlib[argon2]`; phiên = Bearer access token + refresh cookie; thiết kế "T06 Ocean Depth" trong `design/DESIGN.md` (token CSS). Hub không dùng chung user DB với Console (ứng dụng khác, miền khác, một chủ sở hữu).
- `scripts/build-server.mjs`: esbuild `bundle: true`, `platform: 'node'`, `packages: 'external'`.

## 3. Quyết định

1. **Mạng.** Tunnel mới `bang-hub`, locally managed (credentials trong `~/.cloudflared/<id>.json`), ingress `hub.finstar.pp.ua → http://127.0.0.1:4748`, còn lại `http_status:404`; unit user `~/.config/systemd/user/bang-hub-cloudflared.service` theo mẫu finstar, `After=bang-hub.service`; không đụng tunnel của Console. DNS: `cloudflared tunnel route dns bang-hub hub.finstar.pp.ua` (dùng `cert.pem`; lệnh chỉ từ chối khi có bản ghi trùng tên, wildcard không cản). Toàn bộ là **runbook làm tay** trong `docs/deploy.md` của Bang_ver kèm file mẫu trong `deploy/` (yml, hai unit); **không dòng code nào đọc `CLF_API_KEY`**; token chỉ là dự phòng cho người tạo CNAME bằng API nếu `route dns` hỏng.
2. **Server và env.** Office chính nghe `127.0.0.1:4747` không đăng nhập, như cũ. Cổng remote `4748` nghe loopback: `HABBLAUD_REMOTE_HOST=127.0.0.1` (biến thật của fork), không TLS (`remote-setup --behind-proxy` không sinh cert; Cloudflare làm TLS). Biến mới `HABBLAUD_REMOTE_DOMAIN=hub.finstar.pp.ua` do code passkey đọc làm `rpID`/`origin` và khi có nó cookie luôn `Secure` (thay điều kiện `!!remote.tls`). `HABBLAUD_ALLOWED_HOSTS=hub.finstar.pp.ua`, `HABBLAUD_REMOTE_ALLOW` theo mức ở §3.9. Mọi biến này nằm trong `~/.habblaud/hub.env` (mode 600) do `npm run remote:setup` ghi (đổi đích ghi từ `.env` gốc repo sang file này); `scripts/office.sh` nạp file đó (`set -a; . ~/.habblaud/hub.env; set +a`) và unit systemd dùng `EnvironmentFile=%h/.habblaud/hub.env`. `Bang_ver/.env` chỉ giữ `CLF_API_KEY`, server không bao giờ đọc nó.
3. **Đăng nhập.** Giữ user + mật khẩu scrypt của upstream. Thêm passkey (WebAuthn): đăng ký từ hộp "Bảo mật" khi đã đăng nhập (đặt tên, xoá); trang đăng nhập có nút "Đăng nhập bằng passkey" (passwordless, `userVerification: required`) và ô mật khẩu. Chính sách mặc định: khi đã có ≥1 passkey, đăng nhập chỉ bằng mật khẩu bị từ chối, trừ khi `HABBLAUD_REMOTE_PASSWORD_LOGIN=1` (người dùng chốt).
4. **Thư viện.** `@simplewebauthn/server` (server) và `@simplewebauthn/browser` (client) làm devDependencies; `build-server.mjs` bỏ `packages: 'external'` để esbuild đóng gói dependency vào `dist/server/index.js`; runtime vẫn không cần `node_modules`. Không tự viết CBOR/COSE/attestation.
5. **Lưu trữ.** `~/.habblaud/remote/passkeys.json`: `[{ id, publicKey, counter, transports, name, createdAt, lastUsedAt }]`, ghi tmp+rename, mode 600. Challenge trong RAM, TTL 2 phút. `rpID = HABBLAUD_REMOTE_DOMAIN`, `origin = https://<domain>`.
6. **Giao diện đăng nhập và Bảo mật.** Trang HTML riêng của cổng remote dùng token Ocean Depth: nền `#04101f`, chữ `rgb(226 240 250)`, chữ phụ `rgb(140 170 192)`, accent `#3ec7d3` → `#6a8cff` cho nút chính (chữ `#04101f`), card glass blur 24px alpha 0.08 viền `rgb(120 220 240 / 0.18)`, radius 22px, font Inter + JetBrains Mono, motion vào trang `opacity 0→1, y 24, <500ms`, tôn trọng `prefers-reduced-motion`. Logo `UI_UX/logo_finstar.png` chép vào `client/public/`. Office bên trong giữ pixel như cũ. Chữ hiển thị qua `tr()`. Hộp "Bảo mật" (đăng ký, đặt tên, xoá passkey) là trang riêng `/remote/security` dùng chung CSS và bundle TS nhỏ với trang đăng nhập (không kéo `@simplewebauthn/browser` vào bundle office); nhóm remote trong settings pixel (`client/src/ui/settings.ts`, cạnh "Đăng xuất") chỉ có một link mở trang đó. Mất thiết bị passkey duy nhất = bị khoá ngoài; lối thoát dự định là ngồi tại máy: `npm run remote:setup -- --reset-passkeys` (xoá `passkeys.json`) hoặc đặt `HABBLAUD_REMOTE_PASSWORD_LOGIN=1` trong `hub.env` rồi khởi động lại. Cổng 4747 không có UI quản lý passkey.
7. **Hardening.** Cookie `Secure; HttpOnly; SameSite=Lax`; mọi POST của remote kiểm `Origin === https://<domain>`; 5 lần đăng nhập sai trong 10 phút theo `CF-Connecting-IP` → 429 (RAM); log đăng nhập thành công/thất bại (IP, user agent rút gọn) vào log server; không có đăng ký tài khoản mới. Thời hạn phiên giảm 30 → 7 ngày (`SESSION_MS`), người dùng chốt. Cloudflare Access/WAF: không bắt buộc, có thể thêm sau mà không đổi code.
8. **Thứ tự.** Sau Kế hoạch 1. Độc lập với Kế hoạch 2–5 (chạm `server/http/remote.ts`, `server/remote/`, trang đăng nhập, `scripts/`, unit systemd), có thể làm trước chúng.
9. **Mức điều khiển từ web (đã chốt 2026-11-03: mức (a) cho v1; cùng lúc người dùng chốt: passkey bắt buộc khi đã đăng ký, phiên 7 ngày, dùng `@simplewebauthn` đóng gói, chấp nhận rủi ro mức (a)).** (a) **Xem**: office, feed, drawer, terminal chỉ đọc (`HABBLAUD_REMOTE_ALLOW=terminal`), không gõ, không tạo phiên; đúng luật upstream, không gỡ gì; lộ đăng nhập = lộ nội dung transcript và màn hình terminal, không lộ shell. (b) **Gõ**: gỡ luật cấm PTY trên cổng remote ở `app.ts`, `pty.ts`, `drawer.ts`, thêm ping 30 giây cho SSE của PTY, cho mở boss và terminal ghế từ web; lộ đăng nhập = lộ shell của máy. Đề xuất: v1 là (a); (b) là bước sau khi passkey đã chạy ổn vài ngày, và nếu làm thì chỉ sau khi đăng nhập bằng passkey (không phải mật khẩu).
10. **Chạy nền.** Thêm unit user `~/.config/systemd/user/bang-hub.service`: `ExecStart=/usr/bin/env node %h/Agent_4_me/Agent_Hub/Bang_ver/dist/server/index.js`, `WorkingDirectory` là repo, `EnvironmentFile=%h/.habblaud/hub.env`, `Environment=HABBLAUD_PTY=1`, `Restart=always`, `RestartSec=5`, `MemoryMax=400M`, `After=network-online.target`, log qua journal (`journalctl --user -u bang-hub`). `scripts/office.sh` giữ cho dev; khi unit đã enable, `office.sh start` in hướng dẫn dùng `systemctl --user` thay vì tự chạy để không có hai server tranh cổng.

## 4. Không làm

Nhiều người dùng; dùng chung tài khoản hay cookie với FinSTAR Console; MFA TOTP; đổi giao diện office; mở cổng ra LAN hay Tailscale (có thể thêm sau bằng `HABBLAUD_REMOTE_BIND`); tự quản lý TLS (TLS tự ký của upstream để nguyên, không dùng).

## 5. Kiểm nghiệm

1. `curl -sI https://hub.finstar.pp.ua/` → 200 trang đăng nhập; `curl -sI -H 'Host: khac.example' http://127.0.0.1:4748/` → bị guard từ chối.
2. Đăng nhập sai 5 lần → 429; đúng → cookie `Secure; HttpOnly`; trang office hiện nhân vật; terminal chỉ đọc của một ghế hiện và cập nhật (SSE qua Cloudflare) ở mức (a); ở mức (b) gõ được và phiên không rớt sau 3 phút im lặng.
2b. `sudo reboot` (hoặc `systemctl --user restart bang-hub bang-hub-cloudflared`) → trong 60 giây site vào lại được, không cần ai gõ lệnh.
2c. Xoá `passkeys.json` tại máy rồi khởi động lại → đăng nhập bằng mật khẩu được trở lại (lối thoát khi mất passkey).
3. Đăng ký passkey từ điện thoại hoặc laptop; đăng xuất; đăng nhập passwordless bằng passkey; đăng nhập chỉ mật khẩu bị từ chối (mặc định).
4. `systemctl --user stop bang-hub-cloudflared` → site không vào được, office local 4747 vẫn chạy; `start` → vào lại được.
5. Khởi động lại server: cookie còn hiệu lực (secret bền trên đĩa như upstream), passkey còn (file).
6. `ss -ltnp` cho thấy 4747 và 4748 chỉ nghe `127.0.0.1`; `git status` không thấy `.env`; `~/.habblaud/remote/passkeys.json` mode 600.
7. Trang đăng nhập ở 390px rộng không tràn ngang; `prefers-reduced-motion` tắt hoạt ảnh.

## 6. Rủi ro

- Phơi shell của máy qua web: lộ passkey hoặc mật khẩu là lộ máy. Giảm: passkey bắt buộc sau khi đăng ký, giới hạn thử, phiên 7 ngày, có thể thêm Cloudflare Access sau. Người dùng chấp nhận khi duyệt.
- Stream qua Cloudflare Tunnel là SSE; kết nối im lặng quá 100 giây bị cắt. Terminal chỉ đọc đã ping 15 giây; PTY (`manager.ts attach`) chưa ping, chỉ cần khi chọn mức (b).
- `@simplewebauthn` đóng gói vào `dist`: kích thước `dist/server/index.js` tăng (ước +1 MB); esbuild phải giữ `external: ['vite']` vì `server/index.ts` có `import('vite')` động cho dev; kiểm `npm run build` và khởi động không lỗi ESM/CJS.
- Nếu còn cert tự ký cũ trong thư mục TLS của Habblaud, 4748 bật TLS và cloudflared HTTP thuần nhận 308 lặp: `remote-setup --behind-proxy` phải tắt TLS rõ ràng (biến `HABBLAUD_REMOTE_TLS=0` hoặc không có cert), và `docs/deploy.md` nói rõ.
- `HABBLAUD_REMOTE_HOST` mặc định `0.0.0.0`: quên đặt `127.0.0.1` là phơi trang đăng nhập HTTP thuần ra LAN. `remote-setup --behind-proxy` ghi `127.0.0.1` mặc định; §5.6 kiểm bằng `ss`.
- Nếu ai xoá bản ghi `hub`, tên trỏ về wildcard (máy 135.181.41.169): sai đích, không lộ gì.
- Kế hoạch 1 giữ `remote` nhưng cắt `permissions`/`messages`: `HABBLAUD_REMOTE_ALLOW` còn `terminal`, `spawn`; `remote.test.ts` phải cập nhật theo.

## 7. Để lại cho builder

Tên route passkey (`/remote/passkeys/*`), cấu trúc file trang đăng nhập và trang bảo mật (một HTML mỗi trang + một CSS + một TS nhỏ dùng chung), cách bundle esbuild (`external: ['vite']`) và kiểm ESM, ping SSE của PTY nếu mức (b), nội dung chính xác của hai unit systemd, vị trí đặt rate limit trong `server/http/remote.ts`, thứ tự bước trong `scripts/remote-setup.ts` (hỏi domain, user, mật khẩu; cờ `--behind-proxy`, `--reset-passkeys`; ghi `~/.habblaud/hub.env`), cách `office.sh` nạp `hub.env` và nhận ra unit đang chạy.
