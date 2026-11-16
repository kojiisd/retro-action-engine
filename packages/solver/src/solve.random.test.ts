import { actionMask, createWorld, FX_ONE, roomGrid, step } from '@retro-action-engine/core';
import { SWIMMER, WALKER } from '@retro-action-engine/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FootholdIndex, standingOn } from './footholds';
import { solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';

// Random rooms, checked against plain play: random button mashing with the real `step`, with
// no macros and no search. Whatever the solver calls proven must hold for it too.
const WIDTH = 16;
const HEIGHT = 12;
const segmentArb = fc.record({
  tile: fc.constantFrom('#', '#', '=', '~'),
  col: fc.integer({ min: 0, max: WIDTH - 1 }),
  row: fc.integer({ min: 2, max: HEIGHT - 2 }),
  length: fc.integer({ min: 1, max: 6 }),
  vertical: fc.boolean(),
});
const roomArb = fc.record({
  segments: fc.array(segmentArb, { minLength: 2, maxLength: 7 }),
  spawnCol: fc.integer({ min: 1, max: WIDTH - 2 }),
  // In 1/256 px, so that the conversion to Fx is exact.
  jumpVelocity: fc.integer({ min: 512, max: 1408 }).map((v) => v / FX_ONE),
  inputs: fc.array(
    fc.record({ held: fc.integer({ min: 0, max: 15 }), ticks: fc.integer({ min: 1, max: 20 }) }),
    { minLength: 60, maxLength: 120 },
  ),
});
const ACTIONS = [actionMask('left'), actionMask('right'), actionMask('jump'), actionMask('down')];

describe('solveRoom: proofs against plain play in random rooms', () => {
  it('never contradicts itself, and random play never does what is proven impossible', () => {
    let proven = 0;
    fc.assert(
      fc.property(roomArb, ({ segments, spawnCol, jumpVelocity, inputs }) => {
        const rows = emptyRows(WIDTH, HEIGHT);
        fill(rows, '#', 0, WIDTH - 1, HEIGHT - 1);
        for (const segment of segments) {
          if (segment.vertical) {
            const rowTo = Math.min(HEIGHT - 2, segment.row + segment.length - 1);
            fill(rows, segment.tile, segment.col, segment.col, segment.row, rowTo);
          } else {
            const colTo = Math.min(WIDTH - 1, segment.col + segment.length - 1);
            fill(rows, segment.tile, segment.col, colTo, segment.row);
          }
        }
        // Keep the spawn clear: two tiles wide, two tiles high, on the floor.
        fill(rows, '.', spawnCol - 1, spawnCol, HEIGHT - 3, HEIGHT - 2);
        const runtime = roomRuntime({
          rows,
          tileSize: 8,
          spawn: [spawnCol, HEIGHT - 2],
          members: ['walker', 'swimmer'],
          feel: { jumpVelocity },
        });
        const start = { ...START, feelProfile: 'retro' };
        // A ProofError or WitnessError here fails the property.
        const report = solveRoom(runtime, start);
        const grid = roomGrid(runtime, 'room');

        for (const character of [WALKER, SWIMMER]) {
          const scope = report.scopes.find((s) => s.scope.characterId === character.id);
          if (scope === undefined) return false;
          const index = new FootholdIndex(grid, [character]);
          const reportOf = (i: number) => scope.footholds[i] as (typeof scope.footholds)[number];
          proven += scope.footholds.filter(
            (f) => f.blocker !== undefined || f.return?.status === 'provenNo',
          ).length;

          const world = createWorld(runtime, { ...start, party: [character.id] });
          let previous = 0;
          let noWayBack = false;
          for (const input of inputs) {
            let held = 0;
            ACTIONS.forEach((mask, bit) => {
              if ((input.held & (1 << bit)) !== 0) held |= mask;
            });
            for (let i = 0; i < input.ticks; i++) {
              step(world, { held, pressed: held & ~previous, released: previous & ~held }, runtime);
              previous = held;
              for (const foothold of standingOn(grid, index, world, character)) {
                const entry = reportOf(foothold);
                // Standing on a foothold that is proven to be out of reach.
                if (entry.blocker !== undefined) return false;
                // Back on the start foothold after standing where no way back is proven.
                if (noWayBack && scope.startFootholds.includes(entry.id)) return false;
              }
              for (const foothold of standingOn(grid, index, world, character)) {
                if (reportOf(foothold).return?.status === 'provenNo') noWayBack = true;
              }
            }
          }
        }
        return true;
      }),
      { numRuns: 25, seed: 20261116 },
    );
    // The rooms must actually contain proven claims, or the property says nothing.
    expect(proven).toBeGreaterThan(20);
  });
});
