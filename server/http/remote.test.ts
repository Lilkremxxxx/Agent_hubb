import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsService } from '../accounts/service';
import { log, setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler, sendJson } from './app';
import { createPtyRoutes, type RemotePty } from './pty';
import { PtyAccess } from '../remote/ptygrant';
import { PtyError, type PtyManager } from '../pty/manager';
import { createRequestGuard } from './guard';
import {
  clientIp,
  COOKIE,
  createRemoteGate,
  FailureWindow,
  listsHubDomain,
  remoteAllowedHosts,
  isOwnerRequest,
  isRemoteRequest,
  sessionOf as sessionOfRequest,
  isSecureRemote,
  loadSecret,
  LoginThrottle,
  parseAllow,
  parseRemoteConfig,
  readCookie,
  remoteAllows,
  RemoteSessions,
  SESSION_MS,
  type RemoteFeature,
} from './remote';
import type { SessionLookup } from '../sources/source';
import { Hub } from './sse';
import { TerminalStreams } from './terminal';
import * as webauthn from '@simplewebauthn/server';
import { hashPassword, parsePasswordHash, verifyPassword } from '../remote/password';
import { LibLoadError, PasskeyService, PasskeyStore, type WebAuthnLib } from '../remote/passkeys';
import { SpawnService } from '../spawn/spawn';

setQuiet(true);

const SECRET = Buffer.alloc(32, 7);
const PASSWORD = 'correct horse battery';
// logN 10: fast in tests (setup uses 15).
const HASH_TEXT = await hashPassword(PASSWORD, 10);
const CFG = { user: 'ana', passwordHash: parsePasswordHash(HASH_TEXT)!, passwordHashText: HASH_TEXT };
const CREDS = { user: 'ana', password: PASSWORD };
const TLS_FILES = (p: string) => p.endsWith('server.key') || p.endsWith('server.crt');

describe('hub domain and the two guards', () => {
  const reqFor = (host: string) => ({ headers: { host }, method: 'GET', url: '/' }) as never;
  const res = () => { const r = { code: 0, writeHead(c: number) { r.code = c; }, end() {} }; return r; };
  it('the main port (ALLOWED_HOSTS only) refuses Host = the hub domain; the remote port accepts it', () => {
    const allowed = new Set(['casa.lan']);
    const main = createRequestGuard({ allowedHosts: allowed });
    const remote = createRequestGuard({ allowedHosts: remoteAllowedHosts(allowed, 'hub.finstar.pp.ua') });
    const a = res(); expect(main(reqFor('hub.finstar.pp.ua'), a as never)).toBe(true); expect(a.code).toBe(403);
    expect(main(reqFor('casa.lan'), res() as never)).toBe(false);
    expect(remote(reqFor('hub.finstar.pp.ua'), res() as never)).toBe(false);
    expect(remote(reqFor('casa.lan'), res() as never)).toBe(false);
    expect(remote(reqFor('evil.example'), res() as never)).toBe(true);
    expect(allowed.has('hub.finstar.pp.ua')).toBe(false); // the shared set is not mutated
    expect(listsHubDomain(allowed, 'hub.finstar.pp.ua')).toBe(false);
    expect(listsHubDomain(new Set(['casa.lan', 'hub.finstar.pp.ua']), 'hub.finstar.pp.ua')).toBe(true); // old hub.env: the server warns at start
    expect(listsHubDomain(new Set(['hub.finstar.pp.ua']), undefined)).toBe(false);
  });
});

describe('parseRemoteConfig', () => {
  const base = { HABBLAUD_REMOTE_USER: 'ana', HABBLAUD_REMOTE_PASSWORD_HASH: HASH_TEXT };
  it('stays disabled without variables', () => {
    expect(parseRemoteConfig({})).toEqual({});
  });
  it('rejects plaintext password and missing or invalid hash', () => {
    expect(parseRemoteConfig({ HABBLAUD_REMOTE_USER: 'a', HABBLAUD_REMOTE_PASSWORD: '12345678' }).warning).toMatch(/plain-text/);
    expect(parseRemoteConfig({ HABBLAUD_REMOTE_USER: 'a' }).warning).toMatch(/remote:setup/);
    expect(parseRemoteConfig({ HABBLAUD_REMOTE_USER: 'a', HABBLAUD_REMOTE_PASSWORD_HASH: 'scrypt:1:2' }, TLS_FILES).warning).toMatch(/invalid/i);
  });
  it('requires HTTPS: will not start without certificate unless HABBLAUD_REMOTE_INSECURE_HTTP=1', () => {
    expect(parseRemoteConfig(base, () => false).warning).toMatch(/HTTPS is required/);
    const insecure = parseRemoteConfig({ ...base, HABBLAUD_REMOTE_INSECURE_HTTP: '1' }, () => false).config;
    expect(insecure?.tls).toBeUndefined();
  });
  it('starts with defaults: port 4748, view only, certificate in default folder', () => {
    const { config } = parseRemoteConfig({ ...base, HOME: '/h' }, TLS_FILES);
    expect(config).toMatchObject({ port: 4748, host: '0.0.0.0', user: 'ana' });
    expect(config?.tls?.certFile).toBe('/h/.habblaud/remote-tls/server/server.crt');
    expect([...config!.allow]).toEqual([]);
  });
  it('reads HABBLAUD_REMOTE_PORT and HABBLAUD_REMOTE_HOST', () => {
    const env = { ...base, HABBLAUD_REMOTE_PORT: '9999', HABBLAUD_REMOTE_HOST: '10.0.0.1' };
    expect(parseRemoteConfig(env, TLS_FILES).config).toMatchObject({ port: 9999, host: '10.0.0.1' });
  });
  it('HABBLAUD_REMOTE_ALLOW: lists, ignores unknown names, "none" = view only', () => {
    expect([...parseAllow('spawn, Terminal, bogus')]).toEqual(['terminal']);
    expect([...parseAllow('terminal,pty,create')]).toEqual(['terminal']);
    expect([...parseAllow('none')]).toEqual([]);
    expect([...parseAllow('')]).toEqual([]);
    expect([...parseAllow(undefined)]).toEqual([]);
  });
});

