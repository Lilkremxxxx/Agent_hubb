import { describe, expect, it } from 'vitest';
import { FrameBudget, startDprCap } from './quality';

describe('render scale', () => {
  it('starts touch devices at 2 and desktops at 3', () => {
    expect(startDprCap(true)).toBe(2);
    expect(startDprCap(false)).toBe(3);
  });

  it('lowers the cap one step when frames stay slow, never below 1', () => {
    const b = new FrameBudget(2);
    for (let i = 0; i < 60; i++) b.add(40);
    expect(b.cap).toBe(1);
    for (let i = 0; i < 120; i++) b.add(40);
    expect(b.cap).toBe(1);
  });

  it('keeps the cap when frames are fast enough', () => {
    const b = new FrameBudget(3);
    for (let i = 0; i < 300; i++) b.add(16);
    expect(b.cap).toBe(3);
  });

  it('ignores huge gaps (tab hidden, debugger) instead of counting them', () => {
    const b = new FrameBudget(2);
    for (let i = 0; i < 60; i++) b.add(i % 2 ? 16 : 900);
    expect(b.cap).toBe(2);
  });
});
