# Bang_ver — Kế hoạch 1/6: tạo repo và cắt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo repo `Agent_Hub/Bang_ver` từ Vi-Habblaud và xoá mọi hệ con ngoài lõi (≈105k → ≈40k dòng) sao cho sau mỗi task typecheck sạch, vitest xanh, server vẫn chạy và hiện office.

**Architecture:** Chỉ xoá và sửa chỗ import, không thêm tính năng. Mỗi task = một hệ con, theo thứ tự ít điểm import trước; `npm run typecheck` là máy dò chỗ còn tham chiếu, `npx vitest run` là hồi quy; mỗi task một commit để `git revert` được từng hệ con. Phần "nhiều office", "team rule", "ghế" để Kế hoạch 2 (slot) vì phần thay thế viết cùng lúc. Hệ con `remote` (token truy cập, bind host, TLS) GIỮ cho Kế hoạch 6 (deploy web `hub.finstar.pp.ua` + đăng nhập/passkey), theo yêu cầu người dùng tối 2026-11-03.

**Tech Stack:** Node ≥22 (máy 25.7), TypeScript, Vite, vitest; Python 3 + pytest cho `tools/agy`; bash.

**Spec:** `docs/superpowers/specs/2026-11-03-bang-ver-design.md` (§4 tạo repo, §16 bảng cắt và thứ tự, §3 không làm/phản mục tiêu, §21 bổ sung deploy).

## Global Constraints

