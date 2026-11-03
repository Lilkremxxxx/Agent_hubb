import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import { cardState, showsUsageAge, sourceLabel, usageMessage, usageSubtitle } from './usage';

const MIN = 60_000;
type Acc = Pick<AccountInfo, 'usage' | 'usageStatus' | 'provider' | 'email' | 'configDir'>;
const agy = (over: Partial<Acc> = {}): Acc => ({ provider: 'agy', usageStatus: 'ok', configDir: '~/.agy', ...over });
const win = { utilization: 42, resetsAt: 10 * 60 * MIN };

describe('sourceLabel', () => {
  it('indicates what recorded the live usage', () => {
    expect(sourceLabel({ source: 'statusline', via: 'mod', fetchedAt: 0 })).toBe('live (Habblaud mod)');
    expect(sourceLabel({ source: 'statusline', via: 'tap', fetchedAt: 0 })).toBe('live (Claude Code statusline)');
    expect(sourceLabel({ source: 'statusline', fetchedAt: 0 })).toBe('live (Claude Code statusline)');
    expect(sourceLabel({ source: 'cache', fetchedAt: 0 })).toBe('Claude Code /usage cache');
    expect(sourceLabel({ source: 'agy', fetchedAt: 0 })).toBe('Antigravity /usage');
  });
});

describe('usage card', () => {
  it('"no quota" is its own state (never 0% or "no data")', () => {
    const noQuota = agy({ usage: { source: 'agy', noQuota: true, fetchedAt: 0 } });
    expect(cardState(noQuota)).toBe('noquota');
    expect(usageMessage(noQuota)).toEqual(['no quota', 'no quota']);
    expect(cardState(agy({ usage: { source: 'agy', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(agy({ usage: { source: 'agy', fiveHour: win, fetchedAt: 0 }, usageStatus: 'stale' }))).toBe('stale');
    expect(cardState(agy())).toBe('empty');
  });

  it('age is shown only when the numbers are stale', () => {
    const fresh = { source: 'cache' as const, fiveHour: win, fetchedAt: 0 };
    expect(showsUsageAge({ usage: { ...fresh, source: 'statusline' }, usageStatus: 'ok' })).toBe(false);
    expect(showsUsageAge({ usage: fresh, usageStatus: 'stale' })).toBe(true);
    expect(showsUsageAge({ usageStatus: 'stale' })).toBe(false);
  });

  it('no numbers: message by tool; under the name, the email or the directory', () => {
    expect(usageMessage(agy())).toEqual(['no data yet', 'no data']);
    expect(usageMessage({ usageStatus: 'disabled' })).toEqual(['no usage data', 'no data']);
    expect(usageSubtitle({ email: 'a@b.c', configDir: '~/.claude' })).toBe('a@b.c');
    expect(usageSubtitle({ configDir: '~/.claude' })).toBe('~/.claude');
  });
});
