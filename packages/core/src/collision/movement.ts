import type { World } from '../world/world';
import type { CollisionContext, CollisionGrid } from './grid';
import { type Body, moveBody } from './move';

/**
 * The `movement` system (docs/architecture.md 4.3): moves every live entity by its velocity and
 * resolves tile collisions, in ascending id order. `contextOf` gives each entity's abilities
 * (from the party in M1-3; enemies have none by default).
 */
export function moveEntities(
  world: World,
  grid: CollisionGrid,
  contextOf: (id: number) => CollisionContext,
): void {
  const s = world.entities;
  for (let slot = 0; slot < s.length; slot++) {
    if (s.alive[slot] !== 1) {
      continue;
    }
    const body: Body = {
      x: s.x[slot] as number,
      y: s.y[slot] as number,
      vx: s.vx[slot] as number,
      vy: s.vy[slot] as number,
      w: s.colW[slot] as number,
      h: s.colH[slot] as number,
      ox: s.colOx[slot] as number,
      oy: s.colOy[slot] as number,
    };
    s.contact[slot] = moveBody(grid, body, contextOf(s.id[slot] as number));
    s.x[slot] = body.x;
    s.y[slot] = body.y;
    s.vx[slot] = body.vx;
    s.vy[slot] = body.vy;
  }
}
