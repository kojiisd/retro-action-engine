import { describe, expect, it } from 'vitest';
import { touchPadVisible } from './touch-visibility';

describe('touchPadVisible', () => {
  it('in auto, shows the pad on a touch screen without a gamepad only', () => {
    const auto = (coarsePointer: boolean, gamepadConnected: boolean) =>
      touchPadVisible({ mode: 'auto', coarsePointer, gamepadConnected });
    expect(auto(true, false)).toBe(true);
    expect(auto(true, true)).toBe(false);
    expect(auto(false, false)).toBe(false);
    expect(auto(false, true)).toBe(false);
  });

  it('follows the setting when it is show or hide', () => {
    for (const coarsePointer of [true, false]) {
      for (const gamepadConnected of [true, false]) {
        expect(touchPadVisible({ mode: 'show', coarsePointer, gamepadConnected })).toBe(true);
        expect(touchPadVisible({ mode: 'hide', coarsePointer, gamepadConnected })).toBe(false);
      }
    }
  });
});
