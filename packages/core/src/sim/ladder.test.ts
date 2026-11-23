// Ladders (ADR-0019). Expectations come from the fixture's ladder and feel values, never from
// fixed numbers in the engine. Rooms and values here are fictional test data.
import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { Recorder, runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import type { CharacterDef, PackRuntime, RoomData } from '../runtime/pack';
import {
  boxRoom,
  buildRoom,
  MODERN,
  RETRO,
  setTile,
  simRuntime,
  TEST_TILE_CLASSES,
  WALKER,
} from '../test-support';
import type { World } from '../world/world';
import { createWorld, type StepOutput, step } from './sim';

const T = 16;
const W = 20;
const H = 12;
const LADDER_COL = 10;
const SHELF_ROW = 6;
const CLIMB = { climbSpeed: fromPx(1), climbJumpVelocity: fromPx(2) };

/**
 * A box room with a shelf across it at SHELF_ROW and a ladder from the shelf (its top rung is
 * in the shelf) down to the floor.
 */
function ladderRows(): string[] {
  const rows = boxRoom(W, H);
  for (let c = 1; c < W - 1; c++) setTile(rows, c, SHELF_ROW, '#');
  for (let r = SHELF_ROW; r < H - 1; r++) setTile(rows, LADDER_COL, r, 'H');
  return rows;
}

const climber: CharacterDef = {
  ...WALKER,
  id: 'climber',
  sprite: {
    atlas: 'a',
    animations: {
      idle: { frames: [{ frame: 'idle', ticks: 1 }], loop: true },
      climb: {
        frames: [
          { frame: 'climb-0', ticks: 4 },
          { frame: 'climb-1', ticks: 4 },
        ],
        loop: true,
      },
      attack: { frames: [{ frame: 'swing', ticks: 6 }], loop: false },
    },
  },
};

function runtimeWith(spawn: [number, number], climb = true, rows = ladderRows()): PackRuntime {
  const base = simRuntime({ rows, spawn, members: ['climber'] });
  const extra = climb ? CLIMB : {};
  return {
    ...base,
    characters: { climber },
    feel: { retro: { ...RETRO, ...extra }, modern: { ...MODERN, ...extra } },
  };
}

const start = (runtime: PackRuntime, profile = 'retro'): World =>
  createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: profile });
const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]): StepOutput[] =>
  frames.map((frame) => step(world, frame, runtime));
