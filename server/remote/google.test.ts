import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteGate, FailureWindow, LoginThrottle, parseRemoteConfig, readCookie, RemoteSessions } from '../http/remote';
import { createRequestGuard } from '../http/guard';
import { googleEnv, parseArgs, proxyEnv, remoteEnv } from '../../scripts/remote-setup';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { readEnvValue } from './envfile';
import { hashPassword, parsePasswordHash } from './password';
import { GoogleAuth, GOOGLE_COOKIE, maskEmail, parseGoogleConfig, type GoogleConfig } from './google';
import { loginPage } from './pages';

setQuiet(true);

const DOMAIN = 'hub.finstar.pp.ua';
const CID = '1234567890-abcdef.apps.googleusercontent.com';
const CSECRET = 'GOCSPX-supersecretvalue_123';
const SECRET = Buffer.alloc(32, 9);
const HASH_TEXT = await hashPassword('correct horse battery', 10);
const CFG = { user: 'ana', passwordHash: parsePasswordHash(HASH_TEXT)!, passwordHashText: HASH_TEXT };
const O = { Origin: `https://${DOMAIN}` };
const ENV = { HABBLAUD_REMOTE_USER: 'ana', HABBLAUD_REMOTE_PASSWORD_HASH: HASH_TEXT, HABBLAUD_REMOTE_DOMAIN: DOMAIN, HABBLAUD_REMOTE_GOOGLE_CLIENT_ID: CID, HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET: CSECRET, HABBLAUD_REMOTE_GOOGLE_EMAILS: 'Me@Gmail.com, you@gmail.com' };

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

const b64j = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (c: Record<string, unknown>) => `${b64j({ alg: 'RS256' })}.${b64j(c)}.sig`;

async function setup(o: { limit?: number; token?: (nonce: string) => Record<string, unknown>; reply?: (body: URLSearchParams) => Response | Promise<Response>; timeoutMs?: number } = {}) {
  let now = 1_800_000_000_000;
  const lines: string[] = [];
  const exchanges: URLSearchParams[] = [];
  let nonce = '';
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    exchanges.push(body);
    if (o.reply) return o.reply(body);
    const claims = { iss: 'https://accounts.google.com', aud: CID, exp: Math.floor(now / 1000) + 3600, nonce, email: 'me@gmail.com', email_verified: true, ...o.token?.(nonce) };
    return new Response(JSON.stringify({ id_token: idToken(claims), access_token: 'AT-secret' }), { status: 200 });
  }) as unknown as typeof fetch;
  const cfg = parseGoogleConfig(ENV, DOMAIN)!;
  const sessions = new RemoteSessions(SECRET, CFG, () => now);
  const google = new GoogleAuth(cfg, SECRET, { fetch: fakeFetch, now: () => now, timeoutMs: o.timeoutMs });
  const gate = createRemoteGate({
    config: CFG, sessions, secure: true, domain: DOMAIN, google,
    failures: new FailureWindow(o.limit ?? 5, 600_000, () => now),
    throttle: new LoginThrottle(() => now),
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
  });
  const mainGuard = createRequestGuard({ allowedHosts: new Set(['casa.lan']) });
  const server = http.createServer((req, res) => {
    if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  closers.push(() => new Promise<void>((ok) => server.close(() => ok())));
  const port = (server.address() as AddressInfo).port;
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((ok, fail) => {
      const r = http.request({ host: '127.0.0.1', port, path, method, headers: { 'CF-Connecting-IP': '203.0.113.7', Host: DOMAIN, ...headers } }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: b }));
      });
      r.on('error', fail);
      r.end();
    });
  const passwordLogin = () =>
    new Promise<string>((ok, fail) => {
      const body = JSON.stringify({ user: 'ana', password: 'correct horse battery' });
      const r = http.request({ host: '127.0.0.1', port, path: '/api/remote/login', method: 'POST', headers: { ...O, Host: DOMAIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.50' } }, (res) => {
        res.resume();
        res.on('end', () => ok(String(res.headers['set-cookie']?.[0])));
      });
      r.on('error', fail);
      r.end(body);
    });
  const start = async (headers: Record<string, string> = {}) => {
    const r = await get('/api/remote/google/start', headers);
    const loc = r.status === 302 ? new URL(r.headers.location!) : undefined;
    nonce = loc?.searchParams.get('nonce') ?? '';
    const cookie = String(r.headers['set-cookie']?.[0] ?? '').split(';')[0];
    return { r, loc, cookie };
  };
  const callback = (code: string, state: string | undefined, cookie?: string, headers: Record<string, string> = {}) =>
    get(`/api/remote/google/callback?code=${code}${state === undefined ? '' : `&state=${state}`}`, { ...(cookie ? { Cookie: cookie } : {}), ...headers });
  return { get, passwordLogin, start, callback, lines, exchanges, sessions, mainGuard, tick: (ms: number) => (now += ms), now: () => now, gate };
}
const FAIL = '/login?e=google';
const cleared = (r: { headers: http.IncomingHttpHeaders }) => (r.headers['set-cookie'] as string[]).some((c) => c.startsWith(`${GOOGLE_COOKIE}=;`) && /Max-Age=0/.test(c));

