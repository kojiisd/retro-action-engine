import { CONTACT_GROUNDED } from '../collision/move';
import type { AnimationDef, CharacterDef } from '../runtime/pack';
import type { World } from '../world/world';

/**
 * The animation for the movement state of the party entity. These four names are the fixed set
 * core refers to (docs/pack-spec.md 4.1); a sprite without one of them shows `idle` instead.
 */
export function movementAnimation(world: World): 'idle' | 'run' | 'jump' | 'fall' {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  if (((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0) {
    return (s.vx[slot] as number) !== 0 ? 'run' : 'idle';
  }
  return (s.vy[slot] as number) < 0 ? 'jump' : 'fall';
}

/** The animation `name` resolves to for this character, or undefined without a sprite. */
export function resolveAnimation(
  character: CharacterDef,
  name: string,
): { name: string; def: AnimationDef } | undefined {
  const animations = character.sprite?.animations;
  if (animations === undefined) return undefined;
  const def = animations[name];
  if (def !== undefined && def.frames.length > 0) return { name, def };
  const idle = animations.idle;
  if (idle !== undefined && idle.frames.length > 0) return { name: 'idle', def: idle };
  return undefined;
}

/**
 * Part of the `timers` system (docs/architecture.md 4.3): picks the animation from the state
 * after movement and advances it by one tick. A new animation starts at frame 0; a looping one
 * wraps, a non-looping one stays on its last frame.
 */
export function animationStep(world: World, character: CharacterDef): void {
  const anim = world.animation;
  const resolved = resolveAnimation(character, movementAnimation(world));
  if (resolved === undefined) {
    anim.name = '';
    anim.frame = 0;
    anim.ticks = 0;
    return;
  }
  const { name, def } = resolved;
  if (name !== anim.name || anim.frame >= def.frames.length) {
    anim.name = name;
    anim.frame = 0;
    anim.ticks = 0;
    return;
  }
  anim.ticks++;
  const frame = def.frames[anim.frame] as { ticks: number };
  if (anim.ticks >= frame.ticks) {
    anim.ticks = 0;
    if (anim.frame + 1 < def.frames.length) {
      anim.frame++;
    } else if (def.loop) {
      anim.frame = 0;
    }
  }
}
