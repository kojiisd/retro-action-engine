// Room changes (ADR-0018). Expectations come from the fixture's exits and `roomTransition`, never
// from fixed numbers in the engine. Rooms and values here are fictional test data.
import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { Recorder, runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import type { ExitDef, PackRuntime, RoomData, RoomTransitionDef } from '../runtime/pack';
import { GameSession, type InputSource } from '../session/session';
import { boxRoom, buildRoom, setTile, simRuntime, TEST_TILE_CLASSES } from '../test-support';
import type { World } from '../world/world';
import { createWorld, type StepOutput, step } from './sim';

const T = 16;
const rect = (col: number, row: number, cols: number, rows: number) => ({
  x: fromPx(col * T),
  y: fromPx(row * T),
  w: fromPx(cols * T),
  h: fromPx(rows * T),
});
/** Bottom-center of a tile, as `pack` places a spawn standing on the floor below that tile. */
const spawnAt = (col: number, row: number) => ({
  x: fromPx(col * T + T / 2),
  y: fromPx((row + 1) * T),
});

function room(
  id: string,
  rows: readonly string[],
  spawns: Record<string, [number, number]>,
  exits: ExitDef[],
): RoomData {
  const grid = buildRoom(rows, T);
  return {
    id,
    widthTiles: grid.widthTiles,
    heightTiles: grid.heightTiles,
    collision: grid.collision,
    tileClasses: TEST_TILE_CLASSES,
    spawns: Object.fromEntries(Object.entries(spawns).map(([k, [c, r]]) => [k, spawnAt(c, r)])),
    exits,
  };
}

const W = 16;
const H = 8;
const FLOOR_ROW = H - 2; // the row the characters stand in

/**
 * Room `a`: open on the right (an `edge` exit to `b`), a warp (to `b`'s `door` spawn, for
 * swimmers only) and a door to `b`. Room `b`: open on the left (an `edge` exit back to `a`),
 * and a warp on its `door` spawn back to `a`'s start.
 */
function world2(transition?: RoomTransitionDef, effect: 'cut' | 'fade' = 'fade'): PackRuntime {
  const rowsA = boxRoom(W, H);
  const rowsB = boxRoom(W, H);
  for (let r = FLOOR_ROW - 2; r <= FLOOR_ROW; r++) {
    setTile(rowsA, W - 1, r, '.');
    setTile(rowsB, 0, r, '.');
  }
  const a = room('a', rowsA, { start: [3, FLOOR_ROW], east: [W - 4, FLOOR_ROW] }, [
    {
      kind: 'edge',
      rect: rect(W - 1, FLOOR_ROW - 2, 1, 3),
      toRoomId: 'b',
      spawnId: 'west',
      effect,
    },
    {
      kind: 'warp',
      rect: rect(6, FLOOR_ROW - 1, 1, 2),
      toRoomId: 'b',
      spawnId: 'door',
      effect,
      requiresAnyTag: ['move:swim'],
    },
    { kind: 'door', rect: rect(9, FLOOR_ROW - 1, 1, 2), toRoomId: 'b', spawnId: 'door', effect },
  ]);
  const b = room('b', rowsB, { west: [2, FLOOR_ROW], door: [8, FLOOR_ROW] }, [
    { kind: 'edge', rect: rect(0, FLOOR_ROW - 2, 1, 3), toRoomId: 'a', spawnId: 'east', effect },
    { kind: 'warp', rect: rect(8, FLOOR_ROW - 1, 1, 2), toRoomId: 'a', spawnId: 'start', effect },
  ]);
  const base = simRuntime({ rows: rowsA, spawn: [3, FLOOR_ROW], members: ['walker', 'swimmer'] });
  return {
    ...base,
    rooms: { a, b },
    ...(transition === undefined ? {} : { roomTransition: transition }),
  };
}

const FADE: RoomTransitionDef = { effect: 'fade', lockTicks: 20 };
const OUT = FADE.lockTicks >> 1;
const IN = FADE.lockTicks - OUT;

const start = (runtime: PackRuntime, spawnId = 'start', roomId = 'a'): World =>
  createWorld(runtime, { roomId, spawnId, seed: 1, feelProfile: 'retro' });

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

/** Holds right until a room change starts; returns the outputs up to and including that tick. */
function walkRightUntilChange(world: World, runtime: PackRuntime, limit = 600): StepOutput[] {
  const outs: StepOutput[] = [];
  const roomId = world.roomId;
  for (let i = 0; i < limit && world.transition.phase === 'none' && world.roomId === roomId; i++) {
    outs.push(...run(world, runtime, script().hold('right', 1).build(1)));
  }
  return outs;
}

describe('room changes (ADR-0018)', () => {
  it('goes through an edge: dark, the new room, light, then plays on with its speed', () => {
    const runtime = world2(FADE);
    const world = start(runtime, 'east');
    walkRightUntilChange(world, runtime);
    expect(world.transition).toMatchObject({ phase: 'out', kind: 'edge', toRoomId: 'b' });
    const before = body(world);
    expect(before.vx).toBeGreaterThan(0);

    // The dark phase: same room, the body stands still, the fade goes up.
    const out = run(
      world,
      runtime,
      script()
        .hold('right', OUT - 1)
        .build(OUT - 1),
    );
    expect(world.roomId).toBe('a');
    expect(body(world).x).toBe(before.x);
    expect(out.map((o) => o.transition?.tick)).toEqual(
      Array.from({ length: OUT - 1 }, (_, i) => i + 1),
    );
    // The last dark tick moves to the new room, at its spawn, keeping the speed (edge).
    const [arrival] = run(world, runtime, script().hold('right', 1).build(1));
    expect(world.roomId).toBe('b');
    expect(arrival?.render.room).toBe('b');
    expect(arrival?.transition).toEqual({ effect: 'fade', phase: 'in', tick: 0, ticks: IN });
    const spawn = runtime.rooms.b?.spawns.west;
    expect(body(world)).toMatchObject({ x: spawn?.x, y: spawn?.y, vx: before.vx });
    // Where the party respawns is now this room's entry.
    expect([world.party.spawnX, world.party.spawnY]).toEqual([spawn?.x, spawn?.y]);

    // The light phase, then it moves again.
    const light = run(world, runtime, script().hold('right', IN).build(IN));
    expect(light.at(-1)?.transition).toBeNull();
    expect(body(world).x).toBe(spawn?.x);
    run(world, runtime, script().hold('right', 1).build(1));
    expect(body(world).x).toBeGreaterThan(spawn?.x as number);
  });

  it('drops the input while the rooms change', () => {
    const runtime = world2(FADE);
    const runWith = (during: readonly InputFrame[]) => {
      const world = start(runtime, 'east');
      walkRightUntilChange(world, runtime);
      const positions = run(world, runtime, during).map(() => body(world).x);
      run(world, runtime, script().wait(10).build(10));
      return { world, positions };
    };
    const quiet = runWith(script().build(FADE.lockTicks));
    const busy = runWith(
      script()
        .hold('left', FADE.lockTicks)
        .tap('jump', { at: 2 })
        .tap('jump', { at: FADE.lockTicks - 1 })
        .tap('switch', { at: 5 })
        .tap('attack', { at: FADE.lockTicks - 2 })
        .build(FADE.lockTicks),
    );
    expect(busy.world.party.activeIndex).toBe(0);
    expect(busy.world.controller.attackUntilTick).toBe(quiet.world.controller.attackUntilTick);
    expect(hashWorld(busy.world)).toEqual(hashWorld(quiet.world));
    // Not a single move during the change.
    expect(new Set(quiet.positions.slice(0, OUT - 1)).size).toBe(1);
  });

  it('cuts at once with "cut", and stops for lockTicks', () => {
    const lock = { effect: 'cut', lockTicks: 6 } as const;
    const runtime = world2(lock, 'cut');
    const world = start(runtime, 'east');
    const outs = walkRightUntilChange(world, runtime);
    expect(world.roomId).toBe('b');
    expect(outs.at(-1)?.transition).toEqual({
      effect: 'cut',
      phase: 'in',
      tick: 0,
      ticks: lock.lockTicks,
    });
    const x = body(world).x;
    run(world, runtime, script().hold('right', lock.lockTicks).build(lock.lockTicks));
    expect(body(world).x).toBe(x);
    expect(world.transition.phase).toBe('none');
    run(world, runtime, script().hold('right', 1).build(1));
    expect(body(world).x).toBeGreaterThan(x);
  });

  it('changes rooms without stopping when the pack sets no roomTransition', () => {
    const runtime = world2(undefined, 'cut');
    const world = start(runtime, 'east');
    walkRightUntilChange(world, runtime);
    expect(world.roomId).toBe('b');
    expect(world.transition.phase).toBe('none');
  });

  it('enters a door with up, on the ground only, and stops there', () => {
    const runtime = world2(FADE);
    const door = runtime.rooms.a?.exits?.[2] as ExitDef;
    const doorX = (door.rect.x + (door.rect.w >> 1)) >> 8;
    const world = start(runtime);
    // Walk onto the door (it is to the right of the start, past the warp, which the walker
    // cannot take).
    for (let i = 0; i < 300 && body(world).x >> 8 < doorX; i++) {
      run(world, runtime, script().hold('right', 1).build(1));
    }
    run(world, runtime, script().wait(20).build(20));
    expect(world.transition.phase).toBe('none');
    // Jump and press up in the air: nothing.
    run(world, runtime, script().hold('jump', 4).build(4));
    expect(body(world).grounded).toBe(false);
    run(world, runtime, script().tap('up', { at: 0 }).build(1));
    expect(world.transition.phase).toBe('none');
    run(world, runtime, script().wait(60).build(60));
    expect(body(world).grounded).toBe(true);
    // Up on the ground: through the door, stopped at the spawn.
    run(world, runtime, script().tap('up', { at: 0 }).build(1));
    expect(world.transition).toMatchObject({ phase: 'out', kind: 'door' });
    run(world, runtime, script().build(OUT));
    expect(world.roomId).toBe('b');
    expect(body(world)).toMatchObject({ vx: 0, vy: 0 });
  });

  it('warps on touch, only with the required tag', () => {
    const runtime = world2(FADE);
    const warp = runtime.rooms.a?.exits?.[1] as ExitDef;
    const warpX = (warp.rect.x + (warp.rect.w >> 1)) >> 8;
    const walk = (members: string[]) => {
      const world = createWorld(runtime, {
        roomId: 'a',
        spawnId: 'start',
        seed: 1,
        feelProfile: 'retro',
        party: members,
      });
      for (
        let i = 0;
        i < 300 && world.transition.phase === 'none' && body(world).x >> 8 <= warpX;
        i++
      ) {
        run(world, runtime, script().hold('right', 1).build(1));
      }
      return world;
    };
    expect(walk(['walker']).transition.phase).toBe('none');
    const swimmer = walk(['swimmer']);
    expect(swimmer.transition).toMatchObject({ phase: 'out', kind: 'warp', spawnId: 'door' });
    run(swimmer, runtime, script().build(OUT));
    expect(swimmer.roomId).toBe('b');
    expect(body(swimmer)).toMatchObject({ vx: 0, vy: 0 });
  });

  it('does not take an exit the body arrived on until it has left it', () => {
    const runtime = world2(FADE);
    // `b`'s door spawn stands on its warp back to `a`.
    const world = start(runtime, 'door', 'b');
    expect(world.disarmedExits).toEqual([1]);
    run(world, runtime, script().wait(30).build(30));
    expect(world.transition.phase).toBe('none');
    // Walk off it, then back onto it: now it warps.
    run(world, runtime, script().hold('right', 30).build(30));
    expect(world.disarmedExits).toEqual([]);
    for (let i = 0; i < 120 && world.transition.phase === 'none'; i++) {
      run(world, runtime, script().hold('left', 1).build(1));
    }
    expect(world.transition).toMatchObject({ phase: 'out', kind: 'warp', toRoomId: 'a' });
  });

  it('gives the same hashes live, from a replay, and for any split of the frame times', () => {
    const runtime = world2(FADE);
    const frames = script()
      .hold('right', 200)
      .tap('jump', { at: 150 })
      .wait(30)
      .hold('left', 250)
      .wait(20)
      .build();
    const startState = { roomId: 'a', spawnId: 'east', seed: 3, feelProfile: 'modern' };
    const world = createWorld(runtime, startState);
    const recorder = new Recorder();
    const live: string[] = [];
    const rooms = new Set<string>();
    for (const frame of frames) {
      recorder.push(frame);
      step(world, frame, runtime);
      rooms.add(world.roomId);
      live.push(hashWorld(world).join(':'));
    }
    // The run went to `b` and back to `a`.
    expect(rooms).toEqual(new Set(['a', 'b']));
    expect(world.roomId).toBe('a');
    const file = recorder.toFile(runtime, startState);
    const headless = runReplayHeadless(file, runtime, { checkpointEvery: 1 });
    expect(headless.checkpoints.map((c) => c.hash.join(':'))).toEqual(live);

    const none: InputSource = { nextFrame: () => ({ held: 0, pressed: 0, released: 0 }) };
    for (const pattern of [[7, 9, 40], [33.4], [250, 3, 16.7]]) {
      const session = new GameSession(runtime, startState, none);
      session.replay(file);
      for (let i = 0; !session.replayDone; i++) {
        session.frame(pattern[i % pattern.length] as number);
      }
      expect(session.hash().join(':')).toBe(live.at(-1));
    }
  });
});
