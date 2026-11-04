// Worker terminals: jobs restart the worker's terminal with the request, the answer comes from the conversation file.
// Fake terminals; real temporary files.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobBoardItem, PtyInfo } from '../../shared/types';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { IDLE_CLOSE_MS, LEAN_TOOLS, leanClaudeArgs, START_SETTLE_MS, TRUST_WAIT_MS, WorkerService, type WorkerPtys, type WorkerTarget } from './service';
import { agyTranscriptPath, agyTurn, claudeTranscriptPath, claudeTurn, lastWrite } from './turns';

const T0 = 1_800_000_000_000;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const step = (o: Record<string, unknown>) => JSON.stringify(o);
const CONV = '26a99462-96c2-4742-9f6d-a9a3620e7176';
const CONV2 = '3b094ff8-a5b3-44d7-82d5-ac4ec8b1b6cc';
const settle = () => new Promise((r) => setImmediate(r));

describe('lastWrite', () => {
  it('the newest of the conversation databases, their transcripts and the log', () => {
    const state = mkdtempSync(join(tmpdir(), 'habblaud-lastwrite-'));
    dirs.push(state);
    expect(lastWrite(state)).toBe(0);
    mkdirSync(join(state, 'conversations'));
    const at = (path: string, sec: number) => {
      writeFileSync(path, 'x');
      utimesSync(path, sec, sec);
    };
    at(join(state, 'conversations', `${CONV}.db`), 1_000);
    at(join(state, 'conversations', `${CONV}.db-wal`), 2_000);
    expect(lastWrite(state)).toBe(2_000_000);
    const transcript = agyTranscriptPath(state, CONV);
    mkdirSync(dirname(transcript), { recursive: true });
    at(transcript, 3_000);
    expect(lastWrite(state)).toBe(3_000_000);
    at(join(state, 'cli.log'), 4_000);
    expect(lastWrite(state, join(state, 'cli.log'))).toBe(4_000_000);
    expect(lastWrite(state, join(state, 'gone.log'))).toBe(3_000_000);
  });
});

describe('turns', () => {
  it('agy: over when the last step is a planner response without tool calls; its content is the answer', () => {
    const user = step({ type: 'USER_INPUT', status: 'DONE', content: 'hi' });
    const tool = step({ type: 'PLANNER_RESPONSE', status: 'DONE', input_tokens: '100', output_tokens: '5', tool_calls: [{ name: 'run_command' }] });
    const out = step({ type: 'GENERIC', status: 'DONE', content: 'ok' });
    const fin = step({ type: 'PLANNER_RESPONSE', status: 'DONE', input_tokens: '200', output_tokens: '7', content: ' pong ' });
    expect(agyTurn([user, tool, out].join('\n'))).toEqual({ prompts: 1, ended: false, tokens: 105 });
    expect(agyTurn([user, tool, out, fin, ''].join('\n'))).toEqual({ prompts: 1, ended: true, answer: 'pong', tokens: 312 });
    expect(agyTurn('')).toEqual({ prompts: 0, ended: false, tokens: 0 });
  });

  it('claude: over at end_turn with no tool pending; usage counted once per message', () => {
    const user = step({ type: 'user', message: { role: 'user', content: 'do it' } });
    const a1 = step({ type: 'assistant', message: { id: 'm1', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: 'tool_use', id: 't1' }] } });
    const res = step({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
    const u2 = { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 1000, cache_creation_input_tokens: 400 };
    const a2a = step({ type: 'assistant', message: { id: 'm2', stop_reason: null, usage: u2, content: [{ type: 'thinking', thinking: '…' }] } });
    const a2b = step({ type: 'assistant', message: { id: 'm2', stop_reason: 'end_turn', usage: u2, content: [{ type: 'text', text: 'Done.' }] } });
    expect(claudeTurn([user, a1].join('\n')).ended).toBe(false);
    // cached prompt tokens count too (input_tokens alone leaves them out)
    expect(claudeTurn([user, a1, res, a2a, a2b].join('\n'))).toEqual({
      prompts: 1,
      ended: true,
      answer: 'Done.',
      tokens: 1435,
      usage: { input_tokens: 30, output_tokens: 5, cache_read_tokens: 1000, cache_creation_tokens: 400 },
    });
  });
});

