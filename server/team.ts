// The team: ONE office, ONE project folder and its seats, kept in a flat <dataDir>/team.json (~/.habblaud/team.json) that
// the user edits by hand. The file is re-read when it changes; worker-ask reads the same file to find the folder and the
// seats. The first time (no file yet) the first office of the old ~/.agy_profiles/team.json is imported and written
// here; the old file is only ever read.
//
// A seat is a name + kind (agy | claude) + account: several seats may share an account. The boss is either an Antigravity
// account (its character agy-boss:<acc> is crowned whenever it is in) or a Claude Code main session appointed from the
// page (kept in memory only: found again by its agent id "<account>:<pid>" or, after `claude --resume`, by account +
// session id; while it is closed its crown waits for it).
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { AgentInfo, OfficeInfo, TeamInfo, WorkerKind } from '../shared/types';
import type { Office } from './model/office';
import { normalizeCwd } from './model/rooms';
import { log } from './log';
import { pidAlive } from './sources/registry';
import { tr } from '../shared/i18n';

/** How often the crowns are put back on the right heads and the file is looked at again. */
const TICK_MS = 1_000;

export interface SeatRecord {
  name: string;
  kind: WorkerKind;
  account: string;
}

export interface TeamFile {
  /** Absolute project folder; '' = not set yet. */
  folder: string;
  boss: { kind: WorkerKind; account: string };
  workers: SeatRecord[];
}

/** A seat with its character id. */
export interface Seat extends SeatRecord {
  agentId: string;
}

export const SEAT_NAME = /^[A-Za-z][\w-]{0,15}$/;
const ACCOUNT = /^[\w.-]+$/;

export const agyBossId = (acc: string): string => `agy-boss:${acc}`;

/** Open agy boss terminals that no longer match team.json's boss (kind or account switched). */
export function staleAgyBosses(open: readonly { agentId: string; exitedAt?: number }[], boss: TeamFile['boss']): string[] {
  const keep = boss.kind === 'agy' ? agyBossId(boss.account) : '';
  return open.filter((p) => p.agentId.startsWith('agy-boss:') && !p.exitedAt && p.agentId !== keep).map((p) => p.agentId);
}

/** The boss as the sync loop sees it (an Antigravity one is derived from the file, a Claude one lives in memory). */
export interface BossRecord {
  kind: WorkerKind;
  /** Agent id: "<account>:<pid>" (Claude) or "agy-boss:accN" (Antigravity). */
  id: string;
  account: string;
  /** Empty while pending (the session was opened from the page and has not shown up yet); unused for agy. */
  sessionId: string;
  pid: number;
  name: string;
}

export type TeamResult = { ok: true } | { ok: false; status: number; error: string };

/** Only an open Claude Code main session can be a Claude boss (not a subagent or a worker). */
export function canBeBoss(a: Pick<AgentInfo, 'kind' | 'provider' | 'status' | 'id'>): boolean {
  return a.kind === 'main' && (a.provider ?? 'claude') === 'claude' && a.status !== 'offline' && a.status !== 'done' && pidOf(a.id) > 0;
}

/** The open session the record points to: same agent id, else same account and session (resumed). */
export function findBoss(rec: BossRecord | undefined, agents: readonly AgentInfo[]): AgentInfo | undefined {
  if (!rec) return undefined;
  if (rec.kind === 'agy') return agents.find((a) => a.id === rec.id && a.status !== 'offline');
  const open = agents.filter(canBeBoss);
  return open.find((a) => a.id === rec.id) ?? (rec.sessionId ? open.find((a) => a.account === rec.account && a.sessionId === rec.sessionId) : undefined);
}

const pidOf = (id: string): number => Number(/:(\d+)$/.exec(id)?.[1] ?? 0);


/** A folder as the rooms compare them: absolute, normalized, without a trailing separator. */
function officeFolder(path: string): string {
  return path ? normalizeCwd(resolve(path)) : '';
}

