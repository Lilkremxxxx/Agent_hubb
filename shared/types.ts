// Protocol shared between the server (Node) and the client (browser).
// Pure code: no Node or DOM APIs.
//
// Evolution rule: changes here must be ADDITIVE (new optional fields).
// Renaming/removing fields breaks server, world, and UI simultaneously.

import type { AppearanceParts } from './appearance';

export type AgentKind = 'main' | 'sub';

/**
 * Which tool the agent (or account, source, session, request) comes from. In protocol types the `provider`
 * field is optional and ABSENT means 'claude'.
 * - claude: Claude Code;
 * - agy: Antigravity CLI.
 */
export type Provider = 'claude' | 'agy';

/**
 * High-level state of an agent — drives character behavior.
 * - working: processing a turn (busy). Sits at desk typing.
 * - waiting: needs the user (permission, question, dialog). Sits at desk with hand raised.
 * - idle: turn finished, waiting for next instruction. Walks around office (coffee, water cooler...).
 * - shell: turn finished, but shell(s) running in background (see `shells`); waiting for shell
 *   to finish. Sits at desk watching terminal. (Claude Code records "shell" when session is idle
 *   with background shells.)
 * - done: subagent completed. Delivers result to main agent and leaves.
 * - offline: session closed. Leaves (if last in room, turns off the lights).
 */
export type AgentStatus = 'working' | 'waiting' | 'idle' | 'shell' | 'done' | 'offline';

/** A shell command the agent is waiting to finish. */
export interface ShellJob {
  /** Background task ID (e.g.: "bo0ov3q3l") or foreground tool_use ID. */
  id: string;
  /** Short text: Bash description or command summary (secrets masked). */
  label: string;
  /** Full command (masked, up to ~300 characters), if any. */
  command?: string;
  /** Epoch ms when command started. */
  startedAt: number;
  /** true = run_in_background (agent finished turn and waits for notification); false = foreground pending result. */
  background: boolean;
  /** 'monitor' = Monitor tool (tracks a process); 'shell' = Bash. */
  kind: 'shell' | 'monitor';
}

export type ActivityKind =
  | 'prompt' // received new user instruction
  | 'think' // thinking (thinking block)
  | 'respond' // writing text response
  | 'read'
  | 'search'
  | 'edit'
  | 'write'
  | 'run' // terminal command
  | 'test'
  | 'git'
  | 'web'
  | 'browser'
  | 'plan' // tasks / planning
  | 'delegate' // spawned subagent(s)
  | 'communicate' // message to another agent / notice
  | 'ask' // question to user
  | 'mcp'
  | 'skill'
  | 'wait'
  | 'error'
  | 'compact' // context compaction
  | 'done' // finished turn
  | 'other';

export interface Activity {
  /** Unique per activity (e.g.: entry uuid + block index). */
  id: string;
  kind: ActivityKind;
  /** Emoji representing the activity. */
  icon: string;
  /** Short text (up to ~46 characters). E.g.: "Editing App.tsx". */
  text: string;
  /** Optional detail (full command, path, query...), up to ~300 characters. */
  detail?: string;
  /** Raw tool name, if any. */
  tool?: string;
  /** Epoch ms. */
  at: number;
  durationMs?: number;
  error?: boolean;
  /** Full questions from AskUserQuestion (kind 'ask'), for office to display options. */
  questions?: AskQuestion[];
}

/**
 * An AskUserQuestion question, masked and trimmed. The answer is given in Claude Code.
 */
export interface AskQuestion {
  /** Question position in `tool_input.questions` (invalid entries skipped, so there may be gaps). */
  index: number;
  question: string;
  header?: string;
  multiSelect?: boolean;
  /** `index` = option position in original `options`. */
  options: Array<{ index: number; label: string; description?: string }>;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  /** Gerund form ("Writing tests"), when available. */
  activeForm?: string;
}

