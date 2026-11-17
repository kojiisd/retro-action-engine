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
  /** Total `step` calls allowed for one `solveRoom`. Default 50,000,000. */
  readonly maxSteps?: number;
  /** Clock for `stats.elapsedMs` (for example `performance.now`). Without it no time is reported. */
  readonly now?: () => number;
}

export type MacroKind =
  | 'walk'
  | 'stop'
  | 'jump'
  | 'walkOffFall'
  | 'walkOffJump'
  | 'drop'
  | 'switch';

/**
 * A run of adjacent tiles to stand on. Columns are inclusive. For one character, the tiles it
 * can stand on; for a party, the runs of its members merged where they overlap.
 */
export interface Foothold {
  readonly id: string;
  /** Who can stand on (some of) it, in party order. */
  readonly characterIds: readonly string[];
  readonly row: number;
  readonly colFrom: number;
  readonly colTo: number;
  /** Top edge in px (y grows downward). */
  readonly topPx: number;
}

/** A replay that was run from the start state and checked (ADR-0015, the soundness gate). */
export interface Witness {
  readonly replay: ReplayFile;
  readonly ticks: number;
  readonly macros: number;
}

/**
 * Why a foothold cannot be reached, with a proof: true for every input sequence, not only for
 * the macros the search tries (ADR-0015).
 */
export type ProvenBlocker =
  /** The box can never be in the cells above the foothold: walls separate it from the start. */
  | { readonly certainty: 'proven'; readonly reason: 'enclosed' }
  /**
   * Above every level the feet can stand on. `riseNeeded` is the rise it would take from the
   * highest of those levels; `riseBound` is the most any input sequence gives (both Fx).
   */
  | {
      readonly certainty: 'proven';
      readonly reason: 'tooHigh';
      readonly riseNeeded: Fx;
      readonly riseBound: Fx;
    };

/**
 * A hint at why the search did not reach a foothold (ADR-0015, "到達できない理由の推定"). Not a
 * claim that it cannot be reached: a different type from `ProvenBlocker`, told apart by
 * `certainty`, even where the reason has the same name.
 */
export type EstimatedBlocker =
  /** The search was cut short by a limit before it got there. */
  | { readonly certainty: 'estimated'; readonly reason: 'budget' }
  /** With this ability tag added (to every member), the search gets there. */
  | { readonly certainty: 'estimated'; readonly reason: 'needsTag'; readonly tag: string }
  /**
   * Every reached foothold is lower, and the smallest rise from them (`riseNeeded`) is more
   * than a full-hold jump in open air (`rise`, measured; both Fx). Not proven: some other
   * input sequence may rise higher (see `riseBound`).
   */
  | {
      readonly certainty: 'estimated';
      readonly reason: 'tooHigh';
      readonly riseNeeded: Fx;
      readonly rise: Fx;
    }
  /** A reached foothold is high enough, but the search found no way across. */
  | { readonly certainty: 'estimated'; readonly reason: 'tooFar' }
  /** None of the above. */
  | { readonly certainty: 'estimated'; readonly reason: 'unknown' };

/** Why an unreached foothold was not reached: a proof, or else an estimate. */
export type Blocker = ProvenBlocker | EstimatedBlocker;

/**
 * Whether the character can get back to the start foothold from a reached foothold (ADR-0015,
 * "戻れない領域"). The three cases claim different things:
 * - `verified`: a replay from the start goes to this foothold (the first state the search found
 *   on it) and back to the start foothold. It was run and checked. Other states on the foothold
 *   may still be stuck.
 * - `provenNo`: no state standing on this foothold can get back, whatever the inputs: the start
 *   foothold is above every level the feet can stand on from here.
 * - `notFound`: no way back was found from the first state the search found on it, within the
 *   macros and limits. One may exist.
 */
export type ReturnReport =
  | { readonly status: 'verified'; readonly witness: Witness }
  | { readonly status: 'provenNo'; readonly riseNeeded: Fx; readonly riseBound: Fx }
  | { readonly status: 'notFound' };

export interface FootholdReport extends Foothold {
  /** `unreached` means "no path found"; it is impossible only when `blocker` is proven. */
  readonly status: 'reached' | 'unreached';
  /** Reached only: a verified replay from the start state that ends standing on the foothold. */
  readonly witness?: Witness;
  /** Reached only: the way back to the start foothold. */
  readonly return?: ReturnReport;
  /**
   * Unreached only: why. A proven blocker when there is one (it cannot be reached at all),
   * otherwise an estimate (why the search did not get there).
   */
  readonly blocker?: Blocker;
}

/**
 * Who the analysis is for (ADR-0015): one character alone, or the whole party with switching.
 * A party scope is only reported when switching exists (two or more members, `mode: 'anywhere'`).
 */
export type Scope =
  | { readonly kind: 'character'; readonly characterId: string }
  | { readonly kind: 'party'; readonly members: readonly string[] };

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
  /** Searches for a way back to the start foothold (one per foothold that needed one). */
  readonly returnSearches: number;
  /** Searches with a hypothetical ability tag, for the `needsTag` estimate. */
  readonly tagSearches: number;
}

export interface ScopeReport {
  readonly scope: Scope;
  /** False when a limit cut the analysis short: unreached footholds may be reachable. */
  readonly complete: boolean;
  /** Where the character first stands: under the spawn, or where it lands from it. */
  readonly startFootholds: readonly string[];
  /**
   * Upper bound of the rise between two moments of standing, for any inputs (Fx). null when no
   * bound could be given; then nothing is reported as too high and `provenNo` is never used.
   */
  readonly riseBound: Fx | null;
  /**
   * Which proofs this scope could use (ADR-0015, "パーティでの証明"). Without `region` nothing
   * is proven at all; without `height` nothing is proven too high or impossible to return from.
   */
  readonly proofs: { readonly region: boolean; readonly height: boolean };
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
