import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { nextU32 } from '../fx/rng';
import { cloneWorld, newWorld, type World } from '../world/world';
import { Hasher, hashWorld } from './hash';

function sampleWorld(): World {
  const world = newWorld({ seed: 1234, roomId: 'room-a' });
  world.tick = 42;
  world.flags = { opened: true, coins: 3 };
  const collider = { w: fromPx(12), h: fromPx(14), ox: fromPx(-6), oy: fromPx(-14) };
  world.entities.create({ x: fromPx(32), y: fromPx(48), vx: 64, collider });
  world.entities.create({ x: fromPx(80), y: fromPx(48), collider });
  return world;
}

describe('hashWorld', () => {
  it('returns the same value for the same World and for a deep copy', () => {
    const world = sampleWorld();
    expect(hashWorld(world)).toEqual(hashWorld(world));
    expect(hashWorld(cloneWorld(world))).toEqual(hashWorld(world));
    expect(hashWorld(sampleWorld())).toEqual(hashWorld(world));
  });

  it('returns two uint32 lanes', () => {
    for (const lane of hashWorld(sampleWorld())) {
      expect(Number.isInteger(lane) && lane >= 0 && lane < 2 ** 32).toBe(true);
    }
  });

  const mutations: Record<string, (w: World) => void> = {
    tick: (w) => {
      w.tick += 1;
    },
    rng: (w) => {
      nextU32(w);
    },
    roomId: (w) => {
      w.roomId = 'room-b';
    },
    'party member': (w) => {
      w.party.members.push('extra');
    },
    'party cooldown': (w) => {
      w.party.cooldownTicks = 3;
    },
    'controller jump buffer': (w) => {
      w.controller.jumpPressedTick = 5;
    },
    'controller jump cut': (w) => {
      w.controller.jumpCut = true;
    },
    'flag value': (w) => {
      w.flags.coins = 4;
    },
    'flag type (1 vs true)': (w) => {
      w.flags.opened = 1;
    },
    'new flag': (w) => {
      w.flags.extra = false;
    },
    'entity x by 1/256 px': (w) => {
      w.entities.x[1] = (w.entities.x[1] as number) + 1;
    },
    'entity vy': (w) => {
      w.entities.vy[0] = 1;
    },
    'entity contact': (w) => {
      w.entities.contact[0] = 1;
    },
    'entity removed': (w) => {
      w.entities.destroy(2);
    },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    it(`changes when one field changes: ${name}`, () => {
      const world = sampleWorld();
      const before = hashWorld(world);
      mutate(world);
      expect(hashWorld(world)).not.toEqual(before);
    });
  }

  it('does not depend on flag insertion order', () => {
    const a = sampleWorld();
    const b = sampleWorld();
    b.flags = { coins: 3, opened: true };
    expect(hashWorld(b)).toEqual(hashWorld(a));
  });

  it('does not change when tombstones are compacted', () => {
    const world = sampleWorld();
    world.entities.destroy(1);
    const before = hashWorld(world);
    world.entities.compact();
    expect(hashWorld(world)).toEqual(before);
  });
});

describe('Hasher', () => {
  it('matches the FNV-1a reference on the standard lane', () => {
    // FNV-1a 32-bit of "a" is 0xe40c292c.
    expect(new Hasher().byte(0x61).digest()[0]).toBe(0xe40c292c);
  });

  it('separates strings by length', () => {
    const ab = new Hasher().string('a').string('b').digest();
    const abJoined = new Hasher().string('ab').string('').digest();
    expect(ab).not.toEqual(abJoined);
  });

  it('rejects values that are not 32-bit integers', () => {
    expect(() => new Hasher().int32(0.5)).toThrow(RangeError);
    expect(() => new Hasher().int32(2 ** 32)).toThrow(RangeError);
  });
});
