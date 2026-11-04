// Antigravity CLI agent source (AgentSource 'agy', see sources/source.ts): the `agy` workers Claude Code uses as
// helpers, one isolated profile per account in ~/.agy_profiles/accN (sources/agy/profiles.ts).
//
// Every profile is an account (AccountsService, `/usage`, login terminal); only the seats of the team (server/team.ts,
// setTeam) get a character, in the office folder, named after the seat.
// The profiles folder is re-read every RESCAN_MS, so an account logged in later shows up on its own.
// None of this costs tokens: status comes only from local files and processes.
// - Working: an `agy` process of the account is running (sources/agy/procs.ts). A headless call (agy-ask, batch
//   scripts) = a job, with the prompt as the activity.
// - Job end: the process goes away. agy-ask writes the end (status, seconds, tokens) to
//   ~/.agy_profiles/agy-ask.log.jsonl right AFTER killing agy: the "Done" activity waits for that line for up to
//   END_WAIT_MS (matched by the agy-ask PID, agy's parent) and, without it, comes out without the numbers.
// - Role: the request's `--role` (agy-ask "start" line, written before agy opens), it becomes the worker's
//   title only while it works.
// - Tokens: those of today's "end" lines, summed per account (boot re-reads the end of the log so a restart does not
//   reset them).
// - Level, XP and badges (sources/agy/progress.ts): from ALL "end" lines of the log; a live level-up or badge throws a
//   party in the room. "Full house": every worker busy at once (at most every FULL_HOUSE_MS).
// - Job board (RoomInfo.board): from the agy-ask start/end lines too, so it survives a restart.
// - Plan usage: each account's `/usage` (sources/agy/usage.ts), one at a time, every config.agy.usageMs.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Activity, AgentStats, AgentStatus, JobBoardItem, SourceInfo } from '../../../shared/types';
import { formatDuration, maskSecrets, truncate } from '../../../shared/activity';
import type { AccountsService } from '../../accounts/service';
import { errMsg, log } from '../../log';
import type { Office, TranscriptSummary } from '../../model/office';
import type { AgentSource } from '../source';
import { FileTail } from '../tail';
import { agyDetected, discoverAgyProfiles, workerLabel, workerName, type AgyProfile } from './profiles';
import { procReader, scanAgyProcs, type AgyProc, type ProcReader } from './procs';
import { BADGES, rankOf, WorkerTracker } from './progress';
import { parseAgyUsage, runAgyUsage } from './usage';
import { findAgyCliLog, readAgyRun, settingsModel, type AgyRunInfo } from './clilog';
import { AgyDefaultsFile, type AgyDefaults } from './defaults';
import { tr } from '../../../shared/i18n';
import type { GhostCandidate } from '../../workers/ghosts';
import { lastWrite } from '../../workers/turns';

/** How often the profiles folder is re-read (accounts logged in or removed while the server runs). */
export const RESCAN_MS = 30_000;
/** Wait for the agy-ask end line after agy is gone. */
export const END_WAIT_MS = 4_000;

/** How much of the end of the log boot re-reads (today's tokens, level and badges, job board). */
export const BOOT_LOG_BYTES = 32 * 1024 * 1024;
/** Jobs kept on the room board (the newest). */
export const BOARD_ITEMS = 50;
/** Minimum interval between two "Full house" parties. */
export const FULL_HOUSE_MS = 10 * 60_000;

/** A line of agy-ask.log.jsonl (only the fields used). */
export interface AgyAskLine {
  event: 'start' | 'end';
  /** Epoch seconds. */
  ts?: number;
  acc?: string;
  role?: string;
  mode?: string;
  model?: string;
  effort?: string;
  /** PID of the Claude Code that ran agy-ask, if any (the job shows "requested by Claude"). */
  claude_pid?: number | null;
  /** agy-ask PID (the parent of the agy process). */
  pid?: number;
  status?: string;
  sec?: number;
  /** Start line: the first 200 characters of the prompt. */
  prompt?: string;
  /** End line of a failed job: the last error lines (e.g. 429 "Individual quota reached"). */
  error?: string;
  usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; total_tokens?: number; cache_read_tokens?: number };
  /** "terminal": a job run in the worker's terminal by server/workers (it puts it on the board itself). */
  via?: string;
}

/** A character to show for a profile (server/team.ts seat, or the Antigravity boss). */
export interface AgySeat {
  acc: string;
  /** Agent id: the first seat of an account is "agy:<acc>", later ones "agy:<acc>@<name>", the boss "agy-boss:<acc>". */
  agentId: string;
  name: string;
  /** Folder its room is made of (the office folder; empty = not set yet, the character stands in home). */
  room: string;
  boss?: boolean;
}

