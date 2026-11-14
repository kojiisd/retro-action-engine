import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionId, actionMask } from '../input/frame';
import { script } from './script';

const J = actionMask('jump');
const R = actionMask('right');

describe('script DSL', () => {
  it('holds, then releases on the next tick', () => {
    expect(script().hold('right', 2).build()).toEqual([
      { held: R, pressed: R, released: 0 },
      { held: R, pressed: 0, released: 0 },
      { held: 0, pressed: 0, released: R },
    ]);
  });

  it('places a tap at an absolute tick without moving the cursor', () => {
    const frames = script().hold('right', 4).tap('jump', { at: 1 }).build();
    expect(frames.map((f) => f.held)).toEqual([R, R | J, R, R, 0]);
    expect(frames[1]?.pressed).toBe(J);
    expect(frames[2]?.released).toBe(J);
  });

  it('chains holds and waits', () => {
    const frames = script().hold('right', 1).wait(2).hold(['right', 'jump'], 1).build();
    expect(frames.map((f) => f.held)).toEqual([R, 0, 0, R | J, 0]);
    expect(frames[3]?.pressed).toBe(R | J);
  });

  it('pads to a requested length with empty frames', () => {
    const frames = script().tap('jump').build(5);
    expect(frames).toHaveLength(5);
    expect(frames.slice(2).every((f) => f.held === 0 && f.pressed === 0 && f.released === 0)).toBe(
      true,
    );
  });

  it('rejects empty or negative intervals', () => {
    expect(() => script().hold('jump', 0)).toThrow(RangeError);
    expect(() => script().press('jump', { at: -1, ticks: 1 })).toThrow(RangeError);
  });

  it('always follows the edge rules', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom(...(ACTIONS as readonly ActionId[])),
            at: fc.integer({ min: 0, max: 50 }),
            ticks: fc.integer({ min: 1, max: 10 }),
          }),
        ),
        (presses) => {
          const builder = script();
          for (const { action, at, ticks } of presses) builder.press(action, { at, ticks });
          let previous = 0;
          for (const frame of builder.build()) {
            expect(frame.pressed & frame.released).toBe(0);
            expect(frame.pressed).toBe(frame.held & ~previous);
            expect(frame.released).toBe(previous & ~frame.held);
            previous = frame.held;
          }
          expect(previous).toBe(0);
        },
      ),
    );
  });
});
