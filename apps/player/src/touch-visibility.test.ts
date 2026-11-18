import { describe, expect, it } from 'vitest';
import { touchPadVisible } from './touch-visibility';

describe('touchPadVisible', () => {
  it('shows the pad on a touch screen without a gamepad only', () => {
    expect(touchPadVisible({ coarsePointer: true, gamepadConnected: false })).toBe(true);
    expect(touchPadVisible({ coarsePointer: true, gamepadConnected: true })).toBe(false);
    expect(touchPadVisible({ coarsePointer: false, gamepadConnected: false })).toBe(false);
    expect(touchPadVisible({ coarsePointer: false, gamepadConnected: true })).toBe(false);
  });
});
