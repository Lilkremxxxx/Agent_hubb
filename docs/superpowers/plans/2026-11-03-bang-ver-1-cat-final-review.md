### Strengths

- Checks I ran: `npm run typecheck` (green), `npm run i18n:check` (1361/1361), `tsc --noUnusedLocals` on both tsconfigs, the trailer check on all 21 commits, API path and SSE/store event cross-checks, a reverse CSS check, and a filename sweep. I did not run vitest or pytest. I reviewed the diff in passes (seam files first, then greps against HEAD).
- The work follows the plan's shape. There is one commit per subsystem, so each can be reverted alone. Every one of the 21 commits ends with both required trailers (checked with `git log --format=%B`). `package.json` still has no `dependencies` key, the same as upstream.
- The removal is thorough. `tsc --noUnusedLocals` finds only 4 unused symbols that the cut introduced, in about 75k lines. `typecheck` and `i18n:check` are green, with 0 leftover locale keys.
- The seams hold together:
  - Every `/api/*` path the client calls has a server route.
  - The SSE events (`snapshot`/`feed`/`notice`) match what `client/src/net/store.ts` listens for.
  - Every store event (`snapshot`/`feed`/`notice`/`connection`/`update`) has listeners.
  - `server/http/app.ts:572` is a JSON 404 catch-all after every real route, and `http.test.ts` covers it for 5 removed prefixes.
  - The CSRF tests moved to `/api/fun/party`, which is a real mutating route behind the same guard.
- Security posture is otherwise preserved:
  - The bind and host handling in `server/config.ts` is untouched.
  - The `trusted()` gates are unchanged, and the PTY is still refused on the remote port.
  - `spawnOn = config.terminal && ptyOptIn` (`server/index.ts:150`) equals the old `config.messages && ptyOptIn` except for the deleted `HABBLAUD_MENSAGENS` kill switch. That is benign.
  - The Task 14 `roles.conf` removal only changes which characters a brand-new `team.json` seeds. It starts no processes, because worker terminals open per job. On this machine there is no `roles.conf` and `team.json` already exists, so nothing changes.
- The Review Focus tests are present:
  - "usage unknown, not 0%": `server/accounts/usage.test.ts`
  - 404 for removed APIs: `server/http/http.test.ts`
  - `agy-ask rules` exits 1: `tools/agy/tests/test_worker_ask.py:249`
- Reverse CSS check: 454 `.ui-*` selectors disappeared from `styles.css`. Two of their classes are still used live (`ui-btn-sidebar`, `ui-version__text`), but only rules for removed variants were dropped (the `is-city` hide and the `is-new` update chip). No live element lost its styling.
- The clock icon in the top bar is the live Session history popover (`client/src/ui/history.ts:137`, `GET /api/sessions/recent`), not timelapse residue.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

**I1. The remote access default now exposes conversations.** (`server/http/remote.ts:99`, comment `:11-12`; `scripts/remote-setup.ts:60`; `README.md:268,474,534`; `server/http/remote.test.ts:55-59,71`)

- When `HABBLAUD_REMOTE_ALLOW` is unset, `parseAllow` now returns `['terminal']`.
- On the remote port, `terminal` grants read access to every conversation (`GET /api/agents/:id/terminal`) and to 7 days of session history with titles (`/api/sessions/*`). Before the cut, the unset default granted only `permissions`, and transcripts were never readable remotely unless someone opted in.
- `remote-setup.ts` writes `HABBLAUD_REMOTE_ALLOW` only when `--allow` is given. So an upgraded setup with the variable unset silently gains transcript access.
- An existing `.env` with `HABBLAUD_REMOTE_ALLOW=permissions` already becomes view-only at HEAD, because `parseAllow` drops unknown names. A `none` default would treat the unset case the same way. Only the unset case was promoted, to transcript access. "`permissions` could approve commands, so it was stronger" does not answer this: the two defaults expose different things, and the new one silently adds read access to conversations.
- The ledger's pre-flight ruling picked `terminal`. The spec (§21) leaves remote decisions to Plan 6. The default that preserves upstream behavior is "old default minus the deleted feature", which is `none` (view only).
- Remote is off on this machine (`.env` has no `HABBLAUD_REMOTE_*`). That is why this is not Critical.
- Fix (about 6 lines):
  - default to an empty set;
  - make the comment, the `--allow` help, `README.md:268/474` and the parseRemoteConfig test say `none`;
  - `README.md:534` then becomes true as written.

