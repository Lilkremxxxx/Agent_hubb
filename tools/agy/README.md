# Worker scripts for the office

The office shows a boss and its seats; these scripts are how anyone gives the seats jobs. `agy-ask` and `claude-ask` send a
job to an Antigravity (`agy`) or Claude Code account and print only the final answer, so the boss spends no tokens on a
worker's reasoning. Every job is a new conversation.

Needs Linux, Python 3, Claude Code, and for Antigravity workers the `agy` CLI, `dbus-daemon` and `gnome-keyring-daemon`.

## Install

```bash
npm install
tools/install.sh
npm run office         # builds and starts it in the background: open http://127.0.0.1:4747
```

It links everything from this folder into `~/.local/bin` and the Claude Code skills, so editing a file
here changes the installed one. Then, once per Antigravity account:

```bash
mkdir -p ~/.agy_profiles/acc1
agy-as acc1        # sign in with Google when asked
```

Never run a bare `agy`: it uses the machine's own account. Profiles hold sign-in tokens: keep `~/.agy_profiles` out of
any repository.

## What is here

| Path | What it does |
|---|---|
| `bin/agy-as` | Runs `agy` in one account's profile (own HOME, D-Bus, keyring) |
| `bin/worker-ask` | `agy-ask` and `claude-ask`: give a job, print its answer |
| `agy-plugin/` | `agy-boss`. Nothing installs it now; `docs/boss-rules-from-fork.md` is the reference kept for a later plan |

## Using it

```bash
agy-ask team    # the office folder, the boss and the seats
agy-ask W2 "<prompt>" --role impl --mode accept-edits --effort medium
claude-ask C1 "<prompt>" --role review --mode plan --effort high --cwd <project> --lean
```

The first argument is a seat name from `team.json` (`~/.habblaud/team.json`, or `$HABBLAUD_DATA_DIR/team.json`); the seat
says which agent runs (`agy-ask` and `claude-ask` are the same command). Anyone may give jobs. The job runs in the office
folder, or in `--cwd`. Claude seats run full; `--lean` starts them light (no MCP, skills or slash commands).

With the office running the job goes to the seat's terminal, which you can watch; otherwise it runs headless (with
`BANG_SLOT` and `BANG_OFFICE` set). Exit codes: 0 done, 1 failed, timed out, unknown seat or no folder, 2 refused by the
office, 3 seat busy, 4 cancelled from the office.

## Tests

```bash
python3 -m pytest tools/agy/tests
```
