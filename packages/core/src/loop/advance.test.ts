import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { advance, DEFAULT_LOOP_CONFIG, newLoopState, UNITS_PER_TICK } from './advance';

const { tickRate, maxFrameMs, maxTicksPerFrame } = DEFAULT_LOOP_CONFIG;
const tickMs = 1000 / tickRate;

describe('loop.advance', () => {
  it('turns 50 ms into exactly 3 ticks with no remainder', () => {
    const state = newLoopState();
    expect(advance(state, 50)).toEqual({ ticks: 3, alpha: 0, dropped: false });
    expect(state.accUnits).toBe(0);
  });

  it('runs one tick per frame at 60 Hz over a long run', () => {
    const state = newLoopState();
    let ticks = 0;
    for (let i = 0; i < 6000; i++) {
      const r = advance(state, tickMs);
      expect(r.ticks).toBeLessThanOrEqual(2);
      expect(r.dropped).toBe(false);
      ticks += r.ticks;
    }
    expect(Math.abs(ticks - 6000)).toBeLessThanOrEqual(1);
  });

  it('accumulates short frames: two 120 Hz frames make one tick', () => {
    const state = newLoopState();
    const a = advance(state, 25 / 3);
    const b = advance(state, 25 / 3);
    expect(a.ticks + b.ticks).toBe(1);
    expect(a.ticks).toBe(0);
    expect(a.alpha).toBeCloseTo(0.5, 9);
  });

  it('clamps a long frame to maxFrameMs and reports dropped', () => {
    const state = newLoopState();
    const r = advance(state, 1000);
    expect(r.dropped).toBe(true);
    expect(r.ticks).toBe(maxTicksPerFrame);
    expect(r.alpha).toBe(0);
  });

  it('reports dropped for a clamped frame even when the tick cap is not reached', () => {
    const config = { tickRate: 60, maxFrameMs: 40, maxTicksPerFrame: 5 };
    const state = newLoopState();
    const r = advance(state, 100, config);
    expect(r.dropped).toBe(true);
    expect(r.ticks).toBe(2); // 40 ms = 2.4 ticks
    expect(r.alpha).toBeCloseTo(0.4, 9);
  });

  it('caps the ticks of one frame at maxTicksPerFrame and discards the rest', () => {
    const state = newLoopState();
    const ms = (maxTicksPerFrame + 2) * tickMs; // below maxFrameMs, above the tick cap
    expect(ms).toBeLessThan(maxFrameMs);
    const r = advance(state, ms);
    expect(r.ticks).toBe(maxTicksPerFrame);
    expect(r.dropped).toBe(true);
    expect(state.accUnits).toBe(0);
  });

  it('does not report dropped at exactly the tick cap', () => {
    const state = newLoopState();
    const r = advance(state, (maxTicksPerFrame * UNITS_PER_TICK) / tickRate);
    expect(r).toEqual({ ticks: maxTicksPerFrame, alpha: 0, dropped: false });
  });

  it('ignores zero, negative and non-finite frame times', () => {
    const state = newLoopState();
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(advance(state, ms).ticks).toBe(0);
    }
  });

  it('Property: keeps 0 <= alpha < 1 and never loses time unless it reports dropped', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 300, noNaN: true }), { maxLength: 50 }),
        (frames) => {
          const state = newLoopState();
          let units = 0;
          let ticks = 0;
          for (const ms of frames) {
            const r = advance(state, ms);
            expect(r.alpha).toBeGreaterThanOrEqual(0);
            expect(r.alpha).toBeLessThan(1);
            expect(r.ticks).toBeLessThanOrEqual(maxTicksPerFrame);
            ticks += r.ticks;
            units += Math.min(ms, maxFrameMs) * tickRate;
            if (!r.dropped) {
              expect(ticks * UNITS_PER_TICK + state.accUnits).toBeCloseTo(units, 6);
            } else {
              units = ticks * UNITS_PER_TICK + state.accUnits;
            }
          }
        },
      ),
    );
  });
});
