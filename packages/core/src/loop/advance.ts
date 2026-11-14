/**
 * Fixed-timestep accumulator (ADR-0003). Pure: no clock, no DOM. The driver passes the frame time
 * it measured; the result says how many ticks to run this frame and how far the display is
 * between the last two ticks.
 */
export interface LoopConfig {
  /** Ticks per second. */
  readonly tickRate: number;
  /** Longer frames are cut to this. */
  readonly maxFrameMs: number;
  /** Ticks beyond this in one frame are discarded. */
  readonly maxTicksPerFrame: number;
}

/** Mechanism constants named in CLAUDE.md: 60 Hz, 250 ms, 5 ticks. */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  tickRate: 60,
  maxFrameMs: 250,
  maxTicksPerFrame: 5,
};

/** One tick is 1000 units; a frame adds `frameMs * tickRate` units. */
export const UNITS_PER_TICK = 1000;

export interface LoopState {
  accUnits: number;
}

export interface AdvanceResult {
  readonly ticks: number;
  /** 0 <= alpha < 1: interpolation factor between the previous and the current tick. */
  readonly alpha: number;
  /** Time was thrown away (frame clamped or too many ticks): a resync trigger (ADR-0008 (c)). */
  readonly dropped: boolean;
}

export function newLoopState(): LoopState {
  return { accUnits: 0 };
}

export function advance(
  state: LoopState,
  frameMs: number,
  config: LoopConfig = DEFAULT_LOOP_CONFIG,
): AdvanceResult {
  let dropped = false;
  let ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
  if (ms > config.maxFrameMs) {
    ms = config.maxFrameMs;
    dropped = true;
  }
  state.accUnits += ms * config.tickRate;
  let ticks = Math.floor(state.accUnits / UNITS_PER_TICK);
  if (ticks > config.maxTicksPerFrame) {
    ticks = config.maxTicksPerFrame;
    state.accUnits = ticks * UNITS_PER_TICK;
    dropped = true;
  }
  state.accUnits -= ticks * UNITS_PER_TICK;
  return { ticks, alpha: state.accUnits / UNITS_PER_TICK, dropped };
}
