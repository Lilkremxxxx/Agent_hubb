---
name: agy-orchestrator
description: Give jobs to worker agents with `agy-ask` (Antigravity accounts acc1..acc6) and `claude-ask` (Claude Code accounts), within the team the user set in Habblaud. Use when the user asks to delegate/giao việc/chia việc to other agents, check what a worker returned, or run work in parallel across accounts.
---

# agy orchestrator

Workers are Antigravity accounts (one Google account per profile, `~/.agy_profiles/accN`) and Claude Code accounts. Hard work stays with you; workers get heavy-but-routine work (bulk edits, reading many files, tests from a spec, searching). Trivial one-liners: do them yourself.

## Golden rule: never run bare `agy`
A bare `agy` uses the machine's real account and can mix tokens. Always go through `agy-ask` / `claude-ask` (or `agy-as accN` for a one-off): each account gets its own HOME, D-Bus session and keyring.

## Giving jobs
```bash
agy-ask acc2 "<prompt>" --role <label> --mode <plan|accept-edits|default> --effort <low|medium|high> [--cwd DIR] [--max 2000] [--timeout 900]
claude-ask .claude-work "<prompt>" --role <label> --mode <default|plan|accept-edits> --effort <low..max> [--model sonnet] [--full] [--cwd DIR] [--max 2000] [--timeout 900]
```
Both print only the worker's final answer (capped at `--max` chars). A Claude Code worker is named by its account (`.claude-work`, `claude:.claude-work` or `work`); it is far more expensive than an Antigravity one, so give it only what Flash cannot do well. Each call blocks until done (30s-3min): run it with `run_in_background`, several in parallel on different workers.

- With the office running (Habblaud) the job goes into the worker's own terminal as a fresh conversation; never read or type into a worker's terminal. Without it the job runs headless (`agy -p` / `claude -p`): same answer, same exit codes.
- Killing the command cancels the job; `--timeout` (seconds) cancels it too and exits 1.
- Always pass `--role` (a short label: `impl`, `qa`, `review`...), `--mode`, `--effort` and `--cwd`. `--cwd` must be the folder the worker writes to.
- Claude workers start lean (no MCP, skills or slash commands); pass `--full` only when the job needs them. A job costs ~8k tokens of start-up on the worker's account: delegate jobs that read a lot, do tiny lookups yourself.

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | done, answer printed | check it, use it |
| 1 | failed / timeout / error | read the message; retry once or do it yourself |
| 2 | refused by the team rule | do not retry, do not work around it |
| 3 | BUSY: the worker is on another job | ask again later, or use another worker |
| 4 | the user cancelled the job | do not resend it unasked; tell the user |

## Team rule
The user sets up offices in Habblaud (`~/.agy_profiles/team.json`): one team per project folder, with a boss and workers. Run `agy-ask team` before delegating: it lists every office and marks yours (`<- you are its boss`). A boss gives jobs only to its office's workers, never to its own account. If you are not a boss, do the work yourself or tell the user. Never set `AGY_ASK_FROM_OFFICE` or `AGY_OFFICE`.

## Mode and effort (you choose per job)
Antigravity workers run Gemini 3.8 Flash only: never pass `--model`.

| Job | `--mode` | `--effort` |
| --- | --- | --- |
| Lookup in named files, grep/count, format conversion | `plan` (read) or `accept-edits` (writes) | `low` |
| Summarise files, code or tests from a clear spec, bulk edits | `plan` / `accept-edits` | `medium` |
| Review, audit, debugging, multi-file plans | `plan` | `high` |
| Data inside the prompt (plan mode would draft a plan instead) | `default` | `low`/`medium` |

`plan` is read-only; `accept-edits` may edit files in `--cwd`; `auto` is not available on these accounts.

## Pitfalls
- Preflight an account before real work: `agy-ask accN "Run: echo ok && pwd" --mode accept-edits --cwd DIR --max 200`. A missing `permissions.allow` in its settings makes the worker exit at once with `auto-denied`; give the user the fix, do not edit those settings yourself.
- Never let two workers edit the same file; have each write its own fragment and merge yourself.
- Verify judgement-heavy output: Flash over-claims on audits. Re-check every high finding before reporting.
- Name exact files or paste the snippet in the prompt so the worker does not explore (steps, not mode, drive cost).
- Write prompts in English and self-contained: goal, files, limits, definition of done, "reply briefly". Files meant for people go in the user's language.
