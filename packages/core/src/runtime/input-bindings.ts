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
  /** The virtual pad (docs/input-and-feel.md 9). */
  readonly touch: TouchDefaults;
}

export interface TouchDefaults {
  /** Name of the layout used by default (a key of `layouts`). */
  readonly layout: string;
  readonly layouts: Readonly<Record<string, TouchLayout>>;
}

/**
 * One virtual pad layout (docs/pack-spec.md 4.7). `cx`, `cy` are 0..1 inside the pad area;
 * `radius` is a ratio of the pad area's shorter side. Button icons follow from the action.
 */
export interface TouchLayout {
  /** `left` mirrors every `cx`. */
  readonly handedness: 'right' | 'left';
  /** 0..1, used where the pad sits over the game screen (landscape). */
  readonly opacity: number;
  readonly dpad: {
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
    /** Below `radius * deadzoneRatio` from the center there is no direction. */
    readonly deadzoneRatio: number;
    /** The first touch inside the d-pad becomes its center. */
    readonly floating: boolean;
  };
  readonly buttons: ReadonlyArray<{
    readonly action: ActionId;
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
  }>;
}
