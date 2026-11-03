import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { accountIds, discoverClaudeDirs, detectAccounts, isClaudeDir, parseClaudeAliases, shortcutsByDir } from './detect';
import { AccountsService } from './service';
import { rollover, STALE_AFTER_MS, usageFromCache, usageFromWindows, UsageStore } from './usage';

setQuiet(true);

// Absolute root also on Windows (resolve adds drive letter there).
const H = resolve('/Users/fulano');

describe('shell aliases', () => {
  it('only alias lines invoking claude; CLAUDE_CONFIG_DIR expanded', () => {
    const rc = [
      'export OPENAI_API_KEY="sk-segredo"',
      "alias ll='ls -la'",
      "alias claude2='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude --permission-mode auto'",
      "alias c='claude --permission-mode auto'",
      "alias f='claude --permission-mode auto --agent frinus'",
      "alias d='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude --permission-mode auto'",
      'alias e="CLAUDE_CONFIG_DIR=~/.claude-trabalho/ claude"',
      "alias sq='claude-squad'",
      "  # alias x='claude'",
      "alias w='cd ~/.claude && ls'",
    ].join('\n');
    expect(parseClaudeAliases(rc, H)).toEqual([
      { name: 'claude2', configDir: join(H, '.claude-conta2') },
      { name: 'c' },
      { name: 'f' },
      { name: 'd', configDir: join(H, '.claude-conta2') },
      { name: 'e', configDir: join(H, '.claude-trabalho') },
    ]);
  });

  it('prefers shortest alias (tie-breaker: first) and uses uppercase', () => {
    const m = shortcutsByDir(
      [{ name: 'claude2', configDir: join(H, '.claude-conta2') }, { name: 'c' }, { name: 'f' }, { name: 'd', configDir: join(H, '.claude-conta2') }],
      H,
    );
    expect(m.get(join(H, '.claude'))).toBe('C');
    expect(m.get(join(H, '.claude-conta2'))).toBe('D');
  });

  it('disambiguated IDs when two dirs share the same basename', () => {
    expect(accountIds(['/a/.claude', '/b/.claude', '/c/.claude-x'])).toEqual(['.claude', '.claude~2', '.claude-x']);
  });
});

describe('account detection', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  beforeEach(() => {
    tmp = tempDir();
    home = tmp.dir;
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-conta2', 'sessions'), { recursive: true });
    mkdirSync(join(home, '.claude-vazio'), { recursive: true });
    writeFileSync(join(home, '.claude.json'), '{}');
    writeFileSync(
      join(home, '.zshrc'),
      "alias c='claude'\nalias d='CLAUDE_CONFIG_DIR=\"$HOME/.claude-conta2\" claude'\nexport TOKEN=nao-leia\n",
    );
  });
  afterEach(() => tmp.cleanup());

  it('discovers $HOME/.claude* with projects/ or sessions/, default first', () => {
    expect(discoverClaudeDirs({}, home)).toEqual([join(home, '.claude'), join(home, '.claude-conta2')]);
    const extra = join(home, 'outra');
    mkdirSync(extra);
    expect(discoverClaudeDirs({ CLAUDE_CONFIG_DIR: extra }, home)).toContain(extra);
    expect(discoverClaudeDirs({ HABBLAUD_CLAUDE_DIRS: ' /x/a , ~/b ' }, home)).toEqual([resolve('/x/a'), join(home, 'b')]);
  });

  it('reads only allowed fields from .claude.json, shortcuts and colors', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        oauthAccount: { emailAddress: 'a@empresa.com', organizationName: 'Company', displayName: 'A', billingType: 'x', accountUuid: 'nao' },
        mcpServers: { s: { env: { SECRET: 'nao-pode-vazar' } } },
      }),
    );
    writeFileSync(
      join(home, '.claude-conta2', '.claude.json'),
      JSON.stringify({
        oauthAccount: { emailAddress: 'b@pessoal.com' },
        cachedUsageUtilization: { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 10, resets_at: null } } },
      }),
    );
    const accs = detectAccounts([join(home, '.claude'), join(home, '.claude-conta2'), join(home, '.claude-vazio')], { home, env: {} });
    expect(accs).toEqual([
      { id: '.claude', configDir: join(home, '.claude'), short: 'C', name: 'a (Claude)', color: '#f08a3c', email: 'a@empresa.com', organization: 'Company' },
      {
        id: '.claude-conta2',
        configDir: join(home, '.claude-conta2'),
        short: 'D',
        name: 'b (Claude)',
        color: '#4aa8e8',
        email: 'b@pessoal.com',
        cachedUsage: { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 10, resets_at: null } } },
      },
      { id: '.claude-vazio', configDir: join(home, '.claude-vazio'), short: 'A', name: 'Account A', color: '#5cc97b' },
    ]);
    expect(JSON.stringify(accs)).not.toContain('nao-pode-vazar');
  });

  it('HABBLAUD_ACCOUNTS (Docker) overrides metadata matching by id or mountDir', () => {
    const env = {
      HABBLAUD_ACCOUNTS: JSON.stringify([
        { id: '.claude', configDir: '/Users/x/.claude', mountDir: join(home, '.claude'), short: 'C', email: 'host@x.com', plan: 'Max', color: '#000000' },
        { mountDir: join(home, '.claude-conta2'), configDir: '/Users/x/.claude-conta2', short: 'D', name: 'Personal', cachedUsage: { fetchedAtMs: 5 } },
      ]),
    };
    const accs = detectAccounts([join(home, '.claude'), join(home, '.claude-conta2')], { home: '/nenhum', env });
    expect(accs[0]).toMatchObject({ id: '.claude', configDir: '/Users/x/.claude', short: 'C', name: 'host (Claude)', email: 'host@x.com', plan: 'Max', color: '#000000' });
    expect(accs[1]).toMatchObject({ id: '.claude-conta2', configDir: '/Users/x/.claude-conta2', short: 'D', name: 'Personal', cachedUsage: { fetchedAtMs: 5 } });
  });
});