export interface AgentStats {
  toolCalls: number;
  /** input + cache read + cache creation. */
  tokensIn: number;
  tokensOut: number;
  costUSD?: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** Total subagents spawned by this agent. */
  subagents: number;
  /** Context in use: input + cache read + cache creation of the latest assistant message (shared/overload.ts). */
  contextTokens?: number;
  /** Times the session was compacted. */
  compacts?: number;
}

/** Achievement of an Antigravity worker (server/sources/agy/progress.ts). */
export interface WorkerBadge {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** When earned (epoch ms). */
  at: number;
}

/** Level and achievements of an Antigravity worker, extracted from agy-ask logs. */
export interface WorkerProgress {
  level: number;
  /** Rank by level ("Intern", "Junior"...). */
  rank: string;
  xp: number;
  /** XP at start of current level and next level (bar runs from one to the other). */
  levelXp: number;
  nextXp: number;
  /** Completed jobs. */
  jobs: number;
  badges: WorkerBadge[];
}

/** A hung worker: its job shows no progress ('stalled'), or its agy is alive with no job ('no-job'). */
export interface AgentGhost {
  reason: 'stalled' | 'no-job';
  /** Last sign of life (epoch ms). */
  since: number;
  pid?: number;
}

export interface AgentInfo {
  /**
   * Stable while agent exists. Claude Code: main "<account>:<pid>", sub "<sessionId>:<agentId>".
   */
  id: string;
  /** The office (OfficeInfo.id) whose building this character is drawn in; absent = the first office's building. */
  office?: string;
  kind: AgentKind;
  /** Agent tool; absent = 'claude'. */
  provider?: Provider;
  /** For subagents: id of the agent that spawned it. */
  parentId?: string;
  roomId: string;
  /** Unique human name in the office. E.g.: "Marina". */
  name: string;
  /** Name presentation hint (used by art to vary look). */
  look: 'f' | 'm';
  /** Role. Main: "Main agent". Sub: subagent type ("Explore", "Plan", "fork"...). */
  role: string;
  /** Session title (main) or task description (sub). */
  title?: string;
  sessionId: string;
  /** Source account = AccountInfo.id (config dir basename, e.g.: ".claude", ".claude-account2"). */
  account: string;
  status: AgentStatus;
  /** Reason when status === 'waiting'. E.g.: "approve permission". */
  waitingFor?: string;
  /** Current (or most recent) activity. */
  activity?: Activity;
  /** Recent activities, oldest to newest (max ~30). */
  recent: Activity[];
  tasks: TaskItem[];
  /** Running shells the agent waits for: background ones and foreground command still pending result. */
  shells?: ShellJob[];
  model?: string;
  /**
   * Context window of the session's model in tokens, when known; otherwise shared/overload.ts guesses it from
   * `model`.
   */
  contextWindow?: number;
  /** Reasoning effort in use: Claude Code from the transcript, Antigravity from the agy log. */
  effort?: string;
  gitBranch?: string;
  permissionMode?: string;
  startedAt: number;
  lastEventAt: number;
  /** When status last changed (epoch ms). */
  statusSince: number;
  stats: AgentStats;
  /** 32-bit seed for deterministic character appearance. */
  seed: number;
  /** Parts chosen in character editor, applied over `seed` appearance (see shared/appearance.ts). */
  parts?: AppearanceParts;
  /** Uses character chosen for project (the room): panel offers "Reset to random". */
  custom?: true;
  /** Subagent running in background. */
  background?: boolean;
  /** Antigravity worker: level, XP, and achievements (provider 'agy' only). */
  progress?: WorkerProgress;
  /** Antigravity worker: mode and effort for jobs that do not say (~/.agy_profiles/defaults.json). */
  agyDefaults?: { mode?: string; effort?: string };
  /** The worker looks hung: drawn as a faint ghost on its seat (server/workers/ghosts.ts). Nothing is stopped by it. */
  ghost?: AgentGhost;
  /** The boss: Claude Code requesting work from Antigravity workers (crown, BOSS badge, and suit). */
  boss?: boolean;
}