const body = (world: World) => {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return {
    x: s.x[slot] as number,
    y: s.y[slot] as number,
    vx: s.vx[slot] as number,
    vy: s.vy[slot] as number,
    grounded: ((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0,
  };
};
const ladderX = fromPx(LADDER_COL * T + T / 2);
const floorY = fromPx((H - 1) * T);
const shelfY = fromPx(SHELF_ROW * T);

/** Spawns on the floor under the ladder and settles. */
function atLadderFoot(climb = true) {
  const runtime = runtimeWith([LADDER_COL, H - 2], climb);
  const world = start(runtime);
  run(world, runtime, script().wait(5).build(5));
  return { runtime, world };
}

describe('ladders (ADR-0019)', () => {
  it('does not grab a ladder the body only walks past', () => {
    const runtime = runtimeWith([5, H - 2]);
    const world = start(runtime);
    for (const frame of script().hold('right', 60).build(60)) {
      step(world, frame, runtime);
      expect(world.controller.climbing).toBe(false);
    }
    expect(body(world).x).toBeGreaterThan(ladderX);
  });

  it('climbs up with up at climbSpeed, centered, and stands on the top rung', () => {
    const { runtime, world } = atLadderFoot();
    // Off the column's middle, but still with the body's center over the ladder.
    const slot = world.entities.slotOf(world.party.entityId);
    world.entities.x[slot] = ladderX + fromPx(T / 2 - 3);
    run(world, runtime, script().hold('up', 1).build(1));
    expect(world.controller.climbing).toBe(true);
    expect(body(world).x).toBe(ladderX);
    const y0 = body(world).y;
    run(world, runtime, script().hold('up', 3).build(3));
    expect(body(world).y).toBe(y0 - 3 * CLIMB.climbSpeed);
    for (let i = 0; i < 400 && world.controller.climbing; i++) {
      run(world, runtime, script().hold('up', 1).build(1));
    }
    expect(world.controller.climbing).toBe(false);
    expect(body(world)).toMatchObject({ y: shelfY, vy: 0, grounded: true });
    // It stays there, and walks on along the shelf over the top rung.
    run(world, runtime, script().wait(10).hold('right', 30).build());
    expect(body(world).y).toBe(shelfY);
  });

  it('climbs down with down from the top rung, and stands on the floor', () => {
    const runtime = runtimeWith([LADDER_COL, SHELF_ROW - 1]);
    const world = start(runtime);
    run(world, runtime, script().wait(5).build(5));
    expect(body(world)).toMatchObject({ y: shelfY, grounded: true });
    run(world, runtime, script().hold('down', 1).build(1));
    expect(world.controller.climbing).toBe(true);
    for (let i = 0; i < 400 && world.controller.climbing; i++) {
      run(world, runtime, script().hold('down', 1).build(1));
    }
    expect(body(world)).toMatchObject({ y: floorY, grounded: true });
  });

  it('grabs from the air with up', () => {
    const { runtime, world } = atLadderFoot();
    run(world, runtime, script().hold('jump', 4).build(4));
    expect(body(world).grounded).toBe(false);
    run(world, runtime, script().hold('up', 1).build(1));
    expect(world.controller.climbing).toBe(true);
    expect(body(world).vx).toBe(0);
  });

  it('lets go with a jump: a hop of climbJumpVelocity, sideways with the held direction', () => {
    const { runtime, world } = atLadderFoot();
    run(world, runtime, script().hold('up', 30).build(30));
    expect(world.controller.climbing).toBe(true);
    run(world, runtime, script().hold(['right', 'jump'], 1).build(1));
    expect(world.controller.climbing).toBe(false);
    expect(body(world)).toMatchObject({ vx: RETRO.runSpeed, vy: -CLIMB.climbJumpVelocity });
    run(world, runtime, script().hold('right', 120).build(120));
    expect(body(world)).toMatchObject({ y: floorY, grounded: true });
    expect(body(world).x).toBeGreaterThan(ladderX);
  });

  it('swings on the ladder: no climbing during the swing, and left or right only turn', () => {
    const { runtime, world } = atLadderFoot();
    run(world, runtime, script().hold('up', 20).build(20));
    const { x, y } = body(world);
    run(world, runtime, script().hold('left', 2).build(2));
    expect(world.controller.facing).toBe(-1);
    expect(body(world).x).toBe(x);
    const outs = run(world, runtime, script().hold('up', 6).tap('attack', { at: 0 }).build(6));
    expect(world.controller.climbing).toBe(true);
    expect(
      outs.every((o) => o.render.sprites.length === 0 || o.render.sprites[0]?.frame === 'swing'),
    ).toBe(true);
    expect(body(world).y).toBe(y);
    run(world, runtime, script().hold('up', 3).build(3));
    expect(body(world).y).toBeLessThan(y);
  });

  it('moves the climb frames only while moving', () => {
    const { runtime, world } = atLadderFoot();
    const frames = run(world, runtime, script().hold('up', 12).wait(12).build()).map(
      (o) => o.render.sprites[0]?.frame,
    );
    // Moving: the two frames take turns; still: the frame stays.
    expect(new Set(frames.slice(0, 12))).toEqual(new Set(['climb-0', 'climb-1']));
    expect(new Set(frames.slice(12))).toEqual(new Set([frames[11]]));
  });

  it('cannot hold on without climbSpeed in the feel', () => {
    const { runtime, world } = atLadderFoot(false);
    run(world, runtime, script().hold('up', 20).build(20));
    expect(world.controller.climbing).toBe(false);
    expect(body(world).y).toBe(floorY);
  });

  it('takes a ladder up through the top edge into the room above, still holding on', () => {
    // Room `low`: a ladder from the floor up to the top edge, with an edge exit there. Room
    // `high`: the same ladder going on from its bottom edge.
    const lowRows = boxRoom(W, H);
    const highRows = boxRoom(W, H);
    for (let r = 0; r < H - 1; r++) setTile(lowRows, LADDER_COL, r, 'H');
    for (let r = 4; r < H; r++) setTile(highRows, LADDER_COL, r, 'H');
    const room = (
      id: string,
      rows: string[],
      spawns: Record<string, [number, number]>,
      exits: RoomData['exits'],
    ): RoomData => {
      const grid = buildRoom(rows, T);
      return {
        id,
        widthTiles: W,
        heightTiles: H,
        collision: grid.collision,
        tileClasses: TEST_TILE_CLASSES,
        spawns: Object.fromEntries(
          Object.entries(spawns).map(([k, [c, r]]) => [
            k,
            { x: fromPx(c * T + T / 2), y: fromPx((r + 1) * T) },
          ]),
        ),
        ...(exits === undefined ? {} : { exits }),
      };
    };
    const low = room('low', lowRows, { start: [LADDER_COL, H - 2] }, [
      {
        kind: 'edge',
        rect: { x: fromPx((LADDER_COL - 1) * T), y: 0, w: fromPx(3 * T), h: fromPx(T) },
        toRoomId: 'high',
        spawnId: 'bottom',
        effect: 'cut',
      },
    ]);
    const high = room('high', highRows, { bottom: [LADDER_COL, H - 3] }, []);
    // Arriving off the ladder's middle (the spawn is a few px to the side): centered on it.
    const bottom = high.spawns.bottom as { x: number; y: number };
    const highOff: RoomData = {
      ...high,
      spawns: { bottom: { x: bottom.x + fromPx(T / 2 - 3), y: bottom.y } },
    };
    const runtime: PackRuntime = {
      ...runtimeWith([LADDER_COL, H - 2]),
      rooms: { low, high: highOff },
    };
    const world = createWorld(runtime, {
      roomId: 'low',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    for (let i = 0; i < 600 && world.roomId === 'low'; i++) {
      run(world, runtime, script().hold('up', 1).build(1));
    }
    expect(world.roomId).toBe('high');
    expect(world.controller.climbing).toBe(true);
    expect(body(world).x).toBe(ladderX);
    const y = body(world).y;
    run(world, runtime, script().hold('up', 5).build(5));
    expect(body(world).y).toBe(y - 5 * CLIMB.climbSpeed);
  });

  it('gives the same hashes live and from a replay', () => {
    const runtime = runtimeWith([4, H - 2]);
    const frames = script()
      .hold('right', 60)
      .hold('up', 120)
      .hold(['left', 'jump'], 1)
      .wait(60)
      .hold('right', 30)
      .hold('up', 40)
      .tap('attack', { at: 10 })
      .hold('down', 80)
      .build();
    const startState = { roomId: 'room', spawnId: 'start', seed: 4, feelProfile: 'modern' };
    const world = createWorld(runtime, startState);
    const recorder = new Recorder();
    const live: string[] = [];
    let climbed = false;
    for (const frame of frames) {
      recorder.push(frame);
      step(world, frame, runtime);
      climbed ||= world.controller.climbing;
      live.push(hashWorld(world).join(':'));
    }
    expect(climbed).toBe(true);
    const headless = runReplayHeadless(recorder.toFile(runtime, startState), runtime, {
      checkpointEvery: 1,
    });
    expect(headless.checkpoints.map((c) => c.hash.join(':'))).toEqual(live);
  });
});
