/**
 * When the virtual pad is shown (docs/input-and-feel.md 9.4): on a coarse pointer (a touch
 * screen) with no gamepad connected. The settings to force it on or off come with M2-2.
 */
export function touchPadVisible(state: {
  readonly coarsePointer: boolean;
  readonly gamepadConnected: boolean;
}): boolean {
  return state.coarsePointer && !state.gamepadConnected;
}