export interface RoomInfo {
  /** Stable key: normalized project cwd. */
  id: string;
  /** The office (OfficeInfo.id) whose building holds this room; absent = the first office's building. */
  office?: string;
  /** Display name (cwd basename, disambiguated if repeated). */
  name: string;
  /** Full project path. */
  path: string;
  /**
   * Room arrival order, assigned by server and stable while room exists (freed slot reused only after
   * a cooldown). Client uses only for ordering: in building, each room takes first free slot and when a
   * slot frees up between rooms, the farthest moves into it (client/src/world/sim/sim.ts, compact).
   * Client slot: column = floor(slot / 2); even = north side of hallway, odd = south side.
   */
  slot: number;
  /** Seed for deterministic colors/decoration. */
  seed: number;
  createdAt: number;
  /** Temporary visual effect in room (GitHub events detected in transcripts; see shared/github.ts). */
  effect?: RoomEffect;
  /** Antigravity workers room job board (server/sources/agy/source.ts). */
  board?: JobBoard;
}

/** A job on the board: who does it, role, request, and status. */
export interface JobBoardItem {
  /** Unique (worker + agy PID). */
  id: string;
  agentId: string;
  worker: string;
  role?: string;
  /** Request prefix (up to ~140 characters). */
  text: string;
  status: 'working' | 'done' | 'failed' | 'cancelled';
  at: number;
  endedAt?: number;
  tokens?: number;
  /** Of `tokens` when the worker reports them: served from the prompt cache, and written to it. */
  cacheRead?: number;
  cacheWrite?: number;
  /** WorkerJob.id when the job ran through the worker's terminal (server/workers): it can be cancelled. */
  job?: string;
  /** Worker id (TeamInfo.workers) of that job. */
  workerId?: string;
}

/** The board: last order given to boss and recent jobs (newest first). */
export interface JobBoard {
  order?: { text: string; at: number; boss: string };
  items: JobBoardItem[];
}

/**
 * Temporary effect in a project room, triggered by a live GitHub event:
 * - party: celebration (PR opened or merged, release, green CI after alarm); lasts ~12 s;
 * - alarm: red CI; lasts until green CI in that room or expires in ~10 min.
 */
export interface RoomEffect {
  kind: 'party' | 'alarm';
  /** Short banner text. E.g.: "PR #12 merged!", "CI failed (feat/x)". */
  text: string;
  /** Start (epoch ms, server clock): a new effect has a different `at`. */
  at: number;
  /** Scheduled end (epoch ms, server clock). */
  until: number;
  /** Responsible agent: opener/merger (party) or observer of CI failure (alarm, "!" bubble). */
  agentId?: string;
}

export interface SourceInfo {
  /** Account label (config dir basename). */
  label: string;
  /** Source tool; absent = 'claude'. */
  provider?: Provider;
  path: string;
  /** Open sessions detected in this source. */
  sessions: number;
  ok: boolean;
  error?: string;
}

/** Plan usage limit window (e.g.: 5h session, weekly). */
export interface UsageWindow {
  /** Percentage used, 0–100. */
  utilization: number;
  /** When window resets (epoch ms). */
  resetsAt?: number;
}

export interface AccountUsage {
  /** 5-hour session. */
  fiveHour?: UsageWindow;
  /** Weekly limit (all models). */
  sevenDay?: UsageWindow;
  sevenDayOpus?: UsageWindow;
  sevenDaySonnet?: UsageWindow;
  /**
   * Numbers origin (all are local files written by the tool itself):
   * - 'cache': `cachedUsageUtilization` written by Claude Code itself (updates when someone runs /usage);
   * - 'agy': Antigravity CLI `/usage`, run periodically by its source (local command, no model).
   */
  source: 'cache' | 'agy';
  /** The plan has no 5-hour window, only the weekly one (Antigravity account without Pro). */
  noFiveHour?: boolean;
  /** When numbers were fetched at origin (epoch ms). */
  fetchedAt: number;
}

