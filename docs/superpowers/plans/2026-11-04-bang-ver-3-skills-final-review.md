# Plan 3 final review: aa3cb17..9a3751c (branch `bang-ver`, 18 commits)

### Strengths

Checks I ran (read-only; probes only inside the scratchpad, with `env -i HOME=<scratch> PATH=$PATH`):
- `python3 -m pytest -q tests` in `tools/agy`, with `HABBLAUD_*` and `CLAUDE_CONFIG_DIR` removed: **47 passed**.
- `npm run typecheck`: clean. `npm run i18n:check`: 1255/1255. `npx vitest run server/workers/service.test.ts`: 32/32.
- `bash -n` on install.sh, bang-init and skill-dirs, plus `sh -n` on office.sh: clean.
- The plan's verbatim script: `templates/task_board.md` and `templates/project_proposal.md` match spec §10 exactly (True/True).
- Probes: install.sh run from a copy under a `*/Vi-Habblaud/*` path; skill-dirs with a non-version entry; a comments-only `skills.list`; a dangling `CLAUDE.md` link; `CDPATH` with bang-init and with office.sh's `cd` rule (tested on its own); `agyTrusts` against six list shapes; `HOME` unset under bash and sh.
- On the real machine, read-only: the plugin cache holds one version per plugin and matches `installed_plugins.json`. `~/bang-test-office/.agents/skills.json` was read, nothing else.
- README has no `kill` or `pkill` left. `CHANGELOG.md:138` ("15 s … fails at once") is the existing Claude TRUST_WAIT entry and is still true. Commit trailers are 12 Opus and 6 Sonnet, which matches the ledger's trailer ruling, so they are not flagged.

Anti-goals (§3), checked:
- **No Claude plugin was added.**
- **Nothing in our code writes under `~/.agy_profiles/accN/.gemini/`.** `agyTrusts` and `settingsModel` only read. `agy-as` no longer writes the `agy-boss` plugin (`agy-as:1-25`); it creates only `.run` and the keyring folder in the profile root. The server writes `defaults.json` at the profiles root, not under `.gemini`. The only change under `.gemini` is the user-approved removal of the `office-rules` links (Task 9).
- **Headless still works:** Task 8 step 6 printed `H-OK` and Task 9 step 4 printed `I-OK`, both exit 0.
- **No feature over 300 lines:** +145 net code lines in total (M16).

Verdicts:
- **install.sh guards hold.** It removes only symlinks whose target matches `*/Vi-Habblaud/*` (`tools/install.sh:19-23`). `link()` never replaces a real file or folder (`:14-15`). It removes the plugin folder only with `rmdir` (`:38`). It runs under `set -eu`, and a bad argument is refused before anything is written (`:7`). An unset `HOME` stops it at `:9` ("unbound variable") before any write: I checked that neither bash nor sh sets `HOME` by itself.
- **A rerun on the state Task 9 left changes nothing.** I traced each step. The links already match. `drop_vi` finds nothing to remove. The profile glob matches nothing. Every `--worker` link already has the right target. So the only output is the sign-in lines. A machine with no Vi-Habblaud, or with only some profiles, also works, because an unmatched glob is a no-op.
- **The `--worker` rerun is correct.** It follows a plugin update, removes only links into `$HOME/.claude/`, and leaves real folders and foreign links alone. It has tests (`test_install.py:138-153`, `:179-182`).
- **bang-init and team.json are safe.** It writes with tmp+`os.replace` (`bang-init:48-49`). Broken JSON is left alone and bang-init exits 1, after writing `skills.json` (tested). It never creates `team.json`, and it keeps a folder that is already set. Key order and Vietnamese text are preserved.
- **Scratch-HOME discipline in the Plan 3 tests is real.** Every subprocess gets a fresh env dict (`test_install.py:61`, `test_bang_init.py:39`, `:55`), so no `HABBLAUD_*` can leak in. `test_env_from_the_caller_is_not_used` proves the variable is honoured, and the look-alike folder test proves the match is not too wide.
- **`agyTrusts` is read-only and placed right.** It never writes; every failure returns `undefined`. The check runs before the job is created (`service.ts:253`), so a refusal opens no terminal and queues nothing. It applies only to agy seats, the Claude path is unchanged, and `worker-ask` turns the 400 into exit 1 (`worker-ask:220-221`). The symlink forms only ever accept more folders, never fewer. The tests cover the trailing slash, `..`, symlinks in both directions, and the three unknown cases.
- **office.sh `stop`** checks the exact cmdline and the cwd, waits for the pid to exit and the port to close, and treats a missing `ss` or a pid-less listener as a refusal. `restart` builds before it stops.
- **M7, M8 and M9 are small and tested.** `staleAgyBosses` is a pure function. M8 only adds a `reason` parameter, with the default kept.
- **Line count.** No feature comes near 300 lines; the largest new file is install.sh at 73 lines.