function fakePtys() {
  const open = new Map<string, PtyInfo & { args: string[]; env?: Record<string, string>; file: string }>();
  const typed: Array<[string, string]> = [];
  let pid = 100;
  const ptys: WorkerPtys = {
    openProgram: (p) => {
      const info = { id: `p${pid}`, pid: pid++, cwd: p.cwd, account: p.account, agentId: p.agentId, startedAt: T0, args: p.args, env: p.env, file: p.file };
      open.set(p.agentId, info);
      return info;
    },
    ofAgent: (id) => open.get(id),
    typeTo: (id, data) => {
      typed.push([id, data]);
      return open.has(id);
    },
    closeAgent: (id) => void open.delete(id),
  };
  return { ptys, open, typed };
}

function setup(workers = ['W1', 'W2', 'C1']) {
  const root = mkdtempSync(join(tmpdir(), 'habblaud-workers-'));
  dirs.push(root);
  const stateDir = join(root, 'acc2', '.gemini', 'antigravity-cli');
  mkdirSync(join(stateDir, 'brain', '0000aaaa-0000-0000-0000-000000000000'), { recursive: true });
  const configDir = join(root, '.claude-w');
  let clock = T0;
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: T0, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => clock });
  office.addMain({ id: 'agy:acc2', provider: 'agy', account: 'agy:acc2', sessionId: 'agy-acc2', cwd: '/w/agy-hub', role: 'Worker', name: 'W1', startedAt: T0, status: 'idle' });
  office.addMain({ id: 'agy:acc2@W2', provider: 'agy', account: 'agy:acc2', sessionId: 'agy-acc2-W2', cwd: '/w/agy-hub', role: 'Worker', name: 'W2', startedAt: T0, status: 'idle' });
  const all: WorkerTarget[] = [
    { id: 'W1', kind: 'agy', agentId: 'agy:acc2', account: 'agy:acc2', name: 'W1', acc: 'acc2', stateDir },
    { id: 'W2', kind: 'agy', agentId: 'agy:acc2@W2', account: 'agy:acc2', name: 'W2', acc: 'acc2', stateDir },
    { id: 'C1', kind: 'claude', agentId: 'claude-worker:C1', account: '.claude-w', name: 'C1', configDir },
  ];
  let folder = root;
  let registered = workers;
  const f = fakePtys();
  const board: JobBoardItem[] = [];
  let changes = 0;
  const logFile = join(root, 'agy-ask.log.jsonl');
  const svc = new WorkerService({
    office,
    ptys: f.ptys,
    targets: () => all.filter((t) => registered.includes(t.id)),
    agyBin: '/bin/agy-as',
    claudeBin: '/bin/claude',
    folder: () => folder,
    logFile,
    onChange: () => void changes++,
    board: (i) => void board.push(i),
    now: () => clock,
    sleep: async () => undefined,
  });
  svc.sync();
  /** agy writes the conversation of the job it just opened. */
  const agyWrites = (lines: Array<Record<string, unknown>>, conv = CONV) => {
    const dir = join(stateDir, 'brain', conv, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'transcript.jsonl'), lines.map(step).join('\n') + '\n');
  };
  return {
    root,
    svc,
    office,
    board,
    logFile,
    configDir,
    ...f,
    agyWrites,
    setFolder: (f: string) => void (folder = f),
    advance: (ms: number) => (clock += ms),
    register: (w: string[]) => (registered = w),
    changes: () => changes,
    log: () => readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const answer = (content: string) => [{ type: 'USER_INPUT', status: 'DONE', content: 'q' }, { type: 'PLANNER_RESPONSE', status: 'DONE', input_tokens: '50', output_tokens: '5', content }];

describe('WorkerService', () => {
  it('agy job: the terminal restarts with the request, the answer comes from the new conversation, cut to max', async () => {
    const t = setup();
    const r = await t.svc.ask({ worker: 'W1', prompt: 'Say pong', mode: 'plan', effort: 'low', role: 'qa', max: 200 });
    expect(r).toMatchObject({ ok: true, job: { status: 'working', role: 'qa' } });
    expect(t.open.get('agy:acc2')).toMatchObject({ file: '/bin/agy-as', args: ['acc2', '-i', 'Say pong', '--mode', 'plan', '--effort', 'low'] });
    expect(t.open.get('agy:acc2')?.env).not.toHaveProperty('AGY_OFFICE');
    t.svc.tick();
    expect(t.svc.jobs()[0].status).toBe('working');
    t.agyWrites(answer('x'.repeat(500)));
    t.svc.tick();
    const job = t.svc.jobs()[0];
    expect(job).toMatchObject({ status: 'done', tokens: 55 });
    expect(job.answer!.length).toBeLessThanOrEqual(200);
    expect(t.svc.sessionList()[0]).toMatchObject({ worker: 'W1' });
    expect(t.log().map((l) => [l.event, l.status, l.via])).toEqual([
      ['start', undefined, 'terminal'],
      ['end', 'SUCCESS', 'terminal'],
    ]);
    expect(t.board.at(-1)).toMatchObject({ status: 'done', job: job.id, workerId: 'W1', role: 'qa' });
    // the terminal stays open after the job
    expect(t.open.has('agy:acc2')).toBe(true);
  });

  it('ghost check: a running job reports when its conversation last grew; nothing once it is over', async () => {
    const t = setup();
    expect(t.svc.ghostCandidates()).toEqual([]);
    await t.svc.ask({ worker: 'W1', prompt: 'long one' });
    expect(t.svc.ghostCandidates()).toEqual([{ agentId: 'agy:acc2', name: 'W1', pid: t.open.get('agy:acc2')!.pid, lastSign: T0 }]);
    t.advance(5_000);
    t.svc.tick();
    expect(t.svc.ghostCandidates()[0].lastSign).toBe(T0);
    t.agyWrites([{ type: 'USER_INPUT', status: 'DONE', content: 'q' }]);
    t.svc.tick();
    expect(t.svc.ghostCandidates()[0].lastSign).toBe(T0 + 5_000);
    t.advance(5_000);
    t.svc.tick();
    expect(t.svc.ghostCandidates()[0].lastSign).toBe(T0 + 5_000);
    t.agyWrites(answer('done'));
    t.svc.tick();
    expect(t.svc.ghostCandidates()).toEqual([]);
  });

  it('one job at a time; waitJob returns once it is over', async () => {
    const t = setup();
    const r = await t.svc.ask({ worker: 'W1', prompt: 'one' });
    expect(await t.svc.ask({ worker: 'W1', prompt: 'two' })).toMatchObject({ ok: false, status: 409, busy: 'job' });
    const id = (r as { job: { id: string } }).job.id;
    const waiting = t.svc.waitJob(id, 30);
    t.agyWrites(answer('pong'));
    t.svc.tick();
    expect(await waiting).toMatchObject({ status: 'done', answer: 'pong' });
    expect(await t.svc.ask({ worker: 'nope', prompt: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  it('a job waiting for the old terminal to close does not take an old conversation as its own', async () => {
    const t = setup();
    t.agyWrites(answer('an old answer'), '0000aaaa-0000-0000-0000-000000000000');
    await t.svc.ask({ worker: 'W1', prompt: 'first' });
    t.agyWrites(answer('first answer'));
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'done', answer: 'first answer' });
    // The first job's terminal closes slowly; the office keeps ticking meanwhile.
    let closing = false;
    let inTick = false;
    const ofAgent = t.ptys.ofAgent;
    t.ptys.closeAgent = () => void (closing = true);
    t.ptys.ofAgent = (id) => {
      if (closing && !inTick) {
        inTick = true;
        t.svc.tick();
        inTick = false;
        closing = false;
        t.open.delete(id);
      }
      return ofAgent(id);
    };
    await t.svc.ask({ worker: 'W1', prompt: 'second' });
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'working' });
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'working' });
    t.agyWrites(answer('second answer'), '3b094ff8-a5b3-44d7-82d5-ac4ec8b1b6cc');
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'done', answer: 'second answer' });
  });

  it('a job cancelled while the old terminal is closing never starts', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'first' });
    t.agyWrites(answer('done'));
    t.svc.tick();
    const firstPty = t.open.get('agy:acc2')!.id;
    let closing = false;
    const ofAgent = t.ptys.ofAgent;
    t.ptys.closeAgent = () => void (closing = true);
    t.ptys.ofAgent = (id) => {
      if (closing) {
        closing = false;
        t.svc.cancel({ all: true });
        t.open.delete(id);
      }
      return ofAgent(id);
    };
    expect(await t.svc.ask({ worker: 'W1', prompt: 'second' })).toMatchObject({ ok: true, job: { status: 'cancelled' } });
    expect(t.open.has('agy:acc2')).toBe(false);
    expect(firstPty).toBeTruthy();
    expect(t.log().filter((l) => l.event === 'start')).toHaveLength(1);
  });

  it('cancel one job or all; a timeout or a closed terminal fails the job', async () => {
    const t = setup();
    const a = await t.svc.ask({ worker: 'W1', prompt: 'a' });
    expect(t.svc.cancel({ job: (a as { job: { id: string } }).job.id })).toBe(1);
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'cancelled' });
    await t.svc.ask({ worker: 'W1', prompt: 'b' });
    await t.svc.ask({ worker: 'C1', prompt: 'c' });
    expect(t.svc.cancel({ all: true })).toBe(2);
    await t.svc.ask({ worker: 'W1', prompt: 'd' });
    t.open.delete('agy:acc2');
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'failed', error: 'the terminal closed before the answer' });
    await t.svc.ask({ worker: 'W1', prompt: 'e' });
    t.advance(31 * 60_000);
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'failed' });
    expect(t.log().at(-1)).toMatchObject({ status: 'TIMEOUT' });
  });

  it('Claude worker: its own character; the job runs with a chosen session id and its transcript answers', async () => {
    const t = setup();
    expect(t.office.get('claude-worker:C1')).toMatchObject({ kind: 'main', name: 'C1', status: 'idle' });
    const r = await t.svc.ask({ worker: 'C1', prompt: 'Review x', mode: 'accept-edits', model: 'haiku', cwd: t.root });
    expect(r.ok).toBe(true);
    const p = t.open.get('claude-worker:C1')!;
    expect(p.file).toBe('/bin/claude');
    expect(p.env).toMatchObject({ CLAUDE_CONFIG_DIR: t.configDir });
    const sid = p.args[1];
    expect(p.args).toEqual(['--session-id', sid, '--permission-mode', 'acceptEdits', '--model', 'haiku', 'Review x']);
    expect(t.svc.ownsPid(p.pid)).toBe(true);
    expect(t.office.get('claude-worker:C1')?.status).toBe('working');
    const file = claudeTranscriptPath(t.configDir, t.root, sid);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      [
        step({ type: 'user', message: { role: 'user', content: 'Review x' } }),
        step({ type: 'assistant', message: { id: 'm', stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 1 }, content: [{ type: 'text', text: 'LGTM' }] } }),
      ].join('\n'),
    );
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'done', answer: 'LGTM', tokens: 10 });
    expect(t.office.get('claude-worker:C1')?.status).toBe('idle');
  });

  it('Claude worker in a folder its account does not trust: the job fails fast instead of waiting at the dialog', async () => {
    const t = setup();
    mkdirSync(t.configDir, { recursive: true });
    const trust = (dir: string) => writeFileSync(join(t.configDir, '.claude.json'), JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }));
    trust('/elsewhere');
    await t.svc.ask({ worker: 'C1', prompt: 'Find x', cwd: t.root });
    t.advance(TRUST_WAIT_MS - 1000);
    t.svc.tick();
    expect(t.svc.jobs()[0].status).toBe('working');
    t.advance(2000);
    t.svc.tick();
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('does not trust the folder') });
    expect(t.typed).toContainEqual(['claude-worker:C1', '\x1b']);
    // a trusted parent folder: the job keeps waiting
    trust(join(t.root, '..'));
    await t.svc.ask({ worker: 'C1', prompt: 'Find y', cwd: t.root });
    t.advance(TRUST_WAIT_MS + 1000);
    t.svc.tick();
    expect(t.svc.jobs()[0].status).toBe('working');
  });

  it('Claude worker, lean job (claude-ask): no MCP, skills or slash commands, few tools, the worker rule with the cap', async () => {
    const t = setup();
    expect((await t.svc.ask({ worker: 'C1', prompt: 'Find x', max: 500, lean: true, cwd: t.root })).ok).toBe(true);
    const args = t.open.get('claude-worker:C1')!.args;
    expect(args.slice(2, -1)).toEqual(leanClaudeArgs(500));
    expect(args.at(-1)).toBe('Find x');
    expect(args[args.indexOf('--tools') + 1]).toBe(LEAN_TOOLS);
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('under 500 characters');
  });

  it('a worker that is no longer registered loses its job, terminal and (Claude) character', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'C1', prompt: 'x' });
    t.register(['W1']);
    t.svc.sync();
    expect(t.svc.jobs()[0].status).toBe('cancelled');
    expect(t.open.has('claude-worker:C1')).toBe(false);
    expect(t.office.get('claude-worker:C1')?.status).toBe('offline');
    expect(t.svc.sessionList().map((s) => s.worker)).toEqual(['W1']);
  });

  it('stopping a job that has just ended does not press Esc (it would quit an idle agy): the job is done', async () => {
    const t = setup();
    const r = await t.svc.ask({ worker: 'W1', prompt: 'quick' });
    t.agyWrites(answer('already'));
    expect(t.svc.cancel({ job: (r as { job: { id: string } }).job.id })).toBe(1);
    expect(t.svc.jobs()[0]).toMatchObject({ status: 'done', answer: 'already' });
    expect(t.typed).toEqual([]);
  });

  it('an idle worker terminal closes after a while (not while a job runs or you drive)', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'job' });
    t.advance(IDLE_CLOSE_MS + 1);
    t.svc.tick();
    expect(t.open.has('agy:acc2')).toBe(true);
    t.agyWrites(answer('ok'));
    t.svc.tick();
    t.advance(IDLE_CLOSE_MS - 1000);
    t.svc.tick();
    expect(t.open.has('agy:acc2')).toBe(true);
    t.advance(2000);
    t.svc.tick();
    expect(t.open.has('agy:acc2')).toBe(false);
  });

  it('two seats on one agy account: the second waits for the first conversation, then each reads its own', async () => {
    const t = setup();
    expect(await t.svc.ask({ worker: 'W1', prompt: 'one' })).toMatchObject({ ok: true, job: { status: 'working' } });
    expect(await t.svc.ask({ worker: 'W2', prompt: 'two' })).toMatchObject({ ok: true, job: { status: 'queued' } });
    expect(t.open.has('agy:acc2@W2')).toBe(false);
    t.agyWrites([{ type: 'USER_INPUT', status: 'DONE', content: 'one' }], CONV);
    t.svc.tick();
    await settle();
    expect(t.svc.jobs().find((j) => j.worker === 'W2')?.status).toBe('working');
    expect(t.open.get('agy:acc2@W2')?.args).toEqual(['acc2', '-i', 'two']);
    t.agyWrites(answer('two done'), CONV2);
    t.svc.tick();
    expect(t.svc.jobs().find((j) => j.worker === 'W2')).toMatchObject({ status: 'done', answer: 'two done' });
    expect(t.svc.jobs().find((j) => j.worker === 'W1')?.status).toBe('working');
    t.agyWrites(answer('one done'), CONV);
    t.svc.tick();
    expect(t.svc.jobs().find((j) => j.worker === 'W1')).toMatchObject({ status: 'done', answer: 'one done' });
  });
  it('a seat on a job answers BUSY; the other seat of the account and a Claude seat do not', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'a' });
    expect(await t.svc.ask({ worker: 'W1', prompt: 'b' })).toMatchObject({ ok: false, status: 409, busy: 'job' });
    expect((await t.svc.ask({ worker: 'W2', prompt: 'c' })).ok).toBe(true);
    expect(await t.svc.ask({ worker: 'C1', prompt: 'd', cwd: t.root })).toMatchObject({ ok: true, job: { status: 'working' } });
  });
  it('no conversation within START_SETTLE_MS: the queued seat starts anyway', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'a' });
    await t.svc.ask({ worker: 'W2', prompt: 'b' });
    t.advance(START_SETTLE_MS - 1);
    t.svc.tick();
    await settle();
    expect(t.open.has('agy:acc2@W2')).toBe(false);
    t.advance(2);
    t.svc.tick();
    await settle();
    expect(t.open.has('agy:acc2@W2')).toBe(true);
  });
  it('a queued job cancelled before its start never opens a terminal', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'a' });
    const r = await t.svc.ask({ worker: 'W2', prompt: 'b' });
    expect(t.svc.cancel({ job: (r as { job: { id: string } }).job.id })).toBe(1);
    t.advance(START_SETTLE_MS);
    t.svc.tick();
    await settle();
    expect(t.open.has('agy:acc2@W2')).toBe(false);
    expect(t.typed).toEqual([]);
  });
  it('every job runs in the office folder with BANG_SLOT and BANG_OFFICE; no folder and no cwd = 400', async () => {
    const t = setup();
    await t.svc.ask({ worker: 'W1', prompt: 'a' });
    expect(t.open.get('agy:acc2')).toMatchObject({ cwd: t.root, env: { BANG_SLOT: 'W1', BANG_OFFICE: t.root } });
    await t.svc.ask({ worker: 'C1', prompt: 'b' });
    expect(t.open.get('claude-worker:C1')).toMatchObject({ cwd: t.root, env: { BANG_SLOT: 'C1', BANG_OFFICE: t.root, CLAUDE_CONFIG_DIR: t.configDir } });
    expect(t.office.get('claude-worker:C1')?.name).toBe('C1');
    t.setFolder('');
    expect(await t.svc.ask({ worker: 'W2', prompt: 'c' })).toMatchObject({ ok: false, status: 400 });
  });
});
