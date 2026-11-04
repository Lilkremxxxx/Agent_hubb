// Worker terminals: each seat (an Antigravity profile or a Claude Code account, server/team.ts) runs in a
// terminal of the office (PtyManager), which you can watch while the boss gives it jobs.
//
// A job (POST /api/workers/ask, from agy-ask / claude-ask or "Send a job") restarts the worker's terminal with the
// request as its first message (`agy-as accN -i "…"`, `claude --session-id <uuid> "…"`): one fresh conversation per job,
// mode and effort per job. The caller then waits (GET /api/workers/jobs/<id>?wait=60, no tokens spent while waiting)
// and gets only the final answer, read from the conversation file (server/workers/turns.ts), never the screen, up to
// `max` characters. After the job the terminal stays open to read until it idles out: every job is a new conversation,
// so there is nothing to continue in it and nobody types there (only sessions you open in a terminal yourself).
//
// One job per seat at a time (BUSY); seats on one account start one after another.
//
// Jobs go to the agy-ask log (start/end lines with via "terminal": level, tokens and news, as before) and to the room's
// job board (with their WorkerJob id, so the board can cancel them).
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { JobBoardItem, PtyInfo, WorkerJob, WorkerKind, WorkerSession } from '../../shared/types';
import { maskSecrets, truncate } from '../../shared/activity';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import type { Office } from '../model/office';
import type { GhostCandidate } from './ghosts';
import { agyTranscriptPath, agyTurn, claudeTranscriptPath, claudeTrusts, claudeTurn, type TurnState } from './turns';

/** Characters of the answer sent back by default. */
export const ANSWER_MAX = 2_000;
/** A job that does not end within this time is stopped (TIMEOUT). */
export const JOB_TIMEOUT_MS = 30 * 60_000;
/** Jobs kept in the snapshot (newest first). */
export const JOBS_KEPT = 50;
/** Longest wait of one GET (the CLI loops). */
export const WAIT_MAX_S = 60;
/** A worker terminal left idle this long (no job) is closed. */
export const IDLE_CLOSE_MS = 20 * 60_000;
/** How often running jobs are checked. */
const TICK_MS = 1_000;
/**
 * Seats of one account start one after another: the next one starts once the previous job's conversation exists, or
 * this long after its terminal opened (agy shows no conversation of its own until then, so two starts would mix up).
 */
export const START_SETTLE_MS = 30_000;
/** Waiting for an old terminal of the same seat to close before starting another one. */
const CLOSE_WAIT_MS = 8_000;
const ESC = '\x1b';
/** A Claude job whose conversation has not started by then, in a folder its account does not trust, is stopped. */
export const TRUST_WAIT_MS = 15_000;
/**
 * Tools of a lean Claude Code worker. The default set costs ~24k tokens of context per job before any work (mostly
 * the Workflow and Agent tools); this one ~8k. Same list and rule as claude-ask's headless path (agy-hub bin/worker-ask).
 */
export const LEAN_TOOLS = 'Bash,Read,Edit,Write,WebFetch,WebSearch';

/** Flags for a lean Claude Code job: no MCP servers, no skills or slash commands, LEAN_TOOLS, a short worker rule. */
export function leanClaudeArgs(max: number): string[] {
  const rule =
    'You are a worker: another agent gave you this one job and reads only your final message. Do the job, then reply ' +
    `with just the result, compact (no preamble, no recap of your steps), under ${max} characters. ` +
    'If you could not do it, say so plainly and why.';
  return ['--strict-mcp-config', '--disable-slash-commands', '--tools', LEAN_TOOLS, '--append-system-prompt', rule];
}

export interface WorkerTarget {
  id: string;
  kind: WorkerKind;
  /** Its character in the office. */
  agentId: string;
  /** AccountInfo.id. */
  account: string;
  name: string;
  /** Antigravity: profile (accN) and agy state dir (<profile>/.gemini/antigravity-cli). */
  acc?: string;
  stateDir?: string;
  /** Claude Code: config dir (CLAUDE_CONFIG_DIR, unless `isDefault`). */
  configDir?: string;
  isDefault?: boolean;
}

