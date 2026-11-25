// Items, gimmicks, event zones and flags (ADR-0021). Expectations come from the fixture's rooms,
// items and animation, never fixed numbers in the engine. Names and values are fictional.
import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { Recorder, runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import type {
  AnimationDef,
  CharacterDef,
  EventZone,
  ExitDef,
  GimmickPlacement,
  ItemDef,
  PackRuntime,
  RoomData,
} from '../runtime/pack';
import { GameSession, type InputSource } from '../session/session';
import {
  boxRoom,
  buildRoom,
  setTile,
  simRuntime,
  TEST_TILE_CLASSES,
  WALKER,
} from '../test-support';
import type { World } from '../world/world';
import { createWorld, type StepOutput, step } from './sim';

const T = 16;
const W = 20;
const H = 8;
const FLOOR_ROW = H - 2; // the row the characters stand in
const SPAWN_COL = 5;
const rect = (col: number, row: number, cols = 1, rows = 1) => ({
  x: fromPx(col * T),
  y: fromPx(row * T),
  w: fromPx(cols * T),
  h: fromPx(rows * T),
});

// A swing whose box reaches one tile ahead of the body, at the height of the two tiles above
// the floor (the body is 12 x 14 px; see test-support).
const SWING: AnimationDef = {
  frames: [
    { frame: 'wind', ticks: 2 },
    {
      frame: 'slash',
      ticks: 4,
      hitbox: { x: fromPx(4), y: fromPx(-20), w: fromPx(12), h: fromPx(10) },
    },
    { frame: 'rest', ticks: 2 },
  ],
  loop: false,
};
const animations = {
  idle: { frames: [{ frame: 'idle', ticks: 1 }], loop: true },
  run: { frames: [{ frame: 'run', ticks: 1 }], loop: true },
  jump: { frames: [{ frame: 'jump', ticks: 1 }], loop: false },
  fall: { frames: [{ frame: 'fall', ticks: 1 }], loop: false },
  attack: SWING,
};
const FENCER: CharacterDef = { ...WALKER, id: 'fencer', sprite: { atlas: 'c', animations } };
/** Has the breaking tag of its own (for `gating.subject`). */
const DIGGER: CharacterDef = {
  ...FENCER,
  id: 'digger',
  abilityTags: ['break:test'],
};

const ITEMS: Record<string, ItemDef> = {
  fins: { id: 'fins', kind: 'upgrade', grants: ['move:swim'], stack: 1 },
  hammer: { id: 'hammer', kind: 'upgrade', grants: ['break:test'], stack: 1 },
  coin: { id: 'coin', kind: 'key', stack: 3 },
};

interface Fixture {
  readonly rows?: string[];
  readonly gimmicks?: GimmickPlacement[];
  readonly zones?: EventZone[];
  readonly exits?: ExitDef[];
  readonly members?: string[];
  readonly gating?: 'active' | 'anyInParty';
}

function roomData(id: string, rows: readonly string[], f: Fixture): RoomData {
  const grid = buildRoom(rows, T);
  return {
    id,
    widthTiles: grid.widthTiles,
    heightTiles: grid.heightTiles,
    collision: grid.collision,
    tileClasses: TEST_TILE_CLASSES,
    spawns: {
      start: { x: fromPx(SPAWN_COL * T + T / 2), y: fromPx((FLOOR_ROW + 1) * T) },
      far: { x: fromPx(15 * T + T / 2), y: fromPx((FLOOR_ROW + 1) * T) },
    },
    ...(f.gimmicks === undefined ? {} : { gimmicks: f.gimmicks }),
    ...(f.zones === undefined ? {} : { zones: f.zones }),
    ...(f.exits === undefined ? {} : { exits: f.exits }),
  };
}

function runtimeOf(f: Fixture, other?: Fixture): PackRuntime {
  const rows = f.rows ?? boxRoom(W, H);
  const base = simRuntime({
    rows,
    spawn: [SPAWN_COL, FLOOR_ROW],
    members: f.members ?? ['fencer'],
  });
  return {
    ...base,
    rooms: {
      room: roomData('room', rows, f),
      ...(other === undefined
        ? {}
        : { other: roomData('other', other.rows ?? boxRoom(W, H), other) }),
    },
    characters: { ...base.characters, fencer: FENCER, digger: DIGGER },
    items: ITEMS,
    rules: {
      ...base.rules,
      ...(f.gating === undefined ? {} : { gating: { subject: f.gating } }),
    },
  };
}

const start = (runtime: PackRuntime): World =>
  createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: 'retro' });
