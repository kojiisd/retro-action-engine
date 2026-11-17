import { actionMask, type InputDefaults, type InputFrame } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { ActionMap } from './action-map';
import { GamepadDevice, type GamepadLike } from './gamepad';
import { InputBuffer } from './input-buffer';
import { KeyboardDevice, type KeyEventLike } from './keyboard';

// Fictional bindings for tests (a pack provides its own in input.json).
const DEFAULTS: InputDefaults = {
  keyboard: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight'],
    down: ['ArrowDown'],
    jump: ['KeyZ', 'Space'],
    confirm: ['KeyZ'],
    switch: ['KeyC'],
  },
  gamepad: {
    standard: {
      left: ['dpadLeft', 'leftStickLeft'],
      right: ['dpadRight', 'leftStickRight'],
      up: ['dpadUp', 'leftStickUp'],
      down: ['dpadDown', 'leftStickDown'],
      jump: ['button0'],
      switch: ['button1'],
    },
  },
  analog: { deadzone: 0.5, release: 0.3 },
  touch: { layout: 'default' },
};

const m = actionMask;

function key(code: string, extra: Partial<KeyEventLike> = {}) {
  const event = {
    code,
    repeat: false,
    isComposing: false,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

function keyboardRig() {
  const map = new ActionMap(DEFAULTS);
  const buffer = new InputBuffer();
  const keyboard = new KeyboardDevice(map, buffer);
  buffer.addSource(keyboard);
  return { buffer, keyboard };
}

/** A pad whose buttons and axes the test sets. */
class FakePad implements GamepadLike {
  connected = true;
  mapping = 'standard';
  buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  axes = [0, 0, 0, 0];
  constructor(readonly index: number) {}
  press(button: number, pressed = true): this {
    (this.buttons[button] as { pressed: boolean }).pressed = pressed;
    return this;
  }
}

function padRig() {
  const pads: Array<FakePad | null> = [];
  const map = new ActionMap(DEFAULTS);
  const buffer = new InputBuffer();
  const gamepad = new GamepadDevice(map, buffer, () => pads);
  buffer.addSource(gamepad);
  /** Polls once and takes one tick. */
  const tick = (): InputFrame => {
    gamepad.poll();
    return buffer.nextFrame();
  };
  return { pads, gamepad, buffer, tick };
}

describe('ActionMap', () => {
  it('maps one input to several actions and one action to several inputs', () => {
    const map = new ActionMap(DEFAULTS);
    expect(map.key('KeyZ')).toBe(m('jump', 'confirm'));
    expect(map.key('KeyA')).toBe(m('left'));
    expect(map.key('ArrowLeft')).toBe(m('left'));
    expect(map.key('KeyQ')).toBe(0);
    expect(map.gamepad('dpadLeft')).toBe(m('left'));
    expect(map.gamepad('button0')).toBe(m('jump'));
    expect(map.gamepad('button5')).toBe(0);
  });
});

describe('KeyboardDevice', () => {
  it('turns key down and up into presses and releases, one tick each', () => {
    const { buffer, keyboard } = keyboardRig();
    keyboard.keyDown(key('ArrowRight'));
    expect(buffer.nextFrame()).toEqual({ held: m('right'), pressed: m('right'), released: 0 });
    expect(buffer.nextFrame()).toEqual({ held: m('right'), pressed: 0, released: 0 });
    keyboard.keyUp(key('ArrowRight'));
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('right') });
  });

  it('ignores auto repeat', () => {
    const { buffer, keyboard } = keyboardRig();
    keyboard.keyDown(key('KeyZ'));
    buffer.nextFrame();
    keyboard.keyDown(key('KeyZ', { repeat: true }));
    keyboard.keyDown(key('KeyZ', { repeat: true }));
    expect(buffer.nextFrame()).toEqual({ held: m('jump', 'confirm'), pressed: 0, released: 0 });
  });

  it('does not take auto repeat after focus returns as a new press', () => {
    const { buffer, keyboard } = keyboardRig();
    keyboard.keyDown(key('ArrowRight'));
    buffer.nextFrame();
    keyboard.releaseAll();
    buffer.focusLost();
    buffer.nextFrame();
    keyboard.keyDown(key('ArrowRight', { repeat: true }));
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: 0 });
  });

  it('prevents the default action of bound keys only', () => {
    const { keyboard } = keyboardRig();
    const bound = key('Space');
    const repeat = key('Space', { repeat: true });
    const free = key('KeyQ');
    keyboard.keyDown(bound);
    keyboard.keyDown(repeat);
    keyboard.keyDown(free);
    expect([bound.prevented, repeat.prevented, free.prevented]).toEqual([true, true, false]);
  });

  it('ignores key downs during IME composition, but never a key up', () => {
    const { buffer, keyboard } = keyboardRig();
    keyboard.keyDown(key('KeyZ', { isComposing: true }));
    expect(buffer.nextFrame().held).toBe(0);
    keyboard.keyDown(key('KeyC'));
    keyboard.keyUp(key('KeyC', { isComposing: true }));
    expect(keyboard.held()).toBe(0);
    // Both edges count, one per tick (the edge rules).
    expect(buffer.nextFrame()).toEqual({ held: m('switch'), pressed: m('switch'), released: 0 });
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('switch') });
  });

  it('keeps an action held while any of its keys is down', () => {
    const { buffer, keyboard } = keyboardRig();
    keyboard.keyDown(key('ArrowLeft'));
    keyboard.keyDown(key('KeyA'));
    buffer.nextFrame();
    keyboard.keyUp(key('ArrowLeft'));
    expect(buffer.nextFrame()).toEqual({ held: m('left'), pressed: 0, released: 0 });
    keyboard.keyUp(key('KeyA'));
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('left') });
  });

  it('is the physical state used by resyncs', () => {
    const map = new ActionMap(DEFAULTS);
    const buffer = new InputBuffer({ maxBacklogTicks: 1 });
    const keyboard = new KeyboardDevice(map, buffer);
    buffer.addSource(keyboard);
    // Three edges of `right` in one tick overflow a backlog of 1 tick: the buffer resyncs to
    // what the keyboard holds now.
    keyboard.keyDown(key('ArrowRight'));
    keyboard.keyUp(key('ArrowRight'));
    keyboard.keyDown(key('ArrowRight'));
    expect(buffer.resyncCount).toBe(1);
    expect(buffer.nextFrame()).toEqual({ held: m('right'), pressed: m('right'), released: 0 });
  });

  it('forgets held keys on blur, so a key released elsewhere does not stay down', () => {
    const { buffer, keyboard } = keyboardRig();
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
    });
    const detachKeys = keyboard.attach({ window, document });
    const detachFocus = buffer.attachFocusEvents({ window, document });
    window.dispatchEvent(Object.assign(new Event('keydown'), key('ArrowRight')));
    expect(buffer.nextFrame().held).toBe(m('right'));
    window.dispatchEvent(new Event('blur'));
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('right') });
    expect(keyboard.held()).toBe(0);
    // A later resync reads the keyboard: nothing comes back as held.
    buffer.droppedTime();
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: 0 });
    detachKeys();
    detachFocus();
    window.dispatchEvent(Object.assign(new Event('keydown'), key('ArrowRight')));
    expect(buffer.nextFrame().held).toBe(0);
  });
});