function cleanTeam(raw: unknown): TeamFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('team.json is not an object');
  const r = raw as { folder?: unknown; boss?: { kind?: unknown; account?: unknown } | null; workers?: unknown };
  const folder = typeof r.folder === 'string' && isAbsolute(r.folder) ? officeFolder(r.folder) : '';
  const b = r.boss;
  const boss: TeamFile['boss'] =
    (b?.kind === 'agy' || b?.kind === 'claude') && typeof b.account === 'string' && ACCOUNT.test(b.account) ? { kind: b.kind, account: b.account } : { kind: 'claude', account: 'default' };
  const workers: SeatRecord[] = [];
  for (const w of Array.isArray(r.workers) ? (r.workers as Array<Partial<SeatRecord> | null>) : []) {
    if (!w || typeof w.name !== 'string' || !SEAT_NAME.test(w.name) || (w.kind !== 'claude' && w.kind !== 'agy')) continue;
    if (typeof w.account !== 'string' || !ACCOUNT.test(w.account) || workers.some((x) => x.name === w.name)) continue;
    workers.push({ name: w.name, kind: w.kind, account: w.account });
  }
  return { folder, boss, workers };
}

/** Parses team.json; anything malformed is dropped (a bad boss = the default Claude one, bad seats skipped). */
export function parseTeam(text: string): TeamFile {
  return cleanTeam(JSON.parse(text));
}

/** "default" for the plain ".claude" account id of the old file, "x" for ".claude-x". */
const oldClaudeAccount = (id: unknown): string | undefined => {
  const m = typeof id === 'string' ? /^\.claude(?:-([\w.-]+))?$/.exec(id) : null;
  return m ? (m[1] ?? 'default') : undefined;
};

/** The old ~/.agy_profiles/team.json (v3 {offices:[…]} or v2 {boss, workers}) as the flat file: its first office only. */
export function importTeam(oldText: string): TeamFile {
  const raw = JSON.parse(oldText) as { offices?: unknown; folder?: unknown; boss?: Record<string, unknown> | null; workers?: unknown };
  const o = (Array.isArray(raw.offices) ? raw.offices[0] : raw) as typeof raw | undefined;
  const b = o?.boss;
  const bossClaude = b?.kind === 'agy' ? undefined : oldClaudeAccount(b?.account);
  const workers: SeatRecord[] = [];
  for (const w of Array.isArray(o?.workers) ? (o!.workers as unknown[]) : []) {
    if (typeof w !== 'string') continue;
    if (!w.startsWith('claude:')) workers.push({ name: w, kind: 'agy', account: w });
    else {
      const account = oldClaudeAccount(w.slice(7));
      if (account) workers.push({ name: account === 'default' ? 'claude' : account, kind: 'claude', account });
    }
  }
  return cleanTeam({
    folder: o?.folder,
    boss: b?.kind === 'agy' ? { kind: 'agy', account: b.acc } : { kind: 'claude', account: bossClaude },
    workers,
  });
}

/** The characters of the seats: the first seat of an agy account keeps "agy:<acc>" (its job board, /proc jobs and level hang on it). */
export function teamSeats(workers: readonly SeatRecord[]): Seat[] {
  const firstOf = new Set<string>();
  return workers.map((w) => {
    if (w.kind === 'claude') return { ...w, agentId: `claude-worker:${w.name}` };
    const first = !firstOf.has(w.account);
    firstOf.add(w.account);
    return { ...w, agentId: first ? `agy:${w.account}` : `agy:${w.account}@${w.name}` };
  });
}

/** CLAUDE_CONFIG_DIR of a Claude seat: "default" -> ~/.claude, "x" -> ~/.claude-x. */
export function claudeConfigDir(account: string, home: string): string {
  return join(home, account === 'default' ? '.claude' : `.claude-${account}`);
}

export interface TeamServiceOptions {
  office: Office;
  /** <dataDir>/team.json. */
  file: string;
  /** <agy root>/team.json: read once to import when `file` does not exist, never written. */
  oldFile?: string;
  home: string;
  /** Logged-in Antigravity profiles: profile name (accN) and account id. */
  profiles?: () => Array<{ acc: string; account: string }>;
  /** Seats or boss changed (after a reload). */
  onChange?: () => void;
  /** Worker sessions and jobs for the snapshot (server/workers). */
  extra?: () => Pick<TeamInfo, 'sessions' | 'jobs'>;
  now?: () => number;
  /** Is this PID running? (a pending boss whose Claude Code exited before showing up is dropped). */
  isAlive?: (pid: number) => boolean;
  /** Is this an existing folder? (tests) */
  isDir?: (path: string) => boolean;
}