/** Statuses of a job stopped on purpose: neither a success nor a failure (PAUSED only in old log lines). */
const STOPPED = new Set(['PAUSED', 'CANCELLED']);

/** Modes the office offers when sending a job (agy-ask --mode; 'default' = no mode). */
export const AGY_MODES = ['plan', 'default', 'accept-edits'] as const;
export type AgyMode = (typeof AGY_MODES)[number];
/** Maximum length of a prompt sent from the office. */
export const AGY_PROMPT_MAX = 20_000;
/** Role: short label, no spaces (goes into agy-ask --role). */
export const AGY_ROLE = /^[\p{L}\p{N}_-]{1,24}$/u;

/** Reasoning effort (`--effort`): the Gemini 3.8 Flash levels, the only model workers use (agy-ask enforces it). */
export const AGY_EFFORTS = ['low', 'medium', 'high'] as const;
/** The only model workers use (agy-ask rejects any other). */
export const AGY_MODEL = 'gemini-3.8-flash';
export interface AgyJobInput {
  prompt: string;
  /** Absent = the worker's default (agy-ask reads defaults.json). */
  mode?: AgyMode;
  role?: string;
  effort?: string;
}

export type AgyJobResult = { ok: true } | { ok: false; status: 400 | 404; error: string };

export interface AgySourceOptions {
  accounts: AccountsService;
  office: Office;
  /** Profiles root (~/.agy_profiles). */
  root: string;
  /** Home: where a character stands while the office has no folder yet. */
  home: string;
  env?: NodeJS.ProcessEnv;
  /** This server's own URL, for the worker-ask a job runs (HABBLAUD_URL). */
  selfUrl?: string;
  /** Interval of each account's `/usage` (0 = off). */
  usageMs?: number;
  /** The repo's worker-ask: runs a job on a seat (`worker-ask <seat name> <prompt> …`). */
  askBin: string;
  /** The office folder (team.json); empty = not set, sending is refused. */
  folder: () => string;
  pollMs?: number;
  /** Interval to re-read the profiles folder (RESCAN_MS). */
  rescanMs?: number;
  /** Tests: fake /proc, `/usage` and clock. */
  procs?: ProcReader;
  usage?: (acc: string) => Promise<string>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  now?: () => number;
}

interface Worker {
  profile: AgyProfile;
  /** Agent id in the Office ("agy:acc2"). */
  id: string;
  account: string;
  /** Headless jobs in progress, by agy PID. */
  jobs: Map<number, AgyProc>;
  /** Jobs that ended and wait for the agy-ask end line. */
  ending: Array<{ job: AgyProc; until: number }>;
  /** Today's tokens (agy-ask "end" lines). */
  stats: AgentStats;
  progress: WorkerTracker;
  /** What the current job's agy applied (its log, sources/agy/clilog.ts), re-read while the log grows. */
  run?: { pid: number; path?: string; size: number; info: AgyRunInfo };
}

/** "8.3k" / "1.2M". */
function tokens(n: number): string {
  if (n < 1_000) return String(n);
  const [v, u] = n < 1_000_000 ? [n / 1_000, 'k'] : [n / 1_000_000, 'M'];
  return `${v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, '')}${u}`;
}

/** First line of the prompt (or of the answer, without agy's leading "Result:"), secrets masked, sized for an activity. */
function promptText(prompt: string | undefined): string {
  const first = (prompt ?? '').split('\n').find((l) => l.trim() && !/^result:\s*$/i.test(l.trim())) ?? '';
  return truncate(maskSecrets(first.trim()), 40);
}

/** Why a job failed, in one short line: agy's `short_error` (AGY_ERROR JSON), else the last error line. */
export function errorReason(error: string | undefined): string {
  if (!error) return '';
  const short = /"short_error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(error)?.[1];
  const line = short ?? error.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  return truncate(maskSecrets(line.replace(/^failed to construct executor:\s*/i, '')), 80);
}

/** The request on a board item: one line, secrets masked, up to 140 characters. */
function boardText(prompt: string | undefined): string {
  return truncate(maskSecrets((prompt ?? '').replace(/\s+/g, ' ').trim()), 140) || tr('New job');
}