/** A Claude account (a config dir: ~/.claude, ~/.claude-account2, ...). */
export interface AccountInfo {
  /** = AgentInfo.account (config dir basename, e.g.: ".claude"); unique across accounts of all tools. */
  id: string;
  /** Account tool; absent = 'claude'. */
  provider?: Provider;
  /** Very short label (1–3 characters), e.g.: "C" and "D" — shell shortcuts detected — or derived. */
  short: string;
  /** Friendly name. E.g.: "Account C". */
  name: string;
  email?: string;
  organization?: string;
  /** Plan, when known (e.g.: "Max", "Pro"). */
  plan?: string;
  /** Account identification color (hex). */
  color: string;
  configDir: string;
  /** Sessions currently open in this account. */
  sessions: number;
  usage?: AccountUsage;
  /**
   * - ok: recent numbers;
   * - stale: old numbers (e.g.: /usage cache from hours ago);
   * - disabled: no numbers (no /usage cache).
   */
  usageStatus: 'ok' | 'stale' | 'disabled';
}

/** The team (server/team.ts, <dataDir>/team.json): the seats. */
/** Worker id: a seat name from team.json (e.g. "W1"). */
export type WorkerId = string;
export type WorkerKind = 'agy' | 'claude';

/** A job given to a worker through its terminal (server/workers): one fresh conversation per job. */
export interface WorkerJob {
  id: string;
  worker: WorkerId;
  /** The request, first ~300 characters, secrets masked. */
  prompt: string;
  role?: string;
  mode?: string;
  effort?: string;
  /**
   * queued: waiting for the worker; working: running in its terminal; done/failed/cancelled: over.
   */
  status: 'queued' | 'working' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  /** Final answer only (never the screen), up to the caller's limit. */
  answer?: string;
  error?: string;
  tokens?: number;
  /** The seat's last question to the boss during this job (advisor), ≤300 characters. */
  question?: string;
}

/** A seat's terminal session (server/workers). */
export interface WorkerSession {
  worker: WorkerId;
  kind: WorkerKind;
  /** Its character (stable while it is a seat). */
  agentId: string;
  /** AccountInfo.id. */
  account: string;
  /** Its terminal (PtyInfo.id), while running. */
  ptyId?: string;
  /** The current job (WorkerJob.id), if any. */
  job?: string;
}

/** The one office: a team working in one project folder: its boss, its seats and its jobs. */
export interface OfficeInfo {
  id: string;
  name: string;
  /** Absolute project folder; '' = not declared yet (an office carried over from the old team file). */
  folder: string;
  /** Room of the folder (RoomInfo.id), while someone works there. */
  roomId?: string;
  workers: WorkerId[];
  /** The boss's account (AccountInfo.id); absent = no boss. */
  bossAccount?: string;
  bossKind?: WorkerKind;
  /** The boss's character (AgentInfo.id), while it is open. */
  bossAgentId?: string;
  /** Agent id of a boss opened from the office ("＋ Boss") that has not shown up yet. */
  pendingBoss?: string;
  /** The appointed boss's name, when its session is closed (the crown and the CLI rule wait for it). */
  waitingBoss?: string;
}

