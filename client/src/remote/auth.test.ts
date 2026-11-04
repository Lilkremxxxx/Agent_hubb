import { describe, expect, it } from 'vitest';
import { addPasskey, signInWithPasskey, signInWithPassword, type Post } from './auth';

const T = { failed: 'F', cancelled: 'C', offline: 'O' };
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
    expect(await signInWithPasskey(ok, async () => { throw new Error('NotAllowedError'); }, T)).toBe('C');
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
});
