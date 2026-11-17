import type { ActionId } from '../input/frame';

/**
 * A gamepad control in the standard mapping (docs/pack-spec.md 4.7). Buttons by index, the
 * d-pad, and the four directions of the left stick.
 */
export type GamepadInputId =
  | `button${number}`
  | 'dpadUp'
  | 'dpadDown'
  | 'dpadLeft'
  | 'dpadRight'
  | 'leftStickUp'
  | 'leftStickDown'
  | 'leftStickLeft'
  | 'leftStickRight';

/**
 * Default bindings of a pack (`data/input.json`). They live in core so that `input` and the app
 * can share the type without `input` importing `pack`. Core itself never reads them.
 */
export interface InputDefaults {
  /** `KeyboardEvent.code` values per action. */
  readonly keyboard: Readonly<Partial<Record<ActionId, readonly string[]>>>;
  readonly gamepad: {
    readonly standard: Readonly<Partial<Record<ActionId, readonly GamepadInputId[]>>>;
  };
  /** Stick thresholds, 0..1. `release` < `deadzone` (hysteresis). */
  readonly analog: { readonly deadzone: number; readonly release: number };
  readonly touch: { readonly layout: string };
}