export class AgySource implements AgentSource {
  readonly provider = 'agy' as const;
  /** Every profile, seated or not (accounts, `/usage`, login terminal). */
  private all: Worker[] = [];
  /** Characters in the office now: agent id -> account. */
  private readonly shown = new Map<string, string>();
  /** The room that holds the job board now (it moves with the first character). */
  private boardRoom: string | undefined;
  /** The characters to show (server/team.ts: the agy seats and the Antigravity boss); none = no characters. */
  private seatList: AgySeat[] = [];
  /** Worker terminals (server/workers): a job running on a seat. */
  private external: ((agentId: string) => { busy: boolean; role?: string } | undefined) | undefined;
  private started = false;
  private readonly now: () => number;
  private readonly procs: ProcReader;
  private readonly tail: FileTail;
  /** Recent agy-ask lines, by its PID. */
  private readonly ends = new Map<number, AgyAskLine>();
  private readonly starts = new Map<number, AgyAskLine>();
  /** Start of the (local) day of the summed tokens. */
  private dayStart = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  /** PIDs of the agy-ask runs the office started (manual mode): the request is yours, not the Claude that started the server. */
  private readonly manual = new Set<number>();
  /** The room's job board (newest first). */
  private board: JobBoardItem[] = [];
  /** Last "Full house" party (and whether everyone is still working since). */
  private fullHouseAt = -Infinity;
  private fullHouse = false;
  private usageBusy = false;
  private seq = 0;
  private readonly defaults: AgyDefaultsFile;

  constructor(private readonly opts: AgySourceOptions) {
    this.defaults = new AgyDefaultsFile(opts.root);
    this.now = opts.now ?? Date.now;
    this.procs = opts.procs ?? procReader();
    this.tail = new FileTail(join(opts.root, 'agy-ask.log.jsonl'));
    this.rescan();
  }

  /** Profiles with a worker seat (a boss-only account is not a worker: full house, jobs). */
  private get workers(): Worker[] {
    return this.all.filter((w) => this.seatList.some((x) => x.acc === w.profile.acc && !x.boss));
  }

  /**
   * Re-reads the profiles folder: new accounts join `all` (and the accounts list), known ones keep their state
   * (jobs, tokens, level), vanished ones leave. Account ids stay the same ("agy:accN").
   */
  rescan(): void {
    // Only profiles signed in to Google (an e-mail in agy's log): agy creates the folder before signing in.
    const profiles = discoverAgyProfiles(this.opts.root).filter((p) => p.email);
    // Colors after the other tools' accounts (not our own, or a rescan would shift them).
    const taken = this.opts.accounts.allEntries().filter((e) => e.provider !== 'agy').map((e) => e.detected.color);
    const entries = this.opts.accounts.setProviderAccounts(
      'agy',
      profiles.map((p, i) => ({ dir: p.stateDir, detected: agyDetected(p, i, taken) })),
    );
    const prev = this.all;
    this.all = profiles.map((profile, i) => {
      const old = prev.find((w) => w.profile.acc === profile.acc);
      if (old) return Object.assign(old, { profile, account: entries[i].id });
      return {
        profile,
        id: `agy:${profile.acc}`,
        account: entries[i].id,
        jobs: new Map(),
        ending: [],
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
        progress: new WorkerTracker(),
      };
    });
  }

  /** A signed-in profile: account id, display name and agy state dir (worker terminals, server/workers). */
  profileOf(acc: string): { account: string; name: string; stateDir: string } | undefined {
    const w = this.all.find((x) => x.profile.acc === acc);
    return w && { account: w.account, name: workerLabel(w.profile), stateDir: w.profile.stateDir };
  }

  /** Every profile (registered or not): its name (accN) and account id. */
  profiles(): Array<{ acc: string; account: string }> {
    return this.all.map((w) => ({ acc: w.profile.acc, account: w.account }));
  }

  /** The seats changed (server/team.ts): characters walk in or leave right away. No seats = no characters. */
  setTeam(seats: readonly AgySeat[]): void {
    this.seatList = [...seats];
    if (!this.started) return;
    this.syncCharacters();
    this.publishBoard(); // the board follows the first character's room
  }

  /** The characters to show now: the seats of signed-in profiles. */
  private seatsNow(): AgySeat[] {
    return this.seatList.filter((x) => this.all.some((w) => w.profile.acc === x.acc));
  }

  /** Worker terminals tell each seat's state (server/workers). */
  setExternal(fn: (agentId: string) => { busy: boolean; role?: string } | undefined): void {
    this.external = fn;
  }

  /** A job run in a worker terminal (server/workers), on the room's board. */
  upsertJob(item: JobBoardItem): void {
    this.upsertBoard(item);
    this.publishBoard();
  }

  /** Profiles with at least one seat. */
  private get present(): Worker[] {
    return this.all.filter((w) => this.seatList.some((x) => x.acc === w.profile.acc));
  }

