// Authenticated remote access (mobile device on same network): a SECOND port, with user, password, and HTTPS.
//
// The primary port remains loopback only (hooks, plugins, and computer browser, without login). The remote
// port accepts any address, but EVERY request on it passes here before the API: without session cookie,
// page becomes login screen and API returns 401. What separates "local" from "remote" is the port on which
// connection arrived, never the Host header (which a LAN client can forge at will).
//
// Configuration (written by `npm run remote:setup`, scripts/remote-setup.ts):
//   HABBLAUD_REMOTE_USER + HABBLAUD_REMOTE_PASSWORD_HASH  enable the port (hash is scrypt, see remote/password.ts;
//                                                         plain-text password not accepted)
//   HABBLAUD_REMOTE_ALLOW   what remote session can do besides view: terminal ("none" = view
//                           only). Default (unset): view only.
//   HABBLAUD_REMOTE_TLS_DIR directory with server.key, server.crt (and ca.crt, served at /remote/ca.crt). Default:
//                           ~/.habblaud/remote-tls/server. Without certificate the port
//                           does not start unless HABBLAUD_REMOTE_INSECURE_HTTP=1 (plain HTTP: password and cookie
//                           exposed on LAN).
//   HABBLAUD_REMOTE_PORT / HABBLAUD_REMOTE_HOST  default 0.0.0.0:4748.
//   HABBLAUD_REMOTE_DOMAIN  behind a proxy (Cloudflare Tunnel): plain HTTP on loopback only (any certificate on
//                           disk is ignored), Secure cookie, every POST needs Origin https://<domain>, client IP
//                           from CF-Connecting-IP (only on a loopback connection).
//   HABBLAUD_REMOTE_GOOGLE_CLIENT_ID / _CLIENT_SECRET / _EMAILS  "Sign in with Google" (domain mode only; all three needed, see remote/google.ts).
//   HABBLAUD_REMOTE_PASSWORD_LOGIN  allow password sign-in even when passkeys exist (default: off once a passkey exists; passwords are the way back in).
//   HABBLAUD_REMOTE_OWNER_EMAIL  who is the owner (lower-cased, must look like a Google address, else ignored with a warning; unset =
//                           nobody is owner and nothing below applies). Owner sessions: password and passkey sign-ins always; Google only when the
//                           email matches; LD sign-in only when LD says owner:true AND the email matches. The token is `v1.<exp>[.o].<sig>` and the
//                           signature covers `.o`, so a viewer cookie cannot be upgraded. An owner session gets the read-only `terminal` transcripts
//                           without HABBLAUD_REMOTE_ALLOW and may register or delete passkeys (still needs a recent sign-in). Typing: see below.
//
// Typing in a terminal (owner, at least one passkey): POST /api/remote/stepup/options + /verify with {response, ptyId}, {response, agentId} or
// {response, create: {cwd, account?, model?, prompt?, boss?}} trade a passkey check for a grant: single use, 60 s, bound to the session and to
// `pty:<id>` (attach the stream, then input and resize while that stream is open), `agent:<id>` (takeover; the answer carries a fresh `pty:` grant
// for the new terminal) or `create:new|boss:<hash of the arguments>` (open a new session, only with those exact arguments). Every attach asks
// again; streams end at session expiry and on sign-out. Failures share the per-IP window. List, close, stop and sign-in terminals stay local-only.
// `pty` is never read from HABBLAUD_REMOTE_ALLOW. See remote/ptygrant.ts and http/pty.ts.
//
// Session: HttpOnly + SameSite=Lax cookie (+ Secure with HTTPS) signed with HMAC; key = random secret in
// <dataDir>/remote-secret mixed with user and password hash: changing password revokes all sessions.
import { LibLoadError, PasskeyService } from '../remote/passkeys';
import { GOOGLE_COOKIE, GOOGLE_COOKIE_S, GOOGLE_EMAIL_RE, maskEmail, parseGoogleConfig, type GoogleAuth, type GoogleConfig } from '../remote/google';
import { loginPage, securityPage } from '../remote/pages';
import { createTarget, PtyAccess, sessionKey } from '../remote/ptygrant';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parsePasswordHash, verifyPassword, type PasswordHash } from '../remote/password';
import { hostAllowed, isLoopbackBind, normalizeIp } from './guard';
import { isValidDomain } from '../remote/tls';
import { tr } from '../../shared/i18n';

/** `pty` (typing into a terminal after a passkey step-up) is never read from HABBLAUD_REMOTE_ALLOW: see remoteAllows. */
export type RemoteFeature = 'terminal' | 'pty';

const FEATURES: readonly RemoteFeature[] = ['terminal'];

export interface RemoteTls {
  dir: string;
  keyFile: string;
  certFile: string;
  caFile: string;
}

export interface RemoteConfig {
  port: number;
  host: string;
  user: string;
  passwordHash: PasswordHash;
  /** Hash text as it came from environment (used in session key). */
  passwordHashText: string;
  allow: ReadonlySet<RemoteFeature>;
  /** Missing = plain HTTP (only with HABBLAUD_REMOTE_INSECURE_HTTP=1, or behind a proxy). */
  tls?: RemoteTls;
  /** Lower-case public domain; present = behind a proxy. */
  domain?: string;
  passwordLogin: boolean;
  /** Present = Sign in with Google is on (domain mode only). */
  google?: GoogleConfig;
  /** HABBLAUD_REMOTE_OWNER_EMAIL, lower-case. Missing = nobody is owner (view only, as before). */
  ownerEmail?: string;
}

/** HABBLAUD_REMOTE_OWNER_EMAIL: lower-cased and trimmed; an invalid value is ignored with a warning. */
function parseOwnerEmail(raw: string | undefined): { ownerEmail?: string; warning?: string } {
  const email = raw?.trim().toLowerCase();
  if (!email) return {};
  return GOOGLE_EMAIL_RE.test(email) ? { ownerEmail: email } : { warning: tr('HABBLAUD_REMOTE_OWNER_EMAIL ignored: not a valid email address') };
}

/** Cookie gets `Secure` when the port speaks HTTPS itself or sits behind an HTTPS proxy. */
export function isSecureRemote(cfg: Pick<RemoteConfig, 'tls' | 'domain'>): boolean {
  return !!cfg.tls || !!cfg.domain;
}

