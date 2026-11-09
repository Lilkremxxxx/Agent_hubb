import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler, sendJson } from './app';
import { createRequestGuard } from './guard';
import {
  clientIp,
  COOKIE,
  createRemoteGate,
  FailureWindow,
  listsHubDomain,
  remoteAllowedHosts,
  isRemoteRequest,
  isSecureRemote,
  loadSecret,
  LoginThrottle,
  parseAllow,
  parseRemoteConfig,
  readCookie,
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
    remote: { is: isRemoteRequest, allows: (f) => allowSet.has(f) },
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
  async function mk(o: { ld?: (res: http.ServerResponse) => void; sso?: boolean; limit?: number } = {}) {
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
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG), secure: true, domain: DOMAIN, sso, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) }, failures: new FailureWindow(o.limit ?? 5, 600_000) });
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const sso = (b: string, t = T) => request(b, `/api/remote/sso?ticket=${t}`, { headers: H });

  it('success: asks LD with the bearer secret, sets the session cookie, 302 /', async () => {
    const r = await sso(await mk());
    expect([r.status, r.headers.location, r.headers['cache-control'], r.headers['referrer-policy']]).toEqual([302, '/', 'no-store', 'no-referrer']);
    expect(r.headers['set-cookie']?.[0]).toMatch(/^__Host-habblaud_remote=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
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
  const H = { Connection: 'close', Host: DOMAIN, Origin: `https://${DOMAIN}`, 'CF-Connecting-IP': '203.0.113.7' };
  let verifyCalls = 0;
  let pwCalls = 0;
  let clock = Date.now();
  let lines: string[] = [];
  const lib = (ok = true): WebAuthnLib => ({
    ...webauthn,
    verifyRegistrationResponse: (async () => ({ verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 } } })) as never,
    verifyAuthenticationResponse: (async () => { verifyCalls++; return { verified: ok, authenticationInfo: { newCounter: 1 } }; }) as never,
  });
  async function mk(o: { passkeys?: boolean; ok?: boolean; passwordLogin?: boolean; limit?: number; service?: unknown; frameAncestor?: string } = {}) {
    const tmp = tempDir();
    verifyCalls = 0; pwCalls = 0; clock = Date.now(); lines = [];
    const passkeys = (o.service as PasskeyService | undefined) ?? (o.passkeys === false ? undefined : new PasskeyService({ domain: DOMAIN, user: 'ana', store: new PasskeyStore(join(tmp.dir, 'pk.json')), lib: lib(o.ok) }));
    const guard = createRequestGuard({ allowedHosts: new Set([DOMAIN]) });
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG, () => clock), secure: true, domain: DOMAIN, passkeys, passwordLogin: o.passwordLogin, frameAncestor: o.frameAncestor, log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) }, verify: (pw, h) => { pwCalls++; return verifyPassword(pw, h); }, failures: new FailureWindow(o.limit ?? 5, 600_000) });
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
    expect((await post(b, '/api/remote/passkeys/delete', { id: 'nope' }, C)).status).toBe(404);
    expect((await post(b, '/api/remote/passkeys/delete', { id: 'cred-1' }, C)).status).toBe(200);
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
