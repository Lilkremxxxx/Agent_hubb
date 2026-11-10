import { describe, expect, it } from 'vitest';
import { cleanRoster, DEFAULT_ROSTER, pipelinePrompt, type Roster } from './pipeline';

describe('pipelinePrompt', () => {
  it('default roster: the command, one line per role, the precedence line', () => {
    const lines = pipelinePrompt(DEFAULT_ROSTER).split('\n');
    expect(lines[0]).toBe('/bang-skill:pipeline');
    expect(lines[1]).toBe('planner: Agent(subagent_type:"bang-skill:planner", model:"opus", effort:"high")');
    expect(lines[2]).toContain('"bang-skill:coder", model:"sonnet"');
    expect(lines[3]).toContain('"bang-skill:tester", model:"sonnet"');
    expect(lines[4]).toContain('"bang-skill:reviewer", model:"opus"');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toMatch(/wins over the model/);
  });

  it('seats: worker-ask with --role and --effort, --model only for claude seats', () => {
    const r: Roster = {
      ...DEFAULT_ROSTER,
      coder: { type: 'seat', seat: 'W1', kind: 'agy', effort: 'medium' },
      tester: { type: 'seat', seat: 'C1', kind: 'claude', model: 'haiku', effort: 'low' },
    };
    const p = pipelinePrompt(r);
    expect(p).toContain('coder: worker-ask W1 "<job in the 6 parts of the giao-viec skill>" --role coder --effort medium\n');
    expect(p).toContain('tester: worker-ask C1 "<job in the 6 parts of the giao-viec skill>" --role tester --effort low --model haiku\n');
  });
});

describe('cleanRoster', () => {
  const seats = [
    { name: 'W1', kind: 'agy' as const },
    { name: 'C1', kind: 'claude' as const },
  ];
  it('garbage gives the default', () => {
    expect(cleanRoster(null, seats)).toEqual(DEFAULT_ROSTER);
    expect(cleanRoster('x', seats)).toEqual(DEFAULT_ROSTER);
    expect(cleanRoster({ coder: { type: 'sub', model: 'gpt', effort: 'nope' } }, seats)).toEqual(DEFAULT_ROSTER);
  });
  it('a seat that is gone falls back to the default subagent', () => {
    const raw = { coder: { type: 'seat', seat: 'W9', kind: 'agy', effort: 'low' } };
    expect(cleanRoster(raw, seats).coder).toEqual(DEFAULT_ROSTER.coder);
  });
  it('an agy seat drops its model and lowers max/xhigh to high', () => {
    const raw = { coder: { type: 'seat', seat: 'W1', kind: 'agy', model: 'opus', effort: 'max' } };
    expect(cleanRoster(raw, seats).coder).toEqual({ type: 'seat', seat: 'W1', kind: 'agy', effort: 'high' });
  });
  it('the kind comes from the current seats, not from the saved value', () => {
    const raw = { coder: { type: 'seat', seat: 'C1', kind: 'agy', model: 'opus', effort: 'max' } };
    expect(cleanRoster(raw, seats).coder).toEqual({ type: 'seat', seat: 'C1', kind: 'claude', model: 'opus', effort: 'max' });
  });
  it('keeps valid choices', () => {
    const raw = { planner: { type: 'sub', model: 'haiku', effort: 'xhigh' } };
    expect(cleanRoster(raw, seats).planner).toEqual({ type: 'sub', model: 'haiku', effort: 'xhigh' });
  });
  it('returns copies: editing the result never changes DEFAULT_ROSTER', () => {
    const r = cleanRoster(null, seats);
    (r.coder as { model: string }).model = 'haiku';
    expect(DEFAULT_ROSTER.coder).toEqual({ type: 'sub', model: 'sonnet', effort: 'high' });
  });
});
