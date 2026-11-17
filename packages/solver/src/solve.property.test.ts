import { FX_ONE, type StartState } from '@retro-action-engine/core';
import { WALKER } from '@retro-action-engine/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { solveRoom } from './solve';
import { emptyRows, fill, type RoomFixture, roomRuntime, START } from './test-support';
import type { ScopeReport } from './types';

// Property tests over the feel values (ADR-0015): change the profile, and what the solver
// reaches changes exactly as the values say.

const retro: StartState = { ...START, feelProfile: 'retro' };

/**
 * Rise of a full jump under constant gravity, in Fx, from the pack values alone: gravity
 * applies on the take-off tick, and the body moves by its velocity every tick while it rises.
 * Integer arithmetic, so the sum is exact.
 */
function riseInFx(jumpVelocity: number, gravity: number): number {
  let rise = 0;
  for (let v = jumpVelocity - gravity; v > 0; v -= gravity) {
    rise += v;
  }
  return rise;
}

const walkerScope = (fixture: RoomFixture, start = retro): ScopeReport =>
  solveRoom(roomRuntime(fixture), start).scopes[0] as ScopeReport;

describe('property: the highest shelf follows the jump values', () => {
  // In 1/256 px, so that the pack values convert to Fx exactly. A variable jump (cut on
  // release) is mixed in: then only the longest hold reaches the rise.
  const variableArb = fc.oneof(
    fc.constant({}),
    fc.record({
      jumpCutScale: fc.integer({ min: 0, max: 230 }).map((v) => v / FX_ONE),
      minJumpTicks: fc.integer({ min: 0, max: 4 }),
    }),
  );
  const anyRise = fc.record({
    jumpVelocity: fc.integer({ min: 512, max: 1280 }),
    gravity: fc.integer({ min: 32, max: 128 }),
  });
  // Rises of a whole number of px: with jumpVelocity = (n + 1) * gravity the rise is
  // gravity * n (n + 1) / 2. The feet then reach the shelf top exactly.
  const wholeRise = fc
    .constantFrom([128, 3], [128, 4], [128, 7], [128, 8], [64, 7], [64, 8], [64, 15], [64, 16])
    .map(([gravity, n]) => ({ jumpVelocity: (n + 1) * gravity, gravity }));
  const jumpArb = fc.record({ jump: fc.oneof(anyRise, wholeRise), variable: variableArb });

  it('a shelf at the rise is reached, one px higher is proven too high', () => {
    fc.assert(
      fc.property(jumpArb, ({ jump, variable }) => {
        const { jumpVelocity, gravity } = jump;
        const rise = riseInFx(jumpVelocity, gravity);
        const highest = Math.floor(rise / FX_ONE);
        // The retro profile has no apex gravity: the closed form holds for the full hold, and
        // a cut only lowers the jump.
        const feel = {
          jumpVelocity: jumpVelocity / FX_ONE,
          gravity: gravity / FX_ONE,
          ...variable,
        };
        const shelf = (heightPx: number) => {
          const rows = emptyRows(24, heightPx + WALKER.collider.h / FX_ONE + 9);
          const floorRow = rows.length - 1;
          fill(rows, '#', 0, 23, floorRow);
          fill(rows, '=', 0, 23, floorRow - heightPx);
          const scope = walkerScope({ rows, tileSize: 1, spawn: [12, floorRow - 1], feel });
          const found = scope.footholds.find((f) => f.row === floorRow - heightPx);
          return { scope, found };
        };

        const atRise = shelf(highest);
        expect(atRise.found?.status).toBe('reached');
        expect(atRise.scope.riseBound).toBe(rise);

        const above = shelf(highest + 1);
        expect(above.found?.status).toBe('unreached');
        expect(above.found?.blocker).toEqual({
          certainty: 'proven',
          reason: 'tooHigh',
          riseNeeded: (highest + 1) * FX_ONE,
          riseBound: rise,
        });
        expect(above.scope.complete).toBe(true);
      }),
      { numRuns: 24, seed: 20261118 },
    );
  });
});

describe('property: more coyote time never reaches less', () => {
  // The coyote fixture of solve.test.ts with the retro profile (no air control, so it is
  // cheap): a ceiling over the end of a corridor makes the last jump from the ground bump.
  const rows = emptyRows(32, 36);
  fill(rows, '#', 0, 12, 0, 15);
  fill(rows, '#', 0, 11, 20, 35);
  fill(rows, '#', 20, 27, 15);
  fill(rows, '#', 0, 31, 35);
  const reachedWith = (coyoteTicks: number) =>
    new Set(
      walkerScope({ rows, tileSize: 4, spawn: [4, 19], feel: { coyoteTicks } })
        .footholds.filter((f) => f.status === 'reached')
        .map((f) => f.id),
    );

  it('the reached footholds only grow with coyoteTicks', () => {
    const cache = new Map<number, Set<string>>();
    const reached = (ticks: number) => {
      let set = cache.get(ticks);
      if (set === undefined) {
        set = reachedWith(ticks);
        cache.set(ticks, set);
      }
      return set;
    };
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        for (const id of reached(low)) {
          if (!reached(high).has(id)) return false;
        }
        return true;
      }),
      { numRuns: 30, seed: 20261118 },
    );
    // Not trivial: the target needs some coyote time.
    expect(reached(0).has('walker:r15c20-27')).toBe(false);
    expect([...cache.keys()].some((ticks) => reached(ticks).has('walker:r15c20-27'))).toBe(true);
  });
});