  /** Adds a character for each seat not in the office yet and sends away the ones no longer wanted. */
  private syncCharacters(): void {
    const at = this.now();
    const seats = this.seatsNow();
    for (const seat of seats) {
      const w = this.all.find((x) => x.profile.acc === seat.acc)!;
      if (this.shown.has(seat.agentId)) {
        // Same id, new folder or name (team.json edit): move or rename the character.
        this.opts.office.relocate(seat.agentId, seat.room || this.opts.home, seat.name);
        continue;
      }
      this.shown.set(seat.agentId, seat.acc);
      this.opts.office.addMain({
        id: seat.agentId,
        provider: 'agy',
        account: w.account,
        // The first seat of an account keeps `agy-<acc>` (its saved name and look); the others are unique per seat.
        sessionId: seat.agentId === w.id ? `agy-${seat.acc}` : `agy-${seat.agentId}`,
        cwd: seat.room || this.opts.home,
        role: tr('Worker'),
        name: seat.name,
        startedAt: at,
        status: 'idle',
      });
      this.opts.office.setProgress(seat.agentId, w.progress.view());
    }
    for (const [agentId, acc] of [...this.shown]) {
      if (seats.some((x) => x.agentId === agentId)) continue;
      this.shown.delete(agentId);
      this.opts.office.closeMain(agentId);
      // Back later = a fresh start: no stale jobs waiting to "end".
      const w = this.all.find((x) => x.profile.acc === acc);
      if (w && ![...this.shown.values()].includes(acc)) {
        w.jobs.clear();
        w.ending = [];
      }
    }
  }

