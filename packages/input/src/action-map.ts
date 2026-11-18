import {
  ACTIONS,
  type ActionId,
  actionBit,
  type GamepadInputId,
  type InputDefaults,
} from '@retro-action-engine/core';

/** Key of the bindings for standard-mapping gamepads; other pads use their `Gamepad.id`. */
export const STANDARD_PAD = 'standard';

/**
 * The user's changes to a pack's bindings (docs/input-and-feel.md 4.2, ADR-0011). Per action: a
 * list replaces the pack's default list for that device (an empty list unbinds the action).
 * `gamepad` is keyed by `STANDARD_PAD` or a non-standard pad's `Gamepad.id`.
 */
export interface BindingOverrides {
  readonly keyboard?: Readonly<Partial<Record<ActionId, readonly string[]>>>;
  readonly gamepad?: Readonly<
    Record<string, Readonly<Partial<Record<ActionId, readonly GamepadInputId[]>>>>
  >;
}

/**
 * Device inputs to actions (docs/input-and-feel.md 4): the pack's defaults with the user's
 * overrides on top. One input may drive several actions (`KeyZ` for `jump` and `confirm`) and one
 * action may have several inputs. Lookups return action masks so that devices can OR them.
 */
export class ActionMap {
  private keys = new Map<string, number>();
  private pads = new Map<string, Map<string, number>>();
  private current: BindingOverrides = {};

  constructor(
    readonly defaults: InputDefaults,
    overrides: BindingOverrides = {},
  ) {
    this.setOverrides(overrides);
  }

  get overrides(): BindingOverrides {
    return this.current;
  }

  /** Replaces the user's overrides; lookups change at once. */
  setOverrides(overrides: BindingOverrides): void {
    this.current = overrides;
    this.keys = new Map();
    this.pads = new Map();
    for (const action of ACTIONS) {
      for (const code of this.keyboardFor(action)) add(this.keys, code, action);
      for (const [pad, input] of this.gamepadFor(action)) {
        let map = this.pads.get(pad);
        if (map === undefined) {
          map = new Map();
          this.pads.set(pad, map);
        }
        add(map, input, action);
      }
    }
  }

  /** Actions bound to a `KeyboardEvent.code`; 0 when the key is not bound. */
  key(code: string): number {
    return this.keys.get(code) ?? 0;
  }

  /** Actions bound to an input of a pad (`STANDARD_PAD` or a `Gamepad.id`); 0 when unbound. */
  gamepad(id: GamepadInputId, pad: string = STANDARD_PAD): number {
    return this.pads.get(pad)?.get(id) ?? 0;
  }

  /** True when a pad has bindings: standard pads always do; others only if the user set some. */
  readsPad(pad: string): boolean {
    return pad === STANDARD_PAD || (this.pads.get(pad)?.size ?? 0) > 0;
  }

  /** Keys bound to an action, overrides applied. */
  keyboardFor(action: ActionId): readonly string[] {
    return this.current.keyboard?.[action] ?? this.defaults.keyboard[action] ?? [];
  }

  /** Gamepad inputs bound to an action, as [pad, input], standard pads first then by pad id. */
  gamepadFor(action: ActionId): ReadonlyArray<readonly [string, GamepadInputId]> {
    const standard =
      this.current.gamepad?.[STANDARD_PAD]?.[action] ??
      this.defaults.gamepad.standard[action] ??
      [];
    const out: Array<readonly [string, GamepadInputId]> = standard.map((input) => [
      STANDARD_PAD,
      input,
    ]);
    const others = Object.keys(this.current.gamepad ?? {})
      .filter((pad) => pad !== STANDARD_PAD)
      .sort();
    for (const pad of others) {
      for (const input of this.current.gamepad?.[pad]?.[action] ?? []) out.push([pad, input]);
    }
    return out;
  }

  /** Actions the pack binds to something, in vocabulary order (what the key config lists). */
  packActions(): ActionId[] {
    return ACTIONS.filter(
      (action) =>
        (this.defaults.keyboard[action]?.length ?? 0) > 0 ||
        (this.defaults.gamepad.standard[action]?.length ?? 0) > 0,
    );
  }

  /** Stick thresholds (0..1): down at `deadzone` or more, up again at `release` or less. */
  get analog(): InputDefaults['analog'] {
    return this.defaults.analog;
  }
}

function add(map: Map<string, number>, input: string, action: ActionId): void {
  map.set(input, (map.get(input) ?? 0) | actionBit(action));
}