describe('usage (5h and weekly)', () => {
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const windows = {
    five_hour: { utilization: 42.5, resets_at: '2026-10-06T14:00:00.123+00:00' },
    seven_day: { utilization: 15, resets_at: '2026-10-09T23:00:00Z' },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 3, resets_at: null },
    extra_usage: { is_enabled: false },
  };

  it('normalizes windows to Claude Code format', () => {
    expect(usageFromWindows(windows, 'cache', NOW)).toEqual({
      source: 'cache',
      fetchedAt: NOW,
      fiveHour: { utilization: 42.5, resetsAt: Date.parse('2026-10-06T14:00:00.123Z') },
      sevenDay: { utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') },
      sevenDaySonnet: { utilization: 3 },
    });
    expect(usageFromWindows({}, 'cache', NOW)).toBeUndefined();
  });

  it('cache: fetchedAtMs becomes fetchedAt; old = stale; missing = disabled', () => {
    const store = new UsageStore();
    expect(store.view('x', NOW).status).toBe('disabled');
    store.set('x', usageFromCache({ fetchedAtMs: NOW - 5 * 60_000, utilization: windows })!);
    expect(store.view('x', NOW).status).toBe('ok');
    expect(store.view('x', NOW + STALE_AFTER_MS).status).toBe('stale');
  });

  it('windows whose reset time has passed have no data (never an invented 0%)', () => {
    const u = usageFromWindows(windows, 'cache', NOW)!;
    // Before weekly reset, but after 5h session reset.
    const r = rollover(u, Date.parse('2026-10-06T15:00:00Z'));
    expect(r.fiveHour).toBeUndefined();
    expect(r.sevenDay).toEqual({ utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') });
    // Without reset time: remains valid.
    expect(r.sevenDaySonnet).toEqual({ utilization: 3 });
    const later = rollover(u, Date.parse('2026-10-10T00:00:00Z'));
    expect(later.fiveHour).toBeUndefined();
    expect(later.sevenDay).toBeUndefined();
    expect(later).toMatchObject({ source: 'cache', fetchedAt: NOW });
    // Original is not modified.
    expect(u.fiveHour?.utilization).toBe(42.5);
  });

  it('source with newer numbers takes precedence; clearing one source restores the other', () => {
    const store = new UsageStore();
    store.set('x', usageFromWindows(windows, 'cache', NOW - 3_600_000)!);
    store.set('x', usageFromWindows({ ...windows, five_hour: { utilization: 77, resets_at: null } }, 'statusline', NOW - 60_000)!);
    expect(store.view('x', NOW)).toMatchObject({ status: 'ok', usage: { source: 'statusline', fiveHour: { utilization: 77 } } });
    expect(store.clear('x', 'statusline')).toBe(true);
    expect(store.view('x', NOW)).toMatchObject({ status: 'stale', usage: { source: 'cache' } });
  });

  it('AccountsService: accounts from another tool (external list), unique IDs, and pushed usage', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      let changes = 0;
      let now = NOW;
      const svc = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => changes++, now: () => now });
      const det = (id: string) => ({ id, configDir: `/Users/x/${id}`, short: 'X', name: 'Agy', color: '#10a37f' });
      changes = 0;
      const set = svc.setProviderAccounts('agy', [
        { dir: join(tmp.dir, '.agy'), detected: det('.agy') },
        { dir: join(tmp.dir, 'b', '.agy'), detected: det('.agy') },
        // Same ID as Claude Code account: disambiguated.
        { dir: join(tmp.dir, 'c', '.claude'), detected: det('.claude') },
      ]);
      expect(set.map((e) => [e.id, e.provider, e.detected.id, e.detected.provider])).toEqual([
        ['.agy', 'agy', '.agy', 'agy'],
        ['.agy~2', 'agy', '.agy~2', 'agy'],
        ['.claude~2', 'agy', '.claude~2', 'agy'],
      ]);
      expect(changes).toBe(1);
      // Same list again: same IDs, no change notification.
      expect(svc.setProviderAccounts('agy', set.map((e) => ({ dir: e.dir, detected: det(basename(e.dir)) }))).map((e) => e.id)).toEqual([
        '.agy',
        '.agy~2',
        '.claude~2',
      ]);
      expect(changes).toBe(1);
      // entries() = Claude Code only (watcher, history, and statusline); others see all.
      expect(svc.entries().map((e) => [e.id, e.provider])).toEqual([['.claude', 'claude']]);
      expect(svc.entriesOf('agy').map((e) => e.id)).toEqual(['.agy', '.agy~2', '.claude~2']);
      expect(svc.allEntries().map((e) => e.id)).toEqual(['.claude', '.agy', '.agy~2', '.claude~2']);
      expect(svc.find('.agy~2')?.dir).toBe(join(tmp.dir, 'b', '.agy'));
      expect(svc.idForDir(join(tmp.dir, '.agy'))).toBe('.agy');
      const infos = svc.list(new Map([['.agy', 2]]));
      expect(infos[0]).not.toHaveProperty('provider');
      expect(infos[1]).toMatchObject({ id: '.agy', provider: 'agy', sessions: 2, usageStatus: 'disabled', configDir: '/Users/x/.agy' });

      // Usage pushed by source (origin 'agy'), with noQuota account.
      changes = 0;
      expect(svc.setUsage('.agy', { source: 'agy', fetchedAt: NOW - 60_000, fiveHour: { utilization: 12.5, resetsAt: NOW + 3_600_000 } })).toBe(true);
      expect(changes).toBe(1);
      expect(svc.setUsage('.agy', { source: 'agy', fetchedAt: NOW - 60_000, fiveHour: { utilization: 12.5, resetsAt: NOW + 3_600_000 } })).toBe(false);
      expect(changes).toBe(1);
      svc.setUsage('.agy~2', { source: 'agy', fetchedAt: NOW, noQuota: true });
      expect(svc.list(new Map()).find((a) => a.id === '.agy')).toMatchObject({ usageStatus: 'ok', usage: { source: 'agy', fiveHour: { utilization: 12.5 } } });
      expect(svc.list(new Map()).find((a) => a.id === '.agy~2')?.usage).toEqual({ source: 'agy', fetchedAt: NOW, noQuota: true });
      // Ages like other origins (periodic refresh detects and notifies).
      now = NOW + STALE_AFTER_MS;
      changes = 0;
      svc.refresh();
      expect(changes).toBe(1);
      expect(svc.usageView('.agy').status).toBe('stale');
      expect(svc.clearUsage('.agy', 'agy')).toBe(true);
      expect(svc.usageView('.agy').status).toBe('disabled');

      // Removed account loses saved usage; empty list removes tool.
      svc.setProviderAccounts('agy', [{ dir: join(tmp.dir, '.agy'), detected: det('.agy') }]);
      expect(svc.usageView('.agy~2').status).toBe('disabled');
      svc.setProviderAccounts('agy', []);
      expect(svc.allEntries().map((e) => e.id)).toEqual(['.claude']);
      expect(svc.list(new Map()).map((a) => a.id)).toEqual(['.claude']);
    } finally {
      tmp.cleanup();
    }
  });

  it('AccountsService.addDir watches an account added at run time (once)', () => {
    const tmp = tempDir();
    try {
      const a = join(tmp.dir, '.claude');
      const b = join(tmp.dir, '.claude-nova');
      mkdirSync(join(a, 'projects'), { recursive: true });
      mkdirSync(join(b, 'projects'), { recursive: true });
      let changes = 0;
      const svc = new AccountsService({ dirs: [a], home: tmp.dir, env: {}, onChange: () => changes++, now: () => NOW });
      changes = 0;
      expect(svc.addDir(b)).toBe('.claude-nova');
      expect(svc.entries().map((e) => e.id)).toEqual(['.claude', '.claude-nova']);
      expect(changes).toBe(1);
      expect(svc.addDir(b)).toBe('.claude-nova');
      expect(svc.entries()).toHaveLength(2);
    } finally {
      tmp.cleanup();
    }
  });

  it('AccountsService reads /usage cache from account .claude.json', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude-conta2');
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      let changes = 0;
      const svc = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => changes++, now: () => NOW });
      expect(svc.list(new Map())[0].usageStatus).toBe('disabled');
      writeFileSync(join(dir, '.claude.json'), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW - 60_000, utilization: windows } }));
      svc.refresh();
      const info = svc.list(new Map([['.claude-conta2', 3]]))[0];
      expect(info).toMatchObject({ id: '.claude-conta2', sessions: 3, usageStatus: 'ok', usage: { source: 'cache', fiveHour: { utilization: 42.5 } } });
      expect(changes).toBeGreaterThan(0);
    } finally {
      tmp.cleanup();
    }
  });
});
