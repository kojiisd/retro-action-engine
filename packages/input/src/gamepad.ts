import type { GamepadInputId } from '@retro-action-engine/core';
import { type ActionMap, STANDARD_PAD } from './action-map';
import type { PhysicalSource } from './input-buffer';
import type { SourceSink } from './keyboard';

/** The fields of a `Gamepad` the device reads. */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: ArrayLike<{ readonly pressed: boolean }>;
  readonly axes: ArrayLike<number>;
}

/** Standard mapping (W3C Gamepad): the d-pad buttons and the left stick's axes. */
const DPAD: ReadonlyArray<readonly [number, GamepadInputId]> = [
  [12, 'dpadUp'],
  [13, 'dpadDown'],
  [14, 'dpadLeft'],
  [15, 'dpadRight'],
];
const STICK: ReadonlyArray<readonly [GamepadInputId, GamepadInputId]> = [
  ['axis0-', 'leftStickLeft'],
  ['axis0+', 'leftStickRight'],
  ['axis1-', 'leftStickUp'],
  ['axis1+', 'leftStickDown'],
];

/** For capture on a standard pad: the named input stands for the raw one. */
const NAMED_FOR_RAW: ReadonlyMap<string, GamepadInputId> = new Map<string, GamepadInputId>([
  ...DPAD.map(([button, id]) => [`button${button}`, id] as const),
  ...STICK,
]);

interface PadState {
  /** `STANDARD_PAD` or the pad's `Gamepad.id`: which bindings it uses. */
  readonly key: string;
  /** Inputs that were down at the last poll. */
  down: Set<GamepadInputId>;
  /** Axis directions that are down (hysteresis keeps them until `release`). */
  readonly axes: Set<GamepadInputId>;
}

/** A newly pressed gamepad input, for the key config (docs/input-and-feel.md 4.3). */
export type GamepadCapture = (pad: string, input: GamepadInputId) => void;

/**
 * Gamepads (docs/input-and-feel.md 3.2, 4.4). `poll()` is called at the start of each frame,
 * before ticks are taken. Standard-mapping pads use the standard bindings; a non-standard pad is
 * read only when the user bound something for its `Gamepad.id`. The pad with the latest new input
 * is the active one and the only one read; when it disconnects, everything it held is released.
 */
export class GamepadDevice implements PhysicalSource {
  private readonly pads = new Map<number, PadState>();
  private active: number | undefined;
  private mask = 0;
  private capture: GamepadCapture | undefined;

  constructor(
    private readonly map: ActionMap,
    private readonly sink: SourceSink,
    private readonly getGamepads: () => ArrayLike<GamepadLike | null>,
  ) {}

  /** True while a pad that can be read (standard, or bound by the user) is connected. */
  get connected(): boolean {
    for (const state of this.pads.values()) if (this.map.readsPad(state.key)) return true;
    return false;
  }

  /** Index of the pad being read, if any. */
  get activeIndex(): number | undefined {
    return this.active;
  }

  /** While set, every newly pressed input of any pad is reported here as well. */
  setCapture(capture: GamepadCapture | undefined): void {
    this.capture = capture;
  }

  held(): number {
    return this.mask;
  }

  poll(): void {
    const seen = new Set<number>();
    const list = Array.from(this.getGamepads()).filter(
      (pad): pad is GamepadLike => pad?.connected === true,
    );
    // Lowest index first, so that two pads pressed in the same frame resolve the same way.
    list.sort((a, b) => a.index - b.index);
    for (const pad of list) {
      seen.add(pad.index);
      const key = pad.mapping === 'standard' ? STANDARD_PAD : pad.id;
      let state = this.pads.get(pad.index);
      if (state === undefined || state.key !== key) {
        state = { key, down: new Set(), axes: new Set() };
      }
      const down = this.read(pad, state);
      let fresh = false;
      for (const id of down) {
        if (state.down.has(id)) continue;
        fresh = true;
        this.report(key, id);
      }
      if (fresh && this.map.readsPad(key)) this.active = pad.index;
      state.down = down;
      this.pads.set(pad.index, state);
    }
    for (const index of [...this.pads.keys()]) {
      if (!seen.has(index)) this.pads.delete(index);
    }
    const activeState = this.active === undefined ? undefined : this.pads.get(this.active);
    if (activeState === undefined || !this.map.readsPad(activeState.key)) this.active = undefined;

    let mask = 0;
    const state = this.active === undefined ? undefined : this.pads.get(this.active);
    for (const id of state?.down ?? []) mask |= this.map.gamepad(id, state?.key);
    this.mask = mask;
    this.sink.sourceChanged();
  }

  /** Reports a new input to the capture, once per physical control. */
  private report(pad: string, id: GamepadInputId): void {
    if (this.capture === undefined) return;
    // On a standard pad, the d-pad and the left stick are captured by their names only.
    if (pad === STANDARD_PAD && NAMED_FOR_RAW.has(id)) return;
    this.capture(pad, id);
  }

  /** Every input of the pad that is down now (bound or not: any of them makes the pad active). */
  private read(pad: GamepadLike, state: PadState): Set<GamepadInputId> {
    const down = new Set<GamepadInputId>();
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i]?.pressed === true) down.add(`button${i}`);
    }
    const { deadzone, release } = this.map.analog;
    for (let i = 0; i < pad.axes.length; i++) {
      const value = pad.axes[i] ?? 0;
      for (const [id, amount] of [
        [`axis${i}+`, value],
        [`axis${i}-`, -value],
      ] as const) {
        const was = state.axes.has(id);
        if (was ? amount > release : amount >= deadzone) {
          state.axes.add(id);
          down.add(id);
        } else {
          state.axes.delete(id);
        }
      }
    }
    if (state.key === STANDARD_PAD) {
      for (const [raw, id] of NAMED_FOR_RAW) {
        if (down.has(raw as GamepadInputId)) down.add(id);
      }
    }
    return down;
  }
}
