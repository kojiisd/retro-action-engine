import type { RenderSnapshot, RenderSprite } from '@retro-action-engine/core';

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
