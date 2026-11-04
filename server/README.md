# Bang_ver server

Pure Node (no runtime dependencies). Observes **open** Claude Code sessions across all accounts on the machine,
maintains the office model, and streams everything via SSE.

```
npm run dev      # server + Vite (middleware, HMR) at http://127.0.0.1:4747
npm run build && npm start   # production: serves dist/client
```

## Data sources (read-only)

| What | Where |
| --- | --- |
| Open sessions and status (busy/idle/waiting) | `<config>/sessions/<pid>.json` (+ live PID) |
| Activities, tasks, title, counts | `<config>/projects/<cwd>/<sessionId>.jsonl` (reads last ~1 MB on boot; start in background) |
| Subagents (including workflows) | `<config>/projects/<cwd>/<sessionId>/subagents/**/agent-*.jsonl` + `.meta.json` |
| Account (email, organization) and usage cache | `~/.claude.json` (default account) or `<config>/.claude.json` — only these fields |
| Account shortcut (`c`, `d`...) | `alias x='... claude ...'` lines from `~/.zshrc`, `~/.bashrc`, `~/.zprofile`, `~/.bash_profile` |

**Forks** (subagents inheriting parent context): the transcript begins with a `fork-context-ref` line, the copy of the
parent `Agent` call (same `tool_use` id as `.meta.json`) and its result ("Fork started…") along with the fork
instruction. The parser ignores this copy — otherwise the inherited result looks like the subagent ended and the fork
never enters the office — and uses the text after `</fork-boilerplate>` as its prompt.

## Waiting on shell

The `shell` status (see `shared/types.ts`) is an agent that ended its turn with command(s) running in the background.
Comes from the record (`"status": "shell"`, Claude Code 2.1.292+, which does not count monitors); in versions that do
not record `shell`, an `idle` record + background Bash without notification under 12 h becomes `shell`.

`sources/shells.ts` tracks, per session (primary and subagents), `ShellJob` entries published in `AgentInfo.shells`:
Bash with `run_in_background` (the id becomes the `backgroundTaskId` from the tool_result), foreground Bash still
without result (`background: false`; disappears from place while the session awaits approval), and `Monitor` (`kind:
'monitor'`). Termination: `<task-notification>` (`queue-operation`/`enqueue` line, user message, or attachment) matching
`task-id` or `tool-use-id`; `TaskStop`/`KillShell`/`KillBash`; turn end/interruption (foreground); `/clear` or
terminated session; jobs predating the current process (resumed session) or older than 24 h. The end of a background
shell becomes the activity `tool: 'ShellDone'` (`error` = failed/interrupted; the world celebrates or laments) and a
notice; while the status is `shell`, the balloon is "⏳ Waiting on shell: <label>" (`tool: 'ShellWait'`).

## GitHub in the office

`sources/github.ts` finds GitHub events in transcripts, tokenless and without network: the parser
keeps calls of interest (Bash with `git push`/`gh pr create|merge|checks`/`gh run watch|view`/`gh release create`,
without heredocs and with separated chains, and GitHub MCP server tools) and reads their outcome:

- **preferred source:** `toolUseResult.gitOperation`, recorded by Claude Code itself (`{pr: {number, url, action:
  'created'|'merged'}, push: {branch}}`);
- **command output:** URL `…/pull/<n>` from `gh pr create`; `gh pr merge` without error or failure signal (and without
  `--auto`); lines `abc..def  main -> main` / `* [new branch]` after `To <remote>`; header `✓|X <branch> <workflow> ·
  <id>` or `completed with '<conclusion>'` from `gh run watch|view`, `--json`/`--jq` with the conclusion, `gh pr checks`
  (tabs, summary or `--json`; pending does not count); URL `…/releases/tag/<tag>` from `gh release create` (drafts do
  not count); MCP JSON;
- **exit code:** `gh run watch --exit-status` or `gh pr checks` as the last command, unpiped (otherwise exit code
  belongs to another program) — in foreground ("Exit code N") or background (`<task-notification>` summary). ≥ 128
  (killed) and 8 (pending `gh pr checks`) do not count.

Commands with errors, blocked, or interrupted do not produce an event (only red CI uses the error). The `github` signal
becomes `Office.githubEvent`: activity `tool: 'GitHub'` (`shared/github.ts`) and, live only (never on initial load or
for lines older than 2 min), a notice and room effect, published in `RoomInfo.effect` (`{kind: 'party'|'alarm', text,
at, until, agentId}`): party (PR opened/merged, release) for 12 s; alarm (red CI) until green CI in the room (which
turns into a party) or 10 min. Push only notifies. The same CI seen again within 2 min does not repeat the notice.

## API

