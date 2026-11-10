// Single-use passkey step-up grants for the remote interactive terminal, and the registry of open remote streams.
// A grant is bound to one session and one target ("pty:<id>" to attach, "agent:<id>" to take over); it lives in RAM
// only, so a hub restart drops every grant and stream.
import { createHash, randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

export const GRANT_TTL_MS = 60_000;
export const MAX_GRANTS = 20;

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Stable per-session key (the token signature is never stored raw). */
export const sessionKey = (sig: string): string => sha(sig);

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
    const o: Open = { ptyId, key, res, timer: setTimeout(() => res.end(), Math.min(2 ** 31 - 1, Math.max(0, sessionExp - Date.now()))) };
    o.timer.unref();
    this.opens.add(o);
    res.once('close', () => { clearTimeout(o.timer); this.opens.delete(o); });
  }

  live(ptyId: string, key: string): boolean {
    for (const o of this.opens) if (o.ptyId === ptyId && o.key === key) return true;
    return false;
  }

  endSession(key: string): void {
    for (const o of [...this.opens]) if (o.key === key) o.res.end();
    for (const [h, g] of this.grants) if (g.key === key) this.grants.delete(h);
  }
}