describe('Google config', () => {
  it('on only with domain, id, secret and a non-empty valid allowlist (lower-cased)', () => {
    const c = parseGoogleConfig(ENV, DOMAIN)!;
    expect([...c.emails]).toEqual(['me@gmail.com', 'you@gmail.com']);
    expect(c.redirectUri).toBe(`https://${DOMAIN}/api/remote/google/callback`);
    expect(parseGoogleConfig(ENV, undefined)).toBeUndefined();
    expect(parseGoogleConfig({ ...ENV, HABBLAUD_REMOTE_GOOGLE_EMAILS: '' }, DOMAIN)).toBeUndefined();
    expect(parseGoogleConfig({ ...ENV, HABBLAUD_REMOTE_GOOGLE_EMAILS: 'a@b.com,$(x)' }, DOMAIN)).toBeUndefined();
    expect(parseGoogleConfig({ ...ENV, HABBLAUD_REMOTE_GOOGLE_CLIENT_ID: undefined }, DOMAIN)).toBeUndefined();
    expect(parseGoogleConfig({ ...ENV, HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET: undefined }, DOMAIN)).toBeUndefined();
  });
  it('parseRemoteConfig carries it only in domain mode', () => {
    expect(parseRemoteConfig(ENV).config?.google?.clientId).toBe(CID);
    expect(parseRemoteConfig({ ...ENV, HABBLAUD_REMOTE_GOOGLE_EMAILS: '' }).config).not.toHaveProperty('google');
    expect(parseRemoteConfig({ ...ENV, HABBLAUD_REMOTE_DOMAIN: undefined, HABBLAUD_REMOTE_INSECURE_HTTP: '1' }).config?.google).toBeUndefined();
  });
  it('masks the email', () => expect(maskEmail('abc@gmail.com')).toBe('a***@gmail.com'));
});

