import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSnapshot } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office, type OfficeDeps } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler, type ApiDeps } from './app';
import { createRequestGuard, hostAllowed, hostnameOf, isLoopbackHost, originAllowed, parseAllowedHosts } from './guard';
import { Hub } from './sse';
import { createStaticHandler, IMMUTABLE, REVALIDATE } from './static';

setQuiet(true);

interface Env {
  base: string;
  office: Office;
  close: () => Promise<void>;
}

async function start(extra: Partial<ApiDeps> = {}, officeExtra: Partial<OfficeDeps> = {}): Promise<Env & { cleanup: () => void }> {
  const tmp = tempDir();
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const dist = join(tmp.dir, 'dist');
  mkdirSync(join(dist, 'assets', 'brand'), { recursive: true });
  mkdirSync(join(dist, 'bundle'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Habblaud</title>');
  writeFileSync(join(dist, 'bundle', 'main-abc12345.js'), 'console.log(1)');
  writeFileSync(join(dist, 'assets', 'brand', 'logo-mark.png'), 'png');
  writeFileSync(join(dist, 'assets', 'manifest.json'), '{}');
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: '9.9.9',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: () => undefined,
    ...officeExtra,
  });
  late.office = office;
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: '9.9.9', ...extra });
  const serveStatic = createStaticHandler(dist);
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://x');
    if (!api(req, res, url)) serveStatic(req, res, url.pathname);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  office.addMain({ id: '.claude:1', account: '.claude', sessionId: 's1', cwd: '/p/loja', role: 'Main agent', startedAt: Date.now(), status: 'working' });
  return {
    base: `http://127.0.0.1:${port}`,
    office,
    close: () =>
      new Promise((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => ok());
      }),
    cleanup: tmp.cleanup,
  };
}

async function snapshotOf(base: string): Promise<OfficeSnapshot> {
  return (await (await fetch(`${base}/api/snapshot`)).json()) as OfficeSnapshot;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Raw request (fetch does not allow overriding Host header). */
function raw(base: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end(opts.body);
  });
}

