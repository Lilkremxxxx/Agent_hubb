import { describe, expect, it } from 'vitest';
import { addPasskey, removePasskey, signInWithPasskey, signInWithPassword, type Post } from './auth';

const T = { failed: 'F', cancelled: 'C', offline: 'O', unusable: 'U', exists: 'E' };
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('remote auth client', () => {
  it('passkey sign-in: options, then the ceremony, then verify with what the ceremony returned', async () => {
    const calls: Array<[string, unknown]> = [];
    const post: Post = async (p, b) => { calls.push([p, b]); return p.endsWith('/options') ? res(200, { challenge: 'c' }) : res(200, { ok: true }); };
    expect(await signInWithPasskey(post, async (o) => ({ id: 'cred-1', echo: o.optionsJSON }), T)).toBeUndefined();
    expect(calls).toEqual([['/api/remote/passkeys/login/options', {}], ['/api/remote/passkeys/login/verify', { id: 'cred-1', echo: { challenge: 'c' } }]]);
  });

  it('a cancelled ceremony, a server refusal and no network become texts, never throws', async () => {
    const ok: Post = async () => res(200, {});
    expect(await signInWithPasskey(ok, async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }, T)).toBe('C');
    expect(await signInWithPasskey(async (p) => (p.endsWith('/options') ? res(200, {}) : res(401, { error: 'Passkey not recognized.' })), async () => ({}), T)).toBe('Passkey not recognized.');
    expect(await signInWithPassword('u', 'p', async () => { throw new TypeError('fetch'); }, T)).toBe('O');
  });

  it('adding a passkey sends the name with the ceremony response; a 403 shows the server text', async () => {
    const calls: Array<[string, unknown]> = [];
    const post: Post = async (p, b) => { calls.push([p, b]); return res(200, {}); };
    expect(await addPasskey('Phone', post, async () => ({ id: 'n' }), T)).toBeUndefined();
    expect(calls[1]).toEqual(['/api/remote/passkeys/register/verify', { response: { id: 'n' }, name: 'Phone' }]);
    expect(await addPasskey('x', async () => res(403, { error: 'sign in again to change passkeys' }), async () => ({}), T)).toBe('sign in again to change passkeys');
  });

  it('only NotAllowed/Abort mean cancelled; a used authenticator is "exists"; anything else is "unusable"', async () => {
    const ok: Post = async () => res(200, {});
    const boom = (name: string): (() => Promise<never>) => async () => { throw Object.assign(new Error('x'), { name }); };
    expect(await signInWithPasskey(ok, boom('NotAllowedError'), T)).toBe('C');
    expect(await signInWithPasskey(ok, boom('AbortError'), T)).toBe('C');
    expect(await addPasskey('n', ok, boom('InvalidStateError'), T)).toBe('E');
    expect(await signInWithPasskey(ok, boom('SecurityError'), T)).toBe('U');
  });
});

describe('passkey changes once a passkey exists', () => {
  it('adding: step-up first, then the options call carries the grant, then the usual ceremony', async () => {
    const calls: Array<[string, unknown]> = [];
    const post: Post = async (p, b) => { calls.push([p, b]); return p.endsWith('/stepup/verify') ? res(200, { grant: 'G' }) : res(200, {}); };
    const seen: unknown[] = [];
    expect(await addPasskey('Phone', post, async (o) => { seen.push(o); return { id: 'n' }; }, T, true)).toBeUndefined();
    expect(calls.map((c) => c[0])).toEqual(['/api/remote/stepup/options', '/api/remote/stepup/verify', '/api/remote/passkeys/register/options', '/api/remote/passkeys/register/verify']);
    expect(calls[1][1]).toEqual({ response: { id: 'n' }, action: 'passkey:add' });
    expect(calls[2][1]).toEqual({ grant: 'G' });
    expect(seen).toHaveLength(2);
  });

  it('deleting sends the id and the grant; a cancelled prompt stops before any change', async () => {
    const calls: Array<[string, unknown]> = [];
    const post: Post = async (p, b) => { calls.push([p, b]); return p.endsWith('/stepup/verify') ? res(200, { grant: 'G' }) : res(200, {}); };
    expect(await removePasskey('cred-1', post, async () => ({ id: 'n' }), T, true)).toBeUndefined();
    expect(calls[2]).toEqual(['/api/remote/passkeys/delete', { id: 'cred-1', grant: 'G' }]);
    const calls2: string[] = [];
    const out = await removePasskey('cred-1', async (p) => { calls2.push(p); return res(200, {}); }, async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }, T, true);
    expect(out).toBe('C');
    expect(calls2).toEqual(['/api/remote/stepup/options']);
  });

  it('without an existing passkey (first one) nothing changes: no step-up', async () => {
    const calls: string[] = [];
    const post: Post = async (p) => { calls.push(p); return res(200, {}); };
    await removePasskey('x', post, async () => ({}), T, false);
    expect(calls).toEqual(['/api/remote/passkeys/delete']);
  });
});