const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]): StepOutput[] =>
  frames.map((frame) => step(world, frame, runtime));
/** The body's center x in px (floor). */
const xOf = (world: World) =>
  (world.entities.x[world.entities.slotOf(world.party.entityId)] as number) >> 8;
const walk = (dir: 'left' | 'right', ticks: number) => script().hold(dir, ticks).build(ticks);
const swing = () =>
  script()
    .tap('attack')
    .wait(SWING.frames.length * 4)
    .build();
const notices = (outs: readonly StepOutput[]) => outs.flatMap((o) => o.notices);

/** A full-height column of tiles at `col` (nothing to jump over). */
function column(col: number, tile: string): string[] {
  const rows = boxRoom(W, H);
  for (let r = 0; r <= FLOOR_ROW; r++) setTile(rows, col, r, tile);
  return rows;
}
const WALL_COL = 10;
/** Furthest the body's center gets left of a wall at WALL_COL (half the 12 px body). */
const BEFORE_WALL = WALL_COL * T - 6;

const pickup = (
  objectId: number,
  col: number,
  itemId: string,
  count?: number,
): GimmickPlacement => ({
  objectId,
  type: 'pickup',
  rect: rect(col, FLOOR_ROW),
  flag: `obj:room:${objectId}`,
  itemId,
  ...(count === undefined ? {} : { count }),
});
const rock = (objectId: number): GimmickPlacement => ({
  objectId,
  type: 'breakable',
  rect: rect(WALL_COL, FLOOR_ROW - 1, 1, 2),
  flag: `obj:room:${objectId}`,
  requiresAnyTag: ['break:test'],
  sprite: { atlas: 'o', frame: 'rock' },
});

describe('items and grants (ADR-0021)', () => {
  it('cannot pass a tag-gated tile, picks up the item that grants the tag, then passes', () => {
    const runtime = runtimeOf({ rows: column(WALL_COL, '~'), gimmicks: [pickup(7, 3, 'fins')] });
    const world = start(runtime);
    run(world, runtime, walk('right', 90));
    expect(xOf(world)).toBe(BEFORE_WALL);
    expect(world.inventory).toEqual({});

    const outs = run(world, runtime, walk('left', 90));
    expect(notices(outs)).toEqual([{ kind: 'pickup', itemId: 'fins', count: 1 }]);
    expect(world.inventory).toEqual({ fins: 1 });
    expect(world.flags['obj:room:7']).toBe(true);
    expect(outs.at(-1)?.ui.inventory).toEqual([{ id: 'fins', count: 1 }]);

    run(world, runtime, walk('right', 150));
    expect(xOf(world)).toBeGreaterThan((WALL_COL + 1) * T);
  });

  it('picks up once: the picked-up item is gone and its flag stays', () => {
    const coin = { ...pickup(2, 3, 'coin', 2), sprite: { atlas: 'o', frame: 'coin' } };
    const runtime = runtimeOf({ gimmicks: [coin] });
    const world = start(runtime);
    const shown = (outs: readonly StepOutput[]) =>
      outs.at(-1)?.render.sprites.some((s) => s.frame === 'coin');
    expect(shown(run(world, runtime, script().build(1)))).toBe(true);
    const outs = run(world, runtime, [
      ...walk('left', 60),
      ...walk('right', 60),
      ...walk('left', 60),
    ]);
    expect(notices(outs)).toEqual([{ kind: 'pickup', itemId: 'coin', count: 2 }]);
    expect(world.inventory).toEqual({ coin: 2 });
    expect(world.flags['obj:room:2']).toBe(true);
    expect(shown(outs)).toBe(false);
  });

  it('holds no more than the stack: the rest of a pickup is lost', () => {
    const runtime = runtimeOf({ gimmicks: [pickup(1, 4, 'coin', 2), pickup(2, 3, 'coin', 2)] });
    const world = start(runtime);
    const outs = run(world, runtime, walk('left', 60));
    expect(world.inventory).toEqual({ coin: ITEMS.coin?.stack });
    expect(notices(outs).map((n) => n.count)).toEqual([2, (ITEMS.coin?.stack as number) - 2]);
  });
});

