// The advisor: a seat stuck on a job runs `advisor "<question>"`; the server pastes the question into the boss's
// terminal (bracketed paste), reads the boss's reply from the boss's transcript (the line starting with the tag
// [ADVISOR <seat> <ref>]) and hands it verbatim to the CLI. Source: spec §13 and the advisor spike.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { truncate } from '../../shared/activity';
import { tr } from '../../shared/i18n';
import type { Activity, AgentStatus } from '../../shared/types';
import { log } from '../log';
import { FileTail } from '../sources/tail';
import { SEAT_NAME } from '../team';

export const QUESTION_MAX = 1500;
const CELL_MAX = 300;

// Control characters (ESC, C1 such as 0x9b CSI) must never reach the boss's terminal or end the paste early.
// Plain slice, not truncate(): the question keeps its line breaks.
export function sanitizeQuestion(s: string): string {
  const t = s.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
  const u = t.trim();
  if (u.length <= QUESTION_MAX) return u;
  const cut = u.slice(0, QUESTION_MAX - 1);
  return (/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut) + '…';
}

export const advisorTag = (seat: string, ref: string): string => `[ADVISOR ${seat} ${ref}]`;

// No trailing Enter: the caller sends it separately, once the boss is not waiting on a dialog.
export function advisorPaste(seat: string, ref: string, question: string): string {
  return (
    '\x1b[200~' +
    tr('❓ Seat {0} asks (job {1}): {2}\n→ Reply briefly, starting exactly with the tag {3}; that reply is passed verbatim to {0}.', [seat, ref, question, advisorTag(seat, ref)]) +
    '\x1b[201~'
  );
}

// Only assistant text blocks count (not the pasted frame, queue entries or thinking); the tag must start a line.
export function findAnswer(lines: readonly string[], tag: string): string | undefined {
  const at = new RegExp('^[ \\t]*' + tag.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&'), 'm');
  for (const l of lines) {
    let o: { type?: string; message?: { content?: unknown } };
    try { o = JSON.parse(l); } catch { continue; }
    if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content as { type?: string; text?: unknown }[]) {
      if (b?.type !== 'text' || typeof b.text !== 'string') continue;
      const m = at.exec(b.text);
      if (!m) continue;
      const a = b.text.slice(m.index + m[0].length).split(/\n\s*\[ADVISOR /)[0].trim();
      if (a) return a; // a bare tag before a tool call is not an answer yet
    }
  }
  return undefined;
}

const cell = (s: string) => truncate(s, CELL_MAX).replace(/[\\|]/g, '\\$&');

export function qaRow(at: number, who: string, question: string, answer: string): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `| ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} | ${who} | ${cell(question)} | ${cell(answer)} |`;
}

// Inserts `row` after the last table line of the "## Hỏi đáp" section; undefined when there is no such table.
export function withQaRow(board: string, row: string): string | undefined {
  const lines = board.split('\n');
  const start = lines.findIndex((l) => l.normalize('NFC').startsWith('## Hỏi đáp'));
  if (start < 0) return undefined;
  let last = -1;
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) if (lines[i].startsWith('|')) last = i;
  if (last < 0) return undefined;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

const TYPEABLE = new Set<AgentStatus>(['idle', 'working', 'shell', 'waiting']);
export const ADVISOR_TIMING = { pollMs: 500, timeoutMs: 10 * 60_000, idleGraceMs: 5_000, unstartedMs: 20_000, retryWaitMs: 60_000 };
export interface AdvisorBoss { agentId: string; status: AgentStatus; waitingFor?: string; transcript: string }
export type AdvisorStatus = 'queued' | 'asking' | 'answered' | 'no-boss' | 'timeout' | 'untagged';
export interface AdvisorQuestion { id: string; slot: string; ref: string; question: string; status: AdvisorStatus; askedAt: number; endedAt?: number; answer?: string; error?: string }
export type AdvisorAsk = { ok: true; question: AdvisorQuestion } | { ok: false; status: number; error: string; code?: 'no-boss' | 'boss-waiting' | 'boss-starting' };
export interface BossGate { reason: string; code: 'no-boss' | 'boss-starting' }
export interface BossView { agy: boolean; id?: string; agent?: { status: AgentStatus; waitingFor?: string }; pty: boolean; transcript?: string }
const gate = (reason: string, code: BossGate['code'] = 'no-boss'): BossGate => ({ reason, code });
const NO_BOSS = () => tr('no boss terminal: open the boss from the page (the + beside Boss)');

/** What the office knows about the boss, as the gate the advisor needs: a terminal it can type to, or why not. */
export function resolveBoss(v: BossView): AdvisorBoss | BossGate {
  if (v.agy) return gate(tr('the boss is an Antigravity account: advisor reaches only a Claude Code boss for now'));
  if (!v.id) return gate(NO_BOSS());
  // Opened from the page, not in the office yet: its terminal is there, the session is not.
  if (!v.agent) return v.pty ? gate(tr('the boss is still starting: retry in a few seconds'), 'boss-starting') : gate(NO_BOSS());
  if (!v.pty || !v.transcript || !TYPEABLE.has(v.agent.status)) return gate(NO_BOSS());
  return { agentId: v.id, status: v.agent.status, waitingFor: v.agent.waitingFor, transcript: v.transcript };
}

