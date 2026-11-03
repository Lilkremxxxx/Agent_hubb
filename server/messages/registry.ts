// Messages from the office: the queue of what the page sends to agents.
//
// The page sends via POST /api/messages; the habblaud-mensagens plugin (mod/habblaud-mensagens, polling every 2 s
// in each open session) fetches messages for its own session via POST /api/mod/inbox, delivers each one as if typed
// by the user, and confirms via POST /api/mod/inbox/ack. The registry:
// - marks PRESENCE of each session that polls the inbox (AgentInfo.canMessage, via Office);
// - keeps messages for each agent in order and tracks their status (queued → sent → delivered/failed);
// - fails messages nobody fetched, unconfirmed by the session, from agents that left, or from a conversation that
//   changed (/clear, /resume): each message applies only to the session it was sent to;
// - adds the "Message from Habblaud" activity to the agent when the session confirms delivery.
// Text goes to the session exactly as typed (from the user) and is never returned in page responses or
// logs; only the feed activity gets the beginning, masked and trimmed.
import { randomBytes } from 'node:crypto';
import { truncate } from '../../shared/activity';
import { describeMessage, MESSAGE_MAX, SESSION_EFFORTS, SESSION_MODELS } from '../../shared/messages';
import type { Activity, AgentInfo, InboxMessage, OutboxMessage, SessionCommand } from '../../shared/types';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

/** Session that checked inbox within this time: can receive messages (canMessage). */
export const PRESENCE_MS = 10_000;
/** Message in queue that the session did not fetch within this time: fails. */
export const QUEUED_TIMEOUT_MS = 60_000;
/** Fetched message that the session did not confirm within this time: fails. */
export const SENT_TIMEOUT_MS = 30_000;
/** Resolved message (delivered or not) stays this long for GET /api/messages/:id and then disappears. */
export const KEEP_MS = 10 * 60_000;
export const MAX_TEXT = MESSAGE_MAX;
/** Messages not yet resolved per agent (next receives 429). */
export const MAX_OPEN = 5;
/** Messages delivered to plugin per batch. */
export const INBOX_BATCH = 5;

export const ERR_NOT_FETCHED = tr("the session didn't fetch the message: is the habblaud-mensagens plugin installed and the session open?");
export const ERR_NOT_CONFIRMED = tr("the session didn't confirm delivery");
export const ERR_GONE = tr('the agent left the office');
export const ERR_REFUSED = tr("the session didn't accept the message");
export const ERR_SESSION_CHANGED = tr("the agent's conversation changed (/clear or /resume) before delivery");

const ERROR_MAX = 300;
const ID_MAX = 300;
const ACK_MAX = 50;

/** What registry uses from Office (minimal interface: helps testing). */
export interface OfficeLike {
  get(id: string): AgentInfo | undefined;
  list(): AgentInfo[];
  markDirty(): void;
  addActivity(id: string, activity: Activity, current: boolean): void;
}

export interface MessageRegistryOptions {
  office: OfficeLike;
  now?: () => number;
  /** Internal clock interval (start). */
  tickMs?: number;
  presenceMs?: number;
  queuedTimeoutMs?: number;
  sentTimeoutMs?: number;
  keepMs?: number;
}

export type SendResult = { message: OutboxMessage } | { error: 'not-found' | 'too-many' } | { error: 'unavailable'; reason: string };

/** Body validation error (becomes 400). */
export class InvalidRequest extends Error {}

interface Entry {
  msg: OutboxMessage;
  /** The text as typed; emptied when the message resolves. */
  text: string;
  /** Feed activity when delivery is confirmed (start of text, masked and trimmed). */
  activity: ReturnType<typeof describeMessage>;
  /** Agent session when the message was sent: only it receives (conversation switch = failure). */
  target: string;
  /** Session that fetched the message (sent): only it confirms delivery. */
  session?: string;
  sentAt?: number;
  /** Failed due to lack of confirmation: late confirmation still corrects the status. */
  late?: boolean;
  /** `/model`, `/effort` or `/plan` for the session (the text is its typed form). */
  command?: SessionCommand;
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function shortStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
}

/** Agent still present in the office (not offline or done). */
function present(a: AgentInfo | undefined): a is AgentInfo {
  return !!a && a.status !== 'offline' && a.status !== 'done';
}

const isFinal = (e: Entry) => e.msg.status === 'delivered' || e.msg.status === 'failed';

/**
 * Why agent cannot receive messages right now (undefined = can receive). `reachable`: session has plugin connected.
 */
function unavailableReason(a: AgentInfo, reachable: boolean): string | undefined {
  if (a.kind !== 'main') return tr("subagents don't receive messages: send it to the main agent");
  if (!present(a)) return tr('the agent has already left the office');
  if (!reachable) return tr("the session doesn't have the habblaud-mensagens plugin connected (npm run mod:install)");
  return undefined;
}