describe('breakable (ADR-0021)', () => {
  it('stands as a wall, does not break without the tag, and breaks with the item', () => {
    const runtime = runtimeOf({ gimmicks: [rock(4), pickup(5, 3, 'hammer')] });
    const world = start(runtime);
    run(world, runtime, walk('right', 90));
    expect(xOf(world)).toBe(BEFORE_WALL);
    run(world, runtime, swing());
    expect(world.flags['obj:room:4']).toBeUndefined();
    run(world, runtime, walk('right', 10));
    expect(xOf(world)).toBe(BEFORE_WALL);

    run(world, runtime, walk('left', 90));
    expect(world.inventory).toEqual({ hammer: 1 });
    run(world, runtime, walk('right', 90));
    expect(xOf(world)).toBe(BEFORE_WALL);
    const outs = run(world, runtime, swing());
    expect(world.flags['obj:room:4']).toBe(true);
    // Broken: no longer drawn, and the body walks on through.
    expect(outs.at(-1)?.render.sprites.some((s) => s.frame === 'rock')).toBe(false);
    run(world, runtime, walk('right', 60));
    expect(xOf(world)).toBeGreaterThan((WALL_COL + 1) * T);
  });

  it('asks the active member or anyone in the party, by rules.gating.subject', () => {
    const swingAtRock = (gating: 'active' | 'anyInParty', down = false) => {
      const runtime = runtimeOf({ gimmicks: [rock(4)], members: ['fencer', 'digger'], gating });
      const world = start(runtime);
      // HP without HP rules: only `isAlive` reads it here.
      if (down) world.party.hp = [1, 0];
      run(world, runtime, walk('right', 90));
      run(world, runtime, swing());
      return world.flags['obj:room:4'] === true;
    };
    expect(swingAtRock('active')).toBe(false);
    expect(swingAtRock('anyInParty')).toBe(true);
    // A member who is down does not count.
    expect(swingAtRock('anyInParty', true)).toBe(false);
  });
});

describe('switch and gate (ADR-0021)', () => {
  const fixture = (): Fixture => ({
    gimmicks: [
      {
        objectId: 1,
        type: 'switch',
        rect: rect(SPAWN_COL + 1, FLOOR_ROW - 1),
        flag: 'gate-open',
        sprite: { atlas: 'o', frame: 'off' },
        spriteOn: { atlas: 'o', frame: 'on' },
      },
      {
        objectId: 2,
        type: 'gate',
        rect: rect(WALL_COL, FLOOR_ROW - 1, 1, 2),
        flag: 'gate-open',
        sprite: { atlas: 'o', frame: 'gate' },
      },
    ],
  });
  const frames = (outs: readonly StepOutput[]) =>
    (outs.at(-1)?.render.sprites ?? []).filter((s) => s.id < 0).map((s) => s.frame);

  it('the sword on the switch sets the flag, and the gate opens and stays open', () => {
    const runtime = runtimeOf(fixture());
    let world = start(runtime);
    let outs = run(world, runtime, walk('right', 90));
    expect(xOf(world)).toBe(BEFORE_WALL);
    expect(frames(outs)).toEqual(['gate', 'off']);

    // From the start, the switch is within the sword's reach.
    world = start(runtime);
    outs = run(world, runtime, swing());
    expect(world.flags['gate-open']).toBe(true);
    expect(frames(outs)).toEqual(['on']);

    run(world, runtime, walk('right', 90));
    expect(xOf(world)).toBeGreaterThan((WALL_COL + 1) * T);
  });

  it('gimmick sprites sit at the bottom-center of their box, behind the entities, ids below 0', () => {
    const runtime = runtimeOf(fixture());
    const world = start(runtime);
    const [out] = run(world, runtime, script().build(1));
    const sprites = out?.render.sprites ?? [];
    expect(sprites.map((s) => s.id)).toEqual([-2, -1, world.party.entityId]);
    expect(sprites[0]).toMatchObject({
      x: WALL_COL * T + T / 2,
      y: (FLOOR_ROW + 1) * T,
      depth: -1,
    });
  });
});

