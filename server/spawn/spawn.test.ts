import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cliArgs,
  createCliRunner,
  folderProblem,
  launch,
  parseSpawn,
  SENT_TIMEOUT_MS,
  sessionName,
  SpawnService,
  spawnUrl,
  type Opener,
} from './spawn';
import { runnableClaudeBin } from '../claude-bin';

describe('new agent: request and link', () => {
  it('accepts only absolute folder and request of valid size', () => {
    expect(parseSpawn({ folder: ' /Users/a/proj ', prompt: 'do X  \n' })).toEqual({ folder: '/Users/a/proj', prompt: 'do X' });
    expect(parseSpawn({ folder: 'C:\\code\\proj' })).toEqual({ folder: 'C:\\code\\proj', prompt: '' });
    expect(parseSpawn({ folder: 'proj' })).toHaveProperty('error');
    expect(parseSpawn({ folder: '/a\0b' })).toHaveProperty('error');
    expect(parseSpawn({ folder: '/a', prompt: 'x'.repeat(8_001) })).toHaveProperty('error');
    expect(parseSpawn(null)).toHaveProperty('error');
  });

  it('Claude app link includes encoded folder and request (space as %20)', () => {
    const url = spawnUrl({ folder: '/Users/a/my proj', prompt: 'run tests & count' });
    expect(url.startsWith('claude://code/new?')).toBe(true);
    const q = new URL(url).searchParams;
    expect([q.get('folder'), q.get('q'), q.get('source')]).toEqual(['/Users/a/my proj', 'run tests & count', 'habblaud']);
    expect(url).not.toContain('+');
    expect(new URL(spawnUrl({ folder: '/a', prompt: '  ' })).searchParams.has('q')).toBe(false);
  });

  it('folderProblem: non-existent folder or file', () => {
    expect(folderProblem(process.cwd())).toBeUndefined();
    expect(folderProblem('/does/not/exist')).toMatch(/folder not found/);
    expect(folderProblem('/x', () => ({ isDirectory: () => false }))).toMatch(/not a folder/);
  });
});

describe('SpawnService', () => {
  it('direct mode: checks folder and opens link immediately', async () => {
    const opened: string[] = [];
    const opener: Opener = async (url) => (opened.push(url), { ok: true });
    const s = new SpawnService({ opener, folderProblem: () => undefined, newId: () => 'a1' });
    const r = s.submit({ folder: '/p', prompt: 'hi' });
    expect(r).toMatchObject({ spawn: { id: 'a1', folder: '/p' } });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('a1')?.status).toBe('opened');
    expect(opened).toEqual([spawnUrl({ folder: '/p', prompt: 'hi' })]);
    const bad = new SpawnService({ opener, folderProblem: () => 'folder not found on this computer', newId: () => 'b' });
    bad.submit({ folder: '/none', prompt: '' });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(bad.get('b')).toMatchObject({ status: 'failed', error: 'folder not found on this computer' });
  });

  it('a request stuck opening fails after SENT_TIMEOUT_MS', () => {
    let now = 1_000_000;
    const s = new SpawnService({ opener: () => new Promise(() => {}), folderProblem: () => undefined, now: () => now, newId: () => 'id1' });
    s.submit({ folder: '/p', prompt: '' });
    expect(s.get('id1')?.status).toBe('sent');
    now += SENT_TIMEOUT_MS + 1;
    expect(s.get('id1')).toMatchObject({ status: 'failed', error: "the app didn't open in time" });
  });

  it('a late opener result does not flip a request the timeout already failed', async () => {
    let now = 1_000_000;
    let done!: (r: { ok: true }) => void;
    const s = new SpawnService({ opener: () => new Promise((ok) => (done = ok)), folderProblem: () => undefined, now: () => now, newId: () => 'id1' });
    s.submit({ folder: '/p', prompt: '' });
    now += SENT_TIMEOUT_MS + 1;
    expect(s.get('id1')?.status).toBe('failed');
    done({ ok: true });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('id1')?.status).toBe('failed');
  });

  it('at most 5 opening at the same time', () => {
    const s = new SpawnService({ opener: () => new Promise(() => {}), folderProblem: () => undefined });
    for (let i = 0; i < 5; i++) expect(s.submit({ folder: '/p', prompt: '' })).toHaveProperty('spawn');
    expect(s.submit({ folder: '/p', prompt: '' })).toMatchObject({ error: 'too-many' });
  });
});

