# Go-live runbook: hub.finstar.pp.ua

Run nothing in this file until the owner says go. Every step changes this machine or the public internet.

The files in `deploy/` are templates; nothing in the repo installs them. The Cloudflare token (for DNS/tunnel
changes) is held only by the owner; no command here reads `Bang_ver/.env`.

## What this exposes (read first)

- Level (a): the phone sees the office, feed and drawer, and a **read-only** terminal. The interactive PTY, `/api/advisor`,
  `/api/workers/*`, `/api/team`, `/api/pty` and `/api/spawn` answer 403 on the remote port.
- `--behind-proxy` defaults to `HABBLAUD_REMOTE_ALLOW=terminal`: anyone who signs in can **read session transcripts
  (commands, files, prompts) over the Internet**. For office-only view use `--allow none` in step 2.
- Losing the passkey or the password means someone reads the machine's agent activity. Keep passkey-only sign-in.
- After step 2 is (re)run, the hub domain is accepted only on the remote port (4748) and port 4747 refuses it (403), so a
  tunnel pointed at 4747 by mistake exposes nothing. An older `hub.env` may still list the domain in
  `HABBLAUD_ALLOWED_HOSTS`: step 2 removes it, and the server warns at start if it is there. Step 3 checks this.
- The session cookie is `__Host-habblaud_remote` (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain): `pp.ua` is a
  public suffix, and `__Host-` stops a sibling subdomain from overwriting it. Old plain-named cookies are not used.
- cloudflared must send `CF-Connecting-IP` (it does by default). Without it every visitor shares one IP and the
  per-IP limit (5 failures in 10 minutes) becomes a global lock.
- Consider a Cloudflare WAF rate-limiting rule on `hub.finstar.pp.ua` (for example on `POST /api/remote/*`) as a
  second layer; it is outside this repo.

## 1. Preconditions

```bash
cd ~/Agent_4_me/Agent_Hub/Bang_ver
git branch --show-current            # the branch is merged into the one you deploy from
npm test                             # green (known flaky tests excepted)
git status --short                   # clean; no .env staged
```

## 2. Remote settings

```bash
npm run remote:setup -- --behind-proxy --domain hub.finstar.pp.ua --user nhatbang   # add --allow none for view only
stat -c %a ~/.habblaud/hub.env       # 600
```

You type the password. It is stored only as a scrypt hash in `~/.habblaud/hub.env`.

## 3. Office as a service

```bash
npm run build
npm run office -- stop
mkdir -p ~/.config/systemd/user && cp deploy/bang-hub.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now bang-hub
ss -Hltnp '( sport = :4747 or sport = :4748 )'      # both on 127.0.0.1
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: hub.finstar.pp.ua' http://127.0.0.1:4748/login   # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: hub.finstar.pp.ua' http://127.0.0.1:4747/        # 403 (main port must refuse the hub name)
journalctl --user -u bang-hub | grep -E 'Interactive terminal|Terminal tương tác'   # must say it is on (else claude/agy are not on the unit's PATH)
```

The unit's `ExecStart` has an absolute node path (`~/.nvm/versions/node/v25.7.0/bin/node`) and `Environment=PATH=` starts
with the same directory, then `~/.local/bin` (where `agy` lives; `claude` comes from the nvm node bin). **When node is upgraded, edit both lines**
(a repo test checks they agree) and `systemctl --user daemon-reload && systemctl --user restart bang-hub`. `MemoryMax` is
deliberately absent: the cgroup includes the boss and seat processes.
To survive logout/reboot the user manager must linger: `loginctl enable-linger $USER`.

## 4. Tunnel and DNS

The `cloudflared` subcommands and flags below were written from memory and have **not** been run or checked against the
installed version: check each with `cloudflared tunnel --help` before running it. Done by the owner, with the Cloudflare login/token held only by the owner (`cloudflared tunnel login`, or the
dashboard for the DNS step).

