import type { ActionId, TouchLayout } from '@retro-action-engine/core';
import { inTouchArea, type PlacedLayout, TOUCH_HIT_SCALE } from './touch-geometry';

/**
 * The user's changes to a pack's touch layout (docs/input-and-feel.md 9.5). Buttons are keyed
 * by action, so a pack that adds or drops a button still works: a new button is at the pack's
 * place, and a dropped one is ignored. Ratios are the same as in `TouchLayout`.
 */
export interface TouchLayoutOverride {
  readonly handedness?: 'right' | 'left';
  readonly opacity?: number;
  readonly dpad?: {
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
    readonly floating: boolean;
  };
  readonly buttons?: Partial<Record<ActionId, { cx: number; cy: number; radius: number }>>;
}

/** One movable part of the pad: the d-pad, or the button of an action. */
export type TouchPart = 'dpad' | ActionId;

/** Sizes the user can choose, as a ratio of the pack's own size of that part. */
export const TOUCH_SIZE_MIN = 0.5;
export const TOUCH_SIZE_MAX = 2;
/** The palest the pad may be made, so that it never disappears. */
export const TOUCH_OPACITY_MIN = 0.15;
/** The largest radius a layout may have (the pack schema's bound). */
const RADIUS_MAX = 0.5;

/** Ratios are kept to 4 places: enough for any screen, and tidy when saved. */
const tidy = (v: number) => Math.round(v * 10_000) / 10_000;
const clamp = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);

/** The pack's layout with the user's changes on top. */
export function applyTouchOverride(
  base: TouchLayout,
  override: TouchLayoutOverride | undefined,
): TouchLayout {
  if (override === undefined) return base;
  return {
    handedness: override.handedness ?? base.handedness,
    opacity: override.opacity ?? base.opacity,
    dpad:
      override.dpad === undefined
        ? base.dpad
        : { ...override.dpad, deadzoneRatio: base.dpad.deadzoneRatio },
    buttons: base.buttons.map((b) => {
      const o = override.buttons?.[b.action];
      return o === undefined ? b : { action: b.action, cx: o.cx, cy: o.cy, radius: o.radius };
    }),
  };
}

/** The override that turns `base` into `edited` (every user-editable value, for every part). */
export function touchOverrideOf(edited: TouchLayout): TouchLayoutOverride {
  const buttons: Partial<Record<ActionId, { cx: number; cy: number; radius: number }>> = {};
  for (const b of edited.buttons) buttons[b.action] = { cx: b.cx, cy: b.cy, radius: b.radius };
  const { cx, cy, radius, floating } = edited.dpad;
  return {
    handedness: edited.handedness,
    opacity: edited.opacity,
    dpad: { cx, cy, radius, floating },
    buttons,
  };
}

/**
 * The part under (x, y) in a placed layout, whatever is enabled (the editor shows every part).
 * Buttons are above the d-pad; among overlapping buttons the later one (drawn on top) wins.
 */
export function touchPartAt(placed: PlacedLayout, x: number, y: number): TouchPart | undefined {
  for (let i = placed.buttons.length - 1; i >= 0; i--) {
    const b = placed.buttons[i];
    if (b !== undefined && inTouchArea(b, x, y)) return b.action;
  }
  return inTouchArea(placed.dpad, x, y) ? 'dpad' : undefined;
}

function radiusOf(layout: TouchLayout, part: TouchPart): number | undefined {
  if (part === 'dpad') return layout.dpad.radius;
  return layout.buttons.find((b) => b.action === part)?.radius;
}

function withPart(
  layout: TouchLayout,
  part: TouchPart,
  change: { cx: number; cy: number; radius: number },
): TouchLayout {
  if (part === 'dpad') return { ...layout, dpad: { ...layout.dpad, ...change } };
  return {
    ...layout,
    buttons: layout.buttons.map((b) => (b.action === part ? { ...b, ...change } : b)),
  };
}

/**
 * Moves a part's center to (x, y) px in a pad area of `width` x `height`. The center is kept
 * where `placeLayout` would draw it (its touch area inside the pad area), so what is saved is
 * what is seen; with `left` handedness the ratio is mirrored back.
 */
export function moveTouchPart(
  layout: TouchLayout,
  part: TouchPart,
  x: number,
  y: number,
  width: number,
  height: number,
): TouchLayout {
  const radius = radiusOf(layout, part);
  if (radius === undefined || width <= 0 || height <= 0) return layout;
  const reach = radius * Math.min(width, height) * TOUCH_HIT_SCALE;
  const inside = (v: number, size: number) =>
    size <= 2 * reach ? size / 2 : clamp(v, reach, size - reach);
  const rx = inside(x, width) / width;
  const ry = inside(y, height) / height;
  const cx = tidy(layout.handedness === 'left' ? 1 - rx : rx);
  return withPart(layout, part, { cx, cy: tidy(ry), radius });
}

/** The current size of a part as a ratio of the pack's size (`base`). */
export function touchPartScale(base: TouchLayout, layout: TouchLayout, part: TouchPart): number {
  const from = radiusOf(base, part);
  const now = radiusOf(layout, part);
  return from === undefined || now === undefined ? 1 : now / from;
}

/**
 * Sets a part's size to `scale` times the pack's (`base`), within `TOUCH_SIZE_MIN` and
 * `TOUCH_SIZE_MAX` and the largest radius a layout may have. The center stays.
 */
export function resizeTouchPart(
  base: TouchLayout,
  layout: TouchLayout,
  part: TouchPart,
  scale: number,
): TouchLayout {
  const from = radiusOf(base, part);
  const at = part === 'dpad' ? layout.dpad : layout.buttons.find((b) => b.action === part);
  if (from === undefined || at === undefined) return layout;
  const radius = tidy(Math.min(from * clamp(scale, TOUCH_SIZE_MIN, TOUCH_SIZE_MAX), RADIUS_MAX));
  return withPart(layout, part, { cx: at.cx, cy: at.cy, radius });
}

/** Sets how see-through the pad is over the game screen, never below `TOUCH_OPACITY_MIN`. */
export function setTouchOpacity(layout: TouchLayout, opacity: number): TouchLayout {
  return { ...layout, opacity: tidy(clamp(opacity, TOUCH_OPACITY_MIN, 1)) };
}

/**
 * Swaps left and right. What is on screen moves to the other side; the ratios stay (they are
 * mirrored when the layout is placed).
 */
export function setTouchHandedness(layout: TouchLayout, handedness: 'right' | 'left'): TouchLayout {
  return { ...layout, handedness };
}

export function setTouchFloating(layout: TouchLayout, floating: boolean): TouchLayout {
  return { ...layout, dpad: { ...layout.dpad, floating } };
}
