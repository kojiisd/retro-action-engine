import type { TouchLayout } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { placeLayout, TOUCH_HIT_SCALE } from './touch-geometry';
import {
  applyTouchOverride,
  moveTouchPart,
  resizeTouchPart,
  setTouchFloating,
  setTouchHandedness,
  setTouchOpacity,
  TOUCH_OPACITY_MIN,
  TOUCH_SIZE_MAX,
  TOUCH_SIZE_MIN,
  touchOverrideOf,
  touchPartAt,
  touchPartScale,
} from './touch-layout-edit';

// A fictional layout for tests (a pack provides its own in input.json).
const BASE: TouchLayout = {
  handedness: 'right',
  opacity: 0.5,
  dpad: { cx: 0.2, cy: 0.6, radius: 0.25, deadzoneRatio: 0.2, floating: false },
  buttons: [
    { action: 'jump', cx: 0.85, cy: 0.7, radius: 0.1 },
    { action: 'switch', cx: 0.65, cy: 0.7, radius: 0.1 },
  ],
};
// An 800 x 400 pad area: short side 400.
const W = 800;
const H = 400;

const jumpOf = (layout: TouchLayout) => layout.buttons.find((b) => b.action === 'jump');

describe('applyTouchOverride and touchOverrideOf', () => {
  it('gives the pack layout without an override', () => {
    expect(applyTouchOverride(BASE, undefined)).toBe(BASE);
    expect(applyTouchOverride(BASE, {})).toEqual(BASE);
  });

  it('round-trips an edited layout through its override', () => {
    let edited = moveTouchPart(BASE, 'jump', 400, 100, W, H);
    edited = resizeTouchPart(BASE, edited, 'dpad', 1.5);
    edited = setTouchOpacity(setTouchHandedness(setTouchFloating(edited, true), 'left'), 0.8);
    const override = touchOverrideOf(edited);
    // Through JSON, as it is saved.
    const saved = JSON.parse(JSON.stringify(override));
    expect(applyTouchOverride(BASE, saved)).toEqual(edited);
  });

  it('keeps the pack deadzone, and buttons the override does not know', () => {
    const override = touchOverrideOf(moveTouchPart(BASE, 'jump', 400, 100, W, H));
    const withAttack: TouchLayout = {
      ...BASE,
      dpad: { ...BASE.dpad, deadzoneRatio: 0.3 },
      buttons: [...BASE.buttons, { action: 'attack', cx: 0.5, cy: 0.5, radius: 0.08 }],
    };
    const applied = applyTouchOverride(withAttack, override);
    expect(applied.dpad.deadzoneRatio).toBe(0.3);
    expect(applied.buttons.map((b) => b.action)).toEqual(['jump', 'switch', 'attack']);
    expect(applied.buttons[2]).toEqual(withAttack.buttons[2]);
    expect(jumpOf(applied)).toMatchObject({ cx: 0.5, cy: 0.25 });
  });

  it('ignores buttons the pack no longer has', () => {
    const override = touchOverrideOf({
      ...BASE,
      buttons: [...BASE.buttons, { action: 'item', cx: 0.1, cy: 0.1, radius: 0.1 }],
    });
    expect(applyTouchOverride(BASE, override).buttons.map((b) => b.action)).toEqual([
      'jump',
      'switch',
    ]);
  });
});

describe('moveTouchPart', () => {
  it('moves a part so that it is placed where it was dropped', () => {
    const moved = moveTouchPart(BASE, 'jump', 300, 150, W, H);
    const placed = placeLayout(moved, W, H).buttons[0];
    expect(placed?.x).toBeCloseTo(300, 1);
    expect(placed?.y).toBeCloseTo(150, 1);
    // Nothing else moves.
    expect(moved.dpad).toEqual(BASE.dpad);
    expect(moved.buttons[1]).toEqual(BASE.buttons[1]);
  });

  it('keeps the touch area inside the pad area, as it is drawn', () => {
    const moved = moveTouchPart(BASE, 'dpad', -50, 1000, W, H);
    const reach = 0.25 * H * TOUCH_HIT_SCALE;
    const placed = placeLayout(moved, W, H).dpad;
    expect(placed.x).toBeCloseTo(reach, 1);
    expect(placed.y).toBeCloseTo(H - reach, 1);
    // The saved ratio is the drawn place, not the finger.
    expect(moved.dpad.cx).toBeCloseTo(reach / W, 3);
  });

  it('mirrors the ratio back for a left-handed layout', () => {
    const left = setTouchHandedness(BASE, 'left');
    const moved = moveTouchPart(left, 'jump', 200, 200, W, H);
    expect(jumpOf(moved)?.cx).toBe(0.75);
    expect(placeLayout(moved, W, H).buttons[0]?.x).toBeCloseTo(200, 1);
  });

  it('does nothing for a part the layout does not have, or an empty area', () => {
    expect(moveTouchPart(BASE, 'attack', 10, 10, W, H)).toBe(BASE);
    expect(moveTouchPart(BASE, 'jump', 10, 10, 0, H)).toBe(BASE);
  });
});

describe('resizeTouchPart and touchPartScale', () => {
  it('scales from the pack size, between the bounds', () => {
    const big = resizeTouchPart(BASE, BASE, 'jump', 1.5);
    expect(jumpOf(big)?.radius).toBe(0.15);
    expect(touchPartScale(BASE, big, 'jump')).toBeCloseTo(1.5);
    expect(touchPartScale(BASE, resizeTouchPart(BASE, big, 'jump', 99), 'jump')).toBe(
      TOUCH_SIZE_MAX,
    );
    expect(touchPartScale(BASE, resizeTouchPart(BASE, big, 'jump', 0), 'jump')).toBe(
      TOUCH_SIZE_MIN,
    );
    // The center stays.
    expect(jumpOf(big)).toMatchObject({ cx: 0.85, cy: 0.7 });
  });

  it('never goes over the largest radius a layout may have', () => {
    expect(resizeTouchPart(BASE, BASE, 'dpad', 2.5).dpad.radius).toBe(0.5);
  });
});

describe('setTouchOpacity', () => {
  it('never makes the pad disappear', () => {
    expect(setTouchOpacity(BASE, 0).opacity).toBe(TOUCH_OPACITY_MIN);
    expect(setTouchOpacity(BASE, 2).opacity).toBe(1);
    expect(setTouchOpacity(BASE, 0.7).opacity).toBe(0.7);
  });
});

describe('touchPartAt', () => {
  const placed = placeLayout(BASE, W, H);

  it('finds the d-pad, a button, or nothing', () => {
    expect(touchPartAt(placed, placed.dpad.x, placed.dpad.y)).toBe('dpad');
    const jump = placed.buttons[0];
    expect(touchPartAt(placed, jump?.x ?? 0, jump?.y ?? 0)).toBe('jump');
    expect(touchPartAt(placed, W / 2, 10)).toBeUndefined();
  });

  it('prefers the button drawn on top where parts overlap', () => {
    const stacked = placeLayout(moveTouchPart(BASE, 'switch', 680, 280, W, H), W, H);
    const jump = stacked.buttons[0];
    expect(touchPartAt(stacked, jump?.x ?? 0, jump?.y ?? 0)).toBe('switch');
  });
});
