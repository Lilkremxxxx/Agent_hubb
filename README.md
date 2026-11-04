<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Habblaud logo: a small pixel-art building" />
</p>

<h1 align="center">Bang_ver</h1>

<p align="center">
  <b>A pixel-art office for a team of AI agents: one boss, several workers, one project per building.</b><br />
  Clone it, set up your accounts, and watch your agents work.
</p>

<p align="center">
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%E2%89%A522.12-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-f08a3c" />
  <img alt="Interface in English and Vietnamese" src="https://img.shields.io/badge/interface-EN%20%C2%B7%20VI-4aa8e8" />
</p>

<p align="center">
  <img src="docs/screenshots/office.gif" width="820" alt="Animation of an office room: characters typing at their desks, subagents with badges and activity bubbles" />
</p>

---

Bang_ver is a fork of [Habblaud](https://github.com/marmottajr/habblaud) by Márcio Junior (MIT), through Vi-Habblaud.
It shows your Claude Code sessions as characters in one pixel-art office, with a **boss** session that plans the work and
**seats** for **workers**: other Claude Code accounts or Antigravity (`agy`) accounts. It has no mods, no Habblaud World
and no Codex.

The office itself runs on your machine and spends no tokens: it only reads logs, session files and `/usage`.

- **One office.** A building for one project folder, with its own boss and workers.
- **Seats.** One boss and a few worker seats, listed in `~/.habblaud/team.json`. `worker-ask W1 "…"` gives a job to a
  seat and prints only its final answer, which keeps the boss's context small. Every job is a new conversation, and you
  can watch it in a read-only terminal.
- **Boss overloaded (🥵).** A notice when a boss passes a context or compaction threshold, with a button to start a new
  session.
- **Energy and ghosts.** A desk mug empties with the 5-hour quota, a character sleeps when it runs out, and a worker that
  goes silent for 10 minutes fades into a ghost.
- **English and Vietnamese** only.

## Contents

- [Install](#install)
- [Set up your first office](#seats-set-up-your-office)
- [Run it every day](#run-it-every-day)
- [Make it yours](#make-it-yours)
- [What it looks like](#what-it-looks-like)
- [Other ways to run it](#other-ways-to-run-it)
- [How to use](#how-to-use)
- [Accounts and usage (5-hour and weekly)](#accounts-and-usage-5-hour-and-weekly)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Privacy and security](#privacy-and-security)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)
- [License](#license)

## Install

You need:

- **Linux.** The worker scripts rely on `setsid`, `dbus-daemon` and `gnome-keyring-daemon`.
- **Node.js 22.12+** and npm.
- **[Claude Code](https://code.claude.com)**, signed in and used at least once.
- **Python 3**, for `worker-ask`.
- The **Antigravity CLI (`agy`)** in `~/.local/bin`, only if you want Antigravity workers.

```bash
# clone this repository, then enter its folder
cd <folder>
npm install && npm run build && npm run office
tools/agy/install.sh     # worker-ask (also as agy-ask and claude-ask), agy-as and the skills
```

`npm install` fetches build tools only: the server has no required runtime dependencies. `npm run office` builds and
starts it in the background. Then open **http://127.0.0.1:4747**. If `~/.local/bin` is not on your PATH, the installer
says so: add it.

## Seats: set up your office

1. **Sign in the worker accounts.** For each Antigravity account:

   ```bash
   mkdir -p ~/.agy_profiles/acc1
   agy-as acc1              # sign in with Google when asked
   ```

   Never run a bare `agy`: it uses the machine's own account. A Claude Code worker is a second config folder, for example
   `~/.claude-work`; sign in once with `CLAUDE_CONFIG_DIR=~/.claude-work claude`.

2. **Write the seats.** Create `~/.habblaud/team.json` (or `$HABBLAUD_DATA_DIR/team.json`; the file is re-read every
   second, so editing it adds or removes seats). `folder` is the project the whole office works in. A Claude `account`
   of `default` is `~/.claude`, `x` is `~/.claude-x`.

   ```json
   {
     "folder": "/home/you/my-project",
     "boss": { "kind": "claude", "account": "default" },
     "workers": [
       { "name": "W1", "kind": "agy", "account": "acc1" },
       { "name": "C1", "kind": "claude", "account": "worker" }
     ]
   }
   ```

   The first time, seats are imported from `~/.agy_profiles/team.json` if it exists; that file is only read, never
   written. With no `folder`, jobs and "Open the boss" are refused with a message that points at `team.json`.

3. **Open the boss.** In the sidebar, the **＋** next to Boss opens the boss (`boss.kind`) in `folder`. A Claude session
   you already have open can become the boss with **👑 Make boss** in its drawer.

4. **Give jobs.** Talk to the boss, or run it yourself (`tools/agy/install.sh` links `bin/worker-ask` as `agy-ask` and `claude-ask`; they are the same command):

   ```bash
   worker-ask W1 "Read src/ and list the TODOs" --mode plan
   ```

   One job per seat at a time (a busy seat answers exit code 3). Seats on the same Antigravity account start one after
   another. Every terminal and job runs in `folder` with `BANG_SLOT` and `BANG_OFFICE` set. Anyone may give jobs. Claude
   seats run full; add `--lean` for a light run. See [`tools/agy/README.md`](tools/agy/README.md).

## Run it every day

```bash
cd <folder>
npm run office
```

Open **http://127.0.0.1:4747**. The server runs apart from the terminal, so you can close it, but it does not come back
after a reboot. If it is already running, the command only tells you so.

To stop it and take in new code:

```bash
kill "$(ss -ltnp | grep ':4747' | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1)"   # sessions in the page's terminals end too
git pull
npm install
npm run office
```

Sessions closed this way come back with `claude --resume`. The log is `~/.habblaud/office.log`.

## Make it yours

Clone it, change anything, and point it at your own repository:

```bash
git remote set-url origin https://github.com/<you>/<your-repo>.git
```

`.env` and `team.json` are ignored by git. Your accounts live in `~/.agy_profiles` and your Claude folders, outside the
repository, so they stay on your machine.

| To change | Where |
|---|---|
| Folder, boss, workers (seats) | `~/.habblaud/team.json` (edit the file; the page follows) |
| Overload thresholds, language, sounds | Settings on the page |
| Default mode and effort of a worker | A worker's drawer › "Defaults for jobs" |
| Display name of a seat | The seat's name in `team.json` |
| Reference for the boss and worker rules (kept for a later plan; nothing loads it yet) | `docs/boss-rules-from-fork.md` |
| The skills a Claude Code boss uses | `tools/agy/skills/` |
| The scripts | `tools/agy/bin/`. They are linked, so an edit applies at once |
| How it starts | `scripts/office.sh`; for the port, `HABBLAUD_PORT=4800 npm run office` |
| Interface text | `tr('English text')` in the code, with its line in `shared/locales/vi.ts` |

See [`tools/agy/README.md`](tools/agy/README.md) for the worker commands, and [Development](#development) to work on the
code.

## What it looks like

**Overview.** The building has a lobby with elevators, a kitchen, restrooms and a lounge; each project with an open
session gets its own room along the hallway. At the top, the counters and each account's usage; on the left, the rooms
and agents; at the bottom, the activity feed.

![Habblaud overview: building with lobby, kitchen, restrooms, lounge and project rooms; sidebar with rooms and agents; account usage at the top; activity feed at the bottom](docs/screenshots/overview.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Details drawer of an agent with tasks, subagents, timeline and stats" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="The office at night, with streetlights on and lit rooms" /></td>
  </tr>
  <tr>
    <td><b>Agent details:</b> current activity, tasks with progress, subagents, timeline and stats.</td>
    <td><b>Day and night:</b> the sky in the windows and the lighting follow local time.</td>
  </tr>
</table>

<table>
  <tr>
    <td width="42%"><img src="docs/screenshots/collab.png" alt="Subagent delivering the result to the main agent while another agent waits for you" /></td>
    <td width="58%">
      <b>Collaboration in plain sight.</b> Subagents are coworkers with their own names and badges: they arrive by elevator, work in
      the project's room and, when they finish, walk over to the agent that called them to deliver the result (📦) before leaving.<br /><br />
      <b>Needs you.</b> When an agent is waiting for a permission or an answer in the terminal, it rushes to its desk and
      raises a hand, with a blinking alert — and a notice pops up on screen (optionally with sound and a browser notification).
      Answer it in the agent's terminal.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="58%">
      <b>Waiting on shell.</b> When the agent finishes its turn but leaves a command running (tests, build,
      deploy…), it doesn't wander off: it stays at its desk with an hourglass flipping over its head, the terminal showing
      progress and a bubble with the command and the elapsed time. And the wait turns into comedy: first it eats popcorn watching the
      terminal; after 3 min it crosses its arms and spins in its chair; after 10 min it gathers cobwebs; after
      25 min it dozes off. When the command finishes, it stands up and celebrates with confetti — or gets a rain cloud, if
      it failed. In the sidebar list and in the details, a timer shows how long each command has been running.
    </td>
    <td width="42%"><img src="docs/screenshots/shell-wait.png" alt="Agent eating popcorn at its desk, with an hourglass over its head and the bubble 'Run the test suite · 1 min'; in the front row, a coworker has been waiting longer, with cobwebs on the chair and the terminal showing progress" /></td>
  </tr>
</table>

**The lights go out.** When you close a project's last session, the last character walks to the light switch,
turns off the lights and leaves by elevator — and the room is taken apart, becoming a garden until a new project
arrives. If the garden ended up between two rooms, the farthest room moves there: it's set up in the empty spot,
everyone walks over to it, and the old address goes dark and is taken apart. That way the building has no gaps and
shrinks on its own.

| 1. The room is set up, still dark | 2. Someone turns on the lights and everyone works | 3. The last one leaves and turns off the lights | 4. The room becomes a garden |
| --- | --- | --- | --- |
| ![Room being set up, with the furniture appearing and the lights off](docs/screenshots/lifecycle-1.png) | ![Lit room with three agents working at their desks](docs/screenshots/lifecycle-2.png) | ![Room with the lights off and the furniture still in place, after everyone left](docs/screenshots/lifecycle-3.png) | ![The room's lot turned into a garden](docs/screenshots/lifecycle-4.png) |

<table>
  <tr>
    <td width="34%"><img src="docs/screenshots/mobile.png" alt="Habblaud on a phone" /></td>
    <td>
      <b>On your phone too.</b> The interface adapts to small screens: the room list
      becomes a drawer and the details open from the bottom up. See how to allow access over the local network in
      <a href="#open-on-your-phone-optional">Open on your phone</a>.
    </td>
  </tr>
</table>

> The images above were taken with made-up projects, people and accounts.


## Other ways to run it

`npm run office` covers most setups. Use these for something different.

**Node in the foreground**, which stops with its terminal:

```bash
npm run build
npm start
```

For development, use `npm run dev` (server + Vite with hot reload).

### Open on your phone (optional)

(kept for Plan 6: web deploy)

By default Habblaud only accepts connections from the computer it runs on. To open it on your phone (on the same Wi-Fi),
run it with `HABBLAUD_HOST=0.0.0.0 npm start`, then open `http://<computer-ip>:4747` on your phone.

> ⚠️ With this, any device on the network can see the agents' activity (commands, files, session titles). Use it
> only on trusted networks. The [terminal](#terminal) stays off while the port is exposed.

#### Phone with login and HTTPS

Instead of exposing the main port, open a **second port with a username, a password and HTTPS**. Port 4747 stays on the
computer only; the remote port goes to the network and every request on it requires a login. What separates the two is
the port the connection arrived on, never the Host header. Nothing of this exists until you run the setup: without it, no
extra port is published.

```bash
npm run remote:setup   # username, password, hostname, and (optional) custom address
npm run office         # restart it
```

`remote:setup` writes only the password **hash** (scrypt) to `.env`, creates a local CA and the server certificate in
`~/.habblaud/remote-tls`, and leaves a service announcing `<name>.local` on the network (mDNS; systemd on Linux). Open
`https://<name>.local` on your phone (with `:4748` if port 443 was taken). The first time, accept the warning, tap
**Install the Habblaud certificate** and trust it (iPhone: Settings › Profile Downloaded › Install, then Settings ›
General › About › Certificate Trust Settings; Android: Security › Encryption & credentials › Install a certificate › CA
certificate), checking the fingerprint the setup showed.

- **Restricted CA:** it only signs `localhost`, `.local` names, your own address and private-network IPs. Even if its
  key leaked, a certificate for any other site would be rejected by the phone that trusts it. Changing your own
  address creates a new CA (install the certificate on the phone again).
- **Own address** (e.g. `myclaude.home`): goes into the certificate, but the phone only finds it with an entry in the
  router's DNS pointing to the computer's IP. `<name>.local` works without configuring anything.
- **What the phone can do:** by default, view only. `HABBLAUD_REMOTE_ALLOW` in `.env` accepts
  `terminal` and `spawn`, separated by commas, or `none` (view only). The interactive terminal never works from the
  phone.
- **Session:** 30 days; changing the password (running the setup again) ends all of them, and **Settings › Phone
  access › Sign out** ends the one on that device. After 5 wrong passwords in a row, each new attempt waits from 1 s up to 5 min.
- **Turn off:** `npm run remote:setup -- --off`, then restart.

Without HTTPS the remote port doesn't start; `HABBLAUD_REMOTE_INSECURE_HTTP=1` forces plain HTTP (password and cookie
in the clear on the network). Also: `HABBLAUD_REMOTE_PORT` and `HABBLAUD_REMOTE_HOST` (default `0.0.0.0:4748`) and
`HABBLAUD_REMOTE_TLS_DIR` (default `~/.habblaud/remote-tls/server`).

### Uninstalling

```bash
kill "$(ss -ltnp | grep ':4747' | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1)"   # stops the office
rm -rf ~/.habblaud                          # deletes local data (names and rooms)
```

Then delete the project folder. The worker scripts in `~/.local/bin` (`agy-ask`, `claude-ask`, `agy-as`) are links into
`tools/agy/`: remove them too.

## How to use

### What each character is doing

| State | What you see |
| --- | --- |
| **Working** | At the desk, typing. The monitor and a bubble show the activity: 📖 reading, ✏️ editing, 💻 terminal, 🧪 tests, 🌐 searching… |
| **Needs you** | Rushes to the desk and raises a hand, with a blinking alert: it's waiting for a permission or an answer in the terminal. |
| **Waiting on shell** | Finished its turn but left a command running (tests, build, deploy…), so it stays at the desk with an hourglass flipping over its head and the terminal in progress. |
| **Idle** | Finished its turn and wanders around: coffee in the kitchen, the water cooler, the restroom, the lounge couch, the phone on the beanbag, the mirror. |
| **Subagent done** | Walks over to the agent that called it, delivers the result and leaves by elevator. |
| **Session ended** | Leaves; if it was the last one in the room, it turns off the lights on the way out. |

Each character has a name that stays as long as the session exists, and a **colored chip with the account letter** (C, D…).

### Interface

- **Top:** the counters (rooms, agents, working, subagents, shells running, need you). The shells
  counter only shows up while some command is running; click it to go to whoever is waiting. The 👤 button opens the
  Accounts window with each account's usage.
- **Side panel:** search and the list of the office's boss, workers and others, with their agents and subagents.
- **Details drawer:** click a character (in the building or in the list) to see activity, tasks, subagents,
  timeline and stats (tools, tokens, cost, lines changed, model, branch).
- **Feed:** the latest activity across the whole office.
- **Settings (⚙):** names, bubbles, how much idle agents wander around, day/night cycle, sounds, browser notifications,
  the boss-overloaded thresholds and language. **Help (?):** full legend and shortcuts.
- **Session history** (the clock in the top bar): see [Terminal](#terminal).

**Camera:** drag to move, scroll to zoom, double-click a character to follow it.

**Shortcuts:** `/` search · `F` follow the selected one · `T` terminal · `H` boss overloaded · `O` or `0` overview · `Esc`
clear selection · `[` side panel · `]` feed · arrows/`WASD` move · `+` `-` zoom · `?` help.

### Languages

The interface is in **English and Vietnamese**. It follows the browser's language; in **Settings › Language** you can
pin one (the choice is saved in this browser). The texts the server builds (activities, notices, terminal, logs and the
install scripts) follow `HABBLAUD_LANG` and, without it, the system language. For the server in Vietnamese, set
`HABBLAUD_LANG=vi`. Any text without a translation shows up in English.

### Day, night and sounds

The office follows **local time**: late at night and in the evening the lawn and the street turn bluish and dark, the streetlights,
the lamps, the machines and the monitors that are on cast halos of light, the rooms with people in them are lit, the cars drive by
with their headlights on and fireflies show up in the garden. At dawn and at dusk everything takes on a warm tone, and during
the day the sun comes in through the windows and draws strips of light on the floor. In **Settings › Day/night cycle** you can
choose automatic, always day or always night; to test a time, use `?hora=21:30` in the URL.

**Sounds** come turned off. Turned on in **Settings › Sounds**, they're synthesized in the browser itself (no audio
files) and quiet: the typing of whoever is working in the rooms in view, the elevator "ding" when someone arrives or
leaves, the bell when someone needs you and the click of a finished task. There's a master volume and each category can be
turned on and off separately. With the tab hidden, only the bell rings.

### Terminal

Click an agent and use **Open terminal** to see the session's conversation the way Claude Code shows it: the prompts, the
replies, each tool call (with the command or the diff) and the result, updated live. It works for main
agents and subagents.

The conversation is read-only.

- **Search:** with the terminal focused, `Ctrl+F` (`⌘F` on Mac) or the magnifier in the header opens search in the conversation,
  ignoring case and accents. The counter shows the position ("3/17"); `Enter` and `Shift+Enter` go to the next
  and the previous one, expanding the collapsed blocks ("… +N lines") where the term is. Search keeps working while
  new messages arrive. `Esc` closes the search; the next one closes the terminal.
- **Filter:** **All**, **Prompts only** (your prompts and the agent's final replies, without the intermediate steps)
  or **No tools**.
- **Copy:** hover over (or focus) a prompt, a reply, a command or a result to copy it.
- **Session history:** the clock in the top bar lists the sessions from the last 7 days across all accounts (up to 150), grouped
  by day, with search by title, project or account. An ended session opens in the terminal with the project, title and date in the
  header and "Session ended at …" at the bottom; a session that's still open opens the agent's live terminal.

Since the terminal (and the history) shows the whole conversation, it only exists when Habblaud is reachable **only from the
computer it runs on** (the default), and it only opens through `http://localhost` or `http://127.0.0.1`. With the port open to the network
(`HABBLAUD_HOST=0.0.0.0`), it stays off. Details in
[Privacy and security](#privacy-and-security).

### Interactive terminal (take over, new session and end)

With `HABBLAUD_PTY=1` and running with `npm start`, each main agent's terminal window is
interactive: the drawer's **Open terminal** button, the shortcut next to each agent in the side list or the `T` key
open the same window, with tabs for the other agents in the same project.

- Session opened here: it's the real Claude Code (type, answer; Esc interrupts the agent, as in the terminal).
- Session opened in another terminal: **Take over here** (at the top of the window) ends the session there and
  continues the **same conversation** here (`claude --resume <session>`, in the same folder and account). The character
  keeps its name. On Windows, the
  terminal the session came from goes back to normal (Habblaud turns off the mouse/keyboard modes that Claude turned on).
- **End** closes the session, whether it's here or in another terminal (the conversation is saved).
- **New session** (in the room's drawer) opens a new Claude Code in the project folder.

Taking over and ending ask for a second click; closing the window doesn't end the session. The window (and the agent's
drawer) can be dragged by its bar and resized from the corner; double-clicking the bar puts it back in place.
**It is on under `npm run office` (which sets `HABBLAUD_PTY=1`) and off under `npm start`:** turn it on there with `HABBLAUD_PTY=1` (first read the warning in [Privacy and security](#privacy-and-security)).
It uses `node-pty`, `@xterm/headless` (optional dependencies) and the `claude` on your PATH (`HABBLAUD_CLAUDE_BIN` for
another one); it only accepts requests from the computer it runs on. On startup, Habblaud opens a test terminal: if `node-pty` or
`claude` don't work, the feature stays off and the log says why. **Restarting Habblaud ends the sessions
it opened.**
The live terminal is still available in the session history, for subagents and when the interactive one is off.

### Editing the character

Each session arrives with a random name and look. To pin a project's character, open the main
agent's details and click the pencil next to the name (**Edit character**). In the editor:

- **Name:** up to 24 characters. It can't repeat the name of someone who's in the office or the one chosen for another
  project.
- **Randomize:** brings up another look.
- **Pieces:** skin, hair, beard, eyes, top, bottom, shoes and accessory, with a preview next to them.
- **Save:** applies to the project (the room). The next session opened in it arrives as this character. With two sessions
  at the same time in the same room, the second one gets a random character.
- **Back to random:** undoes the choice.

The choice is stored in `~/.habblaud/names.json` and goes away after 60 days without the project being used. The editor has the same safeguard as the
terminal: the pencil only shows up with the terminal on (without `HABBLAUD_TERMINAL=0`) and local access, that
is, with Habblaud reachable only from the computer it runs on and opened through `http://localhost`.

### GitHub in the office

What the agents do on GitHub livens up the project's room, with no token and no internet access: Habblaud reads the
calls in the transcripts (`gh pr create`, `gh pr merge`, `git push`, `gh run watch`, `gh pr checks`, `gh run view`,
`gh release create` and the GitHub MCP tools) and their results.

| Event | What happens |
| --- | --- |
| 🎉 **PR opened or merged, release published** | Confetti falls in the room, everyone celebrates by hopping and a banner says why ("PR #12 merged!") for ~12 s. |
| 🚨 **Red CI** | A rotating beacon flashing in the corners of the room, a reddish floor and a "!" bubble over whoever saw the failure, until a green CI in the room (which turns into a party) or for 10 min. |
| 🚀 **Push** | Just the notice and the feed. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/github-party.png" alt="The app-mobile room partying: confetti falling, the golden banner 'PR #12 merged!' and Jéssica standing with her arms up and a star over her head" /></td>
    <td width="50%"><img src="docs/screenshots/github-alarm.png" alt="The data-pipeline room on alert: reddish floor, red banner 'CI failed (feat/checkout)', rotating beacons in the top corners and a red '!' bubble next to Ícaro" /></td>
  </tr>
</table>

Each event also creates a notice ("🎉 Danilo opened PR #12 in habblaud", "🚨 CI failed in habblaud (feat/x)") and goes
into the feed. Only what happens live livens up the room: whatever was already in the transcripts when Habblaud opened only goes to the
history. With "reduce motion" turned on in the system, nothing flashes or spins.

## Accounts and usage (5-hour and weekly)

If you use more than one Claude Code account (for example, a `c` shortcut with `~/.claude` and a `d` with
`CLAUDE_CONFIG_DIR=~/.claude-conta2`), Habblaud shows them all together: each agent carries its account's chip, and the
👤 Accounts window shows, for each account, the **percentage used** of the 5-hour session and of the week and **when each
limit resets**.

**How accounts are recognized.** Each Claude Code config folder is an account: `~/.claude` and any
`~/.claude*` with `projects/` or `sessions/` (plus `CLAUDE_CONFIG_DIR`). To give each one its letter, Habblaud
reads, in your shell files (`~/.zshrc`, `~/.bashrc`…), **only** the `alias x='... claude ...'` lines:

```bash
alias c='claude'
alias d='CLAUDE_CONFIG_DIR=~/.claude-conta2 claude'
```

becomes **Account C** and **Account D**. Only shortcuts of up to 3 letters count; accounts without a shortcut get A, B…

**Where the numbers come from.** Two local sources, and the one with the most recent numbers wins:

| Source | How it works |
| --- | --- |
| Claude Code `/usage` cache | Claude Code saves the last result of the `/usage` command. Habblaud rereads it every 60 s; it only changes when someone runs `/usage` on that account. |
| Antigravity `/usage` | Habblaud runs `/usage` for each Antigravity account every few minutes (`HABBLAUD_AGY_USAGE_MIN`). |

Neither reads passwords or tokens, or makes network calls. Numbers older than 30 minutes show up as **outdated**; a window
that has already reset since the numbers were collected shows up as **—** until new numbers arrive.

## Configuration

Everything works without configuring anything. If you need to adjust something, use environment variables:

| Variable | Default | What for |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | HTTP port. |
| `HABBLAUD_HOST` | `127.0.0.1` | Server interface. Anything other than `127.0.0.1`/`localhost` turns off the terminal. |
| `HABBLAUD_CLAUDE_DIRS` | automatic detection | Account folders, comma-separated (e.g. `/path/acc1,/path/acc2`). |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Where Habblaud keeps its own data (character and room names). |
| `HABBLAUD_ALLOWED_HOSTS` | — | Extra names accepted in the address (e.g. `my-pc.local`), besides `localhost` and IPs. |
| `HABBLAUD_TERMINAL` | on (local access only) | `0` turns off the terminal and the character editor. With the port exposed they're already off, with no way to turn them on. |
| `HABBLAUD_PTY` | on under `npm run office`, off otherwise | `1` turns on the interactive terminal (open, take over and end Claude Code sessions from the office; local access only). |
| `HABBLAUD_CLAUDE_BIN` | `claude` from PATH | The Claude Code executable that the interactive terminal runs. |
| `HABBLAUD_REMOTE_ALLOW` | `none` (view only) | What the [phone with login](#phone-with-login-and-https) can do: `terminal`, `spawn` (comma-separated) or `none`. The other `HABBLAUD_REMOTE_*` are in that section. |
| `HABBLAUD_LANG` | system language, otherwise `en` | Language of the texts the server builds (activities, notices, logs): `en` or `vi`. The interface follows the browser or the choice in Settings › Language. See [Languages](#languages). |
| `HABBLAUD_ACCOUNTS` | — | JSON to customize name, letter or color, matched by the account folder name. E.g. `[{"id":".claude-conta2","name":"Work","short":"T","color":"#5cc97b"}]`. |
| `HABBLAUD_AGY` | on | `0` turns off the Antigravity workers. |
| `HABBLAUD_AGY_USAGE_MIN` | `15` | Minutes between two reads of each Antigravity account's `/usage`; `0` turns it off. |
| `HABBLAUD_AGY_PROFILES` | `~/.agy_profiles` | Where the Antigravity profiles and `team.json` live. |

## How it works

```
 ~/.claude*/sessions/<pid>.json ─────────────────┐
 ~/.claude*/projects/<project>/<session>.jsonl ──┼──▶ Node server ──▶ office model ──▶ SSE ──▶ browser
 .../<session>/subagents/**/agent-*.jsonl ───────┘    (1 s polling)                           (canvas + interface)
```

- **Who's in the office:** while a session is open, Claude Code keeps `sessions/<pid>.json` with the
  project and the status (busy, idle, waiting on you or waiting on a background shell). That's what decides
  who shows up and what each one does.
- **Running shells:** in the transcripts, each background `Bash` (or long foreground command) becomes a
  "shell" with a label and a timer, until the notification arrives that it finished, failed or was interrupted.
- **What each one is doing:** the server follows the end of the transcripts (`.jsonl`) of the open sessions and turns
  each tool call into an activity, with an icon, in the server's language (see [Languages](#languages)). Tasks, title, model and
  stats come from there too.
- **Subagents:** the transcripts in `<session>/subagents/` (including those from workflows) become characters
  linked to the agent that called them.
- **Workers:** an Antigravity or Claude Code worker runs in its own terminal in the office; `worker-ask`
  starts each job there and read the answer from the conversation file (see [`tools/agy/README.md`](tools/agy/README.md)).
- **GitHub:** PRs, pushes, CI and releases come from the same transcript lines (the command and its output, or the
  `gitOperation` that Claude Code itself records); nothing is queried on GitHub.
- **The drawing:** the browser receives the state over SSE and draws everything on a canvas — characters, furniture, floors and walls
  are pixel art **generated by code**; the logo, the illustrations and the pictures on the walls, on the other hand, were generated with AI.

Code structure and the API are in [`server/README.md`](server/README.md).

```
shared/   protocol (types.ts), activities, names
server/   HTTP + SSE server: accounts and usage, reading sessions and transcripts, office model, workers
client/   Vite: src/art (procedural pixel art), src/world (office canvas), src/ui (interface)
scripts/  server build, office.sh, i18n check, phone setup (remote:setup, remote:mdns)
tools/    agy: worker scripts (worker-ask, agy-as) and the skills
```

## Privacy and security

- **Read-only:** Habblaud never writes to the Claude Code folders.
- **Local only, by default:** the server only accepts connections from the computer it runs on; opening it to the local
  network is optional. There's no telemetry and nothing leaves the computer. The
  [phone with login](#phone-with-login-and-https) only exists after `npm run remote:setup`.
- **No credentials:** Habblaud doesn't read passwords or access tokens. From each account's `.claude.json` it only uses the
  email, the organization and the `/usage` cache.
- **Masked secrets:** tokens and passwords in known formats (`Bearer`, `-u user:password`, `TOKEN=`, `sk-…`,
  `ghp_…`, `AKIA…` keys, JWTs, passwords in URLs) become `***` before they reach the browser.
- **Protected against malicious sites:** the server refuses addresses that aren't `localhost`/IP (DNS rebinding) and
  `POST` requests coming from other origins (CSRF), and doesn't let the page be embedded in other sites.
- **Local-only terminal:** the full conversation of the sessions (and the history of the ended sessions, with their
  titles) only leaves the server with Habblaud reachable only from the computer it runs on (`HABBLAUD_HOST` local) —
  there's no way to turn it on with the port exposed — and each request has to come through `localhost`/`127.0.0.1`:
  network IPs and names from `HABBLAUD_ALLOWED_HOSTS` (proxies, tunnels) are refused. Secrets are masked and long texts
  truncated before they reach the browser. `HABBLAUD_TERMINAL=0` turns it off for good.
  The one exception is the [phone with login](#phone-with-login-and-https), and only with `terminal` in `HABBLAUD_REMOTE_ALLOW`.
- **Interactive terminal, opt-in — and with a warning:** with `HABBLAUD_PTY=1`, the office opens Claude Code in
  any folder, types into it (including `!command`, which runs in the shell) and ends or takes over sessions
  open in other terminals. It follows the same safeguard as the terminal (local bind, local `Host`, no proxies
  or tunnels) and each request has to come from the computer it runs on, with a local origin (a site open in the
  browser can't send one). Even so, **any program on this machine** that talks to `http://localhost:4747` — including
  an agent running a command — gets that power. Before ending a process from outside, Habblaud checks in the session
  registry and in the system that that PID is still that Claude Code (same start time and executable). On shared
  computers or with agents running unsupervised, leave it off.
- **Phone with login, opt-in:** only exists after `npm run remote:setup`. A second port with HTTPS (a local CA that only
  signs `.local` names, `localhost`, your own address and private IPs), a username and a password (only the scrypt
  hash is stored); the session is an `HttpOnly`, `SameSite=Strict`, `Secure` cookie signed with HMAC. On that port,
  what is allowed comes from `HABBLAUD_REMOTE_ALLOW`, never from the Host header; the interactive terminal, the
  character editor and renaming rooms never work through it. Whoever has the password gets what you allowed: choose a
  strong one and allow only what you need. The CA key stays in `~/.habblaud/remote-tls/ca`.
- **Character editor, local only:** saving or going back to random changes the office and writes to `names.json`, so it
  follows the same safeguard as the terminal (local bind, local `Host`, no proxies or tunnels): without it, the pencil doesn't show up
  and the server answers `403`. Changes require JSON and a local origin. `HABBLAUD_TERMINAL=0` turns it off too.
- **What shows up on screen:** activity summaries (tool, file, command or query), session titles,
  tasks and stats (and, in the terminal, the conversation). Don't expose the port on networks you don't
  trust.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + Vite at http://localhost:4747, with hot reload. |
| `npm run dev:client` | Vite only, at http://localhost:5173 (`/api` is proxied to port 4747). |
| `npm run build` / `npm start` | Builds and runs the production version. |
| `npm run office` | Builds and starts it in the background. |
| `npm test` | Tests (Vitest). |
| `npm run typecheck` | Type checking for the client, the server and the scripts. |
| `npm run i18n:check` | Lists untranslated texts and leftover translations. |
| `python3 -m pytest tools/agy/tests` | Tests of the worker scripts. |

In the browser console, `habblaud.world.debug` has tools for testing scenes (e.g.
`habblaud.world.debug.setHour(21)` to see the night). To set the time right when it opens, use `?hora=21:30` in the URL.

Note the changes under "Unreleased" in [`CHANGELOG.md`](CHANGELOG.md) as you work.

## Troubleshooting

<details>
<summary><b>The office is empty</b></summary>

Only **open** Claude Code sessions show up. Check whether there's one running and whether the account was detected at
`http://localhost:4747/api/health`. If the account folders are somewhere else, use
`HABBLAUD_CLAUDE_DIRS=/path/acc1,/path/acc2`.

</details>

<details>
<summary><b>Usage shows "no data" or "outdated"</b></summary>

Run `/usage` in Claude Code on that account: it refreshes the cache Habblaud reads, and the numbers go stale until the
next time. A **—** in place of the percentage means the window has reset since the last collection. For an Antigravity
account, the numbers come from its own `/usage`, read every few minutes.

</details>

<details>
<summary><b>"Port 4747 is already in use"</b></summary>

Another Habblaud is already running. Stop it (Ctrl+C in the `npm start` terminal, or the `kill` line in
[Run it every day](#run-it-every-day)) or use another port: `HABBLAUD_PORT=4848 npm run office`.

</details>

<details>
<summary><b>It doesn't open on my phone</b></summary>

Check that you started it with `HABBLAUD_HOST=0.0.0.0 npm start`, that the phone is on the same Wi-Fi and that the
computer's firewall allows connections on port 4747. By IP it works right away; to open it by a name (e.g.
`my-pc.local`), add `HABBLAUD_ALLOWED_HOSTS=my-pc.local`.

</details>

<details>
<summary><b>The terminal doesn't open</b></summary>

The terminal only exists with Habblaud reachable only from the computer it runs on. Check that you didn't use
`HABBLAUD_HOST=0.0.0.0` or `HABBLAUD_TERMINAL=0`, and open it through `http://localhost:4747` (through the network IP or a
name from `HABBLAUD_ALLOWED_HOSTS` it's refused). The startup log says whether the terminal is on and, if it isn't, why.

</details>

## Disclaimer

Habblaud is an independent project, **not affiliated with, sponsored or endorsed by Anthropic**. "Claude" and
"Claude Code" are trademarks of Anthropic, used here only to describe what the project works with.

To show the agents, Habblaud only reads local files that Claude Code itself writes on your machine
(records of the open sessions, transcripts and account settings). This format isn't documented and may change between Claude Code versions:
after an update, Habblaud may stop working, fully or partially, until it's adjusted.

## License

[MIT](LICENSE). The images in `client/public/assets` (logo, illustrations, pictures and posters) were generated with
AI for this project and converted into pixel art by the scripts in `scripts/assets/`.

---

<p align="center">
  Made with ☕ and lots of <a href="https://code.claude.com">Claude Code</a> agents.
</p>