describe('Google sign-in flow', () => {
  it('start: 302 to Google with PKCE S256, nonce, state, exact redirect_uri from the domain even with a hostile Host; cookie flags', async () => {
    const s = await setup();
    const { r, loc, cookie } = await s.start({ Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' });
    expect(r.status).toBe(302);
    expect(loc!.origin + loc!.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = loc!.searchParams;
    expect(q.get('redirect_uri')).toBe(`https://${DOMAIN}/api/remote/google/callback`);
    expect(q.get('client_id')).toBe(CID);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid email');
    expect(q.get('prompt')).toBe('select_account');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toMatch(/^[\w-]{43}$/);
    expect(q.get('nonce')).toBeTruthy();
    expect(r.headers['set-cookie']![0]).toMatch(new RegExp(`^${GOOGLE_COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$`));
    // PKCE: the verifier in the cookie hashes to the challenge, and is sent at the exchange.
    const verifier = readCookie(cookie, GOOGLE_COOKIE)!.split('.')[1];
    expect(q.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    await s.callback('CODE1', q.get('state')!, cookie);
    expect(s.exchanges[0].get('code_verifier')).toBe(verifier);
    expect(s.exchanges[0].get('redirect_uri')).toBe(`https://${DOMAIN}/api/remote/google/callback`);
    expect(s.exchanges[0].get('client_secret')).toBe(CSECRET);
  });

  it('success: same session cookie as password login, 302 to /, oauth cookie cleared, recent() true, masked email logged, allowlist is case-insensitive', async () => {
    const s = await setup({ token: () => ({ email: 'ME@Gmail.com' }) });
    const { loc, cookie } = await s.start();
    const r = await s.callback('CODE', loc!.searchParams.get('state')!, cookie);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
    const sc = r.headers['set-cookie'] as string[];
    const session = sc.find((c) => c.startsWith('__Host-habblaud_remote='))!;
    expect(cleared(r)).toBe(true);
    const pw = await s.passwordLogin();
    expect(session.replace(/^[^;]*/, '')).toBe(pw.replace(/^[^;]*/, '')); // same name, flags and lifetime as the password login
    expect(session.split('=')[0]).toBe(pw.split('=')[0]);
    const token = session.split(';')[0].split('=')[1];
    expect(s.sessions.verify(token)).toBe(true);
    expect(s.sessions.recent(token, 10 * 60_000)).toBe(true);
    const info = s.lines.find((l) => l.includes('google,'))!;
    expect(info).toContain('m***@gmail.com');
    expect(info).toContain('203.0.113.7');
  });

  it('fails closed with one generic redirect: no cookie, missing params, state mismatch, replay', async () => {
    const s = await setup({ limit: 100 });
    const a = await s.start();
    const st = a.loc!.searchParams.get('state')!;
    for (const r of [
      await s.callback('C', st), // no cookie
      await s.callback('C', undefined, a.cookie), // no state
      await s.callback('C', 'x'.repeat(43), a.cookie), // mismatch
      await s.get('/api/remote/google/callback', { Cookie: a.cookie }), // no code
      await s.get('/api/remote/google/callback?error=access_denied&state=' + st, { Cookie: a.cookie }),
      await s.callback('C', st, a.cookie.slice(0, -2) + 'xx'), // tampered signature
    ]) {
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe(FAIL);
      expect(cleared(r)).toBe(true);
      expect(r.headers['set-cookie']).toHaveLength(1);
    }
    expect(s.exchanges).toHaveLength(0);
    // replay: the first good callback uses the state up, the same cookie cannot be used again
    expect((await s.callback('C', st, a.cookie)).headers.location).toBe('/');
    expect((await s.callback('C', st, a.cookie)).headers.location).toBe(FAIL);
    expect(s.exchanges).toHaveLength(1);
    // an expired cookie
    const b = await s.start();
    s.tick(11 * 60_000);
    expect((await s.callback('C', b.loc!.searchParams.get('state')!, b.cookie)).headers.location).toBe(FAIL);
  });

  const bad: Array<[string, (n: string) => Record<string, unknown>]> = [
    ['wrong aud', () => ({ aud: 'other.apps.googleusercontent.com' })],
    ['wrong iss', () => ({ iss: 'https://evil.example' })],
    ['expired', () => ({ exp: 1 })],
    ['wrong nonce', () => ({ nonce: 'nope' })],
    ['missing nonce', () => ({ nonce: undefined })],
    ['email_verified false', () => ({ email_verified: false })],
    ['email_verified as string', () => ({ email_verified: 'true' })],
    ['email not allowlisted', () => ({ email: 'stranger@gmail.com' })],
    ['email missing', () => ({ email: undefined })],
  ];
  it.each(bad)('id_token with %s: no session, generic failure, counted', async (_n, token) => {
    const s = await setup({ token });
    const { loc, cookie } = await s.start();
    const r = await s.callback('C', loc!.searchParams.get('state')!, cookie);
    expect(r.headers.location).toBe(FAIL);
    expect(String(r.headers['set-cookie'])).not.toContain('habblaud_remote=');
    expect(s.lines.some((l) => /google: /.test(l))).toBe(true);
  });
  it('accepts the bare accounts.google.com issuer', async () => {
    const s = await setup({ token: () => ({ iss: 'accounts.google.com' }) });
    const { loc, cookie } = await s.start();
    expect((await s.callback('C', loc!.searchParams.get('state')!, cookie)).headers.location).toBe('/');
  });

  const replies: Array<[string, () => Response | Promise<Response>]> = [
    ['4xx', () => new Response('{"error":"invalid_grant"}', { status: 400 })],
    ['garbage JSON', () => new Response('<html>nope', { status: 200 })],
    ['no id_token', () => new Response('{}', { status: 200 })],
    ['id_token not a JWT', () => new Response('{"id_token":"abc"}', { status: 200 })],
    ['network error', () => { throw new Error('ECONNRESET'); }],
  ];
  it.each(replies)('token endpoint %s fails closed', async (_n, reply) => {
    const s = await setup({ reply });
    const { loc, cookie } = await s.start();
    const r = await s.callback('C', loc!.searchParams.get('state')!, cookie);
    expect(r.headers.location).toBe(FAIL);
  });
  it('token endpoint timeout fails closed', async () => {
    const g = new GoogleAuth(parseGoogleConfig(ENV, DOMAIN)!, SECRET, {
      timeoutMs: 30,
      fetch: ((_u: string, init: RequestInit) => new Promise((_ok, fail) => init.signal!.addEventListener('abort', () => fail(new Error('aborted'))))) as never,
    });
    const { location, cookie } = g.start();
    const st = new URL(location).searchParams.get('state')!;
    expect(await g.finish({ code: 'C', state: st }, cookie)).toEqual({ ok: false, reason: 'exchange' });
  });

  it('failures share the FailureWindow: 429 after the limit, then free after the window', async () => {
    const s = await setup({ limit: 3 });
    for (let i = 0; i < 3; i++) expect((await s.callback('C', 'x', undefined)).status).toBe(302);
    const r = await s.callback('C', 'x', undefined);
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await s.start()).r.status).toBe(302); // start has its own window
    s.tick(601_000);
    expect((await s.callback('C', 'x', undefined)).status).toBe(302);
  });
  it('start has its own per-IP limit', async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++) expect((await s.start()).r.status).toBe(302);
    expect((await s.start()).r.status).toBe(429);
    expect((await s.start({ 'CF-Connecting-IP': '203.0.113.9' })).r.status).toBe(302);
  });

  it('no secret, token, code, verifier or state reaches the logs', async () => {
    const s = await setup({ limit: 100, token: () => ({ email: 'stranger@gmail.com' }) });
    const { loc, cookie } = await s.start();
    await s.callback('SECRETCODE-123', loc!.searchParams.get('state')!, cookie);
    await s.callback('SECRETCODE-456', 'zzz', cookie);
    const verifier = readCookie(cookie, GOOGLE_COOKIE)!.split('.')[1];
    const all = s.lines.join('\n');
    for (const bit of [CSECRET, 'AT-secret', 'SECRETCODE', verifier, loc!.searchParams.get('state')!, 'id_token', 'stranger']) expect(all).not.toContain(bit);
  });

  it('only GET; unknown google paths 404', async () => {
    const s = await setup();
    expect((await s.get('/api/remote/google/start', O, 'POST')).status).toBe(405);
    expect((await s.get('/api/remote/google/callback', O, 'POST')).status).toBe(405);
    expect((await s.get('/api/remote/google/other')).status).toBe(404);
  });
});

