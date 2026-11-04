import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAllow, checkUser, parseArgs, proxyEnv, remoteEnv, writeHubEnv } from '../../scripts/remote-setup';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { readEnvValue, shQuote, updateEnv } from './envfile';

setQuiet(true);

const REPO = resolve(__dirname, '../..');
const closers: Array<() => void> = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});
const tmp = () => {
  const t = tempDir();
  closers.push(t.cleanup);
  return t.dir;
};
const sh = (script: string) => spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });

describe('hub.env is data, never code', () => {
  const evil = ['a;touch${IFS}/x', 'a$(touch /x)', 'a`touch /x`', "it's", 'a b', '$HOME', 'a\\b', '"q"', '#c'];

  it('shQuote round-trips and rejects newlines', () => {
    for (const v of evil) expect(readEnvValue(`K=${shQuote(v)}\n`, 'K')).toBe(v);
    expect(() => shQuote('a\nb')).toThrow();
    expect(() => shQuote('a\rb')).toThrow();
    expect(updateEnv('', { K: 'v' }, { quote: true })).toBe("K='v'\n");
  });

  it('a generated hub.env sourced by sh gives back the literal value and runs nothing', () => {
    const d = tmp();
    const marker = join(d, 'pwned');
    const nasty = [`a;touch\${IFS}${marker}`, `a$(touch ${marker})`, `a\`touch ${marker}\``, "it's $HOME", 'a b'];
    for (const v of nasty) {
      const file = join(d, 'hub.env');
      writeFileSync(file, updateEnv('', { HABBLAUD_REMOTE_USER: v }, { quote: true }));
      const r = sh(`set -eu; set -a; . '${file}'; printf %s "$HABBLAUD_REMOTE_USER"`);
      expect(r.stdout).toBe(v);
      expect(existsSync(marker)).toBe(false);
    }
  });

  it('setup rejects a hostile username, allow list, domain or host list before writing anything', () => {
    for (const u of ['a;b', 'a$b', 'a b', 'a`b`', "a'b", '', 'x'.repeat(65), 'a\nb']) expect(() => checkUser(u)).toThrow();
    expect(checkUser('bang.n-g@x_1')).toBe('bang.n-g@x_1');
    for (const a of ['terminal;cmd', 'spawn', 'terminal,$x', 'none,evil', '']) expect(() => checkAllow(a)).toThrow();
    expect(checkAllow('terminal')).toBe('terminal');
    expect(checkAllow('none')).toBe('none');
    expect(() => parseArgs(['--user', 'a;touch${IFS}/tmp/p'])).toThrow();
    expect(() => parseArgs(['--allow', 'terminal;cmd'])).toThrow();
    expect(() => parseArgs(['--domain', 'a;b.com'])).toThrow();
    expect(() => proxyEnv('HABBLAUD_ALLOWED_HOSTS=ok.lan,$(x)\n', { user: 'b', hash: 'h', domain: 'd.example', port: 4748 })).toThrow();
    expect(() => proxyEnv('', { user: 'b;x', hash: 'h', domain: 'd.example', port: 4748 })).toThrow();
    expect(() => proxyEnv('', { user: 'b', hash: 'h', domain: 'd.example', port: 4748, allow: 'terminal;x' })).toThrow();
    expect(() => remoteEnv('', { user: 'b', hash: 'h', name: 'n', domain: 'a b.com', port: 443 })).toThrow();
  });

  it('proxyEnv output is fully single-quoted', () => {
    const out = proxyEnv('', { user: 'bang', hash: 'scrypt:15:8:1:a+/=:b', domain: 'hub.finstar.pp.ua', port: 4748 });
    for (const line of out.trim().split('\n')) expect(line).toMatch(/^[A-Z_]+='[^']*'$/);
  });

  it('writeHubEnv: removes a stale tmp (even a symlink), file mode 600, new dir mode 700', () => {
    const d = tmp();
    const dir = join(d, 'data');
    const target = join(d, 'victim');
    mkdirSync(dir);
    symlinkSync(target, join(dir, 'hub.env.tmp'));
    writeHubEnv({ HOME: '/x', HABBLAUD_DATA_DIR: dir }, "K='v'\n");
    expect(existsSync(target)).toBe(false);
    expect(statSync(join(dir, 'hub.env')).mode & 0o777).toBe(0o600);
    writeHubEnv({ HOME: '/x', HABBLAUD_DATA_DIR: join(d, 'new') }, "K='v'\n");
    expect(statSync(join(d, 'new')).mode & 0o777).toBe(0o700);
  });
});

describe('office.sh guard and hub.env loader', () => {
  // Fake bin dir: a systemctl with the given body, and npm/node/curl stubs that leave a marker if ever run.
  const fake = (body: string) => {
    const d = tmp();
    writeFileSync(join(d, 'systemctl'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    for (const c of ['npm', 'node', 'curl']) writeFileSync(join(d, c), `#!/bin/sh\ntouch "${d}/ran-${c}"\n`, { mode: 0o755 });
    return d;
  };
  const office = (d: string, arg: string, port: string) =>
    spawnSync('sh', [join(REPO, 'scripts/office.sh'), arg], {
      encoding: 'utf8',
      env: { PATH: `${d}:${process.env.PATH}`, HOME: d, HABBLAUD_PORT: port, HABBLAUD_DATA_DIR: join(d, 'data') },
    });

  it.each(['is-enabled', 'is-active'])('port 4747, unit %s: refuses start/stop/restart and runs nothing', (only) => {
    const d = fake(`case "$*" in *${only}*) exit 0;; *) exit 3;; esac`);
    for (const arg of ['start', 'stop', 'restart']) {
      const r = office(d, arg, '4747');
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/bang-hub\.service runs the office/);
    }
    for (const c of ['npm', 'node', 'curl']) expect(existsSync(join(d, `ran-${c}`))).toBe(false);
  });

  it('systemctl failing (no bus) on another port keeps the old behavior', () => {
    const r = office(fake('exit 1'), 'stop', '47491');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/not running on port 47491/);
  });

  it('the loader exports only HABBLAUD_* keys with safe values and never executes the file', () => {
    const d = tmp();
    const marker = join(d, 'pwned');
    const file = join(d, 'hub.env');
    writeFileSync(
      file,
      [
        "HABBLAUD_REMOTE_USER='bang n'",
        `HABBLAUD_X=$(touch ${marker})`,
        `HABBLAUD_Y=a;touch ${marker}`,
        `HABBLAUD_Z='a'$(touch ${marker})`,
        `touch ${marker}`,
        "PATH='/nope'",
        'HABBLAUD_REMOTE_PORT=4748',
        '# comment',
        '',
      ].join('\n'),
    );
    const r = sh(
      `. '${REPO}/scripts/hub-env.sh'; load_hub_env '${file}'; printf '%s|%s|%s|%s|%s' "$HABBLAUD_REMOTE_USER" "\${HABBLAUD_X-}" "\${HABBLAUD_Y-}" "\${HABBLAUD_Z-}" "$HABBLAUD_REMOTE_PORT"; case "$PATH" in /nope) echo BADPATH;; esac`,
    );
    expect(r.stdout).toBe('bang n|||' + '|4748');
    expect(existsSync(marker)).toBe(false);
  });
});