describe('SpawnService with attachments', () => {
  const att = (name: string) => ({ name, type: 'image/png', data: Buffer.from(name) });

  it('attachments disabled without a store', () => {
    const bare = new SpawnService({ opener: async () => ({ ok: true }), newId: () => 'z' });
    expect(bare.submit({ folder: '/p', attachments: ['f1'] })).toMatchObject({ error: 'invalid', reason: 'attachments disabled' });
  });

  it('direct: writes attachments and link carries paths in request', async () => {
    const { AttachmentStore } = await import('./attachments');
    const store = new AttachmentStore(Date.now, () => 'f1');
    store.put(att('print.png'));
    const opened: string[] = [];
    const written: string[] = [];
    const s = new SpawnService({
      opener: async (url) => (opened.push(url), { ok: true }),
      folderProblem: () => undefined,
      attachments: store,
      writeFiles: (id, files) => files.map((f) => (written.push(`${id}:${f.name}`), `/h/att/${f.name}`)),
      newId: () => 's2',
    });
    s.submit({ folder: '/p', prompt: 'fix', attachments: ['f1'] });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(written).toEqual(['s2:print.png']);
    expect(new URL(opened[0]).searchParams.get('q')).toBe('fix\n\nAttachment sent via Habblaud (read it before starting):\n- /h/att/print.png');
    expect(s.get('s2')?.status).toBe('opened');
  });

  it('direct: write failure becomes request error without opening app', async () => {
    const { AttachmentStore } = await import('./attachments');
    const store = new AttachmentStore(Date.now, () => 'f1');
    store.put(att('x.png'));
    const opened: string[] = [];
    const s = new SpawnService({
      opener: async (url) => (opened.push(url), { ok: true }),
      folderProblem: () => undefined,
      attachments: store,
      writeFiles: () => {
        throw new Error('disk full');
      },
      newId: () => 's3',
    });
    s.submit({ folder: '/p', attachments: ['f1'] });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(opened).toEqual([]);
    expect(s.get('s3')).toMatchObject({ status: 'failed', error: "couldn't save the attachments (disk full)" });
  });
});

describe('new background agent (claude --bg)', () => {
  it('session name and args: request comes after `--`', () => {
    expect(sessionName('  \n run tests\nsecond line')).toBe('Habblaud: run tests');
    expect(sessionName('')).toBe('Habblaud');
    expect(sessionName('x'.repeat(100))).toHaveLength('Habblaud: '.length + 48);
    expect(cliArgs({ folder: '/p', prompt: 'doctor' })).toEqual(['--bg', '-n', 'Habblaud: doctor', '--', 'doctor']);
    expect(cliArgs({ folder: '/p', prompt: '--dangerously-skip-permissions' }).slice(-2)).toEqual(['--', '--dangerously-skip-permissions']);
    expect(cliArgs({ folder: '/p', prompt: '  ' })).toEqual(['--bg', '-n', 'Habblaud']);
  });

  it('createCliRunner runs binary in folder, without shell, and reads id; error becomes 1st line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-spawn-'));
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${dir}/args"\n[ -f ./trusted ] || { echo 'Workspace not trusted. Run claude once' >&2; exit 1; }\necho 'Starting background service…'\necho 'backgrounded · 7eacc670 · name'\n`,
    );
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'trusted'), '');
    expect(runnableClaudeBin({ PATH: `/does/not/exist:${dir}` })).toBe(bin);
    expect(runnableClaudeBin({ HABBLAUD_CLAUDE_BIN: join(dir, 'none'), PATH: dir })).toBeUndefined();
    const run = createCliRunner(bin);
    expect(await run({ folder: dir, prompt: 'do $(rm -rf x) && y' })).toEqual({ ok: true, id: '7eacc670' });
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    expect(realpathSync(args[0])).toBe(realpathSync(dir));
    expect(args.slice(1)).toEqual(['--bg', '-n', 'Habblaud: do $(rm -rf x) && y', '--', 'do $(rm -rf x) && y']);
    expect(await run({ folder: tmpdir(), prompt: 'hi' })).toEqual({ ok: false, error: 'Workspace not trusted. Run claude once' });
  });

  it('launch: runs in background; if not possible, opens app and explains why', async () => {
    const opened: string[] = [];
    const open: Opener = async (url) => (opened.push(url), { ok: true });
    expect(await launch({ folder: '/p', prompt: 'hi' }, open, async () => ({ ok: true, id: 'a' }))).toEqual({ ok: true, how: 'cli' });
    expect(opened).toEqual([]);
    const r = await launch({ folder: '/p', prompt: 'hi' }, open, async () => ({ ok: false, error: 'Workspace not trusted. Run `claude` in /p once' }));
    expect(r).toMatchObject({ ok: true, how: 'app', note: expect.stringMatching(/isn't trusted/) });
    expect(opened).toEqual([spawnUrl({ folder: '/p', prompt: 'hi' })]);
    expect(await launch({ folder: '/p', prompt: 'hi' }, open)).toEqual({ ok: true, how: 'app' });
    expect(await launch({ folder: '/p', prompt: 'hi' }, async () => ({ ok: false, error: 'open: x' }), async () => ({ ok: false, error: 'not logged in' }))).toEqual({
      ok: false,
      error: "not logged in; and the app didn't open (open: x)",
    });
  });

  it('SpawnService: with claude, resolves as cli', async () => {
    const s = new SpawnService({ opener: async () => ({ ok: true }), cli: async () => ({ ok: true, id: 'x' }), folderProblem: () => undefined, newId: () => 'c1' });
    s.submit({ folder: '/p', prompt: 'hi' });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('c1')).toEqual({ id: 'c1', folder: '/p', status: 'opened', how: 'cli' });
  });
});