describe('behind a proxy', () => {
  const base = { HABBLAUD_REMOTE_USER: 'ana', HABBLAUD_REMOTE_PASSWORD_HASH: HASH_TEXT };
  it('behind a proxy: plain HTTP even with a certificate on disk, loopback by default, refuses a LAN host or a bad domain', () => {
    const env = { ...base, HABBLAUD_REMOTE_DOMAIN: 'Hub.Finstar.pp.ua' };
    const { config } = parseRemoteConfig(env, TLS_FILES);
    expect(config).toMatchObject({ host: '127.0.0.1', port: 4748, domain: 'hub.finstar.pp.ua', passwordLogin: false });
    expect(config?.tls).toBeUndefined();
    expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_HOST: '0.0.0.0' }, TLS_FILES).warning).toMatch(/loopback/);
    expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_HOST: '::1' }, TLS_FILES).config?.host).toBe('::1');
    expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_DOMAIN: 'not a domain' }, TLS_FILES).warning).toMatch(/HABBLAUD_REMOTE_DOMAIN/);
    expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_PASSWORD_LOGIN: '1' }, TLS_FILES).config?.passwordLogin).toBe(true);
    expect(SESSION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('FailureWindow: five failures in ten minutes block that key only, success clears it', () => {
    let now = 0;
    const w = new FailureWindow(5, 600_000, () => now);
    for (let i = 0; i < 5; i++) {
      expect(w.retryAfter('a')).toBe(0);
      w.fail('a');
      now += 10_000;
    }
    expect(w.retryAfter('a')).toBe(550);
    expect(w.retryAfter('b')).toBe(0);
    now += 560_000;
    expect(w.retryAfter('a')).toBe(0);
    w.fail('a');
    w.clear('a');
    expect(w.retryAfter('a')).toBe(0);
  });

  it('behind a proxy: POST needs the exact Origin; five bad passwords from one CF-Connecting-IP give 429 to that IP only; the cookie is Secure, HttpOnly, Lax, 7 days; sign-ins are logged', async () => {
    let now = 1_800_000_000_000;
    const lines: string[] = [];
    const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
    const gate = createRemoteGate({
      config: CFG,
      sessions: new RemoteSessions(SECRET, CFG, () => now),
      secure: true,
      domain: 'hub.finstar.pp.ua',
      failures: new FailureWindow(5, 600_000, () => now),
      throttle: new LoginThrottle(() => now),
      log,
    });
    const server = http.createServer((req, res) => {
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => server.close(() => ok())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const O = { Origin: 'https://hub.finstar.pp.ua' };
    const post = (headers: Record<string, string>, password = PASSWORD) =>
      request(base, '/api/remote/login', { method: 'POST', headers, body: { user: 'ana', password } });
    expect((await post({})).status).toBe(403);
    expect((await post({ Origin: 'http://hub.finstar.pp.ua' })).status).toBe(403);
    expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    const bad = { ...O, 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 5; i++) {
      expect((await post(bad, 'wrong')).status).toBe(401);
      now += 10_000;
    }
    const blocked = await post(bad, 'wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    now += 60_000; // global LoginThrottle backoff is over; the per-IP window is not
    const good = await post({ ...O, 'CF-Connecting-IP': '203.0.113.8' });
    expect(good.status).toBe(200);
    expect(good.headers['set-cookie']?.[0]).toMatch(/HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    expect((await post(bad)).status).toBe(429);
    expect(lines.filter((l) => l.includes('ok (password) from 203.0.113.8'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('failed (password) from 203.0.113.7'))).toHaveLength(5);
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });

  it('one IP failing at the Retry-After cadence cannot keep another IP out for more than the 30 s cap', async () => {
    let now = 1_800_000_000_000;
    const gate = createRemoteGate({
      config: CFG,
      sessions: new RemoteSessions(SECRET, CFG, () => now),
      secure: true,
      domain: 'hub.finstar.pp.ua',
      failures: new FailureWindow(5, 600_000, () => now),
      throttle: new LoginThrottle(() => now, 30),
    });
    const server = http.createServer((req, res) => {
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => server.close(() => ok())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (ip: string, password: string) =>
      request(base, '/api/remote/login', { method: 'POST', headers: { Origin: 'https://hub.finstar.pp.ua', 'CF-Connecting-IP': ip }, body: { user: 'ana', password } });
    const end = now + 3 * 3600_000;
    let last401 = now;
    while (now < end) {
      const r = await post('203.0.113.7', 'wrong');
      if (r.status === 401) last401 = now;
      now += Math.max(1, Number(r.headers['retry-after'] ?? 1)) * 1000;
    }
    now = last401 + 31_000;
    expect((await post('203.0.113.8', PASSWORD)).status).toBe(200);
  });

  it('LoginThrottle: default backoff reaches 300 s, a lower cap holds it', () => {
    let now = 0;
    const a = new LoginThrottle(() => now);
    const b = new LoginThrottle(() => now, 30);
    for (let i = 0; i < 20; i++) { a.fail(); b.fail(); }
    expect(a.retryAfter()).toBe(300);
    expect(b.retryAfter()).toBe(30);
  });

  it('FailureWindow: IPv6 is keyed by its /64, 1000 keys is the ceiling, blocked is noted once per window', () => {
    let now = 0;
    const w = new FailureWindow(2, 600_000, () => now);
    w.fail('2001:db8:1:2:aaaa::1');
    w.fail('2001:db8:1:2:bbbb:0:0:2');
    expect(w.retryAfter('2001:db8:1:2::9')).toBeGreaterThan(0);
    expect(w.retryAfter('2001:db8:1:3::9')).toBe(0);
    expect(w.noteBlocked('2001:db8:1:2::9')).toBe(true);
    expect(w.noteBlocked('2001:db8:1:2::1')).toBe(false);
    now += 600_001;
    expect(w.noteBlocked('2001:db8:1:2::1')).toBe(true);
    const f = new FailureWindow(1, 600_000, () => now);
    for (let i = 0; i < 1005; i++) f.fail(`10.0.${i >> 8}.${i & 255}`);
    expect(f.retryAfter('10.0.0.0')).toBe(0); // oldest evicted
    expect(f.retryAfter('10.0.3.236')).toBeGreaterThan(0);
    expect((f as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(1000);
  });

  it('clientIp: garbage or multi-valued CF-Connecting-IP falls back to the peer; a ::1 peer is loopback', () => {
    const mk = (addr: string, ip?: string) => ({ headers: ip ? { 'cf-connecting-ip': ip } : {}, socket: { remoteAddress: addr } }) as never;
    expect(clientIp(mk('127.0.0.1', '1.2.3.4, 5.6.7.8'), true)).toBe('127.0.0.1');
    expect(clientIp(mk('127.0.0.1', 'evil<script>'), true)).toBe('127.0.0.1');
    expect(clientIp(mk('::1', '2001:db8::1'), true)).toBe('2001:db8::1');
  });

  it('tokens whose expiry is beyond the session length (old 30-day cookies) are rejected', () => {
    let now = 1_800_000_000_000;
    const long = new RemoteSessions(SECRET, CFG, () => now);
    const forged = (() => {
      const exp = now + SESSION_MS + 60_000;
      const payload = `v1.${exp}`;
      return `${payload}.${(long as unknown as { sign(p: string): string }).sign(payload)}`;
    })();
    expect(long.verify(forged)).toBe(false);
    expect(long.verify(long.issue().token)).toBe(true);
  });

  it('proxy mode: cookie Secure follows the domain, not only tls', () => {
    expect(isSecureRemote({ domain: 'hub.finstar.pp.ua' })).toBe(true);
    expect(isSecureRemote({ tls: {} as never })).toBe(true);
    expect(isSecureRemote({})).toBe(false);
  });

  it('proxy mode with the real guard: Host must be in ALLOWED_HOSTS; Origin is needed on logout and DELETE too; 429s are logged once', async () => {
    const lines: string[] = [];
    const mkServer = async (allowed: string[]) => {
      const guard = createRequestGuard({ allowedHosts: new Set(allowed) });
      const gate = createRemoteGate({
        config: CFG,
        sessions: new RemoteSessions(SECRET, CFG),
        secure: true,
        domain: 'hub.finstar.pp.ua',
        failures: new FailureWindow(1, 600_000),
        log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      });
      const server = http.createServer((req, res) => {
        if (guard(req, res)) return;
        if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
      });
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
      closers.push(() => new Promise<void>((ok) => server.close(() => ok())));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const H = { Connection: 'close', Host: 'hub.finstar.pp.ua', Origin: 'https://hub.finstar.pp.ua' };
    const closed = await mkServer([]);
    expect((await request(closed, '/login', { headers: H })).status).toBe(403);
    const open = await mkServer(['hub.finstar.pp.ua']);
    expect((await request(open, '/login', { headers: H })).status).toBe(200);
    for (const method of ['POST', 'DELETE', 'PUT']) {
      const path = method === 'POST' ? '/api/remote/logout' : '/api/x';
      const { Origin: _o, ...noOrigin } = H;
      expect((await request(open, path, { method, headers: { ...noOrigin, 'Content-Type': 'application/json' }, body: {} })).status, method).toBe(403);
    }
    const bad = { ...H, 'CF-Connecting-IP': '203.0.113.9' };
    const post = () => request(open, '/api/remote/login', { method: 'POST', headers: bad, body: { user: 'ana', password: 'x' } });
    expect((await post()).status).toBe(401);
    expect((await post()).status).toBe(429);
    expect((await post()).status).toBe(429);
    expect(lines.filter((l) => l.includes('blocked'))).toHaveLength(1);
  });

  it('clientIp trusts CF-Connecting-IP only behind a proxy and on a loopback connection', () => {
    const mk = (addr: string, ip?: string) => ({ headers: ip ? { 'cf-connecting-ip': ip } : {}, socket: { remoteAddress: addr } }) as never;
    expect(clientIp(mk('127.0.0.1', '1.2.3.4'), true)).toBe('1.2.3.4');
    expect(clientIp(mk('::ffff:127.0.0.1', '1.2.3.4'), true)).toBe('1.2.3.4');
    expect(clientIp(mk('127.0.0.1'), true)).toBe('127.0.0.1');
    expect(clientIp(mk('10.0.0.5', '1.2.3.4'), true)).toBe('10.0.0.5');
    expect(clientIp(mk('127.0.0.1', '1.2.3.4'), false)).toBe('127.0.0.1');
  });
});

describe('RemoteSessions', () => {
  it('accepts own token and rejects tampered, expired, or different password token', () => {
    let now = 1_800_000_000_000;
    const sessions = new RemoteSessions(SECRET, CFG, () => now);
    const { token, maxAgeS } = sessions.issue();
    expect(maxAgeS).toBe(SESSION_MS / 1000);
    expect(sessions.verify(token)).toBe(true);
    expect(sessions.verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(sessions.verify(token.replace(/^v1\.\d+/, `v1.${now + SESSION_MS * 2}`))).toBe(false);
    expect(new RemoteSessions(SECRET, { ...CFG, passwordHashText: 'other-hash' }, () => now).verify(token)).toBe(false);
    expect(sessions.verify(undefined)).toBe(false);
    expect(sessions.verify('junk')).toBe(false);
    now += SESSION_MS + 1;
    expect(sessions.verify(token)).toBe(false);
  });

  it('revoke terminates only that token, and list survives restart', () => {
    const now = 1_800_000_000_000;
    const tmp = tempDir();
    const file = join(tmp.dir, 'data', 'remote-revoked.json');
    const sessions = new RemoteSessions(SECRET, CFG, () => now, file);
    const phone = sessions.issue().token;
    const other = new RemoteSessions(SECRET, CFG, () => now - 1).issue().token;
    sessions.revoke(phone);
    sessions.revoke('junk');
    expect(sessions.verify(phone)).toBe(false);
    expect(sessions.verify(other)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const restarted = new RemoteSessions(SECRET, CFG, () => now, file);
    expect(restarted.verify(phone)).toBe(false);
    expect(restarted.verify(other)).toBe(true);
    tmp.cleanup();
  });

  it('loadSecret creates secret with 600 permissions and reuses it', () => {
    const tmp = tempDir();
    const file = join(tmp.dir, 'data', 'remote-secret');
    const a = loadSecret(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe(a.toString('hex'));
    expect(loadSecret(file).equals(a)).toBe(true);
    tmp.cleanup();
  });
});

describe('LoginThrottle', () => {
  it('allows 4 failures, then waits 1 s, 2 s... and resets on success', () => {
    let now = 0;
    const t = new LoginThrottle(() => now);
    for (let i = 0; i < 4; i++) t.fail();
    expect(t.retryAfter()).toBe(0);
    t.fail();
    expect(t.retryAfter()).toBe(1);
    now += 1000;
    t.fail();
    expect(t.retryAfter()).toBe(2);
    t.succeed();
    expect(t.retryAfter()).toBe(0);
  });

  it('one attempt at a time, counted as failure before checking password', () => {
    let now = 0;
    const t = new LoginThrottle(() => now);
    for (let i = 0; i < 4; i++) {
      expect(t.begin()).toBe(true);
      expect(t.begin()).toBe(false);
      t.end(false);
    }
    // 5th attempt: counted before finish, so 6th waits even while 5th is still checking.
    expect(t.begin()).toBe(true);
    expect(t.retryAfter()).toBe(1);
    t.end(false);
    expect(t.begin()).toBe(false);
    now += 1000;
    expect(t.begin()).toBe(true);
    t.end(true);
    expect(t.retryAfter()).toBe(0);
  });
});

describe('readCookie', () => {
  it('finds cookie by name', () => {
    expect(readCookie('a=1; habblaud_remote=v1.x.y; b=2', COOKIE)).toBe('v1.x.y');
    expect(readCookie(undefined, COOKIE)).toBeUndefined();
  });
});

interface Harness {
  hub: Hub;
  remoteBase: string;
  localBase: string;
  ptyCalls: string[];
  calls: string[];
  close: () => Promise<void>;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** One local port (no login) and one remote (with login), over the SAME API, as in server/index.ts. */
async function start(allow: RemoteFeature[] = []): Promise<Harness> {
  const tmp = tempDir();
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
  const office = new Office({
    names: new NameStore(null),
    version: '9.9.9',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: () => undefined,
  });
  const allowSet = new Set(allow);
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const ptyCalls: string[] = [];
  const calls: string[] = [];
  const spawn = new SpawnService({ opener: async () => ({ ok: true }) });
  // Stubs that record any call: a 403 must come from the gate, never from a missing dep.
  const rec = (name: string) => () => { calls.push(name); throw new Error('must not be reached'); };
  const api = createApiHandler({
    office,
    hub,
    accounts,
    sources: () => [],
    version: '9.9.9',
    terminal: true,
    // Stubs: enough for the terminal and session-history routes to answer once the remote session is allowed.
    terminals: new TerminalStreams({ office, transcriptPathOf: () => undefined, parserFor: () => undefined }),
    sessions: { list: async () => [], resolve: () => ({ ok: false, status: 404, error: 'unknown' }) } as unknown as SessionLookup,
    spawn,
    advisor: { ask: rec('advisor.ask'), wait: rec('advisor.wait') } as never,
    workers: { ask: rec('workers.ask'), waitJob: rec('workers.waitJob'), cancel: rec('workers.cancel') } as never,
    team: { appoint: rec('team.appoint') } as never,
    pty: (req, res, path) => {
      req.resume();
      ptyCalls.push(`${req.method} ${path}`);
      sendJson(res, 200, { ok: true });
    },
    renameRoom: () => 'room',
    remote: { is: isRemoteRequest, allows: (_req, f) => allowSet.has(f) },
  });
  const guard = createRequestGuard();
  const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG), secure: false });
  const page = (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Habblaud</title>');
  };
  const local = http.createServer((req, res) => {
    if (guard(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://x');
    if (!api(req, res, url)) page(req, res);
  });
  const remote = http.createServer((req, res) => {
    if (guard(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://x');
    if (gate(req, res, url)) return;
    if (!api(req, res, url)) page(req, res);
  });
  await new Promise<void>((ok) => local.listen(0, '127.0.0.1', ok));
  await new Promise<void>((ok) => remote.listen(0, '127.0.0.1', ok));
  const close = async () => {
    hub.stop();
    await new Promise<void>((ok) => local.close(() => ok()));
    await new Promise<void>((ok) => remote.close(() => ok()));
    tmp.cleanup();
  };
  closers.push(close);
  return {
    hub,
    localBase: `http://127.0.0.1:${(local.address() as AddressInfo).port}`,
    remoteBase: `http://127.0.0.1:${(remote.address() as AddressInfo).port}`,
    ptyCalls,
    calls,
    close,
  };
}

/** Raw request (Node fetch does not allow changing Host). */
function request(
  base: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(path, base);
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((ok, fail) => {
    const req = http.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', fail);
    req.end(body);
  });
}

async function login(base: string): Promise<string> {
  const r = await request(base, '/api/remote/login', { method: 'POST', body: CREDS });
  expect(r.status).toBe(200);
  const setCookie = r.headers['set-cookie']?.[0] ?? '';
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Lax/);
  return setCookie.split(';')[0];
}

describe('remote port', () => {
  it('logged in: advisor, workers, team, pty and spawn never pass over the remote port, even with Host localhost and --allow terminal', async () => {
    const s = await start(['terminal']);
    const headers = { Cookie: await login(s.remoteBase), Host: 'localhost' };
    const blocked: Array<[string, string, unknown?]> = [
      ['POST', '/api/advisor', { slot: 'W2', question: 'x' }],
      ['GET', '/api/advisor/q1'],
      ['GET', '/api/workers/jobs/w1'],
      ['POST', '/api/workers/cancel', { worker: 'W1' }],
      ['POST', '/api/team', { openBoss: true }],
      ['POST', '/api/spawn', { folder: '/p', prompt: 'hi' }],
      ['GET', '/api/pty'],
      ['POST', '/api/pty/x/input', {}],
      ['POST', '/api/agents/a1/stop', {}],
      ['POST', '/api/agents/a1/takeover', {}],
      ['POST', '/api/rooms/rename', { id: 'r', name: 'n' }],
      ['POST', '/api/agy/jobs', { agentId: 'a1', prompt: 'x', mode: 'plan' }],
      ['POST', '/api/agy/stop', { agentId: 'a1' }],
      ['POST', '/api/agy/defaults', { agentId: 'a1' }],
      ['GET', '/api/accounts'],
      ['POST', '/api/accounts/add', {}],
    ];
    for (const [method, path, body] of blocked) {
      const r = await request(s.remoteBase, path, { method, headers, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect(s.calls).toEqual([]);
    expect(s.ptyCalls).toEqual([]);
    expect(JSON.parse((await request(s.remoteBase, '/api/health', { headers })).body).pty).toBe(false);
    expect(JSON.parse((await request(s.remoteBase, '/api/access', { headers })).body)).toMatchObject({ remote: true, terminal: true, spawn: false });
    // Office-wide effects: phone cannot trigger them.
    expect((await request(s.remoteBase, '/api/fun/party', { method: 'POST', body: { enabled: true }, headers })).status).toBe(403);
    // On local port, the interactive terminal continues as before; the host helper routes are gone.
    expect((await request(s.localBase, '/api/pty')).status).toBe(200);
    expect((await request(s.localBase, '/api/host/spawn/poll', { method: 'POST', body: {} })).status).toBe(404);
    expect((await request(s.localBase, '/api/spawn', { method: 'POST', body: { folder: 'relative', prompt: '' } })).status).toBe(400);
  });

  it('login with partial body does not block anyone else logging in', async () => {
    const s = await start();
    const hanging = http.request(new URL('/api/remote/login', s.remoteBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '200' },
    });
    hanging.on('error', () => {});
    hanging.write('{"user":"ana","pass');
    await new Promise((r) => setTimeout(r, 50));
    await login(s.remoteBase);
    hanging.destroy();
  });

  it('Logout: clears cookie and same token becomes invalid (even if saved in a copy)', async () => {
    const s = await start();
    const cookie = await login(s.remoteBase);
    expect((await request(s.remoteBase, '/api/access', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await request(s.remoteBase, '/api/remote/logout', { headers: { Cookie: cookie } })).status).toBe(405);
    const out = await request(s.remoteBase, '/api/remote/logout', { method: 'POST', body: {}, headers: { Cookie: cookie } });
    expect(out.status).toBe(200);
    expect(out.headers['set-cookie']?.[0]).toMatch(/Max-Age=0/);
    expect((await request(s.remoteBase, '/api/access', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await request(s.remoteBase, '/', { headers: { Cookie: cookie } })).headers.location).toBe('/login');
  });

  it('without login: page redirects to /login and API responds 401', async () => {
    const h = await start();
    const page = await request(h.remoteBase, '/');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/login');
    const loginPage = await request(h.remoteBase, '/login');
    expect(loginPage.status).toBe(200);
    expect(loginPage.body).toContain('/assets/remote/auth.js');
    expect(loginPage.headers['x-frame-options']).toBe('DENY');
    expect((await request(h.remoteBase, '/api/snapshot')).status).toBe(401);
    expect((await request(h.remoteBase, '/api/stream')).status).toBe(401);
    expect((await request(h.remoteBase, '/api/rooms/rename', { method: 'POST', body: { id: 'r', name: 'n' } })).status).toBe(401);
  });

  it('without login: only manifest and icons pass (the rest redirects to /login)', async () => {
    const h = await start();
    for (const path of ['/manifest.webmanifest', '/assets/brand/icon-192.png']) {
      expect((await request(h.remoteBase, path)).status, path).not.toBe(302);
    }
    for (const path of ['/assets/brand/logo-detailed.png', '/assets/brand/signage@4x.png', '/assets/brand/favicon-32.png', '/sw.js', '/manifest.webmanifest.map', '/assets/brand/../index.html', '/assets/app.js']) {
      expect((await request(h.remoteBase, path)).status, path).toBe(302);
    }
  });

  it('wrong password: 401 without cookie; correct: session cookie and API access', async () => {
    const h = await start();
    const wrong = await request(h.remoteBase, '/api/remote/login', { method: 'POST', body: { user: 'ana', password: 'nope nope' } });
    expect(wrong.status).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    const cookie = await login(h.remoteBase);
    expect((await request(h.remoteBase, '/api/snapshot', { headers: { Cookie: cookie } })).status).toBe(200);
    const page = await request(h.remoteBase, '/', { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect((await request(h.remoteBase, '/login', { headers: { Cookie: cookie } })).headers.location).toBe('/');
  });

  it('logged in: health indicates allowed features on this port', async () => {
    const h = await start();
    const cookie = await login(h.remoteBase);
    const health = JSON.parse((await request(h.remoteBase, '/api/health', { headers: { Cookie: cookie } })).body);
    expect(health).toMatchObject({ remote: true, terminal: false });
  });

  it('logged in with Host mocking localhost: still cannot access unallowed features', async () => {
    const h = await start();
    const cookie = await login(h.remoteBase);
    const headers = { Cookie: cookie, Host: 'localhost' };
    for (const [path, body] of [
      ['/api/rooms/rename', { id: 'r', name: 'n' }],
    ] as const) {
      const r = await request(h.remoteBase, path, { method: 'POST', headers, body });
      expect(r.status, path).toBe(403);
      expect(JSON.parse(r.body).error).toMatch(/HABBLAUD_REMOTE_ALLOW/);
    }
    expect((await request(h.remoteBase, '/api/agents/x/terminal', { headers })).status).toBe(403);
    expect((await request(h.remoteBase, '/api/sessions/recent', { headers })).status).toBe(403);
  });

  it('HABBLAUD_REMOTE_ALLOW unset refuses conversation reads; --allow terminal grants them', async () => {
    const unset = await start([...parseAllow(undefined)]);
    const c1 = await login(unset.remoteBase);
    for (const path of ['/api/agents/x/terminal', '/api/sessions/recent']) {
      expect((await request(unset.remoteBase, path, { headers: { Cookie: c1 } })).status, path).toBe(403);
    }
    const granted = await start([...parseAllow('terminal')]);
    const c2 = await login(granted.remoteBase);
    for (const path of ['/api/agents/x/terminal', '/api/sessions/recent']) {
      expect((await request(granted.remoteBase, path, { headers: { Cookie: c2 } })).status, path).not.toBe(403);
    }
  });

  it('HABBLAUD_REMOTE_ALLOW=spawn is ignored and "none" leaves the phone view-only', async () => {
    const viewOnly = await start([]);
    const c2 = await login(viewOnly.remoteBase);
    expect(JSON.parse((await request(viewOnly.remoteBase, '/api/access', { headers: { Cookie: c2 } })).body).spawn).toBe(false);
    expect((await request(viewOnly.remoteBase, '/api/spawn', { method: 'POST', headers: { Cookie: c2 }, body: {} })).status).toBe(403);
    expect((await request(viewOnly.remoteBase, '/api/snapshot', { headers: { Cookie: c2 } })).status).toBe(200);
  });

  it('login from another origin is blocked by guard (CSRF)', async () => {
    const h = await start();
    const r = await request(h.remoteBase, '/api/remote/login', { method: 'POST', headers: { Origin: 'http://evil.example' }, body: CREDS });
    expect(r.status).toBe(403);
  });
});

describe('Google routes are not on the main port', () => {
  it('port 4747 api() has no /api/remote/google/* route: 404 on any loopback Host, and the guard refuses the hub domain', async () => {
    const s = await start();
    for (const p of ['/api/remote/google/start', '/api/remote/google/callback?code=a&state=b']) {
      for (const host of ['localhost', '127.0.0.1']) {
        const r = await request(s.localBase, p, { headers: { Host: host } });
        expect([r.status, r.headers.location, r.headers['set-cookie']]).toEqual([404, undefined, undefined]);
      }
      expect((await request(s.localBase, p, { headers: { Host: 'hub.finstar.pp.ua' } })).status).toBe(403);
    }
  });
});

describe('GET /api/remote/sso (LD ticket sign-in)', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.9' };
  const T = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12345';
  let ldCalls: Array<{ auth?: string; body: string; method?: string; url?: string }> = [];
  let lines: string[] = [];
  async function mk(o: { ld?: (res: http.ServerResponse) => void; sso?: boolean; limit?: number; passkeys?: boolean } = {}) {
    ldCalls = []; lines = [];
    const ld = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        ldCalls.push({ auth: req.headers.authorization, body: Buffer.concat(chunks).toString(), method: req.method, url: req.url });
        (o.ld ?? ((r) => { r.writeHead(200, { 'Content-Type': 'application/json' }).end('{"email":"a@b.c","name":"A"}'); }))(res);
      });
    });
    await new Promise<void>((ok) => ld.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => { ld.closeAllConnections(); ld.close(() => ok()); }));
    const sso = o.sso === false ? undefined : { url: `http://127.0.0.1:${(ld.address() as AddressInfo).port}`, secret: 'ld-secret-xyz', timeoutMs: 300 };
    const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG), secure: true, domain: DOMAIN, sso, passkeys: o.passkeys ? ({ count: () => 0, list: () => [] } as unknown as PasskeyService) : undefined, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) }, failures: new FailureWindow(o.limit ?? 5, 600_000) });
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const NAV = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-site' };
  const sso = (b: string, t = T, extra: Record<string, string> = NAV) => request(b, `/api/remote/sso?ticket=${t}`, { headers: { ...H, ...extra } });

  it('success: asks LD with the bearer secret, sets the session cookie, 302 /', async () => {
    const r = await sso(await mk());
    expect([r.status, r.headers.location, r.headers['cache-control'], r.headers['referrer-policy']]).toEqual([302, '/', 'no-store', 'no-referrer']);
    expect(r.headers['set-cookie']?.[0]).toMatch(/^__Host-habblaud_remote=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);
    expect(ldCalls).toEqual([{ auth: 'Bearer ld-secret-xyz', body: JSON.stringify({ ticket: T }), method: 'POST', url: '/api/v1/integrations/hub/consume' }]);
    expect(lines.join('\n')).not.toMatch(new RegExp(`${T}|ld-secret-xyz`));
  });

  it('LD 401, LD timeout and LD redirect all end at /login?e=sso without a cookie', async () => {
    for (const ld of [(r: http.ServerResponse) => r.writeHead(401).end('{}'), () => {}, (r: http.ServerResponse) => r.writeHead(302, { Location: '/x' }).end()]) {
      const r = await sso(await mk({ ld }));
      expect([r.status, r.headers.location, r.headers['set-cookie']]).toEqual([302, '/login?e=sso', undefined]);
    }
    expect(lines.join('\n')).not.toMatch(new RegExp(`${T}|ld-secret-xyz`));
  });

  it('a bad ticket shape never reaches LD', async () => {
    const b = await mk();
    for (const t of ['x', 'a'.repeat(101), 'abc%20def' + 'a'.repeat(20), '']) {
      const r = await sso(b, t);
      expect([r.status, r.headers.location]).toEqual([302, '/login?e=sso']);
    }
    expect(ldCalls).toHaveLength(0);
  });

  it('without LD_SSO_SECRET/LD_INTERNAL_URL the route is a 404', async () => {
    expect((await sso(await mk({ sso: false }))).status).toBe(404);
  });

  it('failures count in the per-IP limiter, then LD is not asked any more; success clears', async () => {
    const b = await mk({ ld: (r) => r.writeHead(401).end('{}'), limit: 3 });
    for (let i = 0; i < 3; i++) await sso(b);
    expect(ldCalls).toHaveLength(3);
    expect((await sso(b)).headers.location).toBe('/login?e=sso');
    expect(ldCalls).toHaveLength(3);
  });

  it('SSO session is view-only: it can never register or delete passkeys', async () => {
    const b = await mk({ passkeys: true });
    const cookie = (await sso(b)).headers['set-cookie']?.[0].split(';')[0] ?? '';
    for (const [path, body] of [['/api/remote/passkeys/register/options', {}], ['/api/remote/passkeys/register/verify', { response: {} }], ['/api/remote/passkeys/delete', { id: 'x' }]] as const) {
      expect((await request(b, path, { method: 'POST', headers: { ...H, Cookie: cookie }, body })).status, path).toBe(403);
    }
    expect((await request(b, '/api/remote/passkeys', { headers: { ...H, Cookie: cookie } })).status).toBe(200);
  });

  it('only a navigation counts: no sec-fetch-*, subresource modes or cross-site get 403, never reach LD, never burn the IP window', async () => {
    const b = await mk({ ld: (r) => r.writeHead(401).end('{}'), limit: 2 });
    for (const extra of [{} as Record<string, string>, { 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Mode': 'cors' }]) {
      for (let i = 0; i < 3; i++) expect((await sso(b, 'x', extra)).status).toBe(403);
    }
    expect(ldCalls).toHaveLength(0);
    expect((await sso(b)).headers.location).toBe('/login?e=sso'); // window still empty: LD is asked
    expect(ldCalls).toHaveLength(1);
    expect((await sso(b, T, { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin' })).status).toBe(302);
  });

  it('LD unreachable is not counted, a genuine LD 401 is, and a blocked IP is logged', async () => {
    const down = await mk({ ld: () => {}, limit: 2 });
    for (let i = 0; i < 4; i++) await sso(down);
    expect(ldCalls).toHaveLength(4);
    const b = await mk({ ld: (r) => r.writeHead(401).end('{}'), limit: 2 });
    for (let i = 0; i < 3; i++) await sso(b);
    expect(ldCalls).toHaveLength(2);
    expect(lines.some((l) => l.includes('blocked'))).toBe(true);
  });

  it('login page shows a message for e=sso', async () => {
    const page = await request(await mk(), '/login?e=sso', { headers: H });
    expect(page.body).toMatch(/id="err"[^>]*>[^<]+</);
  });

  it('port 4747 has no /api/remote/sso route', async () => {
    const s = await start();
    for (const host of ['localhost', '127.0.0.1']) expect((await request(s.localBase, `/api/remote/sso?ticket=${T}`, { headers: { Host: host } })).status).toBe(404);
  });
});

describe('local port (unaltered)', () => {
  it('without login, local Host lock applies as before', async () => {
    const h = await start();
    const spawnBody = { folder: 'relative', prompt: '' };
    expect((await request(h.localBase, '/api/spawn', { method: 'POST', body: spawnBody })).status).toBe(400);
    const lanHost = await request(h.localBase, '/api/spawn', { method: 'POST', headers: { Host: '192.168.1.5:4747' }, body: spawnBody });
    expect(lanHost.status).toBe(403);
    expect(JSON.parse(lanHost.body).error).toMatch(/computer running Habblaud/);
    const health = JSON.parse((await request(h.localBase, '/api/health')).body);
    expect(health).toMatchObject({ remote: false });
  });
});

describe('GET /api/access (what the page can do)', () => {
  it('remote port: allowed only; local port: everything via local Host; network Host on local: nothing', async () => {
    const h = await start([]);
    const cookie = await login(h.remoteBase);
    expect(JSON.parse((await request(h.remoteBase, '/api/access', { headers: { Cookie: cookie, Host: 'localhost' } })).body)).toEqual({
      remote: true,
      local: false,
      terminal: false,
      spawn: false,
      ptyStepUp: false,
    });
    expect(JSON.parse((await request(h.localBase, '/api/access')).body)).toEqual({ remote: false, local: true, terminal: true, spawn: true });
    expect(JSON.parse((await request(h.localBase, '/api/access', { headers: { Host: '192.168.1.5:4747' } })).body)).toMatchObject({
      local: false,
      spawn: false,
    });
    expect((await request(h.remoteBase, '/api/access')).status).toBe(401);
  });
});

describe('Secure cookie and CA download', () => {
  it('with HTTPS cookie has Secure; /remote/ca.crt is public and only exists with CA', async () => {
    const tmp = tempDir();
    const caFile = join(tmp.dir, 'ca.crt');
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG), secure: true, caFile });
    const server = http.createServer((req, res) => {
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(async () => {
      await new Promise<void>((ok) => server.close(() => ok()));
      tmp.cleanup();
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await request(base, '/api/remote/login', { method: 'POST', body: CREDS });
    expect(r.headers['set-cookie']?.[0]).toMatch(/; Secure$/);
    expect((await request(base, '/remote/ca.crt')).status).toBe(404);
    expect((await request(base, '/login')).body).not.toContain('/remote/ca.crt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
    const ca = await request(base, '/remote/ca.crt');
    expect(ca.status).toBe(200);
    expect(ca.headers['content-type']).toBe('application/x-x509-ca-cert');
    expect((await request(base, '/login')).body).toContain('/remote/ca.crt');
  });
});

describe('passkey routes', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.7', 'Sec-Fetch-Site': 'same-origin' };
  let verifyCalls = 0;
  let pwCalls = 0;
  let clock = Date.now();
  let lines: string[] = [];
  const lib = (ok = true): WebAuthnLib => ({
    ...webauthn,
    verifyRegistrationResponse: (async () => ({ verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 } } })) as never,
    verifyAuthenticationResponse: (async () => { verifyCalls++; return { verified: ok, authenticationInfo: { newCounter: 1 } }; }) as never,
  });
  async function mk(o: { passkeys?: boolean; ok?: boolean; passwordLogin?: boolean; limit?: number; service?: unknown; frameAncestor?: string; noOwner?: boolean } = {}) {
    const tmp = tempDir();
    verifyCalls = 0; pwCalls = 0; clock = Date.now(); lines = [];
    const passkeys = (o.service as PasskeyService | undefined) ?? (o.passkeys === false ? undefined : new PasskeyService({ domain: DOMAIN, user: 'ana', store: new PasskeyStore(join(tmp.dir, 'pk.json')), lib: lib(o.ok) }));
    const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, { ...CFG, ownerEmail: 'owner@example.com' }, () => clock), secure: true, domain: DOMAIN, passkeys, ownerEmail: o.noOwner ? undefined : 'owner@example.com', ptyAccess: new PtyAccess(), passwordLogin: o.passwordLogin, frameAncestor: o.frameAncestor, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) }, verify: (pw, h) => { pwCalls++; return verifyPassword(pw, h); }, failures: new FailureWindow(o.limit ?? 5, 600_000) });
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => server.close(() => { tmp.cleanup(); ok(); })));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const post = (b: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) => request(b, path, { method: 'POST', headers: { ...H, ...headers }, body });
  const pwCookie = async (b: string) => (await post(b, '/api/remote/login', CREDS)).headers['set-cookie']?.[0].split(';')[0] ?? '';
  /** A step-up grant for a passkey change (fake library: any stored credential id verifies). */
  const grantFor = async (b: string, cookie: string, action: string) => {
    const o = await post(b, '/api/remote/stepup/options', {}, { Cookie: cookie });
    expect(o.status).toBe(200);
    const v = await post(b, '/api/remote/stepup/verify', { response: { id: 'cred-1' }, action }, { Cookie: cookie });
    expect(v.status).toBe(200);
    return JSON.parse(v.body).grant as string;
  };
  const register = async (b: string, cookie: string) => {
    await post(b, '/api/remote/passkeys/register/options', {}, { Cookie: cookie });
    return (await post(b, '/api/remote/passkeys/register/verify', { response: { id: 'cred-1' }, name: 'Phone' }, { Cookie: cookie })).status;
  };

  it('a full challenge map answers 429 with Retry-After = the challenge TTL (120 s)', async () => {
    const b = await mk({ service: { count: () => 0, list: () => [], loginOptions: async () => null } });
    const r = await post(b, '/api/remote/passkeys/login/options');
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('120');
  });

  it('a passkey library that cannot load is logged once ("passkey library could not load"), without a stack, and answers 400', async () => {
    const b = await mk({ service: { count: () => 0, list: () => [], loginOptions: async () => { throw new LibLoadError('x'); } } });
    for (let i = 0; i < 3; i++) expect((await post(b, '/api/remote/passkeys/login/options')).status).toBe(400);
    expect(lines.filter((l) => l === 'passkey library could not load')).toHaveLength(1);
  });

  it('options are public, registration needs a session, verify signs in with a __Host- Secure Lax cookie', async () => {
    const b = await mk();
    expect((await post(b, '/api/remote/passkeys/login/options')).status).toBe(200);
    expect((await request(b, '/api/remote/passkeys', { headers: H })).status).toBe(401);
    expect((await post(b, '/api/remote/passkeys/register/options')).status).toBe(401);
    expect((await post(b, '/api/remote/passkeys/register/verify', { response: {} })).status).toBe(401);
    const cookie = await pwCookie(b);
    expect(cookie).toMatch(/^__Host-habblaud_remote=/);
    const C = { Cookie: cookie };
    expect((await post(b, '/api/remote/passkeys/register/options', {}, C)).status).toBe(200);
    const reg = await post(b, '/api/remote/passkeys/register/verify', { response: { id: 'cred-1' }, name: 'Phone' }, C);
    // fake verify ignores the challenge, so this passes; the challenge itself is covered in passkeys.test.ts
    expect(reg.status).toBe(200);
    expect(JSON.parse((await request(b, '/api/remote/passkeys', { headers: { ...H, ...C } })).body).passkeys).toHaveLength(1);
    const v = await post(b, '/api/remote/passkeys/login/verify', { id: 'cred-1' });
    expect(v.status).toBe(200);
    expect(v.headers['set-cookie']?.[0]).toMatch(/^__Host-habblaud_remote=.*SameSite=Lax.*Secure/);
    // the last passkey cannot be removed over the remote port, grant or not
    expect((await post(b, '/api/remote/passkeys/delete', { id: 'cred-1', grant: await grantFor(b, C.Cookie, 'passkey:del') }, C)).status).toBe(403);
    expect(JSON.parse((await request(b, '/api/remote/passkeys', { headers: { ...H, ...C } })).body).passkeys).toHaveLength(1);
  });

  it('state-changing routes need the Origin and a JSON body; bad body is 400; wrong method 405', async () => {
    const b = await mk();
    const { Origin: _o, ...noOrigin } = H;
    expect((await request(b, '/api/remote/passkeys/login/options', { method: 'POST', headers: noOrigin, body: {} })).status).toBe(403);
    expect((await request(b, '/api/remote/passkeys/login/options', { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: undefined })).status).toBe(415);
    const raw = await new Promise<number>((ok, fail) => {
      const r = http.request(new URL('/api/remote/passkeys/login/verify', b), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      r.on('error', fail);
      r.end('{nope');
    });
    expect(raw).toBe(400);
    expect((await request(b, '/api/remote/passkeys/login/options', { headers: H })).status).toBe(405);
  });

  it('the login script and the logo load before sign-in; /remote/security needs a session', async () => {
    const b = await mk();
    for (const path of ['/assets/remote/auth.js', '/assets/brand/finstar-144.png']) expect((await request(b, path, { headers: H })).status, path).toBe(204);
    const anon = await request(b, '/remote/security', { headers: H });
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe('/login');
    const page = await request(b, '/remote/security', { headers: { ...H, Cookie: await pwCookie(b) } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('data-page="security"');
    expect((await request(await mk({ passkeys: false }), '/remote/security', { headers: { ...H, Cookie: '' } })).status).toBe(404);
  });

  it('frameAncestor: login page may be framed by that origin only, with no X-Frame-Options', async () => {
    const page = await request(await mk({ frameAncestor: 'https://home.finstar.pp.ua' }), '/login', { headers: H });
    expect(page.headers['content-security-policy']).toMatch(/; frame-ancestors https:\/\/home\.finstar\.pp\.ua$/);
    expect(page.headers['x-frame-options']).toBeUndefined();
  });

  it('login page: CSP header, no passkey button until one exists, password never read from the URL', async () => {
    const b = await mk();
    const page = await request(b, '/login', { headers: H });
    expect(page.headers['content-security-policy']).toBe("default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    expect(page.body).not.toContain('id="pk"');
    expect(page.body).toMatch(/<form[^>]*method="post"/);
    const native = await request(b, '/login?username=ana&password=secret', { method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(native.status).toBe(200);
    expect(native.body).not.toContain('secret');
    await post(b, '/api/remote/passkeys/register/options', {}, { Cookie: await pwCookie(b) });
    await post(b, '/api/remote/passkeys/register/verify', { response: { id: 'cred-1' } }, { Cookie: await pwCookie(b) });
    expect((await request(b, '/login', { headers: H })).body).toContain('id="pk"');
  });

  it('a registered passkey turns password sign-in off (403, scrypt not run) unless HABBLAUD_REMOTE_PASSWORD_LOGIN=1; /login hides the form', async () => {
    for (const passwordLogin of [false, true]) {
      const b = await mk({ passwordLogin });
      const cookie = await pwCookie(b);
      expect(cookie).not.toBe('');
      await post(b, '/api/remote/passkeys/register/options', {}, { Cookie: cookie });
      await post(b, '/api/remote/passkeys/register/verify', { response: { id: 'cred-1' } }, { Cookie: cookie });
      const before = pwCalls;
      const r = await post(b, '/api/remote/login', CREDS);
      expect(r.status).toBe(passwordLogin ? 200 : 403);
      expect(pwCalls).toBe(passwordLogin ? before + 1 : before); // scrypt not run on the 403
      const page = await request(b, '/login', { headers: H });
      expect(page.body.includes('id="p"')).toBe(passwordLogin);
    }
  });

  it('failed passkey sign-ins hit the per-IP window only (password sign-in elsewhere keeps working); without a domain every route is 404', async () => {
    const b = await mk({ ok: false, limit: 3 });
    for (let i = 0; i < 3; i++) await post(b, '/api/remote/passkeys/register/options'); // no-ops, unauthenticated
    await post(b, '/api/remote/passkeys/login/options');
    // 'cred-1' is not stored, so verifyLogin is false without calling the library: still counts as a failure
    for (let i = 0; i < 3; i++) expect((await post(b, '/api/remote/passkeys/login/verify', { id: 'cred-1' })).status).toBe(401);
    expect((await post(b, '/api/remote/passkeys/login/verify', { id: 'cred-1' })).status).toBe(429);
    expect((await post(b, '/api/remote/passkeys/login/options')).status).toBe(429);
    expect((await post(b, '/api/remote/passkeys/login/options', {}, { 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(200);
    expect((await post(b, '/api/remote/login', CREDS, { 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(200);
    const none = await mk({ passkeys: false });
    expect((await post(none, '/api/remote/passkeys/login/options')).status).toBe(404);
  });

  it('register and delete need a RECENT sign-in (10 min), refusals and successes are logged', async () => {
    const b = await mk();
    const old = await pwCookie(b);
    clock += 11 * 60_000;
    const C = { Cookie: old };
    for (const [path, body] of [['/api/remote/passkeys/register/options', {}], ['/api/remote/passkeys/register/verify', { response: {} }], ['/api/remote/passkeys/delete', { id: 'x' }]] as const) {
      const r = await post(b, path, body, C);
      expect(r.status, path).toBe(403);
      expect(r.body).toContain('sign in again');
    }
    expect((await request(b, '/api/remote/passkeys', { headers: { ...H, ...C } })).status).toBe(200); // reading is fine
    expect(lines.some((l) => l.includes('refused'))).toBe(true);
    const fresh = { Cookie: await pwCookie(b) };
    await post(b, '/api/remote/passkeys/register/options', {}, fresh);
    expect((await post(b, '/api/remote/passkeys/register/verify', { response: { id: 'cred-1' } }, fresh)).status).toBe(200);
    expect(lines.some((l) => l.includes('registered'))).toBe(true);
  });

  it('delete without a session is 401; both options routes accept an empty body; an over-limit body is cut off', async () => {
    const b = await mk();
    expect((await post(b, '/api/remote/passkeys/delete', { id: 'x' })).status).toBe(401);
    const empty = (path: string, cookie?: string) => new Promise<number>((ok, fail) => {
      const r = http.request(new URL(path, b), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
      r.on('error', fail);
      r.end();
    });
    expect(await empty('/api/remote/passkeys/login/options')).toBe(200);
    expect(await empty('/api/remote/passkeys/register/options', await pwCookie(b))).toBe(200);
    const big = await new Promise<string>((ok) => {
      const r = http.request(new URL('/api/remote/passkeys/login/verify', b), { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' } }, (res) => { res.resume(); ok(`status ${res.statusCode}`); });
      r.on('error', () => ok('closed'));
      r.end('{"a":"' + 'x'.repeat(200_000) + '"}');
    });
    expect(big).not.toBe('status 200');
  });
});

describe('passkey changes need a step-up once a passkey exists', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.7', 'Sec-Fetch-Site': 'same-origin' };
  let clock = Date.now();
  async function mk(o: { noOwner?: boolean; corrupt?: boolean } = {}) {
    const tmp = tempDir();
    clock = Date.now();
    const lib: WebAuthnLib = {
      ...webauthn,
      verifyRegistrationResponse: (async (o: { response?: { id?: string } }) => ({ verified: true, registrationInfo: { credential: { id: o.response?.id ?? 'cred-1', publicKey: new Uint8Array([1]), counter: 0 } } })) as never,
      verifyAuthenticationResponse: (async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })) as never,
    };
    if (o.corrupt) { mkdirSync(tmp.dir, { recursive: true }); writeFileSync(join(tmp.dir, 'pk.json'), '{not json'); }
    const passkeys = new PasskeyService({ domain: DOMAIN, user: 'ana', store: new PasskeyStore(join(tmp.dir, 'pk.json')), lib });
    const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, { ...CFG, ownerEmail: 'owner@example.com' }, () => clock), secure: true, domain: DOMAIN, passkeys, ownerEmail: o.noOwner ? undefined : 'owner@example.com', ptyAccess: new PtyAccess(), passwordLogin: true, failures: new FailureWindow(50, 600_000) });
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => server.close(() => { tmp.cleanup(); ok(); })));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const post = (b: string, path: string, c: string, body: unknown = {}) => request(b, path, { method: 'POST', headers: { ...H, Cookie: c }, body });
  const login = async (b: string) => { clock += 1; return (await request(b, '/api/remote/login', { method: 'POST', headers: H, body: CREDS })).headers['set-cookie']?.[0].split(';')[0] ?? ''; };
  const grant = async (b: string, c: string, action: string) => {
    expect((await post(b, '/api/remote/stepup/options', c)).status).toBe(200);
    const v = await post(b, '/api/remote/stepup/verify', c, { response: { id: 'cred-1' }, action });
    expect(v.status).toBe(200);
    return JSON.parse(v.body).grant as string;
  };
  /** Bootstraps the first passkey (count 0: recent owner is enough). */
  const bootstrap = async (b: string) => {
    const c = await login(b);
    expect((await post(b, '/api/remote/passkeys/register/options', c)).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/verify', c, { response: { id: 'cred-1' }, name: 'P' })).status).toBe(200);
  };
  /** A second passkey (needs a grant now), so the first can be deleted. */
  const addSecond = async (b: string, c: string) => {
    expect((await post(b, '/api/remote/passkeys/register/options', c, { grant: await grant(b, c, 'passkey:add') })).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/verify', c, { response: { id: 'cred-2' }, name: 'Q' })).status).toBe(200);
  };

  it('count 0: a recent owner bootstraps the first passkey without a grant', async () => {
    await bootstrap(await mk());
  });

  it('register: no grant is 403; a grant works once; a reused grant and another session\'s grant are 403', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b), B = await login(b);
    expect((await post(b, '/api/remote/passkeys/register/options', A)).status).toBe(403);
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: 'junk' })).status).toBe(403);
    const g = await grant(b, A, 'passkey:add');
    expect((await post(b, '/api/remote/passkeys/register/options', B, { grant: g })).status).toBe(403); // another session, and it burns the grant
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: g })).status).toBe(403);
    const g2 = await grant(b, A, 'passkey:add');
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: g2 })).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: g2 })).status).toBe(403); // reused
  });

  it('register/verify only follows a granted options call from the same session', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b), B = await login(b);
    expect((await post(b, '/api/remote/passkeys/register/verify', A, { response: { id: 'cred-2' }, name: 'x' })).status).toBe(403);
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: await grant(b, A, 'passkey:add') })).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/verify', B, { response: { id: 'cred-2' }, name: 'x' })).status).toBe(403);
    expect((await post(b, '/api/remote/passkeys/register/verify', A, { response: { id: 'cred-2' }, name: 'x' })).status).not.toBe(403);
    expect((await post(b, '/api/remote/passkeys/register/verify', A, { response: { id: 'cred-2' }, name: 'x' })).status).toBe(403); // the pending flag is single use
  });

  it('delete: no grant 403; an add grant on delete 403; a del grant works once; another session 403', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b), B = await login(b);
    await addSecond(b, A);
    expect((await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-1' })).status).toBe(403);
    expect((await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-1', grant: await grant(b, A, 'passkey:add') })).status).toBe(403);
    expect((await post(b, '/api/remote/passkeys/delete', B, { id: 'cred-1', grant: await grant(b, A, 'passkey:del') })).status).toBe(403);
    const g = await grant(b, A, 'passkey:del');
    expect((await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-1', grant: g })).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-2', grant: g })).status).toBe(403); // reused (and it would be the last one)
  });

  it('the last passkey cannot be deleted over the remote port, even with a valid grant, and the grant is not burned', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b);
    const g = await grant(b, A, 'passkey:del');
    const r = await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-1', grant: g });
    expect(r.status).toBe(403);
    expect(r.body).toContain('last passkey');
    await addSecond(b, A);
    expect((await post(b, '/api/remote/passkeys/delete', A, { id: 'cred-1', grant: g })).status).toBe(200); // the same grant still works
  });

  it('options at count 0 do not let that session finish a registration after another passkey was added', async () => {
    const b = await mk();
    const X = await login(b), Y = await login(b);
    expect((await post(b, '/api/remote/passkeys/register/options', X)).status).toBe(200); // count 0: no grant needed
    expect((await post(b, '/api/remote/passkeys/register/options', Y)).status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/verify', Y, { response: { id: 'cred-1' }, name: 'Y' })).status).toBe(200);
    const r = await post(b, '/api/remote/passkeys/register/verify', X, { response: { id: 'cred-9' }, name: 'X' });
    expect(r.status).toBe(403);
  });

  it('an unreadable passkeys file is a refusal state: no bootstrap, no step-up', async () => {
    const b = await mk({ corrupt: true });
    const c = await login(b);
    for (const [path, body] of [['/api/remote/passkeys/register/options', {}], ['/api/remote/passkeys/register/verify', { response: { id: 'x' } }], ['/api/remote/passkeys/delete', { id: 'x' }], ['/api/remote/stepup/options', {}]] as const) {
      const r = await post(b, path, c, body);
      expect(r.status, path).toBe(403);
      expect(r.body, path).toContain('passkeys.json');
    }
  });

  it('step-up accepts only the two passkey actions, and exactly one target', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b);
    await post(b, '/api/remote/stepup/options', A);
    for (const body of [{ response: { id: 'cred-1' }, action: 'passkey:evil' }, { response: { id: 'cred-1' }, action: 'passkey:add', ptyId: 'p1' }, { response: { id: 'cred-1' }, action: 'pty:p1' }]) {
      expect((await post(b, '/api/remote/stepup/verify', A, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('a pty or agent grant cannot change passkeys', async () => {
    const b = await mk();
    await bootstrap(b);
    const A = await login(b);
    await post(b, '/api/remote/stepup/options', A);
    const v = await post(b, '/api/remote/stepup/verify', A, { response: { id: 'cred-1' }, ptyId: 'passkey' });
    expect(v.status).toBe(200);
    expect((await post(b, '/api/remote/passkeys/register/options', A, { grant: JSON.parse(v.body).grant })).status).toBe(403);
  });

  it('no owner configured: register and delete are refused with a clear message', async () => {
    const b = await mk({ noOwner: true });
    const c = await login(b);
    const r = await post(b, '/api/remote/passkeys/register/options', c);
    expect(r.status).toBe(403);
    expect(r.body).toContain('HABBLAUD_REMOTE_OWNER_EMAIL');
    expect((await post(b, '/api/remote/passkeys/delete', c, { id: 'x' })).status).toBe(403);
  });
});

describe('owner identity (HABBLAUD_REMOTE_OWNER_EMAIL)', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const OWNER = 'owner@example.com';
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.5' };
  const NAV = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-site' };
  const T = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12345';
  const env = { HABBLAUD_REMOTE_USER: 'ana', HABBLAUD_REMOTE_PASSWORD_HASH: HASH_TEXT, HABBLAUD_REMOTE_DOMAIN: DOMAIN };

  describe('config', () => {
    it('lower-cases and trims the email; unset stays undefined', () => {
      expect(parseRemoteConfig({ ...env, HABBLAUD_REMOTE_OWNER_EMAIL: '  Owner@Example.COM ' }).config?.ownerEmail).toBe(OWNER);
      expect(parseRemoteConfig(env).config?.ownerEmail).toBeUndefined();
    });
    it('an invalid email is ignored with a warning (nobody becomes owner)', () => {
      for (const bad of ['nope', 'a@b', 'a b@example.com', '@example.com']) {
        const r = parseRemoteConfig({ ...env, HABBLAUD_REMOTE_OWNER_EMAIL: bad });
        expect(r.config?.ownerEmail, bad).toBeUndefined();
        expect(r.warning, bad).toMatch(/HABBLAUD_REMOTE_OWNER_EMAIL/);
      }
    });
    it('parseAllow never accepts pty', () => {
      expect([...parseAllow('terminal,pty')]).toEqual(['terminal']);
      expect([...parseAllow('pty')]).toEqual([]);
    });
  });

  describe('tokens', () => {
    const now = 1_800_000_000_000;
    const sessions = new RemoteSessions(SECRET, CFG, () => now);
    it('owner token carries .o under the signature; viewer and legacy tokens are viewers', () => {
      const o = sessions.issue(SESSION_MS, true).token;
      const v = sessions.issue().token;
      expect(o).toMatch(/^v1\.\d+\.o\.[A-Za-z0-9_-]{43}$/);
      expect(v).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
      expect([sessions.isOwner(o), sessions.isOwner(v)]).toEqual([true, false]);
      expect([sessions.verify(o), sessions.verify(v)]).toEqual([true, true]);
      expect(sessions.info(o)).toMatchObject({ owner: true });
      expect(sessions.info(v)).toMatchObject({ owner: false });
    });
    it('forging .o onto a viewer token, or stripping it from an owner token, invalidates it', () => {
      const o = sessions.issue(SESSION_MS, true).token;
      const v = sessions.issue().token;
      const forged = v.replace(/^(v1\.\d+)/, '$1.o');
      expect([sessions.verify(forged), sessions.isOwner(forged)]).toEqual([false, false]);
      const stripped = o.replace('.o.', '.');
      expect([sessions.verify(stripped), sessions.isOwner(stripped)]).toEqual([false, false]);
      expect(sessions.isOwner(undefined)).toBe(false);
    });
    it('a revoked owner token is no longer owner', () => {
      const o = sessions.issue(SESSION_MS, true).token;
      sessions.revoke(o);
      expect([sessions.verify(o), sessions.isOwner(o), sessions.info(o)]).toEqual([false, false, undefined]);
    });
  });

  describe('owner env rotation', () => {
    const now = 1_800_000_000_000;
    const mkS = (ownerEmail?: string) => new RemoteSessions(SECRET, { ...CFG, ...(ownerEmail ? { ownerEmail } : {}) }, () => now);
    it('an owner token dies when the owner email is unset or changed; unchanged keeps working', () => {
      const t = mkS(OWNER).issue(SESSION_MS, true).token;
      expect(mkS(OWNER).isOwner(t)).toBe(true);
      expect([mkS().verify(t), mkS().isOwner(t)]).toEqual([false, false]);
      expect([mkS('other@example.com').verify(t), mkS('other@example.com').isOwner(t)]).toEqual([false, false]);
    });
    it('with no owner configured the signing key is unchanged (existing viewer cookies keep working)', () => {
      const t = new RemoteSessions(SECRET, CFG, () => now).issue().token;
      expect(mkS().verify(t)).toBe(true);
    });
  });

  describe('who becomes owner', () => {
    let ldBody = '{"email":"owner@example.com","name":"A","owner":true}';
    let googleEmail = OWNER;
    let passkeyCount = 1;
    let clock = Date.now();
    async function mk(ownerEmail: string | null = OWNER) {
      const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
      const ld = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }).end(ldBody); });
      await new Promise<void>((ok) => ld.listen(0, '127.0.0.1', ok));
      closers.push(() => new Promise<void>((ok) => { ld.closeAllConnections(); ld.close(() => ok()); }));
      const tmp = tempDir();
      const passkeys = new PasskeyService({ domain: DOMAIN, user: 'ana', store: new PasskeyStore(join(tmp.dir, 'pk.json')), lib: { ...webauthn, verifyRegistrationResponse: (async () => ({ verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 } } })) as never, verifyAuthenticationResponse: (async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })) as never } });
      if (passkeyCount) { await passkeys.registerOptions(); await passkeys.verifyRegister({ response: {}, name: 'x' }); }
      const gate = createRemoteGate({
        config: CFG, sessions: new RemoteSessions(SECRET, { ...CFG, ...(ownerEmail ? { ownerEmail } : {}) }, () => clock), secure: true, domain: DOMAIN, ownerEmail: ownerEmail ?? undefined, ptyAccess: new PtyAccess(), passkeys, passwordLogin: true,
        sso: { url: `http://127.0.0.1:${(ld.address() as AddressInfo).port}`, secret: 's', timeoutMs: 500 },
        google: { start: () => ({ location: '/x', cookie: 'c' }), finish: async () => ({ ok: true as const, email: googleEmail }) } as never,
        failures: new FailureWindow(50, 600_000),
      });
      const server = http.createServer((req, res) => {
        if (guard(req, res)) return;
        if (gate(req, res, new URL(req.url ?? '/', 'http://x'))) return;
        sendJson(res, 200, { owner: isOwnerRequest(req) });
      });
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
      closers.push(() => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => { tmp.cleanup(); ok(); }); }));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
    const cookieOf = (r: { headers: http.IncomingHttpHeaders }) => (r.headers['set-cookie']?.[0] ?? '').split(';')[0];
    const owner = async (b: string, cookie: string) => JSON.parse((await request(b, '/whoami', { headers: { ...H, Cookie: cookie } })).body).owner as boolean;
    const viaPassword = async (b: string) => cookieOf(await request(b, '/api/remote/login', { method: 'POST', headers: H, body: CREDS }));
    const viaPasskey = async (b: string) => { await request(b, '/api/remote/passkeys/login/options', { method: 'POST', headers: H, body: {} }); return cookieOf(await request(b, '/api/remote/passkeys/login/verify', { method: 'POST', headers: H, body: { id: 'cred-1' } })); };
    const viaGoogle = async (b: string) => cookieOf(await request(b, '/api/remote/google/callback?code=c&state=s', { headers: { ...H, Cookie: '__Host-habblaud_google=x' } }));
    const viaSso = async (b: string) => cookieOf(await request(b, `/api/remote/sso?ticket=${T}`, { headers: { ...H, ...NAV } }));

    it('password and passkey sign-ins are owner; without the env nobody is', async () => {
      clock = Date.now(); passkeyCount = 1;
      const b = await mk();
      expect(await owner(b, await viaPassword(b))).toBe(true);
      expect(await owner(b, await viaPasskey(b))).toBe(true);
      const none = await mk(null);
      expect(await owner(none, await viaPassword(none))).toBe(false);
      expect(await owner(none, await viaPasskey(none))).toBe(false);
      expect(await owner(none, await viaGoogle(none))).toBe(false);
    });
    it('Google is owner only for the owner email', async () => {
      const b = await mk();
      googleEmail = OWNER;
      expect(await owner(b, await viaGoogle(b))).toBe(true);
      googleEmail = 'other@example.com';
      expect(await owner(b, await viaGoogle(b))).toBe(false);
      googleEmail = OWNER;
    });
    it('LD SSO is owner only when LD says owner:true AND the email matches', async () => {
      const b = await mk();
      const cases: Array<[string, boolean]> = [
        ['{"email":"owner@example.com","name":"A","owner":true}', true],
        ['{"email":"Owner@Example.com","name":"A","owner":true}', true],
        ['{"email":"owner@example.com","name":"A","owner":false}', false],
        ['{"email":"owner@example.com","name":"A"}', false],
        ['{"email":"other@example.com","name":"A","owner":true}', false],
        ['{"owner":true}', false],
        ['not json', false],
      ];
      for (const [body, want] of cases) {
        ldBody = body;
        const c = await viaSso(b);
        expect(c, body).not.toBe('');
        expect(await owner(b, c), body).toBe(want);
      }
      ldBody = '{"email":"owner@example.com","name":"A","owner":true}';
    });
    it('an old cookie (legacy format) is a viewer', async () => {
      const b = await mk();
      const legacy = new RemoteSessions(SECRET, { ...CFG, ownerEmail: OWNER }, () => clock).issue().token;
      expect(await owner(b, `__Host-habblaud_remote=${legacy}`)).toBe(false);
    });
    it('passkey register and delete need recent AND (no owner email OR owner)', async () => {
      clock = Date.now();
      const b = await mk();
      const post = (path: string, cookie: string, body: unknown = {}) => request(b, path, { method: 'POST', headers: { ...H, Cookie: cookie }, body });
      googleEmail = 'other@example.com';
      const viewer = await viaGoogle(b); // recent, but not the owner
      googleEmail = OWNER;
      for (const [path, body] of [['/api/remote/passkeys/register/options', {}], ['/api/remote/passkeys/register/verify', { response: {} }], ['/api/remote/passkeys/delete', { id: 'cred-1' }]] as const) {
        expect((await post(path, viewer, body)).status, path).toBe(403);
      }
      const o = await viaPassword(b);
      expect((await post('/api/remote/passkeys/register/options', o)).status).toBe(403); // a passkey exists: needs the step-up grant too
      const sso = await viaSso(b); // owner, but SSO is never recent
      expect((await post('/api/remote/passkeys/register/options', sso)).status).toBe(403);
    });
    it('without an owner email nobody may register or delete passkeys', async () => {
      clock = Date.now(); passkeyCount = 0;
      const none = await mk(null);
      const anyone = await viaPassword(none);
      for (const [path, body] of [['/api/remote/passkeys/register/options', {}], ['/api/remote/passkeys/register/verify', { response: {} }], ['/api/remote/passkeys/delete', { id: 'x' }]] as const) {
        const r = await request(none, path, { method: 'POST', headers: { ...H, Cookie: anyone }, body });
        expect(r.status, path).toBe(403);
        expect(r.body).toContain('HABBLAUD_REMOTE_OWNER_EMAIL');
      }
      passkeyCount = 1;
    });
  });
});

