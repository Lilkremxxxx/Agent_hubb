import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import { cardState, showsUsageAge, usageMessage, usageSubtitle } from './usage';

const MIN = 60_000;
type Acc = Pick<AccountInfo, 'usage' | 'usageStatus' | 'provider' | 'email' | 'configDir'>;
const agy = (over: Partial<Acc> = {}): Acc => ({ provider: 'agy', usageStatus: 'ok', configDir: '~/.agy', ...over });
const win = { utilization: 42, resetsAt: 10 * 60 * MIN };

describe('usage card', () => {
  it('card state: ok, stale or empty', () => {
    expect(cardState(agy({ usage: { source: 'agy', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(agy({ usage: { source: 'agy', fiveHour: win, fetchedAt: 0 }, usageStatus: 'stale' }))).toBe('stale');
    expect(cardState(agy())).toBe('empty');
  });

  it('age is shown only when the numbers are stale', () => {
    const fresh = { source: 'cache' as const, fiveHour: win, fetchedAt: 0 };
    expect(showsUsageAge({ usage: fresh, usageStatus: 'ok' })).toBe(false);
    expect(showsUsageAge({ usage: fresh, usageStatus: 'stale' })).toBe(true);
    expect(showsUsageAge({ usageStatus: 'stale' })).toBe(false);
  });

  it('no numbers: message by tool; under the name, the email or the directory', () => {
    expect(usageMessage(agy())).toEqual(['no data yet', 'no data']);
    expect(usageMessage({})).toEqual(['no usage data', 'no data']);
    expect(usageSubtitle({ email: 'a@b.c', configDir: '~/.claude' })).toBe('a@b.c');
    expect(usageSubtitle({ configDir: '~/.claude' })).toBe('~/.claude');
  });
});
