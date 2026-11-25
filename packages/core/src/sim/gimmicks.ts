import type { GimmickPlacement, PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { flagSet } from './blocking';
import { attackHitbox, type FxRect } from './hitbox';
import { giveItem, subjectHasAny } from './items';

/** Something the screen tells the player about, from one tick (ADR-0021). Not in the hash. */
export type Notice = { readonly kind: 'pickup'; readonly itemId: string; readonly count: number };

const overlaps = (a: FxRect, b: FxRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The active character's collision box, Fx. */
export function bodyRect(world: World): FxRect {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return {
    x: (s.x[slot] as number) + (s.colOx[slot] as number),
    y: (s.y[slot] as number) + (s.colOy[slot] as number),
    w: s.colW[slot] as number,
    h: s.colH[slot] as number,
  };
}

/** Whether a gimmick is still there to draw: not picked up, not broken, not opened. */
export function gimmickShown(world: World, g: GimmickPlacement): boolean {
  return g.type === 'switch' || !flagSet(world, g.flag);
}

/**
 * Gimmicks in `interaction` (ADR-0021), in the room's order: the body picks up what it touches,
 * and the sword's hitbox breaks what the gating subject can break and presses switches.
 */
export function gimmickStep(world: World, runtime: PackRuntime, notices: Notice[]): void {
  const gimmicks = runtime.rooms[world.roomId]?.gimmicks;
  if (gimmicks === undefined || gimmicks.length === 0) return;
  const body = bodyRect(world);
  const hit = attackHitbox(world, runtime);
  for (const g of gimmicks) {
    if (flagSet(world, g.flag)) continue;
    if (g.type === 'pickup') {
      if (!overlaps(body, g.rect) || g.itemId === undefined) continue;
      const count = giveItem(world, runtime, g.itemId, g.count ?? 1);
      world.flags[g.flag] = true;
      notices.push({ kind: 'pickup', itemId: g.itemId, count });
    } else if (g.type === 'breakable') {
      if (hit === undefined || !overlaps(hit, g.rect)) continue;
      if (subjectHasAny(world, runtime, g.requiresAnyTag ?? [])) world.flags[g.flag] = true;
    } else if (g.type === 'switch') {
      if (hit !== undefined && overlaps(hit, g.rect)) world.flags[g.flag] = true;
    }
  }
}
