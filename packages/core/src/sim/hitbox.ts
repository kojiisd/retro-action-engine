import type { PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { resolveAnimation } from './anim';
import { activeCharacter } from './party';

/** A box in Fx: top-left and size. */
export interface FxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The active character's attack hitbox this tick (ADR-0017), Fx: the frame's box while a swing
 * is on, mirrored for a character facing left. Undefined when no box is out.
 */
export function attackHitbox(world: World, runtime: PackRuntime): FxRect | undefined {
  if (world.party.members.length === 0 || world.tick >= world.controller.attackUntilTick) {
    return undefined;
  }
  const character = activeCharacter(world, runtime);
  const anim = world.animation;
  const resolved = resolveAnimation(character, anim.name === '' ? 'idle' : anim.name);
  if (resolved === undefined || resolved.name !== 'attack') return undefined;
  const box = resolved.def.frames[Math.min(anim.frame, resolved.def.frames.length - 1)]?.hitbox;
  if (box === undefined) return undefined;
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const x = world.controller.facing < 0 ? -(box.x + box.w) : box.x;
  return { x: (s.x[slot] as number) + x, y: (s.y[slot] as number) + box.y, w: box.w, h: box.h };
}
