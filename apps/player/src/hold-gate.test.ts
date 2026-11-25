import { actionMask, EMPTY_FRAME, type InputFrame } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { HoldGate } from './hold-gate';

const R = actionMask('right');
const J = actionMask('jump');

/** Frames from the buffer, and what the devices hold at each of them. */
function gate(steps: Array<[InputFrame, number]>) {
  let i = 0;
  let physical = 0;
  return new HoldGate(
    {
      nextFrame: () => {
        const [frame, held] = steps[i++] ?? [EMPTY_FRAME, 0];
        physical = held;
        return frame;
      },
    },
    () => physical,
  );
}

describe('HoldGate (ADR-0020)', () => {
  it('passes everything through when nothing is blocked', () => {
    const g = gate([[{ held: R, pressed: R, released: 0, command: 0x101 }, R]]);
    expect(g.nextFrame()).toEqual({ held: R, pressed: R, released: 0, command: 0x101 });
  });

  it('releases what the game held, hides the button until it is let go, then takes its next press', () => {
    const g = gate([
      // Before the menu: right held.
      [{ held: R, pressed: R, released: 0 }, R],
      // The menu closes: the resync releases everything, right (still down) comes back pressed.
      [{ held: 0, pressed: 0, released: R }, R],
      [{ held: R | J, pressed: R | J, released: 0 }, R | J],
      [{ held: R, pressed: 0, released: J }, R],
      // Right let go.
      [{ held: 0, pressed: 0, released: R }, 0],
      // Pressed again.
      [{ held: R, pressed: R, released: 0 }, R],
    ]);
    expect(g.nextFrame()).toEqual({ held: R, pressed: R, released: 0 });
    g.block(R);
    // The game lets go of right, as after any menu.
    expect(g.nextFrame()).toEqual({ held: 0, pressed: 0, released: R });
    // Jump was pressed after the menu: it goes through; right does not.
    expect(g.nextFrame()).toEqual({ held: J, pressed: J, released: 0 });
    expect(g.nextFrame()).toEqual({ held: 0, pressed: 0, released: J });
    // Right let go: the game never saw it go down again, so no release either.
    expect(g.nextFrame()).toEqual({ held: 0, pressed: 0, released: 0 });
    expect(g.blockedMask).toBe(0);
    expect(g.nextFrame()).toEqual({ held: R, pressed: R, released: 0 });
  });
});
