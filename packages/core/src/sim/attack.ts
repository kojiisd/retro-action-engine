import { type ControllerState, NEVER } from '../world/world';

/**
 * Starts swings (ADR-0017), for the `controller` and for the ladder (ADR-0019). A press at tick
 * p starts a swing at the first tick t that allows one, if `t - p <= bufferTicks`: with the
 * swing ending at tick u, a press from `u - bufferTicks` on starts the next swing at u, and an
 * earlier one is dropped (only the late part of a swing is remembered, M3-2c). Holding the
 * button does nothing more. Returns whether the character is attacking this tick.
 */
export function attackStep(
  c: ControllerState,
  t: number,
  pressed: boolean,
  bufferTicks: number,
  /** Length of the active character's attack in ticks; undefined if it cannot attack. */
  attackTicks: number | undefined,
  /** False while a swing may not start (landing lag); a remembered press waits for it. */
  allowed: boolean,
): boolean {
  if (attackTicks === undefined || attackTicks <= 0) {
    c.attackPressedTick = NEVER;
    return t < c.attackUntilTick;
  }
  // A press too old to start a swing any more is forgotten.
  if (c.attackPressedTick !== NEVER && t - c.attackPressedTick > bufferTicks) {
    c.attackPressedTick = NEVER;
  }
  if (pressed) {
    c.attackPressedTick = t;
  }
  if (allowed && t >= c.attackUntilTick && c.attackPressedTick !== NEVER) {
    c.attackUntilTick = t + attackTicks;
    c.attackPressedTick = NEVER;
  }
  return t < c.attackUntilTick;
}

/** Cuts a swing short and forgets a remembered press (switch, going down, entering a room). */
export function cancelAttack(c: ControllerState): void {
  c.attackUntilTick = NEVER;
  c.attackPressedTick = NEVER;
}