/** `{name, args}` of POST /api/messages: model, effort or plan, with a value the drawer offers. */
function parseCommand(raw: unknown): SessionCommand {
  const c = rec(raw);
  const args = typeof c?.args === 'string' ? c.args : '';
  if (c?.name === 'model' && (SESSION_MODELS as readonly string[]).includes(args)) return { name: 'model', args };
  if (c?.name === 'effort' && (SESSION_EFFORTS as readonly string[]).includes(args)) return { name: 'effort', args };
  if (c?.name === 'plan' && !args) return { name: 'plan', args: '' };
  throw new InvalidRequest(tr('unknown command (model, effort or plan only)'));
}

/**
 * POST /api/messages body: `{agentId, text}`, or `{agentId, command}` to change the session's model, effort or plan
 * mode (its text is the typed form, "/model opus"). Text is not modified (nor trimmed).
 */
export function parseSend(raw: unknown): { agentId: string; text: string; command?: SessionCommand } {
  const r = rec(raw);
  const agentId = shortStr(r?.agentId, ID_MAX);
  if (r && agentId && r.command !== undefined) {
    const command = parseCommand(r.command);
    return { agentId, text: `/${command.name}${command.args ? ` ${command.args}` : ''}`, command };
  }
  if (!r || !agentId || typeof r.text !== 'string') throw new InvalidRequest('expected {agentId, text}');
  if (!r.text.trim()) throw new InvalidRequest(tr('the message is empty'));
  if (r.text.length > MAX_TEXT) throw new InvalidRequest(tr('the message exceeds 20,000 characters'));
  return { agentId, text: r.text };
}

/** Results from an ack ({results: [{id, ok, error?}]}): valid ones, up to ACK_MAX. */
function ackResults(raw: unknown): Array<{ id: string; ok: boolean; error?: string }> {
  const r = rec(raw);
  if (!r || !Array.isArray(r.results)) return [];
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of r.results.slice(0, ACK_MAX)) {
    const x = rec(item);
    const id = shortStr(x?.id, ID_MAX);
    if (!x || !id || typeof x.ok !== 'boolean') continue;
    out.push({ id, ok: x.ok, ...(typeof x.error === 'string' && x.error.trim() ? { error: truncate(x.error, ERROR_MAX) } : {}) });
  }
  return out;
}

export class MessageRegistry {
  private messages = new Map<string, Entry>();
  /** Last time each main agent's session checked the inbox. */
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly now: () => number;
  private readonly presenceMs: number;
  private readonly queuedTimeoutMs: number;
  private readonly sentTimeoutMs: number;
  private readonly keepMs: number;

