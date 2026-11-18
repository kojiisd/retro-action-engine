import {
  ACTIONS,
  type ActionId,
  actionBit,
  type GamepadInputId,
  type InputDefaults,
} from '@retro-action-engine/core';

/**
 * Device inputs to actions (docs/input-and-feel.md 4). One input may drive several actions
 * (`KeyZ` for `jump` and `confirm`) and one action may have several inputs. Lookups return action
 * masks so that devices can OR them together.
 */
export class ActionMap {
  private readonly keys = new Map<string, number>();
  private readonly pad = new Map<string, number>();

  constructor(readonly defaults: InputDefaults) {
    for (const action of ACTIONS) {
      for (const code of defaults.keyboard[action] ?? []) add(this.keys, code, action);
      for (const id of defaults.gamepad.standard[action] ?? []) add(this.pad, id, action);
    }
  }

  /** Actions bound to a `KeyboardEvent.code`; 0 when the key is not bound. */
  key(code: string): number {
    return this.keys.get(code) ?? 0;
  }

  /** Actions bound to an input of a standard-mapping gamepad; 0 when it is not bound. */
  gamepad(id: GamepadInputId): number {
    return this.pad.get(id) ?? 0;
  }

  /** Stick thresholds (0..1): down at `deadzone` or more, up again at `release` or less. */
  get analog(): InputDefaults['analog'] {
    return this.defaults.analog;
  }
}

function add(map: Map<string, number>, input: string, action: ActionId): void {
  map.set(input, (map.get(input) ?? 0) | actionBit(action));
}