### Issues

#### Critical

None.

#### Important

**I1. `agyTrusts` refuses every job when agy changes the format of its trust list** (`server/workers/turns.ts:95`, `:105`).
- The fallback to "proceed" covers only a missing file or a missing key.
- If an agy update keeps `trustedWorkspaces` but stores objects (probe: `[{path: <folder>}]` returns `false`), `file://` URIs (`false`) or `~/…` paths (`false`), then **every** agy seat job in the office is refused.
- The message then tells the user to run `agy-as accN` and answer yes. That cannot help: either agy does not ask, or it writes the same unrecognised form again. There is no override.
- Fix (2 lines): return `undefined` unless the array holds at least one string and every string is absolute (`isAbsolute`). Say in the comment that this reads an undocumented agy file layout and that it assumes absolute paths and exact-path trust.

**I2. `CDPATH` sends bang-init and office.sh to the wrong folder** (`tools/agy/bin/bang-init:6`, `scripts/office.sh:6`).
- bang-init probe: with an exported `CDPATH` that holds a folder of the same name, `folder=$(cd "$1" && pwd -P)` captured the path twice, separated by a newline. The office files went under a folder literally named `p3\n…` in the CDPATH entry, and that broken path would have been written into `team.json` as `folder`.
- office.sh probe: `cd scripts/..` landed in the CDPATH match (`…/rv4/b`). `start` would then build and launch from another folder.
- It only happens with an exported `CDPATH` that does not start with `.`, so it is unlikely. But the corruption is silent, and the fix is `unset CDPATH` near the top of each script.

**I3. bang-init never mentions `skills.list` or what the skills cost per job** (`bang-init:55-64`).
- Without a `skills.list`, every agy job carries every skill description. The spike measured 24,637 input tokens unfiltered against 8,306 filtered (probe A against probe 0); spec §18 estimates 30–60k.
- A user who never reads README §"Start a project" pays about 3× per agy job without knowing why.
- Fix: one line in "Next", e.g. `Antigravity jobs carry every skill description (~25k tokens); list the ones you want in <folder>/skills.list and run bang-init again.`

**I4. Stale absolute paths in `skills.json`: the ledger carry is not done, and the live fixture is already broken.**
- README:151-153 says to re-run bang-init after a plugin update, but not after the repo moves (ledger carry "mention the repo move too"; `grep -i move README.md` finds nothing).
- `~/bang-test-office/.agents/skills.json:40` points at `/home/nhatbang/bang-ver-accept5/skills`, a deleted worktree. `task-8d-report.md:13` says so, and nobody re-ran bang-init from the main repo afterwards.
- Plan 4–5 acceptance uses that folder, so its agy seats would load no Bang skills: the 8d failure a third time.
- Fix:
  - Add a README line: "re-run after the repo moves or a plugin updates".
  - Before Plan 4, once: `HABBLAUD_DATA_DIR=~/.bang-test-data ~/.local/bin/bang-init ~/bang-test-office` (the main repo through the link).
  - Plan 4's acceptance brief should say "bang-init only through `~/.local/bin`, never from a worktree".

#### Minor

- **M1. install.sh removes its own links when the repo lives under a `*/Vi-Habblaud/*` path** (`tools/install.sh:21`, `:32`).
  - Probe: a copy under `…/Vi-Habblaud/fork` links `worker-ask`, `agy-as` and `bang-init`, then removes them in the same run. It leaves `agy-ask` and `claude-ask` dangling, exits 0, and repeats this on every rerun.
  - A plausible way to hit it: checking out `bang-ver` inside an existing Vi-Habblaud clone. The user's own layout (sibling folders) is not affected.
  - Fix (one line in `drop_vi`): skip targets under `"$agy/"`.
