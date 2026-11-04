import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import * as webauthn from '@simplewebauthn/server';
import { CHALLENGE_TTL_MS, Challenges, cleanName, MAX_CHALLENGES, MAX_PASSKEYS, NAME_MAX, PasskeyService, PasskeyStore, type StoredPasskey, type WebAuthnLib } from './passkeys';

const pk = (id: string): StoredPasskey => ({ id, publicKey: 'AQID', counter: 0, transports: ['internal'], name: id, createdAt: 1 });
let t = tempDir();
beforeEach(() => { t = tempDir(); });
afterEach(() => t.cleanup());
const file = () => join(t.dir, 'remote', 'passkeys.json');

describe('passkey store', () => {
  it('add, touch and remove persist through a restart with mode 600; duplicates and the cap are refused', () => {
    const s = new PasskeyStore(file());
    expect(s.add(pk('a'))).toBe(true);
    expect(s.add(pk('a'))).toBe(false);
    s.touch('a', 7, 99);
    const again = new PasskeyStore(file());
    expect(again.get('a')).toMatchObject({ counter: 7, lastUsedAt: 99 });
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(statSync(join(t.dir, 'remote')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(t.dir, 'remote'))).toEqual(['passkeys.json']);
    expect(again.remove('a')).toBe(true);
    expect(again.remove('a')).toBe(false);
    expect(new PasskeyStore(file()).count()).toBe(0);
    for (let i = 0; i < MAX_PASSKEYS; i++) again.add(pk(`k${i}`));
    expect(again.add(pk('one-more'))).toBe(false);
  });

  it('a stale loose-mode tmp file does not leak its mode into the saved file', () => {
    mkdirSync(join(t.dir, 'remote'), { recursive: true });
    writeFileSync(`${file()}.tmp`, 'junk', { mode: 0o666 });
    expect(new PasskeyStore(file()).add(pk('a'))).toBe(true);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('a corrupt file loads as empty with a warning and stays untouched until a successful add', () => {
    mkdirSync(join(t.dir, 'remote'), { recursive: true });
    writeFileSync(file(), '{not json');
    const warn: string[] = [];
    const s = new PasskeyStore(file(), { warn: (m) => warn.push(m) });
    expect(s.count()).toBe(0);
    expect(warn[0]).toMatch(/passkeys\.json/);
    expect(s.remove('x')).toBe(false);
    s.touch('x', 1, 1);
    expect(new PasskeyStore(file(), { warn: () => {} }).count()).toBe(0);
    expect(readFileSync(file(), 'utf8')).toBe('{not json');
    expect(s.add(pk('a'))).toBe(true);
    expect(new PasskeyStore(file()).count()).toBe(1);
  });

  it('entries missing id or publicKey make the file unreadable (empty)', () => {
    mkdirSync(join(t.dir, 'remote'), { recursive: true });
    writeFileSync(file(), JSON.stringify([{ id: 'a' }]));
    expect(new PasskeyStore(file(), { warn: () => {} }).count()).toBe(0);
  });

  it('an unwritable folder refuses the add and keeps memory unchanged', () => {
    const plain = join(t.dir, 'plain');
    writeFileSync(plain, 'x');
    const blocked = new PasskeyStore(join(plain, 'passkeys.json'));
    expect(blocked.add(pk('a'))).toBe(false);
    expect(blocked.count()).toBe(0);
  });
});

describe('challenges', () => {
  it('once, same kind, within two minutes; the map is capped', () => {
    let now = 0;
    const c = new Challenges(() => now);
    c.add('login', 'x');
    expect(c.take('register', 'x')).toBe(false);
    expect(c.take('login', 'x')).toBe(true);
    expect(c.take('login', 'x')).toBe(false);
    c.add('login', 'y');
    now += CHALLENGE_TTL_MS + 1;
    expect(c.take('login', 'y')).toBe(false);
    for (let i = 0; i <= MAX_CHALLENGES; i++) c.add('login', `c${i}`);
    expect(c.take('login', 'c0')).toBe(false);
    expect(c.take('login', `c${MAX_CHALLENGES}`)).toBe(true);
  });

  it('a wrong-kind attempt does not burn the challenge', () => {
    const c = new Challenges();
    c.add('login', 'z');
    expect(c.take('register', 'z')).toBe(false);
    expect(c.take('login', 'z')).toBe(true);
  });
});

describe('names', () => {
  it('control characters dropped, capped, empty gets a dated default', () => {
    expect(cleanName(' My\u0007  phone\n ', 0)).toBe('My phone');
    expect(cleanName('x'.repeat(100), 0)).toHaveLength(NAME_MAX);
    expect(cleanName('', Date.UTC(2026, 10, 4))).toBe('Passkey 2026-11-04');
    expect(cleanName(42, Date.UTC(2026, 10, 4))).toBe('Passkey 2026-11-04');
  });
});

describe('PasskeyService', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  const mk = (lib?: WebAuthnLib, now = () => clock) => new PasskeyService({ domain: DOMAIN, user: 'bang', store: new PasskeyStore(file()), lib, now });
  let clock = 1_000_000;
  let last = '';
  const fake = (ok = true): WebAuthnLib => ({
    ...webauthn,
    generateRegistrationOptions: (async (o: any) => { const r = await webauthn.generateRegistrationOptions(o); last = r.challenge; return r; }) as never,
    generateAuthenticationOptions: (async (o: any) => { const r = await webauthn.generateAuthenticationOptions(o); last = r.challenge; return r; }) as never,
    verifyRegistrationResponse: (async (o: any) => {
      if (!(await o.expectedChallenge(last))) throw new Error('challenge');
      expect(o).toMatchObject({ expectedOrigin: `https://${DOMAIN}`, expectedRPID: DOMAIN, requireUserVerification: true });
      return { verified: ok, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } };
    }) as never,
    verifyAuthenticationResponse: (async (o: any) => {
      if (!(await o.expectedChallenge(last))) throw new Error('challenge');
      expect(o.credential).toMatchObject({ id: 'cred-1' });
      expect(o).toMatchObject({ expectedOrigin: `https://${DOMAIN}`, expectedRPID: DOMAIN, requireUserVerification: true });
      return { verified: ok, authenticationInfo: { newCounter: 7 } };
    }) as never,
  });

  it('options from the real library: rpID, user verification required, discoverable, nothing allowed by id', async () => {
    const s = mk();
    const reg = (await s.registerOptions()) as any;
    expect(reg.rp.id).toBe(DOMAIN);
    expect(reg.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    const login = (await s.loginOptions()) as any;
    expect(login).toMatchObject({ rpId: DOMAIN, userVerification: 'required' });
    expect(login.allowCredentials ?? []).toEqual([]);
  });

  it('register then sign in: named, counter advances, each challenge works once, registered ids are excluded', async () => {
    const s = mk(fake());
    await s.registerOptions();
    const r = await s.verifyRegister({ response: { id: 'cred-1' }, name: ' Phone ' });
    expect(r).toMatchObject({ ok: true, passkey: { id: 'cred-1', name: 'Phone' } });
    expect(await s.verifyRegister({ response: { id: 'cred-1' } })).toMatchObject({ ok: false }); // same challenge
    expect(s.count()).toBe(1);
    expect(((await s.registerOptions()) as any).excludeCredentials.map((c: any) => c.id)).toEqual(['cred-1']);
    await s.loginOptions();
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(true);
    expect(new PasskeyStore(file()).get('cred-1')).toMatchObject({ counter: 7, lastUsedAt: clock });
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(false); // replay
  });

  it('unknown credential, wrong-kind or expired challenge, bad body, verified=false, throwing library: false/error, never a throw', async () => {
    const s = mk(fake());
    await s.registerOptions();
    await s.verifyRegister({ response: { id: 'cred-1' } });
    expect(await s.verifyLogin({ id: 'nope' })).toBe(false);
    expect(await s.verifyLogin(null)).toBe(false);
    await s.loginOptions();
    expect(await s.verifyRegister({ response: {} })).toMatchObject({ ok: false }); // login challenge, register kind
    await s.loginOptions();
    clock += CHALLENGE_TTL_MS + 1;
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(false);
    const bad = mk(fake(false));
    await bad.loginOptions();
    expect(await bad.verifyLogin({ id: 'cred-1' })).toBe(false);
    const boom = mk({ ...fake(), verifyAuthenticationResponse: (async () => { throw new Error('x'); }) as never });
    await boom.loginOptions();
    expect(await boom.verifyLogin({ id: 'cred-1' })).toBe(false);
  });
});
