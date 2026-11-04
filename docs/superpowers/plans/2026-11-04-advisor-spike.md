# Spike: /advisor question -> boss PTY -> answer from boss transcript

Date 2026-11-04. Throwaway server on :4749 (worktree ~/bang-spike-advisor at 89d38d5, data dir ~/.bang-spike-data), user's :4747 server untouched (1 listener at start and end). Boss = real `claude` 2.1.318, default account, folder /home/nhatbang/Agent_4_me (trusted: `hasTrustDialogAccepted: true`), opened with `POST /api/team {"openBoss":true}` -> pty `p1-1527111`, agentId `.claude:1527111`, sessionId `5f256ec5-...`, transcript `~/.claude/projects/-home-nhatbang-Agent-4-me/<sessionId>.jsonl` (same path `claudeTranscriptPath` builds; the file appears only after the first prompt). Transcript timestamps are UTC (local = UTC+7).

## Verdict: GO-with-conditions

The mechanism works: typing into the boss PTY through `POST /api/pty/:id/input` (= `PtyManager.input` / `typeTo`), then reading the tagged reply from the transcript. Conditions (all measured):
1. Use bracketed paste for the text and submit with `\r` (plain text + `\r` is NOT reliable).
2. Match only `assistant` entries by tag; the boss may put two tags in ONE message.
3. When the boss is in a tool-using turn the question is NOT reliably answered: re-send once after the boss goes idle (see exp 3b).
4. Never type when the boss is `waiting` (a prompt) or not yet registered.

## Experiments

| # | What was typed (exact) | Result | Latency |
|---|---|---|---|
| 1a | `Reply with the single word PONG1. Text only, no tool.\r` (plain, one write, 53 chars) | submitted, answered `PONG1` | typed 08:31:29.8Z, user entry 30.0, assistant 36.1 = 6.3 s (first turn, cold cache) |
| 1b | `[A] line one: ...?\nline two: ...\r` (plain, `\n` inside, one write) | NOT submitted: both lines sat in the input box (screen shows `❯ [A]... / line two...`). A second write `\r` 20 s later submitted it; transcript user entry has the `\n` preserved | submit-to-answer 5.8 s |
| 1c | `ESC[200~[B] line one...\nline two...ESC[201~\r` (bracketed paste + `\r`, ONE write) | submitted at once, `\n` preserved in the user entry, answered | user entry <0.3 s after typing; answer 5.4 s |
| 1d | plain `Write a 400-word explanation of how DNS works, ... do not use any tool.\r` (100 chars, one write) | NOT submitted (stayed in the box); the next paste then got glued to it and both were sent as ONE prompt | n/a (this is why plain + `\r` is rejected) |
| 1e | bracketed paste of 3092 chars (41 lines), then a separate `\r` 300 ms later | submitted; Claude Code stores it wrapped as `\n\n<pasted_content id="0883">\n...\n</pasted_content id="0883">\n`; boss answered with the tag | answer 7.8 s |
| 2a | idle boss, bracketed `❓ Seat W2 asks (job T2): which of 'a.csv' or 'b.csv' is the input?\n→ Reply briefly, starting exactly with the tag [ADVISOR W2 T2]; that reply is passed verbatim to W2. Reply with text only; do not use any tool.` | `[ADVISOR W2 T2] I can't tell from here: ...` | 3.2 s (15:33:15.9 -> 08:33:19.2Z) |
| 2b | same, WITHOUT the "text only" sentence (the real frame), job T2b | `[ADVISOR W2 T2b] I still can't tell, ...`, no tool_use | 3.1 s |
| 3a | busy boss (4000-word Roman history, text only, 65 s turn); question T3 typed 10 s in | Claude Code shows `Press up to edit queued messages`; transcript: `queue-operation enqueue` (08:36:37.6, immediately), turn ends 08:37:32.5, `queue-operation dequeue` 37:33.2, then a normal `user` entry with `promptSource: "queued"`, then the tagged answer. First answer is a separate assistant entry, not interleaved | typed->tagged reply 58.7 s; 3.1 s after the first turn ended |
| 3b | busy boss in a TOOL turn (4 sequential `Read` calls); question T6 and T7 typed 4-5 s in (two runs) | The question is NOT queued as a new prompt: it is injected as an `attachment` of type `queued_command` (rendered as a `<system-reminder>The user sent a new message while you were working: ...`) after a tool result. In 2/2 runs the boss IGNORED it: the turn ended with a normal summary, no `[ADVISOR ...]` text anywhere in assistant entries. Registry went back to idle | no tagged reply ever |
| 3c | retry of T7 after the ignored run, boss idle, same frame | `[ADVISOR W2 T7] ...` | 3.0 s |
| 4 | busy boss (4000-word Ottoman history); at +8 s and +9 s: W2/T4 frame, then W3/T5 frame | both queued (2 enqueue ops); on turn end both dequeued together (2 `queued` user entries 2 ms apart); the boss answered BOTH in ONE assistant message: `[ADVISOR W2 T4] ...\n\n[ADVISOR W3 T5] ...\n\nSkipped: ...` | 5.3 s after the first turn ended; both tags present, in order |
| 5 | code reading only (below) | signal exists | n/a |

