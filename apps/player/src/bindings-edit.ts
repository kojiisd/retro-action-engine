import { ACTIONS, type ActionId, type GamepadInputId } from '@retro-action-engine/core';
import { type ActionMap, type BindingOverrides, STANDARD_PAD } from '@retro-action-engine/input';

/** One assigned input, as the key config shows it. */
export type Binding =
  | { readonly device: 'keyboard'; readonly code: string }
  | { readonly device: 'gamepad'; readonly pad: string; readonly input: GamepadInputId };

/** The inputs of an action, keys first, overrides applied. */
export function bindingsOf(map: ActionMap, action: ActionId): Binding[] {
  return [
    ...map.keyboardFor(action).map((code) => ({ device: 'keyboard' as const, code })),
    ...map.gamepadFor(action).map(([pad, input]) => ({ device: 'gamepad' as const, pad, input })),
  ];
}

function padList(map: ActionMap, action: ActionId, pad: string): GamepadInputId[] {
  return map
    .gamepadFor(action)
    .filter(([p]) => p === pad)
    .map(([, input]) => input);
}

function withList(
  overrides: BindingOverrides,
  action: ActionId,
  binding: Binding,
  list: readonly string[],
): BindingOverrides {
  if (binding.device === 'keyboard') {
    return { ...overrides, keyboard: { ...overrides.keyboard, [action]: list } };
  }
  const pads = overrides.gamepad ?? {};
  return {
    ...overrides,
    gamepad: {
      ...pads,
      [binding.pad]: { ...pads[binding.pad], [action]: list as GamepadInputId[] },
    },
  };
}

function currentList(map: ActionMap, action: ActionId, binding: Binding): string[] {
  return binding.device === 'keyboard'
    ? [...map.keyboardFor(action)]
    : padList(map, action, binding.pad);
}

const same = (b: Binding) => (s: string) => s === (b.device === 'keyboard' ? b.code : b.input);

/** The overrides with `binding` added to `action` (no change if it is already there). */
export function addBinding(map: ActionMap, action: ActionId, binding: Binding): BindingOverrides {
  const list = currentList(map, action, binding);
  if (list.some(same(binding))) return map.overrides;
  return withList(map.overrides, action, binding, [
    ...list,
    binding.device === 'keyboard' ? binding.code : binding.input,
  ]);
}

/** The overrides with `binding` removed from `action`. */
export function removeBinding(
  map: ActionMap,
  action: ActionId,
  binding: Binding,
): BindingOverrides {
  const list = currentList(map, action, binding).filter((s) => !same(binding)(s));
  return withList(map.overrides, action, binding, list);
}

/** Actions an input drives (overrides applied), for one device / pad. */
function actionsOf(map: ActionMap, binding: Binding, defaults: boolean): ActionId[] {
  return ACTIONS.filter((action) => {
    if (binding.device === 'keyboard') {
      const list = defaults ? (map.defaults.keyboard[action] ?? []) : map.keyboardFor(action);
      return list.includes(binding.code);
    }
    const list = defaults
      ? binding.pad === STANDARD_PAD
        ? (map.defaults.gamepad.standard[action] ?? [])
        : []
      : padList(map, action, binding.pad);
    return list.includes(binding.input);
  });
}

/**
 * True when the input also drives another action, in a way the pack itself does not (the pack
 * may share a key on purpose, like jump and confirm). Shown as a warning only (4.2).
 */
export function conflicts(map: ActionMap, action: ActionId, binding: Binding): boolean {
  const packShares = new Set(actionsOf(map, binding, true));
  return actionsOf(map, binding, false).some(
    (other) => other !== action && !(packShares.has(other) && packShares.has(action)),
  );
}
