import { actionMask, type InputDefaults } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { ActionMap, STANDARD_PAD } from './action-map';
import { GamepadDevice, type GamepadLike } from './gamepad';
import { InputBuffer } from './input-buffer';
import { KeyboardDevice, type KeyEventLike } from './keyboard';

const m = actionMask;

// Fictional pack bindings for tests.
const DEFAULTS: InputDefaults = {
  keyboard: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['KeyZ'], menu: ['Enter'] },
  gamepad: { standard: { left: ['dpadLeft', 'leftStickLeft'], jump: ['button0'] } },
  analog: { deadzone: 0.5, release: 0.3 },
  touch: { layout: 'default', layouts: {} },
};

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

class FakePad implements GamepadLike {
  connected = true;
  buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  axes = [0, 0, 0, 0, 0, 0, 0, 0];
  constructor(
    readonly index: number,
    readonly mapping: string,
    readonly id: string,
  ) {}
  press(button: number, pressed = true): this {
    (this.buttons[button] as { pressed: boolean }).pressed = pressed;
    return this;
  }
}

describe('ActionMap overrides', () => {
  it('replaces the default list of an overridden action only', () => {
    const map = new ActionMap(DEFAULTS, { keyboard: { jump: ['KeyX', 'Space'] } });
    expect(map.key('KeyZ')).toBe(0);
    expect(map.key('KeyX')).toBe(m('jump'));
    expect(map.key('Space')).toBe(m('jump'));
    expect(map.key('ArrowLeft')).toBe(m('left'));
    expect(map.keyboardFor('jump')).toEqual(['KeyX', 'Space']);
    expect(map.keyboardFor('left')).toEqual(['ArrowLeft']);
  });

  it('unbinds an action with an empty list, and returns to the defaults without overrides', () => {
    const map = new ActionMap(DEFAULTS, { keyboard: { left: [] } });
    expect(map.key('ArrowLeft')).toBe(0);
    map.setOverrides({});
    expect(map.key('ArrowLeft')).toBe(m('left'));
  });

  it('keeps gamepad bindings per pad: standard, and non-standard pads by id', () => {
    const map = new ActionMap(DEFAULTS, {
      gamepad: {
        [STANDARD_PAD]: { jump: ['button1'] },
        'Retro pad': { jump: ['button2'], left: ['axis0-'] },
      },
    });
    expect(map.gamepad('button1')).toBe(m('jump'));
    expect(map.gamepad('button0')).toBe(0);
    expect(map.gamepad('button2', 'Retro pad')).toBe(m('jump'));
    expect(map.gamepad('axis0-', 'Retro pad')).toBe(m('left'));
    expect(map.gamepad('button2')).toBe(0);
    expect(map.gamepadFor('jump')).toEqual([
      [STANDARD_PAD, 'button1'],
      ['Retro pad', 'button2'],
    ]);
    expect(map.readsPad(STANDARD_PAD)).toBe(true);
    expect(map.readsPad('Retro pad')).toBe(true);
    expect(map.readsPad('Other pad')).toBe(false);
  });

  it('lists the actions the pack binds, in vocabulary order', () => {
    expect(new ActionMap(DEFAULTS).packActions()).toEqual(['left', 'right', 'jump', 'menu']);
  });
});

