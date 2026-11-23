import { CONTACT_GROUNDED } from '../collision/move';
import type { AnimationDef, CharacterDef } from '../runtime/pack';
import type { World } from '../world/world';

/**
 * The animation for the movement state of the party entity. These four names are the fixed set
 * core refers to (docs/pack-spec.md 4.1); a sprite without one of them shows `idle` instead.
 */
export function movementAnimation(world: World): 'idle' | 'run' | 'jump' | 'fall' | 'climb' {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  if (world.controller.climbing) return 'climb';
  if (((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0) {
    return (s.vx[slot] as number) !== 0 ? 'run' : 'idle';
  }
  return (s.vy[slot] as number) < 0 ? 'jump' : 'fall';
}

/**
 * How long the character's attack lasts (ADR-0017): the ticks of its `attack` animation, or
 * undefined when it has none (it cannot attack).
 */
export function attackTicks(character: CharacterDef): number | undefined {
  const frames = character.sprite?.animations.attack?.frames;
  if (frames === undefined || frames.length === 0) return undefined;
  let total = 0;
  for (const frame of frames) total += frame.ticks;
  return total;
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
 * wraps, a non-looping one stays on its last frame. An attack (ADR-0017) shows `attack` instead,
 * from frame 0 at the tick it starts (also right after another one).
 */
export function animationStep(world: World, character: CharacterDef): void {
  const anim = world.animation;
  const length = attackTicks(character);
  const until = world.controller.attackUntilTick;
  const attacking = length !== undefined && world.tick < until;
  const resolved = resolveAnimation(character, attacking ? 'attack' : movementAnimation(world));
  if (attacking && until - length === world.tick) {
    // The swing starts now: frame 0 even if the last frame of the previous swing is showing.
    anim.name = '';
  }
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
  // On a ladder the frames move only while the body does (ADR-0019).
  if (
    name === 'climb' &&
    (world.entities.vy[world.entities.slotOf(world.party.entityId)] as number) === 0
  ) {
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
