// HP, HP-draining tiles and media (ADR-0016). Expectations come from the fixture's values, never
// fixed numbers (CLAUDE.md, ADR-0012). The names here (acid, goo) are fictional test data.
import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { script } from '../replay/script';
import { activeFeel, type FeelMedium } from '../runtime/feel';
import type { CharacterDef, HazardDef, PackRuntime } from '../runtime/pack';
import type { TileClass } from '../runtime/tile';
import {
  boxRoom,
  MODERN,
  pxToFx,
  RETRO,
  SWIMMER,
  simRuntime,
  TEST_TILE_CLASSES,
  WALKER,
} from '../test-support';
import { cloneWorld, type World } from '../world/world';
import { createWorld, currentFeel, type StepOutput, step } from './sim';

const T = 16;
const POOL = 9;
const POOL_CLASS: TileClass = { id: POOL, solid: 'none', hazard: 'acid', medium: 'goo' };

const ACID: HazardDef = {
  damage: 1,
  intervalTicks: 12,
  byTag: [{ anyTag: ['move:swim'], intervalTicks: 40 }],
};

const GOO: FeelMedium = {
  gravity: pxToFx(0.05),
  maxFallSpeed: pxToFx(0.75),
  jumpVelocity: pxToFx(1.5),
  runSpeed: pxToFx(0.75),
  swim: true,
};

// A sprite, so that the render snapshot has one to mark as `teleported`.
const sprite = {
  atlas: 'a',
  animations: { idle: { frames: [{ frame: 'f', ticks: 1 }], loop: true } },
};
const WALKER_HP = 3;
const SWIMMER_HP = 5;
const walker: CharacterDef = { ...WALKER, hp: { max: WALKER_HP }, sprite };
const swimmer: CharacterDef = { ...SWIMMER, hp: { max: SWIMMER_HP }, sprite };

interface Options {
  /** Pool cells [col, row]. */
  readonly pool?: ReadonlyArray<readonly [number, number]>;
  readonly members?: readonly string[];
  readonly onDeath?: 'switchToAlive' | 'respawnAtSavePoint';
  readonly placement?: 'same' | 'spawn';
  readonly media?: boolean;
  readonly hp?: boolean;
}

const W = 14;
const H = 8;
/** Spawn tile: the character stands on the floor at column 3. */
const SPAWN = [3, H - 2] as const;

function runtimeWith(options: Options = {}): PackRuntime {
  const base = simRuntime({
    rows: boxRoom(W, H),
    spawn: SPAWN,
    members: options.members ?? ['walker'],
    switchRules: { placement: options.placement ?? 'same', cooldownTicks: 5 },
  });
  const room = base.rooms.room as NonNullable<(typeof base.rooms)['room']>;
  const collision = new Uint16Array(room.collision);
  for (const [col, row] of options.pool ?? []) collision[row * W + col] = POOL;
  const media = options.media === false ? {} : { media: { goo: GOO } };
  return {
    ...base,
    rooms: { room: { ...room, collision, tileClasses: [...TEST_TILE_CLASSES, POOL_CLASS] } },
    characters: { walker, swimmer },
    feel: { retro: { ...RETRO, ...media }, modern: { ...MODERN, ...media } },
    rules: {
      ...base.rules,
      ...(options.hp === false
        ? {}
        : {
            hp: {
              scope: 'perCharacter',
              onDeath: options.onDeath ?? 'switchToAlive',
              onAllDown: 'respawnAtSavePoint',
            },
            hazards: { acid: ACID },
          }),
    },
  };
}

/** Every inner cell from column `from` to `to`, all rows above the floor. */
function poolColumns(from: number, to: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let col = from; col <= to; col++) {
    for (let row = 1; row < H - 1; row++) cells.push([col, row]);
  }
  return cells;
}

function start(runtime: PackRuntime, profile = 'retro'): World {
  return createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: profile });
}

function run(world: World, runtime: PackRuntime, frames: readonly InputFrame[]): StepOutput[] {
  return frames.map((frame) => step(world, frame, runtime));
}

/** Exactly `ticks` frames without input. */
const idle = (ticks: number) => script().build(ticks);

