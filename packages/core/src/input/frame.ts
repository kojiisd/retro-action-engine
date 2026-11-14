/**
 * Input contract between the input layer and the simulation (docs/input-and-feel.md 4.1, 5).
 * Each field of an InputFrame is a 16-bit mask; the bit of an action is its index in ACTIONS.
 */
export const ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'attack',
  'switch',
  'item',
  'pause',
  'menu',
  'confirm',
  'cancel',
  'extra1',
  'extra2',
  'extra3',
  'extra4',
] as const;

export type ActionId = (typeof ACTIONS)[number];

export interface InputFrame {
  /** Actions held at the end of the tick. */
  readonly held: number;
  /** Actions whose down edge was consumed in this tick. */
  readonly pressed: number;
  /** Actions whose up edge was consumed in this tick. */
  readonly released: number;
}

export const EMPTY_FRAME: InputFrame = { held: 0, pressed: 0, released: 0 };

export function actionBit(action: ActionId): number {
  return 1 << ACTIONS.indexOf(action);
}

/** Bit mask of several actions. */
export function actionMask(...actions: readonly ActionId[]): number {
  let mask = 0;
  for (const action of actions) {
    mask |= actionBit(action);
  }
  return mask;
}

export function isHeld(frame: InputFrame, action: ActionId): boolean {
  return (frame.held & actionBit(action)) !== 0;
}

export function isPressed(frame: InputFrame, action: ActionId): boolean {
  return (frame.pressed & actionBit(action)) !== 0;
}

export function isReleased(frame: InputFrame, action: ActionId): boolean {
  return (frame.released & actionBit(action)) !== 0;
}

/** Swaps left and right in every field (for mirror tests). */
export function mirrorFrame(frame: InputFrame): InputFrame {
  const swap = (mask: number) => {
    const left = mask & actionBit('left');
    const right = mask & actionBit('right');
    const rest = mask & ~(actionBit('left') | actionBit('right'));
    return rest | (left ? actionBit('right') : 0) | (right ? actionBit('left') : 0);
  };
  return { held: swap(frame.held), pressed: swap(frame.pressed), released: swap(frame.released) };
}
