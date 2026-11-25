import { toPxFloor } from '../fx/fx';
import type { PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { resolveAnimation } from './anim';
import { flagSet } from './blocking';
import { gimmickShown } from './gimmicks';
import { attackHitbox } from './hitbox';
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
  /** The room to draw (ADR-0018): its tiles change with it. */
  readonly room: string;
  /** Top-left of the view in room px (ADR-0009). */
  readonly camera: { readonly x: number; readonly y: number };
  /**
   * In ascending id order. The room's gimmicks (ADR-0021) come first, with negative ids
   * (-1 - their index in the room), behind the entities.
   */
  readonly sprites: readonly RenderSprite[];
  /** Collision boxes of the entities, in ascending id order. Drawn only by the debug display. */
  readonly colliders: readonly RenderCollider[];
  /** Attack hitboxes out this tick (ADR-0017), in ascending id order. Debug display only. */
  readonly hitboxes: readonly RenderCollider[];
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
  const sprites: RenderSprite[] = gimmickSprites(world, runtime);
  const colliders: RenderCollider[] = [];
  const hitboxes: RenderCollider[] = [];
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
      // The frame's hitbox while a swing is on, mirrored for a character facing left.
      const box = attackHitbox(world, runtime);
      if (box !== undefined) {
        hitboxes.push({
          id: world.party.entityId,
          x: toPxFloor(box.x),
          y: toPxFloor(box.y),
          w: toPxFloor(box.x + box.w - 1) - toPxFloor(box.x) + 1,
          h: toPxFloor(box.y + box.h - 1) - toPxFloor(box.y) + 1,
        });
      }
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
  return {
    tick: world.tick,
    room: world.roomId,
    camera: { x: world.camera.x, y: world.camera.y },
    sprites,
    colliders,
    hitboxes,
  };
}

/** Depth of gimmick sprites: behind the entities (depth 0). */
const GIMMICK_DEPTH = -1;

/** The gimmicks still there in the room, drawn at the bottom-center of their box (ADR-0021). */
function gimmickSprites(world: World, runtime: PackRuntime): RenderSprite[] {
  const gimmicks = runtime.rooms[world.roomId]?.gimmicks ?? [];
  const out: RenderSprite[] = [];
  for (let index = gimmicks.length - 1; index >= 0; index--) {
    const g = gimmicks[index] as (typeof gimmicks)[number];
    const ref = g.type === 'switch' && flagSet(world, g.flag) ? (g.spriteOn ?? g.sprite) : g.sprite;
    if (ref === undefined || !gimmickShown(world, g)) continue;
    out.push({
      id: -1 - index,
      atlas: ref.atlas,
      frame: ref.frame,
      x: toPxFloor(g.rect.x + (g.rect.w >> 1)),
      y: toPxFloor(g.rect.y + g.rect.h),
      flipX: false,
      depth: GIMMICK_DEPTH,
      visible: true,
      // They never move: nothing to interpolate, in this room or the one before.
      teleported: true,
    });
  }
  return out;
}
