// Antigravity source: temporary profiles on disk, a fake /proc, the AccountsService and the Office.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { agyDetected, discoverAgyProfiles, emailFromCliLog, emailFromLogs, workerName } from './profiles';
import { scanAgyProcs, type ProcReader } from './procs';
import { AgySource, END_WAIT_MS } from './source';
import { parseAgyUsage } from './usage';

setQuiet(true);

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

interface FakeProc {
  comm: string;
  ppid: number;
  home?: string;
  args?: string[];
  cwd?: string;
  /** Start, in seconds after boot. */
  start?: number;
}

const BOOT_MS = 1_800_000_000_000;

/** Fake /proc: processes by PID; boot at BOOT_MS. */
function fakeProc(procs: Map<number, FakeProc>): ProcReader {
  return {
    list: () => [...procs.keys()],
    comm: (pid) => procs.get(pid)?.comm,
    environ: (pid) => (procs.get(pid)?.home ? [`HOME=${procs.get(pid)!.home}`, 'PATH=/bin'] : ['PATH=/bin']),
    cmdline: (pid) => procs.get(pid)?.args ?? [procs.get(pid)?.comm ?? ''],
    cwd: (pid) => procs.get(pid)?.cwd,
    stat: (pid) => (procs.has(pid) ? { ppid: procs.get(pid)!.ppid, startTicks: (procs.get(pid)!.start ?? 0) * 100 } : undefined),
    bootMs: () => BOOT_MS,
  };
}