**I2. The removed office-rules engine is still enforced on this machine.** (`server/workers/service.ts:489`, `server/workers/service.test.ts:158`; plan gap)

- All 8 profiles carry Vi-Habblaud's office-rules hook: `~/.agy_profiles/acc{1..8}/.gemini/config/plugins/office-rules/`, linked into `/home/nhatbang/Agent_4_me/Agent_Hub/Vi-Habblaud/tools/agy/agy-plugin/office-rules/`. They were installed by the upstream `install.sh` loop that Task 9 deleted.
- Bang_ver still starts every agy worker job that names an office with `AGY_OFFICE`/`AGY_WORKER` (`j.office ? {…} : undefined`). Those are exactly the variables that hook keys on.
- Bang_ver does not read `AGY_WORKER` anywhere. `AGY_OFFICE` is only a boss hint in `worker-ask`.
- Once the user gives the office a folder (README step 2 says to), Vi-Habblaud's default rules refuse worker edits outside it. The page has no rules UI to change that, and the cut claims the engine is gone.
- The Task 9 ruling "keep AGY_OFFICE/AGY_WORKER on the agy path (worker-ask reads AGY_OFFICE)" is wrong for the worker path. It is right for the boss path (`server/index.ts:266`).
- Fix:
  - scope: drop the env object at `service.ts:489` only and update `service.test.ts:158`. Keep `AGY_BOSS`/`AGY_OFFICE` on the boss path (`server/index.ts:266`). No other producer exists;
  - the hook also finds the office through a `claude` boss ancestor, so the real cure is removing those 8 plugin folders. The spec (§3, §15) forbids Bang_ver from touching the profiles, so ask the user and record the answer for Plan 3.

**I3. In-app Help tells users to use two removed features.** (`client/src/ui/help.ts:99`, `:104`, plus their two `shared/locales/vi.ts` keys)

- Line 99: "or send a message from its details". Messages were removed in Task 8.
- Line 104: "press Ask for a handoff". That button was removed in Task 8.
- The Task 16 UI pass missed both. Fix: reword the 2 strings and their 2 translations.

**I4. README is misleading in places that were rewritten in Task 15.**

- `README.md:70-71,103` clone `github.com/zafkielzz/Vi-Habblaud.git` and `cd Vi-Habblaud`. That installs the fork, not Bang_ver.
- `README.md:140`: "How the boss and the workers behave → `docs/boss-rules-from-fork.md`". Since 7123ab2, nothing installs the agy-boss plugin, so editing that file changes nothing. `tools/agy/README.md:34` and the `server/index.ts:257` comment make the same claim.
- `README.md:271,472-473,549` document "New agent (the + button)". Upstream had already removed that button (`client/src/ui/spawn.ts:2`). No client calls `POST /api/spawn` or `/api/spawn/attachments`, so the remote `spawn` permission guards a route only curl can reach.
- Fix: correct the clone and `cd` lines, and either reword or drop the boss-rules row and the New agent text.

**I5. The Habblaud World "visit" machinery is still in the office canvas.** (parked item from Task 12)

- `client/src/app.ts:26` calls `createWorld(worldCanvas, store)` without `visit`, so every branch below is unreachable. No test covers it.
  - `client/src/world/sim/visitor.ts` (108 lines);
  - `sim.ts`: the `visit` mode, `visitor*`, `VisitLight`/`applyVisitLight` (`:55-59,155-169,263,520,775,809,983,2040,2073-2220,2295`);
  - `client/src/world/index.ts`: the `VisitWorld` API and `visit` option (`:25-53,204-215,313,469-495`), and `setSuspended` (`:438-451`, whose only caller was the deleted city host);
  - `render/overlay.ts`: the visitor badge and visit branches (`:342-380,742,786,982-983,1049,1101`).
- Commit f36bdc1 says "remove Habblaud World (city, visits, uplink)", and spec §16 row 1 names "visit". This is roughly 350 lines that `typecheck` will lead someone through.
- Deferrable: it changes no behavior, so it can be the first commit of Plan 2, which edits `sim.ts` anyway. It must be recorded in the ledger.

**I6. Docker runtime mode and the host-helper path outlived Docker and the helper.**

