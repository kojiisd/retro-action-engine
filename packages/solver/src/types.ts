import type { Fx, ReplayFile } from '@retro-action-engine/core';

/** Analysis knobs (ADR-0015). Defaults are derived from the pack data. */
export interface SolverOptions {
  /** Positions closer than this share a search node. Default: tileSize / 8, at least 1 px. */
  readonly xQuantum?: Fx;
  /** Velocities closer than this share a search node. Default: half the active runSpeed. */
  readonly vQuantum?: Fx;
  /** How many jump hold lengths to try when the profile has a variable jump. Default 4. */
  readonly jumpHoldSamples?: number;
  /** A macro that has not landed after this many ticks is dropped. Default 600. */
  readonly maxMacroTicks?: number;
  /** Search node limit per exploration. Default 20,000. */
  readonly maxNodes?: number;
  /** Total `step` calls allowed for one `solveRoom`. Default 5,000,000. */
  readonly maxSteps?: number;
  /** Clock for `stats.elapsedMs` (for example `performance.now`). Without it no time is reported. */
  readonly now?: () => number;
}

export type MacroKind = 'walk' | 'stop' | 'jump' | 'walkOffFall' | 'walkOffJump' | 'drop';

/** A run of adjacent tiles one character can stand on. Columns are inclusive. */
export interface Foothold {
  readonly id: string;
  readonly characterId: string;
  readonly row: number;
  readonly colFrom: number;
  readonly colTo: number;
  /** Top edge in px (y grows downward). */
  readonly topPx: number;
}

export interface FootholdReport extends Foothold {
  readonly status: 'reached' | 'unreached';
  /** Reached only: a verified replay from the start state that ends standing on the foothold. */
  readonly witness?: {
    readonly replay: ReplayFile;
    readonly ticks: number;
    readonly macros: number;
  };
}

/** Who the analysis is for. Stage 1 solves one character at a time (ADR-0015). */
export interface Scope {
  readonly kind: 'character';
  readonly characterId: string;
}

export interface SolveStats {
  /** Search nodes: distinct landing states after quantization. */
  readonly nodes: number;
  readonly edges: number;
  /** Macros simulated. */
  readonly macros: number;
  /** `step` calls made by the search (witness replays are not counted). */
  readonly steps: number;
  /** Macros dropped because they did not land within `maxMacroTicks`. */
  readonly timeouts: number;
  /** Witness replays run through `runReplayHeadless` and checked. */
  readonly replaysVerified: number;
}

export interface ScopeReport {
  readonly scope: Scope;
  /** False when a limit cut the analysis short: unreached footholds may be reachable. */
  readonly complete: boolean;
  readonly startFootholds: readonly string[];
  readonly footholds: readonly FootholdReport[];
  /** Transitions seen between footholds, with the kinds of macro that made them. */
  readonly edges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly kinds: readonly MacroKind[];
  }>;
  readonly stats: SolveStats;
}

export interface SolveReport {
  readonly roomId: string;
  readonly feelProfile: string;
  readonly complete: boolean;
  readonly scopes: readonly ScopeReport[];
  readonly limits: {
    readonly xQuantum: Fx;
    readonly jumpHoldSamples: number;
    readonly maxMacroTicks: number;
    readonly maxNodes: number;
    readonly maxSteps: number;
  };
  readonly totals: { readonly steps: number; readonly elapsedMs?: number };
}