export const DEFAULT_REMOTE_PORT = 4748;
export const COOKIE = 'habblaud_remote';
// `__Host-` (Secure, Path=/, no Domain) stops a sibling subdomain under a public suffix (pp.ua) from overwriting it;
// browsers drop it without Secure, so the plain-HTTP LAN mode keeps the bare name.
export const cookieName = (secure: boolean): string => (secure ? `__Host-${COOKIE}` : COOKIE);
/** Registering or deleting a passkey needs a sign-in at most this old. */
const RECENT_MS = 10 * 60_000;
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SSO_SESSION_MS = 12 * 60 * 60 * 1000;
/** Timeout for first byte of a connection on remote port (before knowing if HTTPS). */
const FIRST_BYTE_MS = 15_000;

function truthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

export function defaultTlsDir(env: NodeJS.ProcessEnv): string {
  if (env.HABBLAUD_REMOTE_TLS_DIR?.trim()) return env.HABBLAUD_REMOTE_TLS_DIR.trim();
  return join(env.HOME || homedir(), '.habblaud', 'remote-tls', 'server');
}


/** Enables remote access from environment. `warning` explains why it stayed off when intentional. */
export function parseRemoteConfig(
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): { config?: RemoteConfig; warning?: string } {
  const user = env.HABBLAUD_REMOTE_USER?.trim() ?? '';
  const hashText = env.HABBLAUD_REMOTE_PASSWORD_HASH?.trim() ?? '';
  const plain = env.HABBLAUD_REMOTE_PASSWORD ?? '';
  if (!user && !hashText && !plain) return {};
  if (plain && !hashText) return { warning: tr("remote access off: a plain-text password (HABBLAUD_REMOTE_PASSWORD) isn't accepted; run npm run remote:setup") };
  if (!user || !hashText) return { warning: tr('remote access off: HABBLAUD_REMOTE_USER and HABBLAUD_REMOTE_PASSWORD_HASH are missing; run npm run remote:setup') };
  const passwordHash = parsePasswordHash(hashText);
  if (!passwordHash) return { warning: tr('remote access off: invalid HABBLAUD_REMOTE_PASSWORD_HASH; run npm run remote:setup') };
  const passwordLogin = truthy(env.HABBLAUD_REMOTE_PASSWORD_LOGIN);
  const owner = parseOwnerEmail(env.HABBLAUD_REMOTE_OWNER_EMAIL);
  const ownerPart = owner.ownerEmail ? { ownerEmail: owner.ownerEmail } : {};
  const rawPort = Number.parseInt(env.HABBLAUD_REMOTE_PORT ?? '', 10);
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_REMOTE_PORT;
  const rawDomain = env.HABBLAUD_REMOTE_DOMAIN?.trim().toLowerCase();
  if (rawDomain) {
    if (!isValidDomain(rawDomain)) return { warning: tr('remote access off: invalid HABBLAUD_REMOTE_DOMAIN "{0}"', [rawDomain]) };
    const host = env.HABBLAUD_REMOTE_HOST?.trim() || '127.0.0.1';
    if (!isLoopbackBind(host)) return { warning: tr('remote access off: behind a proxy (HABBLAUD_REMOTE_DOMAIN) the remote port listens on loopback only; HABBLAUD_REMOTE_HOST={0}', [host]) };
    const g = parseGoogleConfig(env, rawDomain);
    return { config: { port, host, user, passwordHash, passwordHashText: hashText, allow: parseAllow(env.HABBLAUD_REMOTE_ALLOW), domain: rawDomain, passwordLogin, ...ownerPart, ...(g.google ? { google: g.google } : {}) }, warning: [g.warning, owner.warning].filter(Boolean).join('. ') || undefined };
  }
  const dir = defaultTlsDir(env);
  const tls: RemoteTls = { dir, keyFile: join(dir, 'server.key'), certFile: join(dir, 'server.crt'), caFile: join(dir, 'ca.crt') };
  const hasTls = exists(tls.keyFile) && exists(tls.certFile);
  const insecure = truthy(env.HABBLAUD_REMOTE_INSECURE_HTTP);
  if (!hasTls && !insecure) return { warning: tr('remote access off: no certificate in {0} (HTTPS is required); run npm run remote:setup', [dir]) };
  const host = env.HABBLAUD_REMOTE_HOST?.trim() || '0.0.0.0';
  return {
    config: { port, host, user, passwordHash, passwordHashText: hashText, allow: parseAllow(env.HABBLAUD_REMOTE_ALLOW), tls: hasTls ? tls : undefined, passwordLogin, ...ownerPart },
    warning: owner.warning,
  };
}

export function parseAllow(raw: string | undefined): Set<RemoteFeature> {
  if (raw === undefined || !raw.trim()) return new Set<RemoteFeature>(); // view only
  const out = new Set<RemoteFeature>();
  for (const part of raw.split(',')) {
    const p = part.trim().toLowerCase();
    if ((FEATURES as readonly string[]).includes(p)) out.add(p as RemoteFeature);
  }
  return out;
}

/**
 * Signing secret: read from `file` or generated (32 bytes, permission 600). Without writable disk, valid for current
 * run only.
 */
export function loadSecret(file: string): Buffer {
  try {
    if (existsSync(file)) {
      const hex = readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    }
    const secret = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
    chmodSync(file, 0o600);
    return secret;
  } catch {
    return randomBytes(32);
  }
}

/** Constant-time comparison (both sides converted to equal-length digests). */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b));
}

export interface SessionInfo { exp: number; sig: string; owner: boolean }

export class RemoteSessions {
  private readonly key: Buffer;
  /**
   * Signature -> expiration of tokens revoked by "Sign out" before expiry (cleared cookie is not enough: copy would
   * work until expiration).
   */
  private readonly revoked = new Map<string, number>();

