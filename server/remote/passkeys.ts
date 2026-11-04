// The office owner's passkeys: <dataDir>/remote/passkeys.json (mode 600, written atomically), and the one-time
// WebAuthn challenges, which live only in RAM. Source: deploy spec §3.3-§3.5. Nothing here logs credential material.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';

export interface StoredPasskey { id: string; publicKey: string /* base64url */; counter: number; transports?: string[]; name: string; createdAt: number; lastUsedAt?: number }

export const CHALLENGE_TTL_MS = 120_000;
export const MAX_CHALLENGES = 50;
export const MAX_PASSKEYS = 20;
export const NAME_MAX = 60;

export class PasskeyStore {
  private items: StoredPasskey[] = [];

  constructor(private readonly file: string, private readonly log: { warn(m: string): void } = { warn: () => {} }) {
    let raw: string;
    try { raw = readFileSync(file, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn(tr('passkeys.json is unreadable; no passkeys loaded ({0})', [(e as Error).message]));
      return;
    }
    try {
      const v: unknown = JSON.parse(raw);
      if (!Array.isArray(v) || v.some((p) => !p || typeof p.id !== 'string' || typeof p.publicKey !== 'string')) throw new Error('bad shape');
      this.items = v as StoredPasskey[];
    } catch (e) {
      // Not overwritten here: only a successful add() replaces the file.
      this.log.warn(tr('passkeys.json is unreadable; no passkeys loaded ({0})', [(e as Error).message]));
    }
  }

  list(): readonly StoredPasskey[] { return this.items; }
  count(): number { return this.items.length; }
  get(id: string): StoredPasskey | undefined { return this.items.find((p) => p.id === id); }

  add(p: StoredPasskey): boolean {
    if (this.items.length >= MAX_PASSKEYS || this.get(p.id)) return false;
    return this.commit([...this.items, p]);
  }

  touch(id: string, counter: number, at: number): void {
    const cur = this.get(id);
    // A failed write keeps the in-memory counter: replay protection still holds until restart.
    if (cur) this.commit(this.items.map((p) => (p === cur ? { ...p, counter, lastUsedAt: at } : p)), true);
  }

  remove(id: string): boolean {
    return this.get(id) ? this.commit(this.items.filter((p) => p.id !== id)) : false;
  }

  private commit(next: StoredPasskey[], keepOnFail = false): boolean {
    const tmp = `${this.file}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      rmSync(tmp, { force: true }); // a leftover tmp must not lend us its mode
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
      this.log.warn(tr("couldn't save passkeys.json ({0})", [(e as Error).message]));
      if (keepOnFail) this.items = next;
      return false;
    }
    this.items = next;
    return true;
  }
}

export function cleanName(raw: unknown, at: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  return s || tr('Passkey {0}', [new Date(at).toISOString().slice(0, 10)]);
}

type Kind = 'login' | 'register';

export class Challenges {
  // Keyed by sha256 of the challenge: the lookup never compares the secret itself byte by byte.
  private readonly m = new Map<string, { kind: Kind; exp: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private static key(c: string): string { return createHash('sha256').update(c).digest('hex'); }

  add(kind: Kind, challenge: string): void {
    const t = this.now();
    for (const [k, v] of this.m) if (v.exp <= t) this.m.delete(k);
    while (this.m.size >= MAX_CHALLENGES) this.m.delete(this.m.keys().next().value as string);
    this.m.set(Challenges.key(challenge), { kind, exp: t + CHALLENGE_TTL_MS });
  }

  take(kind: Kind, challenge: string): boolean {
    const k = Challenges.key(challenge);
    const v = this.m.get(k);
    if (!v || v.kind !== kind) return false;
    this.m.delete(k);
    return v.exp > this.now();
  }
}
