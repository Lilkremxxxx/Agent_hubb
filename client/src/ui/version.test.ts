import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import { versionInfo } from './version';

function snap(version: string): OfficeSnapshot {
  return { rev: 1, serverTime: 0, rooms: [], agents: [], accounts: [], meta: { sources: [], startedAt: 0, version } };
}

describe('versionInfo', () => {
  it('real versions only: no snapshot has none', () => {
    expect(versionInfo(snap('0.2.0'))).toEqual({ version: '0.2.0' });
    expect(versionInfo(null)).toBeNull();
  });
});