export interface AdvisorDeps {
  /** The boss the office can type to, or why there is none (shown to the seat). */
  boss: () => AdvisorBoss | BossGate | string;
  typeTo: (agentId: string, data: string) => boolean;
  seat: (slot: string) => { agentId: string; ref: string } | undefined;
  note: (slot: string, question: string) => void;
  activity: (agentId: string, a: Activity) => void;
  /** The office folder ('' = none): its task_board.md gets the Hỏi đáp row. */
  folder: () => string;
  now?: () => number;
  /** pollMs 0 = no own timer (tests call tick()). */
  timing?: Partial<typeof ADVISOR_TIMING>;
}

// Per-question typing state; `q` is what callers see.
interface Open {
  q: AdvisorQuestion;
  agentId: string;
  /** The seat's ref when asked (without #n): a different one later means the job ended or changed. */
  baseRef: string;
  bossId: string;
  tail: FileTail;
  tag: string;
  enterAt?: number;
  /** The boss was seen working after the Enter. */
  armed: boolean;
  idleSince?: number;
  retried: boolean;
}

export class Advisor {
  private readonly t: typeof ADVISOR_TIMING;
  private readonly now: () => number;
  private readonly all = new Map<string, Open>();
  private readonly counts = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private seq = 0;

  constructor(private readonly d: AdvisorDeps) {
    this.t = { ...ADVISOR_TIMING, ...d.timing };
    this.now = d.now ?? Date.now;
  }

  ask(input: { slot: string; question: string; office?: string }): AdvisorAsk {
    const { slot } = input;
    const seat = SEAT_NAME.test(slot) ? this.d.seat(slot) : undefined;
    if (!seat) return { ok: false, status: 400, error: tr('{0} is not a seat in team.json, or its account is not signed in', [slot]) };
    const question = sanitizeQuestion(input.question);
    if (!question) return { ok: false, status: 400, error: tr('empty question') };
    const folder = this.d.folder();
    if (input.office && resolve(input.office) !== resolve(folder)) return { ok: false, status: 400, error: tr('{0} asks for the office {1}, not this one ({2})', [slot, input.office, folder]) };
    const found = this.d.boss();
    const boss = typeof found === 'string' ? gate(found) : found;
    if ('reason' in boss) return { ok: false, status: 409, error: boss.reason, code: boss.code };
    if (!TYPEABLE.has(boss.status)) return { ok: false, status: 409, error: NO_BOSS(), code: 'no-boss' };
    if (boss.status === 'waiting') return { ok: false, status: 409, error: boss.waitingFor ? tr('the boss is waiting for you: {0}', [boss.waitingFor]) : tr('the boss is waiting for you'), code: 'boss-waiting' };
    const key = `${slot} ${seat.ref}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    const ref = n > 1 ? `${seat.ref}#${n}` : seat.ref;
    const at = this.now();
    const id = `a${at.toString(36)}${(this.seq++).toString(36)}`;
    const q: AdvisorQuestion = { id, slot, ref, question, status: 'queued', askedAt: at };
    const o: Open = { q, agentId: seat.agentId, baseRef: seat.ref, bossId: boss.agentId, tail: new FileTail(boss.transcript), tag: advisorTag(slot, ref), armed: false, retried: false };
    if (!this.pendingPaste(o)) {
      try {
        if (!this.paste(o)) return { ok: false, status: 409, error: tr('the boss terminal closed'), code: 'no-boss' };
      } catch (e) {
        return { ok: false, status: 409, error: e instanceof Error ? e.message : String(e), code: 'no-boss' };
      }
    }
    this.counts.set(key, n);
    this.d.note(slot, question);
    this.d.activity(seat.agentId, { id: `${id}:ask`, at, kind: 'wait', icon: '❓', text: tr('Asks the boss: {0}', [truncate(question, 30)]), detail: truncate(question, 300) });
    this.all.set(q.id, o);
    // shortcut: the 50-question trim may drop a question that is still open (its CLI then gets 404); fine for one office, raise if seats ever exceed it
    for (const id of [...this.all.keys()].slice(0, -50)) this.all.delete(id);
    if (this.t.pollMs > 0 && !this.timer) this.timer = setInterval(() => this.tick(), this.t.pollMs).unref();
    return { ok: true, question: q };
  }

  /** Another question of the same boss is pasted and waits for its Enter: a second paste would glue onto it. */
  private pendingPaste(o: Open): boolean {
    for (const p of this.all.values()) if (p !== o && p.bossId === o.bossId && p.q.status === 'asking' && p.enterAt === undefined) return true;
    return false;
  }