Other observations: tag compliance 7/7 on idle and text-only paths. No tool use on any tagged reply. `[ADVISOR` text also appears in `queue-operation`, `user` and `attachment` entries (the frame itself), so matching must be restricted to `type == "assistant"`. Boss session starts with ~77k tokens of context (user's hooks: claude-mem, ecc, superpowers, ponytail), ~$0.02-0.2 per boss turn. The user's ponytail hook makes the boss append `\n\nSkipped: ...` to replies. The boss runs in `auto` permission mode (status bar `auto mode on`), so permission prompts are rare but possible. Nothing in the hooks blocked typing.

## Recommended typed format and submit

Frame (question text first sanitized, see below), written as ONE chunk to `POST /api/pty/<ptyId>/input` `{"data": ...}` (the same as `ptys.typeTo(bossAgentId, data)`):

    ESC[200~❓ Seat <seat> asks (job <jobId>): <question>\n→ Reply briefly, starting exactly with the tag [ADVISOR <seat> <jobId>]; that reply is passed verbatim to <seat>.ESC[201~\r

- Bracketed paste (`\x1b[200~ ... \x1b[201~`) + `\r` in the same write worked every time (6/6), also with a separate `\r` 300 ms later (the safer variant: lets the server re-check the registry status between paste and submit).
- Do not send plain text + `\r` (exp 1b, 1d). Do not rely on `\n` outside a paste.
- Sanitize the worker's question: strip ESC and every control char except `\n` (a `\x1b[201~` inside the question would end the paste and the rest would be typed as keystrokes); cap at about 1500 chars (a 3 KB paste works but is wrapped in `<pasted_content>`).
- Suggested extra line in the frame (not tested, wording only): "No preface, no footer." The boss otherwise appends hook trailers (`Skipped: ...`).

## "Don't type now" signal (exp 5, code reading)

The boss's `sessions/<pid>.json` in its account dir (read by `server/sources/registry.ts`, `registryStatus()`) has `status`: `busy | idle | waiting | shell`, plus `waitingFor` (`describeWaitingFor` in `shared/activity.ts`: "answer a question", "approve a permission", "trust this folder", "close an open dialog", ...). The watcher turns it into the snapshot agent's `status` (`working | idle | waiting | shell`) and `waitingFor`. Observed here: `busy` while a turn runs, `idle` after. Also `/api/snapshot` `team.offices[0]`: `bossAgentId` (set), `pendingBoss` (opened, no session yet = trust dialog or still starting) and `waitingBoss`.
Rule: type only if `bossAgentId` is set, a non-exited pty with that agentId exists in `GET /api/pty`, and boss status is `idle` or `working`. Refuse on `waiting` or `pendingBoss`. I did not provoke a prompt. By reasoning: at a permission/choice prompt `\r` would pick the highlighted option (often "Yes") and digits/`y` select options, so typing there could approve something. Residual race: a prompt can appear between the check and the write; the 300 ms two-step variant narrows it, and the boss being in auto mode makes it rare. Unknowable from the server: a draft the human typed in the boss's input box (the paste is appended to it).

## Detection recipe

Reuse: `agents.transcriptPathOf(bossAgentId)` (`server/sources/source.ts`, watcher returns `main.transcriptPath`; fall back to `claudeTranscriptPath(configDir, cwd, sessionId)` from `server/workers/turns.ts`) and `FileTail` (`server/sources/tail.ts`): `new FileTail(path)`, `seekEnd()` BEFORE typing (if the file is missing, offset 0), then `read()` every 500 ms gives complete JSONL lines (`{lines, reset, missing, more}`). Do not reuse `claudeTurn()` (it only keeps the LAST text of the turn, counts queued messages as prompts, and knows no tags); write a small matcher.

Entry shape (one JSONL line per content block):
`{"type":"assistant","timestamp":"...Z","message":{"role":"assistant","content":[{"type":"text","text":"[ADVISOR W2 T4] I still can't tell, ..."}],"stop_reason":"end_turn"|"tool_use"|null}}`
Match: `type === "assistant"`, for each `content[]` block with `type === "text"`, `text`. Find `/(?:^|\n)\s*\[ADVISOR <seat> <job>\][ \t]*/` (tolerates leading whitespace and a tag that is the second paragraph). Answer = text after the tag up to the next `\n\s*\[ADVISOR ` or the end, trimmed. Skip `queue-operation`, `user`, `attachment` lines (they contain the frame and the tag). A tagged text can come in a later assistant entry than the first one of the turn (after tool calls): scan every assistant entry after the offset. `thinking` blocks are not text, ignore.

Timeouts (from measurements: idle 3-6 s, queued behind a 65 s turn 59 s):
- tag not seen and boss still `working`: keep waiting (cap about 10 min, configurable).
- boss returns to `idle` (registry) without a tagged reply: re-type the same frame ONCE (exp 3b/3c), then wait 60 s.
- Still no tag after the retry: failure "no tag".

## Failure modes and CLI behaviour (suggested)

| Case | Detected by | CLI |
|---|---|---|
| No boss terminal (no `bossAgentId`, no open pty for it, pty exited, `pendingBoss`) | `/api/snapshot` team + `GET /api/pty` | exit 2, "no boss terminal: open the boss in the office (Mở boss)"; do not type |
| Boss at a prompt (`waiting`, with `waitingFor`) | registry status | exit 3, "boss is waiting for you: <waitingFor>"; do not type; optionally poll until it clears |
| Boss busy beyond the cap | no tag, still `working` | exit 4, "boss did not answer in <N> s"; the queued frame may still get answered later (it stays queued), so a late tag can be ignored |
| Boss answered without a tag | idle, retry done, no tagged assistant text | exit 5, "boss replied without the [ADVISOR ...] tag"; may print the last assistant text marked UNTAGGED, never pass it as the answer automatically |
| Tool-turn swallowed question | exp 3b | handled by the single re-type after idle |
| Two workers asking at once | exp 4 | works; split one message by tags; each seat polls its own tag |

## Cleanup

Boss pty closed with `POST /api/pty/p1-1527111/close` (exit 129), spike server stopped with `HABBLAUD_PORT=4749 sh scripts/office.sh stop` (NOTE: without HABBLAUD_PORT the script targets 4747; its guard refused once because the cwd differed, nothing was stopped), worktree and `~/.bang-spike-data` removed. Left behind: the spike's own Claude session file `~/.claude/projects/-home-nhatbang-Agent-4-me/5f256ec5-041b-498f-b042-24d945101dbf.jsonl` (+ sibling dir) in the user's ~/.claude, and some claude-mem observations from the hooks.