describe('HP-draining tiles', () => {
  it('drain HP at the kind interval, and slower for a character with a matching tag', () => {
    for (const [member, interval] of [
      ['walker', ACID.intervalTicks],
      ['swimmer', ACID.byTag?.[0]?.intervalTicks as number],
    ] as const) {
      const runtime = runtimeWith({ pool: poolColumns(1, W - 2), members: [member] });
      const world = start(runtime);
      const max = runtime.characters[member]?.hp?.max as number;
      const out = run(world, runtime, idle(interval * 2));
      // The first damage comes `interval` ticks after entering (the start counts as entering).
      expect(out[interval - 2]?.ui.party[0]?.hp).toBe(max);
      expect(out[interval - 1]?.ui.party[0]?.hp).toBe(max - ACID.damage);
      expect(out[interval * 2 - 1]?.ui.party[0]?.hp).toBe(max - 2 * ACID.damage);
    }
  });

  it('do nothing outside, and start counting again after leaving', () => {
    const runtime = runtimeWith({ pool: poolColumns(6, 8), members: ['walker'] });
    const world = start(runtime);
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    const inside = fromPx(7 * T + T / 2);
    const outside = s.x[slot] as number;
    const at = (x: number, ticks: number) => {
      s.x[slot] = x;
      for (let i = 0; i < ticks; i++) step(world, idle(1)[0] as InputFrame, runtime);
    };
    at(outside, ACID.intervalTicks * 3);
    expect(world.party.hp).toEqual([3]);
    // Twice almost a full interval inside, with one tick outside in between: no damage.
    at(inside, ACID.intervalTicks - 1);
    at(outside, 1);
    at(inside, ACID.intervalTicks - 1);
    expect(world.party.hp).toEqual([3]);
    at(inside, 1);
    expect(world.party.hp).toEqual([3 - ACID.damage]);
  });

  it('are ignored without HP rules', () => {
    const runtime = runtimeWith({ pool: poolColumns(1, W - 2), hp: false });
    const world = start(runtime);
    const out = run(world, runtime, idle(ACID.intervalTicks * 3));
    expect(world.party.hp).toEqual([]);
    expect(out.at(-1)?.ui.party).toEqual([]);
  });
});

describe('when HP reaches 0', () => {
  it('switches to the next living member, in place, and never back to the downed one', () => {
    const runtime = runtimeWith({ pool: poolColumns(1, W - 2), members: ['walker', 'swimmer'] });
    const world = start(runtime);
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    const x0 = s.x[slot];
    const down = ACID.intervalTicks * WALKER_HP;
    const out = run(world, runtime, idle(down));
    expect(out[down - 2]?.ui.activeCharacterId).toBe('walker');
    expect(out[down - 1]?.ui).toMatchObject({
      activeCharacterId: 'swimmer',
      party: [
        { id: 'walker', hp: 0, hpMax: WALKER_HP, alive: false },
        { id: 'swimmer', hp: SWIMMER_HP, hpMax: SWIMMER_HP, alive: true },
      ],
    });
    expect(s.x[slot]).toBe(x0);
    expect(out[down - 1]?.render.sprites[0]?.teleported).toBe(false);
    // A switch request finds no other living member: nothing switches, not even for a tick (a
    // switch would start the cooldown again).
    run(world, runtime, idle(10));
    expect(world.party.cooldownTicks).toBe(0);
    run(world, runtime, script().hold('switch', 1).build(1));
    expect(world.party.activeIndex).toBe(1);
    expect(world.party.cooldownTicks).toBe(0);
  });

  it('moves to the entry with placement "spawn"', () => {
    const runtime = runtimeWith({
      pool: poolColumns(5, 7),
      members: ['walker', 'swimmer'],
      placement: 'spawn',
    });
    const world = start(runtime);
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    s.x[slot] = fromPx(6 * T + T / 2);
    const out = run(world, runtime, idle(ACID.intervalTicks * WALKER_HP));
    expect(world.party.activeIndex).toBe(1);
    expect([s.x[slot], s.y[slot]]).toEqual([world.party.spawnX, world.party.spawnY]);
    expect(out.at(-1)?.render.sprites[0]?.teleported).toBe(true);
  });

  it('brings everyone back at the entry with full HP when no one is left', () => {
    for (const onDeath of ['switchToAlive', 'respawnAtSavePoint'] as const) {
      const runtime = runtimeWith({ pool: poolColumns(5, 7), members: ['walker'], onDeath });
      const world = start(runtime);
      const s = world.entities;
      const slot = s.slotOf(world.party.entityId);
      s.x[slot] = fromPx(6 * T + T / 2);
      const down = ACID.intervalTicks * WALKER_HP;
      const out = run(world, runtime, idle(down));
      expect(world.party.hp).toEqual([WALKER_HP]);
      expect([s.x[slot], s.y[slot], s.vx[slot], s.vy[slot]]).toEqual([
        world.party.spawnX,
        world.party.spawnY,
        0,
        0,
      ]);
      expect(out.at(-1)?.render.sprites[0]?.teleported).toBe(true);
      // Standing on the floor again at once.
      expect((s.contact[slot] as number) & CONTACT_GROUNDED).not.toBe(0);
      expect(world.party.hazardTicks).toBe(0);
    }
  });

  it('with "respawnAtSavePoint", does not switch even with a living member', () => {
    const runtime = runtimeWith({
      pool: poolColumns(5, 7),
      members: ['walker', 'swimmer'],
      onDeath: 'respawnAtSavePoint',
    });
    const world = start(runtime);
    const s = world.entities;
    s.x[s.slotOf(world.party.entityId)] = fromPx(6 * T + T / 2);
    run(world, runtime, idle(ACID.intervalTicks * WALKER_HP));
    expect(world.party.activeIndex).toBe(0);
    expect(world.party.hp).toEqual([WALKER_HP, SWIMMER_HP]);
  });
});