```bash
cloudflared tunnel create bang-hub
ID=$(cloudflared tunnel list --name bang-hub --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')
mkdir -p ~/.config/bang-hub && sed "s/<TUNNEL_ID>/$ID/g" deploy/cloudflared.yml.example > ~/.config/bang-hub/cloudflared.yml
cloudflared tunnel --config ~/.config/bang-hub/cloudflared.yml ingress validate
cloudflared tunnel route dns bang-hub hub.finstar.pp.ua      # CNAME `hub` -> <ID>.cfargotunnel.com
cp deploy/bang-hub-cloudflared.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now bang-hub-cloudflared
```

Equivalent through the Cloudflare API: create a proxied CNAME `hub` pointing at `<ID>.cfargotunnel.com` with a token
scoped to DNS edit on this zone. Do not paste that token into any file in the repo.

## 5. First passkey

1. Open `https://hub.finstar.pp.ua`, sign in with the password.
2. Settings, Passkeys, Manage, Add a passkey (the browser asks for a fingerprint/PIN).
3. Sign out, then sign in with the passkey (passwordless).
4. A password-only sign-in now answers "Password sign-in is off...".

## 6. Acceptance

| # | Command / action | Expect |
|---|---|---|
| 1 | `curl -sI https://hub.finstar.pp.ua/` ; `curl -sI -H 'Host: khac.example' http://127.0.0.1:4748/` | login page / 302 to `/login`; second is refused (403) |
| 2 | 5 wrong passwords in a row (before the first passkey, or with `HABBLAUD_REMOTE_PASSWORD_LOGIN=1`) | 6th gives 429; a correct one sets `__Host-habblaud_remote; Secure; HttpOnly; SameSite=Lax`. Level (a): office characters show; a seat's terminal is read-only and keeps updating for 3+ minutes of silence (SSE through Cloudflare); typing is impossible |
| 2b | `systemctl --user restart bang-hub bang-hub-cloudflared` | site back within 60 s, nobody types anything |
| 3 | Register a passkey, sign out, sign in with it | works; password-only refused |
| 4 | `systemctl --user stop bang-hub-cloudflared` then `start` | site gone / back; `http://127.0.0.1:4747` keeps working |
| 5 | `systemctl --user restart bang-hub` | the cookie still works; passkey still listed |
| 6 | `ss -Hltnp '( sport = :4747 or sport = :4748 )'`; `git status --short \| grep -c '\.env'`; `stat -c %a ~/.habblaud/remote/passkeys.json` | both `127.0.0.1`; `0`; `600` |
| 7 | Open `/login` at 390 px width; with reduced motion on | no horizontal scroll; no animation |

Logs: `journalctl --user -u bang-hub -f` (sign-ins are logged with IP and user agent).

## 7. Rollback

```bash
systemctl --user disable --now bang-hub-cloudflared      # site off; 4747 untouched
# Owner: delete the `hub` DNS record in the Cloudflare dashboard (`route dns` cannot delete), then:
cloudflared tunnel delete bang-hub
systemctl --user disable --now bang-hub && npm run office    # back to the plain local office
```

## 8. Lost passkey or phone

At the computer. **Stop the service first**: the server keeps passkeys in RAM and may rewrite the file.

```bash
systemctl --user stop bang-hub
npm run remote:setup -- --reset-passkeys
systemctl --user start bang-hub
```

Or add `HABBLAUD_REMOTE_PASSWORD_LOGIN=1` to `~/.habblaud/hub.env` and restart, to allow the password again.

Two things to know:

- **Deleting passkeys does not sign anyone out.** `--reset-passkeys` and "Remove" on the Passkeys page leave every
  7-day session cookie valid, including the one on a lost phone. To end all sessions, change the signing key: rerun
  `npm run remote:setup -- --behind-proxy --domain hub.finstar.pp.ua --user nhatbang` (it asks for the password; the new
  hash changes the key; do it with the service stopped, then start it), or stop the service, delete
  `~/.habblaud/remote-secret` (a new one is created at start) and start it.
- **Deleting the last passkey silently turns password sign-in back on** (it is off only while a passkey exists). If the
  password may be known to anyone else, change it (the same `remote:setup` command) at once: password sign-in works again immediately, on the next request, without a restart.