describe('remote pty step-up', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.5', 'Sec-Fetch-Site': 'same-origin' };
  const CK = '__Host-habblaud_remote';
  let grantClock = 1_000_000;
  let verifyCalls = 0;
  let lines: string[] = [];
  let passkeyCount = 1;
  let rec: string[] = [];
  let sessions: RemoteSessions;
  let access: PtyAccess;
  let streams: http.ServerResponse[] = [];
  let takeoverHook: (() => void) | undefined;
  // New-session fixtures: what the fake manager was asked to create and which folders the hub offers.
  let home = '';
  let createArgs: Array<Record<string, unknown>> = [];
  let made: Array<Record<string, unknown>> = [];
  let appointed: unknown[] = [];
  let teamFolder = '';
  let rooms: string[] = [];
  let accountIds = ['acc1'];
  let bossOk = true;

  async function mk(o: { limit?: number; create?: boolean } = {}) {
    grantClock = 1_000_000; verifyCalls = 0; lines = []; rec = []; streams = [];
    createArgs = []; made = []; appointed = []; teamFolder = ''; rooms = []; accountIds = ['acc1']; bossOk = true;
    const tmp = tempDir();
    home = realpathSync(tmp.dir);
    const dir = join(tmp.dir, '.claude');
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
    const hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    sessions = new RemoteSessions(SECRET, CFG);
    access = new PtyAccess(() => grantClock);
    const passkeys = {
      count: () => passkeyCount,
      broken: () => false,
      list: () => [],
      stepupOptions: async () => ({ challenge: 'c' }),
      verifyStepup: async (assertion: { ok?: boolean }) => { verifyCalls++; return assertion?.ok === true; },
    } as unknown as PasskeyService;
    const fake = {
      attach: (id: string, _req: http.IncomingMessage, res: http.ServerResponse) => {
        if (id === 'nope') throw new PtyError(404, 'unknown');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: reset\ndata: {}\n\n');
        streams.push(res);
        rec.push(`attach ${id}`);
      },
      input: (id: string, d: unknown) => void rec.push(`input ${id} ${String(d)}`),
      resize: (id: string) => void rec.push(`resize ${id}`),
      close: (id: string) => void rec.push(`close ${id}`),
      stop: async (id: string) => void rec.push(`stop ${id}`),
      takeover: async (id: string) => { rec.push(`takeover ${id}`); takeoverHook?.(); return { id: 'p9', agentId: 'x' }; },
      create: (p: Record<string, unknown>) => {
        rec.push('create');
        createArgs.push(p);
        const info = { id: `pn${createArgs.length}`, agentId: `acc1:${100 + createArgs.length}`, account: p.account ?? 'acc1', cwd: p.cwd };
        made.push(info);
        return info;
      },
      list: () => { rec.push('list'); return made; },
      status: () => ({ enabled: true }),
    } as unknown as PtyManager;
    const api = createApiHandler({
      office, hub, accounts, sources: () => [], version: '9.9.9', terminal: true,
      terminals: new TerminalStreams({ office, transcriptPathOf: () => undefined, parserFor: () => undefined }),
      sessions: { list: async () => [], resolve: () => ({ ok: false, status: 404, error: 'unknown' }) } as unknown as SessionLookup,
      pty: createPtyRoutes(fake, {
        access, sessionOf: sessionOfRequest, isRemote: isRemoteRequest,
        ...(o.create ? {
          create: {
            folders: (boss) => (boss ? [teamFolder] : [teamFolder, ...rooms]).filter(Boolean),
            accounts: () => accountIds,
            home,
            bossOk: () => bossOk,
            appoint: (pi) => { appointed.push(pi); return { ok: true }; },
            ip: (r) => clientIp(r, true),
          } satisfies RemotePty['create'],
        } : {}),
      }),
      remote: { is: isRemoteRequest, allows: remoteAllows(new Set<RemoteFeature>(), () => passkeyCount) },
    });
    const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
    const gate = createRemoteGate({ config: CFG, sessions, secure: true, domain: DOMAIN, passkeys, ptyAccess: access, passwordLogin: true, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) }, failures: new FailureWindow(o.limit ?? 5, 600_000) });
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://x');
      if (gate(req, res, url)) return;
      if (!api(req, res, url)) res.writeHead(404).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => { hub.stop(); for (const r of streams) r.destroy(); server.closeAllConnections(); server.close(() => { tmp.cleanup(); ok(); }); }));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  let n = 0;
  // Distinct, far-apart expiries: a 1 ms offset could coincide with the clock ticking 1 ms between two sessions (same token).
  const cookie = (owner: boolean, ttl = SESSION_MS) => `${CK}=${sessions.issue(ttl === SESSION_MS ? ttl - 100_003 * ++n : ttl, owner).token}`;
  const post = (b: string, path: string, c: string, body: unknown = {}, extra: Record<string, string> = {}) => request(b, path, { method: 'POST', headers: { ...H, Cookie: c, ...extra }, body });
  const get = (b: string, path: string, c: string, extra: Record<string, string> = {}) => request(b, path, { headers: { ...H, Cookie: c, ...extra } });
  /** Opens an SSE and resolves with the status once headers arrive (the body never ends by itself). */
  const sse = (b: string, path: string, c: string, extra: Record<string, string> = {}) =>
    new Promise<{ status: number; ended: Promise<void>; abort(): void }>((ok, fail) => {
      const r = http.request(new URL(path, b), { headers: { ...H, Cookie: c, ...extra } }, (res) => {
        const ended = new Promise<void>((done) => { res.on('end', done); res.on('close', done); res.on('error', done); });
        res.resume();
        ok({ status: res.statusCode ?? 0, ended, abort: () => r.destroy() });
      });
      r.on('error', fail);
      r.end();
    });
  const stepup = async (b: string, c: string, target: Record<string, unknown>): Promise<string> => {
    expect((await post(b, '/api/remote/stepup/options', c)).status).toBe(200);
    const v = await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, ...target });
    expect(v.status).toBe(200);
    const body = JSON.parse(v.body);
    expect(body.expiresInS).toBe(60);
    return body.grant as string;
  };
  const streamPath = (id: string, grant?: string) => `/api/pty/${id}/stream${grant === undefined ? '' : `?grant=${encodeURIComponent(grant)}`}`;

  beforeEach(() => { passkeyCount = 1; });

  it('owner with a valid step-up: stream is event-stream, input and resize are recorded', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    const st = await sse(b, streamPath('p1', grant), c);
    expect(st.status).toBe(200);
    const inp = await post(b, '/api/pty/p1/input', c, { data: 'ls\n' });
    expect(inp.status).toBe(204);
    expect((await post(b, '/api/pty/p1/resize', c, { cols: 80, rows: 24 })).status).toBe(204);
    expect(rec).toEqual(['attach p1', 'input p1 ls\n', 'resize p1']);
    st.abort();
  });

  it('step-up from a same-site page (or without Sec-Fetch-Site) is refused before the body is read', async () => {
    const b = await mk();
    const c = cookie(true);
    for (const site of ['same-site', 'cross-site', '']) {
      expect((await post(b, '/api/remote/stepup/options', c, {}, { 'Sec-Fetch-Site': site })).status).toBe(403);
      expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, ptyId: 'p1' }, { 'Sec-Fetch-Site': site })).status).toBe(403);
    }
    expect((await post(b, '/api/remote/stepup/options', c)).status).toBe(200);
  });

  it('the log never contains the grant or the challenge', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    expect(lines.join('\n')).toMatch(/step-up ok/);
    expect(lines.join('\n')).not.toContain(grant);
  });

  it('no grant or a garbage grant: 403; input without a live stream: 403', async () => {
    const b = await mk();
    const c = cookie(true);
    expect((await get(b, streamPath('p1'), c)).status).toBe(403);
    expect((await get(b, streamPath('p1', 'garbage'), c)).status).toBe(403);
    expect((await post(b, '/api/pty/p1/input', c, { data: 'x' })).status).toBe(403);
    expect((await post(b, '/api/pty/p1/resize', c, { cols: 1, rows: 1 })).status).toBe(403);
    expect(rec).toEqual([]);
  });

  it('an expired grant: 403', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    grantClock += 60_001;
    expect((await get(b, streamPath('p1', grant), c)).status).toBe(403);
  });

  it('a reused grant: 403 (EventSource auto-reconnect must ask again)', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    const st = await sse(b, streamPath('p1', grant), c);
    expect(st.status).toBe(200);
    expect((await get(b, streamPath('p1', grant), c)).status).toBe(403);
    st.abort();
  });

  it("a grant from owner session A presented by owner session B: 403 (and B cannot type into A's stream)", async () => {
    const b = await mk();
    const A = cookie(true), B = cookie(true);
    const grant = await stepup(b, A, { ptyId: 'p1' });
    expect((await get(b, streamPath('p1', grant), B)).status).toBe(403);
    const grant2 = await stepup(b, A, { ptyId: 'p1' });
    const st = await sse(b, streamPath('p1', grant2), A);
    expect(st.status).toBe(200);
    expect((await post(b, '/api/pty/p1/input', B, { data: 'x' })).status).toBe(403);
    expect((await post(b, '/api/pty/p1/input', A, { data: 'x' })).status).toBe(204);
    st.abort();
  });

  it('a grant for pty A opens A; on pty B it is 403', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'pA' });
    expect((await get(b, streamPath('pB', grant), c)).status).toBe(403);
    const again = await stepup(b, c, { ptyId: 'pA' });
    const st = await sse(b, streamPath('pA', again), c);
    expect(st.status).toBe(200);
    st.abort();
  });

  it('a viewer (no owner): options 403, verify 403, stream 403, ptyStepUp false', async () => {
    const b = await mk();
    const c = cookie(false);
    expect((await post(b, '/api/remote/stepup/options', c)).status).toBe(403);
    expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, ptyId: 'p1' })).status).toBe(403);
    expect((await get(b, streamPath('p1', 'x'), c)).status).toBe(403);
    expect(JSON.parse((await get(b, '/api/access', c)).body)).toMatchObject({ ptyStepUp: false, terminal: false });
    expect(verifyCalls).toBe(0);
  });

  it('an owner with no passkey: options 403, ptyStepUp false, terminal still true', async () => {
    passkeyCount = 0;
    const b = await mk();
    const c = cookie(true);
    const r = await post(b, '/api/remote/stepup/options', c);
    expect(r.status).toBe(403);
    expect(r.body).toContain('register one first');
    expect(JSON.parse((await get(b, '/api/access', c)).body)).toMatchObject({ ptyStepUp: false, terminal: true });
    expect(JSON.parse((await get(b, '/api/health', c)).body).pty).toBe(false);
  });

  it('an owner with a passkey: ptyStepUp and health.pty are true; unsigned requests are 401', async () => {
    const b = await mk();
    const c = cookie(true);
    expect(JSON.parse((await get(b, '/api/access', c)).body)).toMatchObject({ ptyStepUp: true, terminal: true });
    expect(JSON.parse((await get(b, '/api/health', c)).body).pty).toBe(true);
    expect((await request(b, '/api/remote/stepup/options', { method: 'POST', headers: H, body: {} })).status).toBe(401);
  });

  it('same-site with a valid grant: 403 and the grant is not consumed; same-origin afterwards: 200', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    expect((await get(b, streamPath('p1', grant), c, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    const { 'Sec-Fetch-Site': _s, ...noHeader } = H;
    expect((await request(b, streamPath('p1', grant), { headers: { ...noHeader, Cookie: c } })).status).toBe(403);
    const st = await sse(b, streamPath('p1', grant), c);
    expect(st.status).toBe(200);
    st.abort();
  });

  it('logout ends the stream; later input is 403', async () => {
    const b = await mk();
    const c = cookie(true);
    const st = await sse(b, streamPath('p1', await stepup(b, c, { ptyId: 'p1' })), c);
    expect(st.status).toBe(200);
    expect((await post(b, '/api/remote/logout', c)).status).toBe(200);
    await st.ended;
    expect((await post(b, '/api/pty/p1/input', c, { data: 'x' })).status).toBe(401);
  });

  it('a short-lived session: the timer ends the stream at expiry', async () => {
    const b = await mk();
    const c = cookie(true, 800);
    const st = await sse(b, streamPath('p1', await stepup(b, c, { ptyId: 'p1' })), c);
    expect(st.status).toBe(200);
    const t0 = Date.now();
    await st.ended;
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('5 bad verifies, then the 6th is 429 with Retry-After and the verifier is not called', async () => {
    const b = await mk();
    const c = cookie(true);
    await post(b, '/api/remote/stepup/options', c);
    for (let i = 0; i < 5; i++) expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: false }, ptyId: 'p1' })).status).toBe(401);
    expect(verifyCalls).toBe(5);
    const r = await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, ptyId: 'p1' });
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(verifyCalls).toBe(5);
  });

  it('verify rejects a bad body or target id with 400 before the verifier runs; 21st outstanding grant is 429', async () => {
    const b = await mk();
    const c = cookie(true);
    for (const body of [{}, { response: { ok: true } }, { response: { ok: true }, ptyId: 'a/b' }, { response: { ok: true }, ptyId: 'x'.repeat(65) }, { response: { ok: true }, ptyId: 'a', agentId: 'b' }, { response: 1, ptyId: 'a' }]) {
      expect((await post(b, '/api/remote/stepup/verify', c, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(verifyCalls).toBe(0);
    for (let i = 0; i < 20; i++) expect(access.issue('other', `pty:p${i}`)).toBeTruthy();
    expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, ptyId: 'p1' })).status).toBe(429);
  });

  it('an owner holding a grant still gets 403 on POST /api/pty, close, stop, GET /api/pty', async () => {
    const b = await mk();
    const c = cookie(true);
    const grant = await stepup(b, c, { ptyId: 'p1' });
    const grantAgent = await stepup(b, c, { agentId: 'a1' });
    const blocked: Array<[string, string, unknown?]> = [
      ['POST', '/api/pty', { cwd: '/tmp' }],
      ['GET', '/api/pty'],
      ['POST', '/api/pty/p1/close', {}],
      ['POST', `/api/agents/a1/stop?grant=${grantAgent}`, {}],
      ['POST', `/api/agents/a1/stop`, { grant: grantAgent }],
    ];
    for (const [method, path, body] of blocked) {
      const r = await request(b, `${path}${path.includes('?') ? '&' : '?'}grant=${grant}`, { method, headers: { ...H, Cookie: c }, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect(rec).toEqual([]);
  });

  describe('takeover', () => {
    const takeover = (b: string, id: string, c: string, grant?: string, extra: Record<string, string> = {}) =>
      post(b, `/api/agents/${id}/takeover`, c, grant === undefined ? {} : { grant }, extra);

    it('owner with an agent grant: 200 and the returned pty grant attaches (single use)', async () => {
      const b = await mk();
      const c = cookie(true);
      const r = await takeover(b, 'a1', c, await stepup(b, c, { agentId: 'a1' }));
      expect(r.status).toBe(201);
      const info = JSON.parse(r.body);
      expect(info).toMatchObject({ id: 'p9' });
      expect(typeof info.grant).toBe('string');
      expect(rec).toEqual(['takeover a1']);
      const st = await sse(b, streamPath('p9', info.grant), c);
      expect(st.status).toBe(200);
      expect((await get(b, streamPath('p9', info.grant), c)).status).toBe(403);
      st.abort();
    });

    it('the grant may also come in ?grant=', async () => {
      const b = await mk();
      const c = cookie(true);
      const g = await stepup(b, c, { agentId: 'a1' });
      expect((await post(b, `/api/agents/a1/takeover?grant=${g}`, c, {})).status).toBe(201);
    });

    it('no grant, a reused grant, or another session\'s grant: 403, nothing taken over', async () => {
      const b = await mk();
      const A = cookie(true), B = cookie(true);
      expect((await takeover(b, 'a1', A)).status).toBe(403);
      expect((await takeover(b, 'a1', A, 'junk')).status).toBe(403);
      const g = await stepup(b, A, { agentId: 'a1' });
      expect((await takeover(b, 'a1', B, g)).status).toBe(403);
      const g2 = await stepup(b, A, { agentId: 'a1' });
      expect((await takeover(b, 'a1', A, g2)).status).toBe(201);
      expect((await takeover(b, 'a1', A, g2)).status).toBe(403);
      expect(rec).toEqual(['takeover a1']);
    });

    it('a grant for agent A on agent B, a pty grant on takeover, an agent grant on a stream: all 403', async () => {
      const b = await mk();
      const c = cookie(true);
      expect((await takeover(b, 'aB', c, await stepup(b, c, { agentId: 'aA' }))).status).toBe(403);
      expect((await takeover(b, 'a1', c, await stepup(b, c, { ptyId: 'a1' }))).status).toBe(403);
      expect((await get(b, streamPath('a1', await stepup(b, c, { agentId: 'a1' })), c)).status).toBe(403);
      expect(rec).toEqual([]);
    });

    it('when no grant slot is free for the new terminal, the takeover still succeeds and says grant: null', async () => {
      const b = await mk();
      const c = cookie(true);
      const g = await stepup(b, c, { agentId: 'a1' });
      takeoverHook = () => { for (let i = 0; i < 20; i++) access.issue('other', `pty:x${i}`); };
      const r = await takeover(b, 'a1', c, g);
      takeoverHook = undefined;
      expect(r.status).toBe(201);
      expect(JSON.parse(r.body)).toMatchObject({ id: 'p9', grant: null });
    });

    it('a viewer: 403', async () => {
      const b = await mk();
      expect((await takeover(b, 'a1', cookie(false), 'x')).status).toBe(403);
      expect(rec).toEqual([]);
    });

    it('without Sec-Fetch-Site same-origin: 403 and the grant is not consumed', async () => {
      const b = await mk();
      const c = cookie(true);
      const g = await stepup(b, c, { agentId: 'a1' });
      expect((await takeover(b, 'a1', c, g, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
      expect((await takeover(b, 'a1', c, g)).status).toBe(201);
    });
  });

  it('ownerEmail unset (viewer sessions only): step-up, stream, takeover and terminal are all 403', async () => {
    const b = await mk();
    const c = cookie(false);
    expect((await post(b, '/api/remote/stepup/options', c)).status).toBe(403);
    expect((await get(b, streamPath('p1', 'x'), c)).status).toBe(403);
    expect((await post(b, '/api/agents/a1/takeover', c, { grant: 'x' })).status).toBe(403);
    expect(JSON.parse((await get(b, '/api/access', c)).body)).toMatchObject({ terminal: false, ptyStepUp: false });
  });

  it('owner sessions get the read-only terminal feature without HABBLAUD_REMOTE_ALLOW', async () => {
    const b = await mk();
    expect(JSON.parse((await get(b, '/api/access', cookie(true))).body).terminal).toBe(true);
    expect(JSON.parse((await get(b, '/api/access', cookie(false))).body).terminal).toBe(false);
  });
  describe('new session (create)', () => {
    type Create = { cwd: string; account?: string; prompt?: string; model?: string; boss?: boolean };
    const mkc = async () => {
      const b = await mk({ create: true });
      for (const d of ['team', 'proj', 'other', '.ssh', '.hidden', 'proj/sub']) mkdirSync(join(home, d), { recursive: true });
      teamFolder = join(home, 'team');
      rooms = [join(home, 'proj')];
      return { b, c: cookie(true) };
    };
    const body = (c: Create, grant?: string) => ({ ...c, cols: 100, rows: 30, ...(grant === undefined ? {} : { grant }) });
    const open = async (b: string, c: string, cr: Create) => post(b, '/api/pty', c, body(cr, await stepup(b, c, { create: cr })));
    const stepupCreate = (b: string, c: string, create: unknown) => post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, create });

    it('owner with the exact grant: 201, the fake gets the real folder, the answer carries a grant that attaches', async () => {
      const { b, c } = await mkc();
      const r = await open(b, c, { cwd: join(home, 'proj'), account: 'acc1', model: 'claude-sonnet-5-5', prompt: 'hello' });
      expect(r.status).toBe(201);
      const info = JSON.parse(r.body);
      expect(info).toMatchObject({ id: 'pn1' });
      expect(info.boss).toBeUndefined();
      expect(createArgs).toEqual([{ cwd: join(home, 'proj'), account: 'acc1', prompt: 'hello', model: 'claude-sonnet-5-5', cols: 100, rows: 30 }]);
      const st = await sse(b, streamPath('pn1', info.grant), c);
      expect(st.status).toBe(200);
      st.abort();
    });

    it('no grant, garbage, only in the query, reused, another session, expired: 403 and nothing is created', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'proj') };
      expect((await post(b, '/api/pty', c, body(cr))).status).toBe(403);
      expect((await post(b, '/api/pty', c, body(cr, 'junk'))).status).toBe(403);
      const q = await stepup(b, c, { create: cr });
      expect((await post(b, `/api/pty?grant=${q}`, c, body(cr))).status).toBe(403);
      expect(createArgs).toEqual([]); // a grant in the query is ignored (not even burned): only the body counts
      expect((await post(b, '/api/pty', c, body(cr, q))).status).toBe(201);
      const g = await stepup(b, c, { create: cr });
      expect((await post(b, '/api/pty', cookie(true), body(cr, g))).status).toBe(403);
      const g2 = await stepup(b, c, { create: cr });
      grantClock += 60_001;
      expect((await post(b, '/api/pty', c, body(cr, g2))).status).toBe(403);
      const g3 = await stepup(b, c, { create: cr });
      expect((await post(b, '/api/pty', c, body(cr, g3))).status).toBe(201);
      expect((await post(b, '/api/pty', c, body(cr, g3))).status).toBe(403);
      expect(createArgs.length).toBe(2);
    });

    it('a grant spent on other arguments is 403 and burned (cwd, prompt, model, account)', async () => {
      const { b, c } = await mkc();
      accountIds = ['acc1', 'acc2'];
      const base: Create = { cwd: join(home, 'proj'), account: 'acc1', model: 'claude-sonnet-5-5', prompt: 'p' };
      for (const other of [{ ...base, cwd: join(home, 'team') }, { ...base, prompt: 'q' }, { ...base, model: 'claude-haiku-5-5' }, { ...base, account: 'acc2' }, { cwd: base.cwd }]) {
        const g = await stepup(b, c, { create: base });
        expect((await post(b, '/api/pty', c, body(other, g))).status, JSON.stringify(other)).toBe(403);
        expect((await post(b, '/api/pty', c, body(base, g))).status).toBe(403);
      }
      expect(createArgs).toEqual([]);
    });

    it('a grant for one purpose never opens another (both directions), nothing is created', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'proj') };
      for (const t of [{ ptyId: 'p1' }, { agentId: 'a1' }, { action: 'passkey:add' }]) {
        expect((await post(b, '/api/pty', c, body(cr, await stepup(b, c, t)))).status, JSON.stringify(t)).toBe(403);
      }
      const gc = () => stepup(b, c, { create: cr });
      expect((await get(b, streamPath('p1', await gc()), c)).status).toBe(403);
      expect((await post(b, '/api/agents/a1/takeover', c, { grant: await gc() })).status).toBe(403);
      expect((await post(b, '/api/remote/passkeys/register/options', c, { grant: await gc() })).status).toBe(403);
      expect(createArgs).toEqual([]);
      expect(rec).toEqual([]);
    });

    it('boss is part of the target: a new-session grant fails for a boss POST and the other way round', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'team') };
      expect((await post(b, '/api/pty', c, body({ ...cr, boss: true }, await stepup(b, c, { create: cr })))).status).toBe(403);
      expect((await post(b, '/api/pty', c, body(cr, await stepup(b, c, { create: { ...cr, boss: true } })))).status).toBe(403);
      expect(createArgs).toEqual([]);
      expect(appointed).toEqual([]);
    });

    it('a viewer: verify and POST are 403 and nothing is created', async () => {
      const { b } = await mkc();
      const v = cookie(false);
      expect((await stepupCreate(b, v, { cwd: join(home, 'proj') })).status).toBe(403);
      expect((await post(b, '/api/pty', v, body({ cwd: join(home, 'proj') }, 'x'))).status).toBe(403);
      expect(createArgs).toEqual([]);
      expect(verifyCalls).toBe(0);
    });

    it('GET /api/pty, other methods and the other routes stay local-only even with create on', async () => {
      const { b, c } = await mkc();
      expect((await get(b, '/api/pty', c)).status).toBe(403);
      expect((await request(b, '/api/pty', { method: 'PUT', headers: { ...H, Cookie: c }, body: {} })).status).toBe(403);
      expect((await post(b, '/api/pty/pn1/close', c, {})).status).toBe(403);
      expect((await post(b, '/api/agents/a1/stop', c, {})).status).toBe(403);
      expect(rec).toEqual([]);
    });

    it('same-site or a missing Sec-Fetch-Site: 403 and the grant is not burned', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'proj') };
      const g = await stepup(b, c, { create: cr });
      expect((await post(b, '/api/pty', c, body(cr, g), { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
      expect((await post(b, '/api/pty', c, body(cr, g))).status).toBe(201);
    });

    it('folders: home itself, outside home, "..", symlink into a dotdir, dot folders, unlisted: all 400 (grant for exactly that cwd)', async () => {
      const { b, c } = await mkc();
      symlinkSync(join(home, '.ssh'), join(home, 'link'));
      rooms = [join(home, 'proj'), home, '/etc', join(home, '.ssh'), join(home, '.hidden'), join(home, 'link')];
      teamFolder = '/etc';
      const bad = [home, '/etc', join(home, '.ssh'), join(home, '.hidden'), join(home, 'link'), `${home}/proj/../.ssh`, `${home}/proj/../proj`, join(home, 'other'), join(home, 'proj', 'sub'), 'proj', '/', ''];
      for (const cwd of bad) {
        const r = await open(b, c, { cwd });
        expect(r.status, cwd).toBe(400);
      }
      expect(createArgs).toEqual([]);
      expect((await open(b, c, { cwd: join(home, 'proj') })).status).toBe(201);
    });

    it('an allowed room that is a symlink into home resolves to the real folder; one that points outside home is 400', async () => {
      const { b, c } = await mkc();
      symlinkSync(join(home, 'other'), join(home, 'alias'));
      symlinkSync('/etc', join(home, 'toetc'));
      rooms = [join(home, 'alias'), join(home, 'toetc')];
      expect((await open(b, c, { cwd: join(home, 'toetc') })).status).toBe(400);
      expect((await open(b, c, { cwd: join(home, 'alias') })).status).toBe(201);
      expect(createArgs[0]!.cwd).toBe(join(home, 'other'));
    });

    it('team folder in a dotdir or outside home is refused as well', async () => {
      const { b, c } = await mkc();
      teamFolder = join(home, '.ssh');
      expect((await open(b, c, { cwd: teamFolder, boss: true })).status).toBe(400);
      teamFolder = '/tmp';
      expect((await open(b, c, { cwd: '/tmp' })).status).toBe(400);
      expect(createArgs).toEqual([]);
    });

    it('unknown account, unknown model, bad prompt: 400, nothing created', async () => {
      const { b, c } = await mkc();
      const cwd = join(home, 'proj');
      for (const cr of [{ cwd, account: 'nope' }, { cwd, model: 'gpt-9' }, { cwd, prompt: '--dangerous' }, { cwd, prompt: '' }]) {
        expect((await open(b, c, cr)).status, JSON.stringify(cr)).toBe(400);
      }
      expect(createArgs).toEqual([]);
    });

    it('prompt reaches the manager as the literal string (no shell involved)', async () => {
      const { b, c } = await mkc();
      const prompt = 'run $(id) and `whoami` ; echo "$HOME" | cat';
      expect((await open(b, c, { cwd: join(home, 'proj'), prompt })).status).toBe(201);
      expect(createArgs[0]!.prompt).toBe(prompt);
    });

    it('verify refuses a create with a non-string field, or together with another target: 400, verifier not called', async () => {
      const { b, c } = await mkc();
      const cwd = join(home, 'proj');
      for (const bad of [0, 1, true, [], {}, ['a']]) {
        for (const f of ['cwd', 'account', 'model', 'prompt']) {
          expect((await stepupCreate(b, c, { cwd, [f]: bad })).status, `${f}=${JSON.stringify(bad)}`).toBe(400);
        }
      }
      for (const bad of [0, 'yes', [], {}]) expect((await stepupCreate(b, c, { cwd, boss: bad })).status).toBe(400);
      for (const create of [null, 'x', [], {}]) expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, create })).status).toBe(400);
      expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, create: { cwd }, ptyId: 'p1' })).status).toBe(400);
      expect((await post(b, '/api/remote/stepup/verify', c, { response: { ok: true }, create: { cwd }, action: 'passkey:add' })).status).toBe(400);
      expect(verifyCalls).toBe(0);
    });

    it('POST with a non-string field is refused even with a grant (same function on both ends)', async () => {
      const { b, c } = await mkc();
      const cwd = join(home, 'proj');
      for (const bad of [0, [], {}, ['a']]) {
        for (const f of ['cwd', 'account', 'model', 'prompt']) {
          const g = await stepup(b, c, { create: { cwd } });
          expect((await post(b, '/api/pty', c, body({ cwd, [f]: bad } as Create, g))).status, `${f}=${JSON.stringify(bad)}`).toBe(403);
        }
      }
      const g = await stepup(b, c, { create: { cwd } });
      expect((await post(b, '/api/pty', c, body({ cwd, prompt: undefined, account: null, model: null } as unknown as Create, g))).status).toBe(201); // absent == null == undefined
      expect(createArgs.length).toBe(1);
    });

    it('at most 3 open from remote: the 4th is 429; an exited or vanished terminal frees a slot', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'proj') };
      for (let i = 0; i < 3; i++) expect((await open(b, c, cr)).status).toBe(201);
      expect((await open(b, c, cr)).status).toBe(429);
      expect(createArgs.length).toBe(3);
      made[0]!.exitedAt = 5;
      expect((await open(b, c, cr)).status).toBe(201);
      expect((await open(b, c, cr)).status).toBe(429);
      made.splice(1, 1); // gone from the manager's list
      expect((await open(b, c, cr)).status).toBe(201);
      expect(createArgs.length).toBe(5);
    });

    it('boss in the team folder: created, appointed, answer says boss; extra body keys go nowhere', async () => {
      const { b, c } = await mkc();
      const cr = { cwd: join(home, 'team'), boss: true };
      const r = await post(b, '/api/pty', c, { ...body(cr, await stepup(b, c, { create: cr })), folder: '/x', workers: [], team: { boss: { kind: 'agy' } } });
      expect(r.status).toBe(201);
      expect(JSON.parse(r.body)).toMatchObject({ id: 'pn1', boss: true });
      expect(appointed).toEqual([made[0]]);
      expect(createArgs).toEqual([{ cwd: join(home, 'team'), account: undefined, prompt: undefined, model: undefined, cols: 100, rows: 30 }]);
    });

    it('boss in a room folder: 400; boss when the boss is not a Claude Code one: 409; nothing created', async () => {
      const { b, c } = await mkc();
      expect((await open(b, c, { cwd: join(home, 'proj'), boss: true })).status).toBe(400);
      bossOk = false;
      expect((await open(b, c, { cwd: join(home, 'team'), boss: true })).status).toBe(409);
      expect(createArgs).toEqual([]);
      expect(appointed).toEqual([]);
    });

    it('the team folder is also a normal choice for a plain new session (no appoint)', async () => {
      const { b, c } = await mkc();
      const r = await open(b, c, { cwd: join(home, 'team') });
      expect(r.status).toBe(201);
      expect(JSON.parse(r.body).boss).toBeUndefined();
      expect(appointed).toEqual([]);
    });

    it('logs IP, user agent and folder name only: never the prompt or the grant', async () => {
      const { b, c } = await mkc();
      const info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
      try {
        const cr = { cwd: join(home, 'proj'), prompt: 'top secret words' };
        const g = await stepup(b, c, { create: cr });
        const r = await post(b, '/api/pty', c, body(cr, g), { 'User-Agent': 'UA-test' });
        const out = JSON.parse(r.body) as { grant: string };
        const logged = info.mock.calls.map((x) => String(x[0])).join('\n') + lines.join('\n');
        expect(logged).toContain('203.0.113.5');
        expect(logged).toContain('UA-test');
        expect(logged).toContain('proj');
        expect(logged).not.toContain('top secret');
        expect(logged).not.toContain(g);
        expect(logged).not.toContain(out.grant);
        expect(logged).not.toContain(home);
      } finally {
        info.mockRestore();
      }
    });

    it('/verify body size: a viewer is refused with 403 whatever the size; an owner may send up to 128 KB, not more', async () => {
      const { b, c } = await mkc();
      const pad = (n: number) => ({ response: { ok: true, pad: 'x'.repeat(n) }, create: { cwd: join(home, 'proj') } });
      expect((await post(b, '/api/remote/stepup/verify', cookie(false), pad(70_000))).status).toBe(403);
      expect((await post(b, '/api/remote/stepup/verify', c, pad(60_000))).status).toBe(200);
      // Over the cap the server cuts the connection (cut mode): a reset or a 400, never a grant.
      const over = await post(b, '/api/remote/stepup/verify', c, pad(200_000)).then((r) => r.status, () => 0);
      expect([0, 400]).toContain(over);
      expect(verifyCalls).toBe(1);
    });
  });
});
