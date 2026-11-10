// The office owner's passkeys: <dataDir>/remote/passkeys.json (mode 600, written atomically), and the one-time
// WebAuthn challenges, which live only in RAM. Source: deploy spec §3.3-§3.5. Nothing here logs credential material.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { normalizeIp } from '../http/guard';

export interface StoredPasskey { id: string; publicKey: string /* base64url */; counter: number; transports?: string[]; name: string; createdAt: number; lastUsedAt?: number }

export const CHALLENGE_TTL_MS = 120_000;
export const MAX_CHALLENGES = 50;
export const MAX_LOGIN_CHALLENGES = 5000; // public map: keys are sha256, TTL 2 min
export const MAX_LOGIN_CHALLENGES_PER_IP = 10;
export const MAX_REGISTER_CHALLENGES = 10; // only an authenticated session can add one
export const MAX_STEPUP_CHALLENGES = 20;
export const MAX_STEPUP_CHALLENGES_PER_SESSION = 3;
export const MAX_PASSKEYS = 20;
export const NAME_MAX = 60;

export class PasskeyStore {
  private items: StoredPasskey[] = [];
  /** The file exists but could not be read or parsed: this is not "0 passkeys" and must not be treated as a fresh start. */
  broken = false;

  constructor(private readonly file: string, private readonly log: { warn(m: string): void } = { warn: () => {} }) {
    let raw: string;
    try { raw = readFileSync(file, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.broken = true;
        this.log.warn(tr('passkeys.json is unreadable; no passkeys loaded ({0})', [(e as Error).message]));
      }
      return;
    }
    try {
      const v: unknown = JSON.parse(raw);
      if (!Array.isArray(v) || v.some((p) => !p || typeof p.id !== 'string' || typeof p.publicKey !== 'string')) throw new Error('bad shape');
      this.items = v as StoredPasskey[];
    } catch (e) {
      // Not overwritten here: only a successful add() replaces the file.
      this.broken = true;
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

type Kind = 'login' | 'register' | 'stepup';

export class Challenges {
  // Keyed by sha256 of the challenge: the lookup never compares the secret itself byte by byte.
  private readonly m = new Map<string, { kind: Kind; exp: number; owner: string }>();
  constructor(private readonly now: () => number = Date.now, private readonly max = MAX_CHALLENGES, private readonly perOwner = Infinity) {}

  private static key(c: string): string { return createHash('sha256').update(c).digest('hex'); }

  /** False when the map is full after the owner's own trim: a new owner is refused, never allowed to evict another's challenge. */
  add(kind: Kind, challenge: string, rawOwner = ''): boolean {
    const owner = normalizeIp(rawOwner); // one IPv6 /64 is one owner
    const t = this.now();
    for (const [k, v] of this.m) if (v.exp <= t) this.m.delete(k);
    const mine = [...this.m].filter(([, v]) => v.owner === owner).map(([k]) => k);
    for (const k of mine.slice(0, Math.max(0, mine.length - this.perOwner + 1))) this.m.delete(k);
    if (this.m.size >= this.max) return false;
    this.m.set(Challenges.key(challenge), { kind, exp: t + CHALLENGE_TTL_MS, owner });
    return true;
  }

  /** With `owner`, the challenge must have been issued to that same owner (it is not burned by another's attempt). */
  take(kind: Kind, challenge: string, owner?: string): boolean {
    const k = Challenges.key(challenge);
    const v = this.m.get(k);
    if (!v || v.kind !== kind || (owner !== undefined && v.owner !== normalizeIp(owner))) return false;
    this.m.delete(k);
    return v.exp > this.now();
  }
}

type Webauthn = typeof import('@simplewebauthn/server');
export type WebAuthnLib = Pick<Webauthn, 'generateRegistrationOptions' | 'verifyRegistrationResponse' | 'generateAuthenticationOptions' | 'verifyAuthenticationResponse'>;

// Loaded on the first ceremony, not at start: the library costs ~7 MB of RAM that an office without passkeys never needs
// (esbuild puts it in its own chunk, see scripts/build-server.mjs).
export class LibLoadError extends Error {}
const load = (): Promise<Webauthn> => import('@simplewebauthn/server').catch(() => { throw new LibLoadError('passkey library could not load'); });
const lazyLib: WebAuthnLib = {
  generateRegistrationOptions: async (o) => (await load()).generateRegistrationOptions(o),
  verifyRegistrationResponse: async (o) => (await load()).verifyRegistrationResponse(o),
  generateAuthenticationOptions: async (o) => (await load()).generateAuthenticationOptions(o),
  verifyAuthenticationResponse: async (o) => (await load()).verifyAuthenticationResponse(o),
};
export interface PasskeyView { id: string; name: string; createdAt: number; lastUsedAt?: number }

const TRANSPORTS = new Set(['internal', 'hybrid', 'usb', 'nfc', 'ble', 'smart-card', 'cable']);
export const cleanTransports = (t: unknown): string[] | undefined => {
  const out = Array.isArray(t) ? [...new Set(t.filter((x): x is string => typeof x === 'string' && TRANSPORTS.has(x)))].slice(0, 8) : [];
  return out.length ? out : undefined;
};

const view = (p: StoredPasskey): PasskeyView => ({ id: p.id, name: p.name, createdAt: p.createdAt, ...(p.lastUsedAt ? { lastUsedAt: p.lastUsedAt } : {}) });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** WebAuthn ceremonies for one owner. rpID and origin come only from the configured domain, never from a request. */
export class PasskeyService {
  private readonly loginCh: Challenges;
  private readonly registerCh: Challenges;
  private readonly stepupCh: Challenges;
  private readonly store: PasskeyStore;
  private readonly lib: WebAuthnLib;
  private readonly now: () => number;
  private readonly domain: string;
  private readonly user: string;
  private readonly topOrigin?: string;

  constructor(o: { domain: string; user: string; store: PasskeyStore; lib?: WebAuthnLib; now?: () => number; topOrigin?: string }) {
    this.topOrigin = o.topOrigin;
    this.domain = o.domain; this.user = o.user; this.store = o.store; this.lib = o.lib ?? lazyLib; this.now = o.now ?? Date.now;
    this.loginCh = new Challenges(this.now, MAX_LOGIN_CHALLENGES, MAX_LOGIN_CHALLENGES_PER_IP);
    this.registerCh = new Challenges(this.now, MAX_REGISTER_CHALLENGES, 3);
    this.stepupCh = new Challenges(this.now, MAX_STEPUP_CHALLENGES, MAX_STEPUP_CHALLENGES_PER_SESSION);
  }

  count(): number { return this.store.count(); }
  /** The passkeys file could not be loaded: remote changes and step-ups are refused until it is fixed on the computer. */
  broken(): boolean { return this.store.broken; }
  list(): PasskeyView[] { return this.store.list().map(view); }
  remove(id: string): boolean { return this.store.remove(id); }

  /** null: the public challenge map is full (the caller answers 429). */
  async loginOptions(ip: string): Promise<object | null> {
    const o = await this.lib.generateAuthenticationOptions({ rpID: this.domain, allowCredentials: [], userVerification: 'required', timeout: CHALLENGE_TTL_MS });
    return this.loginCh.add('login', o.challenge, ip) ? o : null;
  }

  /** Step-up options for one session (key = sessionKey); null: the challenge map is full (429). */
  async stepupOptions(sessionKey: string): Promise<object | null> {
    const o = await this.lib.generateAuthenticationOptions({ rpID: this.domain, allowCredentials: [], userVerification: 'required', timeout: CHALLENGE_TTL_MS });
    return this.stepupCh.add('stepup', o.challenge, sessionKey) ? o : null;
  }

  verifyLogin(body: unknown): Promise<boolean> {
    return this.verifyAssertion(body, (c) => this.loginCh.take('login', c));
  }

  verifyStepup(body: unknown, sessionKey: string): Promise<boolean> {
    return this.verifyAssertion(body, (c) => this.stepupCh.take('stepup', c, sessionKey));
  }

  private async verifyAssertion(body: unknown, take: (challenge: string) => boolean): Promise<boolean> {
    try {
      if (!isObj(body) || typeof body.id !== 'string') return false;
      const p = this.store.get(body.id);
      if (!p) return false;
      const r = await this.lib.verifyAuthenticationResponse({
        response: body as never,
        expectedChallenge: take,
        expectedOrigin: `https://${this.domain}`,
        expectedRPID: this.domain,
        // Inside the portal iframe Chrome adds crossOrigin + topOrigin; the library rejects that unless this is exactly the one
        // configured frame ancestor. Top-level assertions carry no topOrigin and are unaffected. Never an arbitrary value.
        ...(this.topOrigin ? { expectedTopOrigin: this.topOrigin } : {}),
        requireUserVerification: true,
        credential: { id: p.id, publicKey: Buffer.from(p.publicKey, 'base64url'), counter: p.counter, transports: cleanTransports(p.transports) as never },
      });
      if (!r.verified) return false;
      this.store.touch(p.id, r.authenticationInfo.newCounter, this.now());
      return true;
    } catch { return false; } // a library error text could echo credential material: never logged
  }

  async registerOptions(sessionKey = ''): Promise<object> {
    const o = await this.lib.generateRegistrationOptions({
      rpName: 'Bang_ver hub',
      rpID: this.domain,
      userName: this.user,
      userID: createHash('sha256').update(this.user).digest(), // stable handle, no readable name
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.store.list().map((p) => ({ id: p.id, transports: cleanTransports(p.transports) })),
      timeout: CHALLENGE_TTL_MS,
    });
    this.registerCh.add('register', o.challenge, sessionKey); // bound to the asking session, like step-up
    return o;
  }

  async verifyRegister(body: unknown, sessionKey = ''): Promise<{ ok: true; passkey: PasskeyView } | { ok: false; error: string }> {
    const fail = { ok: false as const, error: tr("Couldn't verify the passkey.") };
    try {
      if (!isObj(body) || !isObj(body.response)) return fail;
      const r = await this.lib.verifyRegistrationResponse({
        response: body.response as never,
        expectedChallenge: (c) => this.registerCh.take('register', c, sessionKey),
        expectedOrigin: `https://${this.domain}`,
        expectedRPID: this.domain,
        requireUserVerification: true,
      });
      if (!r.verified) return fail;
      const c = r.registrationInfo.credential;
      const p: StoredPasskey = { id: c.id, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, transports: cleanTransports(c.transports), name: cleanName(body.name, this.now()), createdAt: this.now() };
      return this.store.add(p) ? { ok: true, passkey: view(p) } : { ok: false, error: tr("Couldn't save the passkey.") };
    } catch { return fail; }
  }
}