- Không thêm runtime dependency; `dependencies` trong `package.json` giữ rỗng như hiện tại.
- Node ≥ 22; xoá `engine-strict=true` khỏi `.npmrc`.
- Mọi chữ hiển thị qua `tr('English text')`; `shared/locales/vi.ts` là bản dịch duy nhất; `npm run i18n:check` phải xanh.
- Code, comment, doc trong repo bằng tiếng Anh (quy ước fork, `CLAUDE.md`); kế hoạch và spec thì tiếng Việt.
- Mỗi hệ con xoá là một commit; thông điệp commit dạng `chore(cut): remove <subsystem>`; mọi commit kết thúc bằng hai dòng:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KLAyKmy32XNRqmQQTYwaFT
  ```
- Sau mỗi task: `npm run typecheck && npx vitest run` xanh. Test của hệ con đã xoá thì xoá; test còn lại không được bỏ qua bằng `skip`.
- Không đụng `~/.agy_profiles/`, `~/.claude/`, `~/.local/bin` trong kế hoạch này (link sang Bang_ver là việc của Kế hoạch 3).
- Giữ nguyên: `client/src/world/{index,api,sim,render,layout,path,camera,input,assets,constants,debug,sound-cues}.ts`, `client/src/art/**`, `server/{pty,spawn,workers,accounts,model,http,sources,remote}` (trừ file nêu trong task), `server/http/remote.ts`, `client/src/net/access.ts`, `scripts/remote-setup.ts`, `scripts/remote-mdns.ts`, `server/sources/agy/**`, `tools/agy/bin/{agy-as,worker-ask}`, `shared/locales/**`, ghosts.

## Review Focus

Năm tình huống spec ngầm đòi hỏi nhưng không test nào hiện có bao phủ; mỗi dòng được gắn test ở task sở hữu:

1. Server khởi động khi `~/.habblaud/` còn dữ liệu của bản cũ (`timeline/`, `stats/`, `names.json`) và env cũ (`HABBLAUD_WORLD`, `HABBLAUD_TIMELINE`, `HABBLAUD_CODEX`, `HABBLAUD_DEMO`) vẫn được export trong `office.sh` hay shell: phải bỏ qua, không crash, không ghi thêm vào thư mục đã bỏ. → Task 16.
2. Trình duyệt còn cache trang cũ gọi `/api/world`, `/api/timeline`, `/api/permissions`, `/api/rules`, `/api/board`: server trả 404 (không 500, không treo SSE). → Task 12, test trong `server/http/http.test.ts`.
3. `worker-ask` nhận lệnh cũ `agy-ask rules …`: báo lỗi một dòng và exit 1, không treo chờ office. → Task 9, pytest.
4. `team.json` cũ còn `offices[]`/`workers` của 7 tài khoản: Kế hoạch 1 vẫn đọc được như fork (đổi dạng là Kế hoạch 2). → Task 16 kiểm bằng file thật của máy.
5. Nhân vật Claude mất "cốc năng lượng" khi bỏ mod và statusline: phải hiện trạng thái "không rõ", không hiện 0% hay lỗi. → Task 1, test trong `server/accounts/`.

---

### Task 0: Tạo repo Bang_ver và chạy baseline

**Files:**
- Create: repo git trong `/home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver` (đã có `docs/superpowers/**` và `.env`)
- Modify: `.npmrc`, `.gitignore` (thêm `.env`)

**Interfaces:**
- Produces: nhánh `bang-ver` = Vi-Habblaud `main` (d916cf1) + `docs/superpowers/**`; remote `vi` trỏ `../Vi-Habblaud` để `git diff vi/main`.

- [ ] **Step 1: Tạo repo giữ lịch sử**

```bash
cd /home/nhatbang/Agent_4_me/Agent_Hub/Bang_ver
git init
git remote add vi ../Vi-Habblaud
git fetch vi main
git checkout -b bang-ver FETCH_HEAD
grep -qx '.env' .gitignore || echo '.env' >> .gitignore
git add docs .gitignore && git commit -m "docs: Bang_ver design spec and plan 1; ignore .env"
```
Expected: `git log --oneline -2` cho thấy commit mới trên d916cf1; `git status --short` không liệt kê `.env`.

- [ ] **Step 2: Bỏ engine-strict và cài**

Sửa `.npmrc`: xoá dòng `engine-strict=true` (xoá file nếu rỗng). Chạy `npm install`.
Expected: không có lỗi EBADENGINE; `node_modules/` có `vitest`, `vite`, `esbuild`, `tsx`, `typescript`.

- [ ] **Step 3: Baseline**

Run: `npm run typecheck && npx vitest run && npm run build && (cd tools/agy && python3 -m pytest -q tests)`
Expected: typecheck sạch; vitest ≈2129 pass / 2 skipped; `dist/server/index.js` và `dist/client/` tồn tại; pytest 49 pass. Ghi con số thật vào commit Step 4.

- [ ] **Step 4: Commit**

```bash
git add .npmrc package-lock.json
git commit -m "chore: drop engine-strict, record baseline (typecheck ok, vitest N pass, pytest 49 pass)"
```

---

### Task 1: Tooling, Docker, installer cũ, release

**Files:**
- Delete: `scripts/release.ts`, `scripts/shot.mjs`, `scripts/world-shots.mjs`, `scripts/demo-timeline.ts`, `scripts/docker-up.ts`, `scripts/statusline-install.ts`, `scripts/statusline-tap.mjs`, `scripts/hooks-install.ts`, `scripts/permission-hook.mjs`, `scripts/codex-install.ts`, `scripts/codex-bridge.ts`, `scripts/mod-install.ts`, `docker/`, `Dockerfile`, `docker-compose.yml`, `server/test/release.test.ts`, `server/legacy.ts`, `server/legacy.test.ts`, `server/accounts/statusline.ts` (+ test nếu có)
- Modify: `package.json` (scripts, devDependencies), `server/accounts/service.ts`, `server/accounts/usage.ts`, `server/config.ts`, `server/index.ts`, `server/team.ts` (chỉ chỗ import `legacy`), `server/test/{permission-server,fake-world,codex-fixtures}.ts` (chỉ chỗ import `legacy`; các file này bị xoá ở task sau)
- Keep: `scripts/assets/`, `scripts/build-info.mjs`, `scripts/build-server.mjs`, `scripts/i18n-check.ts`, `scripts/office.sh`, `scripts/remote-setup.ts`, `scripts/remote-mdns.ts`

**Interfaces:**
- Produces: `package.json` scripts còn `dev`, `dev:client`, `build`, `build:client`, `build:server`, `start`, `office`, `typecheck`, `test`, `i18n:check`, `remote:setup`, `remote:mdns`; `devDependencies` bỏ `playwright-core`.

- [ ] **Step 1: Xoá file và script**

`git rm` các file trên; trong `package.json` xoá các script `demo`, `demo:timeline`, `shots:world`, `docker:*`, `usage:*`, `hooks:*`, `mod:*`, `codex:*`, `release` và devDependency `playwright-core`; `npm install` để cập nhật `package-lock.json`.

- [ ] **Step 2: Gỡ "legacy" và statusline khỏi accounts**

Run: `npm run typecheck`
Expected: lỗi chỉ ở `server/accounts/service.ts`, `server/accounts/usage.ts`, `server/index.ts`, `server/config.ts`, `server/team.ts`, `server/test/*`. Xoá từng tham chiếu: nguồn usage Claude qua statusline không còn; `usage.ts` trả `undefined` (không rõ) cho tài khoản Claude thay vì đọc tap. Chạy lại tới sạch.

- [ ] **Step 3: Test "không rõ" thay cho 0%**

Trong test hiện có của `server/accounts/` (tìm `usage` trong `server/accounts/*.test.ts`), thêm hoặc sửa một test: tài khoản Claude không có nguồn usage → `usage` là `undefined`, không phải `{ pct: 0 }`. Nếu thư mục không có test, tạo `server/accounts/usage.test.ts` với đúng một test đó.
Run: `npx vitest run server/accounts`
Expected: PASS.

- [ ] **Step 4: Toàn bộ kiểm và commit**

Run: `npm run typecheck && npx vitest run`
Expected: xanh (số test giảm đúng bằng test đã xoá).
```bash
git add -A && git commit -m "chore(cut): remove release/shot tooling, docker, legacy installers, statusline tap"
```

---

### Task 2: Remote — GIỮ (không làm gì)

Theo yêu cầu deploy web (spec §21), `server/remote/`, `server/http/remote.ts`, `client/src/net/access.ts`, `scripts/remote-setup.ts`, `scripts/remote-mdns.ts` giữ nguyên. Kế hoạch 6 quyết phần nào dùng (token, bind host) và phần nào bỏ (mDNS, TLS tự ký, vì Cloudflare Tunnel làm TLS).

---

### Task 3: Kiểm tra phiên bản và tin mới

**Files:**
- Delete: `server/updates/`, `server/news.ts`, `server/news.test.ts`
- Modify: `server/config.ts` (bỏ `HABBLAUD_UPDATE_CHECK`), `server/index.ts`, `server/http/app.ts`, `server/model/office.ts`, `client/src/net/store.ts`, `client/src/ui/version.ts` (giữ hiện số phiên bản, bỏ "có bản mới"), `client/src/ui/help.ts`, `scripts/office.sh` (bỏ `HABBLAUD_UPDATE_CHECK=0`), `server/board.ts` (chỉ dòng import `news`; file xoá ở Task 10)

- [ ] **Step 1: Xoá và sửa import**

`git rm -r server/updates server/news.ts server/news.test.ts`; `npm run typecheck`; gỡ tham chiếu.

- [ ] **Step 2: Kiểm và commit**

Run: `npm run typecheck && npx vitest run`
```bash
git add -A && git commit -m "chore(cut): remove update checker and news"
```

---

### Task 4: Demo mode

**Files:**
- Delete: `shared/demo/`
- Modify: `server/config.ts` (bỏ `HABBLAUD_DEMO`), `server/http/{stats,terminal,app}.ts`, `server/model/office.ts`, `server/history/daystats.ts` (xoá ở Task 7; sửa tối thiểu), `client/src/net/store.ts` (bỏ nhánh `?mock=1`), `client/src/net/world.ts` và `client/src/ui/timelapse.ts` (xoá ở Task 7/12; sửa tối thiểu), `server/test/fixtures.ts`

- [ ] **Step 1: Kiểm fixture test có dựa vào shared/demo không**

Run: `grep -rl "shared/demo" server client shared --include=*.test.ts --include=fixtures.ts`
Expected: danh sách file. Nếu `server/test/fixtures.ts` hay test nào import dữ liệu mẫu từ `shared/demo`, chép đúng phần dữ liệu đó vào `server/test/fixtures.ts` (giữ test), rồi mới xoá thư mục.

- [ ] **Step 2: Xoá và sửa import**

`git rm -r shared/demo`; `npm run typecheck`; gỡ tham chiếu (`config.demo`, `?mock=1`, route demo trong `terminal.ts`/`stats.ts`).

- [ ] **Step 3: Kiểm và commit**

Run: `npm run typecheck && npx vitest run`
```bash
git add -A && git commit -m "chore(cut): remove demo mode and ?mock=1"
```

---

### Task 5: Codex

**Files:**
- Delete: `server/codex/`, `server/sources/codex/`, `mod/habblaud-codex/`, `server/test/fake-codex.ts`, `server/test/codex-fixtures.ts`, `server/messages/codex.ts`, `server/permissions/codex.ts` (hai file cuối thuộc hệ con Task 8; xoá sớm để typecheck sạch)
- Modify: `server/claude-bin.ts`, `server/index.ts`, `server/team.ts`, `server/host-wait.ts`, `server/config.ts` (bỏ `codex` và `HABBLAUD_CODEX`, dòng 53 và 258), `server/messages/{registry,http}.ts`, `server/http/app.ts`, `server/spawn/{spawn,folders,attachments}.ts`, `server/accounts/{usage,service}.ts`, `server/sources/{source,tail}.ts`, `shared/types.ts` (kind `'codex'`), `shared/locales/vi.ts` (khoá chỉ Codex dùng; `i18n:check` chỉ ra), `client/src/**` nơi typecheck báo

- [ ] **Step 1: Xoá và sửa import**

`git rm -r` các đường dẫn trên; `npm run typecheck`; gỡ tham chiếu. Kind của phiên còn `'claude' | 'agy'`.

- [ ] **Step 2: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove Codex source and bridge"
```

---

### Task 6: Dictation (gộp vào Task 8)

Không có task riêng: `server/dictation/` và `client/src/ui/dictation.ts` chỉ được gọi từ composer, xoá cùng messages ở Task 8.

---

### Task 7: Timelapse và My day

**Files:**
- Delete: `server/http/timeline.ts`, `server/http/timeline.test.ts`, `server/history/timeline.ts`, `server/history/daystats.ts` (+ test của hai file), `shared/timeline.ts`, `shared/timeline.test.ts`, `shared/daystats.ts`, `shared/daystats.test.ts`, `client/src/ui/timelapse.ts`, `client/src/ui/daystats.ts`, `client/src/ui/daystats-launcher.ts`, `client/src/ui/daystats-model.ts`, `client/src/ui/daystats-model.test.ts`, `client/src/net/timeline.ts`, `client/src/world/playback.ts`, `client/src/world/playback.test.ts`
- Modify: `server/index.ts`, `server/config.ts` (bỏ `HABBLAUD_TIMELINE`), `server/http/{sse,stats,app}.ts`, `server/model/office.ts`, `server/sources/{transcript,watcher}.ts` (chỉ chỗ ghi timeline), `server/remote/envfile.ts` (chỉ nếu nhắc `HABBLAUD_TIMELINE`), `client/src/world/{index,api}.ts`, `client/src/world/render/{renderer,overlay}.ts`, `client/src/world/sim/{behavior,sim}.ts` (chỉ chế độ phát lại), `client/src/net/store.ts`, `client/src/ui/spawn.ts`, `client/src/ui/styles.css` (khối `.ui-day*`, `.ui-lapse*`), `scripts/office.sh` (nếu có `HABBLAUD_TIMELINE`)
- Keep: `server/history/` các file còn lại (lịch sử phiên), `server/http/stats.ts` phần thống kê phiên hiện tại (sidebar dùng)

- [ ] **Step 1: Xoá và sửa import**

`git rm` các file trên; `npm run typecheck`; gỡ tham chiếu. Lưu ý `playback` trong `sim/behavior.ts` có thể là phát lại hoạt ảnh, không phải timelapse: chỉ xoá nhánh import từ `world/playback.ts`.

- [ ] **Step 2: Không còn ghi `~/.habblaud/timeline/`**

Run: `grep -rn "timeline" server --include=*.ts | grep -v test`
Expected: không còn kết quả nào trỏ đường dẫn `timeline/` trong data dir.

- [ ] **Step 3: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove timelapse and My day"
```

---

### Task 8: Mod, permissions, messages, deliveries, dictation

**Files:**
- Delete: `mod/` (toàn bộ), `server/permissions/`, `server/messages/`, `server/deliveries/`, `server/dictation/`, `shared/messages.ts`, `shared/answers.ts`, `shared/answers.test.ts`, `server/test/permission-server.ts`, `client/src/ui/permission.ts`, `client/src/ui/permission.test.ts`, `client/src/ui/composer.ts`, `client/src/ui/composer-model.ts`, `client/src/ui/composer-model.test.ts`, `client/src/ui/deliveries.ts`, `client/src/ui/deliveries.test.ts`, `client/src/ui/dictation.ts`
- Modify: `server/index.ts`, `server/http/app.ts` (route `/api/permissions*`, `/api/messages*`, `/api/deliveries*`, `/api/dictation*`), `server/model/office.ts`, `server/sources/terminal.ts` (giữ phát hiện "cần người" qua transcript; bỏ đánh dấu đã trả lời qua mod), `shared/activity.ts`, `shared/types.ts`, `client/src/world/api.ts`, `client/src/world/render/overlay.ts` (bong bóng tin nhắn/permission), `client/src/net/store.ts`, `client/src/ui/{index,session-controls,drawer,terminal}.ts`, `client/src/ui/styles.css` (khối composer/permission/deliveries)

**Interfaces:**
- Produces: trạng thái "needs you" của phiên vẫn có trong `OfficeAgent.status` (nguồn: transcript, `server/sources/terminal.ts`); không còn `/api/permissions`, `/api/messages`.

- [ ] **Step 1: Xoá và sửa import**

`git rm -r` các đường dẫn; `npm run typecheck`; gỡ tham chiếu. Composer (ô gõ tin trong drawer) biến mất; nút trong `session-controls.ts` còn: mở terminal, tiếp quản, kết thúc.

- [ ] **Step 2: Test "needs you" còn hoạt động**

Run: `npx vitest run server/sources/terminal`
Expected: test hiện có của phát hiện "cần người" PASS mà không cần fixture permission.

- [ ] **Step 3: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove Claude mods, permissions, messages, deliveries, dictation"
```

---

### Task 9: Nội quy (rules engine)

**Files:**
- Delete: `shared/rules.ts`, `shared/rules.test.ts`, `shared/rules.vectors.json`, `server/rules-log.ts`, `server/rules-log.test.ts`, `client/src/ui/rules-dialog.ts`, `client/src/ui/rules-model.ts`, `client/src/ui/rules-model.test.ts`, `client/src/world/render/rules-board.ts`, `tools/agy/bin/office_rules.py`, `tools/agy/bin/rules-hook`, `tools/agy/bin/__pycache__/`, `tools/agy/agy-plugin/office-rules/`, `tools/agy/skills/office-rules/`, `tools/agy/tests/test_office_rules.py`, `tools/agy/worker-rules/`
- Modify: `server/team.ts` (bỏ rules/proposals/limits/rev), `server/index.ts`, `server/http/app.ts` (`/api/rules*`), `shared/types.ts`, `client/src/ui/{index,office-menu,office-tabs,workers-api}.ts`, `client/src/world/render/renderer.ts` (bỏ vẽ 📜), `client/src/ui/styles.css` (khối rules), `tools/agy/bin/worker-ask` (bỏ subcommand `rules`, hàm `apply_rules` dòng 472–492 và lời gọi, import module rules, env `AGY_OFFICE`/`AGY_WORKER` cho rules-hook ở `headless_agy`), `tools/agy/tests/test_worker_ask.py`, `tools/agy/install.sh` (còn link bin + skill agy-orchestrator; bỏ vòng `for p in "$root"/acc*/`), `tools/agy/README.md`, `tools/agy/skills/agy-orchestrator/SKILL.md` (bỏ đoạn nội quy), `server/workers/service.ts` chỉ nếu typecheck báo

**Interfaces:**
- Produces: `worker-ask` gửi prompt nguyên văn (không ghép gì); Kế hoạch 4 thay bằng lời mở đầu.

- [ ] **Step 1: Pytest đỏ cho lệnh cũ**

Thêm vào `tools/agy/tests/test_worker_ask.py`, dùng fixture chạy CLI mà file đang dùng:
```python
def test_rules_subcommand_is_gone(run_cli):
    r = run_cli("agy-ask", "rules", "show")
    assert r.returncode == 1
    assert "rules" in r.stderr.lower()