const EMPTY: TeamFile = { folder: '', boss: { kind: 'claude', account: 'default' }, workers: [] };

export class TeamService {
  private team: TeamFile = EMPTY;
  /** The file's text as last read: a re-read only parses when it differs. */
  private last = '';
  /** The Claude Code session appointed boss (memory only). */
  private claudeBoss: BossRecord | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The boss that already got its coronation (party and feed line). */
  private announced = '';

  constructor(private readonly opts: TeamServiceOptions) {
    this.load();
  }

  start(): void {
    this.sync();
    this.timer = setInterval(() => {
      this.reload();
      this.sync();
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The file's folder if it is absolute and an existing directory, else ''. */
  get folder(): string {
    const f = this.team.folder;
    return f && (this.opts.isDir ?? isDir)(f) ? f : '';
  }

  get boss(): TeamFile['boss'] {
    return this.team.boss;
  }

  seats(): Seat[] {
    return teamSeats(this.team.workers);
  }

  seat(name: string): Seat | undefined {
    return this.seats().find((s) => s.name === name);
  }

  /** The crowned boss character, else the pending one ("<account>:<pid>" of the PTY just opened). */
  bossAgentId(): string | undefined {
    const rec = this.bossRec();
    return findBoss(rec, this.opts.office.list())?.id ?? (rec?.kind === 'claude' && !rec.sessionId ? rec.id : undefined);
  }

  private bossRec(): BossRecord | undefined {
    const b = this.team.boss;
    return b.kind === 'agy' ? { kind: 'agy', id: agyBossId(b.account), account: b.account, sessionId: '', pid: 0, name: b.account } : this.claudeBoss;
  }

  /**
   * Appoints `agentId` (a Claude Code session) the boss (the previous one becomes a normal session), or `null` = no
   * Claude boss. `pending`: a session just opened from the page ("Open boss") that has not shown up yet.
   */
  appoint(agentId: string | null, pending?: { account: string }): TeamResult {
    if (agentId === null) {
      this.claudeBoss = undefined;
      this.announced = '';
      this.sync();
      return { ok: true };
    }
    if (this.team.boss.kind === 'agy') return { ok: false, status: 409, error: tr('the boss is an Antigravity account set in team.json') };
    const a = this.opts.office.get(agentId);
    if (!a) {
      // A pending boss: "<account>:<pid>" of the Claude Code just opened in that account.
      if (!pending || !pidOf(agentId) || !agentId.startsWith(`${pending.account}:`)) return { ok: false, status: 404, error: tr('agent not found') };
      this.claudeBoss = { kind: 'claude', id: agentId, account: pending.account, sessionId: '', pid: pidOf(agentId), name: '' };
      this.announced = '';
      this.sync();
      return { ok: true };
    }
    if (!canBeBoss(a)) return { ok: false, status: 400, error: tr('only an open Claude Code session can be the boss') };
    if (this.claudeBoss?.id === a.id) return { ok: true };
    this.claudeBoss = { kind: 'claude', id: a.id, account: a.account, sessionId: a.sessionId, pid: pidOf(a.id), name: a.name };
    this.announced = a.id;
    this.sync();
    this.crown(a);
    return { ok: true };
  }

  /** Puts the crown on the boss (if open), takes it off everyone else, and shows the team in the snapshot. */
  sync(): void {
    const office = this.opts.office;
    const agents = office.list();
    let rec = this.bossRec();
    const boss = findBoss(rec, agents);
    // "Open boss" opened a Claude Code that exited before showing up (e.g. "No, exit" at the trust question): no boss,
    // instead of "Opening the new boss…" forever.
    if (!boss && rec?.kind === 'claude' && !rec.sessionId && rec.pid && !(this.opts.isAlive ?? pidAlive)(rec.pid)) {
      this.claudeBoss = rec = undefined;
    }
    if (boss && rec?.kind === 'claude' && (boss.id !== rec.id || boss.sessionId !== rec.sessionId || boss.name !== rec.name)) {
      this.claudeBoss = { ...rec, id: boss.id, sessionId: boss.sessionId, pid: pidOf(boss.id), name: boss.name };
    }
    // A boss opened from the page gets its coronation when it walks in.
    if (boss && this.announced !== boss.id) {
      this.announced = boss.id;
      if (rec && (rec.kind === 'agy' || !rec.sessionId)) this.crown(boss);
    }
    for (const a of agents) if (a.kind === 'main') office.setBoss(a.id, a.id === boss?.id);
    this.publish();
  }

  /**
   * Re-reads the file (small: compared as text, parsed only when it differs). True when the team changed. A file that
   * does not parse (half saved) keeps the team as it was.
   */
  // shortcut: re-reads the small file every tick, use fs.watch if it ever grows
  reload(): boolean {
    let text: string;
    try {
      text = readFileSync(this.opts.file, 'utf8');
    } catch {
      return false;
    }
    if (text === this.last) return false;
    this.last = text;
    let next: TeamFile;
    try {
      next = parseTeam(text);
    } catch (err) {
      log.warnOnce(`team:${text.length}`, tr('team.json ({0}) could not be read: {1}', [this.opts.file, err instanceof Error ? err.message : String(err)]));
      return false;
    }
    if (JSON.stringify(next) === JSON.stringify(this.team)) return false;
    this.team = next;
    this.opts.onChange?.();
    this.sync();
    return true;
  }

  /** Sends the team to the snapshot now (worker sessions and jobs changed). */
  publish(): void {
    const names = this.team.workers.map((w) => w.name);
    const info: TeamInfo = { offices: [this.info(names)], workers: names, agy: this.opts.profiles?.() ?? [], ...(this.opts.extra?.() ?? {}) };
    this.opts.office.setTeam(info);
  }

  private info(workers: string[]): OfficeInfo {
    const folder = this.folder;
    const out: OfficeInfo = { id: 'main', name: basename(folder) || 'Office', folder, workers };
    if (folder) {
      const room = this.opts.office.roomList().find((r) => officeFolder(r.path) === folder);
      if (room) out.roomId = room.id;
    }
    const rec = this.bossRec();
    if (rec) {
      out.bossKind = rec.kind;
      out.bossAccount = rec.kind === 'agy' ? (this.opts.profiles?.().find((p) => p.acc === rec.account)?.account ?? `agy:${rec.account}`) : rec.account;
      const boss = findBoss(rec, this.opts.office.list());
      if (boss) out.bossAgentId = boss.id;
      else if (rec.kind === 'claude' && !rec.sessionId) out.pendingBoss = rec.id;
      else out.waitingBoss = rec.name || rec.id;
    }
    return out;
  }

  private crown(a: AgentInfo): void {
    this.opts.office.celebrate(a.id, tr('👑 {0} is the boss', [a.name]), tr('👑 {0} is now the boss (orchestrator)', [a.name]));
  }

  /** Reads team.json; imports the old file once when it does not exist; never overwrites a file that exists. */
  private load(): void {
    const { file, oldFile } = this.opts;
    if (existsSync(file)) {
      try {
        this.last = readFileSync(file, 'utf8');
        this.team = parseTeam(this.last);
      } catch (err) {
        log.warnOnce(`team:${this.last.length}`, tr('team.json ({0}) could not be read: {1}', [file, err instanceof Error ? err.message : String(err)]));
      }
      return;
    }
    this.team = EMPTY;
    if (oldFile && existsSync(oldFile)) {
      try {
        this.team = importTeam(readFileSync(oldFile, 'utf8'));
      } catch {
        // an unusable old file: start empty
      }
    }
    try {
      mkdirSync(dirname(file), { recursive: true });
      this.last = `${JSON.stringify(this.team, null, 2)}\n`;
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, this.last);
      renameSync(tmp, file);
    } catch {
      // read-only folder: the team lasts until the server restarts
    }
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
