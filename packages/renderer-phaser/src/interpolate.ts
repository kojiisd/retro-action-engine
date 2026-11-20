import type { RenderCollider, RenderSnapshot, RenderSprite } from '@retro-action-engine/core';

/** How sprites move between two ticks on screen (`FeelProfile.interpolation`). */
export type Interpolation = 'linear' | 'none';

/** A sprite as drawn this display frame: integer px, bottom-center. */
export interface DrawSprite {
  readonly id: number;
  readonly atlas: string;
  readonly frame: string;
  readonly x: number;
  readonly y: number;
  readonly flipX: boolean;
  readonly depth: number;
  readonly visible: boolean;
}

/**
 * Where to draw each sprite of `curr` (ADR-0003). With `linear`, positions are blended from the
 * previous tick by `alpha` and floored to whole pixels; a sprite that is new or `teleported` is
 * drawn where it is. The result is only for drawing: nothing here goes back to the simulation.
 */
export function interpolateSprites(
  prev: RenderSnapshot,
  curr: RenderSnapshot,
  alpha: number,
  mode: Interpolation,
): DrawSprite[] {
  const before = new Map<number, RenderSprite>();
  for (const sprite of prev.sprites) before.set(sprite.id, sprite);
  return curr.sprites.map((sprite) => {
    const from = before.get(sprite.id);
    const blend = mode === 'linear' && from !== undefined && !sprite.teleported;
    return {
      id: sprite.id,
      atlas: sprite.atlas,
      frame: sprite.frame,
      x: blend ? Math.floor(from.x + (sprite.x - from.x) * alpha) : sprite.x,
      y: blend ? Math.floor(from.y + (sprite.y - from.y) * alpha) : sprite.y,
      flipX: sprite.flipX,
      depth: sprite.depth,
      visible: sprite.visible,
    };
  });
}

/**
 * Collision boxes where to draw them (debug display): blended like the sprites, so a box stays on
 * its sprite. Boxes of new entities, or of `teleported` sprites, are drawn where they are.
 */
export function interpolateColliders(
  prev: RenderSnapshot,
  curr: RenderSnapshot,
  alpha: number,
  mode: Interpolation,
): RenderCollider[] {
  const before = new Map<number, RenderCollider>();
  for (const box of prev.colliders) before.set(box.id, box);
  const teleported = new Set(curr.sprites.filter((s) => s.teleported).map((s) => s.id));
  return curr.colliders.map((box) => {
    const from = before.get(box.id);
    if (mode !== 'linear' || from === undefined || teleported.has(box.id)) return { ...box };
    return {
      ...box,
      x: Math.floor(from.x + (box.x - from.x) * alpha),
      y: Math.floor(from.y + (box.y - from.y) * alpha),
    };
  });
}