```
Run: `cd tools/agy && python3 -m pytest -q tests/test_worker_ask.py -k rules_subcommand`
Expected: FAIL (lệnh hiện còn hoạt động).

- [ ] **Step 2: Xoá và sửa**

`git rm -r` các đường dẫn; sửa `worker-ask`: xoá subcommand `rules` (usage dòng đầu bỏ phần `rules`), `apply_rules` và lời gọi, import module rules; lệnh con lạ → `die("unknown subcommand: rules (office rules were removed)")` exit 1. Xoá test cũ của `test_worker_ask.py` có kiểm rules. `npm run typecheck`; gỡ tham chiếu TypeScript.

- [ ] **Step 3: Kiểm**

Run: `npm run typecheck && npx vitest run && npm run i18n:check && (cd tools/agy && python3 -m pytest -q tests)`
Expected: xanh; test mới PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(cut): remove office rules engine (shared, server, client, agy tools)"
```

---

### Task 10: Board và HANDOFF.md

**Files:**
- Delete: `server/board.ts`, `server/board.test.ts`, `server/sources/handoff.ts`, `server/sources/handoff.test.ts`, `client/src/ui/board-model.ts`, `client/src/ui/board-model.test.ts`, `client/src/ui/job-board.ts`
- Modify: `server/index.ts`, `server/http/app.ts` (`/api/board*`), `server/model/office.ts`, `server/world/client.ts` (xoá ở Task 12; sửa tối thiểu), `client/src/world/layout/{room,types}.ts` (giữ đồ vật bảng trắng, bỏ dữ liệu "next steps"), `client/src/world/render/{renderer,overlay,scene}.ts`, `client/src/world/sim/sim.ts`, `client/src/world/visit/index.ts` (xoá ở Task 12; sửa tối thiểu), `client/src/ui/index.ts` (tab Board), `client/src/ui/styles.css` (khối board)