describe('flags across rooms and exits (ADR-0021)', () => {
  it('an exit with requiresFlag does nothing until the flag is set; flags stay across rooms', () => {
    const exit: ExitDef = {
      kind: 'warp',
      rect: rect(SPAWN_COL + 3, FLOOR_ROW),
      toRoomId: 'other',
      spawnId: 'far',
      effect: 'cut',
      requiresFlag: 'warp-on',
    };
    const runtime = runtimeOf(
      { exits: [exit], gimmicks: [rock(4), pickup(5, 3, 'hammer')] },
      {
        exits: [
          {
            kind: 'warp',
            rect: rect(10, FLOOR_ROW),
            toRoomId: 'room',
            spawnId: 'start',
            effect: 'cut',
          },
        ],
      },
    );
    const world = start(runtime);
    run(world, runtime, walk('right', 30));
    expect(world.roomId).toBe('room');
    // Take the hammer and break the rock, then set the flag and go through.
    run(world, runtime, walk('left', 60));
    run(world, runtime, walk('right', 90));
    run(world, runtime, swing());
    expect(world.flags['obj:room:4']).toBe(true);
    world.flags['warp-on'] = true;
    // Walking back left over the warp takes it now.
    const rooms = walk('left', 30).map((frame) => {
      step(world, frame, runtime);
      return world.roomId;
    });
    expect(rooms).toContain('other');
    expect(world.roomId).toBe('other');
    // Back through the other room's warp: the rock stays broken, the hammer is not there.
    run(world, runtime, walk('left', 60));
    expect(world.roomId).toBe('room');
    const [out] = run(world, runtime, script().build(1));
    expect(out?.render.sprites.filter((s) => s.id < 0)).toEqual([]);
    expect(world.inventory).toEqual({ hammer: 1 });
  });
});

