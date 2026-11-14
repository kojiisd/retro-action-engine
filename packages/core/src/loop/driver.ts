import {
  type AdvanceResult,
  advance,
  DEFAULT_LOOP_CONFIG,
  type LoopConfig,
  newLoopState,
} from './advance';

export interface LoopHooks {
  /** Runs one simulation tick (input sampling, step, recording). */
  readonly tick: () => void;
  /** Called before the ticks of a frame that dropped time (resync the live input). */
  readonly dropped?: () => void;
}

/**
 * The pure part of the frame loop (docs/architecture.md 4.2, docs/input-and-feel.md 5.3). The
 * renderer calls `frame(deltaMs)` once per requestAnimationFrame; this runs the ticks the
 * accumulator allows. Tick results do not depend on how frame times are split.
 */
export class LoopDriver {
  private readonly state = newLoopState();

  constructor(
    private readonly hooks: LoopHooks,
    private readonly config: LoopConfig = DEFAULT_LOOP_CONFIG,
  ) {}

  frame(frameMs: number): AdvanceResult {
    const result = advance(this.state, frameMs, this.config);
    if (result.dropped) {
      this.hooks.dropped?.();
    }
    for (let i = 0; i < result.ticks; i++) {
      this.hooks.tick();
    }
    return result;
  }
}