function profiles(names: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'habblaud-agy-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const n of names) {
    // signed in: agy's log names the Google account
    mkdirSync(join(root, n, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(join(root, n, '.gemini', 'antigravity-cli', 'cli.log'), `I1026 1 server_oauth.go:229] OAuth: authenticated as ${n}@example.com\n`);
  }
  return root;
}

describe('Antigravity profiles', () => {
  it('takes the e-mail from the last OAuth line of cli.log', () => {
    const log = [
      'I1026 10:25:53.89 1 server_oauth.go:229] OAuth: authenticated as old@gmail.com',
      'I1026 10:26:00.00 1 http_helpers.go:349] URL: https://x.googleapis.com/v1',
      'I1026 11:54:49.89 1 server_oauth.go:229] OAuth: authenticated as new.name@gmail.com',
    ].join('\n');
    expect(emailFromCliLog(log)).toBe('new.name@gmail.com');
    expect(emailFromCliLog('nothing here')).toBeUndefined();
  });

  it('finds the profiles in natural order, and skips _backup and folders without agy', () => {
    const root = profiles(['acc10', 'acc2', 'acc1', '_backup']);
    mkdirSync(join(root, 'empty'));
    const found = discoverAgyProfiles(root);
    expect(found.map((p) => p.acc)).toEqual(['acc1', 'acc2', 'acc10']);
  });

  it('name: the e-mail user up to the first dot, else the account; names.conf is not read', () => {
    expect(workerName({ acc: 'acc2', email: 'alice.nguyen@gmail.com' })).toBe('alice');
    expect(workerName({ acc: 'acc2' })).toBe('acc2');
    const root = profiles(['acc1', 'acc2']);
    writeFileSync(join(root, 'acc1', '.gemini', 'antigravity-cli', 'cli.log'), 'I1 server_oauth.go:229] OAuth: authenticated successfully as alice@gmail.com\n');
    writeFileSync(join(root, 'names.conf'), 'acc2 Carol\n');
    expect(discoverAgyProfiles(root).map(workerName)).toEqual(['alice', 'acc2']);
  });

  it('letter = account number; color outside the ones in use', () => {
    const [p] = discoverAgyProfiles(profiles(['acc12']));
    const d = agyDetected(p, 0, ['#f08a3c']);
    expect(d.short).toBe('12');
    expect(d.id).toBe('agy:acc12');
    expect(d.color).not.toBe('#f08a3c');
    expect(d.name).toBe('acc12 (Agy)');
  });

  it('e-mail: cli.log of a run that just started has none yet, so the newest older log in log/ gives it', () => {
    const root = profiles(['acc1']);
    const state = join(root, 'acc1', '.gemini', 'antigravity-cli');
    mkdirSync(join(state, 'log'));
    writeFileSync(join(state, 'cli.log'), 'I1027 starting\n');
    writeFileSync(join(state, 'log', 'cli-20261026_100000.log'), 'I server_oauth.go:229] OAuth: authenticated successfully as old@x.com\n');
    writeFileSync(join(state, 'log', 'cli-20261027_100000.log'), 'I server_oauth.go:229] OAuth: authenticated successfully as new.name@x.com\n');
    expect(emailFromLogs(state)).toBe('new.name@x.com');
    expect(workerName(discoverAgyProfiles(root)[0])).toBe('new');
  });

});

describe('parseAgyUsage', () => {
  it('turns what is left into how much was used, Gemini only', () => {
    const text = [
      'Gemini Models\tWeekly Limit Remaining\t97%\t2026-10-31T09:52:49Z',
      'Gemini Models\tFive Hour Limit Remaining\t96%\t2026-10-26T08:26:06Z',
      'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-11-02T04:54:53Z',
    ].join('\n');
    const u = parseAgyUsage(text, 1000)!;
    expect(u.source).toBe('agy');
    expect(u.sevenDay).toEqual({ utilization: 3, resetsAt: Date.parse('2026-10-31T09:52:49Z') });
    expect(u.fiveHour?.utilization).toBe(4);
    expect(u.noFiveHour).toBeUndefined();
  });

  it('account without Pro: only the weekly line, flagged as having no 5-hour window', () => {
    const text = [
      'Gemini Models\tWeekly Limit Remaining\t94%\t2026-10-31T08:44:52Z',
      'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-11-02T13:32:44Z',
    ].join('\n');
    const u = parseAgyUsage(text, 1)!;
    expect(u.sevenDay?.utilization).toBe(6);
    expect(u.fiveHour).toBeUndefined();
    expect(u.noFiveHour).toBe(true);
  });

  it('"disabled" = week used up; without the 5 h window only the week remains; nothing = undefined', () => {
    expect(parseAgyUsage('Gemini Models\tWeekly Limit Remaining\tdisabled\t', 1)?.sevenDay).toEqual({ utilization: 100 });
    expect(parseAgyUsage('Gemini Models\tWeekly Limit Remaining\t96%\t2026-10-31T08:44:52Z', 1)?.fiveHour).toBeUndefined();
    expect(parseAgyUsage('agy: not logged in', 1)).toBeUndefined();
  });
});

describe('scanAgyProcs', () => {
  it('finds the accounts\' agy by HOME, tells headless from interactive and finds the Claude above', () => {
    const root = '/h/.agy_profiles';
    const procs = new Map<number, FakeProc>([
      [10, { comm: 'claude', ppid: 1 }],
      [20, { comm: 'python3', ppid: 10 }],
      [30, { comm: 'agy', ppid: 20, home: `${root}/acc2`, args: ['agy', '-p', 'Read x.py\nand y', '--mode', 'plan'], cwd: '/w/proj', start: 5 }],
      [31, { comm: 'agy', ppid: 30, home: `${root}/acc2`, args: ['agy', 'language-server'] }],
      [40, { comm: 'agy', ppid: 1, home: `${root}/acc3`, args: ['agy'], start: 2 }],
      [50, { comm: 'agy', ppid: 1, home: `${root}/acc4`, args: ['agy', '-p', '/usage'] }],
      [60, { comm: 'agy', ppid: 1, home: '/home/eu', args: ['agy', '-p', 'oi'] }],
      [70, { comm: 'agy', ppid: 1, home: `${root}/acc5/sub`, args: ['agy', '-p', 'oi'] }],
    ]);
    const found = scanAgyProcs(root, fakeProc(procs));
    expect(found).toEqual([
      { pid: 40, acc: 'acc3', headless: false, startedAt: BOOT_MS + 2_000, ppid: 1, orphan: true },
      { pid: 30, acc: 'acc2', headless: true, prompt: 'Read x.py\nand y', cwd: '/w/proj', startedAt: BOOT_MS + 5_000, ppid: 20, claudePid: 10 },
    ]);
  });
});

describe('scanAgyProcs: orphans', () => {
  it('an agy whose parent died was reparented to init or systemd --user', () => {
    const root = '/h/.agy_profiles';
    const procs = new Map<number, FakeProc>([
      [5, { comm: 'systemd', ppid: 1 }],
      [6, { comm: 'terminal', ppid: 5 }],
      [30, { comm: 'agy', ppid: 5, home: `${root}/acc2`, args: ['agy', '-p', 'hi'] }],
      [31, { comm: 'agy', ppid: 6, home: `${root}/acc4`, args: ['agy'] }],
    ]);
    const found = scanAgyProcs(root, fakeProc(procs));
    expect(found.find((p) => p.pid === 30)?.orphan).toBe(true);
    expect(found.find((p) => p.pid === 31)?.orphan).toBeUndefined();
  });
});

function setup(names = ['acc2', 'acc3'], opts: { askBin?: string; folder?: string; env?: NodeJS.ProcessEnv } = {}) {
  const root = profiles(names);
  let clock = BOOT_MS + 100_000;
  const now = () => clock;
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: root, env: {}, now, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 'test',
    startedAt: clock,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    now,
  });
  late.office = office;
  const procs = new Map<number, FakeProc>([[10, { comm: 'claude', ppid: 1, cwd: '/w/Habblaud' }]]);
  const killed: Array<[number, string]> = [];
  const source = new AgySource({
    accounts,
    office,
    root,
    home: root,
    askBin: opts.askBin ?? '/nonexistent/worker-ask',
    folder: () => opts.folder ?? '',
    env: opts.env,
    procs: fakeProc(procs),
    kill: (pid, sig) => void killed.push([pid, sig]),
    usage: async (acc) => (acc === 'acc2' ? 'Gemini Models\tWeekly Limit Remaining\t90%\t2030-10-31T09:52:49Z\n' : ''),
    now,
  });
  cleanups.unshift(() => source.stop());
  const seats = (accs: string[]) => accs.map((acc) => ({ acc, agentId: `agy:${acc}`, name: `${acc} (Agy)`, room: '/w/agy-hub' }));
  source.setTeam(seats(names));
  return {
    seats,
    root,
    killed,
    accounts,
    office,
    source,
    procs,
    advance(ms: number) {
      clock += ms;
    },
    agent(acc: string) {
      return office.commit().snapshot.agents.find((a) => a.id === `agy:${acc}`);
    },
    job(pid: number, acc: string, prompt: string, start = 99) {
      procs.set(pid - 1, { comm: 'python3', ppid: 10 });
      procs.set(pid, { comm: 'agy', ppid: pid - 1, home: join(root, acc), args: ['agy', '-p', prompt], cwd: '/w/proj', start });
    },
    start(pid: number, acc: string, line: Record<string, unknown>) {
      appendFileSync(join(root, 'agy-ask.log.jsonl'), `${JSON.stringify({ event: 'start', acc, pid: pid - 1, ts: clock / 1000, ...line })}\n`);
    },
    end(pid: number, acc: string, line: Record<string, unknown>) {
      procs.delete(pid);
      procs.delete(pid - 1);
      appendFileSync(join(root, 'agy-ask.log.jsonl'), `${JSON.stringify({ event: 'end', acc, pid: pid - 1, ts: clock / 1000, ...line })}\n`);
    },
  };
}

