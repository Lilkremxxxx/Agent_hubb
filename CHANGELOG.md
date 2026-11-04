# What's new

What went into each version. Older versions are the history of Habblaud, which Bang_ver is forked from.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and numbers follow
[semantic versioning](https://semver.org/): a fix bumps the last number (0.2.**1**), a new feature bumps the
middle one (0.**3**.0).

## [Unreleased]

### Added

- **`skills/`** with `giao-viec`, `advisor` (a placeholder until the command exists) and `bang-task` (the `task_board.md` rules), and **`templates/`** with `task_board.md` and `project_proposal.md`.
- **`bang-init <folder>`** prepares a project folder: the two templates with the name and folder filled in, `.agents/skills.json` for Antigravity (absolute paths plus this repo's `skills/`), `include_only` from `skills.list`, three links in `.claude/skills/`, `GEMINI.md` linked to `CLAUDE.md`, a placeholder `CLAUDE.md` when there is none, and `folder` in `team.json` when it is empty. It does not create `team.json` and keeps another folder.
- **An Antigravity seat job in a folder its account does not trust is refused before it starts**, saying to run `agy-as <acc>` there once and answer yes (otherwise agy runs the job behind its trust dialog, with no Bang skills). The server only reads agy's trust list (`trustedWorkspaces` in the account's `settings.json`) and never answers trust. `bang-init` prints the one-time step.
- **`tools/install.sh --worker`** links the skills into `~/.claude-worker/skills` and prints the login command.
- **`worker-ask` refuses a job that lacks the title or one of the 6 parts of the `giao-viec` skill** (exit 1, naming the missing part); `--raw` skips this check.
- **Every `worker-ask` job starts with the seat's preamble** (seat, folder, worker rules, the "Bài học" lines of `task_board.md`), in the office and headless paths.
- **The `giao-viec` skill is rewritten:** the 6-part template, background jobs, review by command, at most 2 fix rounds, lessons, and an exit-code table that includes the refused-job case.
- **`npm run office -- stop|restart`**; they only stop this repo's own server on the port (exact command and folder check).

### Changed

- **Antigravity seats run `auto` when no `--mode` is given** (it was `plan`); the page's "Defaults for jobs" table has Automatic.
- **The prompt cap is 100 kB of UTF-8** (it was 20,000 characters), and `worker-ask` reports at once when a job goes over. Known edge: a page "Send a job" prompt close to 100 kB plus the preamble can exceed the cap, and the page ignores `worker-ask`'s exit 1.
- **The job board and the feed show the boss's own text**, not the preamble. A job sent from the page to a seat without a terminal runs `--raw`.
- **`bang-init` writes a `task_board.md` with the real boss and seats and no example rows**, and warns when an older board still has the example rows.
- **A typo in `boss` in `team.json` keeps the boss it had** (logged once), so a live Antigravity boss terminal is no longer closed; leaving `boss` out is still the Claude default.
- **Trust check, `bang-init`, `install.sh`, `office.sh` fixes**: an agy trust list in a layout we do not know (not only absolute paths) no longer refuses jobs; `CDPATH` cannot redirect `bang-init` or `office.sh`; `bang-init` mentions `skills.list` and ignores a comments-only list; `install.sh` keeps its own links when the repo sits under a `Vi-Habblaud` path; `skill-dirs` takes the newest version that has `skills/`.
- **`tools/install.sh`** replaces `tools/agy/install.sh`. It also links `bang-init`, no longer links skills into `~/.claude/skills`, never replaces a real file, and removes the Vi-Habblaud leftovers (`~/.local/bin` links into it, the `agy-orchestrator` and `office-rules` links in `~/.claude/skills`, the `office-rules` plugin links in each Antigravity profile). Running it again changes nothing.
- **The job board lives in the room of the office `folder`** (so a Claude-only team has one); with no room for the folder yet it falls back to the room of the first Antigravity character. Removing a seat that has a job makes the job point at `team.json`. Switching the boss (kind or account) closes the old Antigravity boss terminal.
- **One job per seat** (BUSY per seat, `worker-ask` exit 3, instead of per account). Seats on one Antigravity account start one after another: the second waits until the first's conversation appears, up to 30 s.
- **Every terminal and every job runs in the office `folder`**, with `BANG_SLOT` and `BANG_OFFICE` set. An empty or missing `folder` refuses jobs and "Open the boss" with a message that points at `team.json`.
- **`worker-ask <seat> "<prompt>" [--mode …] [--lean] [--cwd DIR] …`** replaces `agy-ask`/`claude-ask` by account. Anyone may give jobs (there is no team rule). Claude seats run full; `--lean` runs them light.
- **Seats are a flat file:** `<HABBLAUD_DATA_DIR or ~/.habblaud>/team.json` (`{folder, boss: {kind, account}, workers: [{name, kind: claude|agy, account}]}`), imported once from `~/.agy_profiles/team.json`, which is never written. Claude `account` `default` is `~/.claude`, `x` is `~/.claude-x`.
- Antigravity characters are made from the seats (one per seat); a worker's name is its seat name.
- The server and the page's "send a job" run the repo's own `tools/agy/bin/agy-as` and `worker-ask`.
- The overload toast now says "Save your work and start a new session" (it named a HANDOFF file that no longer exists).
- `remote:setup --allow` help shows the real default (`none`, view only).

### Removed

- The `agy-orchestrator` skill (now `giao-viec`).
- Several offices on the page: the office tabs and their menu, the new-office, rename, folder and delete dialogs, and ＋ Worker.
- The team rule (only the boss gives jobs; the call-chain check in `agy-ask`).
- `names.conf` and the manual Antigravity terminal (`POST /api/pty {agy}`), which nothing called.
- The dead visit code in the office canvas.
- Release tooling, Docker (`docker:up`, compose files), the legacy statusline and permission-hook installers and the statusline tap.
- The update checker (the "New version" badge) and the news feed.
- Demo mode (`?mock=1`, `npm run demo`, the simulator).
- Codex support (sessions, hooks, usage, bridge).
- The day timelapse and "My day" statistics.
- The Claude Code mods and plugins (usage, permissions, messages) and what depended on them: answering permission requests and questions from the office, sending messages to agents, deliveries, and dictation.
- The office rules engine ("Nội quy": rules, scope, limits, refusals, the rules hook).
- The Board (to-do list, jobs and news tabs) and the `HANDOFF.md` to-do list.
- The social simulation (hangouts, personalities, coins) and the Hangouts sounds.
- Habblaud World (the online city, visits, uplink, account and waiting list).
- Seasonal decorations (Christmas and Halloween themes).
- `herdr`, `agy-up`, `agy-mode`, `agy-sync` and `roles.conf`.

### Added

- **Seats:** one office, one `folder`, one boss and workers in `team.json`; edit the file to add or remove seats (re-read every second).
- **The boss button:** ＋ next to Boss opens the boss (`boss.kind`) in `folder` (`POST /api/team {openBoss: true}`; no folder answers 400 and points at `team.json`). 👑 Make boss on an open Claude session still works.
- **Job board in the workers room:** the wall board shows the latest order given to the boss and the recent jobs (seat, role, status); a new job sends the worker to the board to "hear" it before it heads to its desk.
- **Workers have a terminal of their own:** a job (`worker-ask`, or "Send a job") restarts the seat's terminal with the request as its first message, so every job is a fresh conversation. The caller waits without spending tokens and gets only the final answer. The terminal is read-only to watch, closes after 20 minutes idle, and a seat on a job refuses another (BUSY).
- **"Send a job" and "Defaults for jobs":** every worker's drawer can send a job with mode and effort (low, medium, high), and keeps defaults for jobs without `--mode`/`--effort` in `~/.agy_profiles/defaults.json`.
- **The boss, appointed by you:** one Claude Code session wears the crown and a gold BOSS badge ("👑 Make boss" / "Step down" in its drawer); the choice is kept in memory only (reopen the boss with the boss button or 👑 after a restart). A closed boss stays named in the Boss group.
- **The sidebar by role:** Boss, Workers and Others (folded by default); each Claude row says its folder.
- **"Boss overloaded" warns you:** when the boss passes a threshold a notice appears once per level and suggests a new session; an overloaded boss's notice stays until dismissed.
- **Antigravity workers' usage and jobs:** each account's 5-hour and weekly `/usage` every 15 min (`HABBLAUD_AGY_USAGE_MIN`; 0 disables; `HABBLAUD_AGY=0` turns the Antigravity workers off), and a finished job shows its duration and tokens from the `agy-ask` log.
- claude-mem observer sessions are hidden from the office (and from the source's session count).
- **Accounts window (👤 on the toolbar):** every Claude Code and Antigravity account on this computer, apart from
  sessions: e-mail, 5-hour and week usage, and "Sign in again". "＋ Add Claude account" asks for a name, makes
  `~/.claude-<name>` (watched at once, no restart) and opens `claude auth login` in it; "＋ Add Antigravity account"
  makes the next `~/.agy_profiles/accN` and opens agy in it to sign in with Google (an unfinished one is reused).
  Needs the interactive terminal (`HABBLAUD_PTY=1`).
- **Antigravity workers named after their seat:** the seat's name from `team.json` on the character; the line under the name shows the role Claude gave the job (`agy-ask --role`) or
  "free".
- **Model and effort on every character.** The name tag on the floor (when zoomed in, hovered or selected), the
  drawer (new Effort row) and the role tooltip show what each agent really uses: "Opus 5.5 · high" for Claude Code
  (model, effort and permission mode of its last answer, from the transcript), "Flash 3.8 · low" for an Antigravity
  worker (read from the agy log of the running job: what agy applied, not only what was asked).
- **Antigravity worker defaults.** Every worker's drawer has "Defaults for jobs": mode (read only, default, can edit)
  and effort (low, medium, high), saved at once to `~/.agy_profiles/defaults.json`. agy-ask uses them for calls
  without `--mode`/`--effort` (jobs sent from the office included); Claude passes its own for each job. "Send a job"
  no longer has its own mode and effort.
- Signing in to an agy account is in the Accounts window.
- **Claude Code account cards named the same way:** "alice (Claude)" (the part of the account e-mail before @)
  instead of "Account A"; without an e-mail in `.claude.json` it stays "Account A".
- **Interface in English and Vietnamese only.** English is now the source language of the whole code base (texts,
  comments, docs); Vietnamese is the only translation (Settings › Language, or `HABBLAUD_LANG=vi` for the server).
  Portuguese, Spanish and French were removed; without a language set, everything is in English.
- **Antigravity account without Pro:** an account whose `/usage` only has the weekly limit hides the 5-hour meter
  (the tooltip says "none (plan without Pro)") and its `/usage` no longer waits for the timeout.
- **Antigravity workers gamified.** Each has a level, job title (Intern → Legend), XP from completed jobs, and
  achievements (🐣 first job, ⚡ lightning, 🦉 night owl, 🏃 marathon, 👻 survivor, 🔥 unstoppable, 💯 centurion,
  💰 token millionaire), all parsed from the agy-ask log; leveling up or unlocking an achievement throws a party in the
  room. 🔥 Full house when all work simultaneously.
- **Clicking the selected agent again**: it responds with a speech bubble for the current moment.
- **Easter egg:** ↑ ↑ ↓ ↓ ← → ← → B A throws a party across all rooms.
- **Dragging characters.** Press on an agent and drag: it gets picked up ("Put me down!"), lands wherever you release
  (even in another room), gets dizzy, and walks back to its room.
- **"Boss overloaded" (H).** A Claude Code session whose context passes 60% of the window (or that was compacted)
  gets tired: a drop of sweat over the head; from 80% (or two compactions) it is overloaded (😵 and 💤) and a 🥵
  button appears in the toolbar. Its dialog opens a new session in the same folder. Read from the transcript, no
  tokens. The window is guessed from the model (1M for the Claude 5 generation and "[1m]" variants, 200k otherwise), so
  an Opus 5.5 session at 422k is no longer "overloaded".
- **New Claude Code sessions drop from the sky** onto their desk (into a room that is already lit; the first one into a
  new room still takes the elevator and turns the light on).
- **Hold Alt to see what everything does.** The screen dims and every button and area you can see gets a short note
  ("Take over here", "End", the usage cards, the drawer sections…); release Alt and it is gone. Alt in
  a text box or the terminal is left alone, and Alt+Tab never flashes it. Without a keyboard, Help has a
  "👀 What does each button do?" button that shows the notes until the next tap.
- **Account usage moves into the 👤 Accounts window:** the top bar has no usage cards anymore (they grew too long with
  many accounts). The 👤 button shows "⚠2" when accounts reach 80% of their 5-hour or weekly limit (named in its
  tooltip), and those accounts are red in the window. The boss and each worker in the sidebar show their account's 5-hour
  and weekly quota as two small bars with the exact % (orange at 50%, red at 80%; hover for the reset time). The sidebar's account filter chips are gone (a hidden account
  just vanished from the list); accounts hidden with them are shown again.

- **Lean Claude Code workers for `claude-ask`:** a job from `claude-ask` starts the worker without MCP servers,
  skills or slash commands and with only Bash, Read, Edit, Write, WebFetch and WebSearch, plus a short rule to answer
  compactly under the caller's limit (`claude-ask --full` keeps the account's full setup). A job then starts at ~8k
  tokens of context instead of ~24k. Jobs from "Send a job" are unchanged.