describe('GamepadDevice with non-standard pads', () => {
  function rig(overrides = {}) {
    const pads: Array<FakePad | null> = [];
    const map = new ActionMap(DEFAULTS, overrides);
    const buffer = new InputBuffer();
    const device = new GamepadDevice(map, buffer, () => pads);
    buffer.addSource(device);
    const captured: Array<[string, string]> = [];
    const tick = () => {
      device.poll();
      return buffer.nextFrame();
    };
    return { pads, map, device, tick, captured };
  }

  it('does not read a non-standard pad without bindings, but captures its inputs', () => {
    const { pads, device, tick, captured } = rig();
    const pad = new FakePad(0, '', 'Retro pad');
    pads.push(pad);
    device.setCapture((padKey, input) => captured.push([padKey, input]));
    pad.press(2);
    pad.axes[6] = -1;
    expect(tick().held).toBe(0);
    expect(device.activeIndex).toBeUndefined();
    expect(device.connected).toBe(false);
    expect(captured).toEqual([
      ['Retro pad', 'button2'],
      ['Retro pad', 'axis6-'],
    ]);
  });

  it('reads a non-standard pad with the bindings for its id', () => {
    const { pads, device, tick } = rig({
      // dpadLeft would only mean something on a standard pad.
      gamepad: { 'Retro pad': { jump: ['button2'], left: ['axis6-', 'dpadLeft'] } },
    });
    const pad = new FakePad(0, '', 'Retro pad').press(2);
    pad.axes[6] = -1;
    pads.push(pad);
    expect(tick().held).toBe(m('jump', 'left'));
    expect(device.connected).toBe(true);
    // No standard names on a non-standard pad: button 14 is just button 14.
    pad.press(2, false).press(14);
    pad.axes[6] = 0;
    expect(tick().held).toBe(0);
  });

  it('keeps reading the standard pad when a pad without bindings is pressed', () => {
    const { pads, device, tick } = rig();
    const standard = new FakePad(0, 'standard', 'Std pad').press(14);
    const other = new FakePad(1, '', 'Retro pad');
    pads.push(standard, other);
    expect(tick().held).toBe(m('left'));
    other.press(3);
    expect(tick().held).toBe(m('left'));
    expect(device.activeIndex).toBe(0);
  });

  it('applies the analog hysteresis to every axis', () => {
    const { pads, tick } = rig({ gamepad: { 'Retro pad': { right: ['axis3+'] } } });
    const pad = new FakePad(0, '', 'Retro pad');
    pads.push(pad);
    const held = (v: number) => {
      pad.axes[3] = v;
      return tick().held;
    };
    expect(held(0.4)).toBe(0);
    expect(held(0.5)).toBe(m('right'));
    expect(held(0.4)).toBe(m('right'));
    expect(held(0.3)).toBe(0);
  });

  it('captures the d-pad and the left stick of a standard pad by their names, once', () => {
    const { pads, device, tick, captured } = rig();
    const pad = new FakePad(0, 'standard', 'Std pad');
    pads.push(pad);
    device.setCapture((padKey, input) => captured.push([padKey, input]));
    pad.press(14);
    tick();
    pad.press(14, false);
    pad.axes[0] = -1;
    tick();
    pad.axes[0] = 0;
    pad.axes[2] = 1;
    tick();
    expect(captured).toEqual([
      [STANDARD_PAD, 'dpadLeft'],
      [STANDARD_PAD, 'leftStickLeft'],
      [STANDARD_PAD, 'axis2+'],
    ]);
  });

  it('follows new bindings at the next poll', () => {
    const { pads, map, tick } = rig();
    const pad = new FakePad(0, 'standard', 'Std pad').press(1);
    pads.push(pad);
    expect(tick().held).toBe(0);
    map.setOverrides({ gamepad: { [STANDARD_PAD]: { jump: ['button1'] } } });
    expect(tick().held).toBe(m('jump'));
  });
});

describe('KeyboardDevice suspend and capture', () => {
  function rig() {
    const map = new ActionMap(DEFAULTS);
    const buffer = new InputBuffer();
    const keyboard = new KeyboardDevice(map, buffer);
    buffer.addSource(keyboard);
    return { map, buffer, keyboard };
  }

  it('leaves keys to the page while suspended and forgets the keys that were down', () => {
    const { buffer, keyboard } = rig();
    keyboard.keyDown(key('ArrowRight'));
    buffer.nextFrame();
    keyboard.setSuspended(true);
    expect(keyboard.held()).toBe(0);
    const enter = key('Enter');
    keyboard.keyDown(enter);
    expect(enter.prevented).toBe(false);
    expect(keyboard.held()).toBe(0);
    keyboard.setSuspended(false);
    keyboard.keyDown(key('KeyZ'));
    expect(keyboard.held()).toBe(m('jump'));
  });

  it('sends the next key downs to the capture, bound or not, and not to the game', () => {
    const { keyboard } = rig();
    const codes: string[] = [];
    keyboard.setCapture((code) => codes.push(code));
    const q = key('KeyQ');
    keyboard.keyDown(q);
    keyboard.keyDown(key('KeyZ'));
    keyboard.keyDown(key('KeyZ', { repeat: true }));
    keyboard.keyDown(key('KeyA', { isComposing: true }));
    expect(codes).toEqual(['KeyQ', 'KeyZ']);
    expect(q.prevented).toBe(true);
    expect(keyboard.held()).toBe(0);
    keyboard.setCapture(undefined);
    keyboard.keyDown(key('KeyZ'));
    expect(keyboard.held()).toBe(m('jump'));
  });

  it('releases a key whose binding was removed while it was down', () => {
    const { map, buffer, keyboard } = rig();
    keyboard.keyDown(key('KeyZ'));
    buffer.nextFrame();
    map.setOverrides({ keyboard: { jump: ['KeyX'] } });
    keyboard.keyUp(key('KeyZ'));
    map.setOverrides({ keyboard: { jump: ['KeyZ'] } });
    expect(keyboard.held()).toBe(0);
  });
});