export interface TeamInfo {
  /** The one office (a list of one; absent on a server from before offices). */
  offices?: OfficeInfo[];
  /** @deprecated the first office's workers (before offices); use offices[]. */
  workers: WorkerId[];
  /** Every logged-in Antigravity profile, registered or not: its profile name and account id (AccountInfo.id). */
  agy: Array<{ acc: string; account: string }>;
  /** The boss's account (AccountInfo.id): it cannot be a worker; absent = no boss. */
  bossAccount?: string;
  /** The boss's kind ('claude' session or 'agy' terminal). */
  bossKind?: WorkerKind;
  /** Agent id of a boss opened from the office ("＋ Boss") that has not shown up yet. */
  pendingBoss?: string;
  /** The appointed boss's name, when its session is closed: the crown waits for it, and agy-ask still refuses others. */
  waitingBoss?: string;
  /** Terminal sessions of the seats (server/workers). */
  sessions?: WorkerSession[];
  /** Recent terminal jobs, newest first (up to ~30). */
  jobs?: WorkerJob[];
}

export interface OfficeSnapshot {
  /** Increments on each change. */
  rev: number;
  serverTime: number;
  rooms: RoomInfo[];
  agents: AgentInfo[];
  /** Interactive terminals opened by Habblaud (Claude Code running inside the browser). */
  ptys?: PtyInfo[];
  /** The team: the seats (absent = no team service). */
  team?: TeamInfo;
  /** Detected Claude accounts (with 5h/weekly usage when available). */
  accounts: AccountInfo[];
  meta: {
    sources: SourceInfo[];
    startedAt: number;
    version: string;
    /**
     * Build identifier of client being served by server (bundle name, e.g.: "main-BFqheOCa").
     * A page opened with another build is outdated and should reload. Absent in dev mode.
     */
    build?: string;
    /**
     * Terminal (GET /api/agents/:id/terminal) available: only when Habblaud is not exposed
     * beyond localhost (local bind). Absent/false = feature disabled.
     */
    terminal?: boolean;
    /**
     * Interactive terminal (open/take over sessions and exit agents via office): with node-pty and local access. Absent = feature disabled.
     */
    pty?: PtyStatus;
  };
}

/**
 * What THIS page can do (GET /api/access): local port allows everything via local Host; remote port with login
 * (server/http/remote.ts) only what HABBLAUD_REMOTE_ALLOW permits. `local` = opened from computer itself (edit
 * character and rename rooms, which never apply via remote port).
 */
export interface AccessInfo {
  remote: boolean;
  local: boolean;
  terminal: boolean;
  /** Can spawn new agents in Claude app (POST /api/spawn). */
  spawn: boolean;
}

export interface FeedItem {
  id: string;
  agentId: string;
  roomId: string;
  agentName: string;
  roomName: string;
  /** Agent account (= AccountInfo.id). */
  account?: string;
  activity: Activity;
}

export type NoticeLevel = 'info' | 'success' | 'warn' | 'alert';

export interface Notice {
  id: string;
  level: NoticeLevel;
  text: string;
  agentId?: string;
  roomId?: string;
  at: number;
}

/**
 * Server messages via SSE in GET /api/stream.
 * Each message arrives as a named SSE event (`event: snapshot|feed|notice`) whose `data` is JSON of `data`.
 * Upon connecting, server sends a full `snapshot` and a `feed` with recent items.
 */
export type ServerMessage =
  | { type: 'snapshot'; data: OfficeSnapshot }
  | { type: 'feed'; data: FeedItem[] }
  | { type: 'notice'; data: Notice };

/** Response of GET /api/agents/:id */
export interface AgentDetail {
  agent: AgentInfo;
  /** Longer history (max ~200), oldest to newest. */
  history: Activity[];
}

// ------------------------------------------------------------------ terminal

/**
 * How to display the `input` of a tool call:
 * - command: shell command; diff: "- old" / "+ new" lines (Edit/Write); json: raw args; text: plain text.
 */
export type TerminalInputKind = 'command' | 'diff' | 'json' | 'text';

/**
 * A terminal entry: session conversation reconstructed from JSONL transcript,
 * in the format Claude Code displays it. All text is masked and truncated.
 * Entries are only appended (never edited): tool result arrives later in a
 * 'result' entry pointing to 'tool' via `toolUseId`.
 */