- **Quota as energy:** the coffee mug on a boss's or worker's desk empties as its 5-hour quota is used (the weekly one
  for plans without a 5-hour window). With the quota exhausted and nothing to do, the character sleeps at its desk
  under a steady 💤, skips strolls and gatherings, and wakes by itself when the window renews; hover it for when.
- **Hung workers as ghosts:** a worker whose job shows no progress for 10 minutes (no transcript or log writes), or an
  agy process alive with no job (its parent gone or its job over), turns into a faint ghost on its seat; hover it to see for how long. Nothing is stopped: the ghost clears by itself when
  the job moves again or the process goes away.
- **"Boss overloaded" thresholds in Settings:** when a session counts as tired or overloaded (share of the context and
  compactions) can now be set under Settings › 🥵 Boss overloaded. The defaults stay 60% or 1 compaction and 80% or 2.

### Fixed

- **A worker signed in moments ago can be added at once:** adding an Antigravity account whose profile appeared
  since the last re-read of `~/.agy_profiles` (every 30 s) said "account not found"; the profiles are now re-read first.

- **A job no longer comes back with an old answer:** a job for a worker whose terminal was still closing could
  take an older conversation of that account (and its answer) as its own and end at once. `claude-ask --model` (and
  `agy-ask --model`) now reaches the worker's terminal too.
