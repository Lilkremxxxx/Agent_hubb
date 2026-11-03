// Agent sources (SourceSet) and multi-tool history (HistorySet): what the server sees as a single
// source, per-agent chosen parser, isolated source failure, and Office boot counting.
import { describe, expect, it } from 'vitest';
import type { Provider, RecentSession, SourceInfo, TerminalEntry } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { HistorySet, SourceSet, type AgentSource, type HistoryProvider, type HistoryResolveResult } from './source';
import type { TerminalParser } from './terminal';

setQuiet(true);

const CLAUDE_LINE = JSON.stringify({
  type: 'user',
  uuid: '00000000-0000-4000-8000-000000000001',
  timestamp: new Date(1_000).toISOString(),
  sessionId: 's',
  message: { role: 'user', content: 'hi' },
});

/** Tagged parser: each line becomes a 'user' entry with id `${tag}-${n}`. */
function tagged(tag: string): TerminalParser {
  let n = 0;
  return { push: (): TerminalEntry[] => [{ kind: 'user', id: `${tag}-${++n}`, at: 0, text: tag }] };
}

function fakeSource(provider: Provider, opts: Partial<AgentSource> & { paths?: Record<string, string>; log?: string[] } = {}): AgentSource {
  const paths = opts.paths ?? {};
  const events = opts.log ?? [];
  return {
    provider,
    start: opts.start ?? (() => void events.push(`start:${provider}`)),
    stop: opts.stop ?? (() => void events.push(`stop:${provider}`)),
    sources: opts.sources ?? (() => [{ label: `.${provider}`, path: `/x/.${provider}`, sessions: 1, ok: true }]),
    transcriptPathOf: (id) => paths[id],
    ...(opts.terminalParser ? { terminalParser: opts.terminalParser } : {}),
  };
}

describe('SourceSet', () => {
  it('sources, transcript, and parser per agent (from owner source; fallback to Claude Code)', () => {
    const claude = fakeSource('claude', { paths: { 'c:1': '/t/c1.jsonl' } });
    const agy = fakeSource('agy', {
      paths: { '.agy:t1': '/t/rollout.jsonl', '.agy:t2': '/t/rollout2.jsonl' },
      terminalParser: (id) => (id === '.agy:t1' ? tagged('cx') : undefined),
      sources: (): SourceInfo[] => [{ label: '.agy', provider: 'agy', path: '/x/.agy', sessions: 2, ok: true }],
    });
    const set = new SourceSet([claude]);
    set.add(agy);
    expect(set.all().map((s) => s.provider)).toEqual(['claude', 'agy']);
    expect(set.of('agy')).toBe(agy);
    expect(set.sources().map((s) => [s.label, s.provider, s.sessions])).toEqual([
      ['.claude', undefined, 1],
      ['.agy', 'agy', 2],
    ]);
    expect(set.transcriptPathOf('c:1')).toBe('/t/c1.jsonl');
    expect(set.transcriptPathOf('.agy:t1')).toBe('/t/rollout.jsonl');
    expect(set.transcriptPathOf('ninguem')).toBeUndefined();

    // Antigravity agent: its own source parser, fresh on each call.
    const p1 = set.parserFor('.agy:t1');
    const p2 = set.parserFor('.agy:t1');
    expect(p1).not.toBe(p2);
    expect(p1.push('x').map((e) => e.id)).toEqual(['cx-1']);
    expect(p2.push('x').map((e) => e.id)).toEqual(['cx-1']);
    // Source without its own parser (or returning undefined), unknown agent: fallback to Claude Code.
    for (const id of ['c:1', '.agy:t2', 'ninguem']) {
      const entries = set.parserFor(id).push(CLAUDE_LINE);
      expect(entries).toMatchObject([{ kind: 'user', text: 'hi' }]);
    }
  });

  it('start in order (synchronous finish immediately); single source failure does not crash others', async () => {
    const log: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((ok) => (release = ok));
    const set = new SourceSet([
      fakeSource('claude', { log, start: () => void log.push('start:claude') }),
      fakeSource('agy', {
        log,
        start: () => {
          log.push('start:agy');
          return slow.then(() => void log.push('ready:agy'));
        },
      }),
      fakeSource('agy', {
        start: () => {
          throw new Error('failed');
        },
        stop: () => {
          throw new Error('failed again');
        },
      }),
      fakeSource('agy', { start: () => Promise.reject(new Error('async failed')) }),
    ]);
    const done = set.start();
    // Synchronous sources already ran; asynchronous continues.
    expect(log).toEqual(['start:claude', 'start:agy']);
    let finished = false;
    void done.then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await done;
    expect(log).toEqual(['start:claude', 'start:agy', 'ready:agy']);
    expect(() => set.stop()).not.toThrow();
    expect(log.slice(-2)).toEqual(['stop:claude', 'stop:agy']);
  });

  it('boot counted in Office: ready only when async source finishes', async () => {
    const office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: 0,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
    });
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const sync = fakeSource('claude', {
      start: () => {
        office.beginBoot();
        office.endBoot();
      },
    });
    const async = fakeSource('agy', {
      start: async () => {
        office.beginBoot();
        try {
          await gate;
        } finally {
          office.endBoot();
        }
      },
    });
    const done = new SourceSet([async, sync]).start();
    expect(office.isBooting()).toBe(true);
    release();
    await done;
    expect(office.isBooting()).toBe(false);
  });
});

