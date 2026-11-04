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

It links `worker-ask` (also as `agy-ask`, `claude-ask`), `agy-as` and `bang-init` from this folder into
`~/.local/bin`, so editing a file here changes the installed one. It never replaces a real file, removes what an old
Vi-Habblaud install left behind, and a second run changes nothing. `tools/install.sh --worker` also links the skills
into `~/.claude-worker/skills` for the Claude seats and prints the login command to run once. To make a project
folder an office, run `bang-init <folder>` (see the README). Then, once per Antigravity account (and, in each office
folder, trust it once: `cd <folder> && agy-as accN`, answer yes, `/exit`; trust is per account AND per folder):

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
| `bin/bang-init` | Prepares a project folder: board templates, `.agents/skills.json`, skill links, `folder` in `team.json` |
| `bin/skill-dirs` | Lists the skill folders under a home (own skills, each plugin's newest version that has `skills/`): used by `bang-init` and `install.sh --worker` |
| `bin/worker-ask` | `agy-ask` and `claude-ask`: give a job, print its answer |
| `bin/advisor` | Run by a seat inside a job: asks the office's boss, prints its answer (exit 2-5: no boss, boss waiting, timeout, untagged) |
| `agy-plugin/` | `agy-boss`. Nothing installs it now; `docs/boss-rules-from-fork.md` is the reference kept for a later plan |

## Using it

```bash
agy-ask team    # the office folder, the boss and the seats
agy-ask W2 "<prompt>" --raw --role impl --mode accept-edits --effort medium
claude-ask C1 "<prompt>" --raw --role review --mode plan --effort high --cwd <project> --lean
```

**Modes.** On this host, in `auto` file tools run without asking, shell commands may prompt in the seat's terminal, and the user approves them on the page. Prefer file tools over shell commands for agy seats.

The first argument is a seat name from `team.json` (`~/.habblaud/team.json`, or `$HABBLAUD_DATA_DIR/team.json`); the seat
says which agent runs (`agy-ask` and `claude-ask` are the same command). Anyone may give jobs. The job runs in the office
folder, or in `--cwd`. Claude seats run full; `--lean` starts them light (no MCP, skills or slash commands).

A job for project work is written in the 6 parts of the `giao-viec` skill; `worker-ask` refuses one without them (`--raw`
skips the check; the examples above use it for short jobs). Every job starts with the seat's preamble and the "Bài học"
lines of `task_board.md`.

With the office running the job goes to the seat's terminal, which you can watch; otherwise it runs headless (with
`BANG_SLOT` and `BANG_OFFICE` set). Exit codes: 0 done, 1 failed, timed out, unknown seat or no folder, missing headings, over 100,000 bytes, an empty prompt, a prompt starting with `--` or an empty answer (the job may be done: check the review criteria before resending; headless usually means the seat could not run a command), 2 refused by the
office, 3 seat busy, 4 cancelled from the office.

## Tests

```bash
python3 -m pytest tools/agy/tests
```
