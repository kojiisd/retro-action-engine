import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashWorld, type WorldHash } from '../hash/hash';
import { EdgeBuffer } from '../input/edge-buffer';
import { type ActionId, actionMask, type InputFrame } from '../input/frame';
import { LoopDriver } from '../loop/driver';
import type { StartState } from '../runtime/pack';
import { createWorld, step } from '../sim/sim';
import { boxRoom, setTile, simRuntime } from '../test-support';
import { Player, Recorder, type ReplayFile, runReplayHeadless, startOf } from './replay';
import { script } from './script';

const rows = boxRoom(16, 10);
for (let c = 4; c < 9; c++) setTile(rows, c, 6, '=');
setTile(rows, 11, 8, '~');
const runtime = simRuntime({ rows, spawn: [2, 8], members: ['walker', 'swimmer'] });

function recordScript(frames: readonly InputFrame[], start: StartState): ReplayFile {
  const recorder = new Recorder();
  for (const frame of frames) recorder.push(frame);
  return recorder.toFile(runtime, start);
}

const START: StartState = { roomId: 'room', spawnId: 'start', seed: 99, feelProfile: 'modern' };

const SAMPLE = recordScript(
  script()
    .hold('right', 40)
    .tap('jump', { at: 10 })
    .press(['down'], { at: 50, ticks: 5 })
    .tap('jump', { at: 52 })
    .tap('switch', { at: 70 })
    .hold('left', 60)
    .tap('jump', { at: 90 })
    .build(),
  START,
);

describe('Recorder and Player', () => {
  it('run-length encodes identical consecutive frames', () => {
    const file = recordScript(script().hold('right', 5).build(), START);
    const r = actionMask('right');
    expect(file.frames).toEqual([
      [1, r, r, 0],
      [4, r, 0, 0],
      [1, 0, 0, r],
    ]);
    expect(file).toMatchObject({ version: 2, packId: 'test-pack', packVersion: '0.0.0', seed: 99 });
  });

  it('plays back exactly the recorded frames', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            // Small ranges so that consecutive frames often share some fields.
            held: fc.integer({ min: 0, max: 3 }),
            pressed: fc.integer({ min: 0, max: 3 }),
            released: fc.integer({ min: 0, max: 3 }),
          }),
          { maxLength: 100 },
        ),
        (frames) => {
          const player = new Player(recordScript(frames, START).frames);
          expect(player.length).toBe(frames.length);
          expect(frames.map(() => player.next())).toEqual(frames);
          expect(player.done).toBe(true);
        },
      ),
    );
  });

  it('releases what is still held once after the end, then returns empty frames', () => {
    const r = actionMask('right');
    const player = new Player([[2, r, 0, 0]]);
    player.next();
    player.next();
    expect(player.next()).toEqual({ held: 0, pressed: 0, released: r });
    expect(player.next()).toEqual({ held: 0, pressed: 0, released: 0 });
  });

  it('rejects a replay recorded with another pack or pack version', () => {
    expect(() => runReplayHeadless({ ...SAMPLE, packVersion: '9.9.9' }, runtime)).toThrow(
      /recorded with test-pack@9.9.9/,
    );
    expect(() => runReplayHeadless({ ...SAMPLE, packId: 'other' }, runtime)).toThrow(RangeError);
  });

  it('keeps the start state, including the party override', () => {
    const start: StartState = { ...START, party: ['swimmer'] };
    expect(startOf(recordScript([], start))).toEqual(start);
  });
});

describe('runReplayHeadless', () => {
  it('runs every tick, records checkpoints and stops at `until`', () => {
    const full = runReplayHeadless(SAMPLE, runtime, { checkpointEvery: 10 });
    expect(full.tick).toBe(new Player(SAMPLE.frames).length);
    expect(full.checkpoints.map((c) => c.tick)).toEqual(
      Array.from({ length: Math.floor(full.tick / 10) }, (_, i) => (i + 1) * 10),
    );
    const part = runReplayHeadless(SAMPLE, runtime, { until: 30 });
    expect(part.tick).toBe(30);
    expect(part.hash).toEqual(full.checkpoints[2]?.hash);
  });
});