| Route | Description |
| --- | --- |
| `GET /api/stream` | SSE: events `snapshot`, `feed`, `notice` (see `shared/types.ts`); ping every 15 s |
| `GET /api/snapshot` | Current `OfficeSnapshot` |
| `GET /api/agents/:id` | `AgentDetail` (history of up to 200 activities) |
| `GET /api/agents/:id/terminal` | Terminal SSE: `init` and `append` events (`TerminalMessage`); local bind only (see below) |
| `PUT /api/agents/:id/character` | Project character: `{name, seed, parts}` (see below); `200 {ok}`, `400`, `404` (not the primary of an open session), `409` (name in use); local access only |
| `DELETE /api/agents/:id/character` | "Back to random": removes character from room; `200 {ok}` or `404`; local access only |
| `GET /api/sessions/recent` | `RecentSessionsResponse`: sessions from last 7 days across all accounts (up to 150); same terminal lock |
| `GET /api/sessions/:conta/:sessionId/terminal` | SSE of conversation for a historical session (same terminal protocol); same lock |
| `POST /api/team` | `{openBoss: true}` opens the boss (`boss.kind`) in `folder` (`400` without a folder); `{boss}` appoints an open session; local access only. Seats are edited in `team.json`, not here |
| `GET /api/health` | `{ok, version, docker, remote, terminal, pty, sources, accounts:[{id, usageStatus}]}` |

The snapshot (SSE and `GET /api/snapshot`) carries only the last 8 activities of each agent in `recent`; history of up
to 200 (including the beginning of long transcripts, read in background) comes from `GET /api/agents/:id`.

Edge (`http/guard.ts`, applies to API, statics, and Vite): `Host` must be `localhost`/`*.localhost`, an IP, or a name
from `HABBLAUD_ALLOWED_HOSTS` (against DNS rebinding) → otherwise 403; `POST` on `/api/*` requires `Content-Type:
application/json` (415) and same-origin or local `Origin` (403), against CSRF. JSON responses are sent with `nosniff`
and `Cross-Origin-Resource-Policy: same-origin`, no CORS.

## Terminal

`GET /api/agents/:id/terminal` (`http/terminal.ts`) streams the session conversation — prompts, responses, tools and
results, as Claude Code displays them — assembled from the transcript by `sources/terminal.ts`, with masked secrets and
truncated text. Upon connecting (and on each reconnection) comes an `init` with the last 500 entries of the final ~4 MB
of the transcript (`truncated: true` if conversation was left out); afterwards, 400 ms polling sends `append` with new
entries. Truncated/replaced or swapped transcript (`/clear` in the same process) = `init` again; missing file = keeps
trying. Ping every 15 s, at most 8 terminals simultaneously, client with over 8 MB accumulated is disconnected. The
stream is read-only.

This feature only exists with **local bind** (`config.ts`, `terminalOffReason`), since it reveals the full conversation:

- Node: loopback `HABBLAUD_HOST` (127.0.0.0/8, `::1`, `localhost`); `0.0.0.0`, `::` or network IP disables;
- `HABBLAUD_TERMINAL=0` always disables; no variable enables the terminal with an exposed port.

In addition, each request requires a local `Host` (`localhost`, `*.localhost`, 127.x or `[::1]`): network IPs and names
from `HABBLAUD_ALLOWED_HOSTS` (proxies, tunnels) receive 403. Status appears in `meta.terminal` of the snapshot and in
`terminal` under `/api/health`. Errors before the stream respond with JSON `{error}`: 403 (disabled or non-local
access), 404 (unknown agent or transcript), 405 (method not `GET`), 429 (too many terminals), and 500 (unreadable
transcript).

## Session history

`sources/history.ts` lists, on demand, top-level transcripts `<config>/projects/*/<sessionId>.jsonl` of each account
(UUID-formatted name; subagents excluded) modified in the last 7 days, up to 150 most recent. From each file it reads
only the first 64 KB (project = `cwd` of first line containing it, first activity, first prompt) and the last 64 KB
(title and last activity; without a title line there, searches last 512 KB), with async reading and a cache by valid
path as long as mtime and size do not change. The title follows agent rules (`custom-title`/`custom-title.json` >
`agent-name` > `ai-title` > `last-prompt`) and, if none exist, is the first prompt. An open session (primary agent of
account and `sessionId` in office) returns `open: true` and `agentId`; a closed session without timestamp lines is
omitted. The list is returned from most recent activity to oldest.

`GET /api/sessions/:conta/:sessionId/terminal` (`http/sessions.ts`) uses the same agent terminal reader
(`TerminalStreams.attachSession`: `init` with last 500 entries of final ~4 MB, then `append`, with 2 s polling in case
session is resumed) and counts toward the 8 terminals limit. Validation: account must be known (404), id must be UUID
format (400), and the file, with resolved links (`realpath`), must remain inside the account's `projects/` directory
(404); undecodable segments respond 400. Both routes require the same terminal lock (enabled feature and local `Host`,
otherwise 403) and only accept `GET` (the list also accepts `HEAD`; otherwise 405).