export interface AskInput {
  worker: string;
  prompt: string;
  cwd?: string;
  role?: string;
  mode?: string;
  effort?: string;
  /** Model for this job (agy: only Gemini 3.8 Flash names; Claude Code: an alias like "haiku" or a full name). */
  model?: string;
  max?: number;
  /** Claude Code workers: start lean (no MCP servers, skills or slash commands, LEAN_TOOLS only, worker rule). */
  lean?: boolean;
}

export type AskResult = { ok: true; job: WorkerJob } | { ok: false; status: number; error: string; busy?: 'job' };

/** What the service needs from the terminal manager. */
export interface WorkerPtys {
  openProgram(p: { agentId: string; account: string; file: string; args: string[]; cwd: string; env?: Record<string, string>; onExit?: (code: number) => void }): PtyInfo;
  ofAgent(agentId: string): PtyInfo | undefined;
  typeTo(agentId: string, data: string): boolean;
  closeAgent(agentId: string): void;
}

export interface WorkerServiceOptions {
  office: Office;
  ptys: WorkerPtys;
  /** The seats now. */
  targets: () => WorkerTarget[];
  agyBin: string;
  /** This server's own URL, put in every seat's environment as HABBLAUD_URL (worker-ask / advisor reach this office). */
  selfUrl?: string;
  claudeBin: string;
  /** The office folder: where every job runs unless it gives a `cwd` ('' = none declared yet). */
  folder: () => string;
  /** Message of the 400 for a job with no folder anywhere (names the team file in use). */
  noFolderMsg: () => string;
  /** ~/.agy_profiles/agy-ask.log.jsonl. */
  logFile: string;
  /** Remembered conversations per worker (<dataDir>/workers.json). */
  stateFile?: string;
  /** The team in the snapshot changed (sessions, jobs). */
  onChange: () => void;
  /** Adds or updates a job on the room's board. */
  board?: (item: JobBoardItem) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Job extends WorkerJob {
  model?: string;
  max: number;
  lean?: boolean;
  /** Claude: the folder's trust was checked (TRUST_WAIT_MS after the start, no conversation yet). */
  trustChecked?: boolean;
  cwd: string;
  /** Agent id of the worker's character. */
  agentId: string;
  ptyPid?: number;
  /** When its terminal opened (with `ptyPid`): the start gate of its account measures from here. */
  launchedAt?: number;
  /** Conversation id (agy: found once its folder appears; Claude: chosen). */
  conv?: string;
  /** Before the conversation shows up: the agy conversations that already existed. */
  known?: Set<string>;
  deadline: number;
  size: number;
  /** Last time its conversation grew (its start until then): the ghost check. */
  progressAt: number;
  turn?: TurnState;
}

interface Session {
  t: WorkerTarget;
  job?: Job;
  /** Last time it had a job or a new terminal (idle terminals close after IDLE_CLOSE_MS). */
  activeAt: number;
}

type Waiter = () => void;

export class WorkerService {
  private readonly sessions = new Map<string, Session>();
  private jobList: Job[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly jobWaiters = new Map<string, Set<Waiter>>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** The job that last started on each account: the next seat of that account waits for its conversation. */
  private readonly starting = new Map<string, Job>();
  /** Jobs waiting for their account's start gate (FIFO). */
  private queue: Array<{ s: Session; job: Job; prompt: string }> = [];

  constructor(private readonly opts: WorkerServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  start(): void {
    this.sync();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        log.warnOnce(`workers:${errMsg(err)}`, tr('Worker terminals: {0}', [errMsg(err)]));
      }
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ views

  sessionList(): WorkerSession[] {
    this.sync();
    return [...this.sessions.values()].map((s) => {
      const out: WorkerSession = { worker: s.t.id, kind: s.t.kind, agentId: s.t.agentId, account: s.t.account };
      const pty = this.opts.ptys.ofAgent(s.t.agentId);
      if (pty) out.ptyId = pty.id;
      if (s.job && live(s.job)) out.job = s.job.id;
      return out;
    });
  }

  jobs(): WorkerJob[] {
    return this.jobList.map(view);
  }

  job(id: string): WorkerJob | undefined {
    const j = this.jobList.find((x) => x.id === id);
    return j && view(j);
  }

  /** For a seat's character: a job is running on it. */
  statusOf(agentId: string): { busy: boolean; role?: string } | undefined {
    const s = [...this.sessions.values()].find((x) => x.t.agentId === agentId);
    if (!s) return undefined;
    const busy = !!s.job && live(s.job);
    return { busy, ...(busy && s.job!.role ? { role: s.job!.role } : {}) };
  }

  /** Is this PID the program of a worker terminal? (ClaudeWatcher leaves those sessions to this service.) */
  ownsPid(pid: number): boolean {
    for (const s of this.sessions.values()) if (this.opts.ptys.ofAgent(s.t.agentId)?.pid === pid) return true;
    return false;
  }

  /** Running jobs and their last sign of life, for the ghost check (server/workers/ghosts.ts). */
  ghostCandidates(): GhostCandidate[] {
    return [...this.sessions.values()].flatMap((s) => {
      const j = s.job;
      return j && live(j) && j.ptyPid !== undefined ? [{ agentId: j.agentId, name: s.t.name, pid: j.ptyPid, lastSign: j.progressAt }] : [];
    });
  }

  // ------------------------------------------------------------------ jobs

  async ask(input: AskInput): Promise<AskResult> {
    this.sync();
    const s = this.sessions.get(input.worker);
    // 400, not 404: agy-ask / claude-ask run a job headless on 404 (an office without worker terminals).
    if (!s) return { ok: false, status: 400, error: tr('{0} is not a seat in team.json, or its account is not signed in', [input.worker]) };
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 20_000) return { ok: false, status: 400, error: tr('prompt empty or too long') };
    if (input.cwd !== undefined && (!isAbsolute(input.cwd) || !isDir(input.cwd))) return { ok: false, status: 400, error: tr('folder not found: {0}', [input.cwd]) };
    const cwd = input.cwd ?? this.opts.folder();
    if (!cwd) return { ok: false, status: 400, error: this.opts.noFolderMsg() };
    if (s.job && live(s.job)) return { ok: false, status: 409, busy: 'job', error: tr('{0} is busy with another job', [s.t.name]) };
    const now = this.now();
    const job: Job = {
      id: `w${now.toString(36)}${(++this.seq).toString(36)}`,
      worker: s.t.id,
      agentId: s.t.agentId,
      prompt: truncate(maskSecrets(prompt.replace(/\s+/g, ' ')), 300),
      status: 'working',
      startedAt: now,
      max: Math.max(200, Math.min(input.max ?? ANSWER_MAX, 20_000)),
      cwd,
      deadline: now + JOB_TIMEOUT_MS,
      size: -1,
      progressAt: now,
    };
    if (input.role) job.role = input.role;
    if (input.mode && input.mode !== 'default') job.mode = input.mode;
    if (input.effort) job.effort = input.effort;
    if (input.model) job.model = input.model;
    if (input.lean) job.lean = true;
    s.job = job;
    this.jobList = [job, ...this.jobList].slice(0, JOBS_KEPT);
    // Another seat of this account is still starting: wait in line (never hold the HTTP request; tick() starts it).
    if (!this.gateFree(s.t.account) || this.queue.some((q) => q.s.t.account === s.t.account)) {
      job.status = 'queued';
      this.queue.push({ s, job, prompt });
      this.toBoard(job);
      this.changed(s);
      return { ok: true, job: view(job) };
    }
    this.starting.set(s.t.account, job);
    try {
      await this.launch(s, job, prompt);
    } catch (err) {
      this.finish(job, 'failed', 'ERROR', errMsg(err));
      return { ok: false, status: 500, error: errMsg(err) };
    }
    return { ok: true, job: view(job) };
  }

  /** Can another seat of this account start? Not while the last one started has no conversation yet and is within START_SETTLE_MS. */
  private gateFree(account: string): boolean {
    const g = this.starting.get(account);
    // A start that opened its terminal holds the gate even if cancelled: its agy may still create a conversation.
    return !g || !!g.conv || (g.launchedAt === undefined ? !live(g) : this.now() - g.launchedAt >= START_SETTLE_MS);
  }

  /** Opens the job's terminal (the old one of the seat closes first) and records the start. */
  private async launch(s: Session, job: Job, prompt: string): Promise<void> {
    // Cancelled while the old terminal was closing: nothing to start.
    await this.restart(s, () => (live(job) ? this.jobProgram(s, job, prompt) : undefined));
    if (!live(job)) return;
    this.writeLog({ event: 'start', ts: job.startedAt / 1000, acc: s.t.id, role: job.role, mode: job.mode, effort: job.effort, pid: job.ptyPid, prompt: prompt.slice(0, 200), via: 'terminal', worker: s.t.id, job: job.id });
    this.toBoard(job);
    this.opts.office.addActivity(s.t.agentId, { id: `${job.id}:start`, at: job.startedAt, kind: 'prompt', icon: '📋', text: truncate(job.prompt, 40), detail: job.prompt }, true);
    this.changed(s);
  }

  /** The job, once it is over or after `waitS` seconds (whichever comes first). */
  async waitJob(id: string, waitS: number): Promise<WorkerJob | undefined> {
    const j = this.jobList.find((x) => x.id === id);
    if (!j) return undefined;
    if (live(j) && waitS > 0) await this.waitOn(this.jobWaiters, id, Math.min(waitS, WAIT_MAX_S) * 1000);
    return view(j);
  }

  /** Cancels a job, every job of a worker, or every job. Returns how many were running. */
  cancel(p: { job?: string; worker?: string; all?: boolean }, reason: string = tr('cancelled by you')): number {
    let n = 0;
    for (const j of this.jobList) {
      if (!live(j)) continue;
      if (!(p.all || (p.job && j.id === p.job) || (p.worker && j.worker === p.worker))) continue;
      const s = this.sessions.get(j.worker);
      if (s) this.interrupt(s, j, 'cancelled', 'CANCELLED', reason);
      else this.finish(j, 'cancelled', 'CANCELLED', reason);
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ internals

  /**
   * Sessions follow the seats; a worker that leaves loses its job and terminal. Claude workers get their
   * character here (Antigravity ones come from sources/agy).
   */
  sync(): void {
    const targets = this.opts.targets();
    for (const t of targets) {
      const s = this.sessions.get(t.id);
      if (s) {
        const o = s.t;
        if (o.agentId !== t.agentId || o.kind !== t.kind || o.account !== t.account || o.acc !== t.acc || o.configDir !== t.configDir) {
          // Ids are positional: a team.json edit can hand this seat another terminal or account under a running job.
          if (s.job && live(s.job)) this.finish(s.job, 'failed', 'ERROR', tr('{0} changed in team.json while this job ran', [t.name]));
          this.opts.ptys.closeAgent(o.agentId);
        }
        s.t = t;
      } else {
        this.sessions.set(t.id, { t, activeAt: this.now() });
      }
    }
    for (const [id, s] of [...this.sessions]) {
      if (targets.some((t) => t.id === id)) continue;
      this.cancel({ worker: id }, tr('{0} was removed from team.json while this job ran', [s.t.name]));
      this.opts.ptys.closeAgent(s.t.agentId);
      this.sessions.delete(id);
    }
    this.syncClaudeCharacters();
  }

  /** Claude workers' characters, one per seat: added when a seat appears, sent away when it goes. */
  private syncClaudeCharacters(): void {
    const want = new Map<string, Session>();
    for (const s of this.sessions.values()) if (s.t.kind === 'claude') want.set(s.t.agentId, s);
    for (const [agentId, s] of want) {
      if (this.claudeShown.has(agentId)) continue;
      this.claudeShown.add(agentId);
      this.opts.office.addMain({ id: agentId, account: s.t.account, sessionId: agentId, cwd: this.opts.folder() || homedir(), role: tr('Worker'), name: s.t.name, startedAt: this.now(), status: 'idle' });
      this.showClaude(s);
    }
    for (const [agentId, s] of want) this.opts.office.relocate(agentId, this.opts.folder() || homedir(), s.t.name);
    for (const agentId of [...this.claudeShown]) {
      if (want.has(agentId)) continue;
      this.claudeShown.delete(agentId);
      this.opts.office.closeMain(agentId);
    }
  }

  /** Claude worker characters in the office now. */
  private readonly claudeShown = new Set<string>();

  /** Status and subtitle of a Claude worker's character. */
  private showClaude(s: Session): void {
    if (s.t.kind !== 'claude') return;
    const office = this.opts.office;
    const busy = !!s.job && live(s.job);
    if (office.get(s.t.agentId)?.status !== (busy ? 'working' : 'idle')) office.setStatus(s.t.agentId, busy ? 'working' : 'idle');
    const title = busy ? (s.job!.role ?? tr('job')) : tr('free');
    office.applyTranscript(s.t.agentId, { title, tasks: [], stats: { toolCalls: 0, tokensIn: 0, tokensOut: busy ? (s.job?.tokens ?? 0) : 0, subagents: 0 } });
  }

  tick(): void {
    const now = this.now();
    for (const s of this.sessions.values()) {
      const j = s.job;
      if (j && live(j)) s.activeAt = now;
      else if (now - s.activeAt > IDLE_CLOSE_MS && this.opts.ptys.ofAgent(s.t.agentId)) {
        this.opts.ptys.closeAgent(s.t.agentId);
        this.changed(s);
      }
      if (!j || !live(j)) continue;
      // Not started yet: the old terminal is still closing (the one that shows now is not the job's).
      if (j.ptyPid === undefined) continue;
      const pty = this.opts.ptys.ofAgent(s.t.agentId);
      if (!pty || (j.ptyPid !== undefined && pty.pid !== j.ptyPid)) {
        this.finish(j, 'failed', 'ERROR', tr('the terminal closed before the answer'));
        continue;
      }
      if (now > j.deadline) {
        this.interrupt(s, j, 'failed', 'TIMEOUT', tr('no answer after {0} min', [Math.round(JOB_TIMEOUT_MS / 60_000)]));
        continue;
      }
      this.check(s, j);
    }
    // After the checks above, so a conversation that just appeared opens the gate in this same tick.
    this.queue = this.queue.filter((q) => live(q.job));
    for (const q of [...this.queue]) {
      if (!this.gateFree(q.s.t.account)) continue;
      this.queue.splice(this.queue.indexOf(q), 1);
      this.starting.set(q.s.t.account, q.job);
      q.job.status = 'working';
      q.job.deadline = now + JOB_TIMEOUT_MS;
      q.job.progressAt = now;
      void this.launch(q.s, q.job, q.prompt).catch((err) => this.finish(q.job, 'failed', 'ERROR', errMsg(err)));
    }
  }

  /** Reads the job's conversation and ends the job if its turn is over. */
  private check(s: Session, j: Job): void {
    const path = this.transcriptOf(s, j);
    if (!path) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      this.checkTrust(s, j);
      return;
    }
    if (size === j.size) return;
    j.size = size;
    j.progressAt = this.now();
    const turn = s.t.kind === 'agy' ? agyTurn(readFileSync(path, 'utf8')) : claudeTurn(readFileSync(path, 'utf8'));
    j.turn = turn;
    if (turn.ended) {
      j.answer = truncate((turn.answer ?? '').trim(), j.max);
      this.finish(j, 'done', 'SUCCESS');
    }
  }

  /**
   * A Claude job that has not started its conversation yet: if the account does not trust the folder, claude is
   * waiting at the trust dialog (it would wait until the timeout). Esc closes it; the job fails saying what to do.
   * Trust is never given for the user.
   */
  private checkTrust(s: Session, j: Job): void {
    if (s.t.kind !== 'claude' || j.trustChecked || this.now() - (j.launchedAt ?? j.startedAt) < TRUST_WAIT_MS) return;
    j.trustChecked = true;
    if (claudeTrusts(s.t.configDir!, !!s.t.isDefault, j.cwd) !== false) return;
    this.opts.ptys.typeTo(s.t.agentId, ESC);
    this.finish(j, 'failed', 'ERROR', tr('{0} does not trust the folder {1}: open claude there once with this account and answer yes, or give the job another folder', [s.t.name, j.cwd]));
  }

  /**
   * Stops a running job: Esc interrupts its turn. The conversation is read first, because a job that has just ended
   * is done (with its answer), and Esc at an idle agy prompt quits agy.
   */
  private interrupt(s: Session, j: Job, status: WorkerJob['status'], logStatus: string, error: string): void {
    // No terminal yet (queued, or the old one is closing): nothing to interrupt, and Esc would hit the seat's idle agy.
    if (j.ptyPid === undefined) return this.finish(j, status, logStatus, error);
    this.check(s, j);
    if (!live(j)) return;
    this.opts.ptys.typeTo(s.t.agentId, ESC);
    this.finish(j, status, logStatus, error);
  }

  /** Where the job's conversation is written (agy: once its folder shows up). */
  private transcriptOf(s: Session, j: Job): string | undefined {
    if (s.t.kind === 'claude') return j.conv ? claudeTranscriptPath(s.t.configDir!, j.cwd, j.conv) : undefined;
    if (!j.conv) {
      // Without the folders listed before agy started, any old conversation would look new.
      if (!j.known) return undefined;
      const fresh = newDirs(join(s.t.stateDir!, 'brain'), j.known);
      if (!fresh) return undefined;
      j.conv = fresh;
    }
    return agyTranscriptPath(s.t.stateDir!, j.conv);
  }

  /** Closes the seat's terminal (waiting for it to end: one terminal per seat) and opens another. */
  private async restart(s: Session, open: () => PtyInfo | undefined): Promise<void> {
    const agentId = s.t.agentId;
    s.activeAt = this.now();
    if (this.opts.ptys.ofAgent(agentId)) {
      this.opts.ptys.closeAgent(agentId);
      const until = this.now() + CLOSE_WAIT_MS;
      while (this.opts.ptys.ofAgent(agentId) && this.now() < until) await this.sleep(200);
      if (this.opts.ptys.ofAgent(agentId)) throw new WorkerError(409, tr('the previous terminal of {0} did not close', [s.t.name]));
    }
    open();
  }

  private jobProgram(s: Session, j: Job, prompt: string): PtyInfo {
    const t = s.t;
    if (t.kind === 'agy') {
      j.known = dirSet(join(t.stateDir!, 'brain'));
      const args = [t.acc!, '-i', prompt];
      if (j.mode) args.push('--mode', j.mode);
      if (j.effort) args.push('--effort', j.effort);
      if (j.model) args.push('--model', j.model);
      const info = this.open(s, args, j.cwd);
      j.ptyPid = info.pid;
      j.launchedAt = this.now();
      return info;
    }
    j.conv = randomUUID();
    const args = ['--session-id', j.conv];
    if (j.mode) args.push('--permission-mode', j.mode === 'accept-edits' ? 'acceptEdits' : j.mode);
    if (j.effort) args.push('--effort', j.effort);
    if (j.model) args.push('--model', j.model);
    if (j.lean) args.push(...leanClaudeArgs(j.max));
    args.push(prompt);
    const info = this.open(s, args, j.cwd);
    j.ptyPid = info.pid;
    j.launchedAt = this.now();
    return info;
  }

  private open(s: Session, args: string[], cwd: string): PtyInfo {
    const t = s.t;
    const env: Record<string, string> = { BANG_SLOT: t.id, BANG_OFFICE: this.opts.folder() };
    if (this.opts.selfUrl) env.HABBLAUD_URL = this.opts.selfUrl;
    if (t.kind === 'claude' && !t.isDefault && t.configDir) env.CLAUDE_CONFIG_DIR = t.configDir;
    return this.opts.ptys.openProgram({
      agentId: t.agentId,
      account: t.account,
      file: t.kind === 'agy' ? this.opts.agyBin : this.opts.claudeBin,
      args,
      cwd,
      env,
      onExit: () => this.changed(s),
    });
  }

  private finish(j: Job, status: WorkerJob['status'], logStatus: string, error?: string): void {
    if (!live(j)) return;
    j.status = status;
    j.endedAt = this.now();
    if (error) j.error = error;
    if (j.turn?.tokens) j.tokens = j.turn.tokens;
    const sec = Math.round((j.endedAt - j.startedAt) / 1000);
    const end: Record<string, unknown> = { event: 'end', ts: j.endedAt / 1000, acc: j.worker, pid: j.ptyPid, status: logStatus, sec, via: 'terminal', worker: j.worker, job: j.id };
    if (j.tokens) end.usage = { ...(j.turn?.usage ?? {}), total_tokens: j.tokens };
    if (error && status === 'failed') end.error = error;
    this.writeLog(end);
    this.toBoard(j);
    const s = this.sessions.get(j.worker);
    const act =
      status === 'done'
        ? { kind: 'done' as const, icon: '✅', text: j.tokens ? tr('Done in {0}s · {1} tokens', [sec, j.tokens]) : tr('Done in {0}s', [sec]), detail: truncate(j.answer ?? '', 300) }
        : { kind: 'done' as const, icon: status === 'cancelled' ? '🚫' : '⚠️', text: status === 'cancelled' ? tr('Cancelled') : tr('Failed: {0}', [logStatus]), detail: error ?? '', error: status === 'failed' };
    this.opts.office.addActivity(j.agentId, { id: `${j.id}:end`, at: j.endedAt, durationMs: j.endedAt - j.startedAt, ...act }, true);
    this.notify(this.jobWaiters, j.id);
    if (s) this.changed(s);
  }

  private toBoard(j: Job): void {
    const s = this.sessions.get(j.worker);
    const item: JobBoardItem = {
      id: `${j.agentId}#${j.id}`,
      agentId: j.agentId,
      worker: s?.t.name ?? j.worker,
      text: j.prompt || tr('New job'),
      status: j.status === 'queued' ? 'working' : j.status,
      at: j.startedAt,
      job: j.id,
      workerId: j.worker,
    };
    if (j.role) item.role = j.role;
    if (j.endedAt) item.endedAt = j.endedAt;
    if (j.tokens) item.tokens = j.tokens;
    if (j.turn?.usage?.cache_read_tokens) item.cacheRead = j.turn.usage.cache_read_tokens;
    if (j.turn?.usage?.cache_creation_tokens) item.cacheWrite = j.turn.usage.cache_creation_tokens;
    this.opts.board?.(item);
  }

  private changed(s: Session): void {
    this.showClaude(s);
    this.opts.onChange();
  }

  private waitOn(map: Map<string, Set<Waiter>>, key: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let set = map.get(key);
      if (!set) map.set(key, (set = new Set()));
      const fire: Waiter = () => {
        clearTimeout(timer);
        set!.delete(fire);
        resolve();
      };
      const timer = setTimeout(() => {
        set!.delete(fire);
        resolve();
      }, ms);
      timer.unref?.();
      set.add(fire);
    });
  }

  private notify(map: Map<string, Set<Waiter>>, key: string): void {
    for (const w of [...(map.get(key) ?? [])]) w();
  }

  private writeLog(line: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.opts.logFile), { recursive: true });
      appendFileSync(this.opts.logFile, `${JSON.stringify(line)}\n`);
    } catch {
      // no log: the job still answers
    }
  }
}

export class WorkerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const live = (j: WorkerJob): boolean => j.status === 'queued' || j.status === 'working';

function view(j: Job): WorkerJob {
  const out: WorkerJob = { id: j.id, worker: j.worker, prompt: j.prompt, status: j.status, startedAt: j.startedAt };
  for (const k of ['role', 'mode', 'effort', 'endedAt', 'answer', 'error', 'tokens'] as const) if (j[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = j[k];
  return out;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function dirSet(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir));
  } catch {
    return new Set();
  }
}

/** A folder in `dir` that was not there before (the conversation agy just created). */
function newDirs(dir: string, known: Set<string>): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  return names.find((n) => !known.has(n) && /^[0-9a-f-]{36}$/.test(n));
}
