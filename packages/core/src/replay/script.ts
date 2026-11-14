import { type ActionId, actionBit, type InputFrame } from '../input/frame';

interface Interval {
  readonly action: ActionId;
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
}

/**
 * Builds `InputFrame` sequences for Feel scenarios (docs/input-and-feel.md 11.2):
 *
 *   script().hold('right', 30).tap('jump', { at: 10 }).build()
 *
 * `hold` and `wait` advance a cursor; `tap` and `press` with `at` place an input at an absolute
 * tick without moving it. The result follows the edge rules: an action is pressed on the first
 * tick it is held and released on the first tick after, never both in one tick. Overlapping or
 * touching intervals of one action merge into one hold.
 */
export class Script {
  private cursor = 0;
  private readonly intervals: Interval[] = [];
  private length = 0;

  /** Holds the actions for `ticks` ticks from the cursor, then moves the cursor past them. */
  hold(actions: ActionId | readonly ActionId[], ticks: number): this {
    this.add(actions, this.cursor, ticks);
    this.cursor += ticks;
    return this;
  }

  /** Moves the cursor without input. */
  wait(ticks: number): this {
    this.cursor += ticks;
    this.length = Math.max(this.length, this.cursor);
    return this;
  }

  /** A one-tick press, at `at` or at the cursor (the cursor does not move). */
  tap(actions: ActionId | readonly ActionId[], options: { at?: number } = {}): this {
    return this.press(actions, { at: options.at, ticks: 1 });
  }

  /** A press of `ticks` ticks, at `at` or at the cursor (the cursor does not move). */
  press(
    actions: ActionId | readonly ActionId[],
    options: { at?: number | undefined; ticks: number },
  ): this {
    this.add(actions, options.at ?? this.cursor, options.ticks);
    return this;
  }

  /** Frames up to the last input or cursor, plus one tick so that the last release is seen. */
  build(totalTicks?: number): InputFrame[] {
    const count = totalTicks ?? this.length + 1;
    const heldAt = (tick: number): number => {
      let mask = 0;
      for (const { action, from, to } of this.intervals) {
        if (tick >= from && tick < to) {
          mask |= actionBit(action);
        }
      }
      return mask;
    };
    const frames: InputFrame[] = [];
    let previous = 0;
    for (let tick = 0; tick < count; tick++) {
      const held = heldAt(tick);
      frames.push({ held, pressed: held & ~previous, released: previous & ~held });
      previous = held;
    }
    return frames;
  }

  private add(actions: ActionId | readonly ActionId[], from: number, ticks: number): void {
    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(ticks) || ticks < 1) {
      throw new RangeError(`invalid input interval: at ${from} for ${ticks} ticks`);
    }
    const list: readonly ActionId[] = typeof actions === 'string' ? [actions] : actions;
    for (const action of list) {
      this.intervals.push({ action, from, to: from + ticks });
    }
    this.length = Math.max(this.length, from + ticks, this.cursor);
  }
}

export function script(): Script {
  return new Script();
}