- **Claude Code workers' token count includes the cache:** "Done in … · N tokens" and the job log counted only
  input and output tokens, leaving out the cached prompt read and written (most of a job's tokens). The log now
  also has them by kind.
- **A Claude Code worker's job no longer hangs in a folder its account does not trust:** claude stopped at the
  "trust this folder?" question before reading the job, and the job waited until its timeout (30 min). Now, when the
  conversation has not started after 15 s and the account has not trusted the folder (or a parent), the job fails at
  once and says to open claude there once and answer yes, or to give the job another folder.
- **The worker scripts ship with Habblaud:** `worker-ask`, `agy-as` and the
  skills are in `tools/agy`, and `tools/agy/install.sh` sets them up.

- **`npm run office`** builds Habblaud and starts it in the background with its web terminals on.

- **📖 User guide** at the top of Help (?): one folded topic each, from starting the office to reading the characters.

## [1.0.3] - 2026-10-16

### Fixed

- **City: “Reply” and “Show in office” in notifications return to the office and open the agent request.** With
  the city open, clicking a request or question notification (and in the browser notification, topbar requests chip,
  and Deliveries) did nothing visible: the agent was selected behind the city. Now the city closes, the drawer opens
  on the agent, and the request card receives focus.

## [1.0.2] - 2026-10-16

### Fixed

- **City: enter and like work again after backgrounding the tab.** After half a minute with Habblaud in another
  tab or window, the character stopped sending its position to Habblaud World: it walked on screen, but "Enter"
  and like prompted to get closer to the door.

## [1.0.1] - 2026-10-16

### Fixed

- **City: keys walk again.** In 1.0.0, with release popups and the Habblaud World window on the page, WASD, arrow keys,
  and office shortcuts stopped responding even when everything was closed: a closed `<dialog>` remains on the page
  and was mistaken for an open modal. Only open dialogs count now.

## [1.0.0] - 2026-10-16

Why 1.0: the office (rooms, characters, subagents, usage per account, terminal, timelapse, mobile with login) has been
stable for several versions, and Habblaud World arrives complete: account, character, building, city, visits, and
lightweight social features. To update: `git pull` and `npm run docker:up`.

### Habblaud World

Habblaud's online city is live: each Habblaud instance becomes a building, lit up live while agents work, and each
person walks around the city with a character. **Enabled by default**, pointing to `server.habblaud.com`; **nothing
leaves your computer until you create an account** and log in, and `HABBLAUD_WORLD=0` disables everything (even hiding
the routes). Access is granted via waitlist. What may leave and what never leaves is detailed in
[`docs/world/privacidade.md`](docs/world/privacidade.md); the README has the full **Habblaud World** section.

- **Configure and test:** without `HABBLAUD_WORLD_URL`, the official server (`https://server.habblaud.com`; `npm run
  docker:up` and server logs say "(default)"); when set, the defined URL is used (only `https://` or `wss://`; if
  rejected, World stays disabled, with the reason in the log). `HABBLAUD_WORLD=0` disables everything, and
  `HABBLAUD_WORLD_DEV=1` accepts a local world server without TLS at `http://127.0.0.1:<port>` (`npm run dev` already
  accepts it) or from inside Docker at `http://host.docker.internal:<port>`. `docker-compose.yml` forwards all three
  variables and connects `host.docker.internal` to the host (`extra_hosts` with `host-gateway`, harmless on macOS),
  and `npm run docker:up` ends by stating whether World is enabled and for which server. The build saves
  `dist/build.json` with the commit hash and dirty state flag (sent in the building connection's first message).
- **Dedicated window:** Habblaud World gets its own button on the top bar (the city icon next to Settings; only
  appears when a world server is configured) and opens in its own modal outside of Settings: pixel-art building,
  account state in the header, and everything else in a scrollable body. The "in world" chip next to the version,
  launch popups, and the "While you were away" notice open this same window to the appropriate screen.
- **Account:** inside the Habblaud World window. **Create account** (email and password of 12 characters or more,
  summary of what leaves and what never leaves the computer, truthful data clause, and mandatory agreement to Terms of
  Use and Privacy Policy; anti-bot challenge is solved by Habblaud itself) or **I already have an account**; 6-digit
  code with resend; **Forgot password**; **Devices** (up to 3, with revoke) and log out. On the waitlist, only a notice
  without position or estimate, and an open Habblaud automatically checks every 30 minutes if access was granted. All
  local-only: never through the mobile port, and account actions require local access (terminal lock). The device
  token lives in `~/.habblaud/world.json` (permission 600; in Docker, `/data` volume) and is never sent to browser,
  snapshot, logs, or URL.
- **Player name chosen during registration (reserved on waitlist):** signup asks for player name (3 to 20
  characters, unique worldwide) along with email and password, checked in real time with inline feedback if taken. It
  remains reserved for the account while waiting (the waitlist screen displays "Your player name: X (reserved)") and
  becomes the character's initial name without prompting again (can be changed later once every 30 days); legacy
  accounts without a reservation still pick a name when creating a character. `docs/world/privacidade.md` now notes
  that the world server stores, beyond country, signup IP and last password login IP for auditing (accessible only to
  admins; deleted with the account; included in "Download my data"), and nothing else.
- **Launch popups:** three notices in modal dialogs over the office (and Settings). **New: Habblaud World**, for
  those without an account, with **Create account** button: "Not now" brings it back in 3 days (up to 3 times), "Don't
  show again" dismisses it permanently, and once an account is created it never returns. **You are on the waitlist**,
  shown right after registration (or when opening while waiting), once per browser. **Access granted!**, when your
  turn arrives and no character exists yet, with **Create character** opening its screen directly. None appear through
  the mobile port, in timelapse, or in demo mode.
- **Character:** player name, visual tooltip, the same appearance editor as the agent drawer, 2 or 3 personality
  traits (incompatible ones are disabled), and an intro sentence from the list; can be created while still on the
  waitlist. If moderation changes the name, the section asks for a new one without waiting 30 days.
- **Building visibility:** live or discreet, closed to visits, hide country, tokens (ranges only), scoreboard,
  compactions, and **Notify when someone knocks on the door** (off by default).
- **Account and data** (new screen in the Habblaud World window): toggle **Notify by email before removing my building
  for inactivity**; **Download my data**, saving `habblaud-world-dados.json` with account data held by the world (once
  daily); and **Delete account** in three steps: what disappears and when (building and profile immediately; account,
  likes, blocks, filed reports, and database devices in 7 days; backups within 30), email confirmation code, and code
  entry. Once deleted (here or on another machine), the building connection closes and `world.json` is removed locally;
  the section reports the account was deleted.
- **Your building in the world:** with access granted and character created, the **Your building** card shows whether
  the building is connected, reconnecting, paused, or outside the world (or if a character is still needed), how many
  floors and agents it has, when the last batch was sent, and if the world rejected a batch, the reason. When the
  world server stops the building, the card explains why: **Update Habblaud** (outdated version), **Connected on
  another computer** (with **Bring to this computer**), suspended or banned account (with **Appeal via email**,
  opening an email to privacidade@habblaud.com with the account ID in the subject), or deleted account. An
  **unverified** building displays the badge and **Dispute via email**, and world maintenance appears as
  **Under maintenance** (Habblaud retries automatically with backoff). **Pause** halts sending immediately and turns
  off the building while keeping the lot; **Resume** lights it back up. **Leave world** (two clicks, showing the
  difference from pause) removes the building immediately and frees the lot; account and character remain, and
  **Rejoin world** creates a new building on another lot (leaving from another computer syncs here too).
  **View last uplink** shows the exact JSON of the last payload, timestamp, byte size, world response (with counted
  bytes), and a copy button: that is everything that left the computer. The theme picked in
  **Appearance › Office theme** applies to the building (and the theme saved for the building applies to the office),
  and the top bar gains a "🏙️ in world" / "⏸ paused" / "⚠️ stopped" badge opening this section (hidden on narrow
  screens and mobile).
- **Building uplink to the world:** with account unlocked and character created, Habblaud opens a WebSocket connection
  to the world server and sends the building live: one floor per room with anyone present, and per agent only a random
  id, main or subagent, tool, status, randomized name, and appearance; plus theme, daily completed tasks range, rounded
  building tokens (can be disabled), and compactions (if enabled). Floor and agent IDs are randomized and rotate every
  24h (±6h); paths, room names, titles, activities, model, branch, account, and edited names never leave. Uploads on
  change (at most once every 5s), reconnects automatically with exponential backoff (2s to 60s, also during
  maintenance), and stops when the server requests (suspended, banned, or deleted account, outdated version, or active
  elsewhere). Demo mode agents are never uploaded. Tasks and compactions are still counted when paused or disconnected
  and sent in the next payload.
- **The city (World button):** when the scene is available (`meta.world.scene.available`), the **World** button next to
  Timelapse switches the office to the Habblaud World city in matching 3/4 pixel art: 6-lot blocks with sidewalk, curb,
  lampposts, trees, crosswalks, and a central square with fountain, benches, and totem; empty lots become gardens
  (park, pond, orchard, cafe). Each building height matches open projects (up to 12 rendered floors, with a "+N" sign
  above that), windows lit proportionally to working agents and flashing amber for waiting ones, owner theme (pumpkins,
  webs, and bats for Halloween; snow, lights, garland, and tree for Christmas), dimmed with a "Closed" sign when the
  building is away, color and trim derived from the lot seed, and sign with flag, owner name, and ❤️ likes. The lower
  row of each block shows storefront and door; the upper row, with north-facing entrance, shows canopy and rear.
  At night, lampposts and windows light up. Walk with arrows/WASD (Shift to sprint) or click (office A*); camera
  follows with usual zoom, zooming out to view ~200 buildings; near a door, **Enter (E)** appears (see "Visiting a
  building" below). Hovering over a building opens its card (owner, country, state, floors up to "24+", agents working,
  waiting, or idle or "discreet mode", likes, "in world since"); clicking a player opens their profile (character,
  country, traits, quote, building, and received likes). Other players move smoothly, slightly delayed, at update rate
  (5/s for nearest 20, 2.5/s for others), with name overhead; stopping at a bench sits down (you too), and while away
  your character stands idle. Minimap in the corner shows surrounding blocks, brighter where more buildings are active,
  and pans camera on click. Esc or **Office** returns, and reopening returns exactly where you were (character, camera,
  and zoom without flickering); Settings stays open across the city, and the office pauses rendering meanwhile. Scene
  loads only when opened. **When paused or outside the world, your building stays dark, but you can walk the city**:
  with scene open, connection carries only handshake, heartbeat, and scene commands—never building payloads—and closes
  with the scene. Banned, suspended, or deleted accounts (or building stopped due to outdated version or another
  computer) hide the World button; it only appears on local machine web page (never via mobile port or without local
  access).
- **The city via local server:** with the scene open, Habblaud requests the city area surrounding your character
  (`view`) from the world server over the existing building connection and streams it to the browser via
  `GET /api/world/stream` (SSE: initial full state, then sequential patches); closing the scene notifies (`view.off`)
  and stops the stream. Chunks with revisioning (jumps request area again), nearby players, minimap, and your position
  are kept in memory only. Character commands (`POST /api/world/cmd`: movement, profile, enter/leave building, light
  social) are validated field-by-field, capped at 5 batches/s taking only the last step; up to 4 city tabs. Local
  machine and local page only (never third-party sites). City geometry (lots, blocks, doors, chunks, walkable tiles)
  lives in `shared/world/city.ts`, identical to the world server. Character enters street at server-validated position
  (doorstep sidewalk or central plaza).
- **Visiting a building:** within 2 tiles of a building entrance, **Enter (E)** steps inside: the owner's office as
  they see it, with their theme, rooms with randomized names of the day ("Project Ipê", "Project Jade"...), and agents
  at their current status (typing, hand raised, watching terminal, or idle, with simulated social life in your
  browser), updating in real time with each owner payload. You enter by elevator with your character and a **visitor**
  badge, walking via keyboard or clicks (desks cannot be occupied). Top banner displays building owner, floor and agent
  counts, and whether in discreet mode (empty rooms, lights on) or paused (fully dark); side panel lists rooms and
  agents (name, role, tool, status; clicking opens a card with these details and nothing more). Nothing from the world
  includes timestamps, so inside there are no popcorns, webs, stopwatches, or "waiting for X". **Exit** via button,
  Esc, or reception elevator returns to sidewalk outside the door. On the panel, **Like** (with total; from inside,
  ignoring door distance) and **Leave a stamp** (one of 8 lobby stamps, one per building per day); reception corkboard
  shows the stamp you left today and, in your own building, stamps from "While you were away". Buildings closed to
  visits, full (20 visitors), blocked, or too far show on-screen notices. No office actions exist in visits (no
  terminal, drawer, feed, notices, permission requests, messages, My day, timelapse, editor, or room rename): it runs
  in an isolated world communicating only with `/api/world/*`, and no visit steps leave the computer. Social coins from
  visited agents live in an isolated key and vanish upon exit. **View as others see it** (on **Your building** card and
  building door) visits your own building. **For the owner:** top badge shows "👀 N" and **Your building** card shows
  "N visitors now" (count only, never identities); the first visitor per connection triggers an "Someone entered your
  building" notification, toggleable in **Habblaud World › Notify when someone visits**. Through the local server, scene
  stream relays interior (`building`, revisioned `building.patch`, and `resync {building}` on gaps) and visitors
  (`visitors`, also in `meta.world.building.visitors`).
- **Lightweight social features, no free text:** in the city, **L** (or the ❤️ button appearing near the door, up to
  4 steps) likes a building, and a heart flies to the sign as its counter ticks up; **G** opens the wheel with 10
  greetings (keys 1–9 and 0, arrows, or touch) for whoever just greeted you, who is on the card, or nearest, with 5s
  bubbles over heads (non-overlapping) and "G to respond" when greeted; **K** knocks on the door of those who allow it
  (up to 2 steps). Player card adds **Greet**, **Block** (two clicks: you no longer see each other), and **Report**
  (preset reasons, "Report sent"); building card adds **Like**, **Knock**, building code, and "unverified" badge.
  On the minimap, **Go to HB-XXXX** and **Visit random building**, fading while character walks to the door sidewalk.
  In the square, collective weekly goal progress ("10,000 hours of working agents") and city hall board (lit buildings
  and "city consumed ≈ X this week", only with 10+ buildings); reaching the goal triggers 20s fireworks (sometimes
  heart-shaped) and string lights with festive seasonal decor for everyone. On facades, daily token meter next to the
  door, marquee with 5 brightness tiers based on weekly range (dim to neon with sparks), and confetti when a building
  finishes its shift. On mobile, buttons sit in the corner with icons only. **In the office:** topbar chip shows
  "❤️ N today"; upon connecting, **While you were away** card (visits, likes, and lobby stamps, anonymous) appears in
  the corner and in **Your building**, with building code to share with friends; **Notify when someone knocks on the
  door** (Visibility, off by default) displays "Someone knocked on your building's door";
  **Habblaud World › Blocked** lists blocked users with **Unblock**. **Via local server:**
  `POST /api/world/summary/seen` and `/api/world/unblock`, plus commands `like`, `unlike`, `greet`, `block`, `unblock`,
  `report`, `stamp`, `teleport`, `knock`, and `summary.seen` in the scene, validated field-by-field.
- **Local routes** (`/api/world/*`, local machine only): account (registration, code, login, logout, resend, change
  password, character, visibility with optional inactivity alert, devices); building (`POST /api/world/pause` and
  `/resume`, which stop sending before replying; `/leave`, replying only after world server removes building; `/join`,
  requesting rejoin before reconnecting; `PUT /api/world/theme`, where automatic becomes current seasonal theme;
  `GET /api/world/last-uplink`, last payload saved at `~/.habblaud/world-last-uplink.json`, permission 600); and account
  and data (`POST /api/world/delete-account` and `/delete-account/confirm`, responding only after closing building and
  deleting `world.json`; `GET /api/world/export`, account JSON download, local page only). An unconfirmed resume retries
  with reconnect backoff. World status and snapshot (`meta.world.building`) provide building summary: connected, paused,
  outside world, stopped, floors, agents, and last payload.
- **Open protocol and transparency:** `shared/world/protocol.ts` and `schema.json` define everything Habblaud
  exchanges with World (Phase 4 adds door alerts, owner visitors, and building `resync`; Phase 5 adds light social
  names: stamps, city goals, daily likes, "while you were away" summary, knocking, and building code; Phase 6 adds
  `goodbye` `deleted`, `maintenance` error, `implausible` rejection, `notifyInactivity` visibility, `unverified`
  building badge, and export/deletion formats); rules for player names, 14 traits, 20 intro quotes, 10 greetings, and 60
  fictional floor names ("Project Ipê", "Project Jade"...) reside in `shared/world/`. `docs/world/privacidade.md` lists
  every payload and connection field, with a test verifying the page against `schema.json`; projection tests verify
  every key and ensure no office text appears in payloads. The truthful data notice for humans and AI agents appears
  in `CLAUDE.md`, `AGENTS.md`, `shared/world/README.md`, and World files, and `CONTRIBUTING.md` contains review
  guidelines for PRs modifying it.
- **Demo mode:** `?mock=1&world=logged_out` (or `waiting`, `approved`) simulates the server (code is 123456), with
  sample building and payload from `docs/world/privacidade.md`; `?mock=1&world=approved&scene=city` opens a simulated
  city (20 buildings, yours on lot (3,1), 5 walking people and one on a park bench; `&perf=N` fills N lots), with
  buildings to visit (live, discreet, dark) and light social features (bots greeting and replying, goal at 80%, and
  with `&fireworks=1`, a fireworks test button). `npm run shots:world` updates screenshots
  `docs/screenshots/world-predio.png`, `world-enviado.png`, `world-cidade.png`, `world-cartao.png`, `world-visita.png`,
  `world-visita-painel.png`, `world-social.png`, and `world-praca.png`.

## [0.11.0] - 2026-10-13

To update: `git pull` and `npm run docker:up` (it also updates the Habblaud mod in accounts). Mobile access is
optional and disabled until running `npm run remote:setup`; step-by-step instructions are in the README under
"Mobile access with login and HTTPS". New agent requires `HABBLAUD_PTY=1` in `.env`.

### Added

- **Mobile access with login and HTTPS (optional, disabled until configured):** `npm run remote:setup` asks for
  username, password (stored only as scrypt hash in `.env`), a host name (`https://<name>.local`), and optional custom
  address (e.g. `myclaude.home`). It generates a local CA and server certificate, keeping the `<name>.local` broadcast
  running as a service. Mobile connects on a **second port** (443 if available, else 4748), published only after
  setup: all requests require login, and by default mobile can **approve and reject permission requests**; messages,
  terminal (with **Deliveries**: completed agent summaries and attachments), and New agent require
  `HABBLAUD_REMOTE_ALLOW`. Port 4747 remains local-only without login. **Settings › Mobile access › Log out**
  terminates the session on that device (invalidating cookie copies). Contribution by @jasminaladdn (#96).
- **New agent (+ button on top bar, opt-in with `HABBLAUD_PTY=1`):** starts a background Claude Code session on the host
  (`claude --bg`) in chosen directory (recent projects suggested), with prompt and attachments; appears in the office
  and receives messages and permissions via Habblaud. In a directory unknown to Claude Code, opens the Claude app new
  session screen pre-filled. In Docker, started by the host bridge (`npm run codex:bridge`, now running without Codex
  too). Via mobile, also requires `spawn` in `HABBLAUD_REMOTE_ALLOW`.
- **Dictation** in New agent and message composer: browser records and **local Whisper** transcribes (`whisper-cli` +
  `ffmpeg` + multilingual model); audio stays on the machine. Without them, the button is hidden.
- **Up to 24h office timeout:** `HABBLAUD_PERMISSION_TIMEOUT` supports up to 86400s (previously 1800, and plugin
  aborted at 330s). Default remains 5 min. During long timeouts without responsive pages for 5 min (and without mobile
  login configured to respond), request reverts to terminal.
- **Messages for Claude Desktop app sessions:** `habblaud-mensagens` plugin also polls Habblaud for sessions with
  `CLAUDE_CODE_ENTRYPOINT=claude-desktop` (previously only sessions with on-screen terminal).
- Pending request without office action buttons (hook returned to terminal or session opened without plugin):
  terminal footer prompts to answer in Claude Code (or Codex).

### Security

- On the remote port, network vs local origin is determined by incoming port, never the Host header. Hook routes,
  plugins, host bridge, interactive terminal, character editor, and room renaming are never accessible through it,
  even with login.
- Local CA only signs `localhost`, `.local` names, custom host, and private network IPs (critical `nameConstraints`):
  even if the private key leaks, certificates for third-party domains are rejected. Key is never mounted in container.
- Sessions stored in `HttpOnly`, `SameSite=Strict`, `Secure` cookies signed with HMAC (password change revokes all).
  One password attempt verified at a time before scrypt; after 5 consecutive failures, attempts back off from 1s to 5m.
- In Docker, host bridge only reads delivery files from known project directories (found in `<account>/projects`), temp
  folder, and attachments—nothing resembling secrets. File and dictation endpoints use long-polling (responding only
  when work arrives) instead of polling every 500ms.

### Fixed

- Mobile: tapping text fields no longer zooms in (iOS Safari zooms on font sizes below 16px).
- In timelapse, corner notifications sit above playback controls instead of covering timeline and buttons.
- With many accounts or narrow windows, usage cards wrap to a second line in the top bar instead of covering right-hand
  buttons (zoom, My day, Settings, Help).
- On mobile (<= 480px), top bar no longer clips logo and sidebar button: counters drop to usage cards row.
- "My day" on mobile: Demo | Real data toggle no longer overflows the screen (even at 390px in French).
- Simultaneous permission requests from same agent: newer request details no longer state another request is queued
  behind it.
- "My day": 1,000 daily wait limit applies even when all are open (previously list and daily file grew unbounded).
- Conversation files rewritten in place (instead of appended) are re-read from the beginning; previously new content
  was skipped or read from the middle.

## [0.10.0] - 2026-10-13

To update: `git pull` and `npm run docker:up`. The interface follows the browser language (or Settings › Language).
Server-generated texts remain in Portuguese; for another language, set `HABBLAUD_LANG` (`en`, `es`, or `fr`) in `.env`
before `docker:up`. In October, automatic theme sets the office in the Halloween spirit; for the classic look, select
**None** in Settings › Appearance.

### Added

- **Office themes** in Settings › Appearance: pixel-art decorations (trees with presents, wreaths, and window snow for
  Christmas; pumpkins, ghosts, webs, and bats for Halloween), lighting, rugs, and character accessories. **Automatic**,
  the default, tracks the calendar: Halloween from Oct 1 to Oct 31, Christmas from Nov 1 to Dec 26 (rest of year:
  classic look). **None** retains classic style year-round, while **Christmas** and **Halloween** lock a theme.
  Selection persists in browser.
- **Interface in English, Spanish, and French.** Strings pass through `tr()` (`shared/i18n.ts`) with Portuguese as
  source: untranslated strings fall back to PT. Interface follows browser and can be locked in **Settings › Language**.
  Server-generated strings (activities, notices, terminal, logs, installation scripts) follow `HABBLAUD_LANG` (`pt-BR`,
  `en`, `es`, or `fr`) and fallback to system locale, excluding English (default on many machines/containers): for an
  English server, use `HABBLAUD_LANG=en`. `npm run i18n:check` lists missing translations. French contributed by
  community (#67).
- **English README**, alongside Portuguese (`README.pt-BR.md`), Spanish, and French versions, with language headers.

## [0.9.0] - 2026-10-13

To update: `git pull` and `npm run docker:up`. Interactive terminal is opt-in and works only outside Docker:
`npm install`, `npm run build`, and `HABBLAUD_PTY=1 npm start` (read "Privacy and security" in README first).

### Added

- **Interactive terminal (opt-in, `HABBLAUD_PTY=1`):** real Claude Code inside an office window, with tabs for agents
  in the same project. **New session** spawns Claude Code in room folder; **Resume here** terminates session running in
  another terminal and resumes conversation here (`claude --resume`); **End** and tab close button terminate session,
  here or externally. Claude Code sessions only (no Codex or demo). Before killing an external process, Habblaud
  verifies the PID matches Claude Code. Uses `node-pty` and `@xterm/headless` (optional dependencies); screen restores
  completely on reconnect or tab switch, matching active Claude modes. On startup, tests a terminal: if `node-pty` or
  `claude` fail, feature disables with explanation in log (on macOS, fixes missing execute bit on `node-pty` 1.1.0
  `spawn-helper` first).
- **Terminal tabs and shortcut:** terminal window gained tabs for main agents of the same project (showing activity
  preview), and sidebar gained a terminal shortcut next to each agent. With terminal open, clicking another agent in
  sidebar switches terminal tab. Also works for live read-only terminal when interactive mode is off.

### Fixed

- Messages sent from office no longer route to wrong conversation: if agent switches thread (`/clear`, `/resume`, or
  another thread in Codex) before retrieval, delivery fails with reason instead of posting to new thread.
- Older tasks and states are preserved when resuming long sessions that added new tasks.
- Activity detail no longer exposes webhook secrets (Slack, Discord, Telegram) or `npm_` / `hf_` tokens pasted into
  commands.
- Codex messages in Docker are delivered sequentially per session and acknowledged individually, preventing dropped
  messages and duplicate retries.
- Malformed Claude Code task lists no longer halt parsing; office preserves remaining activities in batch, including
  subagents.
- Windows Codex images (drive `C:` or network path `\\server\...`) previously showed invalid paths in activity and
  terminal (`/C:/...` or missing server). Path now matches origin file.
- Saving character or resetting to random no longer closes concurrent edits while waiting for response, nor displays
  stale edit errors.
- Oversized or unterminated lines in conversation logs previously accumulated in memory, slowing parser. Lines over
  8MB are now skipped, resuming on next line.
- Rolled-back Codex sessions show active turn in office and terminal even when previous conversation file remains
  on disk.
- In timelapse, agent timeline stops displaying future events after scrubbing backward. In-flight history responses
  no longer bleed into active replay.
- In timelapse, panel timestamps track replay clock and freeze on pause alongside office and replay badge.
- Paused feed retains only latest 50 events and purges stale session data, keeping unread count intact.
- In timelapse, arrow keys in playback speed control adjust speed instead of panning office camera.
- Office avoids duplicate live connections and cleans up network handles and font resources on unload.
- `usage:install`, `hooks:install`, `mod:install`, and `codex:install` abort when configuration changes mid-install,
  rather than overwriting edits (which also dropped backups). Re-running command uses modified file as new backup.

## [0.8.0] - 2026-10-09

To update: `git pull` and `npm run docker:up`. Renaming rooms and editing character work only on local machine
(same terminal lock). Room names are stored in `rooms.json` and characters in `names.json` inside Habblaud data folder;
downgrading to 0.7 resets custom characters on first save.

### Added

- Sidebar and character hover tooltip show session title (subagents show task) beneath the name. In sidebar, a main
  agent idle for 1 minute or more shows **idle 12 min** instead of "Main"; in tooltip, status displays duration
  (**for 12 min**).
- **Movable windows:** terminal and agent drawer detach by dragging their title bar, resize from any border or corner,
  and snap back with double-click on title bar. Terminal gained **Expand fullscreen** button. Position and size persist
  in browser; on narrow screens, layout remains fixed. When detached, drawer no longer reserves office side margin.
- **Reorder sidebar:** dragging a main agent row changes agent order in room, and dragging room header reorders rooms
  (in building they remain in place). Order persists in browser; agent order is tied to Claude Code session and
  survives session resumes.
- **Rename room:** right-clicking a room (in sidebar or office) opens an input to rename it; blank input resets
  to folder name. Name is stored on server (`rooms.json` in Habblaud data directory) per folder: syncs across
  browsers and survives restarts. In room drawer, pencil icon next to name opens the same field. Local machine only;
  demo rooms cannot be renamed.
- **Edit project character:** in main agent details, pencil icon next to name opens editor with name, **Randomize**,
  and parts (skin, hair, facial hair, eyes, clothes, shoes, accessory) with preview. Selection is saved per project:
  subsequent sessions in that room spawn with this character, and **Reset to random** clears it. Local machine only,
  like the terminal.

### Changed

- Agent timeline shows 15 most recent entries, with **Show more** (+15 per click up to 200 stored) and **Show less**
  (resets to 15). Previously rendered 80 at once.

### Fixed

- On Windows, Codex messaging searched for `codex` in PATH and resolved the npm-installed wrapper batch script:
  Habblaud reported messages enabled, but deliveries failed without shell execution. Now explicitly searches for
  `codex.exe`. For npm-only Codex setups, point `HABBLAUD_CODEX_BIN` to `codex.exe`.
- On Windows, pre-existing statusline commands prior to `npm run usage:install` (which Habblaud chains and runs)
  executed via `cmd.exe`, breaking Claude Code syntax (single quotes, env vars, pipes). Now runs in Git Bash matching
  Claude Code: `CLAUDE_CODE_GIT_BASH_PATH` or Git install path. Falls back to `cmd.exe` if Git Bash is missing.
- On Windows, installers (`usage:install`, `hooks:install`, `codex:install`, and `mod:install`) previously printed full
  user home paths (`C:\Users\...`) instead of `~/...`.
- Test suite (`npm test`) passes on Windows: tests assuming Linux/macOS paths, shells, or permissions now run across all
  three platforms, skipping Windows-unsupported edge cases.

## [0.7.0] - 2026-10-09

To update: `git pull` and `npm run docker:up` (Codex appears automatically if `~/.codex` exists). For live Codex and
approvals in office: `npm run codex:install` and approve Habblaud hooks in `/hooks` in Codex (restart Codex first if
already running). With Habblaud in Docker, run `npm run codex:bridge` on host Mac to deliver messages to Codex.

### Added

- **Codex in the office.** OpenAI Codex sessions (`codex` CLI and app) join office like Claude Code: each project is a
  room (shared with Claude Code when in same project), each session a character with **CODEX** badge, complete with
  activity, subagents, terminal, history, 5-hour and weekly usage (with data age and "no quota" on credit exhaustion),
  and My day (tokens only; Codex omits cost). Zero config required: Habblaud monitors Codex files (`~/.codex`,
  `CODEX_HOME`, or `~/.codex*`; configured via `HABBLAUD_CODEX_DIRS`, disabled via `HABBLAUD_CODEX=0`). Sessions appear
  on first message when Codex announces project path (empty CLI without active conversation is hidden). In Docker,
  only `sessions/`, `archived_sessions/`, and `thread-writer-locks/` are mounted read-only.
- **Live Codex and office approvals:** `npm run codex:install` adds Habblaud hooks to `~/.codex/hooks.json`
  (with backup; merges with third-party hooks). Once approved in Codex `/hooks`, live activity streams continuously
  and approval requests await office decision for up to 25s (`-- --espera <s>`) before falling back to terminal.
  Verify with `codex:status` and remove with `codex:uninstall`.
- **Messages to Codex** via shared **Send message** box using `codex queue` (processed when turn finishes). In Docker,
  keep `npm run codex:bridge` running on host.

### Changed

- Codex directories never convert into Claude Code accounts, even if listed in `HABBLAUD_CLAUDE_DIRS` or
  `CLAUDE_CONFIG_DIR`; server and `docker:up` warn if attempted.
- With four or more accounts, top usage cards narrow down and zoom controls hide below 1700px viewport width to prevent
  overlapping right-hand buttons.

## [0.6.0] - 2026-10-09

To update: `git pull`, `npm run docker:up`, and `npm run mod:install` (installs new permissions and messages plugins);
in running sessions, `/reload-plugins`.

### Added

- **Answer agent questions from the office.** When the agent asks a question (`AskUserQuestion`), the questions card
  displays each question with choices and descriptions: choose one (or multiple if permitted), enter custom text under
  "Other", or decline. As with permissions, terminal dialog remains active and whichever answers first takes effect;
  key `P` and the "need you" badge also lead to questions. Requires `habblaud-permissoes` plugin from this release.
- **Send messages to agents from the office.** Main agent details include a "Send message" section: text inputs into
  session as if typed directly in terminal (queued until active turn finishes if agent is busy); composer displays
  delivery status. Powered by new `habblaud-mensagens` plugin (Claude Code 2.1.287+), installed via
  `npm run mod:install` (omit with `-- --sem-mensagens`); `npm run docker:up` notifies without installing automatically.
  Subject to terminal lock (local machine only) and disabled via `HABBLAUD_MENSAGENS=0`. Read "Privacy and security" in
  README: any process on host can message sessions with this plugin installed.

### Changed

- **Terminal (key `T`) supports input.** No longer read-only: on main agents, footer becomes an input box (`Enter`
  sends, `Shift+Enter` inserts newline). Subagents and history sessions remain read-only.
- `npm run mod:install`, `mod:status`, and `mod:uninstall` also manage `habblaud-mensagens` plugin, and `mod:status`
  reports whether messaging is active.

## [0.5.0] - 2026-10-09

### Added

- "Needs you" card displays full `AskUserQuestion` queries with options and descriptions (up to 4 questions, 6 options
  each). Read-only: responses are provided directly in Claude Code.
- Automated GitHub Actions checks: on every push to `main` and pull request, runs `typecheck`, tests, and build on
  Node 22.12, the minimum version declared in `package.json`.

### Fixed

- When a transcript file was removed and replaced by a larger one, Habblaud could miss the change: some filesystems
  reuse inodes from deleted files, and only inodes were compared. Detection now also evaluates file birthtime (when
  available) and file header, resetting reading to the start of the new file.
- On Windows with Node 23 through 24.19, `habblaud-permissoes` plugin hook crashed on exit (code 0xC0000409, Node bug:
  nodejs/node#56645) immediately after receiving office response. While decision was delivered before crash, empty
  responses (like "Reply in terminal") could log hook errors. Hook now terminates cleanly.
- `npm install` modified `package-lock.json` (repository version was out of date relative to `package.json`), causing
  subsequent `git pull` to fail with "Your local changes … would be overwritten". Lockfile is now aligned. If already
  modified locally, run `git checkout -- package-lock.json` once before `git pull`.
- On Windows, mod failed to persist 5-hour and weekly usage when `HOME` was undefined (standard outside Git Bash):
  now falls back to `USERPROFILE`. Backslashes in `CLAUDE_CONFIG_DIR` (e.g. `C:\Users\you\.claude-account2`) caused
  invalid filenames; now resolves consistently, including inside Docker.

## [0.4.0] - 2026-10-08

### Changed

- **CodeTown renamed to Habblaud.** Name updated across codebase: UI, logo, lobby sign, entrance totem, link previews,
  repository (`github.com/marmottajr/habblaud`), Claude Code marketplace and plugins (`habblaud` and
  `habblaud-permissoes`, with `/habblaud` command), environment variables (`HABBLAUD_*`), state directory
  (`~/.habblaud`), and Docker (container/image `habblaud`, volume `habblaud-data`).
- Upgrading from CodeTown: run `npm run mod:install` once (updates marketplace and legacy plugins per account) and
  `npm run docker:up` (replaces old container and migrates names, timeline, and stats from `codetown_codetown-data`
  volume without deleting old data). `~/.codetown` folder, preferences, and browser coins migrate automatically.
  Legacy `CODETOWN_*` variables are obsolete: rename to `HABBLAUD_*` in `.env` (server and `docker:up` warn if found).
  Details in README under "Migrating from CodeTown".

## [0.3.2] - 2026-10-08

### Fixed

- When a terminal closed and its room was dismantled, a gap garden remained between rooms in the building. Now the
  furthest room moves into the vacancy: it is assembled there, still dark; the first to arrive turns on the light and
  everyone returns to the same desk. The old location turns off and is dismantled, shrinking the building.
  A newly opened room takes the first available spot, ensuring the initial load has no gaps.
- Agents heading towards objects that ceased to exist (such as a hallway water cooler disappearing when building shrank)
  previously teleported. Now they re-plan path and keep walking.

## [0.3.1] - 2026-10-08

### Fixed

- Agents dozing at desks (idle for >10 min) who stood up for a circle, party, or stroll continued walking with "zzz"
  over their heads. The "zzz" now only renders while sleeping.

## [0.3.0] - 2026-10-08

### Added

- **Habblaud mod for Claude Code** (2.1.287 or newer): `npm run mod:install` installs the local marketplace with
  `habblaud` mod (live 5-hour and weekly usage, terminal alert when another session needs input, and `/habblaud`
  command) and `habblaud-permissoes` plugin (respond to permissions from office; omit with `-- --sem-permissoes`).
  `npm run mod:status` checks installed components and `npm run mod:uninstall` removes all. `npm run docker:up` updates
  mod for existing installations.

### Changed

- Statusline tap (`npm run usage:install`) and permission hook (`npm run hooks:install`) become legacy approach for
  Claude Code prior to 2.1.287. `npm run mod:install` removes both (with backup) as mod replaces them. UI and README
  now document `npm run mod:install`.
- Permission hook script moved to `mod/habblaud-permissoes/hooks/permission-hook.mjs`. Old path
  (`scripts/permission-hook.mjs`) is symlinked for backward compatibility.
- In Accounts & usage, metric source notes when live from mod ("live (Habblaud mod)").
- Live usage parser ignores half-written files and retains last known good reading, rather than hiding account for a
  cycle.

## [0.2.0] - 2026-10-08

First public release.

### Added

- **Version and updates:** current version displays in top bar and Settings › About. Habblaud checks GitHub releases
  every 6 hours; when an update is available, a **New version** badge appears with changelog link. Disable via
  `HABBLAUD_UPDATE_CHECK=0`.
- **My day** (key M): breakdown of agent time, wait times, token counts, and cost, with 30-day history.
- **GitHub in the office:** opened/merged PRs and published releases celebrate in room; failing CI triggers alarm until
  passing.
- **Respond from office** (key P): with hook installed (`npm run hooks:install`), approve, reject, or "always allow"
  permission requests without switching to terminal. Local machine access only.
- **Daily timelapse** (key L): high-speed replay of the day's activity.
- **Read-only terminal** (key T): live stream of each agent's conversation in Claude Code format, featuring search,
  filtering, copy button, and 7-day session history. Local access only.
- **Day and night** cycles based on local time and synthesized browser **sound effects** (off by default).
- **Social life:** idle agents gather in groups (TV, video games, ping-pong, water cooler chat, rock-paper-scissors
  for coins) featuring unique personalities, friendships, and rivalries.
- **Waiting for shell:** agents waiting on long shell commands sit with an hourglass, turning waiting into gags.
- Session forks appear in the office.
- Open client auto-reloads when server updates to a new version.
- Container adopts host machine timezone.
- **The office:** each open Claude Code project becomes a room and each session a named character. Subagents arrive,
  work, and report back to main agent. Displays both accounts with 5-hour and weekly usage meters (statusline tap),
  activity feed, notifications, and demo mode. Runs in Node or local Docker.

[Unreleased]: https://github.com/marmottajr/habblaud/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/marmottajr/habblaud/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/marmottajr/habblaud/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/marmottajr/habblaud/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/marmottajr/habblaud/compare/v0.11.0...v1.0.0
[0.11.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.11.0
[0.10.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.10.0
[0.9.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.9.0
[0.8.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.8.0
[0.7.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.7.0
[0.6.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.6.0
[0.5.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.5.0
[0.4.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.4.0
[0.3.2]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.2
[0.3.1]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.2.0