  constructor(
    secret: Buffer,
    cfg: Pick<RemoteConfig, 'user' | 'passwordHashText' | 'ownerEmail'>,
    private readonly now: () => number = Date.now,
    /** Where list of revoked tokens survives restarts (missing = memory only). */
    private readonly revokedFile?: string,
  ) {
    // The owner email is part of the key: unsetting or changing it invalidates every session (old `.o` cookies cannot stay owner).
    // Unset keeps the key exactly as before, so existing cookies survive.
    this.key = createHmac('sha256', secret).update(`${cfg.user}\0${cfg.passwordHashText}${cfg.ownerEmail ? `\0${cfg.ownerEmail}` : ''}`, 'utf8').digest();
    this.loadRevoked();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload, 'utf8').digest('base64url');
  }

  /**
   * A shorter `ttlMs` also makes the session never `recent()` (its implied issue time is far in the past).
   * An owner token carries `.o` inside the signed payload; a token without it (every older cookie) is a viewer.
   */
  issue(ttlMs = SESSION_MS, owner = false): { token: string; maxAgeS: number } {
    const exp = this.now() + ttlMs;
    const payload = `v1.${exp}${owner ? '.o' : ''}`;
    return { token: `${payload}.${this.sign(payload)}`, maxAgeS: Math.floor(ttlMs / 1000) };
  }

  verify(token: string | undefined): boolean {
    return !!this.info(token);
  }

  /** The session behind a valid, unrevoked token. */
  info(token: string | undefined): SessionInfo | undefined {
    const parsed = this.parse(token);
    return parsed && !this.revoked.has(parsed.sig) ? parsed : undefined;
  }

  isOwner(token: string | undefined): boolean {
    return !!this.info(token)?.owner;
  }

  /** True when this valid token was issued (password or passkey sign-in) within the last `ms`. */
  recent(token: string | undefined, ms: number): boolean {
    const parsed = this.parse(token);
    return !!parsed && !this.revoked.has(parsed.sig) && this.now() - (parsed.exp - SESSION_MS) <= ms;
  }

  /** Revokes this token ("Sign out" button); invalid or expired token changes nothing. */
  revoke(token: string | undefined): void {
    const parsed = this.parse(token);
    if (!parsed) return;
    const now = this.now();
    for (const [sig, exp] of this.revoked) if (exp <= now) this.revoked.delete(sig);
    this.revoked.set(parsed.sig, parsed.exp);
    this.saveRevoked();
  }

  private parse(token: string | undefined): SessionInfo | undefined {
    if (!token) return undefined;
    const m = /^v1\.(\d{10,16})(\.o)?\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return undefined;
    const exp = Number(m[1]);
    if (exp <= this.now() || exp > this.now() + SESSION_MS) return undefined; // expired, or older/longer than a session
    const expected = Buffer.from(this.sign(`v1.${m[1]}${m[2] ?? ''}`));
    const got = Buffer.from(m[3]);
    return expected.length === got.length && timingSafeEqual(expected, got) ? { exp, sig: m[3], owner: !!m[2] } : undefined;
  }

  private loadRevoked(): void {
    if (!this.revokedFile) return;
    try {
      const data: unknown = JSON.parse(readFileSync(this.revokedFile, 'utf8'));
      const now = this.now();
      for (const [sig, exp] of Object.entries(data as Record<string, unknown>)) {
        if (/^[A-Za-z0-9_-]{43}$/.test(sig) && typeof exp === 'number' && exp > now) this.revoked.set(sig, exp);
      }
    } catch {
      // no file (or unreadable): no tokens revoked yet
    }
  }

  private saveRevoked(): void {
    if (!this.revokedFile) return;
    try {
      mkdirSync(dirname(this.revokedFile), { recursive: true });
      const tmp = `${this.revokedFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.revoked)), { mode: 0o600 });
      renameSync(tmp, this.revokedFile);
    } catch {
      // remains valid in memory until next restart
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Brute-force throttle: after 5 consecutive failures, each new attempt waits 2^(n-5) s (up to 5 min).
 * Global, not per IP. One password check at a time
 * (begin/end), counted as failure from start: parallel attempts cannot bypass throttle while scrypt runs.
 */
export class LoginThrottle {
  private failures = 0;
  private blockedUntil = 0;
  private busy = false;

  /** `maxBackoffS` lowers the 5-minute ceiling (behind a proxy the per-IP window does the hard blocking). */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxBackoffS = 300,
  ) {}

  /** Seconds until another attempt can be made (0 = ready; 1 while another attempt is in progress). */
  retryAfter(): number {
    return Math.max(this.busy ? 1 : 0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  /** Starts an attempt (already counted as failure); false if throttle or another attempt prevents it. */
  begin(): boolean {
    if (this.retryAfter() > 0) return false;
    this.busy = true;
    this.fail();
    return true;
  }

  /** End of attempt started in begin(): success resets throttle; failure keeps already-counted failure. */
  end(ok: boolean): void {
    this.busy = false;
    if (ok) this.succeed();
  }

  fail(): void {
    this.failures++;
    if (this.failures >= 5) this.blockedUntil = this.now() + Math.min(this.maxBackoffS, 2 ** (this.failures - 5)) * 1000;
  }

  succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}

/** Sign-in failures per client IP: `limit` failures within `windowMs` block that IP (max 1000 keys tracked). */
export class FailureWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly noted = new Map<string, number>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private norm(key: string): string { return normalizeIp(key); }

  private live(raw: string): number[] {
    const key = this.norm(raw);
    const t = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((x) => x > t);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Seconds until `key` may try again (0 = free). */
  retryAfter(key: string): number {
    const list = this.live(key);
    return list.length < this.limit ? 0 : Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  /** True the first time `key` is seen blocked in this window (so logs get one line, not one per request). */
  noteBlocked(raw: string): boolean {
    const key = this.norm(raw);
    const at = this.noted.get(key);
    if (at !== undefined && this.now() - at < this.windowMs) return false;
    this.noted.delete(key);
    if (this.noted.size >= 1000) this.noted.delete(this.noted.keys().next().value as string);
    this.noted.set(key, this.now());
    return true;
  }

  fail(raw: string): void {
    const key = this.norm(raw);
    const list = this.live(key);
    list.push(this.now());
    this.hits.delete(key); // re-insert: Map order = least recently failed first
    if (this.hits.size >= 1000) this.hits.delete(this.hits.keys().next().value as string);
    this.hits.set(key, list);
  }

  clear(key: string): void {
    this.hits.delete(this.norm(key));
  }
}

/**
 * Client address for rate limiting and logs. CF-Connecting-IP is believed only behind a proxy AND when the
 * connection itself is loopback (cloudflared on this machine); anywhere else the header is forgeable and ignored.
 */
export function clientIp(req: IncomingMessage, behindProxy: boolean): string {
  const peer = req.socket.remoteAddress ?? '-';
  const h = req.headers['cf-connecting-ip'];
  const ip = typeof h === 'string' ? h.trim() : '';
  return behindProxy && isIP(ip) !== 0 && isLoopbackBind(peer.replace(/^::ffff:/i, '')) ? ip : peer;
}

/** Requests that arrived on remote port and passed login. */
const remoteRequests = new WeakSet<IncomingMessage>();
/** Session behind each signed-in request (never set for PUBLIC_STATIC requests). */
const sessionsOfRequests = new WeakMap<IncomingMessage, SessionInfo>();
export const sessionOf = (req: IncomingMessage): SessionInfo | undefined => sessionsOfRequests.get(req);
export const isOwnerRequest = (req: IncomingMessage): boolean => !!sessionOf(req)?.owner;

/**
 * `allows` for the app: `terminal` (read-only transcript) from HABBLAUD_REMOTE_ALLOW or for an owner session; `pty`
 * (typing, after a passkey step-up) only for an owner session while a passkey exists, never from the env.
 */
export function remoteAllows(allow: ReadonlySet<RemoteFeature>, passkeyCount: () => number = () => 0): (req: IncomingMessage, f: RemoteFeature) => boolean {
  return (req, f) => (f === 'pty' ? isOwnerRequest(req) && passkeyCount() > 0 : allow.has(f) || (f === 'terminal' && isOwnerRequest(req)));
}
/** Files served by remote port without login: manifest, icons and the sign-in script (mobile fetches them before login, without
 *  cookie). No API or office contents. */
const PUBLIC_STATIC = /^\/(manifest\.webmanifest|assets\/brand\/(?:finstar-144|apple-touch-icon|icon-192|icon-512)\.png|assets\/remote\/auth\.js)$/;

/** Hosts the remote port accepts: the shared ALLOWED_HOSTS plus the hub domain. The main port never gets the domain, so a tunnel pointed at it by mistake is refused. */
/** True when ALLOWED_HOSTS (shared with the main port) still lists the hub domain, e.g. from an older remote:setup. */
export const listsHubDomain = (allowed: ReadonlySet<string>, domain?: string): boolean => !!domain && allowed.has(domain);

export function remoteAllowedHosts(allowed: ReadonlySet<string>, domain?: string): Set<string> {
  return new Set([...allowed, ...(domain ? [domain] : [])]);
}

export function isRemoteRequest(req: IncomingMessage): boolean {
  return remoteRequests.has(req);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req: IncomingMessage, max = 8 * 1024, cut = false): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
      else if (cut) { req.destroy(); fail(new Error(tr('body too large'))); } // do not read on
    });
    req.on('end', () => (size > max ? fail(new Error(tr('body too large'))) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

export const CA_PATH = '/remote/ca.crt';

function sendHtml(res: ServerResponse, html: string, frameAncestor?: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(frameAncestor ? {} : { 'X-Frame-Options': 'DENY' }),
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors ${frameAncestor ?? "'none'"}`,
  });
  res.end(html);
}