  /** The tail starts at the end of the boss's transcript just before the paste, so an older tag never counts. */
  private paste(o: Open): boolean {
    o.tail.seekEnd();
    if (!this.d.typeTo(o.bossId, advisorPaste(o.q.slot, o.q.ref, o.q.question))) return false;
    o.q.status = 'asking';
    o.enterAt = undefined;
    return true;
  }

  async wait(id: string, waitS: number): Promise<AdvisorQuestion | undefined> {
    const until = Date.now() + Math.min(Math.max(waitS, 0), 60) * 1000;
    while (['queued', 'asking'].includes(this.all.get(id)?.q.status ?? '') && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    return this.all.get(id)?.q;
  }

  tick(): void {
    const now = this.now();
    for (const o of this.all.values()) {
      if (o.q.status !== 'asking' && o.q.status !== 'queued') continue;
      try {
        this.step(o, now);
      } catch (e) {
        // One bad question must not stop the others or crash the interval.
        const msg = e instanceof Error ? e.message : String(e);
        log.warnOnce(`advisor:${o.q.id}`, `advisor ${o.q.slot}: ${msg}`);
        if (o.q.status === 'asking' || o.q.status === 'queued') {
          try { this.end(o, 'no-boss', msg); } catch { o.q.status = 'no-boss'; o.q.error = msg; }
        }
      }
    }
    if (this.timer && ![...this.all.values()].some((o) => o.q.status === 'asking' || o.q.status === 'queued')) this.stop();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private step(o: Open, now: number): void {
    const found = this.d.boss();
    if (typeof found === 'string' || 'reason' in found || found.agentId !== o.bossId) return this.end(o, 'no-boss', typeof found === 'string' ? found : 'reason' in found ? found.reason : tr('the boss terminal closed'));
    const boss = found;
    if (o.q.status === 'queued') {
      if (now - o.q.askedAt >= this.t.timeoutMs) return this.end(o, 'timeout', tr('no answer after {0} min', [Math.round(this.t.timeoutMs / 60_000)]));
      if (boss.status !== 'waiting' && !this.pendingPaste(o) && !this.paste(o)) this.end(o, 'no-boss', tr('the boss terminal closed'));
      return;
    }
    for (let r = o.tail.read(); ; r = o.tail.read()) {
      const a = findAnswer(r.lines, o.tag);
      if (a !== undefined) return this.end(o, 'answered', a);
      if (!r.more) break;
    }
    if (now - o.q.askedAt >= this.t.timeoutMs) return this.end(o, 'timeout', tr('no answer after {0} min', [Math.round(this.t.timeoutMs / 60_000)]));
    if (o.enterAt === undefined) {
      if (boss.status !== 'waiting' && this.d.typeTo(o.bossId, '\r')) o.enterAt = now;
      return;
    }
    if (boss.status === 'working') {
      o.armed = true;
      o.idleSince = undefined;
      return;
    }
    if (boss.status === 'waiting') return void (o.idleSince = undefined);
    o.idleSince ??= now;
    if (o.retried) {
      if (now - o.enterAt >= this.t.retryWaitMs && now - o.idleSince >= this.t.idleGraceMs) this.end(o, 'untagged', tr('the boss replied without the tag {0}', [o.tag]));
    } else if ((o.armed && now - o.idleSince >= this.t.idleGraceMs) || (!o.armed && now - o.enterAt >= this.t.unstartedMs)) {
      // The paste was swallowed (tool turn, or never submitted): once more, same two steps.
      if (this.pendingPaste(o)) return; // another question's paste is waiting for its Enter: retry on a later tick
      o.retried = true;
      this.paste(o);
    }
  }

  private end(o: Open, status: AdvisorStatus, text: string): void {
    const { q } = o;
    q.status = status;
    q.endedAt = this.now();
    if (status === 'answered') q.answer = text;
    else q.error = text;
    const ok = status === 'answered';
    const seat = this.d.seat(q.slot);
    // The job ended or the seat is gone: the character has moved on, leave its activity alone.
    if (seat && seat.agentId === o.agentId && seat.ref === o.baseRef) this.d.activity(o.agentId, ok
      ? { id: `${q.id}:end`, at: q.endedAt, kind: 'communicate', icon: '💬', text: tr('The boss answered'), detail: truncate(text, 300) }
      : { id: `${q.id}:end`, at: q.endedAt, kind: 'error', icon: '⚠️', text: tr('No answer from the boss'), detail: text, error: true });
    if (ok) this.record(q);
  }

  private record(q: AdvisorQuestion): void {
    const folder = this.d.folder();
    if (!folder) return;
    const file = join(folder, 'task_board.md');
    try {
      const next = withQaRow(readFileSync(file, 'utf8'), qaRow(q.endedAt!, q.ref === '-' ? q.slot : `${q.slot} (${q.ref})`, q.question, q.answer!));
      if (next === undefined) return log.warnOnce(`advisor-board:${file}`, tr('{0} has no "## Hỏi đáp" table: the answer is not recorded', [file]));
      writeFileSync(`${file}.tmp`, next);
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      log.warnOnce(`advisor-board:${file}`, `${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
