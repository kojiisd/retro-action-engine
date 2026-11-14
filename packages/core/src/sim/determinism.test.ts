import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../hash/hash';
import type { ActionId } from '../input/frame';
import { script } from '../replay/script';
import { boxRoom, setTile, simRuntime } from '../test-support';
import { cloneWorld } from '../world/world';
import { createWorld, step } from './sim';

describe('Determinism: two runs from the same start give the same hash every tick', () => {
  const rows = boxRoom(16, 10);
  for (let c = 4; c < 9; c++) setTile(rows, c, 6, '=');
  setTile(rows, 11, 7, '~');
  const runtime = simRuntime({ rows, spawn: [2, 8], members: ['walker', 'swimmer'] });
  const actions: ActionId[] = ['left', 'right', 'jump', 'down', 'switch'];

  for (const profile of ['retro', 'modern']) {
    it(profile, () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              actions: fc.subarray(actions, { minLength: 1 }),
              at: fc.integer({ min: 0, max: 200 }),
              ticks: fc.integer({ min: 1, max: 30 }),
            }),
            { maxLength: 15 },
          ),
          (presses) => {
            const builder = script();
            for (const { actions: a, at, ticks } of presses) builder.press(a, { at, ticks });
            const frames = builder.build(240);
            const start = { roomId: 'room', spawnId: 'start', seed: 7, feelProfile: profile };
            const a = createWorld(runtime, start);
            const b = createWorld(runtime, start);
            expect(hashWorld(b)).toEqual(hashWorld(a));
            for (const frame of frames) {
              step(a, frame, runtime);
              step(b, frame, runtime);
              expect(hashWorld(b)).toEqual(hashWorld(a));
            }
            // A deep copy mid-run continues identically.
            const c = cloneWorld(a);
            for (const frame of frames.slice(0, 30)) {
              step(a, frame, runtime);
              step(c, frame, runtime);
            }
            expect(hashWorld(c)).toEqual(hashWorld(a));
          },
        ),
        { numRuns: 60 },
      );
    });
  }
});