function cookieHeader(value: string, maxAgeS: number, secure: boolean): string {
  return `${cookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}

export interface RemoteGateDeps {
  config: Pick<RemoteConfig, 'user' | 'passwordHash'>;
  sessions: RemoteSessions;
  /** Secure cookie (port uses HTTPS). */
  secure: boolean;
  /** Public CA file served at /remote/ca.crt (missing = no download). */
  caFile?: string;
  throttle?: LoginThrottle;
  /** Public domain when behind a proxy: enables the Origin check and CF-Connecting-IP. */
  domain?: string;
  /** Per-IP sign-in failure window (default: 5 in 10 minutes). */
  failures?: FailureWindow;
  log?: { info(m: string): void; warn(m: string): void };
  /** Password check (injectable in tests; default: scrypt). */
  verify?: (password: string, hash: PasswordHash) => Promise<boolean>;
  /** Passkeys (only behind a proxy, where the domain is the WebAuthn rpID). */
  passkeys?: PasskeyService;
  /** HABBLAUD_REMOTE_PASSWORD_LOGIN: keep password sign-in on after a passkey exists. */
  passwordLogin?: boolean;
  /** Sign in with Google (only behind a proxy; missing = the routes answer 404). */
  google?: GoogleAuth;
  /** HABBLAUD_FRAME_ANCESTORS: the one https origin allowed to embed the login and security pages. */
  frameAncestor?: string;
  /** LD_SSO_SECRET + LD_INTERNAL_URL: sign in with a one-time ticket from the Linux Dashboard (missing = the route answers 404). */
  sso?: { url: string; secret: string; timeoutMs?: number };
  /** HABBLAUD_REMOTE_OWNER_EMAIL (lower-case). Missing = nobody is owner. */
  ownerEmail?: string;
  /** Step-up grants and open remote terminal streams (shared with the pty routes). Missing = step-up routes answer 404. */
  ptyAccess?: PtyAccess;
}

/** LD_INTERNAL_URL must be plain http(s) on loopback: the hub sends a bearer secret there (SSRF guard). */
export function parseSsoEnv(env: Record<string, string | undefined>): { sso?: { url: string; secret: string }; warning?: string } {
  const { LD_SSO_SECRET: secret, LD_INTERNAL_URL: raw } = env;
  if (!secret || !raw) return {};
  try {
    const u = new URL(raw);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return { sso: { url: u.origin, secret } };
  } catch { /* falls through */ }
  return { warning: tr('LD sign-in off: LD_INTERNAL_URL must be http(s)://127.0.0.1 or localhost') };
}

const TICKET = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Remote port gate, after guard (Host/Origin/JSON) and before API: returns true when already handled (login,
 * logout, 401, redirect, CA) and false when request is authenticated — and then marks it as remote.
 */
const CHALLENGE_TTL_S = 120; // = CHALLENGE_TTL_MS: a refused challenge frees up when the oldest expires

export function createRemoteGate(deps: RemoteGateDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const throttle = deps.throttle ?? new LoginThrottle(Date.now, deps.domain ? 30 : 300);
  const failures = deps.failures ?? new FailureWindow();
  const verify = deps.verify ?? verifyPassword;
  const cname = cookieName(deps.secure);
  /** Password and passkey sign-ins are the owner (the credentials are the proof); Google and LD need the matching email. */
  const isOwnerEmail = (email: unknown): boolean => !!deps.ownerEmail && typeof email === 'string' && email.trim().toLowerCase() === deps.ownerEmail;
  const passwordOff = () => !!deps.passkeys && deps.passkeys.count() > 0 && !deps.passwordLogin;
  const caAvailable = () => !!deps.caFile && existsSync(deps.caFile);
  let libWarned = false;
  /** Sessions that just got registration options through a step-up grant (key -> until). */
  const registering = new Map<string, number>();
  const unreadable = (res: ServerResponse, req: IncomingMessage): void => {
    req.resume();
    if (!brokenWarned) { brokenWarned = true; deps.log?.warn(tr('passkeys.json is unreadable: remote passkey changes and step-ups are refused until it is fixed on the computer running Habblaud')); }
    return sendJson(res, 403, { error: tr('passkeys.json is unreadable: fix or remove it on the computer running Habblaud') });
  };
  let brokenWarned = false;
  const passkeyRoute = (req: IncomingMessage, res: ServerResponse, route: string, authed: boolean): void => {
    const pk = deps.passkeys;
    const POST = ['/login/options', '/login/verify', '/register/options', '/register/verify', '/delete'];
    if (!pk || !(route === '' || POST.includes(route))) { req.resume(); return sendJson(res, 404, { error: tr('not found') }); }
    if (req.method !== (route === '' ? 'GET' : 'POST')) { req.resume(); return sendJson(res, 405, { error: tr('method not allowed') }, { Allow: route === '' ? 'GET' : 'POST' }); }
    const isLogin = route.startsWith('/login/');
    if (!isLogin && !authed) { req.resume(); return sendJson(res, 401, { error: tr('sign in: open Habblaud on this port in your browser and enter your username and password') }); }
    if (route === '') { req.resume(); return sendJson(res, 200, { passkeys: pk.list() }); }
    const ip = clientIp(req, !!deps.domain);
    const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
    if (isLogin) {
      // Shares the per-IP FailureWindow with password sign-in, NOT the global LoginThrottle: a stranger must not be able to lock the owner out.
      const wait = failures.retryAfter(ip);
      if (wait > 0) {
        req.resume();
        if (failures.noteBlocked(ip)) deps.log?.warn(tr('Remote sign-in blocked ({0}) from {1}, {2}', ['passkey', ip, ua]));
        return sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [wait]) }, { 'Retry-After': String(wait) });
      }
    }
    const change = route === '/register/options' || route === '/register/verify' || route === '/delete';
    const cookie = readCookie(req.headers.cookie, cname);
    if (change && !deps.ownerEmail) {
      // Without an owner nobody can prove they may add an authenticator (and an authenticator is a way in to the terminal).
      req.resume();
      deps.log?.warn(tr('Remote passkey change refused ({0}) from {1}, {2}', [route.slice(1), ip, ua]));
      return sendJson(res, 403, { error: tr('registering or deleting passkeys needs HABBLAUD_REMOTE_OWNER_EMAIL') });
    }
    if (change && !(deps.sessions.recent(cookie, RECENT_MS) && deps.sessions.isOwner(cookie))) {
      req.resume();
      deps.log?.warn(tr('Remote passkey change refused ({0}) from {1}, {2}', [route.slice(1), ip, ua]));
      return sendJson(res, 403, { error: tr('sign in again to change passkeys') });
    }
    if (change && pk.broken()) return unreadable(res, req);
    const sess = deps.sessions.info(cookie);
    const sKey = sess ? sessionKey(sess.sig) : '';
    // Once a passkey exists, changing them also needs a fresh passkey check (grant `passkey:add` / `passkey:del`):
    // a stolen owner cookie must not be able to add its own authenticator.
    const guarded = change && pk.count() > 0;
    readBody(req, 32 * 1024, true)
      .then(async (raw) => {
        const body: unknown = raw.trim() === '' && route.endsWith('/options') ? {} : JSON.parse(raw);
        if (route === '/login/options') {
          const o = await pk.loginOptions(ip);
          return o ? sendJson(res, 200, o) : sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [CHALLENGE_TTL_S]) }, { 'Retry-After': String(CHALLENGE_TTL_S) });
        }
        const grantOk = (action: string) => !!deps.ptyAccess && typeof (body as { grant?: unknown })?.grant === 'string' && deps.ptyAccess.consume((body as { grant: string }).grant, sKey, action);
        const refuse = () => {
          deps.log?.warn(tr('Remote passkey change refused ({0}) from {1}, {2}', [route.slice(1), ip, ua]));
          return sendJson(res, 403, { error: tr('changing passkeys needs a passkey check') });
        };
        if (route === '/register/options') {
          if (guarded && !grantOk('passkey:add')) return refuse();
          const o = await pk.registerOptions(sKey);
          if (guarded) {
            // Only a granted options call opens the window: one made at count 0 must not finish once another passkey exists.
            for (const [k, until] of registering) if (until <= Date.now()) registering.delete(k);
            registering.set(sKey, Date.now() + CHALLENGE_TTL_S * 1000);
          }
          return sendJson(res, 200, o);
        }
        if (route === '/login/verify') {
          if (!(await pk.verifyLogin(body))) {
            failures.fail(ip);
            deps.log?.warn(tr('Remote sign-in failed ({0}) from {1}, {2}', ['passkey', ip, ua]));
            return sendJson(res, 401, { error: tr('Passkey not recognized.') });
          }
          failures.clear(ip);
          deps.log?.info(tr('Remote sign-in ok ({0}) from {1}, {2}', ['passkey', ip, ua]));
          const { token, maxAgeS } = deps.sessions.issue(SESSION_MS, !!deps.ownerEmail);
          return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, maxAgeS, deps.secure) });
        }
        if (route === '/register/verify') {
          // The grant was spent at /register/options; this session must have just got options through it.
          const until = registering.get(sKey);
          registering.delete(sKey);
          if (guarded && !(until && until > Date.now())) return refuse();
          const r = await pk.verifyRegister(body, sKey);
          if (r.ok) deps.log?.info(tr('Remote passkey registered from {0}, {1}', [ip, ua]));
          return r.ok ? sendJson(res, 200, { passkey: r.passkey }) : sendJson(res, 400, { error: r.error });
        }
        if (pk.count() <= 1) {
          deps.log?.warn(tr('Remote passkey change refused ({0}) from {1}, {2}', [route.slice(1), ip, ua]));
          return sendJson(res, 403, { error: tr('remove the last passkey on the computer running Habblaud') });
        }
        if (guarded && !grantOk('passkey:del')) return refuse();
        const id = !!body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : '';
        if (!pk.remove(id)) return sendJson(res, 404, { error: tr('not found') });
        deps.log?.info(tr('Remote passkey removed from {0}, {1}', [ip, ua]));
        return sendJson(res, 200, { ok: true });
      })
      .catch((e) => {
        if (e instanceof LibLoadError && !libWarned) { libWarned = true; deps.log?.warn(tr('passkey library could not load')); } // once, no stack
        if (!res.headersSent) sendJson(res, 400, { error: tr('invalid request') });
      });
  };
  // Passkey step-up: the owner proves presence again before typing into a terminal (or taking an agent over).
  // The grant it returns is single use, 60 s, bound to this session and to one target.
  const TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const PASSKEY_ACTIONS = new Set(['passkey:add', 'passkey:del']);
  const stepupRoute = (req: IncomingMessage, res: ServerResponse, route: string, session: SessionInfo | undefined): void => {
    const pk = deps.passkeys;
    const access = deps.ptyAccess;
    if (!pk || !access || (route !== '/options' && route !== '/verify')) { req.resume(); return sendJson(res, 404, { error: tr('not found') }); }
    if (req.method !== 'POST') { req.resume(); return sendJson(res, 405, { error: tr('method not allowed') }, { Allow: 'POST' }); }
    // Only the hub's own page may run a step-up: a same-site sibling (linux.finstar.pp.ua shares the Lax cookie) or a request without the header is refused.
    if (req.headers['sec-fetch-site'] !== 'same-origin') { req.resume(); return sendJson(res, 403, { error: tr('origin not allowed for the interactive terminal') }); }
    if (!session) { req.resume(); return sendJson(res, 401, { error: tr('sign in: open Habblaud on this port in your browser and enter your username and password') }); }
    if (!session.owner) { req.resume(); return sendJson(res, 403, { error: tr('only the owner can type in the terminal') }); }
    if (pk.broken()) return unreadable(res, req);
    if (pk.count() === 0) { req.resume(); return sendJson(res, 403, { error: tr('typing in the terminal needs a passkey: register one first') }); }
    const key = sessionKey(session.sig);
    const ip = clientIp(req, !!deps.domain);
    const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
    if (route === '/options') {
      req.resume();
      pk.stepupOptions(key).then(
        (o) => (o ? sendJson(res, 200, o) : sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [CHALLENGE_TTL_S]) }, { 'Retry-After': String(CHALLENGE_TTL_S) })),
        () => sendJson(res, 400, { error: tr('invalid request') }),
      );
      return;
    }
    const wait = failures.retryAfter(ip);
    if (wait > 0) {
      req.resume();
      if (failures.noteBlocked(ip)) deps.log?.warn(tr('Remote sign-in blocked ({0}) from {1}, {2}', ['step-up', ip, ua]));
      return sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [wait]) }, { 'Retry-After': String(wait) });
    }
    // The owner and passkey checks above ran first; only now may a larger body (a create carries a prompt of up to 20 000 characters) be buffered.
    readBody(req, 128 * 1024, true)
      .then(async (raw) => {
        const body = JSON.parse(raw) as { response?: unknown; ptyId?: unknown; agentId?: unknown; action?: unknown; create?: unknown };
        const ids = [body?.ptyId, body?.agentId, body?.action, body?.create].filter((x) => x !== undefined);
        const id = ids[0];
        const created = body?.create !== undefined ? createTarget(body.create) : undefined;
        if (!body || typeof body !== 'object' || !body.response || typeof body.response !== 'object' || ids.length !== 1) return sendJson(res, 400, { error: tr('invalid request') });
        const valid = body.create !== undefined ? created !== undefined : typeof id === 'string' && (body.action !== undefined ? PASSKEY_ACTIONS.has(id) : TARGET_ID.test(id));
        if (!valid) return sendJson(res, 400, { error: tr('invalid request') });
        const target = created ?? (body.action !== undefined ? String(id) : `${body.ptyId !== undefined ? 'pty' : 'agent'}:${String(id)}`);
        if (!(await pk.verifyStepup(body.response, key))) {
          failures.fail(ip);
          deps.log?.warn(tr('Remote passkey step-up failed from {0}, {1}', [ip, ua]));
          return sendJson(res, 401, { error: tr('Passkey not recognized.') });
        }
        const grant = access.issue(key, target);
        if (!grant) return sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [60]) }, { 'Retry-After': '60' });
        deps.log?.info(tr('Remote passkey step-up ok from {0}, {1}', [ip, ua]));
        return sendJson(res, 200, { grant, expiresInS: 60 });
      })
      .catch((e) => {
        if (e instanceof LibLoadError && !libWarned) { libWarned = true; deps.log?.warn(tr('passkey library could not load')); }
        if (!res.headersSent) sendJson(res, 400, { error: tr('invalid request') });
      });
  };
  // Own per-IP limit on starting a flow (every start counts); callback failures count in the shared `failures`.
  const googleStarts = new FailureWindow(10);
  const googleRoute = (req: IncomingMessage, res: ServerResponse, url: URL, route: string): void => {
    const g = deps.google;
    req.resume();
    if (!g || (route !== 'start' && route !== 'callback')) return sendJson(res, 404, { error: tr('not found') });
    if (req.method !== 'GET') return sendJson(res, 405, { error: tr('method not allowed') }, { Allow: 'GET' });
    const ip = clientIp(req, !!deps.domain);
    const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
    const oauthCookie = (v: string, maxAge: number) => `${GOOGLE_COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
    // Only a navigation from our own login page may start a flow; the 403 is neither counted nor sets a cookie.
    const site = req.headers['sec-fetch-site'];
    if (route === 'start' && site !== undefined && site !== 'same-origin' && site !== 'none') return sendJson(res, 403, { error: tr('cross-site request refused') });
    const wait = route === 'start' ? googleStarts.retryAfter(ip) : failures.retryAfter(ip);
    if (wait > 0) {
      if (route === 'callback' && failures.noteBlocked(ip)) deps.log?.warn(tr('Remote sign-in blocked ({0}) from {1}, {2}', ['google', ip, ua]));
      return sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [wait]) }, { 'Retry-After': String(wait) });
    }
    if (route === 'start') {
      googleStarts.fail(ip);
      const { location, cookie } = g.start();
      res.writeHead(302, { Location: location, 'Set-Cookie': oauthCookie(cookie, GOOGLE_COOKIE_S), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return void res.end();
    }
    const q = url.searchParams;
    const clear = oauthCookie('', 0); // single use: gone whatever happens next
    g.finish({ code: q.get('code') ?? undefined, state: q.get('state') ?? undefined, error: q.get('error') ?? undefined }, readCookie(req.headers.cookie, GOOGLE_COOKIE))
      .catch(() => ({ ok: false as const, reason: 'internal', count: true }))
      .then((r) => {
        if (!r.ok) {
          // GET callbacks can be fired by any page the owner visits: only a failure after the signed state cookie was
          // verified (the owner's own flow) counts, or a stranger could burn the owner's shared IP window.
          if (r.count) failures.fail(ip);
          deps.log?.warn(tr('Remote sign-in failed (google: {0}) from {1}, {2}', [r.reason, ip, ua]));
          return void res.writeHead(302, { Location: '/login?e=google', 'Set-Cookie': clear, 'Cache-Control': 'no-store' }).end();
        }
        failures.clear(ip);
        deps.log?.info(tr('Remote sign-in ok (google, {0}) from {1}, {2}', [maskEmail(r.email), ip, ua]));
        const { token, maxAgeS } = deps.sessions.issue(SESSION_MS, isOwnerEmail(r.email));
        res.writeHead(302, { Location: '/', 'Set-Cookie': [cookieHeader(token, maxAgeS, deps.secure), clear], 'Cache-Control': 'no-store' }).end();
      });
  };
  const ssoRoute = (req: IncomingMessage, res: ServerResponse, url: URL, sso: NonNullable<RemoteGateDeps['sso']>): void => {
    const ip = clientIp(req, !!deps.domain);
    const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    const bad = (reason: string, count = true) => {
      if (count) failures.fail(ip);
      deps.log?.warn(tr('Remote sign-in failed (ld: {0}) from {1}, {2}', [reason, ip, ua]));
      res.writeHead(302, { Location: '/login?e=sso', ...headers }).end();
    };
    req.resume();
    // Only a navigation (the portal iframe is same-site) may spend the shared IP window: an <img>/fetch from any page gets a free 403.
    const site = req.headers['sec-fetch-site'];
    if (req.headers['sec-fetch-mode'] !== 'navigate' || (site !== undefined && site !== 'same-origin' && site !== 'same-site')) return sendJson(res, 403, { error: tr('cross-site request refused') });
    const ticket = url.searchParams.get('ticket') ?? '';
    if (failures.retryAfter(ip) > 0) {
      if (failures.noteBlocked(ip)) deps.log?.warn(tr('Remote sign-in blocked ({0}) from {1}, {2}', ['ld', ip, ua]));
      return void res.writeHead(302, { Location: '/login?e=sso', ...headers }).end();
    }
    if (!TICKET.test(ticket)) return bad('ticket');
    fetch(`${sso.url}/api/v1/integrations/hub/consume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sso.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
      redirect: 'manual',
      signal: AbortSignal.timeout(sso.timeoutMs ?? 3000),
    }).then(
      async (r) => {
        if (r.status !== 200) { void r.body?.cancel(); return bad(`status ${r.status}`); }
        const who = (await r.json().catch(() => ({}))) as { email?: unknown; owner?: unknown };
        failures.clear(ip);
        deps.log?.info(tr('Remote sign-in ok ({0}) from {1}, {2}', ['ld', ip, ua]));
        // 12 h, never recent(): a granted viewer must not manage credentials, and a revoked LD grant lapses soon.
        // Owner only when LD says so AND the email is the configured owner's (either alone is not enough).
        const { token, maxAgeS } = deps.sessions.issue(SSO_SESSION_MS, who.owner === true && isOwnerEmail(who.email));
        res.writeHead(302, { Location: '/', 'Set-Cookie': cookieHeader(token, maxAgeS, deps.secure), ...headers }).end();
      },
      () => bad('unreachable', false), // LD down is not the user's fault
    );
  };
  return (req, res, url) => {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (deps.domain && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && req.headers.origin !== `https://${deps.domain}`) {
      req.resume();
      sendJson(res, 403, { error: tr('cross-site request refused') });
      return true;
    }
    const session = deps.sessions.info(readCookie(req.headers.cookie, cname));
    const authed = !!session;

    if (path === '/api/remote/login') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: tr('method not allowed') }, { Allow: 'POST' });
        return true;
      }
      if (passwordOff()) {
        req.resume();
        sendJson(res, 403, { error: tr('Password sign-in is off while a passkey is registered: use your passkey.') });
        return true;
      }
      const tooMany = () => {
        const wait = Math.max(1, throttle.retryAfter());
        sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [wait]) }, { 'Retry-After': String(wait) });
      };
      const ip = clientIp(req, !!deps.domain);
      const ua = (req.headers['user-agent'] ?? '-').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '-';
      const ipWait = failures.retryAfter(ip);
      if (ipWait > 0 || throttle.retryAfter() > 0) {
        req.resume();
        if (ipWait > 0 && failures.noteBlocked(ip)) deps.log?.warn(tr('Remote sign-in blocked ({0}) from {1}, {2}', ['password', ip, ua]));
        if (ipWait > 0) sendJson(res, 429, { error: tr('Too many attempts. Try again in {0} s.', [ipWait]) }, { 'Retry-After': String(ipWait) });
        else tooMany();
        return true;
      }
      // The attempt only begins (and holds the throttle) with full body in hand: an endless body will not block
      // anyone else's login.
      let begun = false;
      let ok = false;
      readBody(req)
        .then(async (raw) => {
          if (!throttle.begin()) return tooMany();
          begun = true;
          let body: { user?: unknown; password?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            // invalid body: falls into rejection below
          }
          const user = typeof body.user === 'string' ? body.user : '';
          const password = typeof body.password === 'string' ? body.password : '';
          // scrypt always runs (no shortcut revealing whether username or password failed).
          const okPassword = await verify(password, deps.config.passwordHash);
          const okUser = safeEqual(user.trim(), deps.config.user);
          if (!(okUser && okPassword)) {
            failures.fail(ip);
            deps.log?.warn(tr('Remote sign-in failed ({0}) from {1}, {2}', ['password', ip, ua]));
            return sendJson(res, 401, { error: tr('Incorrect username or password.') });
          }
          ok = true;
          failures.clear(ip);
          deps.log?.info(tr('Remote sign-in ok ({0}) from {1}, {2}', ['password', ip, ua]));
          const { token, maxAgeS } = deps.sessions.issue(SESSION_MS, !!deps.ownerEmail);
          sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, maxAgeS, deps.secure) });
        })
        .catch(() => {
          if (!res.headersSent) sendJson(res, 400, { error: tr('invalid request') });
        })
        .finally(() => {
          if (begun) throttle.end(ok);
        });
      return true;
    }

    if (path === '/api/remote/passkeys' || path.startsWith('/api/remote/passkeys/')) {
      passkeyRoute(req, res, path.slice('/api/remote/passkeys'.length), authed);
      return true;
    }

    if (path.startsWith('/api/remote/stepup/')) {
      stepupRoute(req, res, path.slice('/api/remote/stepup'.length), session);
      return true;
    }

    if (path.startsWith('/api/remote/google/')) {
      googleRoute(req, res, url, path.slice('/api/remote/google/'.length));
      return true;
    }

    if (path === '/api/remote/logout') {
      req.resume();
      if (method !== 'POST') sendJson(res, 405, { error: tr('method not allowed') }, { Allow: 'POST' });
      else {
        if (session) deps.ptyAccess?.endSession(sessionKey(session.sig)); // open terminals die with the sign-out
        deps.sessions.revoke(readCookie(req.headers.cookie, cname));
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, deps.secure) });
      }
      return true;
    }

    if (path === CA_PATH) {
      // Public by design: CA certificate only (private key never leaves computer).
      req.resume();
      if (!caAvailable()) sendJson(res, 404, { error: tr('no CA certificate') });
      else {
        const pem = readFileSync(deps.caFile!);
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="habblaud-ca.crt"',
          'Content-Length': pem.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(pem);
      }
      return true;
    }

    if (path === '/api/remote/sso') {
      if (!deps.sso || method !== 'GET') { req.resume(); sendJson(res, 404, { error: tr('not found') }); }
      else ssoRoute(req, res, url, deps.sso);
      return true;
    }

    if (path === '/login') {
      req.resume();
      if (authed) {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
      } else sendHtml(res, loginPage({ caDownload: caAvailable(), passkeys: !!deps.passkeys && deps.passkeys.count() > 0, password: !passwordOff(), caPath: CA_PATH, google: !!deps.google, googleError: url.searchParams.get('e') === 'google', ssoError: url.searchParams.get('e') === 'sso' }), deps.frameAncestor);
      return true;
    }

    if (path === '/remote/security') {
      req.resume();
      // shortcut: LAN mode has no passkeys, so the settings link 404s there; hide it if LAN mode is ever used.
      if (!deps.passkeys) sendJson(res, 404, { error: tr('not found') });
      else if (!authed) { res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); res.end(); }
      else sendHtml(res, securityPage(), deps.frameAncestor);
      return true;
    }

    if (session) {
      remoteRequests.add(req);
      sessionsOfRequests.set(req, session);
      return false;
    }
    // App icon and manifest (Home Screen): public, mobile fetches them before login (and without cookie).
    if ((method === 'GET' || method === 'HEAD') && PUBLIC_STATIC.test(path)) {
      remoteRequests.add(req);
      return false;
    }

    req.resume();
    if (path === '/api' || path.startsWith('/api/')) {
      sendJson(res, 401, { error: tr('sign in: open Habblaud on this port in your browser and enter your username and password') });
    } else {
      res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
      res.end();
    }
    return true;
  };
}

