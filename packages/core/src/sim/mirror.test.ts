import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { type ActionId, mirrorFrame } from '../input/frame';
import { script } from '../replay/script';
import { boxRoom, mirrorRows, setTile, simRuntime } from '../test-support';
import { createWorld, step } from './sim';

const T = 16;
const W = 16;
const H = 10;

/** Random symmetric-agnostic rooms: a box with random full and oneway tiles inside. */
const roomArb = fc
  .array(
    fc.record({
      col: fc.integer({ min: 1, max: W - 2 }),
      row: fc.integer({ min: 1, max: H - 4 }),
      tile: fc.constantFrom('#', '='),
    }),
    { maxLength: 25 },
  )
  .map((tiles) => {
    const rows = boxRoom(W, H);
    for (const { col, row, tile } of tiles) setTile(rows, col, row, tile);
    return rows;
  });

const ACTIONS: readonly ActionId[] = ['left', 'right', 'jump', 'down'];
const inputArb = fc.array(
  fc.record({
    actions: fc.subarray(ACTIONS as ActionId[], { minLength: 1 }),
    at: fc.integer({ min: 0, max: 150 }),
    ticks: fc.integer({ min: 1, max: 40 }),
  }),
  { maxLength: 12 },
);

describe('Property: mirrored input gives a mirrored trajectory', () => {
  for (const profile of ['retro', 'modern']) {
    it(profile, () => {
      fc.assert(
        fc.property(
          roomArb,
          inputArb,
          fc.integer({ min: 1, max: W - 2 }),
          (rows, inputs, spawnCol) => {
            const spawnRow = H - 2;
            setTile(rows, spawnCol, spawnRow, '.');
            const runtime = simRuntime({ rows, spawn: [spawnCol, spawnRow] });
            const mirrored = simRuntime({
              rows: mirrorRows(rows),
              spawn: [W - 1 - spawnCol, spawnRow],
            });
            const builder = script();
            for (const { actions, at, ticks } of inputs) builder.press(actions, { at, ticks });
            const frames = builder.build(200);

            const start = { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: profile };
            const a = createWorld(runtime, start);
            const b = createWorld(mirrored, start);
            const width = fromPx(W * T);
            for (const frame of frames) {
              step(a, frame, runtime);
              step(b, mirrorFrame(frame), mirrored);
              expect(b.entities.x[0]).toBe(width - (a.entities.x[0] as number));
              expect(b.entities.y[0]).toBe(a.entities.y[0]);
              expect(b.entities.vx[0]).toBe(-(a.entities.vx[0] as number) || 0);
              expect(b.entities.vy[0]).toBe(a.entities.vy[0]);
              expect(b.entities.contact[0]).toBe(a.entities.contact[0]);
            }
          },
        ),
        { numRuns: 150 },
      );
    });
  }
});