## Project character

`PUT /api/agents/:id/character` (`http/app.ts`, rules in `Office.setCharacter`) sets the name and appearance of primary
agent `:id` and saves it as the character of its room (the normalized cwd), in `names.json` › `rooms`: `{name, look,
seed, parts?, owner?, at}`.

The body has three fields:

- `name`: 1 to 24 characters, in NFC, with collapsed consecutive spaces and without control characters;
- `seed`: integer from 0 to 4294967295;
- `parts`: parts from `shared/appearance.ts`, with enum styles and colors in `#rrggbb`. The client applies parts on top
  of `appearanceFromSeed(seed, {look})`.

Rules:

- When a primary agent enters a room that has a character, and the name is available, it spawns with `name`, `look`,
  `seed`, `parts`, and `custom: true`. Departing agents do not count, as they are usually the same reopened session. If
  the name is taken, the standard random draw applies.
- Characters have an owner (`owner`, the `sessionId` that received or saved it last; `/clear` transfers ownership to the
  new session): a non-owner session that already has a saved name keeps its own, ensuring a Habblaud restart neither
  swaps identities nor alters a session's character mid-run.
- Chosen names remain reserved: random draw will not assign them, case-insensitively. `PUT` returns `409` for a name of
  someone present or from another room.
- `/clear` retains the character and does not record the chosen name as the new session's randomly drawn name.
- `DELETE` removes the room character, and the agent returns to the session's randomly drawn name and id seed.
- Lock: same as terminal (local bind and local `Host`). Without it, `403`. Subagent or unknown agent return
  `404`.
- Unused character after 60 days expires, like names.

## Environment variables

| Variable | Default | Usage |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | HTTP port |
| `HABBLAUD_HOST` | `127.0.0.1` | Interface; outside loopback, the terminal is disabled |
| `HABBLAUD_TERMINAL` | — | `0` disables the terminal (it never enables on an exposed port) |
| `HABBLAUD_CLAUDE_DIRS` | — | Comma-separated config dirs; overrides detection (`~/.claude*` with `projects/` or `sessions/` + `CLAUDE_CONFIG_DIR`) |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Habblaud state (project names and characters persisted in `names.json`) |
| `HABBLAUD_LANG` | system language (`LC_ALL`/`LANG`/Intl) | Language of server-assembled texts: `en` or `vi` (shared/i18n.ts) |
| `HABBLAUD_ALLOWED_HOSTS` | — | Extra allowed names in `Host`/`Origin` (comma-separated); `localhost`, `*.localhost` and IPs always allowed |

## Plan usage (5h and weekly)

Two sources, both local files or commands (no credentials, no network calls); the source with the freshest numbers
(`fetchedAt`) takes precedence:

- `cache`: `cachedUsageUtilization` that Claude Code itself writes when running `/usage`, re-read every 60 s;
- `agy`: each Antigravity account's `/usage`, run periodically by `sources/agy/` (`HABBLAUD_AGY_USAGE_MIN`).

Without either, the account is marked `disabled` ("no usage data"). Numbers older than 30 min appear as `stale`. A
window whose reset time has passed since collection is omitted (the UI shows "—") until new numbers arrive — never an
invented 0%.

## Structure

- `config.ts`, `log.ts`, `index.ts` — configuration, short logs (never conversation contents), and entry point.
- `team.ts` — the seats: `folder`, boss and workers in `<dataDir>/team.json` (imported once from `~/.agy_profiles/team.json`, never written back; re-read every second).
- `accounts/` — account detection (`detect.ts`), usage (`usage.ts`), service (`service.ts`).
- `sources/` — session registry, incremental reading (`tail.ts`), transcript parser (activities in `transcript.ts`;
  terminal conversation in `terminal.ts`; GitHub events in `github.ts`), subagents, session history (`history.ts`),
  orchestrator (`watcher.ts`), and the Antigravity source (`agy/`).
- `model/` — office (`office.ts`), rooms/slots (`rooms.ts`), persisted names (`names.ts`).
- `workers/` — the workers' terminals and turns (`service.ts`, `turns.ts`) and hung-worker ghosts (`ghosts.ts`).
- `http/` — edge guard (`guard.ts`), routes (`app.ts`), SSE (`sse.ts`), terminal (`terminal.ts`) and its history
  (`sessions.ts`), interactive terminal (`pty.ts`), accounts (`accounts.ts`), phone access (`remote.ts`), statics
  (`static.ts`).
- `pty/`, `spawn/`, `remote/` — interactive terminal, new agents from the office, phone login and HTTPS.

Tests: `npx vitest run server shared` (synthetic fixtures in `server/test/fixtures.ts`).
