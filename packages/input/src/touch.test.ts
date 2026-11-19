import { type ActionId, actionMask, type TouchLayout } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { InputBuffer } from './input-buffer';
import {
  buttonAt,
  DPAD_HYSTERESIS_DEG,
  dpadSector,
  placeLayout,
  sectorMask,
  TOUCH_HIT_SCALE,
} from './touch-geometry';
import { TouchPadDevice } from './touch-pad';

const m = actionMask;

// A fictional layout for tests (a pack provides its own in input.json).
const LAYOUT: TouchLayout = {
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

function rig(layout: TouchLayout = LAYOUT) {
  const buffer = new InputBuffer();
  const pad = new TouchPadDevice(buffer);
  buffer.addSource(pad);
  const placed = placeLayout(layout, W, H);
  pad.setLayout(placed);
  return { buffer, pad, placed };
}

/** A point at `degrees` (0 = right, clockwise on screen) and `distance` px from (cx, cy). */
function at(cx: number, cy: number, degrees: number, distance: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  return [cx + Math.cos(rad) * distance, cy + Math.sin(rad) * distance];
}

describe('placeLayout', () => {
  it('turns ratios into px, with radius a ratio of the shorter side', () => {
    const placed = placeLayout(LAYOUT, W, H);
    expect(placed.dpad).toMatchObject({ x: 160, y: 240, r: 100, deadzone: 20 });
    expect(placed.buttons[0]).toMatchObject({ action: 'jump', x: 680, y: 280, r: 40 });
  });

  it('mirrors x for the left hand', () => {
    const placed = placeLayout({ ...LAYOUT, handedness: 'left' }, W, H);
    expect(placed.dpad.x).toBe(W - 160);
    expect(placed.buttons[0]?.x).toBeCloseTo(W - 680, 9);
  });

  it('pulls circles inside a narrow area (portrait)', () => {
    // 360 x 300: the d-pad (r = 75, touch area 90) would stick out at x = 18.
    const placed = placeLayout(
      { ...LAYOUT, dpad: { ...LAYOUT.dpad, cx: 0.05, cy: 0.98 } },
      360,
      300,
    );
    expect(placed.dpad.x).toBeCloseTo(placed.dpad.r * 1.2, 9);
    expect(placed.dpad.y).toBeCloseTo(300 - placed.dpad.r * 1.2, 9);
  });
});

describe('dpadSector', () => {
  const dz = 20;
  it.each([
    [0, 'right'],
    [45, 'right+down'],
    [90, 'down'],
    [135, 'left+down'],
    [180, 'left'],
    [225, 'left+up'],
    [270, 'up'],
    [315, 'right+up'],
  ])('%i degrees is %s', (degrees, name) => {
    const [x, y] = at(0, 0, degrees, 50);
    const actions = name.split('+') as ActionId[];
    expect(sectorMask(dpadSector(x, y, dz, undefined))).toBe(m(...actions));
  });

  it('has no direction inside the deadzone', () => {
    expect(dpadSector(10, 10, dz, undefined)).toBeUndefined();
    expect(dpadSector(10, 10, dz, 0)).toBeUndefined();
  });

  it('keeps the previous direction up to the hysteresis past the edge', () => {
    const edge = 22.5; // between right (0) and right+down (1)
    const near = edge + DPAD_HYSTERESIS_DEG - 1;
    const past = edge + DPAD_HYSTERESIS_DEG + 1;
    expect(dpadSector(...at(0, 0, near, 50), dz, undefined)).toBe(1);
    expect(dpadSector(...at(0, 0, near, 50), dz, 0)).toBe(0);
    expect(dpadSector(...at(0, 0, past, 50), dz, 0)).toBe(1);
    // And the other way round, back from right+down.
    expect(dpadSector(...at(0, 0, edge - DPAD_HYSTERESIS_DEG + 1, 50), dz, 1)).toBe(1);
    expect(dpadSector(...at(0, 0, edge - DPAD_HYSTERESIS_DEG - 1, 50), dz, 1)).toBe(0);
    // Across 0 degrees: up+right (7) and right (0).
    expect(dpadSector(...at(0, 0, 360 - edge - DPAD_HYSTERESIS_DEG + 1, 50), dz, 0)).toBe(0);
  });
});

describe('buttonAt', () => {
  const { buttons } = placeLayout(LAYOUT, W, H);
  const jump = buttons[0] as { x: number; y: number; r: number };

  it('hits 1.2 times the drawn radius', () => {
    expect(buttonAt(buttons, jump.x + jump.r * TOUCH_HIT_SCALE - 1, jump.y)).toBe(0);
    expect(buttonAt(buttons, jump.x + jump.r * TOUCH_HIT_SCALE + 1, jump.y)).toBeUndefined();
    // The spec's value (docs/input-and-feel.md 9.3), not just the constant.
    expect(buttonAt(buttons, jump.x + jump.r * 1.15, jump.y)).toBe(0);
    expect(buttonAt(buttons, jump.x + jump.r * 1.25, jump.y)).toBeUndefined();
  });

  it('picks the nearer center where touch areas overlap, and skips disabled buttons', () => {
    // Two buttons 60 px apart with r 40: their touch areas (48 px) overlap around x 650.
    const close = [
      { action: 'jump' as const, x: 680, y: 100, r: 40 },
      { action: 'switch' as const, x: 620, y: 100, r: 40 },
    ];
    expect(buttonAt(close, 651, 100)).toBe(0);
    expect(buttonAt(close, 649, 100)).toBe(1);
    expect(buttonAt(close, 649, 100, (a) => a !== 'switch')).toBe(0);
    expect(buttonAt(close, 600, 100, (a) => a !== 'switch')).toBeUndefined();
    // Exactly in between: the lower index.
    expect(buttonAt(close, 650, 100)).toBe(0);
  });
});

describe('TouchPadDevice', () => {
  it('turns d-pad touches into directions, at once, and slides between them', () => {
    const { buffer, pad, placed } = rig();
    const { x, y } = placed.dpad;
    pad.pointerDown(1, ...at(x, y, 0, 60));
    expect(buffer.nextFrame()).toEqual({ held: m('right'), pressed: m('right'), released: 0 });
    pad.pointerMove(1, ...at(x, y, 90, 60));
    expect(buffer.nextFrame()).toEqual({
      held: m('down'),
      pressed: m('down'),
      released: m('right'),
    });
    // A d-pad finger stays one outside the d-pad.
    pad.pointerMove(1, x + 300, y);
    expect(buffer.nextFrame().held).toBe(m('right'));
    pad.pointerUp(1);
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('right') });
  });

  it('presses the button under a finger and slides from one button to another', () => {
    const { buffer, pad, placed } = rig();
    const [jump, swap] = placed.buttons as unknown as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    pad.pointerDown(7, jump.x, jump.y);
    expect(buffer.nextFrame().held).toBe(m('jump'));
    pad.pointerMove(7, swap.x, swap.y);
    expect(buffer.nextFrame()).toEqual({
      held: m('switch'),
      pressed: m('switch'),
      released: m('jump'),
    });
    // Off every button: nothing held; back on: pressed again.
    pad.pointerMove(7, W / 2, 20);
    expect(buffer.nextFrame().held).toBe(0);
    pad.pointerMove(7, jump.x, jump.y);
    expect(buffer.nextFrame().pressed).toBe(m('jump'));
  });

  it('tracks several fingers: move and jump at the same time', () => {
    const { buffer, pad, placed } = rig();
    const jump = placed.buttons[0] as { x: number; y: number };
    pad.pointerDown(1, ...at(placed.dpad.x, placed.dpad.y, 180, 60));
    pad.pointerDown(2, jump.x, jump.y);
    expect(buffer.nextFrame().held).toBe(m('left', 'jump'));
    pad.pointerUp(2);
    expect(buffer.nextFrame()).toEqual({ held: m('left'), pressed: 0, released: m('jump') });
    // A second finger landing on the d-pad is a button finger (one d-pad finger at a time).
    pad.pointerDown(3, ...at(placed.dpad.x, placed.dpad.y, 0, 60));
    expect(buffer.nextFrame().held).toBe(m('left'));
  });

  it('keeps an action held while two fingers press it', () => {
    const { buffer, pad, placed } = rig();
    const jump = placed.buttons[0] as { x: number; y: number };
    pad.pointerDown(1, jump.x, jump.y);
    pad.pointerDown(2, jump.x + 5, jump.y);
    buffer.nextFrame();
    pad.pointerUp(1);
    expect(buffer.nextFrame()).toEqual({ held: m('jump'), pressed: 0, released: 0 });
  });

  it('centers a floating d-pad where the finger lands', () => {
    const floating = { ...LAYOUT, dpad: { ...LAYOUT.dpad, floating: true } };
    const { buffer, pad, placed } = rig(floating);
    const start: [number, number] = [placed.dpad.x + 50, placed.dpad.y];
    pad.pointerDown(1, ...start);
    expect(buffer.nextFrame().held).toBe(0); // at the new center: deadzone
    expect(pad.state().dpadCenter).toEqual({ x: start[0], y: start[1] });
    pad.pointerMove(1, start[0] - 40, start[1]);
    expect(buffer.nextFrame().held).toBe(m('left'));
    pad.pointerUp(1);
    expect(pad.state().dpadCenter).toEqual({ x: placed.dpad.x, y: placed.dpad.y });
  });

  it('releases a disabled button and does not press it again', () => {
    const { buffer, pad, placed } = rig();
    const swap = placed.buttons[1] as { x: number; y: number };
    pad.pointerDown(1, swap.x, swap.y);
    expect(buffer.nextFrame().held).toBe(m('switch'));
    pad.setActionEnabled('switch', false);
    expect(buffer.nextFrame().released).toBe(m('switch'));
    pad.pointerMove(1, swap.x + 1, swap.y);
    expect(buffer.nextFrame().held).toBe(0);
  });

  it('lets go of every finger when hidden (no layout) or on focus loss', () => {
    const { buffer, pad, placed } = rig();
    pad.pointerDown(1, ...at(placed.dpad.x, placed.dpad.y, 0, 60));
    buffer.nextFrame();
    pad.setLayout(undefined);
    expect(buffer.nextFrame().released).toBe(m('right'));
    expect(pad.held()).toBe(0);

    pad.setLayout(placed);
    pad.pointerDown(2, ...at(placed.dpad.x, placed.dpad.y, 0, 60));
    buffer.nextFrame();
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: 'hidden' as DocumentVisibilityState,
    });
    const detach = pad.attachFocus({ window, document });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pad.held()).toBe(0);
    expect(buffer.nextFrame().released).toBe(m('right'));
    detach();
  });

  it('reports the d-pad finger for the knob, and redraws on moves that change no direction', () => {
    const { buffer, pad, placed } = rig();
    const fingers: unknown[] = [];
    let sourceChanges = 0;
    const counting = { sourceChanged: () => sourceChanges++ };
    const device = new TouchPadDevice(counting);
    device.setLayout(placed);
    device.onChange((state) => fingers.push(state.dpadFinger));
    sourceChanges = 0;
    device.pointerDown(1, placed.dpad.x + 60, placed.dpad.y);
    device.pointerMove(1, placed.dpad.x + 70, placed.dpad.y + 2); // still right
    device.pointerUp(1);
    expect(fingers).toEqual([{ dx: 60, dy: 0 }, { dx: 70, dy: 2 }, undefined]);
    // Only the press and the release reach the game; the knob-only move does not.
    expect(sourceChanges).toBe(2);
    expect(pad.state().dpadFinger).toBeUndefined();
    void buffer;
  });

  it('reports what to draw on every change', () => {
    const { pad, placed } = rig();
    const states: unknown[] = [];
    pad.onChange((state) => states.push({ sector: state.dpadSector, pressed: [...state.pressed] }));
    pad.pointerDown(1, ...at(placed.dpad.x, placed.dpad.y, 270, 60));
    pad.pointerDown(
      2,
      (placed.buttons[0] as { x: number }).x,
      (placed.buttons[0] as { y: number }).y,
    );
    pad.pointerUp(1);
    expect(states).toEqual([
      { sector: 6, pressed: [] },
      { sector: 6, pressed: [0] },
      { sector: undefined, pressed: [0] },
    ]);
  });
});