- The helper was `scripts/codex-bridge.ts`, deleted in Task 1 / Task 5.
- What remains:
  - `inDocker` throughout `server/config.ts:80-140`, `server/index.ts:152-164,437,448,462-463` and `server/http/remote.ts:66-92`;
  - the routes `/api/host/spawn/poll|ack` (`server/http/app.ts:410-425`);
  - SpawnService's queue-for-helper mode, whose `server/spawn/spawn.ts:213` message now says "the computer's helper isn't running" with no helper left to run;
  - the startup log "New agent: on, via the host helper";
  - `server/config.ts:108-110`, which points at the deleted `docker-compose.yml`;
  - `.dockerignore`, which lists the deleted `scripts/build-info.mjs`;
  - the remote test harness, which runs with `inDocker: true` (`server/http/remote.test.ts:201`). So the remote tests exercise a mode that can no longer happen, not the Node mode in use.
- Spec §3 and §16 put Docker out.
- Deferrable on the same terms as I5: no effect on this Ubuntu host. Record it in the ledger, and do it before Plan 6 builds on `remote.ts`.

#### Minor (Nice to Have)

- **M1. Unused symbols introduced by the cut** (`tsc --noUnusedLocals`):
  - `client/src/ui/drawer.ts:51` (`richText` import)
  - `client/src/world/index.ts:56` (`assets` written, never read)
  - `client/src/world/render/renderer.ts:19` (`isArea`, `RECEPTION_ID`)
  - `client/src/world/sim/sim.ts:5` (`Provider`)
  - Three more existed upstream (`topbar.ts:2`, `server/http/app.ts:15`, `agy/source.ts:776`).
  - Consider turning on `noUnusedLocals` so later plans get this detector for free.
- **M2. Leftover demo filter:** `client/src/ui/termtabs.ts:108` still has `!a.id.startsWith('demo:')`.
- **M3. Stale text and comments:**
  - `server/http/app.ts:267` user-visible error still says "(hooks, plugins and the host helper)";
  - `client/src/ui/context.ts:25` "alternative source", and the `openAbout` comment "update status";
  - `client/src/ui/overload.ts:120` toast says "Save the work to the HANDOFF file".
- **M4. Dead version-chip icon:** `client/src/ui/version.ts:8-10,28-31` still builds the "new version" up-arrow, but its CSS is now always `display:none`.
- **M5. `AgentInfo.contextWindow` has no producer** (`shared/types.ts:199-203`). The mod's `?window=` was the only one. `shared/overload.ts` falls back to guessing from the model id, so this is harmless.
- **M6. The scheduler's global cap can no longer be reached** with only two cue channels, and its test now asserts only `played > 0` (`client/src/audio/scheduler.test.ts:60-63`).
- **M7. `tools/agy/agy-plugin/agy-boss/` and its pytest (`BossRulesHook`) are kept, but nothing installs the plugin.** Plan 4 (prompt prelude) should decide whether to keep or delete them.
- **M8. A kept pytest fixture still carries office rules:** `tools/agy/tests/test_worker_ask.py:108-112` has `"rules": anywhere` and a comment about rules.
- **M9. Docs describe the Plan 2 target or removed behavior:**
  - `CLAUDE.md:3` and `AGENTS.md:3` say "a single office with a boss and seats". Several offices and tabs still exist, and there are no seats yet. The plan prescribed this wording; add "(after Plan 2)".
  - CHANGELOG Unreleased "Added" keeps bullets that describe removed behavior: herdr `blocked` (`:65`), "uploaded to Habblaud World" (`:68`), job board "click it to open enlarged" (`:100`, now a no-op), "the agy plugins" (`:206`).
- **M10. README nits:**
  - duplicated sentence (`:119`/`:121`);
  - `HABBLAUD_BIND` (`:367`, Docker-only);
  - "the mirror" listed as an idle activity (`:302`); it is now `mirror: false`;
  - no blank line before `## Accounts and usage` (`:432`);
  - the vague line `:149`;
  - the `server/README.md` API table is incomplete, though nothing in it is false.
- **M11. Repo hygiene:**
  - `.gitignore` still lists `HANDOFF*.md` and `docker-compose.override.yml`;
  - 7 orphan screenshots: `docs/screenshots/seasonal-*` (2) and `social-*` (5).
