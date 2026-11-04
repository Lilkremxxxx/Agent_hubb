// The seats: a flat team.json (folder, boss, seats) in the data dir, imported once from the old file, re-read on edit;
// the Claude boss is appointed from the page and lives in memory.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeConfigDir, importTeam, parseTeam, teamSeats, TeamService } from './team';
import { NameStore } from './model/names';
import { Office } from './model/office';

const T0 = 1_700_000_000_000;
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-team-'));
  dirs.push(dir);
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: T0, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => T0 });
  const main = (id: string, sessionId: string, extra: { provider?: 'agy'; account?: string } = {}) =>
    office.addMain({ id, account: '.claude', sessionId, cwd: `/w/${id}`, role: 'Main agent', startedAt: T0, status: 'idle', ...extra });
  const file = join(dir, 'team.json');
  const oldFile = join(dir, 'old-team.json');
  let changed = 0;
  /** PIDs of Claude Code processes that exited (a pending boss with one of these is dropped). */
  const dead = new Set<number>();
  const team = () =>
    new TeamService({
      office,
      file,
      oldFile,
      home: '/h',
      profiles: () => ['acc1', 'acc5'].map((acc) => ({ acc, account: `agy:${acc}` })),
      onChange: () => void changed++,
      now: () => T0,
      isAlive: (pid) => !dead.has(pid),
      isDir: (p) => p.startsWith('/w'),
    });
  const crowned = () => office.list().filter((a) => a.boss).map((a) => a.id);
  const saved = () => JSON.parse(readFileSync(file, 'utf8'));
  return { office, main, file, oldFile, team, crowned, saved, changes: () => changed, dead };
}

const seat = (name: string, account = 'acc1') => ({ name, kind: 'agy', account });

describe('team.json: parse, import, seats', () => {
  it('parseTeam: flat file; bad seats dropped (name, kind, account, duplicate); boss defaults to claude/default', () => {
    const t = parseTeam(
      JSON.stringify({
        folder: '/w/ocr/',
        workers: [
          { name: 'W1', kind: 'agy', account: 'acc1' },
          { name: 'W1', kind: 'agy', account: 'acc2' },
          { name: '7x', kind: 'agy', account: 'acc1' },
          { name: 'C1', kind: 'codex', account: 'x' },
          { name: 'C2', kind: 'claude', account: 'a b' },
          { name: 'C3', kind: 'claude', account: 'worker' },
        ],
      }),
    );
    expect(t).toEqual({
      folder: '/w/ocr',
      boss: { kind: 'claude', account: 'default' },
      workers: [
        { name: 'W1', kind: 'agy', account: 'acc1' },
        { name: 'C3', kind: 'claude', account: 'worker' },
      ],
    });
    expect(parseTeam(JSON.stringify({ folder: 'rel/path' })).folder).toBe('');
    expect(() => parseTeam('{"folder": ')).toThrow();
    expect(() => parseTeam('[]')).toThrow();
  });

  it('importTeam: offices[0] of the old file (v3) and a v2 file become the flat file', () => {
    expect(
      importTeam(
        JSON.stringify({
          offices: [
            { id: 'main', folder: '/w/p', boss: { kind: 'claude', id: '.claude-w:1', account: '.claude-w' }, workers: ['acc1', 'claude:.claude-w', 'claude:.claude'] },
            { id: 'two', folder: '/w/q', workers: ['acc9'] },
          ],
        }),
      ),
    ).toEqual({
      folder: '/w/p',
      boss: { kind: 'claude', account: 'w' },
      workers: [
        { name: 'acc1', kind: 'agy', account: 'acc1' },
        { name: 'w', kind: 'claude', account: 'w' },
        { name: 'claude', kind: 'claude', account: 'default' },
      ],
    });
    expect(importTeam(JSON.stringify({ boss: { kind: 'agy', acc: 'acc5' }, workers: ['acc2'] }))).toEqual({
      folder: '',
      boss: { kind: 'agy', account: 'acc5' },
      workers: [{ name: 'acc2', kind: 'agy', account: 'acc2' }],
    });
  });

  it('teamSeats: the first seat of an agy account keeps agy:<acc>; later ones and Claude seats are per name', () => {
    expect(teamSeats([seat('W1'), seat('W2'), { name: 'C1', kind: 'claude', account: 'worker' }] as never).map((s) => s.agentId)).toEqual(['agy:acc1', 'agy:acc1@W2', 'claude-worker:C1']);
    expect(claudeConfigDir('default', '/h')).toBe('/h/.claude');
    expect(claudeConfigDir('worker', '/h')).toBe('/h/.claude-worker');
  });
});