describe('AgySource', () => {
  it('each account is a fixed worker, idle and "free", in the workers room', () => {
    const t = setup();
    t.source.start();
    const a = t.agent('acc2')!;
    expect(a).toMatchObject({ kind: 'main', provider: 'agy', name: 'acc2 (Agy)', status: 'idle', roomId: '/w/agy-hub', account: 'agy:acc2' });
    expect(a.title).toBe('free');
    expect(t.source.sources().map((s) => s.label)).toEqual(['acc2', 'acc3']);
  });

  it('headless call = working with the prompt; at the end, "Done" with the agy-ask tokens', () => {
    const t = setup();
    t.source.start();
    t.job(31, 'acc2', 'Summarize GROUND_TRUTH_PLAN_V7.md in 5 bullets');
    t.source.poll();
    let a = t.agent('acc2')!;
    expect(a.status).toBe('working');
    expect(a.activity).toMatchObject({ kind: 'prompt', icon: '📋', text: 'Summarize GROUND_TRUTH_PLAN_V7.md in 5…' });
    expect(t.office.detail('agy:acc2')?.history.at(-1)?.detail).toContain('Habblaud');

    t.advance(12_000);
    t.end(31, 'acc2', { status: 'SUCCESS', sec: 12, usage: { total_tokens: 8_269 } });
    t.source.poll();
    a = t.agent('acc2')!;
    expect(a.status).toBe('idle');
    expect(a.activity).toMatchObject({ kind: 'done', icon: '✅' });
    expect(a.activity?.text).toMatch(/8\.3k tokens$/);
  });

  it('without the agy-ask line (batch script), "Done" comes after the wait, without tokens', () => {
    const t = setup();
    t.source.start();
    t.job(41, 'acc3', 'batch 7');
    t.source.poll();
    t.procs.delete(41);
    t.source.poll();
    expect(t.agent('acc3')).toMatchObject({ status: 'working', activity: { kind: 'prompt' } });
    t.advance(END_WAIT_MS + 1);
    t.source.poll();
    expect(t.agent('acc3')).toMatchObject({ status: 'idle', activity: { kind: 'done', icon: '✅' } });
    expect(t.agent('acc3')?.activity?.text).not.toMatch(/tokens/);
  });

  it('agy-ask TIMEOUT becomes an error activity', () => {
    const t = setup();
    t.source.start();
    t.job(51, 'acc2', 'long job');
    t.source.poll();
    t.end(51, 'acc2', { status: 'TIMEOUT', sec: 900 });
    t.source.poll();
    expect(t.agent('acc2')?.activity).toMatchObject({ kind: 'done', icon: '⚠️', error: true, text: 'Failed: TIMEOUT' });
    expect(t.agent('acc2')?.status).toBe('idle');
  });

  it('ghost check: a headless agy is watched, by its start until a write shows up in the account', () => {
    const t = setup();
    t.source.start();
    t.job(31, 'acc2', 'long');
    t.source.poll();
    const started = BOOT_MS + 99_000;
    expect(t.source.ghostCandidates()).toEqual([{ agentId: 'agy:acc2', name: 'acc2', pid: 31, lastSign: started }]);
    const conv = join(t.root, 'acc2', '.gemini', 'antigravity-cli', 'conversations');
    mkdirSync(conv);
    writeFileSync(join(conv, 'a.db-wal'), 'x');
    const later = started + 3_600_000;
    utimesSync(join(conv, 'a.db-wal'), later / 1000, later / 1000);
    expect(t.source.ghostCandidates()[0].lastSign).toBe(later);
  });

  it('ghost check: no job left when the agy-ask end line is written or the parent is gone', () => {
    const t = setup();
    t.source.start();
    t.job(31, 'acc2', 'answered, then hung');
    t.start(31, 'acc2', { role: 'qa' });
    t.source.poll();
    expect(t.source.ghostCandidates()[0].jobless).toBeUndefined();
    appendFileSync(join(t.root, 'agy-ask.log.jsonl'), `${JSON.stringify({ event: 'end', acc: 'acc2', pid: 30, ts: 1, status: 'SUCCESS' })}\n`);
    t.source.poll();
    expect(t.source.ghostCandidates()[0].jobless).toBe(true);
    t.procs.set(41, { comm: 'agy', ppid: 1, home: join(t.root, 'acc3'), args: ['agy', '-p', 'orphan'] });
    t.source.poll();
    expect(t.source.ghostCandidates().find((c) => c.pid === 41)?.jobless).toBe(true);
  });

  it('ghost check: an interactive agy under a live terminal is left alone, an orphan one is not', () => {
    const t = setup();
    t.source.start();
    t.procs.set(20, { comm: 'terminal', ppid: 10 });
    t.procs.set(21, { comm: 'agy', ppid: 20, home: join(t.root, 'acc2'), args: ['agy'] });
    expect(t.source.ghostCandidates()).toEqual([]);
    t.procs.set(21, { comm: 'agy', ppid: 1, home: join(t.root, 'acc2'), args: ['agy'] });
    expect(t.source.ghostCandidates()).toMatchObject([{ pid: 21, jobless: true }]);
  });

  it('ghost check: a profile with no character is not watched', () => {
    const t = setup();
    t.source.setTeam(t.seats(['acc2']));
    t.source.start();
    t.job(31, 'acc3', 'not a worker');
    expect(t.source.ghostCandidates()).toEqual([]);
  });

  it('no /usage while the account\'s agy is running (one agy per profile)', async () => {
    const t = setup();
    t.source.start();
    t.procs.set(77, { comm: 'agy', ppid: 1, home: join(t.root, 'acc2'), args: ['agy'] });
    await t.source.refreshUsage();
    expect(t.accounts.list(new Map()).find((a) => a.id === 'agy:acc2')?.usage).toBeUndefined();
  });

  it('each account\'s /usage becomes the account usage (no answer, no usage)', async () => {
    const t = setup();
    t.source.start();
    await t.source.refreshUsage();
    const acc = t.accounts.list(new Map()).find((a) => a.id === 'agy:acc2')!;
    expect(acc.provider).toBe('agy');
    expect(acc.usage?.sevenDay?.utilization).toBe(10);
    expect(t.accounts.list(new Map()).find((a) => a.id === 'agy:acc3')?.usage).toBeUndefined();
  });

  it('the request role is the title only while working (without --role, free); today\'s tokens add up', () => {
    const t = setup();
    t.source.start();
    t.start(31, 'acc2', { role: 'review', mode: 'plan' });
    t.job(31, 'acc2', 'Review the diff');
    t.source.poll();
    expect(t.agent('acc2')).toMatchObject({ title: 'review', permissionMode: 'plan' });
    t.end(31, 'acc2', { status: 'SUCCESS', usage: { input_tokens: 7_000, output_tokens: 200, thinking_tokens: 100, total_tokens: 7_300 } });
    t.source.poll();
    expect(t.agent('acc2')?.title).toBe('free');
    expect(t.agent('acc2')?.stats).toMatchObject({ tokensIn: 7_000, tokensOut: 300 });

    t.job(41, 'acc2', 'Implement it');
    t.source.poll();
    expect(t.agent('acc2')?.title).toBe('free');
  });

  it('boot sums today\'s tokens already in the log (and ignores yesterday\'s)', () => {
    const t = setup();
    const day = 86_400;
    appendFileSync(join(t.root, 'agy-ask.log.jsonl'), [
      JSON.stringify({ event: 'end', acc: 'acc3', pid: 1, ts: (BOOT_MS + 100_000) / 1000 - 2 * day, usage: { input_tokens: 999, output_tokens: 9 } }),
      JSON.stringify({ event: 'end', acc: 'acc3', pid: 2, ts: (BOOT_MS + 100_000) / 1000 - 1, usage: { input_tokens: 50, output_tokens: 5 } }),
    ].join('\n') + '\n');
    t.source.start();
    expect(t.agent('acc3')?.stats).toMatchObject({ tokensIn: 50, tokensOut: 5 });
  });

  it('sending a job validates the seat, mode, role and prompt (no folder = 400)', () => {
    const t = setup();
    t.source.start();
    expect(t.source.assign('agy:nada', { prompt: 'x', mode: 'plan' })).toMatchObject({ ok: false, status: 404 });
    expect(t.source.assign('agy:acc2', { prompt: 'x', mode: 'plan' })).toMatchObject({ ok: false, status: 400 });
  });

  it('stop kills the job\'s agy-ask (which takes agy with it); without agy-ask, agy itself; never another PID', () => {
    const t = setup();
    t.source.start();
    t.start(31, 'acc2', { role: 'qa' });
    t.job(31, 'acc2', 'via agy-ask');
    t.job(51, 'acc2', 'script em lote');
    t.source.poll();
    expect(t.source.stopJobs('agy:acc2')).toBe(2);
    expect(t.killed).toEqual([
      [30, 'SIGTERM'],
      [51, 'SIGTERM'],
    ]);
    expect(t.source.stopJobs('agy:acc3')).toBe(0);
  });

  it('a badge earned live throws a party and notifies; what was already in the log at boot is only state', () => {
    const t = setup();
    appendFileSync(join(t.root, 'agy-ask.log.jsonl'), `${JSON.stringify({ event: 'end', acc: 'acc3', pid: 1, ts: 1, status: 'SUCCESS', sec: 30, usage: { total_tokens: 10 } })}\n`);
    t.source.start();
    t.office.commit();
    expect(t.agent('acc3')?.progress).toMatchObject({ level: 1, jobs: 1, badges: [{ id: 'first' }] });
    t.job(31, 'acc2', 'quick one');
    t.source.poll();
    t.advance(5_000);
    t.end(31, 'acc2', { status: 'SUCCESS', sec: 5, usage: { total_tokens: 100 } });
    t.source.poll();
    const { snapshot, notices } = t.office.commit();
    expect(snapshot.agents.find((a) => a.id === 'agy:acc2')?.progress?.badges.map((b) => b.id)).toEqual(['first', 'flash']);
    expect(notices.filter((n) => n.text.startsWith('🏆')).length).toBe(2);
    expect(snapshot.rooms.find((r) => r.id === '/w/agy-hub')?.effect).toMatchObject({ kind: 'party' });
  });

  it('auto is accepted as a mode of the page defaults (AGY_MODES)', () => {
    const t = setup(['acc2']);
    expect(t.source.setDefaults('agy:acc2', { mode: 'auto' })).toEqual({ ok: true });
  });

  it('mode and effort: what agy applied (its log) while working, the defaults (defaults.json) when idle', () => {
    const t = setup();
    t.source.start();
    expect(t.source.setDefaults('agy:acc2', { mode: 'accept-edits', effort: 'low' })).toEqual({ ok: true });
    expect(t.source.setDefaults('agy:acc2', { effort: 'max' })).toMatchObject({ ok: false, error: 'unknown effort' });
    t.source.poll();
    expect(t.agent('acc2')).toMatchObject({ model: 'gemini-3.8-flash', effort: 'low', permissionMode: 'accept-edits', agyDefaults: { mode: 'accept-edits', effort: 'low' } });
    // A job asked for high in plan mode; until agy's log says otherwise, that is what shows.
    t.start(41, 'acc2', { mode: 'plan', effort: 'high' });
    t.job(41, 'acc2', 'Review it');
    t.source.poll();
    expect(t.agent('acc2')).toMatchObject({ effort: 'high', permissionMode: 'plan' });
    const log = join(t.root, 'acc2', '.gemini', 'antigravity-cli', 'log');
    mkdirSync(log, { recursive: true });
    writeFileSync(
      join(log, 'cli-20261027_231228.log'),
      'I1 server.go:1836] Starting language server process with pid 41\nI1 printmode.go:857] Print mode: applying agent mode plan\nI1 x.go:1] Propagating selected model override to backend: label="Gemini 3.8 Flash (Medium)"\n',
    );
    t.source.poll();
    expect(t.agent('acc2')).toMatchObject({ model: 'gemini-3.8-flash', effort: 'medium', permissionMode: 'plan' });
  });

  it('job effort is validated: only the Gemini 3.8 Flash levels', () => {
    const t = setup();
    t.source.start();
    (t.source as unknown as { opts: { folder: () => string } }).opts.folder = () => t.root;
    expect(t.source.assign('agy:acc2', { prompt: 'x', mode: 'plan', effort: 'max' })).toMatchObject({ ok: false, error: 'unknown effort' });
  });

  it('the room board shows the jobs (requester, role, outcome) and the latest order given to the boss', () => {
    const t = setup();
    t.office.addMain({ id: '.claude:10', account: '.claude', sessionId: 's10', cwd: '/w/Habblaud', role: 'Main agent', startedAt: BOOT_MS, status: 'working' });
    t.office.setBoss('.claude:10', true);
    t.source.start();
    t.office.addActivity('.claude:10', { id: 'p1', kind: 'prompt', icon: '💬', text: 'Split the review', detail: 'Split the PR review among the workers', at: BOOT_MS + 100_000 }, true);
    t.start(31, 'acc2', { role: 'review', claude_pid: 10 });
    t.job(31, 'acc2', 'Review   the\nPR diff');
    t.source.poll();
    let board = t.office.commit().snapshot.rooms.find((r) => r.id === '/w/agy-hub')?.board;
    expect(board?.order).toMatchObject({ text: 'Split the PR review among the workers', boss: expect.any(String) });
    expect(board?.items).toEqual([expect.objectContaining({ worker: 'acc2', role: 'review', text: 'Review the PR diff', status: 'working' })]);
    t.end(31, 'acc2', { status: 'SUCCESS', usage: { total_tokens: 4_200 } });
    t.source.poll();
    board = t.office.commit().snapshot.rooms.find((r) => r.id === '/w/agy-hub')?.board;
    expect(board?.items[0]).toMatchObject({ status: 'done', tokens: 4_200 });
  });

  it('the board is rebuilt from the agy-ask log at boot; a job gone without an end line is failed', () => {
    const t = setup();
    const at = (BOOT_MS + 50_000) / 1000;
    const log = [
      { event: 'start', acc: 'acc2', pid: 7, ts: at, role: 'review', claude_pid: 10, prompt: 'Review the diff' },
      { event: 'end', acc: 'acc2', pid: 7, ts: at + 30, status: 'SUCCESS', sec: 30, usage: { total_tokens: 1_500 } },
      { event: 'start', acc: 'acc3', pid: 8, ts: at + 40, prompt: 'Killed hard' },
    ];
    appendFileSync(join(t.root, 'agy-ask.log.jsonl'), log.map((l) => `${JSON.stringify(l)}\n`).join(''));
    t.source.start();
    const board = t.office.commit().snapshot.rooms.find((r) => r.id === '/w/agy-hub')?.board;
    expect(board?.items).toEqual([
      expect.objectContaining({ id: 'agy:acc3#8', text: 'Killed hard', status: 'failed' }),
      expect.objectContaining({ id: 'agy:acc2#7', text: 'Review the diff', role: 'review', status: 'done', tokens: 1_500 }),
    ]);
  });

  it('team: only seated accounts get a character; every profile is an account', () => {
    const t = setup(['acc2', 'acc3', 'acc4']);
    expect(t.source.profiles()).toEqual([
      { acc: 'acc2', account: 'agy:acc2' },
      { acc: 'acc3', account: 'agy:acc3' },
      { acc: 'acc4', account: 'agy:acc4' },
    ]);
    t.source.setTeam(t.seats(['acc2']));
    t.source.start();
    expect(t.agent('acc2')?.status).toBe('idle');
    expect(t.agent('acc3')).toBeUndefined();
    // every profile stays an account (usage, login terminal)
    expect(t.accounts.list(new Map()).map((a) => a.id)).toEqual(['agy:acc2', 'agy:acc3', 'agy:acc4']);
    // a job of an account without a seat is not watched
    t.job(31, 'acc3', 'Hello');
    t.source.poll();
    expect(t.agent('acc3')).toBeUndefined();
    // no seats = no characters
    t.source.setTeam([]);
    expect(t.agent('acc2')?.status).toBe('offline');
  });

  it('setTeam: a new worker walks in right away, a removed one leaves (and can come back)', () => {
    const t = setup();
    t.source.start();
    expect(t.agent('acc3')?.status).toBe('idle');
    t.source.setTeam(t.seats(['acc2']));
    expect(t.agent('acc3')?.status).toBe('offline');
    // gone after the grace period, then registered again
    t.advance(60_000);
    t.office.tick();
    expect(t.agent('acc3')).toBeUndefined();
    t.source.setTeam(t.seats(['acc2', 'acc3']));
    expect(t.agent('acc3')).toMatchObject({ status: 'idle', name: 'acc3 (Agy)', roomId: '/w/agy-hub' });
    // back during the grace period: the same character returns
    t.source.setTeam(t.seats(['acc2']));
    t.source.setTeam(t.seats(['acc2', 'acc3']));
    expect(t.agent('acc3')?.status).toBe('idle');
  });

  it('rescan: an account logged in later becomes an account (and a worker once registered); one removed leaves', () => {
    const t = setup();
    t.source.start();
    mkdirSync(join(t.root, 'acc5', '.gemini', 'antigravity-cli'), { recursive: true });
    // agy made the folder but the account is not signed in yet: not an account
    (t.source as unknown as { rescan(): void }).rescan();
    expect(t.source.profiles().map((p) => p.acc)).toEqual(['acc2', 'acc3']);
    writeFileSync(join(t.root, 'acc5', '.gemini', 'antigravity-cli', 'cli.log'), 'I1 server_oauth.go:1] OAuth: authenticated as five@example.com\n');
    (t.source as unknown as { rescan(): void }).rescan();
    expect(t.source.profiles().map((p) => p.acc)).toEqual(['acc2', 'acc3', 'acc5']);
    expect(t.accounts.list(new Map()).find((a) => a.id === 'agy:acc5')).toBeTruthy();
    // colors stay put across rescans
    const colors = t.accounts.list(new Map()).map((a) => a.color);
    (t.source as unknown as { rescan(): void }).rescan();
    expect(t.accounts.list(new Map()).map((a) => a.color)).toEqual(colors);
    t.source.setTeam(t.seats(['acc2', 'acc3', 'acc5']));
    expect(t.agent('acc5')?.status).toBe('idle');
    rmSync(join(t.root, 'acc3'), { recursive: true, force: true });
    (t.source as unknown as { rescan(): void; syncCharacters(): void }).rescan();
    (t.source as unknown as { syncCharacters(): void }).syncCharacters();
    expect(t.agent('acc3')?.status).toBe('offline');
    expect(t.source.profiles().map((p) => p.acc)).toEqual(['acc2', 'acc5']);
  });

  it('two seats on one account: named by seat in the folder room; the board still shows; a terminal job only on its seat', () => {
    const t = setup();
    let busy = '';
    t.source.setExternal((id) => ({ busy: id === busy }));
    t.source.setTeam([
      { acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: '/w/ocr' },
      { acc: 'acc2', agentId: 'agy:acc2@W2', name: 'W2', room: '/w/ocr' },
    ]);
    t.source.start();
    const get = (id: string) => t.office.commit().snapshot.agents.find((a) => a.id === id);
    expect(get('agy:acc2')).toMatchObject({ name: 'W1', roomId: '/w/ocr' });
    expect(get('agy:acc2@W2')).toMatchObject({ name: 'W2', roomId: '/w/ocr', provider: 'agy' });
    busy = 'agy:acc2@W2';
    t.source.poll();
    expect([get('agy:acc2')?.status, get('agy:acc2@W2')?.status]).toEqual(['idle', 'working']);
    t.source.upsertJob({ id: 'agy:acc2@W2#w1', agentId: 'agy:acc2@W2', worker: 'W2', text: 'two', status: 'working', at: 1 });
    expect(t.office.commit().snapshot.rooms.find((r) => r.id === '/w/ocr')?.board?.items.map((i) => i.worker)).toEqual(['W2']);
    // a headless agy of acc2 (seen in /proc) shows on the account's first seat
    t.job(41, 'acc2', 'Hello');
    t.source.poll();
    expect(get('agy:acc2')?.status).toBe('working');
    // the first seat keeps its old session id; the second is its own
    expect(t.office.get('agy:acc2')?.sessionId).toBe('agy-acc2');
    expect(t.office.get('agy:acc2@W2')?.sessionId).toBe('agy-agy:acc2@W2');
  });

  it('a seat that keeps its id follows team.json: new folder moves the character and the board, a rename renames it', () => {
    const t = setup();
    t.source.setTeam([{ acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: '' }]);
    t.source.start();
    t.source.upsertJob({ id: 'agy:acc2#w1', agentId: 'agy:acc2', worker: 'W1', text: 'one', status: 'working', at: 1 });
    const room = (id: string) => t.office.commit().snapshot.rooms.find((r) => r.id === id);
    expect(t.office.get('agy:acc2')?.roomId).toBe(t.root);
    t.source.setTeam([{ acc: 'acc2', agentId: 'agy:acc2', name: 'Ann', room: '/w/ocr' }]);
    expect(t.office.get('agy:acc2')).toMatchObject({ roomId: '/w/ocr', name: 'Ann' });
    expect(room('/w/ocr')?.board?.items.length).toBe(1);
    expect(room(t.root)).toBeUndefined();
  });

  it('an Antigravity boss seat is titled boss; the worker seat of the same account is not', () => {
    const t = setup();
    t.source.setTeam([
      { acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: '/w/ocr' },
      { acc: 'acc2', agentId: 'agy-boss:acc2', name: 'two (Agy)', room: '/w/ocr', boss: true },
    ]);
    t.source.start();
    const title = (id: string) => t.office.commit().snapshot.agents.find((a) => a.id === id)?.title;
    expect([title('agy-boss:acc2'), title('agy:acc2')]).toEqual(['boss', 'free']);
  });

  it('an account with only the boss seat sorts first: the board still publishes', () => {
    const t = setup(['acc1', 'acc2']);
    t.source.setTeam([
      { acc: 'acc1', agentId: 'agy-boss:acc1', name: 'boss', room: '/w/ocr', boss: true },
      { acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: '/w/ocr' },
    ]);
    t.source.start();
    t.source.upsertJob({ id: 'agy:acc2#w1', agentId: 'agy:acc2', worker: 'W1', text: 'one', status: 'working', at: 1 });
    expect(t.office.commit().snapshot.rooms.find((r) => r.id === '/w/ocr')?.board?.items).toHaveLength(1);
  });

  it('assign runs worker-ask with the seat name in the office folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bang-ask-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const askBin = join(dir, 'ask');
    const out = join(dir, 'out.txt');
    writeFileSync(askBin, '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$@" > "$OUT"\n', { mode: 0o755 });
    const folder = realpathSync(dir);
    const t = setup(['acc2'], { askBin, folder, env: { ...process.env, OUT: out } });
    t.source.setTeam([
      { acc: 'acc2', agentId: 'agy:acc2', name: 'W1', room: folder },
      { acc: 'acc2', agentId: 'agy:acc2@W2', name: 'W2', room: folder },
    ]);
    expect(t.source.assign('agy:acc2@W2', { prompt: 'x', mode: 'plan' })).toEqual({ ok: true });
    for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    expect(readFileSync(out, 'utf8').trim().split('\n')).toEqual([folder, 'W2', 'x', '--raw', '--role', 'manual', '--max', '2000', '--mode', 'plan']);
    // no folder yet: refused before anything runs
    const none = setup(['acc2']);
    expect(none.source.assign('agy:acc2', { prompt: 'x' })).toMatchObject({ ok: false, status: 400 });
  });
  it('a Claude-only team: a terminal job shows on the board of the folder room', () => {
    const t = setup([], { folder: '/w/ocr' });
    t.source.setTeam([]);
    t.office.addMain({ id: 'claude-worker:C1', account: '.claude-w', sessionId: 'claude-worker:C1', cwd: '/w/ocr', role: 'Worker', name: 'C1', startedAt: 1, status: 'idle' });
    t.source.upsertJob({ id: 'claude-worker:C1#j1', agentId: 'claude-worker:C1', worker: 'C1', text: 'one', status: 'working', at: 1 });
    expect(t.office.commit().snapshot.rooms.find((r) => r.id === '/w/ocr')?.board?.items.map((i) => i.worker)).toEqual(['C1']);
  });

  it('a headless job of worker-ask shows the task of its start line, not the seat preamble of its argv', () => {
    const t = setup();
    t.source.start();
    t.start(51, 'acc2', { prompt: '# Việc T1 — đếm số' });
    t.job(51, 'acc2', 'Bạn là ghế W1 trong office /w. Luật: …\n---\n# Việc T1 — đếm số');
    t.source.poll();
    expect(t.agent('acc2')?.activity).toMatchObject({ kind: 'prompt', text: '# Việc T1 — đếm số' });
    expect(t.office.commit().snapshot.rooms.flatMap((r) => r.board?.items ?? []).map((i) => i.text)).toEqual(['# Việc T1 — đếm số']);
  });
});
