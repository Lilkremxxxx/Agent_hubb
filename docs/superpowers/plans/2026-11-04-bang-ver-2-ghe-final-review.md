# Final review — Plan 2 (Ghế), 8ddb811..853bbd3

Reviewer: opus, read-only. HEAD 853bbd3, working tree clean.

Checks I ran:
- `npm run typecheck`: clean.
- `npm run i18n:check`: vi 1253/1253.
- `cd tools/agy && python3 -m pytest -q tests`: 16 passed.
- `npx vitest run server/workers/service.test.ts`: 22/22.
- Scratch vitest, outside the repo (`<scratchpad>/fr/seats.test.ts`, run with its own `--config`): it reproduces I1 and I2 below.
- Greps for the removed surface: `openAgy`, `names.conf`, `office-tabs`/`office-menu`/`team-dialogs`, `createOffice`, `AGY_ASK_FROM_OFFICE`, `visitor`.
- A read-only look at `~/.agy_profiles/acc1/.gemini/antigravity-cli/brain`: none of the 40 newest conversations hold `/usage`.

### Strengths

- **The seat model is one rule, defined once.** `teamSeats` (server/team.ts:130) produces every agentId. index.ts builds the WorkerService targets (:194–203) and the AgySource seats (:108–118) from the same `team.seats()`, so `agy:<acc>`, `agy:<acc>@<name>`, `claude-worker:<name>` and `agy-boss:<acc>` agree everywhere.
- **The team path rule matches.** worker-ask:44 resolves `$HABBLAUD_DATA_DIR` or `~/.habblaud` the same way as config.ts:139 (the Docker `/data` case is cut). worker-ask's `real_home()` also handles HOME being rewritten inside agy-as.
- **The start gate is small and deterministic.** service.ts:271–294 plus tick :406–416 add no timers; only the clock and the tick decide.
- **The two Task 5 races are fixed in the final code.**
  - A cancelled start holds the gate until settle (:292–293).
  - A fresh ask queues behind same-account entries already in the queue (:272).
- **The gate cannot deadlock.** The longest wait is the larger of `START_SETTLE_MS` (30 s) and `CLOSE_WAIT_MS` (8 s).
- **A queued cancel never types ESC.** `interrupt` (:460) finishes the job directly when `ptyPid` is undefined.
- **The old file is safe.** `load()` (team.ts:334–363) writes only when `file` does not exist. `reload()` keeps the team on bad JSON. A test checks the bytes and mtime of the old file.
- **cwd = folder holds for every entry point.**

  | Entry point | Where |
  |---|---|
  | Jobs | service.ts:247–248 |
  | Claude boss | index.ts:245 |
  | agy boss, refusing an empty folder | index.ts:223, :177 |
  | Headless runs | worker-ask:137–140, :312, :384 |
  | "Send a job" | source.ts:643–653 |

  `BANG_SLOT`/`BANG_OFFICE` are set on PTY jobs (service.ts:521) and on headless runs (worker-ask:309, :377).
- **Anti-goals are met.**
  - The repo's agy-as writes no plugin (tools/agy/bin/agy-as), and the server and worker-ask use it (index.ts:188, worker-ask:300).
  - Nothing installs a Claude plugin.
  - The headless path is kept.
  - Net non-test lines: −2949.
- **The removed surface is gone.** The greps above return 0, except the deferred `overlay.ts` "＋ Worker" text and the "registered worker" wording (M5).
- **The tests are meaningful.** The race tests R1/R2 are in service.test.ts:442 and :459. The `t.advance(START_SETTLE_MS)` added to the old test is justified in the ledger.

### Issues

#### Critical

None. No data loss and no profile writes, and a server restart recovers from every issue below.

#### Important

**I1 — Characters do not follow `team.json` edits that keep their agentId. The board and `offices[0].roomId` do not follow either.**
- **Where:**
  - `AgySource.syncCharacters` skips any agentId already in `shown` (server/sources/agy/source.ts:296).
  - `WorkerService.syncClaudeCharacters` does the same (server/workers/service.ts:358). It places the character at `folder() || homedir()` once (:360).
  - `Office.addMain` on an existing id only resets status (server/model/office.ts:305–311).
