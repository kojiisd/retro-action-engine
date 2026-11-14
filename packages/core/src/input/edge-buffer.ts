import { ACTIONS, type ActionId, actionBit, type InputFrame } from './frame';

/** Mechanism constants (CLAUDE.md): queue limit and default backlog limit. */
export const MAX_QUEUE = 256;
export const DEFAULT_MAX_BACKLOG_TICKS = 6;

export interface Transition {
  readonly action: ActionId;
  readonly down: boolean;
  /** Arrival order, for debugging. */
  readonly seq: number;
}

export type ResyncReason = 'queueOverflow' | 'backlog' | 'droppedTime' | 'focusLost';

export interface EdgeBufferOptions {
  /** Current physical state as an action mask (keyboard, pads, touch combined). */
  readonly readPhysical: () => number;
  readonly maxQueue?: number;
  readonly maxBacklogTicks?: number;
  /** Called after every resync (dev builds warn here). */
  readonly onResync?: (reason: ResyncReason) => void;
}

/**
 * Turns device transitions into one `InputFrame` per tick (docs/input-and-feel.md 5, ADR-0008).
 * Pure: the physical state comes from `readPhysical`, so the DOM side lives in `input`.
 *
 * Edge rules: per tick, at most one transition of each action is consumed; consumption stops at
 * the second one of an action and the rest waits for the next tick, keeping the global order.
 * Every edge arrives exactly once, in order, and an action is never pressed and released in the
 * same tick.
 */
export class EdgeBuffer {
  private queue: Transition[] = [];
  private seq = 0;
  /** State after every queued transition; pushes that do not change it are dropped. */
  private pendingHeld = 0;
  /** `held` of the last frame returned by `nextFrame`. */
  private issuedHeld = 0;
  private readonly maxQueue: number;
  private readonly maxBacklogTicks: number;
  resyncCount = 0;

  constructor(private readonly options: EdgeBufferOptions) {
    this.maxQueue = options.maxQueue ?? MAX_QUEUE;
    this.maxBacklogTicks = options.maxBacklogTicks ?? DEFAULT_MAX_BACKLOG_TICKS;
  }

  get length(): number {
    return this.queue.length;
  }

  /** Largest number of queued transitions of one action: the ticks needed to drain the queue. */
  get backlogTicks(): number {
    const counts = new Array<number>(ACTIONS.length).fill(0);
    let max = 0;
    for (const t of this.queue) {
      const i = ACTIONS.indexOf(t.action);
      counts[i] = (counts[i] as number) + 1;
      max = Math.max(max, counts[i] as number);
    }
    return max;
  }

  /** Queues a device transition. Checks the resync triggers (a) and (b). */
  push(action: ActionId, down: boolean): void {
    const bit = actionBit(action);
    if (((this.pendingHeld & bit) !== 0) === down) {
      return;
    }
    this.pendingHeld ^= bit;
    this.queue.push({ action, down, seq: this.seq++ });
    if (this.queue.length > this.maxQueue) {
      this.resync('queueOverflow');
    } else if (this.backlogTicks > this.maxBacklogTicks) {
      this.resync('backlog');
    }
  }

  /** Consumes the transitions for one tick. */
  nextFrame(): InputFrame {
    let held = this.issuedHeld;
    let pressed = 0;
    let released = 0;
    let consumed = 0;
    for (const t of this.queue) {
      const bit = actionBit(t.action);
      if (((pressed | released) & bit) !== 0) {
        break;
      }
      if (t.down) {
        held |= bit;
        pressed |= bit;
      } else {
        held &= ~bit;
        released |= bit;
      }
      consumed++;
    }
    this.queue.splice(0, consumed);
    this.issuedHeld = held;
    return { held, pressed, released };
  }

  /**
   * Drops the queue and queues one transition for each action whose last issued state differs
   * from the physical state. `held` matches the physical state one tick later.
   * Triggers: (a) queue overflow and (b) backlog are checked in `push`; the loop driver calls this
   * for (c) dropped time; focus loss (d) passes `physical = 0` (every action released).
   */
  resync(reason: ResyncReason, physical: number = this.options.readPhysical()): void {
    this.queue = [];
    this.pendingHeld = this.issuedHeld;
    for (const action of ACTIONS) {
      const bit = actionBit(action);
      const down = (physical & bit) !== 0;
      if (((this.issuedHeld & bit) !== 0) !== down) {
        this.pendingHeld ^= bit;
        this.queue.push({ action, down, seq: this.seq++ });
      }
    }
    this.resyncCount++;
    this.options.onResync?.(reason);
  }
}
