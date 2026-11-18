import { type ActionId, actionBit, type TouchLayout } from '@retro-action-engine/core';

/** Touch targets are this much larger than they look (docs/input-and-feel.md 9.3). */
export const TOUCH_HIT_SCALE = 1.2;
/** Extra degrees a d-pad direction keeps on each side before it changes (9.2). */
export const DPAD_HYSTERESIS_DEG = 10;

const SECTOR_DEG = 45;

export interface Circle {
  /** Center and radius in px, relative to the top-left of the pad area. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface PlacedButton extends Circle {
  readonly action: ActionId;
}

/** A layout placed in a pad area of a given size, in px. */
export interface PlacedLayout {
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly dpad: Circle & { readonly deadzone: number; readonly floating: boolean };
  readonly buttons: readonly PlacedButton[];
}

/**
 * Keeps a circle's touch area (radius `r` times `TOUCH_HIT_SCALE`) inside 0..size, so it never
 * touches the screen edge; centered when it cannot fit.
 */
function clampCenter(value: number, r: number, size: number): number {
  const reach = r * TOUCH_HIT_SCALE;
  if (size <= 2 * reach) return size / 2;
  return Math.min(Math.max(value, reach), size - reach);
}

/**
 * Places a layout in a pad area of `width` x `height` px (docs/input-and-feel.md 9.1): ratios to
 * px, `left` handedness mirrored, and every circle (with its touch area) pulled inside the area.
 */
export function placeLayout(layout: TouchLayout, width: number, height: number): PlacedLayout {
  const short = Math.min(width, height);
  const place = (cx: number, cy: number, radius: number): Circle => {
    const r = radius * short;
    const x = (layout.handedness === 'left' ? 1 - cx : cx) * width;
    return { x: clampCenter(x, r, width), y: clampCenter(cy * height, r, height), r };
  };
  const dpad = place(layout.dpad.cx, layout.dpad.cy, layout.dpad.radius);
  return {
    width,
    height,
    opacity: layout.opacity,
    dpad: { ...dpad, deadzone: dpad.r * layout.dpad.deadzoneRatio, floating: layout.dpad.floating },
    buttons: layout.buttons.map((b) => ({ ...place(b.cx, b.cy, b.radius), action: b.action })),
  };
}

/** True when (x, y) is inside the touch area of the circle (1.2 times what is drawn). */
export function inTouchArea(circle: Circle, x: number, y: number): boolean {
  const r = circle.r * TOUCH_HIT_SCALE;
  return (x - circle.x) ** 2 + (y - circle.y) ** 2 <= r * r;
}

/**
 * The button under (x, y), as an index into `buttons`, among those `enabled` allows. Where touch
 * areas overlap, the button whose center is nearest relative to its size wins; then the lower
 * index.
 */
export function buttonAt(
  buttons: readonly PlacedButton[],
  x: number,
  y: number,
  enabled: (action: ActionId) => boolean = () => true,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  buttons.forEach((b, i) => {
    if (!enabled(b.action) || !inTouchArea(b, x, y)) return;
    const distance = Math.hypot(x - b.x, y - b.y) / b.r;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * The d-pad direction for an offset (dx, dy) from its center (docs/input-and-feel.md 9.2): one
 * of 8 sectors, 0 = right, then clockwise on screen (y grows downward): 1 down-right, 2 down,
 * 3 down-left, 4 left, 5 up-left, 6 up, 7 up-right. `undefined` inside the deadzone. The
 * previous sector is kept until the angle is more than `DPAD_HYSTERESIS_DEG` past its edge.
 */
export function dpadSector(
  dx: number,
  dy: number,
  deadzone: number,
  previous: number | undefined,
): number | undefined {
  if (Math.hypot(dx, dy) < deadzone) return undefined;
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  if (previous !== undefined) {
    const center = previous * SECTOR_DEG;
    const away = Math.abs(((angle - center + 540) % 360) - 180);
    if (away <= SECTOR_DEG / 2 + DPAD_HYSTERESIS_DEG) return previous;
  }
  return Math.floor((angle + SECTOR_DEG / 2) / SECTOR_DEG) % 8;
}

const SECTOR_ACTIONS: ReadonlyArray<readonly ActionId[]> = [
  ['right'],
  ['right', 'down'],
  ['down'],
  ['left', 'down'],
  ['left'],
  ['left', 'up'],
  ['up'],
  ['right', 'up'],
];

/** The actions a d-pad sector holds. */
export function sectorMask(sector: number | undefined): number {
  if (sector === undefined) return 0;
  let mask = 0;
  for (const action of SECTOR_ACTIONS[sector] ?? []) mask |= actionBit(action);
  return mask;
}
