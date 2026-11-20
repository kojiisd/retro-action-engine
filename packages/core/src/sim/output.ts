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

/** An entity's collision box in px (floor), for the debug drawing (ADR-0004, revision M2-3). */
export interface RenderCollider {
  readonly id: number;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RenderSnapshot {
  readonly tick: number;
  /** Top-left of the view in px. Always 0, 0 in M1-5 (one screen per room). */
  readonly camera: { readonly x: number; readonly y: number };
  /** In ascending id order. */
  readonly sprites: readonly RenderSprite[];
  /** Collision boxes of the entities, in ascending id order. Drawn only by the debug display. */
  readonly colliders: readonly RenderCollider[];
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
  const colliders: RenderCollider[] = [];
  if (world.party.members.length > 0) {
    const character = activeCharacter(world, runtime);
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    const anim = world.animation;
    const resolved = resolveAnimation(character, anim.name === '' ? 'idle' : anim.name);
    const sprite = character.sprite;
    const left = (s.x[slot] as number) + (s.colOx[slot] as number);
    const top = (s.y[slot] as number) + (s.colOy[slot] as number);
    colliders.push({
      id: world.party.entityId,
      x: toPxFloor(left),
      y: toPxFloor(top),
      // Width from the floored edges, so the box covers the pixels the body touches.
      w: toPxFloor(left + (s.colW[slot] as number) - 1) - toPxFloor(left) + 1,
      h: toPxFloor(top + (s.colH[slot] as number) - 1) - toPxFloor(top) + 1,
    });
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
  return { tick: world.tick, camera: { x: 0, y: 0 }, sprites, colliders };
}