describe('TeamService: the file', () => {
  it('first run imports the old file once and writes the new one; the old file is never written', () => {
    const t = setup();
    writeFileSync(t.oldFile, JSON.stringify({ offices: [{ id: 'main', folder: '/w/p', workers: ['acc1'] }] }));
    const before = readFileSync(t.oldFile, 'utf8');
    const mtime = statSync(t.oldFile).mtimeMs;
    const svc = t.team();
    svc.start();
    svc.appoint('.claude:1');
    svc.reload();
    svc.stop();
    expect(t.saved()).toEqual({ folder: '/w/p', boss: { kind: 'claude', account: 'default' }, workers: [{ name: 'acc1', kind: 'agy', account: 'acc1' }] });
    expect(readFileSync(t.oldFile, 'utf8')).toBe(before);
    expect(statSync(t.oldFile).mtimeMs).toBe(mtime);
    // the new file exists now: the old one is not read again
    writeFileSync(t.oldFile, JSON.stringify({ offices: [{ id: 'main', folder: '/w/q', workers: ['acc9'] }] }));
    expect(t.team().seats().map((s) => s.name)).toEqual(['acc1']);
  });

  it('no file anywhere: writes an empty team to fill in', () => {
    const t = setup();
    const svc = t.team();
    expect(t.saved()).toEqual({ folder: '', boss: { kind: 'claude', account: 'default' }, workers: [] });
    expect(svc.folder).toBe('');
  });

  it('a broken team.json at start is not overwritten; fixing it is picked up by reload()', () => {
    const t = setup();
    writeFileSync(t.file, '{ broken');
    writeFileSync(t.oldFile, JSON.stringify({ workers: ['acc2'] }));
    const svc = t.team();
    expect(readFileSync(t.file, 'utf8')).toBe('{ broken');
    expect(svc.seats()).toEqual([]);
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1')] }));
    expect(svc.reload()).toBe(true);
    expect(svc.seats().map((s) => s.name)).toEqual(['W1']);
  });

  it('reload: an edit adds or removes seats and calls onChange once; a half-saved file keeps the team', () => {
    const t = setup();
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1')] }));
    const svc = t.team();
    svc.start();
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1'), seat('W2')] }));
    expect(svc.reload()).toBe(true);
    expect(t.changes()).toBe(1);
    expect(svc.reload()).toBe(false);
    writeFileSync(t.file, '{"folder": "/w/p", "workers": [');
    expect(svc.reload()).toBe(false);
    expect(svc.seats().map((s) => s.name)).toEqual(['W1', 'W2']);
    expect(t.changes()).toBe(1);
    expect(readFileSync(t.file, 'utf8')).toBe('{"folder": "/w/p", "workers": [');
    svc.stop();
  });

  it('folder: an existing absolute folder, else empty', () => {
    const t = setup();
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p' }));
    expect(t.team().folder).toBe('/w/p');
    writeFileSync(t.file, JSON.stringify({ folder: '/nope/p' }));
    expect(t.team().folder).toBe('');
  });
});