export interface RemoteListener {
  /** Port listener (TCP with HTTPS + redirect, or plain HTTP). */
  server: net.Server;
  close(): void;
}

/**
 * Starts remote port. With HTTPS, a TCP server inspects the first byte of each connection: 0x16 (TLS ClientHello)
 * goes to HTTPS; anything else is HTTP typed without "s" and gets 308 redirect to https://. Certificate reloads
 * automatically when file changes (npm run remote:setup), without disconnecting active clients.
 */
export function startRemoteListener(
  cfg: Pick<RemoteConfig, 'port' | 'host' | 'tls'>,
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  log: { info(m: string): void; warn(m: string): void; error(m: string): void },
  allowedHosts: ReadonlySet<string> = new Set(),
): RemoteListener {
  if (!cfg.tls) {
    const plain = http.createServer(onRequest);
    plain.on('error', (err) => log.error(tr("Remote access: couldn't listen on port {0} ({1}).", [cfg.port, (err as Error).message])));
    plain.listen(cfg.port, cfg.host);
    return { server: plain, close: () => plain.close() };
  }
  const tls = cfg.tls;
  const read = () => ({ key: readFileSync(tls.keyFile), cert: readFileSync(tls.certFile) });
  const secure = https.createServer(read(), onRequest);
  secure.on('tlsClientError', () => {
    // Mobile device not yet trusting the CA closes handshake: normal until certificate is installed.
  });
  const reload = () => {
    try {
      secure.setSecureContext(read());
      log.info(tr('   Remote access: certificate reloaded.'));
    } catch (err) {
      log.warn(tr('   Remote access: new certificate unreadable, keeping the previous one ({0}).', [(err as Error).message]));
    }
  };
  watchFile(tls.certFile, { interval: 15_000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.ino !== prev.ino) reload();
  });
  const redirect = http.createServer((req, res) => {
    const host = req.headers.host;
    req.resume();
    if (!host || !hostAllowed(host, allowedHosts)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${tr('Use https://')}\n`);
      return;
    }
    res.writeHead(308, { Location: `https://${host}${req.url ?? '/'}`, 'Cache-Control': 'no-store' });
    res.end();
  });
  const tcp = net.createServer((socket) => {
    // Connection sending nothing does not hang forever.
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy());
    socket.once('data', (first: Buffer) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(first);
      (first[0] === 0x16 ? secure : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => socket.destroy());
  });
  tcp.on('error', (err) => log.error(tr("Remote access: couldn't listen on port {0} ({1}).", [cfg.port, (err as Error).message])));
  tcp.listen(cfg.port, cfg.host);
  return {
    server: tcp,
    close: () => {
      unwatchFile(tls.certFile);
      tcp.close();
      secure.close();
      redirect.close();
    },
  };
}
