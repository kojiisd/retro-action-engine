/**
 * The debug display (ADR-0008, revision M2-3): only in dev builds and PR previews, never in
 * production. English only (a tool for development, not part of the game's text).
 */

/** The build-time values that tell where the app runs. */
export interface DebugEnv {
  readonly DEV?: boolean;
  readonly VITE_PR_NUMBER?: string;
  readonly VITE_E2E_HOOKS?: string;
}

/** True in dev builds, PR previews and e2e builds; false in production. */
export function debugAllowed(env: DebugEnv): boolean {
  return (
    env.DEV === true ||
    (env.VITE_PR_NUMBER !== undefined && env.VITE_PR_NUMBER.trim() !== '') ||
    env.VITE_E2E_HOOKS === '1'
  );
}

/** Labels of the debug section of the settings screen. */
export const DEBUG_TEXT = {
  title: 'Debug (dev and previews only)',
  hitboxes: 'Show collision boxes',
  latency: 'Show latency and frame stats',
  desynchronized: 'Desynchronized canvas (applies after reload)',
} as const;

const KEEP = 30;

/**
 * Input-to-draw latency and frame stats (docs/input-and-feel.md 10). A press starts a sample; the
 * first frame that runs ticks after it, once drawn, ends it. `now` is the page clock (ms).
 */
export class LatencyMeter {
  private pending: number | undefined;
  private readonly samples: number[] = [];
  private readonly frameTimes: number[] = [];
  private ticksThisFrame = 0;
  private maxTicks = 0;

  constructor(private readonly now: () => number) {}

  /** An action was pressed (any device). Only the first press until the next drawn tick counts. */
  pressed(): void {
    this.pending ??= this.now();
  }

  /** The frame ran this many ticks. */
  ticked(ticks: number): void {
    this.ticksThisFrame = ticks;
    this.maxTicks = Math.max(this.maxTicks, ticks);
  }

  /** The frame was drawn. */
  drawn(): void {
    const t = this.now();
    this.frameTimes.push(t);
    while (this.frameTimes.length > 0 && t - (this.frameTimes[0] as number) > 1000)
      this.frameTimes.shift();
    if (this.pending !== undefined && this.ticksThisFrame > 0) {
      this.samples.push(t - this.pending);
      if (this.samples.length > KEEP) this.samples.shift();
      this.pending = undefined;
    }
  }

  stats(): { last?: number; avg?: number; max?: number; fps: number; maxTicks: number } {
    const n = this.samples.length;
    const out = { fps: this.frameTimes.length, maxTicks: this.maxTicks };
    if (n === 0) return out;
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return { ...out, last: this.samples[n - 1], avg: sum / n, max: Math.max(...this.samples) };
  }
}

/** One line of text for the overlay. */
export function formatStats(
  s: ReturnType<LatencyMeter['stats']>,
  extra: {
    readonly droppedFrames: number;
    readonly resyncs: number;
    readonly desynchronized: boolean;
  },
): string {
  const ms = (v: number | undefined) => (v === undefined ? '-' : v.toFixed(1));
  return [
    `input→draw ms last ${ms(s.last)} avg ${ms(s.avg)} max ${ms(s.max)}`,
    `fps ${s.fps}  ticks/frame max ${s.maxTicks}  dropped ${extra.droppedFrames}  resyncs ${extra.resyncs}`,
    `desynchronized ${extra.desynchronized ? 'on' : 'off'}`,
  ].join('\n');
}