describe('media', () => {
  it('layer profile, then character, then medium', () => {
    const feel = activeFeel({ ...RETRO, media: { goo: GOO } }, { runSpeed: pxToFx(3) }, 'goo');
    expect(feel.runSpeed).toBe(GOO.runSpeed);
    expect(feel.gravity).toBe(GOO.gravity);
    expect(feel.swim).toBe(true);
    const dry = activeFeel({ ...RETRO, media: { goo: GOO } }, { runSpeed: pxToFx(3) }, undefined);
    expect([dry.runSpeed, dry.gravity, dry.swim]).toEqual([pxToFx(3), RETRO.gravity, false]);
    expect(activeFeel(RETRO, undefined, 'goo').swim).toBe(false);
  });

  for (const profile of ['retro', 'modern'] as const) {
    it(`swims in a medium with "swim" (${profile}): strokes without ground, slow sinking`, () => {
      // A deep pool from the ceiling to the floor; no HP rules, to watch the motion only.
      const runtime = runtimeWith({ pool: poolColumns(1, W - 2), hp: false });
      const world = start(runtime, profile);
      expect(currentFeel(world, runtime).swim).toBe(true);
      const s = world.entities;
      const slot = s.slotOf(world.party.entityId);
      // Two strokes 10 ticks apart: the second one starts again with the medium's speed.
      run(world, runtime, script().hold('jump', 1).build(10));
      expect((s.contact[slot] as number) & CONTACT_GROUNDED).toBe(0);
      run(world, runtime, script().hold('jump', 1).build(1));
      expect(s.vy[slot]).toBe(-(GOO.jumpVelocity as number) + (GOO.gravity as number));
      // Sinking never goes faster than the medium allows.
      let fastest = 0;
      for (let i = 0; i < 120; i++) {
        step(world, idle(1)[0] as InputFrame, runtime);
        fastest = Math.max(fastest, s.vy[slot] as number);
      }
      expect(fastest).toBe(GOO.maxFallSpeed);
    });
  }

  it('changes nothing for a profile without the medium', () => {
    const runtime = runtimeWith({ pool: poolColumns(1, W - 2), hp: false, media: false });
    const world = start(runtime);
    expect(currentFeel(world, runtime)).toMatchObject({ swim: false, gravity: RETRO.gravity });
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    run(world, runtime, script().hold('jump', 1).wait(9).hold('jump', 1).build(11));
    // Retro allows no second jump in the air.
    expect(s.vy[slot]).toBeGreaterThan(-RETRO.jumpVelocity + RETRO.gravity);
  });
});

describe('determinism', () => {
  it('gives the same hashes for the same run, through damage, switching and coming back', () => {
    const runtime = runtimeWith({ pool: poolColumns(2, 6), members: ['walker', 'swimmer'] });
    const frames = script()
      .hold('right', 20)
      .hold('jump', 1)
      .wait(200)
      .hold('switch', 1)
      .hold('left', 30)
      .wait(400)
      .build();
    const hashes = () => {
      const world = start(runtime);
      return frames.map((frame) => {
        step(world, frame, runtime);
        return hashWorld(world).join(':');
      });
    };
    const a = hashes();
    expect(hashes()).toEqual(a);
  });

  it('copies HP with the World, and the hash sees it', () => {
    const runtime = runtimeWith({ members: ['walker', 'swimmer'] });
    const world = start(runtime);
    const copy = cloneWorld(world);
    expect(hashWorld(copy)).toEqual(hashWorld(world));
    copy.party.hp[1] = 1;
    expect(world.party.hp[1]).toBe(SWIMMER_HP);
    expect(hashWorld(copy)).not.toEqual(hashWorld(world));
  });
});