- **M2. `skill-dirs:6` drops a whole plugin when its newest entry is not a version folder.**
  - `sort -V | tail -1` takes the last entry; if it has no `skills/`, nothing is printed for that plugin (probe: `1.2.0` plus `latest` gives no plugin line).
  - SHA-named versions sort arbitrarily (the ledger's Task 2 minor).
  - Fix: take the newest entry that has a `skills/` folder, e.g. `ls "$p" | sort -V | while read v; do [ -d "$p$v/skills" ] && echo "$p$v/skills"; done | tail -n 1`.
- **M3. A `skills.list` with only comments or blank lines writes `include_only: []` on every entry** (`bang-init:27-28`, probe). What agy does with that is unverified; it most likely loads no plugin skills at all. Either skip the filter when the list is empty, or say what an empty list means.
- **M4. bang-init treats dangling links two different ways.** At `:13`, `[ -e CLAUDE.md ]` writes the placeholder *through* a dangling `CLAUDE.md` link (probe: it created `../elsewhere/CLAUDE.md`). At `:14`, a dangling `GEMINI.md` counts as present.
- **M5. bang-init compares `folder` as plain strings** (`:46-54`).
  - A hand-written folder with a trailing slash or a symlink spelling gets "the office folder is X: edit … to change it", even though it is the same folder.
  - A relative `folder`, which the server treats as unset (`team.ts:88`), is reported as set.
  - Fix: compare `os.path.realpath`, and treat a non-absolute value as empty, like the server.
- **M6. The three `team.json` path rules agree on absolute values but not on the edges.** (All three trim the variable and agree on unset, empty and whitespace-only `HABBLAUD_DATA_DIR`, and on `HOME=…/.agy_profiles/accN`. bang-init strips any depth below `.agy_profiles`, worker-ask exactly one level; that difference is unrealistic.)
  - Relative `HABBLAUD_DATA_DIR`: the server `resolve()`s it against its own cwd, which is the repo root through office.sh (`config.ts:139`). `worker-ask:44` and `bang-init:31` use the caller's cwd. office.sh agrees with the server only by accident (it `cd`s to the repo).
  - A literal `~` is never expanded by any of them.
  - `office.sh:10` does not trim, so a whitespace-only value makes a folder named `"   "` in the repo for the log.
  - Unset `HOME`: bang-init falls back to `""` (`/.habblaud/team.json`, an empty skill list), while the server and worker-ask use the passwd home.
  - Fix: a README clause "`HABBLAUD_DATA_DIR` must be absolute", and `: "${HOME:?}"` in bang-init.
- **M7. `HABBLAUD_AGY_PROFILES` has four different rules.**
  - The server trims it (`profiles.ts:14`); `worker-ask:41` and `install.sh:33` do not; `agy-as:7` ignores it and always uses `$HOME/.agy_profiles/<acc>` (this predates Plan 3).
  - With a custom root, `agyTrusts` reads one profile while agy runs in another, so the refusal's own advice cannot clear it.
  - Seat jobs are already broken under a custom root (the brain folder lookup has the same split), so this is a note, not a new break.
- **M8. M9 meets Plan 2's lossy parser** (`team.ts:92`, `index.ts:100`).
  - `cleanTeam` turns an invalid boss (a typo such as `"kind": "Agy"`, or an account with a space) into `{claude, default}`.
  - `onChange` then closes the **live** agy boss terminal.
  - Before M9 a typo only took the crown away. This fits the "the file is the truth" rule, which already ends a mistyped seat's job, but a typo is now destructive for the boss.
  - Fix: only close when the raw file's boss entry is valid, or say so in README.
- **M9. office.sh's refusal does not say why** (`office.sh:33-34`).
  - A `npm run dev` server, or one started with an absolute `node` path, from this same repo is called "another server" and shown with this repo's cwd. Print `$cmd` as well.
  - The ledger's Task 7 nit is still there: README:647 says "run from that server's own folder", but office.sh `cd`s into its own repo anyway. Better: "the stop of that server's own repo".
- **M10. `install.sh:15` prints `left … not a link` to stderr, while `:38` and `:58` print `left` to stdout.** Task 9 checked "no `left` lines" on `| tee` output, which is stdout only. The after-state diff makes it moot this time.
- **M11. The `turns.ts:88-90` comment is out of date and partly wrong.**
  - It still says agy "matches the exact path", without "also accepts the real path of a symlink" (ledger round-2 minor, routed to the final fix wave, not applied).
  - "An interactive agy in another folder stops at a trust dialog" contradicts the 8c result: agy runs the prompt *behind* the dialog. `service.ts:252` says it correctly.
- **M12. Docs gaps.**
  - `tools/agy/README.md`'s "What is here" table lacks `bin/skill-dirs`.
  - Its "once per Antigravity account" step does not mention the per-folder trust run.
  - In README, "Give jobs" (step 4, :120) comes before "Start a project: bang-init" (:130) and the trust paragraph (:145). A first-time reader's first agy job is refused; the message is clear, so they can recover.
  - README never says to re-run `tools/install.sh --worker` after a plugin update. Links in `~/.claude-worker/skills` then dangle, and the Claude seats silently lose those skills.
- **M13. Example rows in the template meet the `bang-task` rule.**
  - `templates/task_board.md:11` has `T1 … | W1 | doing: 12/50`.
  - `skills/bang-task/SKILL.md:13` says "A row of yours still `doing:` … finish it first".
  - So a seat named W1 (the user's real naming) may pick up a phantom OCR job.
  - `:2` lists example seats, not the real team, and `:19` is the example Bài học line.
  - The templates must stay verbatim, so bang-init cannot strip these; Plan 4 has to (see readiness).
- **M14. `tools/agy/tests/test_worker_ask.py:92` copies the caller's whole env** except `AGY_`, `BANG_` and `CLAUDE*`. A `HABBLAUD_AGY_PROFILES` in the runner's shell redirects the headless log (`agy-ask.log.jsonl`) and `defaults.json` to the real profile root. This predates Plan 3 and is outside the range; the Plan 3 test files are clean.
- **M15. The plan file is unfinished.** "Để lại cho kế hoạch sau" is still `_(Điền khi xong Task 9.)_` (plan:637-639), and the Task 9 results sit before the Task 8 results.
- **M16. The recorded line count is stale.** At HEAD the non-test code is +279 −134 = **+145** (the +112 was measured at 38139bb, before the 8b fix rounds). With `skills/` and `templates/` it is +290. That is still well under 300 per feature (the largest is install.sh at 73), but the record should say +145.

### Triage of deferred items

| Ledger line | Triage |
|---|---|
| T1: "(Habblaud)" at `skills/giao-viec/SKILL.md:22` | defer: Plan 4 rewrites `giao-viec` |
| T2 → T3 carry: verbatim template comparison in `test_bang_init.py`; scratch env for the skill-dirs test | done (`test_bang_init.py:66-69`, `:55`). Note: the test compares the copy with `templates/`, not with spec §10; the plan's one-off script covers that (re-run: True) |
| T2: stale `team.json.bang-init.tmp` after a failed replace | defer: harmless, the server never reads it and the next run overwrites it |
| T2: pre-release/SHA plugin versions sort | defer, but merge with M2 (the plugin is dropped entirely, worse than sorted wrong); cheap fix |
| T3 minors (exclude the 3 Bang_ver skills in `--worker`; "safe to run again" header) | done (`install.sh:48`, `:5`) |
| T4 → T7: README port-kill lines | done (no `kill` left in README) |
| T4: zombie edge (`kill -0` on a zombie) | defer: the process is reparented to init |
| T4: deploy spec sources `~/.habblaud/hub.env` | defer to Plan 6 |
| T5: `publishBoard` compares against the raw folder (ruled moot) | agree, moot: `team.folder` is already normalized (`team.ts:88`) |
| T5: no test for the board moving when the folder room appears | defer |
| T6: "＋ Worker" unreachable only because there is one office | agree, no action |
| T7: `advisor` command missing until Plan 5; install.sh's advisor entry inert | defer to Plan 5 (the skill already says "missing → `blocked:`") |
| T7 nit: README:641 (now :647) "run from that server's own folder" | fix before Plan 4 (one line, M9) |
| T8b: widen the regex with the option line; "the check runs once" | wrong, obsolete: the screen-scrape was removed in fadf77b |
| T8b: bang-init hint for a Claude-only team | done (`test_bang_init.py:142-144`) |
| T8b: agy boss account not listed in the hint (`bang-init:44`) | defer: the agy boss terminal shows the dialog to the user, who can answer it there |
| T8b round 2: the realpath accept depends on how agy spells paths ("parked") | agree with the ruling: a false accept only restores the pre-fix behaviour |
| T8b round 2: the `turns.ts:88-91` comment (→ final fix wave) | fix before Plan 4 (M11; also fix the "stops at a trust dialog" sentence) |
| Carry: re-run bang-init after a repo move (docs) | fix before Plan 4 (I4: not done, and the live fixture is already stale) |
| Carry: "Task 9's bang-init must run from the MAIN repo" | fix before Plan 4 (I4: the fixture still points at accept5) |
| 8c ruling: RSS gate "HEAD ≤ previous plan + 2 % (A/B)" | accept, with the changes below |

**RSS gate.** Base 113,336 kB against HEAD 113,846 kB (+0.45 %) is within noise. One HEAD run varied by 680 kB between its two runs (114,188 and 113,508), so I agree Plan 3 did not regress. On the proposed gate:
- A ratchet against the *previous plan* compounds. Three more plans at +2 % each is about +6 % (≈7 MB); six would be about +12 %, all without the gate ever failing.
- Anchor it instead: "HEAD ≤ anchor + 3 %", where the anchor is aa3cb17 (or the fork), re-measured in the same alternating A/B session each time, with at least 3 pairs, since the noise between runs is 0.5–0.9 MB.
- Re-baseline the spec's absolute figure once, on today's machine, by measuring the fork. Then the 110 MB in §3/§17 becomes a live number again; today it is a dead letter.

### Plan 4 / advisor-spike readiness

- **Preamble.** worker-ask builds the prompt in one place (`args()`, `a["prompt"]` at `worker-ask:113`), and both the office path (`:203`) and the headless path read `a["prompt"]`. So prepending the §12 preamble once there covers both. Seat name and office folder are already in `a` (`worker`, `folder`). Read "Bài học" from `<folder>/task_board.md`, the office folder, not from `--cwd`.
- **Example Bài học line.** `templates/task_board.md:19` would be injected into every prompt (plan decision 5 already says so). Plan 4 must also handle the phantom `T1 | W1 | doing:` row (M13) and the example "Ghế" line (`:2`). Options: Plan 4's bang-init writes the real seats and drops the example rows from the *copy* (the templates stay verbatim), or the preamble skips the example lines.
- **6-header check and `--raw`.** Unknown flags go into `a["extra"]` and are passed straight to agy or claude (`worker-ask:128-129`). `--raw` must be parsed explicitly; otherwise it reaches agy as an argument. Put the header check after the preamble is decided, but on the boss's own text (`a["task"]`).
- **20k cap.** `service.ts:247` refuses a prompt over 20,000 characters. The preamble, Bài học (up to 20 lines), the 6 parts and "Kết quả review lần trước" with diffs can exceed it. Raise it there, and check the `/api/agy/jobs` path as well. The headless path is limited by argv (128 KiB per argument), not by this cap.
- **`giao-viec` content to replace.**
  - Its exit table (`SKILL.md:30`) says exit 1 → "retry once or do it yourself". The new trust refusal is exit 1, retrying cannot help, and the boss should tell the user to run `agy-as <acc>`.
  - `:48` "`auto` is not available" contradicts spec §14 (`auto` is the default in the office folder).
  - `:22` still says "(Habblaud)".
- **First real use after the 4747 restart.** The import brings in 7 agy seats (`acc1`…`acc7`). Since trust is per account and folder, that is 7 × `cd <folder> && agy-as accN`, answer yes, `/exit`, before any agy job runs. bang-init lists the accounts. Tell the user up front.
- **Advisor spike (Plan 5).**
  - Installing `advisor` needs no change: `install.sh:25` links it once `tools/agy/bin/advisor` exists.
  - `staleAgyBosses` guarantees at most one live agy boss terminal, which gives the advisor one clear PTY to type into.
  - Still open for Plan 5: M2 (agy boss conversation swap), and the agy boss typing mid-turn. Nothing in Plan 3 makes these harder.
- **Fixture.** Re-run `bang-init ~/bang-test-office` from the main repo (I4) before Plan 4's acceptance, or step 4 fails again.

### Declined to judge

- `team.json` mode changes 600 → 664 after bang-init's replace: the server's own writer does the same, and the file holds no secrets.
- The skill source includes plugins that are disabled or uninstalled but still in the cache: spec §8 says "the newest version in the cache", and the user chose "all of them is fine".
- office.sh `start` probes only `127.0.0.1`, so a server bound to another host is not seen: this predates Plan 3 and §21/Plan 6 own the host settings.
- After a refused `restart`, the newly built `dist/` sits under the old running server: plan decision 9 ("build before stop") was a deliberate trade.
- Odd `HOME` values (empty, `/`, relative, trailing slash): install.sh fails safely or stays self-consistent. Root is not a target user.
- Plugin paths with spaces are skipped in skill-dirs and `--worker`: a documented `shortcut:`, and the real cache has none.
- Two writers on `team.json` at once (the server's first-start import and bang-init's write): the server writes only when the file is missing, and bang-init only when it exists.
- `HABBLAUD_AGY=0` gives no job board: plan decision 11 records it, and the user always has agy on.
- Whether agy reads `include_only` from `skills.json` the same way in later versions: the spike verified the current version, and later ones cannot be judged.
- Live RSS: I was told not to run the server; I judged the reported A/B numbers.

### Verdict

**Ready after the listed Important fixes.** Nothing is Critical; I1–I3 are each a 1–2 line code change, I4 is one README line plus one `bang-init` run from the main repo, and the rest can ride with Plan 4.

---
Not checked: no live agy, claude or server run (as instructed); the full vitest suite was not run (one focused file only); `client/` render changes were read, not run.