describe('TeamService: the boss', () => {
  it('boss: appoint a Claude session, pending until it walks in, dropped when its process died; null steps down', () => {
    const t = setup();
    t.main('.claude:1', 's1');
    t.main('.claude:2', 's2');
    const svc = t.team();
    svc.sync();
    expect(t.crowned()).toEqual([]);
    expect(svc.appoint('nope')).toMatchObject({ ok: false, status: 404 });
    expect(svc.appoint('.claude:1')).toEqual({ ok: true });
    expect(t.crowned()).toEqual(['.claude:1']);
    expect(svc.bossAgentId()).toBe('.claude:1');
    svc.appoint('.claude:2');
    expect(t.crowned()).toEqual(['.claude:2']);
    svc.appoint(null);
    expect(t.crowned()).toEqual([]);
    expect(svc.bossAgentId()).toBeUndefined();
    // pending: the id is known before the character shows up; a wrong account or no `pending` is refused
    expect(svc.appoint('.claude:50', { account: '.claude-work' })).toMatchObject({ ok: false, status: 404 });
    expect(svc.appoint('.claude:50')).toMatchObject({ ok: false, status: 404 });
    expect(svc.appoint('.claude:50', { account: '.claude' })).toEqual({ ok: true });
    expect(svc.bossAgentId()).toBe('.claude:50');
    expect(t.office.commit().snapshot.team?.offices?.[0].pendingBoss).toBe('.claude:50');
    t.main('.claude:50', 's50');
    svc.sync();
    expect(t.crowned()).toEqual(['.claude:50']);
    const { snapshot, notices } = t.office.commit();
    expect(snapshot.team?.offices?.[0].pendingBoss).toBeUndefined();
    expect(notices.some((n) => n.text.startsWith('👑'))).toBe(true);
    // later ticks do not throw another party
    svc.sync();
    expect(t.office.commit().notices.some((n) => n.text.startsWith('👑'))).toBe(false);
    // a pending boss whose process exited before showing up is dropped
    svc.appoint(null);
    svc.appoint('.claude:60', { account: '.claude' });
    t.dead.add(60);
    svc.sync();
    expect(svc.bossAgentId()).toBeUndefined();
    expect(t.office.commit().snapshot.team?.offices?.[0].pendingBoss).toBeUndefined();
    // the boss lives in memory only
    expect(t.saved().boss).toEqual({ kind: 'claude', account: 'default' });
  });

  it('a closed Claude boss keeps the crown waiting; `claude --resume` (same session, new pid) gets it back', () => {
    const t = setup();
    t.main('.claude:41', 's1');
    const svc = t.team();
    svc.appoint('.claude:41');
    t.office.closeMain('.claude:41');
    svc.sync();
    expect(t.crowned()).toEqual([]);
    expect(t.office.commit().snapshot.team?.offices?.[0].waitingBoss).toBeTruthy();
    t.main('.claude:77', 's1');
    svc.sync();
    expect(t.crowned()).toEqual(['.claude:77']);
  });

  it('an Antigravity boss is crowned whenever its character agy-boss:<acc> is in', () => {
    const t = setup();
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', boss: { kind: 'agy', account: 'acc5' } }));
    const svc = t.team();
    svc.sync();
    expect(t.crowned()).toEqual([]);
    t.office.addMain({ id: 'agy-boss:acc5', provider: 'agy', account: 'agy:acc5', sessionId: 'agy-boss-acc5', cwd: '/w/p', role: 'Boss', startedAt: T0, status: 'idle' });
    svc.sync();
    expect(t.crowned()).toEqual(['agy-boss:acc5']);
    expect(svc.bossAgentId()).toBe('agy-boss:acc5');
    expect(svc.appoint('.claude:1')).toMatchObject({ ok: false, status: 409 });
  });

  it('publish: one office with the folder, the seat names and the boss character', () => {
    const t = setup();
    writeFileSync(t.file, JSON.stringify({ folder: '/w/p', workers: [seat('W1'), { name: 'C1', kind: 'claude', account: 'worker' }] }));
    t.main('.claude:1', 's1');
    const svc = t.team();
    svc.appoint('.claude:1');
    expect(t.office.commit().snapshot.team).toMatchObject({
      workers: ['W1', 'C1'],
      offices: [{ id: 'main', name: 'p', folder: '/w/p', workers: ['W1', 'C1'], bossAgentId: '.claude:1' }],
    });
  });
});