  start(): void {
    this.opts.office.beginBoot();
    try {
      const at = this.now();
      const day = new Date(at);
      day.setHours(0, 0, 0, 0);
      this.dayStart = day.getTime();
      this.tail.seekTail(BOOT_LOG_BYTES);
      this.started = true;
      this.syncCharacters();
      this.poll();
    } finally {
      this.opts.office.endBoot();
    }
    this.every(this.opts.pollMs ?? 1_500, () => this.poll());
    this.every(this.opts.rescanMs ?? RESCAN_MS, () => {
      this.rescan();
      this.syncCharacters();
    });
    const usageMs = this.opts.usageMs ?? 0;
    if (usageMs > 0) {
      setTimeout(() => void this.refreshUsage(), 5_000).unref?.();
      this.every(usageMs, () => void this.refreshUsage());
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  sources(): SourceInfo[] {
    return this.all.map((w) => ({ label: w.profile.acc, provider: 'agy', path: w.profile.stateDir, sessions: 1, ok: true }));
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  private every(ms: number, fn: () => void): void {
    const t = setInterval(() => {
      try {
        fn();
      } catch (err) {
        log.warnOnce(`agy:${errMsg(err)}`, tr('Antigravity: failed to read the workers ({0}).', [errMsg(err)]));
      }
    }, ms);
    t.unref?.();
    this.timers.push(t);
  }

  /** Reads the end of the agy-ask log and the processes, and applies each worker's status. */
  poll(): void {
    const now = this.now();
    this.readLog();
    const workers = this.present;
    const seats = this.seatsNow();
    const running = workers.length ? scanAgyProcs(this.opts.root, this.procs) : [];
    for (const w of workers) {
      const mine = running.filter((p) => p.acc === w.profile.acc);
      const headless = mine.filter((p) => p.headless);
      for (const job of headless) if (!w.jobs.has(job.pid)) this.jobStarted(w, job);
      for (const [pid, job] of w.jobs) {
        if (headless.some((p) => p.pid === pid)) continue;
        w.jobs.delete(pid);
        w.ending.push({ job, until: now + END_WAIT_MS });
      }
      w.ending = w.ending.filter((e) => {
        const end = e.job.ppid !== undefined ? this.ends.get(e.job.ppid) : undefined;
        if (!end && now < e.until) return true;
        this.jobEnded(w, e.job, end);
        return false;
      });
      // A job that ended and still waits for its agy-ask line keeps "working": so this source's "Done" (or failure)
      // lands before the end of the turn, and the Office does not synthesize another one on top.
      const job = [...w.jobs.values()].at(-1);
      const start = job?.ppid !== undefined ? this.starts.get(job.ppid) : undefined;
      // Each seat of the account: jobs found on this machine (/proc) show on its first seat (w.id); a terminal job shows
      // on the seat that got it.
      for (const seat of seats.filter((x) => x.acc === w.profile.acc)) {
        const base = seat.agentId === w.id;
        const ext = this.external?.(seat.agentId);
        const busy = (base && (w.jobs.size > 0 || w.ending.length > 0)) || !!ext?.busy;
        const status: AgentStatus = busy ? 'working' : 'idle';
        const cur = this.opts.office.get(seat.agentId);
        if (cur && cur.status !== status) this.opts.office.setStatus(seat.agentId, status);
        const summary: TranscriptSummary = { tasks: [], stats: w.stats };
        // Subtitle: the role Claude gave the job (agy-ask --role); idle = free.
        summary.title =
          seat.boss
            ? tr('boss')
            : (base && job && start?.role) || (ext?.busy && ext.role) || tr('free');
        this.seatSummary(w, seat.agentId, base ? job : undefined, start, summary);
      }
    }
    this.settleBoard();
    this.checkFullHouse(now);
    this.publishBoard();
  }

  /** Model, mode and effort of a seat's character: what agy applied for a job, else the worker's defaults. */
  private seatSummary(w: Worker, agentId: string, job: AgyProc | undefined, start: AgyAskLine | undefined, summary: TranscriptSummary): void {
    // Mode, model and effort: what agy applied (its log) for a job, else what was asked; idle = the defaults (the
    // office's, else the account's own effort from its settings.json).
    const defaults = this.defaults.get(w.profile.acc);
    const run = job ? this.runInfo(w, job.pid) : {};
    const mode = run.mode ?? (job ? start?.mode : defaults.mode);
    const effort = run.effort ?? (job ? start?.effort : (defaults.effort ?? settingsModel(w.profile.stateDir).effort));
    summary.model = run.model ?? AGY_MODEL;
    if (mode) summary.permissionMode = mode;
    if (effort) summary.effort = effort;
    this.opts.office.setAgyDefaults(agentId, defaults);
    this.opts.office.applyTranscript(agentId, summary);
  }

  /**
   * Workers room board (RoomInfo.board): recent jobs and the latest order given to the boss (the last request its
   * transcript shows, as a 'prompt' activity).
   */
  private publishBoard(): void {
    const first = this.shown.keys().next().value;
    const roomId = first ? this.opts.office.get(first)?.roomId : undefined;
    if (!roomId) return;
    if (this.boardRoom && this.boardRoom !== roomId) this.opts.office.setBoard(this.boardRoom, undefined);
    this.boardRoom = roomId;
    let order: { text: string; at: number; boss: string } | undefined;
    for (const a of this.opts.office.list()) {
      if (!a.boss) continue;
      const p = [...a.recent, ...(a.activity ? [a.activity] : [])].filter((x) => x.kind === 'prompt').sort((x, y) => y.at - x.at)[0];
      if (p && (!order || p.at > order.at)) order = { text: (p.detail ?? p.text).slice(0, 300), at: p.at, boss: a.name };
    }
    this.opts.office.setBoard(roomId, order || this.board.length ? { ...(order ? { order } : {}), items: this.board.map((x) => ({ ...x })) } : undefined);
  }

  private checkFullHouse(now: number): void {
    const all = this.workers.length > 1 && this.workers.every((w) => this.opts.office.get(w.id)?.status === 'working');
    if (!all) {
      this.fullHouse = false;
      return;
    }
    if (this.fullHouse || now - this.fullHouseAt < FULL_HOUSE_MS) return;
    this.fullHouse = true;
    this.fullHouseAt = now;
    this.opts.office.celebrate(this.workers[0].id, tr('🔥 Full house!'), tr('🔥 Full house: all {0} workers busy at once', [this.workers.length]));
  }

  /**
   * Board item id: the agy-ask PID (from its start line, so the board is rebuilt from the log after a restart), or
   * the agy PID for an agy run without agy-ask.
   */
  private boardId(w: Worker, job: AgyProc): string {
    return job.ppid !== undefined && this.starts.has(job.ppid) ? `${w.id}#${job.ppid}` : `${w.id}#agy${job.pid}`;
  }

  /** Adds or replaces a board item, newest first, up to BOARD_ITEMS. */
  private upsertBoard(item: JobBoardItem): void {
    this.board = [item, ...this.board.filter((x) => x.id !== item.id)].sort((a, b) => b.at - a.at).slice(0, BOARD_ITEMS);
  }

  /** Board item from an agy-ask start line (live or re-read at boot). */
  private boardFromStart(w: Worker, line: AgyAskLine): void {
    if (line.via === 'terminal') return;
    const id = `${w.id}#${line.pid}`;
    if (this.board.some((x) => x.id === id)) return;
    const item: JobBoardItem = {
      id,
      agentId: w.id,
      worker: workerName(w.profile),
      text: boardText(line.prompt),
      status: 'working',
      at: (line.ts ?? 0) * 1000,
    };
    const role = line.role;
    if (role) item.role = role;
    this.upsertBoard(item);
  }

  /** Board item from an agy-ask end line. */
  private boardFromEnd(w: Worker, line: AgyAskLine): void {
    const at = (line.ts ?? 0) * 1000;
    const item = this.board.find((x) => x.id === `${w.id}#${line.pid}`);
    if (item && item.status === 'working') {
      item.status = line.status && line.status !== 'SUCCESS' ? 'failed' : 'done';
      item.endedAt = at;
      if (line.usage?.total_tokens) item.tokens = line.usage.total_tokens;
      if (line.usage?.cache_read_tokens) item.cacheRead = line.usage.cache_read_tokens;
    }
  }

  /** Board items still "working" whose agy-ask is gone without an end line (killed hard): failed. */
  private settleBoard(): void {
    for (const it of this.board) {
      if (it.status !== 'working') continue;
      const pid = Number(/#(\d+)$/.exec(it.id)?.[1]);
      if (pid && !this.procs.stat(pid)) {
        it.status = 'failed';
        it.endedAt = this.now();
      }
    }
  }

  private readLog(): void {
    const lines: string[] = [];
    for (let i = 0; i < 16; i++) {
      const r = this.tail.read();
      lines.push(...r.lines);
      if (!r.more) break;
    }
    for (const raw of lines) {
      let line: AgyAskLine;
      try {
        line = JSON.parse(raw) as AgyAskLine;
      } catch {
        continue;
      }
      if (typeof line.pid !== 'number') continue;
      const map = line.event === 'start' ? this.starts : line.event === 'end' ? this.ends : undefined;
      if (!map) continue;
      map.set(line.pid, line);
      if (map.size > 200) map.delete(map.keys().next().value!);
      // Every profile keeps its tokens, level and board items (no character = nothing shows until it is registered).
      const w = this.all.find((x) => x.profile.acc === line.acc);
      if (w && line.event === 'start') this.boardFromStart(w, line);
      if (w && line.event === 'end') this.boardFromEnd(w, line);
      if (w && line.event === 'end' && line.usage && (line.ts ?? 0) * 1000 >= this.dayStart) {
        w.stats = {
          ...w.stats,
          tokensIn: w.stats.tokensIn + (line.usage.input_tokens ?? 0),
          tokensOut: w.stats.tokensOut + (line.usage.output_tokens ?? 0) + (line.usage.thinking_tokens ?? 0),
        };
      }
      if (w && line.event === 'end' && !STOPPED.has(line.status ?? '')) this.progress(w, line);
    }
  }

  /** Level and badges from an "end" line; live, a level-up or a new badge throws a party. */
  private progress(w: Worker, line: AgyAskLine): void {
    const ev = w.progress.feed(line);
    const name = workerName(w.profile);
    if (ev.levelUp) {
      const rank = rankOf(ev.levelUp);
      this.opts.office.celebrate(w.id, tr('⭐ Level {0}!', [ev.levelUp]), tr('⭐ {0} reached level {1} ({2})', [name, ev.levelUp, rank]));
    }
    for (const id of ev.badges) {
      const b = BADGES[id];
      this.opts.office.celebrate(w.id, `${b.icon} ${b.name()}`, tr('🏆 {0} earned the achievement {1} {2}', [name, b.icon, b.name()]));
    }
    for (const [agentId, acc] of this.shown) if (acc === w.profile.acc) this.opts.office.setProgress(agentId, w.progress.view());
  }

  private activity(w: Worker, a: Omit<Activity, 'id' | 'at'>, at = this.now()): void {
    this.opts.office.addActivity(w.id, { id: `${w.id}#${++this.seq}`, at, ...a }, true);
  }

  private jobStarted(w: Worker, job: AgyProc): void {
    w.jobs.set(job.pid, job);
    const mine = job.ppid !== undefined && this.manual.has(job.ppid);
    const by = !mine && job.claudePid ? this.claudeRoom(job.claudePid) : undefined;
    const who = mine ? tr('sent by you from the office') : by ? tr('requested by Claude in {0}', [by]) : '';
    const role = job.ppid !== undefined ? this.starts.get(job.ppid)?.role : undefined;
    const id = this.boardId(w, job);
    const known = this.board.find((x) => x.id === id);
    if (known) {
      if (job.prompt?.trim()) known.text = boardText(job.prompt);
    } else {
      this.newBoardItem(w, job, id, role);
    }
    const detail = [maskSecrets(job.prompt ?? '').slice(0, 300), job.cwd ? tr('folder: {0}', [job.cwd]) : '', who]
      .filter(Boolean)
      .join('\n');
    this.activity(w, { kind: 'prompt', icon: '📋', text: promptText(job.prompt) || tr('New job'), detail }, Math.min(job.startedAt, this.now()));
  }

  private newBoardItem(w: Worker, job: AgyProc, id: string, role: string | undefined): void {
    const item: JobBoardItem = {
      id,
      agentId: w.id,
      worker: workerName(w.profile),
      text: boardText(job.prompt),
      status: 'working',
      at: Math.min(job.startedAt, this.now()),
    };
    if (role) item.role = role;
    this.upsertBoard(item);
  }

  private jobEnded(w: Worker, job: AgyProc, end: AgyAskLine | undefined): void {
    const ms = this.now() - job.startedAt;
    const item = this.board.find((x) => x.id === this.boardId(w, job));
    if (item && item.status === 'working') {
      item.status = end?.status && end.status !== 'SUCCESS' ? 'failed' : 'done';
      item.endedAt = this.now();
      if (end?.usage?.total_tokens) item.tokens = end.usage.total_tokens;
    }
    if (end && end.status && end.status !== 'SUCCESS') {
      // kind 'done' (with `error`): it ends the turn, and the Office does not add a synthesized "Done" on top.
      this.activity(w, { kind: 'done', icon: '⚠️', text: tr('Failed: {0}', [end.status]), detail: [errorReason(end.error), promptText(job.prompt)].filter(Boolean).join(' · '), durationMs: ms, error: true });
      return;
    }
    const used = end?.usage?.total_tokens;
    const text = used ? tr('Done in {0} · {1} tokens', [formatDuration(ms), tokens(used)]) : tr('Done in {0}', [formatDuration(ms)]);
    this.activity(w, { kind: 'done', icon: '✅', text, detail: promptText(job.prompt), durationMs: ms });
  }

  /** Folder name of the Claude Code that asked for the job (its process cwd). */
  private claudeRoom(pid: number): string | undefined {
    const cwd = this.procs.cwd(pid);
    return cwd ? basename(cwd) || cwd : undefined;
  }

  /**
   * Job sent from the office (manual mode): runs the repo's `worker-ask <seat name> <prompt> --role R [--mode M]` in the
   * office folder, so the job goes through the seat's terminal like Claude's. The rest (working, end, tokens) comes
   * the usual way; the answer becomes a 📦 activity when worker-ask finishes.
   */
  assign(agentId: string, job: AgyJobInput): AgyJobResult {
    const seat = this.seatList.find((x) => x.agentId === agentId && !x.boss);
    const w = seat && this.all.find((x) => x.profile.acc === seat.acc);
    if (!seat || !w) return { ok: false, status: 404, error: tr('Antigravity worker not found') };
    const cwd = this.opts.folder();
    if (!cwd) return { ok: false, status: 400, error: tr('the office has no folder yet: set "folder" in {0}', ['team.json']) };
    const prompt = job.prompt.trim();
    if (!prompt || prompt.length > AGY_PROMPT_MAX) return { ok: false, status: 400, error: tr('prompt empty or too long') };
    if (job.mode && !AGY_MODES.includes(job.mode)) return { ok: false, status: 400, error: tr('unknown mode') };
    if (job.role !== undefined && job.role !== '' && !AGY_ROLE.test(job.role)) return { ok: false, status: 400, error: tr('invalid role (up to 24 letters, digits, - or _)') };
    if (job.effort && !(AGY_EFFORTS as readonly string[]).includes(job.effort)) return { ok: false, status: 400, error: tr('unknown effort') };
    const args = [seat.name, prompt, '--role', job.role || 'manual', '--max', '2000'];
    if (job.mode) args.push('--mode', job.mode);
    if (job.effort) args.push('--effort', job.effort);
    const child = spawn(this.opts.askBin, args, { cwd, env: { ...(this.opts.env ?? process.env), ...(this.opts.selfUrl ? { HABBLAUD_URL: this.opts.selfUrl } : {}) }, stdio: ['ignore', 'pipe', 'ignore'] });
    if (child.pid) this.manual.add(child.pid);
    let out = '';
    child.stdout.on('data', (b: Buffer) => (out = (out + b.toString('utf8')).slice(0, 4_000)));
    child.on('error', (err) => this.activity(w, { kind: 'error', icon: '⚠️', text: tr('worker-ask did not run'), detail: errMsg(err), error: true }));
    child.on('close', (code) => {
      if (child.pid) setTimeout(() => this.manual.delete(child.pid!), END_WAIT_MS * 2).unref?.();
      if (code !== 0 || !out.trim()) return;
      this.activity(w, { kind: 'respond', icon: '📦', text: tr('Answer: {0}', [promptText(out)]), detail: maskSecrets(out.trim()).slice(0, 300) });
    });
    return { ok: true };
  }

  /** The profile of a seat (any seat, boss included). */
  private workerOfSeat(agentId: string): Worker | undefined {
    const seat = this.seatList.find((x) => x.agentId === agentId);
    return seat && this.all.find((x) => x.profile.acc === seat.acc);
  }

  /**
   * Stops the worker's headless jobs: the agy-ask (which takes agy down with it) or, without it, agy itself. Only PIDs
   * this source saw running; the request never picks the PID. Returns how many were stopped.
   */
  stopJobs(agentId: string): number {
    const w = this.workerOfSeat(agentId);
    if (!w) return 0;
    let n = 0;
    for (const job of w.jobs.values()) {
      const viaAsk = job.ppid !== undefined && this.starts.has(job.ppid);
      try {
        (this.opts.kill ?? process.kill)(viaAsk ? job.ppid! : job.pid, 'SIGTERM');
        n++;
      } catch {
        // already gone
      }
    }
    return n;
  }

  /** The current job's run as its agy log tells it (empty until the lines show up). */
  private runInfo(w: Worker, pid: number): AgyRunInfo {
    if (w.run?.pid !== pid) w.run = { pid, size: -1, info: {} };
    const r = w.run;
    r.path ??= findAgyCliLog(join(w.profile.stateDir, 'log'), pid);
    if (!r.path) return r.info;
    let size = 0;
    try {
      size = statSync(r.path).size;
    } catch {
      return r.info;
    }
    if (size !== r.size) {
      r.size = size;
      r.info = readAgyRun(r.path);
    }
    return r.info;
  }

  /**
   * What the ghost check watches (server/workers/ghosts.ts): headless agy (its `-p` run, however it was started) and any
   * agy whose parent is gone. Interactive agy under a live terminal is left alone: waiting at its prompt is normal.
   * Writes are per account, so a hung process beside a healthy one on the same account stays hidden until that one ends.
   */
  ghostCandidates(): GhostCandidate[] {
    const running = scanAgyProcs(this.opts.root, this.procs);
    const out: GhostCandidate[] = [];
    for (const w of this.present) {
      if (!this.shown.has(w.id)) continue;
      const mine = running.filter((p) => p.acc === w.profile.acc && (p.headless || p.orphan));
      if (!mine.length) continue;
      const written = lastWrite(w.profile.stateDir, w.run?.path);
      for (const p of mine) {
        const ended = p.ppid !== undefined && this.ends.has(p.ppid);
        const c: GhostCandidate = { agentId: w.id, name: workerName(w.profile), pid: p.pid, lastSign: Math.max(p.startedAt, written) };
        if (ended || p.orphan) c.jobless = true;
        out.push(c);
      }
    }
    return out;
  }

  /** Sets a worker's defaults for jobs that do not say (POST /api/agy/defaults). */
  setDefaults(agentId: string, d: AgyDefaults): AgyJobResult {
    const w = this.workerOfSeat(agentId);
    if (!w) return { ok: false, status: 404, error: tr('Antigravity worker not found') };
    if (d.mode && !(AGY_MODES as readonly string[]).includes(d.mode)) return { ok: false, status: 400, error: tr('unknown mode') };
    if (d.effort && !(AGY_EFFORTS as readonly string[]).includes(d.effort)) return { ok: false, status: 400, error: tr('unknown effort') };
    this.defaults.set(w.profile.acc, d);
    for (const [id, acc] of this.shown) if (acc === w.profile.acc) this.opts.office.setAgyDefaults(id, this.defaults.get(acc));
    return { ok: true };
  }

  /** Each account's `/usage`, one at a time (no burst of agy processes). */
  async refreshUsage(): Promise<void> {
    if (this.usageBusy) return;
    this.usageBusy = true;
    // The repo's tools/agy/bin first on PATH, so `agy-as` is the repo's (it never writes into the profile).
    const env = { ...(this.opts.env ?? process.env) };
    env.PATH = `${dirname(this.opts.askBin)}:${env.PATH ?? ''}`;
    try {
      for (const w of this.all) {
        // An account whose agy is running (its terminal, a job) waits for the next round.
        if (scanAgyProcs(this.opts.root, this.procs).some((p) => p.acc === w.profile.acc)) continue;
        const text = await (this.opts.usage ?? ((acc: string) => runAgyUsage('agy-as', acc, env)))(w.profile.acc);
        const usage = parseAgyUsage(text, this.now());
        if (usage) this.opts.accounts.setUsage(w.account, usage);
      }
    } finally {
      this.usageBusy = false;
    }
  }
}