- **What the user sees:**
  - **Setting `folder` after start** leaves every seat character, agy and Claude, in the home room until a restart. This is the user's real state: the import writes `"folder": ""`. It is also exactly the Plan 3 `bang-init` path. `publishBoard` (source.ts:446–448) takes the first character's room, so the job board stays in home too. `TeamService.info` (team.ts:315) finds no room for the folder.
  - **Changing `folder`** leaves the characters in the old room.
  - **Renaming the first agy seat of an account** keeps the old name, because the agentId `agy:<acc>` is unchanged.
  - **Removing the first agy seat** gives its id to the next seat, and the page keeps showing the removed seat's name. Example: delete W1, and a character named "W1" stays while W2 disappears.
- **Proof:** the scratch test prints `C1 room before: /home/nhatbang after folder set: /home/nhatbang`.
- **Fix:** key `shown`/`claudeShown` on `(agentId, room, name)`. When the key differs, move or rename the character. Office has no move primitive: `closeMain` keeps the record for the grace period, so a following `addMain` is a no-op. That needs about 10 lines of a new `Office.relocate(id, cwd, name)`, or an immediate remove. Add one test per source.
- **Severity:** fix before Plan 3, because `bang-init` depends on it.

**I2 — `WorkerService.sync` swaps a seat's target under a live job. The job fails and its terminal is orphaned.**
- **Where:** service.ts:339 (`s.t = t`), tick :395–397 (looks up the PTY by the new `s.t.agentId`), idle close :388 (also uses the new id).
- **Trigger:** agentIds are positional (`teamSeats`, team.ts:130–138, ruling 4). Removing or reordering the first agy seat of an account while another seat of that account runs a job flips the running seat's id from `agy:acc1@W2` to `agy:acc1`.
- **Result:** the job fails with the misleading "the terminal closed before the answer", and the PTY under `agy:acc1@W2` stays open for good.
- **Proof:** the scratch test prints `status: failed, error: the terminal closed before the answer … open terminals: ['agy:acc1@W2']`.
- **Same root cause:**
  - Changing an agy seat's account fails the job the same way.
  - Changing a Claude seat's account keeps the agentId but switches `configDir`. The transcript is then never found, and the job hangs until the trust check or the 30-minute timeout.
- **Fix:** in `sync`, when `agentId`, `kind`, `account`, `acc` or `configDir` of an existing session changes, end the live job with a message that names the `team.json` edit, close the terminal under the old id, then swap `s.t`. That is about 6 lines. Use the scratch test as the regression test.

**I3 — CHANGELOG "Unreleased" is not true at HEAD (Focus 8).**
- CHANGELOG.md:48 says "the choice survives restarts". Ruling 2 keeps the Claude boss in memory only, so a restart loses the crown.
- CHANGELOG.md:69 "Workers have no terminal of their own" contradicts :46 "Workers have a terminal of their own".
- CHANGELOG.md:58 "Antigravity workers named after their account" contradicts the Changed line that says a worker is named after its seat.
- Fix: edit or delete three lines.

#### Minor

- **M1 — "Send a job" can reach another office.** `AgySource.assign` runs worker-ask with the server's own environment (source.ts:653) and sets no `HABBLAUD_URL`. Seat PTYs get no `HABBLAUD_URL` either (service.ts:521). worker-ask defaults to `:4747` (worker-ask:46). On any other `HABBLAUD_PORT`, the page's "Send a job" and anything a seat runs (`worker-ask`, Plan 5 `advisor`) go to the 4747 office. That office does not know the seat, so the job fails with exit 1 instead of falling back to headless. Task 10 exported `HABBLAUD_URL`, which hid this. This predates Plan 2. Fix: two lines that set `HABBLAUD_URL=http://127.0.0.1:${config.port}` in both environments. Do it before the Plan 5 spike.
- **M2 — An agy boss and a worker on the same account can mix up conversations.** `openBossAgyTerminal` (index.ts:227) does not take the account's start gate. If the boss agy starts a new conversation while a seat's job on that account waits for its own, `newDirs` (service.ts:647–655) can claim the boss's conversation. The same can happen after the settle timeout: no conversation is marked as taken, so two jobs can take one directory.
  - Cheap guard: accept a new directory only if its first `USER_INPUT` equals the job's prompt, or keep a set of conversations already taken.
  - The spec's acceptance uses a Claude boss, so this is not urgent.
