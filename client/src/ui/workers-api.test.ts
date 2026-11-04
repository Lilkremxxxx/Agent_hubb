import { describe, expect, it } from 'vitest';
import type { WorkerSession } from '../../../shared/types';
import { jobOpen, sessionOfAgent, workerOfAgent } from './workers-api';

const session = (worker: string, agentId: string, extra: Partial<WorkerSession> = {}): WorkerSession => ({
  worker,
  kind: 'agy',
  agentId,
  account: worker,
  ...extra,
});

describe('workers', () => {
  it("a seat's session is found by its one character", () => {
    const team = { sessions: [{ worker: 'W2', kind: 'agy' as const, agentId: 'agy:acc1@W2', account: 'agy:acc1' }] };
    expect(sessionOfAgent(team, 'agy:acc1@W2')?.worker).toBe('W2');
    expect(workerOfAgent({ ...team, workers: ['W2'] }, { id: 'agy:acc1', provider: 'agy' })).toBeUndefined();
  });

  it('the seat behind a character: its session only', () => {
    const team = { workers: ['W1', 'W2'], sessions: [session('W1', 'agy:acc1')] };
    expect(workerOfAgent(team, { id: 'agy:acc1', provider: 'agy' })).toBe('W1');
    expect(workerOfAgent(team, { id: '.claude:7', provider: 'claude' })).toBeUndefined();
    expect(workerOfAgent(undefined, { id: 'agy:acc3', provider: 'agy' })).toBeUndefined();
  });

  it('open jobs', () => {
    expect(['queued', 'working', 'done', 'failed', 'cancelled'].map(jobOpen)).toEqual([true, true, false, false, false]);
  });
});