// ------------------------------------------------------------------ history

const session = (provider: Provider | undefined, account: string, sessionId: string, lastAt: number): RecentSession => {
  const s: RecentSession = { account, sessionId, projectDir: 'p', lastAt, size: 1, open: false };
  if (provider) s.provider = provider;
  return s;
};

function fakeHistory(provider: Provider, accounts: string[], list: () => Promise<RecentSession[]>, resolved?: HistoryResolveResult): HistoryProvider {
  return {
    provider,
    hasAccount: (a) => accounts.includes(a),
    list,
    resolve: (account, sessionId) => resolved ?? { status: 404, error: `${provider}:${account}:${sessionId}` },
  };
}

describe('HistorySet', () => {
  it('combines lists across all tools: newest to oldest, up to limit', async () => {
    const claude = fakeHistory('claude', ['.claude'], async () => [session(undefined, '.claude', 'c2', 50), session(undefined, '.claude', 'c1', 10)]);
    const agy = fakeHistory('agy', ['.agy'], async () => [session('agy', '.agy', 'x1', 30), session('agy', '.agy', 'x0', 5)]);
    expect((await new HistorySet([claude, agy]).list()).map((s) => s.sessionId)).toEqual(['c2', 'x1', 'c1', 'x0']);
    expect((await new HistorySet([claude, agy], 3).list()).map((s) => s.sessionId)).toEqual(['c2', 'x1', 'c1']);
    // Single provider: its list, unchanged.
    expect(await new HistorySet([claude]).list()).toEqual(await claude.list());
    expect(await new HistorySet().list()).toEqual([]);
  });

  it('failing provider is skipped; if all fail, error bubbles up', async () => {
    const ok = fakeHistory('claude', ['.claude'], async () => [session(undefined, '.claude', 'c1', 10)]);
    const bad = fakeHistory('agy', ['.agy'], () => Promise.reject(new Error('unreadable')));
    expect((await new HistorySet([ok, bad]).list()).map((s) => s.sessionId)).toEqual(['c1']);
    await expect(new HistorySet([bad]).list()).rejects.toThrow('unreadable');
  });

  it('resolve: by account provider; unknown account goes to first (Claude Code)', () => {
    const parser = () => tagged('cx');
    const claude = fakeHistory('claude', ['.claude'], async () => []);
    const agy = fakeHistory('agy', ['.agy'], async () => [], { path: '/r/rollout.jsonl', createParser: parser });
    const set = new HistorySet([claude, agy]);
    expect(set.resolve('.agy', 'abc')).toEqual({ path: '/r/rollout.jsonl', createParser: parser });
    expect(set.resolve('.claude', 'abc')).toEqual({ status: 404, error: 'claude:.claude:abc' });
    expect(set.resolve('.outra', 'abc')).toEqual({ status: 404, error: 'claude:.outra:abc' });
    expect(new HistorySet().resolve('.claude', 'abc')).toEqual({ status: 404, error: 'unknown account' });
  });
});