/** Per-tick hashes when the same replay runs through the loop driver with these frame times. */
function hashesViaDriver(file: ReplayFile, frameTimes: () => number): WorldHash[] {
  const world = createWorld(runtime, startOf(file));
  const player = new Player(file.frames);
  const total = player.length;
  const hashes: WorldHash[] = [];
  // Replayed input does not come from devices, so dropped time needs no resync here.
  const driver = new LoopDriver({
    tick: () => {
      if (world.tick >= total) return;
      step(world, player.next(), runtime);
      hashes.push(hashWorld(world));
    },
  });
  for (let guard = 0; world.tick < total && guard < 100_000; guard++) {
    driver.frame(frameTimes());
  }
  return hashes;
}

function cycle(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe('Determinism (ADR-0012)', () => {
  const reference = runReplayHeadless(SAMPLE, runtime, { checkpointEvery: 1 }).checkpoints.map(
    (c) => c.hash,
  );

  it('(a) the same replay twice gives the same hash every tick', () => {
    const again = runReplayHeadless(SAMPLE, runtime, { checkpointEvery: 1 }).checkpoints;
    expect(again.map((c) => c.hash)).toEqual(reference);
    expect(reference.length).toBe(new Player(SAMPLE.frames).length);
  });

  const frameSequences: Record<string, () => number> = {
    '60 Hz': cycle([1000 / 60]),
    '120 Hz': cycle([1000 / 120]),
    '144 Hz': cycle([1000 / 144]),
    'with spikes (clamped and dropped frames)': cycle([
      1000 / 60,
      1000 / 60,
      120,
      6.9,
      400,
      3,
      1000 / 144,
    ]),
  };

  for (const [name, frameTimes] of Object.entries(frameSequences)) {
    it(`(b) through the loop driver at ${name}: the same hash every tick`, () => {
      expect(hashesViaDriver(SAMPLE, frameTimes)).toEqual(reference);
    });
  }

  it('(b) Property: any frame-time sequence gives the same hashes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 1, maxLength: 40 }),
        (times) => {
          const positive = times.some((t) => t > 0.5) ? times : [...times, 16];
          expect(hashesViaDriver(SAMPLE, cycle(positive))).toEqual(reference);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('a live session recorded through the edge buffer replays to the same hashes', () => {
    let physical = 0;
    const buffer = new EdgeBuffer({ readPhysical: () => physical });
    const world = createWorld(runtime, START);
    const recorder = new Recorder();
    const live: WorldHash[] = [];
    const set = (action: ActionId, down: boolean) => {
      physical = down ? physical | actionMask(action) : physical & ~actionMask(action);
      buffer.push(action, down);
    };
    const driver = new LoopDriver({
      tick: () => {
        const frame = buffer.nextFrame();
        recorder.push(frame);
        step(world, frame, runtime);
        live.push(hashWorld(world));
      },
      dropped: () => buffer.resync('droppedTime'),
    });
    // Device events between frames, with a 144 Hz display and one long stall.
    const events: Array<[number, ActionId, boolean]> = [
      [2, 'right', true],
      [9, 'jump', true],
      [9, 'jump', false],
      [30, 'switch', true],
      [31, 'switch', false],
      [40, 'right', false],
      [41, 'left', true],
      [60, 'down', true],
      [60, 'jump', true],
      [61, 'jump', false],
      [62, 'down', false],
      [90, 'left', false],
    ];
    for (let f = 0; f < 120; f++) {
      for (const [at, action, down] of events) if (at === f) set(action, down);
      driver.frame(f === 70 ? 600 : 1000 / 144);
    }
    const replayed = runReplayHeadless(recorder.toFile(runtime, START), runtime, {
      checkpointEvery: 1,
    });
    expect(replayed.checkpoints.map((c) => c.hash)).toEqual(live);
  });
});
