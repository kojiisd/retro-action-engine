import {
  ACTIONS,
  type ActionId,
  actionBit,
  EdgeBuffer,
  type InputFrame,
  type ResyncReason,
} from '@retro-action-engine/core';

/** A device's current physical state as an action mask (keyboard keys, pad buttons, touches). */
export interface PhysicalSource {
  readonly held: () => number;
}

export interface InputBufferOptions {
  /** Backlog limit in ticks before a resync (docs/input-and-feel.md 5.2 (b)). Default 6. */
  readonly maxBacklogTicks?: number;
  readonly onResync?: (reason: ResyncReason) => void;
}

/** The parts of `window` and `document` the buffer listens to. */
export interface FocusTargets {
  readonly window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  readonly document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
  };
}

/**
 * The DOM side of the InputBuffer (docs/input-and-feel.md 5, ADR-0008). Devices report
 * transitions with `transition`; the physical state for resyncs is the union of the registered
 * sources. Focus loss (`blur`, `visibilitychange` to hidden) resyncs with every action released.
 * The edge rules themselves live in core's `EdgeBuffer`.
 */
export class InputBuffer {
  private readonly sources: PhysicalSource[] = [];
  private readonly edges: EdgeBuffer;
  /** The union last reported through `sourceChanged` (or forced by a focus-loss resync). */
  private reported = 0;

  constructor(options: InputBufferOptions = {}) {
    this.edges = new EdgeBuffer({
      readPhysical: () => this.physical(),
      ...(options.maxBacklogTicks === undefined
        ? {}
        : { maxBacklogTicks: options.maxBacklogTicks }),
      ...(options.onResync === undefined ? {} : { onResync: options.onResync }),
    });
  }

  get resyncCount(): number {
    return this.edges.resyncCount;
  }

  /** Registers a device. Returns a function that unregisters it. */
  addSource(source: PhysicalSource): () => void {
    this.sources.push(source);
    return () => {
      const i = this.sources.indexOf(source);
      if (i >= 0) this.sources.splice(i, 1);
    };
  }

  /** Union of every source's physical state. */
  physical(): number {
    let mask = 0;
    for (const source of this.sources) {
      mask |= source.held();
    }
    return mask;
  }

  /** A device saw an action go down or up. Prefer `sourceChanged` for devices that are sources. */
  transition(action: ActionId, down: boolean): void {
    this.edges.push(action, down);
  }

  /**
   * A registered source changed its state. Queues one transition for each action whose union
   * over all sources changed, in action order. An action held by two devices stays held until
   * both let go.
   */
  sourceChanged(): void {
    const now = this.physical();
    const changed = now ^ this.reported;
    this.reported = now;
    if (changed === 0) return;
    for (const action of ACTIONS) {
      const bit = actionBit(action);
      if ((changed & bit) !== 0) this.edges.push(action, (now & bit) !== 0);
    }
  }

  /** The frame for the next tick. Call right before `step`. */
  nextFrame(): InputFrame {
    return this.edges.nextFrame();
  }

  /** Resync trigger (c): the loop driver threw time away. */
  droppedTime(): void {
    this.edges.resync('droppedTime');
  }

  /** Resync trigger (d): focus lost; every action counts as released. */
  focusLost(): void {
    this.reported = 0;
    this.edges.resync('focusLost', 0);
  }

  /** Listens for focus loss. Returns a function that removes the listeners. */
  attachFocusEvents(targets: FocusTargets): () => void {
    const onBlur = () => this.focusLost();
    const onVisibility = () => {
      if (targets.document.visibilityState === 'hidden') this.focusLost();
    };
    targets.window.addEventListener('blur', onBlur);
    targets.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      targets.window.removeEventListener('blur', onBlur);
      targets.document.removeEventListener('visibilitychange', onVisibility);
    };
  }
}
