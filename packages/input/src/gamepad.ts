import type { GamepadInputId } from '@retro-action-engine/core';
import type { ActionMap } from './action-map';
import type { PhysicalSource } from './input-buffer';
import type { SourceSink } from './keyboard';

/** The fields of a `Gamepad` the device reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: ArrayLike<{ readonly pressed: boolean }>;
  readonly axes: ArrayLike<number>;
}

/** Standard mapping (W3C Gamepad): d-pad buttons and left stick axes. */
const DPAD: ReadonlyArray<readonly [number, GamepadInputId]> = [
  [12, 'dpadUp'],
  [13, 'dpadDown'],
  [14, 'dpadLeft'],
  [15, 'dpadRight'],
];
const AXIS_X = 0;
const AXIS_Y = 1;

interface PadState {
  /** Inputs that were down at the last poll. */
  down: Set<GamepadInputId>;
  /** Stick directions that are down (hysteresis keeps them until `release`). */
  stick: { up: boolean; down: boolean; left: boolean; right: boolean };
}

/**
 * Gamepads (docs/input-and-feel.md 3.2). `poll()` is called at the start of each frame, before
 * ticks are taken. Only standard-mapping pads are read (others wait for the M2 binding UI). The
 * pad with the latest new input is the active one and the only one read; when it disconnects,
 * everything it held is released.
 */
export class GamepadDevice implements PhysicalSource {
  private readonly pads = new Map<number, PadState>();
  private active: number | undefined;
  private mask = 0;

  constructor(
    private readonly map: ActionMap,
    private readonly sink: SourceSink,
    private readonly getGamepads: () => ArrayLike<GamepadLike | null>,
  ) {}

  /** Index of the pad being read, if any. */
  get activeIndex(): number | undefined {
    return this.active;
  }

  held(): number {
    return this.mask;
  }

  poll(): void {
    const seen = new Set<number>();
    const list = Array.from(this.getGamepads()).filter(
      (pad): pad is GamepadLike => pad !== null && pad.connected && pad.mapping === 'standard',
    );
    // Lowest index first, so that two pads pressed in the same frame resolve the same way.
    list.sort((a, b) => a.index - b.index);
    for (const pad of list) {
      seen.add(pad.index);
      const state = this.pads.get(pad.index) ?? {
        down: new Set<GamepadInputId>(),
        stick: { up: false, down: false, left: false, right: false },
      };
      const down = this.read(pad, state);
      for (const id of down) {
        if (!state.down.has(id)) {
          this.active = pad.index;
          break;
        }
      }
      state.down = down;
      this.pads.set(pad.index, state);
    }
    for (const index of [...this.pads.keys()]) {
      if (!seen.has(index)) this.pads.delete(index);
    }
    if (this.active !== undefined && !this.pads.has(this.active)) this.active = undefined;

    let mask = 0;
    const state = this.active === undefined ? undefined : this.pads.get(this.active);
    for (const id of state?.down ?? []) mask |= this.map.gamepad(id);
    this.mask = mask;
    this.sink.sourceChanged();
  }

  /** Every input of the pad that is down now (bound or not: any of them makes the pad active). */
  private read(pad: GamepadLike, state: PadState): Set<GamepadInputId> {
    const down = new Set<GamepadInputId>();
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed === true) down.add(`button${i}`);
    }
    for (const [button, id] of DPAD) {
      if (pad.buttons[button]?.pressed === true) down.add(id);
    }
    const { deadzone, release } = this.map.analog;
    const digital = (was: boolean, amount: number) => (was ? amount > release : amount >= deadzone);
    const x = pad.axes[AXIS_X] ?? 0;
    const y = pad.axes[AXIS_Y] ?? 0;
    const s = state.stick;
    s.left = digital(s.left, -x);
    s.right = digital(s.right, x);
    s.up = digital(s.up, -y);
    s.down = digital(s.down, y);
    if (s.left) down.add('leftStickLeft');
    if (s.right) down.add('leftStickRight');
    if (s.up) down.add('leftStickUp');
    if (s.down) down.add('leftStickDown');
    return down;
  }
}
