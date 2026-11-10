import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccess } from '../net/access';
import { stepUp, takeoverAgent } from './ptyapi';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.unstubAllGlobals(); setAccess(null); });

describe('stepUp', () => {
  it('asks for options, runs the passkey ceremony, verifies with the target, and returns the grant', async () => {
    const calls: Array<[string, unknown]> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, JSON.parse(String(init.body))]);
      return url.endsWith('/options') ? json(200, { challenge: 'c' }) : json(200, { grant: 'G', expiresInS: 60 });
    });
    const start = vi.fn(async () => ({ id: 'cred' }));
    expect(await stepUp({ ptyId: 'p1' }, start)).toBe('G');
    expect(start).toHaveBeenCalledWith({ challenge: 'c' });
    expect(calls).toEqual([['/api/remote/stepup/options', {}], ['/api/remote/stepup/verify', { response: { id: 'cred' }, ptyId: 'p1' }]]);
  });

  it('an agent target is sent as agentId', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return url.endsWith('/options') ? json(200, {}) : json(200, { grant: 'G' }); });
    await stepUp({ agentId: 'a1' }, async () => ({}));
    expect(bodies[1]).toMatchObject({ agentId: 'a1' });
  });

  it('a cancelled prompt (NotAllowedError or AbortError) gives the cancelled message and never verifies', async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    for (const name of ['NotAllowedError', 'AbortError']) {
      await expect(stepUp({ ptyId: 'p1' }, async () => { throw Object.assign(new Error('x'), { name }); })).rejects.toThrow('Passkey check cancelled.');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2); // options only
  });

  it('a server error shows its text; a network failure shows the usual message', async () => {
    vi.stubGlobal('fetch', async () => json(403, { error: 'only the owner can type in the terminal' }));
    await expect(stepUp({ ptyId: 'p1' }, async () => ({}))).rejects.toThrow('only the owner can type in the terminal');
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    await expect(stepUp({ ptyId: 'p1' }, async () => ({}))).rejects.toThrow("Habblaud didn't respond");
  });
});

describe('takeoverAgent', () => {
  it('local: one POST, no step-up', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return json(201, { id: 'p9' }); });
    expect(await takeoverAgent('a1')).toMatchObject({ id: 'p9' });
    expect(urls).toEqual(['/api/agents/a1/takeover']);
  });

  it('remote: step-up for the agent, then takeover with the grant, and the returned pty grant is passed on', async () => {
    setAccess({ remote: true, local: false, terminal: true, spawn: false, ptyStepUp: true });
    const seen: Array<[string, unknown]> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push([url, body]);
      if (url.endsWith('/options')) return json(200, {});
      if (url.endsWith('/verify')) return json(200, { grant: 'AG' });
      return json(201, { id: 'p9', grant: 'PG' });
    });
    const r = await takeoverAgent('a1', async () => ({ id: 'cred' }));
    expect(r).toMatchObject({ id: 'p9', grant: 'PG' });
    expect(seen[1]).toEqual(['/api/remote/stepup/verify', { response: { id: 'cred' }, agentId: 'a1' }]);
    expect(seen[2][0]).toBe('/api/agents/a1/takeover');
    expect(seen[2][1]).toMatchObject({ grant: 'AG' });
  });
});