  constructor(private readonly opts: MessageRegistryOptions) {
    this.now = opts.now ?? Date.now;
    this.presenceMs = opts.presenceMs ?? PRESENCE_MS;
    this.queuedTimeoutMs = opts.queuedTimeoutMs ?? QUEUED_TIMEOUT_MS;
    this.sentTimeoutMs = opts.sentTimeoutMs ?? SENT_TIMEOUT_MS;
    this.keepMs = opts.keepMs ?? KEEP_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        log.warnOnce(`messages-tick:${errMsg(err)}`, tr('Messages: clock failed ({0}).', [errMsg(err)]));
      }
    }, this.opts.tickMs ?? 500);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stored messages (including resolved ones, until pruned). */
  get size(): number {
    return this.messages.size;
  }

  /**
   * Main agents currently present that can receive messages: Claude Code agents whose session recently checked the
   * inbox. This is what Office puts into the snapshot.
   */
  reachable(): Set<string> {
    const out = new Set<string>();
    for (const id of this.seen.keys()) if (this.canMessage(id)) out.add(id);
    return out;
  }

  canMessage(agentId: string): boolean {
    const a = this.opts.office.get(agentId);
    const at = this.seen.get(agentId);
    if (at === undefined || this.now() - at >= this.presenceMs) return false;
    return present(a) && a.kind === 'main';
  }

  /**
   * Message from the page. `{error}`: unknown agent (not-found), cannot receive messages (unavailable, with
   * reason: subagent, left/done, or session without plugin), or too many messages waiting
   * (too-many). Invalid body: throws InvalidRequest.
   */
  send(raw: unknown): SendResult {
    const { agentId, text, command } = parseSend(raw);
    const agent = this.opts.office.get(agentId);
    if (!agent) return { error: 'not-found' };
    const reason = unavailableReason(agent, this.canMessage(agentId));
    if (reason) return { error: 'unavailable', reason };
    if (command && (agent.provider ?? 'claude') !== 'claude') return { error: 'unavailable', reason: tr('only Claude Code sessions take /model, /effort and /plan') };
    let open = 0;
    for (const e of this.messages.values()) if (e.msg.agentId === agentId && !isFinal(e)) open++;
    if (open >= MAX_OPEN) return { error: 'too-many' };

    const now = this.now();
    const id = `m-${now.toString(36)}-${++this.seq}-${randomBytes(9).toString('base64url')}`;
    const entry: Entry = { msg: { id, agentId, status: 'queued', createdAt: now, updatedAt: now }, text, activity: describeMessage(text), target: agent.sessionId };
    if (command) entry.command = command;
    this.messages.set(id, entry);
    const out = { ...entry.msg };
    return { message: out };
  }

  /** Status of a message (without text), or undefined. */
  get(id: string): OutboxMessage | undefined {
    const e = this.messages.get(id);
    return e ? { ...e.msg } : undefined;
  }

  /**
   * Plugin polling round: marks session presence and delivers next messages for its agent (marking them
   * `sent`). Session without known main agent: no messages. Invalid body: throws InvalidRequest.
   */
  inbox(raw: unknown): InboxMessage[] {
    const r = rec(raw);
    const session = shortStr(r?.session, ID_MAX);
    if (!r || !session) throw new InvalidRequest('expected {session, account?}');
    const account = shortStr(r.account, ID_MAX);
    const agent = this.opts.office
      .list()
      .find((a) => a.kind === 'main' && a.sessionId === session && (!account || a.account === account) && present(a));
    if (!agent) return [];

    const now = this.now();
    const was = this.canMessage(agent.id);
    this.seen.set(agent.id, now);
    // Only presence change updates snapshot (polling repeats every 2 s).
    if (!was) this.opts.office.markDirty();

    const out: InboxMessage[] = [];
    for (const e of this.messages.values()) {
      if (out.length >= INBOX_BATCH) break;
      if (e.msg.agentId !== agent.id || e.msg.status !== 'queued' || e.target !== session) continue;
      this.setStatus(e, 'sent', now);
      e.session = session;
      e.sentAt = now;
      out.push(e.command ? { id: e.msg.id, text: e.text, command: e.command } : { id: e.msg.id, text: e.text });
    }
    return out;
  }

  /**
   * Plugin confirmation: `sent` → `delivered` (ok) or `failed` (with reason). Only valid from session that fetched the
   * message; unknown ids or in another status are ignored. A late confirmation (message already failed for lack of
   * ack) still corrects the status: plugin knows if text entered.
   */
  ack(raw: unknown): void {
    const r = rec(raw);
    const session = shortStr(r?.session, ID_MAX);
    if (!r || !session || !Array.isArray(r.results)) throw new InvalidRequest('expected {session, results: [{id, ok, error?}]}');
    const now = this.now();
    for (const x of ackResults(r)) {
      const e = this.messages.get(x.id);
      if (!e || e.session !== session) continue;
      if (e.msg.status !== 'sent' && !(e.msg.status === 'failed' && e.late)) continue;
      if (x.ok) this.finish(e, 'delivered', now);
      else this.fail(e, now, x.error ?? ERR_REFUSED);
    }
  }

  /** Clock: timeouts, agent that left, expired presence, and resolved messages cleanup. */
  tick(): void {
    const now = this.now();
    for (const [id, e] of this.messages) {
      if (isFinal(e)) {
        if (now - e.msg.updatedAt >= this.keepMs) this.messages.delete(id);
        continue;
      }
      const a = this.opts.office.get(e.msg.agentId);
      if (!present(a)) this.fail(e, now, ERR_GONE);
      else if (e.msg.status === 'queued' && a.sessionId !== e.target) this.fail(e, now, ERR_SESSION_CHANGED);
      else if (e.msg.status === 'queued' && now - e.msg.createdAt >= this.queuedTimeoutMs) {
        this.fail(e, now, ERR_NOT_FETCHED);
      } else if (e.msg.status === 'sent' && now - (e.sentAt ?? now) >= this.sentTimeoutMs) {
        this.fail(e, now, ERR_NOT_CONFIRMED);
        e.late = true;
      }
    }
    // Expired presence (or from departed agent): snapshot updates to show messages unavailable.
    for (const [agentId, at] of this.seen) {
      if (now - at < this.presenceMs && present(this.opts.office.get(agentId))) continue;
      this.seen.delete(agentId);
      this.opts.office.markDirty();
    }
  }

  // ---------------------------------------------------------------- internals

  private setStatus(e: Entry, status: OutboxMessage['status'], now: number): void {
    e.msg.status = status;
    e.msg.updatedAt = now;
  }

  /** Resolves message: text is no longer needed. */
  private finish(e: Entry, status: 'delivered' | 'failed', now: number): void {
    this.setStatus(e, status, now);
    delete e.late;
    if (status === 'delivered') {
      delete e.msg.error;
      this.opts.office.addActivity(e.msg.agentId, { id: `${e.msg.agentId}#msg:${e.msg.id}`, at: now, ...e.activity }, false);
    }
    e.text = '';
  }

  private fail(e: Entry, now: number, error: string): void {
    e.msg.error = error;
    this.finish(e, 'failed', now);
  }
}