- **M3 — worker-ask and the server validate seats differently.**
  - `seats()` (worker-ask:88) accepts any entry with a name. An unknown `kind` runs as Claude headless, while the server drops that seat.
  - worker-ask accepts a relative `folder` (`os.path.isdir`, :138, resolved against the caller's cwd). The server treats it as no folder (team.ts:83).
  - `BANG_OFFICE` on the headless path is the raw, un-normalized folder string (:309, :377).
  - In practice the office path fails with a 400 either way. Only headless runs differ.
- **M4 — Stale client code and comments.**
  - `workerKind()` (client/src/ui/workers-api.ts:59) is dead and still assumes `claude:` ids. `sessionOf` (:68) has no caller outside tests.
  - The `WorkerId` comment (shared/types.ts:370) still describes `acc2` / `claude:<id>`.
  - The agy-panel.ts:6 comment still says `POST /api/agy/jobs … agy-ask`.
- **M5 — The "registered worker" wording is still shown.** service.ts:243 answers "`{0} is not a registered worker`" (Review Focus 5 lists this text as gone). A seat in `team.json` whose agy profile is not signed in gets this message through worker-ask, and it is misleading. Better: "seat {0}: account {1} is not signed in".
- **M6 — Stale README row.** README.md:496 says `HABBLAUD_AGY_PROFILES` is where "`team.json` live[s]". Now it only holds the file imported once.
- **M7 — A Claude-only team has no job board.** `publishBoard` needs a shown agy character (source.ts:446–448). The same happens with `HABBLAUD_AGY=0`, since the board lives in AgySource. Not in the spec; note it.
- **M8 — Removing a seat in `team.json` cancels its job as "cancelled by you".** The real cause is a `team.json` edit (`sync` → `cancel`, service.ts:346).
- **M9 — Changing `boss` in `team.json` leaves the old boss terminal open.** A switch from agy to claude keeps the `agy-boss:<acc>` PTY open with no character. The user can close it from the drawer.
- **RSS (Focus 5):** 108,876 kB against the 112,640 kB gate, which is 3.3% headroom. Plan 1 measured about 106 MB. Plans 3–5 add the advisor long-poll and skills. Each plan must re-measure idle RSS as a gate, and if it crosses the line, look first at boot-time `BOOT_LOG_BYTES` (32 MB tail).

### Triage of deferred items

| Ledger item | Verdict |
|---|---|
| T1: CHANGELOG toast + `--allow` help lines | done at HEAD (CHANGELOG Changed) |
| T2: team.test.ts:117 no-op appoint | done in 33b7989 |
| T2: `accounts.addDir` side effect in `targets()` | defer: idempotent, refreshes only for a new directory (accounts/service.ts:167–173) |
| T2: reload+sync twice per tick on change | defer: harmless |
| T3: no 403 test for a foreign Host | done in be46c0c |
| T3/T5/T6: `team.folder \|\| config.home` fallbacks | done: only the display-only agy character fallback is left (source.ts:305, ruling). See I1: the "home until set" ruling assumed the characters would move once the folder was set, and they don't |
| T4: overlay.ts:648,666 "＋ Worker" + vi key | defer to the multi-building cleanup (ruling 7) |
| T4: "＋ Boss" comments | done in Task 9 |
| T4: spawn.ts comment; `GET /api/spawn/folders` has no client caller | defer to Plan 6 (remote `spawn` permission) |
| T5: start log `ts` = asked time for queued jobs | defer: wrong only by the queue wait |
| T5: `newBoardItem` unused `mine` | done (source.ts:597) |
| T6: `config.agy.room` unused | done in Task 9 |
| T6: tools/agy/README.md:49 names.conf | done in Task 7 |
| T6: SIGTERM→SIGKILL escalation test | done in Task 8 |
| T6: accounts.ts:26 comment | done in Task 8 |
| T6: boss-only account levels and `/proc` jobs have no landing character | defer: matches the brief |
| T7: four worker-ask tests | done in Task 8 |
| T7: defaults.json, `--effort`, `--model` validation untested | defer (untested upstream too) |
| T7: unknown seat kind treated as Claude | wrong to dismiss: see M3, worker-ask does not filter like `parseTeam` |
| T8: `isObserverSession` has no symlink resolution | defer |
| T8: escalation test does not spy SIGHUP | defer |
| T8: `sourceInfo` count | done in Task 9 |
| T9: README worker-ask full path; install.sh link | done in e83d5ba |
| T3 note: art floor-chunks flake | defer: quarantine decision before v1, with the three known flakes |
| T10: `echo $!` after `setsid nohup` saves the wrong pid | defer: fix in the Plan 3 brief (read the pid from `ss -ltnp`) |

### Plan 3 / advisor-spike readiness

Plan 3:
- **`bang-init` writing `folder`** works for jobs and the boss: `reload()` picks it up within 1 s. But the characters and the board stay in home until I1 is fixed, unless bang-init's instructions say to restart the server.
- **Write atomically.** bang-init must write `team.json` with tmp+rename. A torn write is safe (the old team is kept), but the change only lands once the file parses.
- **A third copy of the path rule.** bang-init will be the third place that resolves the team path (config.ts:139, worker-ask:44). Reuse worker-ask's two lines.
- **install.sh** already links `worker-ask`, `agy-ask`, `claude-ask` and `agy-as`. It still links `tools/agy/skills/*` into `~/.claude/skills`, which spec §15 says to remove. Plan 3 owns that, together with removing the 8 office-rules plugin links.
- **Until install.sh runs,** agy-as puts `~/.local/bin` first on PATH (agy-as:14). An agy seat that calls `agy-ask` then gets Vi-Habblaud's copy, which does not know seats. `worker-ask` by that name is found in the repo's `tools/agy/bin`, which the PTY puts first on PATH (manager.ts:279).

Advisor spike:
- **Claude boss: available.** The spike can find the boss PTY with `team.bossAgentId()` plus `ptys.ofAgent()`, type with `ptys.typeTo()` (manager.ts:299), and read the boss transcript with `agents.transcriptPathOf(id)`. A boss appointed with 👑 and running outside a page PTY has no `ofAgent`, which matches the spec's "exit 1".
- **agy boss: no transcript reader.** `AgySource.transcriptPathOf()` returns undefined (source.ts:361), so nothing can read an agy boss's `[ADVISOR …]` reply today. The spike needs its conversation directory, which brings back the conversation-matching problem in M2.
- **Seat to job: one accessor missing.** `WorkerService.sessions` is private. To map `BANG_SLOT` (= the seat name = target id) to its running job, add one `jobOf(seat)` accessor.
- **Env is incomplete.** The seat env has `BANG_SLOT` and `BANG_OFFICE` but no `HABBLAUD_URL` (M1). For agy seats, the advisor CLI also needs the `real_home()` trick, because agy-as rewrites HOME.
- **The 20k prompt cap** (service.ts:245) is Plan 4's.

### Declined to judge

- `agy-as -p /usage` and brain directories: the probe was inconclusive, and the behavior comes from the fork. Outside Plan 2.
- worker-ask's headless cleanup deletes that call's own `conversations/<cid>.db*` under `.gemini/` (worker-ask:321–327): it predates Plan 2, deletes only the call's own data, not configuration. §3 is about modifying the profile; left for Plan 4 with the agy-boss plugin.
- `restart()` can hold the POST up to 8 s against worker-ask's 10 s timeout, which risks a double run through headless: it predates Plan 2 and was not touched.
- Default agy `--mode plan` (worker-ask:132) against spec §14 `--mode auto`: Plan 4 (giao-viec, worker modes).
- SKILL.md "auto is not available on these accounts": Plan 4 skill rewrite.
- The 20k prompt limit: Plan 4 (spec §16 builder note).
- Client multi-building world code (`room.office`, `focusOffice`): ruling 7 / decision 8.
- The three known flaky tests plus art floor-chunks: quarantine before v1, not this plan.
- A server restart while jobs are queued: in-memory jobs are lost and worker-ask exits 1 with "job not found" or "lost the office". Accepted by the in-memory design; nothing in the spec asks for persistence.
- An external Claude boss replaced by "Open the boss" (a second session takes the crown): the spec says the boss is the page's terminal. Reasonable.
- `HABBLAUD_DATA_DIR` relative-path resolution differences between Node and Python: an edge case nobody configures.
- A whole Claude-seat `account` change while the boss is pending in memory: an edge case with no user flow.

### Verdict

**Ready after the listed Critical/Important fixes.** I1 (characters and board stay in home when `folder` is set later, which is exactly what `bang-init` does) and I2 (removing a seat while a sibling seat runs fails that job and leaks its terminal) are things a normal user hits by editing `team.json` as the README tells them to, and I3 is three false CHANGELOG lines. M1 (`HABBLAUD_URL`) should land before the advisor spike.
