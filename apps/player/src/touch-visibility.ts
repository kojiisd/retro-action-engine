import type { TouchPadMode } from './settings';

/**
 * When the virtual pad is shown (docs/input-and-feel.md 9.4): by the user's setting, and in
 * `auto` on a coarse pointer (a touch screen) with no gamepad connected.
 */
export function touchPadVisible(state: {
  readonly mode: TouchPadMode;
  readonly coarsePointer: boolean;
  readonly gamepadConnected: boolean;
}): boolean {
  if (state.mode === 'show') return true;
  if (state.mode === 'hide') return false;
  return state.coarsePointer && !state.gamepadConnected;
}