export type TerminalEntry =
  /** User prompt or slash command (e.g.: "/model"). */
  | { kind: 'user'; id: string; at: number; text: string }
  /** Agent response text (markdown). */
  | { kind: 'assistant'; id: string; at: number; text: string }
  /** Thinking block; `text` absent when transcript only stores signature. */
  | { kind: 'thinking'; id: string; at: number; text?: string }
  /**
   * Tool call. `id` = tool_use id. `title` in Claude Code style: "Bash(npm test)",
   * "Read(server/index.ts)". `input` = relevant arguments (command, diff...), if any.
   */
  | { kind: 'tool'; id: string; at: number; tool: string; title: string; input?: string; inputKind?: TerminalInputKind }
  /** Tool result. `truncated` = text was truncated (result too long). */
  | { kind: 'result'; id: string; at: number; toolUseId: string; text: string; error?: boolean; truncated?: boolean }
  /** Session event: compact, interrupt, background result, API error... */
  | { kind: 'system'; id: string; at: number; text: string; detail?: string; level?: 'info' | 'warn' | 'error' };

/** Terminal stream `init` event: recent conversation (replaces everything client has). */
export interface TerminalInit {
  agentId: string;
  /** Oldest to newest. */
  entries: TerminalEntry[];
  /** Previous conversation exists that was not loaded (transcript larger than read window). */
  truncated: boolean;
}

/**
 * Terminal stream (Server-Sent Events) at GET /api/agents/:id/terminal.
 * Upon connecting (and on each reconnection, or if transcript is truncated/replaced) an `init` arrives;
 * then `append` with new entries. Errors before stream respond with JSON `{error}`:
 * 403 (feature disabled or non-local access), 404 (unknown agent/transcript),
 * 429 (too many open terminals).
 */
export type TerminalMessage = { type: 'init'; data: TerminalInit } | { type: 'append'; data: TerminalEntry[] };

/**
 * A recent session (open or already closed) in terminal history, at
 * GET /api/sessions/recent. Conversation of a closed session is returned with same terminal
 * protocol (TerminalMessage) from GET /api/sessions/:account/:sessionId/terminal.
 */
export interface RecentSession {
  /** = AccountInfo.id. */
  account: string;
  /** Session tool; absent = 'claude'. */
  provider?: Provider;
  sessionId: string;
  /** Project path (`cwd` from transcript header lines); absent if undetectable. */
  project?: string;
  /** Project folder name in `projects/` (encoded cwd), fallback when `project` missing. */
  projectDir: string;
  /** Title like agent: /rename > agent name > auto title > last prompt (or first). */
  title?: string;
  /** First and last timestamped activity (epoch ms); `lastAt` falls back to file mtime if no end timestamp. */
  firstAt?: number;
  lastAt: number;
  /** Transcript size in bytes. */
  size: number;
  /** Session still open: `agentId` is its main agent in office. */
  open: boolean;
  agentId?: string;
}

/** Response of GET /api/sessions/recent: newest to oldest activity. */
export interface RecentSessionsResponse {
  sessions: RecentSession[];
  /** Listing window (days) and max sessions. */
  days: number;
  limit: number;
}

/** Interactive terminal state (OfficeSnapshot.meta.pty). */
export interface PtyStatus {
  enabled: boolean;
  /** Why it is disabled. */
  reason?: string;
}

/** Interactive terminal opened by Habblaud (node-pty on server, xterm.js in browser). */
export interface PtyInfo {
  id: string;
  /** Claude Code PID: corresponding agent is `${account}:${pid}` (= agentId). */
  pid: number;
  cwd: string;
  account: string;
  agentId: string;
  /** Resumed session (`claude --resume`), when terminal took over an existing session. */
  resumed?: string;
  /** Agent this terminal took over (old id of terminated process). */
  fromAgent?: string;
  startedAt: number;
  exitedAt?: number;
  exitCode?: number;
}