describe('event zones (ADR-0021)', () => {
  const zone = (z: Partial<EventZone>): EventZone => ({
    objectId: 9,
    rect: rect(8, FLOOR_ROW - 1, 2, 2),
    trigger: 'onZoneEnter',
    conditions: [],
    actions: [],
    ...z,
  });

  it('fires once on entering, again on each new entry, while its conditions hold', () => {
    const runtime = runtimeOf({
      zones: [zone({ conditions: [{ notItem: 'fins' }], actions: [{ giveItem: 'coin' }] })],
    });
    const world = start(runtime);
    /** Walks right until the body is in the zone, then stands there. */
    const into = () => {
      const outs: StepOutput[] = [];
      for (let t = 0; t < 120 && world.zonesInside.length === 0; t++) {
        outs.push(...run(world, runtime, walk('right', 1)));
      }
      outs.push(...run(world, runtime, script().build(30)));
      expect(world.zonesInside).toEqual([0]);
      return outs;
    };
    // Into the zone and standing in it: one coin.
    expect(notices(into())).toEqual([{ kind: 'pickup', itemId: 'coin', count: 1 }]);
    // Out to the left and in again: one more.
    run(world, runtime, walk('left', 40));
    into();
    expect(world.inventory).toEqual({ coin: 2 });
    // With `fins`, `notItem` holds it back.
    world.inventory.fins = 1;
    run(world, runtime, walk('left', 40));
    into();
    expect(world.inventory).toEqual({ coin: 2, fins: 1 });
  });

  it('fires on leaving, runs actions in order, and checks flags and item counts', () => {
    const runtime = runtimeOf({
      zones: [
        zone({
          trigger: 'onZoneExit',
          conditions: [
            { flag: 'ready', is: true },
            { hasItem: 'coin', count: 2 },
          ],
          actions: [
            { takeItem: 'coin', count: 2 },
            { setFlag: 'paid' },
            { setFlag: 'level', value: 3 },
          ],
        }),
      ],
    });
    const world = start(runtime);
    world.inventory.coin = 2;
    // Not ready: walking through does nothing.
    run(world, runtime, walk('right', 90));
    expect(world.inventory).toEqual({ coin: 2 });
    world.flags.ready = true;
    // Being outside is not leaving.
    run(world, runtime, script().build(10));
    expect(world.inventory).toEqual({ coin: 2 });
    run(world, runtime, walk('left', 90));
    expect(world.inventory).toEqual({});
    expect(world.flags).toMatchObject({ paid: true, level: 3 });
  });

  it('counts a zone the body is in on entering the room as entered', () => {
    const runtime = runtimeOf({
      zones: [zone({ rect: rect(SPAWN_COL, FLOOR_ROW), actions: [{ setFlag: 'arrived' }] })],
    });
    const world = start(runtime);
    run(world, runtime, script().build(1));
    expect(world.flags.arrived).toBe(true);
    expect(world.zonesInside).toEqual([0]);
  });
});

describe('determinism (ADR-0021)', () => {
  it('a replay gives the same hash every tick; the inventory and zones are in the hash', () => {
    const runtime = runtimeOf({
      rows: column(WALL_COL, '~'),
      gimmicks: [pickup(7, 3, 'fins'), rock(4)],
      zones: [
        {
          objectId: 9,
          rect: rect(7, FLOOR_ROW),
          trigger: 'onZoneEnter',
          conditions: [],
          actions: [{ setFlag: 'z' }],
        },
      ],
    });
    const frames = [...walk('right', 40), ...walk('left', 80), ...walk('right', 60), ...swing()];
    const world = start(runtime);
    const recorder = new Recorder();
    const hashes = frames.map((frame) => {
      recorder.push(frame);
      step(world, frame, runtime);
      return hashWorld(world);
    });
    const file = recorder.toFile(runtime, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    expect(
      runReplayHeadless(file, runtime, { checkpointEvery: 1 }).checkpoints.map((c) => c.hash),
    ).toEqual(hashes);

    const a = start(runtime);
    const b = start(runtime);
    b.inventory.coin = 1;
    expect(hashWorld(a)).not.toEqual(hashWorld(b));
    b.inventory = {};
    b.zonesInside = [0];
    expect(hashWorld(a)).not.toEqual(hashWorld(b));
  });

  it('GameSession gathers the notices of the ticks of a frame', () => {
    const runtime = runtimeOf({ gimmicks: [pickup(2, SPAWN_COL - 1, 'coin')] });
    const left: InputSource = {
      nextFrame: () => script().hold('left', 1).build(1)[0] as InputFrame,
    };
    const session = new GameSession(
      runtime,
      { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: 'retro' },
      left,
    );
    const seen = Array.from({ length: 20 }, () => session.frame(1000 / 60).notices).flat();
    expect(seen).toEqual([{ kind: 'pickup', itemId: 'coin', count: 1 }]);
    expect(session.uiState.inventory).toEqual([{ id: 'coin', count: 1 }]);
  });
});
