import { toPxFloor } from '../fx/fx';
import type { PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { resolveAnimation } from './anim';
import { activeCharacter } from './party';

/**
 * One sprite to draw (docs/architecture.md 6). Integers and strings only, in a new object every
 * tick, so the renderer can never reach back into the World.
 */
export interface RenderSprite {
  readonly id: number;
  readonly atlas: string;
  readonly frame: string;
  /** Bottom-center position in px (floor). */
  readonly x: number;
  readonly y: number;
  readonly flipX: boolean;
  readonly depth: number;
  readonly visible: boolean;
  /** Moved without travelling this tick: do not interpolate from the previous position. */
  readonly teleported: boolean;
}

export interface RenderSnapshot {
  readonly tick: number;
  /** Top-left of the view in px. Always 0, 0 in M1-5 (one screen per room). */
  readonly camera: { readonly x: number; readonly y: number };
  /** In ascending id order. */
  readonly sprites: readonly RenderSprite[];
}

/**
 * The `output` system (docs/architecture.md 4.3): what the renderer draws for this World. It
 * reads the World and never writes to it.
 */
export function renderSnapshot(
  world: World,
  runtime: PackRuntime,
  teleported = false,
): RenderSnapshot {
  const sprites: RenderSprite[] = [];
  if (world.party.members.length > 0) {
    const character = activeCharacter(world, runtime);
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    const anim = world.animation;
    const resolved = resolveAnimation(character, anim.name === '' ? 'idle' : anim.name);
    const sprite = character.sprite;
    if (sprite !== undefined && resolved !== undefined) {
      const frame = resolved.def.frames[Math.min(anim.frame, resolved.def.frames.length - 1)];
      sprites.push({
        id: world.party.entityId,
        atlas: sprite.atlas,
        frame: (frame as { frame: string }).frame,
        x: toPxFloor(s.x[slot] as number),
        y: toPxFloor(s.y[slot] as number),
        flipX: world.controller.facing < 0,
        depth: 0,
        visible: true,
        teleported,
      });
    }
  }
  return { tick: world.tick, camera: { x: 0, y: 0 }, sprites };
}