describe('Google off, page and main port', () => {
  it('without Google configured the routes answer 404 and the page has no button', async () => {
    let now = 1_800_000_000_000;
    const gate = createRemoteGate({ config: CFG, sessions: new RemoteSessions(SECRET, CFG, () => now), secure: true, domain: DOMAIN });
    const server = http.createServer((req, res) => { if (!gate(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(204).end(); });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    closers.push(() => new Promise<void>((ok) => server.close(() => ok())));
    const port = (server.address() as AddressInfo).port;
    const get = async (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });
    expect((await get('/api/remote/google/start')).status).toBe(404);
    expect((await get('/api/remote/google/callback?code=a&state=b')).status).toBe(404);
    expect(await (await get('/login')).text()).not.toContain('google');
    void now;
  });
  it('login page: button only when enabled, error text only with ?e=google, CSP unchanged', async () => {
    const s = await setup();
    const on = await s.get('/login?e=google');
    expect(on.body).toContain('href="/api/remote/google/start"');
    expect(on.body).toContain("Couldn't sign in with Google.");
    expect(on.headers['content-security-policy']).toContain("form-action 'self'");
    expect((await s.get('/login')).body).not.toContain("Couldn't sign in with Google.");
    expect(loginPage({ caDownload: false, passkeys: false, password: true })).not.toContain('google/start');
  });
  it('the main port (Host = hub domain) refuses the Google routes with 403', async () => {
    const s = await setup();
    for (const p of ['/api/remote/google/start', '/api/remote/google/callback?code=a&state=b']) {
      const res = { code: 0, writeHead(c: number) { res.code = c; return res; }, end() {} };
      expect(s.mainGuard({ headers: { host: DOMAIN }, method: 'GET', url: p } as never, res as never)).toBe(true);
      expect(res.code).toBe(403);
    }
  });
});

describe('remote:setup Google options', () => {
  const base = proxyEnv('', { user: 'bang', hash: 'scrypt:15:8:1:a+/=:b', domain: DOMAIN, port: 4748 });
  const withG = googleEnv(base, { clientId: CID, emails: ['me@gmail.com', 'you@gmail.com'], secret: CSECRET });
  const KEYS = ['HABBLAUD_REMOTE_GOOGLE_CLIENT_ID', 'HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET', 'HABBLAUD_REMOTE_GOOGLE_EMAILS'];

  it('parseArgs: valid values, lower-cased repeatable emails, secret never an option', () => {
    expect(parseArgs(['--google-client-id', CID, '--google-email', 'Me@Gmail.com,you@gmail.com', '--google-email', 'x@y.org'])).toMatchObject({ googleClientId: CID, googleEmails: ['me@gmail.com', 'you@gmail.com', 'x@y.org'] });
    expect(parseArgs(['--google', 'off']).googleOff).toBe(true);
    for (const bad of [['--google-client-id', "a'b;touch x"], ['--google-client-id', '$(x)aaaaaaaaaa'], ['--google-client-id', 'short'], ['--google-email', 'a@b'], ['--google-email', 'a;b@c.com'], ['--google-email', '$(x)@c.com'], ['--google-email', 'a@b.com\nc@d.com'], ['--google', 'on'], ['--google-email', "a'b@c.com"], ['--google-email', 'a b@c.com']]) {
      expect(() => parseArgs(bad), bad.join(' ')).toThrow();
    }
    expect(() => parseArgs(['--google-secret', CSECRET])).toThrow(/never an option/);
    try { parseArgs([`--google-secret=${CSECRET}`]); } catch (e) { expect((e as Error).message).not.toContain(CSECRET); }
    expect(() => parseArgs(['--google', 'off', '--google-email', 'a@b.com'])).toThrow();
    expect(() => parseArgs(['--google-secret-stdin', '--password-stdin'])).toThrow();
  });

  it('googleEnv: single-quoted, needs the domain and all three, rejects hostile values without echoing the secret', () => {
    for (const k of KEYS) expect(withG).toMatch(new RegExp(`^${k}='[^']*'$`, 'm'));
    expect(readEnvValue(withG, 'HABBLAUD_REMOTE_GOOGLE_EMAILS')).toBe('me@gmail.com,you@gmail.com');
    expect(() => googleEnv('', { clientId: CID, emails: ['a@b.com'], secret: CSECRET })).toThrow(/domain/);
    expect(() => googleEnv(base, { clientId: CID, emails: ['a@b.com'] })).toThrow(/secret/);
    expect(() => googleEnv(base, { clientId: CID, secret: CSECRET })).toThrow(/email/);
    for (const secret of ["x';touch /tmp/p;'aaaaaaaa", '$(touch /tmp/p)aaaaaaaa', 'aaaaaaaa\nHABBLAUD_X=1', 'aaaa aaaa', 'a`b`aaaaaaaa']) {
      expect(() => googleEnv(base, { clientId: CID, emails: ['a@b.com'], secret })).toThrow(/invalid Google client secret$/);
    }
    expect(() => googleEnv(base, { clientId: CID, emails: ['a$(x)@b.com'], secret: CSECRET })).toThrow();
  });

  it('a hub.env with the Google keys, sourced by sh and by the loader, is data only', () => {
    const d = tempDir();
    closers.push(async () => d.cleanup());
    const file = join(d.dir, 'hub.env');
    writeFileSync(file, withG);
    const r = spawnSync('sh', ['-c', `. '${join(__dirname, '../../scripts/hub-env.sh')}'; load_hub_env '${file}'; printf %s "$HABBLAUD_REMOTE_GOOGLE_CLIENT_ID|$HABBLAUD_REMOTE_GOOGLE_CLIENT_SECRET|$HABBLAUD_REMOTE_GOOGLE_EMAILS"`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    expect(r.stdout).toBe(`${CID}|${CSECRET}|me@gmail.com,you@gmail.com`);
  });

  it('a rerun without Google flags keeps the keys (remoteEnv and proxyEnv), a Google-only change keeps everything else, --google off removes only them', () => {
    const again = proxyEnv(withG, { user: 'bang', hash: 'scrypt:15:8:1:n+/=:n', domain: DOMAIN, port: 4748 });
    for (const k of KEYS) expect(readEnvValue(again, k)).toBe(readEnvValue(withG, k));
    expect(readEnvValue(remoteEnv(withG, { user: 'bang', hash: 'h', name: 'hub', port: 4748 }), KEYS[0])).toBe(CID);
    const onlyEmails = googleEnv(withG, { emails: ['new@gmail.com'] });
    expect(readEnvValue(onlyEmails, KEYS[2])).toBe('new@gmail.com');
    expect(readEnvValue(onlyEmails, KEYS[1])).toBe(CSECRET);
    expect(readEnvValue(onlyEmails, 'HABBLAUD_REMOTE_PASSWORD_HASH')).toBe(readEnvValue(withG, 'HABBLAUD_REMOTE_PASSWORD_HASH'));
    const off = googleEnv(withG, { off: true });
    for (const k of KEYS) expect(off).not.toContain(k);
    expect(off).toBe(base);
  });
});
