// Single-use passkey step-up grants for the remote interactive terminal, and the registry of open remote streams.
// A grant is bound to one session and one target ("pty:<id>" to attach, "agent:<id>" to take over, "create:new|boss:<hash>"
// to open a new session with exactly those arguments); it lives in RAM only, so a hub restart drops every grant and stream.
import { createHash, randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

export const GRANT_TTL_MS = 60_000;
export const MAX_GRANTS = 20;

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Stable per-session key (the token signature is never stored raw). */
export const sessionKey = (sig: string): string => sha(sig);

/**
 * Target of a "new session" grant: the same function runs when the grant is issued (/verify) and when it is spent
 * (POST /api/pty), so a field that is not a string (or a boss flag that is not a boolean) never hashes. Absent and null
 * count alike; `boss` is part of the prefix, so a grant for one never opens the other. undefined = invalid.
 */
export function createTarget(b: unknown): string | undefined {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return undefined;
  const o = b as Record<string, unknown>;
  const opt = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';
  if (typeof o.cwd !== 'string' || !opt(o.account) || !opt(o.model) || !opt(o.prompt)) return undefined;
  if (o.boss !== undefined && o.boss !== null && typeof o.boss !== 'boolean') return undefined;
  const h = createHash('sha256').update(JSON.stringify([o.cwd, o.account ?? null, o.model ?? null, o.prompt ?? null])).digest('base64url');
  return `create:${o.boss === true ? 'boss' : 'new'}:${h}`;
}

const dead = (res: ServerResponse): boolean => res.destroyed || res.writableEnded;

interface Open { ptyId: string; key: string; res: ServerResponse; timer: NodeJS.Timeout }

export class PtyAccess {
  private readonly grants = new Map<string, { key: string; target: string; exp: number }>();
  private readonly opens = new Set<Open>();

  constructor(private readonly now: () => number = Date.now) {}

  /** undefined when MAX_GRANTS are outstanding. */
  issue(key: string, target: string): string | undefined {
    const t = this.now();
    for (const [h, g] of this.grants) if (g.exp <= t) this.grants.delete(h);
    if (this.grants.size >= MAX_GRANTS) return undefined;
    const grant = randomBytes(32).toString('base64url');
    this.grants.set(sha(grant), { key, target, exp: t + GRANT_TTL_MS });
    return grant;
  }

  /** Any presentation burns the grant; true only when unexpired and bound to this session and target. */
  consume(grant: string, key: string, target: string): boolean {
    const h = sha(grant);
    const g = this.grants.get(h);
    this.grants.delete(h);
    return !!g && g.exp > this.now() && g.key === key && g.target === target;
  }

  /** Registers an attached stream; it ends at `sessionExp` and unregisters when it closes. */
  open(ptyId: string, key: string, sessionExp: number, res: ServerResponse): void {
    if (dead(res)) return; // a stream that already closed would stay "live" forever
    const o: Open = { ptyId, key, res, timer: setTimeout(() => this.end(o), Math.min(2 ** 31 - 1, Math.max(0, sessionExp - Date.now()))) };
    o.timer.unref();
    this.opens.add(o);
    res.once('close', () => { clearTimeout(o.timer); this.opens.delete(o); });
  }

  live(ptyId: string, key: string): boolean {
    for (const o of this.opens) if (o.ptyId === ptyId && o.key === key && !dead(o.res)) return true;
    return false;
  }

  /** Removes the entry first: it must not stay live if `end()` never produces a 'close'. */
  private end(o: Open): void {
    clearTimeout(o.timer);
    this.opens.delete(o);
    o.res.end();
  }

  endSession(key: string): void {
    for (const o of [...this.opens]) if (o.key === key) this.end(o);
    for (const [h, g] of this.grants) if (g.key === key) this.grants.delete(h);
  }
}