- **M12. Cosmetic:**
  - `server/sources/agy/source.ts:611` has redundant parentheses;
  - `tools/agy/install.sh:10` has a one-item `for f in agy-as` loop.
- **M13. A dropped Codex test leaves a theoretical case.** `server/accounts/detect.ts` lost `isCodexHome`. A folder named `~/.claude*` with a Codex layout would now be detected as a Claude account. That is negligible; the dropped test is not a regression in itself.
- **M14. A shared file can lose data.** `~/.agy_profiles/team.json` is shared with the still-installed Vi-Habblaud. On its next write, Bang_ver's `parseTeam` drops any `rules` key (`server/team.ts:137`). The real file has none today, so nothing is lost now. Worth a line in Plan 2, which rewrites the format.

### Triage of the ledger's deferred minors and parked items

- L29 (Task 0), the vitest EBADENGINE warning and the >500 kB Vite chunk: **defer**. Both existed upstream and are warnings only.
- L37 (Task 1), `'statusline'` in `AccountUsage.source`: **done**, 0 hits. `mod/habblaud/hooks/register.ts` is gone with `mod/`. The README script mentions are done.
- L39 (Task 1), the `server/accounts/usage.ts` statusline wording: **done**. The header now lists `cache`/`agy` only.
- L45 (Task 3):
  - the `agy/source.ts:22` news comment and the `NewsItem` plumbing: **done**;
  - the CSS `.ui-about__status/__new/has-update/is-new`: **done** (only the live `.ui-accounts__item.is-new` remains);
  - the CHANGELOG historical line about `HABBLAUD_UPDATE_CHECK`: **wrong** to remove. It is release history; keep it.
- L50 (Task 4), unused imports and the empty `render()` in the daystats/timeline files and `permissions/registry.ts detail()`: **done**, since those files were deleted. The demo vi keys are **done**. The lost "matches simulator" test is no lasting loss; I agree.
- L57 (Task 5):
  - the world protocol `codex` enum: **done**, deleted with `shared/world`;
  - `noQuota`/`'noquota'`: **done**;
  - Codex in the docs: **done**;
  - `shared/model-spec.ts` gpt-codex names: **wrong** to remove; they are remote model names.
- L59 (Task 5):
  - the orphan `detect.ts` `isFile` and the `AliasTool` union: **done**;
  - the `composer.ts` comment: **done**, file deleted;
  - the dangling separator in `help.ts`: **done**;
  - `office-from-world.ts`: **done**, deleted;
  - the `usage.ts` "files Claude Code writes" wording: **defer**. It is still slightly narrow (agy pushes too). Cosmetic.
- L64 (Task 7):
  - "timelapse" strings in the replay guards: **done**, 0 hits. One echo remains, the `context.ts:25` "alternative source" comment; that is M3, **defer**;
  - the `api.ts` double blank line: **done**;
  - `scene-switch.ts`: **done**, deleted.
- L70 (Task 8):
  - `ICONS.mic/stopRec/attach`: **done**;
  - `USAGE_SETUP_STEPS` → `usage:install` and `UsageInfo.via 'mod'`: **done**;
  - the `types.ts:360` mod comment: **done**;
  - the `spawn.ts:3` prose: **done**;
  - visit/scene-switch prose: deleted, but the visit code remains; see I5;
  - the vi strings: **done**;
  - CHANGELOG prose: partly. The Removed list is right; the stale Added bullets are M9, **defer**.
- L76 (Task 9):
  - the one-element tuple loop: **done**;
  - `.gitignore` `rules-log.jsonl`: **done**;
  - rules prose: **done**;
  - the unused vi key: **done**;
  - the ruling "keep AGY_OFFICE/AGY_WORKER on the agy worker path": **wrong**. See I2: on that path they only feed the still-installed Vi-Habblaud rules hook. **Fix-before-merge.**
- L81 (Task 10):
  - `QUOTA_ERROR`, the "Board shows 20" comment, the `ghosts.ts:2` comment, the `ghosts.stop()` indent and the overlong `OfficeInfo` comment: **done**;
  - the office-menu `separator` move: **defer**. Cosmetic.
- L86 (Task 11):
  - the stray "(camera follows),." in `CreateWorldOptions.visit`: **done**, but the option itself is dead; see I5;
  - `planOuting` `avail` entries `pingpong`/`talk`/`mirror` called "dead": **wrong**. The explicit `false` is what keeps those activities off. Keep them, and fix the README "mirror" claim (M10).
