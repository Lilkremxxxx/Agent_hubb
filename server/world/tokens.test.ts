// Building tokens (server/world/tokens.ts): sum of input + output of today and 7 rolling days, only from real source
// (demo never enters), rounded to 2 significant digits.
import { describe, expect, it } from 'vitest';
import { zeroCounts, type DayStatsResponse, type StatsSource } from '../../shared/daystats';
import type { AgentInfo, OfficeSnapshot } from '../../shared/types';
import { DayStatsService } from '../history/daystats';
import { setQuiet } from '../log';
import { BuildingTokens } from './tokens';

setQuiet(true);

const S = 1_000;
/** 2026-10-15 10:00 UTC. */
const T0 = Date.UTC(2026, 9, 15, 10);

function fakeStats(perDay: Record<string, [number, number]>, today = '2026-10-15') {
  const calls: Array<[string, StatsSource | undefined]> = [];
  return {
    calls,
    tz: 'UTC',
    today: () => today,
    day(day: string, _tz: string, source?: StatsSource): DayStatsResponse | null {
      calls.push([day, source]);
      const v = perDay[day];
      if (!v) return null;
      const counts = { ...zeroCounts(), tokensIn: v[0], tokensOut: v[1] };
      return { source: 'real', demoAvailable: false, today, serverTime: T0, stats: { totals: { counts } } } as unknown as DayStatsResponse;
    },
  };
}

describe('BuildingTokens', () => {
  it('today and 7 rolling days (today + 6), rounded; day without data counts as zero', () => {
    const stats = fakeStats({
      '2026-10-15': [1_000_000, 234_567],
      '2026-10-14': [5_000_000, 1_000],
      '2026-10-09': [1_000, 1_000],
      '2026-10-08': [9_999_999_999, 0], // outside the week
    });
    const t = new BuildingTokens({ stats, now: () => T0 });
    expect(t.read()).toEqual({ day: 1_200_000, week: 6_200_000 });
    expect(stats.calls.every(([, src]) => src === 'real')).toBe(true);
    expect(stats.calls.map(([d]) => d).sort()).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  });

  it('past days are cached; today is re-read after expiration', () => {
    const per: Record<string, [number, number]> = { '2026-10-15': [100, 0], '2026-10-14': [50, 0] };
    const stats = fakeStats(per);
    let now = T0;
    const t = new BuildingTokens({ stats, now: () => now, ttlMs: 10_000 });
    expect(t.read()).toEqual({ day: 100, week: 150 });
    per['2026-10-15'] = [300, 0];
    per['2026-10-14'] = [999, 0];
    expect(t.read()).toEqual({ day: 100, week: 150 });
    now += 10_000;
    expect(t.read()).toEqual({ day: 300, week: 350 });
    expect(stats.calls.filter(([d]) => d === '2026-10-14')).toHaveLength(1);
  });
});
