// Render scale (canvas pixels per CSS pixel). Phones report devicePixelRatio 3, which makes the canvas 9x larger than
// at 1 and drops the office to ~10 fps on a phone; pixel art stays crisp at a lower scale (canvas uses `pixelated`).

/** Highest render scale to start with: 2 on touch screens, 3 elsewhere. */
export const startDprCap = (coarsePointer: boolean): number => (coarsePointer ? 2 : 3);

const WINDOW = 60; // frames per decision
const SLOW_MS = 28; // average frame time above this (< ~35 fps) is "slow"
const GAP_MS = 250; // longer gaps are pauses (hidden tab, debugger), not slow frames

/** Lowers the render-scale cap one step each time a window of frames averages slower than SLOW_MS. */
export class FrameBudget {
  private sum = 0;
  private n = 0;
  constructor(public cap: number) {}

  add(ms: number): void {
    if (ms > GAP_MS || this.cap <= 1) return;
    this.sum += ms;
    if (++this.n < WINDOW) return;
    if (this.sum / this.n > SLOW_MS) this.cap = Math.max(1, this.cap - 1);
    this.sum = 0;
    this.n = 0;
  }
}
