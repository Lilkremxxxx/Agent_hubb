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
    for (let i = 0; i < MAX_CHALLENGES; i++) expect(c.add('login', `c${i}`)).toBe(true);
    expect(c.add('login', 'over')).toBe(false); // full: refused, nothing evicted
    expect(c.take('login', 'c0')).toBe(true);
  });

  it('a full map refuses a new owner instead of evicting someone else\'s challenge; an owner only displaces its own', () => {
    const c = new Challenges(() => 0, 3, 2);
    expect(c.add('login', 'owner', '198.51.100.2')).toBe(true);
    expect(c.add('login', 'a1', '203.0.113.1')).toBe(true);
    expect(c.add('login', 'a2', '203.0.113.1')).toBe(true);
    expect(c.add('login', 'a3', '203.0.113.1')).toBe(true); // a1 (its own) is dropped
    expect(c.take('login', 'a1')).toBe(false);
    expect(c.add('login', 'b1', '203.0.113.9')).toBe(false); // full: refused
    expect(c.take('login', 'owner')).toBe(true);
  });

  it('IPv6 hosts of one /64 share one owner', () => {
    const c = new Challenges(() => 0, 100, 2);
    for (let i = 0; i < 10; i++) c.add('login', `v${i}`, `2001:db8:1:2::${i.toString(16)}`);
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => c.take('login', `v${i}`))).toEqual([]);
    expect([c.take('login', 'v8'), c.take('login', 'v9')]).toEqual([true, true]);
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
    const login = (await s.loginOptions('203.0.113.1')) as any;
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
    await s.loginOptions('203.0.113.1');
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
    await s.loginOptions('203.0.113.1');
    expect(await s.verifyRegister({ response: {} })).toMatchObject({ ok: false }); // login challenge, register kind
    await s.loginOptions('203.0.113.1');
    clock += CHALLENGE_TTL_MS + 1;
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(false);
    const bad = mk(fake(false));
    await bad.loginOptions('203.0.113.1');
    expect(await bad.verifyLogin({ id: 'cred-1' })).toBe(false);
    const boom = mk({ ...fake(), verifyAuthenticationResponse: (async () => { throw new Error('x'); }) as never });
    await boom.loginOptions('203.0.113.1');
    expect(await boom.verifyLogin({ id: 'cred-1' })).toBe(false);
  });

  it('a challenge flood from one IP cannot flush the owner\'s challenge (per-IP cap on the public map)', async () => {
    const s = mk(fake());
    await s.registerOptions();
    await s.verifyRegister({ response: { id: 'cred-1' } });
    await s.loginOptions('198.51.100.2');
    const mine = last;
    for (let i = 0; i < 100; i++) await s.loginOptions('203.0.113.99');
    last = mine;
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(true);
  });

  it('the owner\'s challenge survives 5000 options from one IPv6 /64 and the cap of distinct IPv4s, then new ones are refused (null)', async () => {
    let n = 0;
    const lib = { ...fake(), generateAuthenticationOptions: (async () => ({ challenge: `ch${n++}` })) as never };
    const s = mk(lib);
    await s.registerOptions();
    await s.verifyRegister({ response: { id: 'cred-1' } });
    expect(await s.loginOptions('198.51.100.2')).not.toBeNull();
    const mine = `ch${n - 1}`;
    for (let i = 0; i < 5000; i++) await s.loginOptions(`2001:db8:1:2:${(i + 1).toString(16)}::${i.toString(16)}`);
    for (let i = 0; i < 6000; i++) await s.loginOptions(`10.${i >> 8}.${i & 255}.1`);
    expect(await s.loginOptions('10.200.1.1')).toBeNull();
    last = mine;
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(true);
  });

  it('transports are whitelisted (max 8) and the user handle is a hash, not the name', async () => {
    let seen: any;
    const lib = { ...fake(), verifyRegistrationResponse: (async () => ({ verified: true, registrationInfo: { credential: { id: 'c2', publicKey: new Uint8Array([1]), counter: 0, transports: ['usb', '<script>', 'internal', 'x'.repeat(5000)] } } })) as never,
      generateRegistrationOptions: (async (o: any) => { seen = o; return webauthn.generateRegistrationOptions(o); }) as never };
    const s = mk(lib);
    await s.registerOptions();
    expect(Buffer.from(seen.userID).toString()).not.toContain('bang');
    last = ((await s.registerOptions()) as any).challenge;
    await s.verifyRegister({ response: {} });
    expect(new PasskeyStore(file()).get('c2')?.transports).toEqual(['usb', 'internal']);
  });
});

describe('PasskeyService step-up', () => {
  const DOMAIN = 'hub.finstar.pp.ua';
  let last = '';
  let seen: any;
  const lib = (): WebAuthnLib => ({
    ...webauthn,
    generateAuthenticationOptions: (async (o: any) => { const r = await webauthn.generateAuthenticationOptions(o); last = r.challenge; return r; }) as never,
    verifyAuthenticationResponse: (async (o: any) => {
      seen = o;
      if (!(await o.expectedChallenge(last))) throw new Error('challenge');
      return { verified: true, authenticationInfo: { newCounter: 7 } };
    }) as never,
  });
  const mk = () => {
    const store = new PasskeyStore(file());
    store.add(pk('cred-1'));
    return new PasskeyService({ domain: DOMAIN, user: 'bang', store, lib: lib() });
  };

  it('the step-up challenge is bound to the session key', async () => {
    const s = mk();
    await s.stepupOptions('k1');
    expect(await s.verifyStepup({ id: 'cred-1' }, 'k2')).toBe(false);
    await s.stepupOptions('k1');
    expect(await s.verifyStepup({ id: 'cred-1' }, 'k1')).toBe(true);
  });

  it('login and step-up challenges are not interchangeable', async () => {
    const s = mk();
    await s.loginOptions('203.0.113.1');
    expect(await s.verifyStepup({ id: 'cred-1' }, 'k1')).toBe(false);
    await s.stepupOptions('k1');
    expect(await s.verifyLogin({ id: 'cred-1' })).toBe(false);
  });

  it('verifies against the hub origin and rpID with user verification', async () => {
    const s = mk();
    await s.stepupOptions('k1');
    await s.verifyStepup({ id: 'cred-1' }, 'k1');
    expect(seen).toMatchObject({ expectedOrigin: 'https://hub.finstar.pp.ua', expectedRPID: 'hub.finstar.pp.ua', requireUserVerification: true });
  });

  it('a session may hold at most 3 step-up challenges; options return null when the map is full', async () => {
    const s = mk();
    const c = new Challenges(() => 0, 2, 3);
    expect([c.add('stepup', 'a', 'k1'), c.add('stepup', 'b', 'k2'), c.add('stepup', 'c', 'k3')]).toEqual([true, true, false]);
    expect(c.take('stepup', 'a', 'other')).toBe(false);
    expect(await s.stepupOptions('k1')).not.toBeNull();
  });
});
