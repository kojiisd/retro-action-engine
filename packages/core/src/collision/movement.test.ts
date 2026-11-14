import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import { buildRoom } from '../test-support';
import { cloneWorld, newWorld, type World } from '../world/world';
import { type CollisionContext, NO_ABILITIES } from './grid';
import { CONTACT_GROUNDED, CONTACT_WALL } from './move';
import { moveEntities } from './movement';

const room = buildRoom(['........', '........', '..~.....', '........', '########'], 16);
const collider = { w: fromPx(8), h: fromPx(8), ox: fromPx(-4), oy: fromPx(-8) };

function worldWithEntities(): World {
  const world = newWorld({ seed: 1, roomId: 'test' });
  world.entities.create({ x: fromPx(8), y: fromPx(48), vx: fromPx(30), collider });
  world.entities.create({ x: fromPx(100), y: fromPx(20), vy: fromPx(60), collider });
  world.entities.create({ x: fromPx(60), y: fromPx(64), vx: fromPx(-5), collider });
  return world;
}

describe('moveEntities', () => {
  it('moves every live entity and stores its contact flags', () => {
    const world = worldWithEntities();
    world.entities.destroy(3);
    moveEntities(world, room, () => NO_ABILITIES);
    const s = world.entities;
    // Entity 1 hits the water tile, which is solid without move:swim.
    expect(s.x[0]).toBe(fromPx(28));
    expect(s.contact[0]).toBe(CONTACT_WALL);
    // Entity 2 lands on the floor.
    expect(s.y[1]).toBe(fromPx(64));
    expect(s.contact[1]).toBe(CONTACT_GROUNDED);
    // The destroyed entity does not move.
    expect(s.x[2]).toBe(fromPx(60));
  });

  it('asks for each entity context by id, in ascending id order', () => {
    const world = worldWithEntities();
    const seen: number[] = [];
    const swimmerIds = new Set([1]);
    const swim: CollisionContext = { abilityTags: new Set(['move:swim']) };
    moveEntities(world, room, (id) => {
      seen.push(id);
      return swimmerIds.has(id) ? swim : NO_ABILITIES;
    });
    expect(seen).toEqual([1, 2, 3]);
    // With move:swim, entity 1 passes the water tile.
    expect(world.entities.x[0]).toBe(fromPx(38));
  });

  it('is deterministic: two runs from the same state give the same hash every tick', () => {
    const a = worldWithEntities();
    const b = cloneWorld(a);
    for (let tick = 0; tick < 60; tick++) {
      for (const w of [a, b]) {
        for (let slot = 0; slot < w.entities.length; slot++) {
          w.entities.vy[slot] = (w.entities.vy[slot] as number) + 64; // gravity-like push
          w.entities.vx[slot] = tick % 20 < 10 ? fromPx(3) : -fromPx(3);
        }
        moveEntities(w, room, () => NO_ABILITIES);
        w.tick++;
      }
      expect(hashWorld(b)).toEqual(hashWorld(a));
    }
  });
});