- L89 (Task 11), the vacuous scheduler global-cap assertion: partly addressed. **Defer**; see M6.
- L92 (Task 12):
  - **parked**: the visit/visitor machinery in `visitor.ts`, `sim.ts`, `index.ts` and `overlay.ts`. **Important, but may be deferred to Plan 2's first commit if recorded**; see I5;
  - `readBuildInfo`, `build-info.mjs` and `dist/build.json`: **done**. Nothing reads `build.json`; `createBuildReader` reads `dist/client/index.html`.
- L94 (Task 12), the orphan World vi keys and the redundant parentheses in `ui/index.ts`: **done**.
- L100 (Task 13):
  - the regression test for a stale `theme` pref: **done** (`client/src/ui/prefs.test.ts:80`);
  - the brief's misplacement: **no action**; I agree.
- L105 (Task 14, minors):
  - the one-item loop in `install.sh`: **defer** (M12);
  - herdr/roles.conf prose in CHANGELOG: the Removed list is right; Added `:65` is **defer** (M9);
  - the redundant parentheses in `source.ts`: **defer** (M12).
- L115 (Task 15, deferred to final review):
  - `HABBLAUD_BIND`, the duplicate sentence, the missing blank line and the vague line: **fix-before-merge** in the same README pass as I4;
  - the CHANGELOG agy-workers bullet (herdr/World): **defer** (M9);
  - the 7 orphan screenshots: **defer** (M11);
  - the incomplete `server/README.md` API table: **defer**.
- L121 (Task 16), the clock icon: **wrong** as a leftover. It is the live Session history button; no action.

### Flaky tests verdict

I agree all three are flakes, not regressions from the cut:

- `server/sources/tail.ts` changed in exactly one place in the range: a doc comment in 91a4fb1 ("Claude Code and Codex conversations" → "Claude Code conversations"). `tail.test.ts` is unchanged.
- `server/sources/watcher.ts` and `watcher.test.ts` were never edited.
- The ledger records upstream failures for both: tail failed 2 of 2 runs in Vi-Habblaud; watcher failed 4 of 10.

They do not block merging Plan 1. But spec §17.8 makes "vitest green" a v1 acceptance criterion, and `.github/workflows/ci.yml` runs `npm test`. So they need a deterministic fix or an explicit quarantine before v1 sign-off. A plan should own that.

### Declined to judge

- `.github/workflows/ci.yml` still runs on `main` with the flaky suite. CI configuration is outside Plan 1.
- `scripts/office.sh` has no `stop`/`restart` (spec §15 lists start|stop|restart). That is install work, Plan 3.
- Multiple offices, the team rule, seats and `names.conf` are Plan 2 by the plan's own split.
- The server-only `POST /api/spawn` and attachments with no client caller existed upstream (the button was removed before d916cf1). I judged only the README text (I4).
- The `package.json` name `habblaud`, version 1.0.3 and repository/homepage pointing at marmottajr/habblaud are a rename and branding decision, not in Plan 1.
- 74,979 lines against the plan's 37–42k is a plan estimate defect, not an implementation one. The filename sweep and the greps found no §16 row owned by Plan 1 left unaddressed, apart from the I5 and I6 residue.
- Two installs coexist on this machine: shared `~/.habblaud`, the shared `team.json`, and `~/.local/bin` still linking to Vi-Habblaud. Plan 3 owns the relinking. I flagged only the concrete effects (I2, M14).
- The remote subsystem's design (mDNS, self-signed TLS, whether `spawn` stays a remote feature) belongs to Plan 6 (§21). I judged only what this branch changed in it (I1).
- README "Read-only: never writes to the Claude Code folders" against the Accounts window creating `~/.claude-<name>` is an upstream claim, untouched by the cut.
- `HABBLAUD_PTY` being on under `npm run office` and off under `npm start` existed upstream.

### Verdict

**Merge after the listed Important fixes I1–I4.** They are small (about 30 lines plus one user decision for I2). I5 and I6 may move into Plan 2's first commit only if the ledger records them. The cut is complete and coherent, but it widened the remote default to conversation access, leaves the removed rules engine active through env vars it still exports, and ships help text and README instructions that point users at removed features or the wrong repository.