describe('API HTTP', () => {
  let env: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => {
    env = await start();
  });
  afterEach(async () => {
    await env.close();
    env.cleanup();
  });

  it('GET /api/snapshot', async () => {
    const res = await fetch(`${env.base}/api/snapshot`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const snap = (await res.json()) as OfficeSnapshot;
    expect(snap.rev).toBeGreaterThan(0);
    expect(snap.agents.map((a) => a.id)).toEqual(['.claude:1']);
    expect(snap.accounts[0]).toMatchObject({ id: '.claude', sessions: 1 });
    expect(snap.meta.version).toBe('9.9.9');
  });

  it('GET /api/stream sends retry, snapshot, and feed; then updates', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${env.base}/api/stream`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async (re: RegExp) => {
      while (!re.test(text)) text += dec.decode((await reader.read()).value, { stream: true });
    };
    await readUntil(/event: feed\n/);
    expect(text).toMatch(/^retry: 2000\n\nevent: snapshot\ndata: \{/);
    env.office.addActivity('.claude:1', { id: 'act-x', at: Date.now(), kind: 'read', icon: '📖', text: 'Reading a.ts' }, true);
    await readUntil(/"id":"act-x"/);
    expect(text).toContain('event: feed\ndata: [{"id":"act-x"');
    ctrl.abort();
  });

  it('GET /api/agents/:id and /api/health', async () => {
    const ok = await fetch(`${env.base}/api/agents/${encodeURIComponent('.claude:1')}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ agent: { id: '.claude:1' }, history: [] });
    expect((await fetch(`${env.base}/api/agents/does-not-exist`)).status).toBe(404);
    const health = await (await fetch(`${env.base}/api/health`)).json();
    expect(health).toMatchObject({ ok: true, version: '9.9.9', terminal: false, accounts: [{ id: '.claude', usageStatus: 'disabled' }] });
  });

  it('answers 404 for removed APIs', async () => {
    for (const p of ['/api/world', '/api/timeline', '/api/permissions', '/api/rules', '/api/board']) {
      const r = await fetch(`${env.base}${p}`);
      expect(r.status, p).toBe(404);
    }
  });

  it('terminal disabled: 403 JSON and meta.terminal false', async () => {
    const res = await fetch(`${env.base}/api/agents/${encodeURIComponent('.claude:1')}/terminal`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/disabled/);
    expect((await snapshotOf(env.base)).meta.terminal).toBe(false);
  });

  it('character: PUT and DELETE disabled without terminal (403)', async () => {
    const res = await fetch(`${env.base}/api/agents/${encodeURIComponent('.claude:1')}/character`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Ana', seed: 1, parts: {} }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/disabled/);
    const del = await fetch(`${env.base}/api/agents/${encodeURIComponent('.claude:1')}/character`, { method: 'DELETE', headers: JSON_HEADERS, body: '{}' });
    expect(del.status).toBe(403);
    expect(((await del.json()) as { error: string }).error).toMatch(/disabled/);
  });

  it('DNS rebinding: external Host domain rejected on all routes', async () => {
    const port = new URL(env.base).port;
    for (const path of ['/api/snapshot', '/api/stream', '/', '/bundle/main-abc12345.js']) {
      const r = await raw(env.base, path, { headers: { Host: `attacker.example:${port}` } });
      expect(r.status).toBe(403);
      expect(r.body).not.toContain('"agents"');
    }
    expect((await raw(env.base, '/api/health', { headers: { Host: `localhost:${port}` } })).status).toBe(200);
    expect((await raw(env.base, '/api/health', { headers: { Host: `[::1]:${port}` } })).status).toBe(200);
    expect((await raw(env.base, '/api/health', { headers: { Host: `192.168.0.10:${port}` } })).status).toBe(200);
    expect((await raw(env.base, '/api/health', { headers: { Host: `habblaud.lan:${port}` } })).status).toBe(200);
  });

  it('CSRF: POST requires JSON and local origin', async () => {
    const body = '{}';
    // "Simple" form/fetch from external site: text/plain, no preflight.
    const plain = await fetch(`${env.base}/api/fun/party`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
    expect(plain.status).toBe(415);
    const form = await raw(env.base, '/api/fun/party', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
    expect(form.status).toBe(415);
    const cross = await raw(env.base, '/api/fun/party', { method: 'POST', headers: { ...JSON_HEADERS, Origin: 'http://attacker.example' }, body });
    expect(cross.status).toBe(403);
    const port = new URL(env.base).port;
    const same = await raw(env.base, '/api/fun/party', { method: 'POST', headers: { ...JSON_HEADERS, Host: `localhost:${port}`, Origin: `http://localhost:${port}` }, body });
    expect(same.status).toBe(200);
  });

  it('JSON responses with nosniff and CORP same-origin; no CORS', async () => {
    const res = await fetch(`${env.base}/api/snapshot`, { headers: { Origin: 'http://attacker.example' } });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('unknown routes: 404 JSON (including legacy POST /api/usage, which no longer exists)', async () => {
    const res = await fetch(`${env.base}/api/nothing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown route' });
    const usage = await fetch(`${env.base}/api/usage`, { method: 'POST', headers: JSON_HEADERS, body: '{"accounts":[]}' });
    expect(usage.status).toBe(404);
  });

  it('static assets: SPA fallback, immutable only under /bundle (hashed), revalidation elsewhere', async () => {
    const page = await fetch(`${env.base}/room/any`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Habblaud</title>');
    expect(page.headers.get('cache-control')).toBe(REVALIDATE);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const bundle = await fetch(`${env.base}/bundle/main-abc12345.js`);
    expect(bundle.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(bundle.headers.get('content-type')).toMatch(/javascript/);
    // client/public: fixed name, may change per build.
    for (const path of ['/assets/brand/logo-mark.png', '/assets/manifest.json']) {
      const res = await fetch(`${env.base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(REVALIDATE);
      const etag = res.headers.get('etag')!;
      expect(etag).toMatch(/^W\/"/);
      expect(res.headers.get('last-modified')).toBeTruthy();
      const again = await fetch(`${env.base}${path}`, { headers: { 'If-None-Match': etag } });
      expect(again.status).toBe(304);
      const since = await fetch(`${env.base}${path}`, { headers: { 'If-Modified-Since': res.headers.get('last-modified')! } });
      expect(since.status).toBe(304);
      const stale = await fetch(`${env.base}${path}`, { headers: { 'If-None-Match': 'W/"other"' } });
      expect(stale.status).toBe(200);
    }
    expect((await fetch(`${env.base}/assets/does-not-exist.js`)).status).toBe(404);
    expect((await fetch(`${env.base}/bundle/does-not-exist.js`)).status).toBe(404);
    // Directory traversal attempts fall back to index.html, never escaping directory.
    const escape = await fetch(`${env.base}/..%2F..%2Fetc%2Fpasswd`);
    expect(await escape.text()).toContain('<title>Habblaud</title>');
  });
});

describe('project character (PUT/DELETE /api/agents/:id/character)', () => {
  let env: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => {
    env = await start({ terminal: true });
  });
  afterEach(async () => {
    await env.close();
    env.cleanup();
  });

  const url = (id = '.claude:1') => `${env.base}/api/agents/${encodeURIComponent(id)}/character`;
  const put = (body: unknown, id?: string) => fetch(url(id), { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });
  const agentOf = async (id = '.claude:1') => (await snapshotOf(env.base)).agents.find((a) => a.id === id)!;

  it('PUT saves and snapshot reflects name, seed, parts, and custom; DELETE reverts to seed draw', async () => {
    const before = await agentOf();
    const res = await put({ name: '  Ana   Backend ', seed: 7, parts: { hairStyle: 'bob', skin: '#5A3623' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await vi.waitFor(async () =>
      expect(await agentOf()).toMatchObject({ name: 'Ana Backend', seed: 7, parts: { skin: '#5a3623', hairStyle: 'bob' }, custom: true }),
    );
    const del = await fetch(url(), { method: 'DELETE', headers: JSON_HEADERS, body: '{}' });
    expect(del.status).toBe(200);
    await vi.waitFor(async () => expect(await agentOf()).toMatchObject({ name: before.name, seed: before.seed }));
    expect((await agentOf()).custom).toBeUndefined();
  });

  it('400 for invalid name, seed, or parts', async () => {
    for (const body of [
      { name: '', seed: 1, parts: {} },
      { name: 'a'.repeat(25), seed: 1, parts: {} },
      { name: 'Ana', seed: -1, parts: {} },
      { name: 'Ana', seed: 1, parts: { skin: 'red' } },
      { name: 'Ana', seed: 1, parts: { lanyard: '#ffffff' } },
      { name: 'Ana', seed: 1 },
      { name: 'Ana', seed: 1, parts: null },
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('404 for subagent and unknown agent; 409 for name already in office', async () => {
    env.office.addSub({ id: 's1:x', parentId: '.claude:1', sessionId: 's1', role: 'Explore', background: false, startedAt: Date.now() });
    expect((await put({ name: 'Ana', seed: 1, parts: {} }, 's1:x')).status).toBe(404);
    expect((await put({ name: 'Ana', seed: 1, parts: {} }, 'does-not-exist')).status).toBe(404);
    for (const id of ['s1:x', 'does-not-exist']) expect((await fetch(url(id), { method: 'DELETE', headers: JSON_HEADERS, body: '{}' })).status).toBe(404);
    env.office.addMain({ id: '.claude:2', account: '.claude', sessionId: 's2', cwd: '/p/web', role: 'Main agent', startedAt: Date.now(), status: 'working' });
    const other = env.office.get('.claude:2')!.name;
    const res = await put({ name: other, seed: 1, parts: {} });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(`${other} is already in the office, in web`);
  });

  it('403 with non-loopback Host (even if allowed in HABBLAUD_ALLOWED_HOSTS); 405 for GET', async () => {
    const port = new URL(env.base).port;
    const r = await raw(env.base, `/api/agents/${encodeURIComponent('.claude:1')}/character`, {
      method: 'PUT',
      headers: { ...JSON_HEADERS, Host: `habblaud.lan:${port}` },
      body: JSON.stringify({ name: 'Ana', seed: 1, parts: {} }),
    });
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/computer running Habblaud/);
    const get = await fetch(url());
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('PUT, DELETE');
  });
});

describe('Host/Origin guard', () => {
  const allowed = parseAllowedHosts(' My-Mac.local:4747 , habblaud.lan ');

  it('hostnameOf and HABBLAUD_ALLOWED_HOSTS', () => {
    expect([...allowed]).toEqual(['my-mac.local', 'habblaud.lan']);
    expect(hostnameOf('LocalHost:4747')).toBe('localhost');
    expect(hostnameOf('[::1]:4747')).toBe('::1');
    expect(hostnameOf('a b')).toBeUndefined();
    expect(hostnameOf('[::1]trash')).toBeUndefined();
  });

  it('Host: IPs, localhost and allowlisted allowed; external domains rejected', () => {
    expect(hostAllowed(undefined, allowed)).toBe(true);
    for (const h of ['localhost:4747', 'app.localhost', '127.0.0.1:4747', '[::1]:1', '10.0.0.5:4747', 'my-mac.local:4747']) expect(hostAllowed(h, allowed)).toBe(true);
    for (const h of ['attacker.example:4747', 'localhost.attacker.example', '127.0.0.1.nip.io', '', 'x y']) expect(hostAllowed(h, allowed)).toBe(false);
  });

  it('isLoopbackHost: localhost, *.localhost, 127.x and ::1 only (terminal)', () => {
    for (const h of ['localhost:4747', 'LOCALHOST', 'app.localhost:1', '127.0.0.1:4747', '127.8.9.10', '[::1]:4747']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of [undefined, '', '10.0.0.5:4747', '192.168.0.10', '0.0.0.0:4747', 'habblaud.lan', 'my-mac.local:4747', '[::]:4747', 'localhost.attacker.example', '127.0.0.1.nip.io', 'x y']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  it('Origin: absent, same-origin, or local', () => {
    expect(originAllowed(undefined, 'localhost:4747', allowed)).toBe(true);
    expect(originAllowed('http://localhost:4747', 'localhost:4747', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', '127.0.0.1:4747', allowed)).toBe(true); // Vite dev with proxy
    expect(originAllowed('http://192.168.0.10:4747', '192.168.0.10:4747', allowed)).toBe(true);
    expect(originAllowed('http://attacker.example', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('http://1.2.3.4', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('null', 'localhost:4747', allowed)).toBe(false);
    expect(originAllowed('file://', 'localhost:4747', allowed)).toBe(false);
  });
});

describe('POST /api/team {openBoss}', () => {
  it('opens the boss through deps.team.openBoss and returns its terminal; 503 without it; errors pass through', async () => {
    const pty = { id: 'p1-9', pid: 9, cwd: '/w/p', account: '.claude', agentId: '.claude:9', startedAt: 1 };
    const env = await start({ team: { appoint: () => ({ ok: true }), openBoss: async () => ({ ok: true, pty }) } });
    const post = (body: unknown) => fetch(`${env.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
    const r = await post({ openBoss: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, pty });
    await env.close(); env.cleanup();
    const off = await start({ team: { appoint: () => ({ ok: true }) } });
    expect((await fetch(`${off.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: '{"openBoss":true}' })).status).toBe(503);
    await off.close(); off.cleanup();
    const bad = await start({ team: { appoint: () => ({ ok: true }), openBoss: async () => ({ ok: false, status: 400, error: 'no folder' }) } });
    const b = await fetch(`${bad.base}/api/team`, { method: 'POST', headers: JSON_HEADERS, body: '{"openBoss":true}' });
    expect([b.status, ((await b.json()) as { error: string }).error]).toEqual([400, 'no folder']);
    await bad.close(); bad.cleanup();
    const foe = await start({ team: { appoint: () => ({ ok: true }), openBoss: async () => ({ ok: true, pty }) } });
    const port = new URL(foe.base).port;
    expect((await raw(foe.base, '/api/team', { method: 'POST', headers: { ...JSON_HEADERS, Host: `habblaud.lan:${port}` }, body: '{"openBoss":true}' })).status).toBe(403);
    await foe.close(); foe.cleanup();
  });

  it('POST /api/advisor and GET /api/advisor/:id: the question, 409 with its code, 404, and only from this computer', async () => {
    const q = { id: 'a1', slot: 'W2', ref: 'T2', question: 'q', status: 'answered' as const, askedAt: 1, answer: 'A' };
    const env = await start({
      advisor: {
        ask: (i) => (i.question === 'busy' ? { ok: false, status: 409, code: 'boss-waiting', error: 'the boss is waiting for you: x' } : { ok: true, question: { ...q, question: i.question } }),
        wait: async (id) => (id === 'a1' ? q : undefined),
      },
    });
    try {
      const post = (body: unknown) => fetch(`${env.base}/api/advisor`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      let r = await post({ slot: 'W2', question: 'which?', office: '/w' });
      expect([r.status, ((await r.json()) as { question: { question: string } }).question.question]).toEqual([200, 'which?']);
      r = await post({ slot: 'W2', question: 'busy' });
      expect([r.status, await r.json()]).toEqual([409, { error: 'the boss is waiting for you: x', code: 'boss-waiting' }]);
      expect((await post({ slot: 'W2' })).status).toBe(400);
      expect((await fetch(`${env.base}/api/advisor/a1?wait=1`)).status).toBe(200);
      expect((await fetch(`${env.base}/api/advisor/nope`)).status).toBe(404);
      expect((await raw(env.base, '/api/advisor/a1', { headers: { Host: 'habblaud.lan' } })).status).toBe(403);
    } finally {
      await env.close();
      env.cleanup();
    }
  });

  it('the advisor routes: 405, 503 without the advisor, bad bodies and a bad id are 400', async () => {
    const ok = { ask: () => ({ ok: false as const, status: 409, error: 'x' }), wait: async () => undefined };
    const a = await start({ advisor: ok });
    const b = await start();
    try {
      const post = (base: string, body: string) => raw(base, '/api/advisor', { method: 'POST', headers: JSON_HEADERS, body });
      expect((await raw(a.base, '/api/advisor')).status).toBe(405);
      expect((await raw(a.base, '/api/advisor/x', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(405);
      for (const body of ['null', '[]', '{"slot":"W2","question":"q","office":5}']) expect((await post(a.base, body)).status).toBe(400);
      expect((await raw(a.base, '/api/advisor/%E0%A4%A')).status).toBe(400);
      expect((await post(b.base, '{"slot":"W2","question":"q"}')).status).toBe(503);
    } finally {
      await a.close(); await b.close();
      a.cleanup(); b.cleanup();
    }
  });
});