describe('GamepadDevice', () => {
  it('maps standard buttons and the d-pad to actions', () => {
    const { pads, tick } = padRig();
    const pad = new FakePad(0);
    pads.push(pad);
    pad.press(0).press(14);
    expect(tick()).toEqual({ held: m('jump', 'left'), pressed: m('jump', 'left'), released: 0 });
    pad.press(0, false);
    expect(tick()).toEqual({ held: m('left'), pressed: 0, released: m('jump') });
  });

  it('reads the left stick with a deadzone and hysteresis', () => {
    const { pads, tick } = padRig();
    const pad = new FakePad(0);
    pads.push(pad);
    const { deadzone, release } = DEFAULTS.analog;
    const between = (deadzone + release) / 2;
    const held = (x: number, y = 0) => {
      pad.axes[0] = x;
      pad.axes[1] = y;
      return tick().held;
    };
    expect(held(between)).toBe(0); // below the deadzone: still up
    expect(held(deadzone)).toBe(m('right')); // at the deadzone: down
    expect(held(between)).toBe(m('right')); // back between: stays down (hysteresis)
    expect(held(release)).toBe(0); // at release: up
    expect(held(between)).toBe(0); // between again: stays up
    expect(held(-deadzone, deadzone)).toBe(m('left', 'down'));
    expect(held(0, -1)).toBe(m('up'));
  });

  it('releases everything a pad held when it disconnects', () => {
    const { pads, tick, gamepad } = padRig();
    const pad = new FakePad(0).press(0).press(15);
    pads.push(pad);
    expect(tick().held).toBe(m('jump', 'right'));
    pads[0] = null;
    expect(tick()).toEqual({ held: 0, pressed: 0, released: m('jump', 'right') });
    expect(gamepad.activeIndex).toBeUndefined();
    // `connected: false` counts as gone too.
    pads[0] = pad;
    expect(tick().held).toBe(m('jump', 'right'));
    pad.connected = false;
    expect(tick().released).toBe(m('jump', 'right'));
  });

  it('reads only the pad with the latest new input', () => {
    const { pads, tick, gamepad } = padRig();
    const a = new FakePad(0);
    const b = new FakePad(1);
    pads.push(a, b);
    a.press(15);
    expect(tick().held).toBe(m('right'));
    b.press(14);
    expect(tick()).toEqual({ held: m('left'), pressed: m('left'), released: m('right') });
    expect(gamepad.activeIndex).toBe(1);
    // An unbound button also makes a pad active.
    a.press(9);
    expect(tick().held).toBe(m('right'));
    expect(gamepad.activeIndex).toBe(0);
  });

  it('presses again after a focus-loss resync if the button is still down', () => {
    const { pads, tick, buffer } = padRig();
    const pad = new FakePad(0).press(0);
    pads.push(pad);
    expect(tick().held).toBe(m('jump'));
    buffer.focusLost();
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('jump') });
    expect(tick()).toEqual({ held: m('jump'), pressed: m('jump'), released: 0 });
  });

  it('ignores pads without the standard mapping', () => {
    const { pads, tick } = padRig();
    const pad = new FakePad(0).press(0);
    pad.mapping = '';
    pads.push(pad);
    expect(tick().held).toBe(0);
  });

  it('shares actions with the keyboard: one held action stays held until both let go', () => {
    const { pads, gamepad, buffer } = padRig();
    const keyboard = new KeyboardDevice(new ActionMap(DEFAULTS), buffer);
    buffer.addSource(keyboard);
    const pad = new FakePad(0).press(14);
    pads.push(pad);
    gamepad.poll();
    keyboard.keyDown(key('ArrowLeft'));
    expect(buffer.nextFrame()).toEqual({ held: m('left'), pressed: m('left'), released: 0 });
    pad.press(14, false);
    gamepad.poll();
    expect(buffer.nextFrame()).toEqual({ held: m('left'), pressed: 0, released: 0 });
    keyboard.keyUp(key('ArrowLeft'));
    expect(buffer.nextFrame()).toEqual({ held: 0, pressed: 0, released: m('left') });
  });
});
