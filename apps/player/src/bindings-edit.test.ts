import type { InputDefaults } from '@retro-action-engine/core';
import { ActionMap, STANDARD_PAD } from '@retro-action-engine/input';
import { describe, expect, it } from 'vitest';
import { addBinding, bindingsOf, conflicts, removeBinding } from './bindings-edit';

// Fictional pack bindings for tests. KeyZ is shared by jump and confirm on purpose.
const DEFAULTS: InputDefaults = {
  keyboard: { left: ['ArrowLeft'], jump: ['KeyZ'], confirm: ['KeyZ', 'Enter'], menu: ['Enter'] },
  gamepad: { standard: { jump: ['button0'], left: ['dpadLeft'] } },
  analog: { deadzone: 0.5, release: 0.3 },
  touch: { layout: 'default', layouts: {} },
};

const key = (code: string) => ({ device: 'keyboard' as const, code });
const pad = (input: `button${number}` | `axis${number}-`, padId: string = STANDARD_PAD) => ({
  device: 'gamepad' as const,
  pad: padId,
  input,
});

describe('bindings editing', () => {
  it('adds to the current list, so the defaults stay', () => {
    const map = new ActionMap(DEFAULTS);
    map.setOverrides(addBinding(map, 'jump', key('KeyX')));
    expect(map.keyboardFor('jump')).toEqual(['KeyZ', 'KeyX']);
    expect(map.overrides).toEqual({ keyboard: { jump: ['KeyZ', 'KeyX'] } });
    // Adding it again changes nothing.
    expect(addBinding(map, 'jump', key('KeyX'))).toBe(map.overrides);
  });

  it('removes one input, and can leave an action with none', () => {
    const map = new ActionMap(DEFAULTS);
    map.setOverrides(removeBinding(map, 'left', key('ArrowLeft')));
    expect(map.keyboardFor('left')).toEqual([]);
    expect(map.key('ArrowLeft')).toBe(0);
    // The gamepad side of the action is untouched.
    expect(bindingsOf(map, 'left')).toEqual([
      { device: 'gamepad', pad: STANDARD_PAD, input: 'dpadLeft' },
    ]);
  });

  it('keeps gamepad inputs per pad', () => {
    const map = new ActionMap(DEFAULTS);
    map.setOverrides(addBinding(map, 'jump', pad('button2', 'Retro pad')));
    map.setOverrides(addBinding(map, 'jump', pad('button3')));
    expect(bindingsOf(map, 'jump')).toEqual([
      { device: 'keyboard', code: 'KeyZ' },
      { device: 'gamepad', pad: STANDARD_PAD, input: 'button0' },
      { device: 'gamepad', pad: STANDARD_PAD, input: 'button3' },
      { device: 'gamepad', pad: 'Retro pad', input: 'button2' },
    ]);
    map.setOverrides(removeBinding(map, 'jump', pad('button2', 'Retro pad')));
    expect(map.gamepad('button2', 'Retro pad')).toBe(0);
    expect(map.gamepad('button3')).toBeGreaterThan(0);
  });

  it('warns about a new overlap, but not about one the pack has on purpose', () => {
    const map = new ActionMap(DEFAULTS);
    expect(conflicts(map, 'jump', key('KeyZ'))).toBe(false); // jump + confirm, from the pack
    map.setOverrides(addBinding(map, 'left', key('KeyZ')));
    expect(conflicts(map, 'left', key('KeyZ'))).toBe(true);
    expect(conflicts(map, 'jump', key('KeyZ'))).toBe(true);
    expect(conflicts(map, 'menu', key('Enter'))).toBe(false); // menu + confirm, from the pack
    map.setOverrides(addBinding(map, 'left', pad('button0')));
    expect(conflicts(map, 'left', pad('button0'))).toBe(true);
  });
});
