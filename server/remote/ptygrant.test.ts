import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRANT_TTL_MS, MAX_GRANTS, PtyAccess, sessionKey } from './ptygrant';

const fakeRes = () => {
  const r = new EventEmitter() as EventEmitter & { ended: boolean; end(): void };
  r.ended = false;
  r.end = () => { r.ended = true; r.emit('close'); };
  return r as unknown as ServerResponse & { ended: boolean };
};

afterEach(() => vi.useRealTimers());

describe('PtyAccess grants', () => {
  it('issue then consume is true once; the second consume is false', () => {
    const a = new PtyAccess();
    const g = a.issue('k1', 'pty:p1')!;
    expect(a.consume(g, 'k1', 'pty:p1')).toBe(true);
    expect(a.consume(g, 'k1', 'pty:p1')).toBe(false);
  });
  it("another session's consume is false and burns the grant", () => {
    const a = new PtyAccess();
    const g = a.issue('k1', 'pty:p1')!;
    expect(a.consume(g, 'k2', 'pty:p1')).toBe(false);
    expect(a.consume(g, 'k1', 'pty:p1')).toBe(false);
  });
  it('a grant for A cannot open B, nor cross pty/agent targets', () => {
    const a = new PtyAccess();
    expect(a.consume(a.issue('k1', 'pty:a')!, 'k1', 'pty:b')).toBe(false);
    expect(a.consume(a.issue('k1', 'pty:a')!, 'k1', 'agent:a')).toBe(false);
  });
  it('expires after 60 001 ms', () => {
    let t = 1000;
    const a = new PtyAccess(() => t);
    const g = a.issue('k1', 'pty:p1')!;
    t += GRANT_TTL_MS + 1;
    expect(a.consume(g, 'k1', 'pty:p1')).toBe(false);
    const h = a.issue('k1', 'pty:p1')!;
    t += GRANT_TTL_MS - 1;
    expect(a.consume(h, 'k1', 'pty:p1')).toBe(true);
  });
  it('the 21st outstanding issue returns undefined; garbage never consumes', () => {
    const a = new PtyAccess();
    for (let i = 0; i < MAX_GRANTS; i++) expect(a.issue('k1', 'pty:p1')).toBeTruthy();
    expect(a.issue('k1', 'pty:p1')).toBeUndefined();
    expect(a.consume('nope', 'k1', 'pty:p1')).toBe(false);
  });
  it('open makes the stream live; closing it removes it', () => {
    const a = new PtyAccess();
    const res = fakeRes();
    a.open('p1', 'k1', Date.now() + 60_000, res);
    expect(a.live('p1', 'k1')).toBe(true);
    expect(a.live('p1', 'k2')).toBe(false);
    expect(a.live('p2', 'k1')).toBe(false);
    res.emit('close');
    expect(a.live('p1', 'k1')).toBe(false);
  });
  it('endSession ends only that session', () => {
    const a = new PtyAccess();
    const r1 = fakeRes(), r2 = fakeRes();
    a.open('p1', 'k1', Date.now() + 60_000, r1);
    a.open('p1', 'k2', Date.now() + 60_000, r2);
    a.endSession('k1');
    expect([r1.ended, r2.ended]).toEqual([true, false]);
    expect(a.live('p1', 'k2')).toBe(true);
  });
  it('a timer ends the stream at sessionExp', () => {
    vi.useFakeTimers();
    const a = new PtyAccess();
    const res = fakeRes();
    a.open('p1', 'k1', Date.now() + 5000, res);
    vi.advanceTimersByTime(4999);
    expect(res.ended).toBe(false);
    vi.advanceTimersByTime(2);
    expect(res.ended).toBe(true);
    expect(a.live('p1', 'k1')).toBe(false);
  });
  it('sessionKey is a sha256 hex of the signature', () => {
    expect(sessionKey('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