- [ ] **Step 1: Xoá và sửa import**

`git rm` các file; `npm run typecheck`; gỡ tham chiếu. Bảng trắng trong phòng vẫn vẽ (đồ vật), không còn chữ từ HANDOFF.md.

- [ ] **Step 2: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove Board tab and HANDOFF.md source"
```

---

### Task 11: Social sim và coins

**Files:**
- Delete: `client/src/world/social/`, `client/src/ui/social.ts`, `client/src/world/visit-social.ts`, `client/src/world/visit-social.css`, `client/src/world/visit-social.test.ts`, `client/src/ui/world/social.css`, `client/src/ui/world/social.test.ts`, `server/world/social.ts`
- Modify: `client/src/world/{index,sound-cues,debug}.ts`, `client/src/world/render/renderer.ts`, `client/src/world/city/*` (xoá ở Task 12; sửa tối thiểu), `server/index.ts`, `server/world/{service,http,client,uplink}.ts` (xoá ở Task 12; sửa tối thiểu), `client/src/ui/styles.css` (khối `.ui-social`)

- [ ] **Step 1: Xoá và sửa import**

`git rm -r` các đường dẫn; `npm run typecheck`; gỡ tham chiếu. Nhân vật vẫn đi lại, ngồi, uống cà phê (`sim/behavior.ts`); không còn tụ tập, nói chuyện, ví tiền.

- [ ] **Step 2: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove social simulation and coins"
```

---

### Task 12: Habblaud World

**Files:**
- Move: `shared/world/appearance-flat.ts` → `client/src/art/character/appearance-flat.ts`; `shared/world/appearance-flat.test.ts` → `client/src/art/character/appearance-flat.test.ts`
- Delete: `client/src/world/city/`, `client/src/world/visit/`, `client/src/ui/world/`, `server/world/`, `shared/world/` (sau khi move), `client/src/net/world.ts`, `client/src/net/world-stream.ts`, `server/test/fake-world.ts`, `client/src/world/seasonal-world.test.ts`
- Modify: `client/src/art/character/appearance.ts` (import mới), `server/index.ts`, `server/config.ts` (bỏ `HABBLAUD_WORLD` và mọi `world.*`), `server/build.ts` (+ test; chỉ phần world), `server/http/app.ts` (`/api/world*`), `server/model/office.ts`, `server/remote/*.ts` (chỉ nếu nhắc World), `client/src/app.ts`, `client/src/world/debug.ts`, `client/src/ui/{index,settings,topbar,hovertip,drawer,viewport,feed,context,sound}.ts`, `shared/types.ts`, `client/src/ui/styles.css` (khối `.ui-world`, `.ui-visit`, `.ui-city`), `scripts/office.sh` (bỏ `HABBLAUD_WORLD=0`), `CLAUDE.md` (xoá mục "NOTICE — Habblaud World"), `shared/locales/vi.ts` (`i18n:check`)

**Interfaces:**
- Produces: `appearanceFromSeed` và các export của `appearance-flat` vẫn đi qua `client/src/art` với tên cũ.

- [ ] **Step 1: Move appearance-flat và chạy test của nó**

`git mv` hai file; sửa import trong `client/src/art/character/appearance.ts` và trong file test đã move.
Run: `npx vitest run client/src/art/character/appearance-flat`
Expected: PASS.

- [ ] **Step 2: Xoá World và sửa import**

`git rm -r` các đường dẫn; `npm run typecheck`; gỡ tham chiếu: nút World/city trên topbar, cài đặt World, bong bóng khách thăm trong hovertip/drawer/feed, âm thanh World trong `sound.ts`, model `office.ts` không còn gửi gói World.

- [ ] **Step 3: Test 404 cho route đã bỏ (Review Focus 2)**

Trong `server/http/http.test.ts` thêm, dùng server thử/fixture mà file đang dùng:
```ts
it('answers 404 for removed APIs', async () => {
  for (const p of ['/api/world', '/api/timeline', '/api/permissions', '/api/rules', '/api/board']) {
    const r = await fetch(`${base}${p}`);
    expect(r.status, p).toBe(404);
  }
});
```
Run: `npx vitest run server/http/http.test.ts`
Expected: PASS.

- [ ] **Step 4: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check`
```bash
git add -A && git commit -m "chore(cut): remove Habblaud World (city, visits, uplink); keep appearance-flat in art"
```

---

### Task 13: Theme mùa

**Files:**
- Delete: `client/src/art/seasonal.ts`, `client/src/art/seasonal.test.ts`, `client/src/world/render/seasonal.ts`
- Modify: `client/src/art/api.ts` (bỏ `SeasonalProp`, `renderSeasonalProp`), `client/src/world/{index,api}.ts`, `client/src/world/render/{scene,renderer}.ts`, `client/src/ui/settings.ts` (bỏ chọn mùa nếu có), `client/src/world/theme.test.ts` (chỉ phần mùa)
- Keep: `client/src/art/theme.ts` (`THEME_COUNT`, `roomTheme`: bảng màu phòng)

- [ ] **Step 1: Xoá và sửa import**

`git rm` các file; `npm run typecheck`; gỡ tham chiếu. Không còn trang trí theo ngày tháng.

- [ ] **Step 2: Kiểm và commit**

Run: `npm run typecheck && npx vitest run`
```bash
git add -A && git commit -m "chore(cut): remove seasonal decorations"
```

---

### Task 14: Công cụ agy thừa

**Files:**
- Delete: `tools/agy/bin/agy-up`, `tools/agy/bin/agy-mode`, `tools/agy/bin/agy-sync`, `tools/agy/agy-plugin/` (còn lại `agy-boss`), `tools/agy/boss/` (chuyển `AGENTS.md` của boss vào `docs/boss-rules-from-fork.md` nếu có nội dung Kế hoạch 4 dùng được)
- Modify: `tools/agy/bin/agy-as` (xoá dòng 12–16 ghi plugin `agy-boss` vào profile khi `AGY_BOSS=1`), `tools/agy/bin/worker-ask` (bỏ đường herdr nếu có), `tools/agy/skills/agy-orchestrator/SKILL.md` (bỏ nửa herdr, còn ≤60 dòng về `agy-ask`/`claude-ask`), `tools/agy/README.md`, `tools/agy/install.sh` (còn: link `agy-as`, `worker-ask`→`agy-ask`, `claude-ask`→`agy-ask`, skill `agy-orchestrator`), `server/sources/agy/*.ts` và `server/config.ts` nơi có `herdr`/`HERDR_MS`

- [ ] **Step 1: Xoá và sửa**

Run: `grep -rln -i "herdr\|roles.conf\|agy-up\|agy-mode\|agy-sync" server client tools --include=*.ts --include=*.py --include=*.md --include=*.sh`
Xoá từng tham chiếu; `roles.conf` không còn được đọc; `names.conf` giữ (Kế hoạch 2 thay bằng tên ghế).

- [ ] **Step 2: Kiểm**

Run: `npm run typecheck && npx vitest run && (cd tools/agy && python3 -m pytest -q tests) && bash -n tools/agy/bin/agy-as && bash -n tools/agy/install.sh`
Expected: xanh.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(cut): remove herdr, agy-up/mode/sync, agy-boss plugin writing"
```

---

### Task 15: i18n, CSS chết, tài liệu

**Files:**
- Modify: `shared/locales/vi.ts`, `client/src/ui/styles.css`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md` (gốc repo), `server/README.md`, `tools/agy/README.md`, `scripts/i18n-check.ts` (chỉ nếu cần nhánh `--unused`)

- [ ] **Step 1: Tỉa vi.ts**

Run: `npm run i18n:check`
Expected: báo các khoá không còn dùng. Nếu script chỉ báo thiếu, thêm nhánh `--unused` (≈15 dòng) in các khoá của `VI` không xuất hiện trong `tr('…')` của `client server shared`. Xoá các khoá thừa. Chạy lại: xanh.

- [ ] **Step 2: CSS chết**

Run: `grep -o "\.ui-[a-z-]*" client/src/ui/styles.css | sort -u > /tmp/css-classes; for c in $(cat /tmp/css-classes); do grep -rq "${c#.}" client/src --include=*.ts || echo "$c"; done`
Xoá các khối CSS của class không còn trong TypeScript.

- [ ] **Step 3: Tài liệu**

`CLAUDE.md`: một đoạn mô tả Bang_ver (một office, boss và ghế, không mod, không World), bỏ mục NOTICE World. `README.md`: giữ cài đặt `npm install && npm run build && npm run office`, xoá mục World/Codex/Docker/mod/timelapse; mục remote giữ với ghi chú "xem Kế hoạch 6". `CHANGELOG.md` mục "Unreleased": một dòng tiếng Anh cho mỗi hệ con đã bỏ (Task 1–14).

- [ ] **Step 4: Kiểm và commit**

Run: `npm run typecheck && npx vitest run && npm run i18n:check && npm run build`
```bash
git add -A && git commit -m "chore(cut): prune unused locale keys and CSS; update docs for Bang_ver"
```

---

### Task 16: Kiểm nghiệm cuối của Kế hoạch 1

**Files:**
- Modify: cuối file này, mục `## Kết quả`

- [ ] **Step 1: Đếm**

Run: `git diff --stat vi/main..HEAD | tail -1; find server client shared tools -name '*.ts' -o -name '*.py' -o -name '*.css' | grep -v node_modules | xargs cat | wc -l`
Expected: tổng dòng còn ≈37–42k (remote giữ thêm ≈0,7k). Ghi con số.

- [ ] **Step 2: Chạy server thật với dữ liệu cũ (Review Focus 1, 4)**

Run: `HABBLAUD_WORLD=0 HABBLAUD_TIMELINE=0 HABBLAUD_CODEX=0 npm run office` rồi `sleep 5; tail -20 ~/.habblaud/office.log; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4747/`
Expected: log không có stack trace; HTTP 200; `~/.agy_profiles/team.json` hiện có (dạng `offices[]`, 7 worker) được đọc và 7 nhân vật agy hiện trong state như trước; không có thư mục `~/.habblaud/timeline/` mới (so `ls -la ~/.habblaud` trước/sau).

- [ ] **Step 3: Ảnh chụp**

Run: `node -e "const {chromium}=require('/home/nhatbang/Agent_4_me/Agent_Hub/Vi-Habblaud/node_modules/playwright-core');(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/google-chrome'});const p=await b.newPage({viewport:{width:1400,height:900}});const errs=[];p.on('pageerror',e=>errs.push(String(e)));await p.goto('http://127.0.0.1:4747/');await p.waitForTimeout(4000);await p.screenshot({path:'docs/superpowers/plans/plan1-office.png'});console.log('pageerrors',errs);await b.close();})()"`
Expected: ảnh có office với nhân vật agy; không có tab World/Board/My day; `pageerrors []`.

- [ ] **Step 4: Việc headless vẫn chạy**

Run: `tools/agy/bin/worker-ask acc1 "Trả lời đúng một dòng: OK" --mode plan --timeout 120`
Expected: in `OK`, exit 0 (đường headless của Bang_ver; đường office kiểm ở Kế hoạch 2).

- [ ] **Step 5: Dừng, ghi kết quả, commit**

Run: `sh scripts/office.sh stop` (nếu script không có `stop`: `pkill -f 'dist/server/index.js'`).
Ghi vào cuối file này mục `## Kết quả`: số dòng, số test, RSS server (`ps -o rss= -p <pid>` trước khi dừng), danh sách hệ con đã bỏ.
```bash
git add -A && git commit -m "docs: plan 1 results (lines, tests, RSS)"
```

---

## Tự kiểm sau khi viết

- Spec §16 bảng cắt: World 12, Timelapse 7, Codex 5, mod/perm/msg/deliv 8, installer/docker/release 1, social 11, theme mùa 13, dictation 8, update 3, demo 4, nội quy 9, Board 10, herdr/agy-up 14. Remote: giữ theo §21 (Task 2 ghi rõ). "Nhiều office", "team rule", `names.conf`: Kế hoạch 2. `install.sh`/link `~/.local/bin`: Kế hoạch 3.
- Mỗi task kết thúc bằng typecheck + vitest + commit; test mới ở Task 1 (usage undefined), 9 (pytest rules gone), 12 (404 routes).
- Thứ tự theo điểm import tăng dần như spec; file "sửa tối thiểu rồi xoá ở task sau" được nêu rõ.

## Kết quả

Chạy ngày 2026-11-04 trên HEAD 872170f (nhánh `bang-ver`).

- **Số dòng** (`find server client shared tools -name '*.ts' -o -name '*.py' -o -name '*.css' | grep -v node_modules | xargs cat | wc -l`): **74.979** (server 23,1k, client 47,4k, shared 4,2k, tools 0,3k; test ≈15,7k, `styles.css` 6,6k). Upstream Vi-Habblaud (`vi/main`) là 149.415 dòng, tức giảm khoảng 50%. `git diff --stat vi/main..HEAD`: 462 files changed, 2592 insertions(+), 85519 deletions(-). Ước tính ban đầu "≈37–42k" trong kế hoạch là sai; con số thật ở trên.
- **Số test**: vitest 953 passed, 1 failed (954; 80/81 file) — lỗi duy nhất là `server/sources/tail.test.ts > FileTail > detects replaced file (rotation) even if larger`, test flaky đã biết. pytest `tools/agy`: 20 passed.
- **RSS server**: 104.636 kB sau khi khởi động 5 giây (pid 440568), 108.576 kB ngay trước khi dừng (≈106 MB), sau khi chụp ảnh và chạy worker-ask.
- **Chạy thật**: `HABBLAUD_WORLD=0 HABBLAUD_TIMELINE=0 HABBLAUD_CODEX=0 npm run office` → HTTP 200, log không có stack trace, `/api/snapshot` có 7 agent agy từ `~/.agy_profiles/team.json` (1 office, 7 worker), không có file mới trong `~/.habblaud/timeline/`. Ảnh: `docs/superpowers/plans/plan1-office.png` (office, không có tab World/Board/My day, `pageerrors []`). `tools/agy/bin/worker-ask acc1 "Trả lời đúng một dòng: OK" --mode plan --timeout 120` in `OK`, exit 0.
- **Hệ con đã bỏ** (số task): release tooling/docker/installer cũ/statusline tap (1); update checker + news (3); demo mode (4); Codex (5); timelapse + My day (7); Claude mods/permissions/messages/deliveries/dictation (8); office rules engine (9); Board + HANDOFF.md (10); social simulation + coins + âm thanh Hangouts (11); Habblaud World (12); trang trí theo mùa (13); herdr/agy-up/mode/sync/roles.conf (14). Giữ lại: remote (Task 2, cho Kế hoạch 6).
