import {
  type CharacterDef,
  type CollisionContext,
  type CollisionGrid,
  effectiveTags,
  FX_ONE,
  type Fx,
  solidAt,
  type World,
} from '@retro-action-engine/core';
import type { Foothold, ProvenBlocker } from './types';

/** Tile column or row of an Fx coordinate (floor, also for negatives). */
function cellOf(v: number, tileSize: number): number {
  return Math.floor((v >> 8) / tileSize);
}

/**
 * Proofs that something cannot be done (ADR-0015, "証明つきの「不可能」"). Both over-estimate
 * where the character can go, so "outside the estimate" is certain. Nothing here simulates and
 * nothing here is used to report that a place can be reached.
 *
 * For a party, a cell is closed only when it is full for every member, and a row is a level
 * when any member can stand on it ("パーティでの証明"). The caller decides whether the party
 * rules allow these proofs at all.
 *
 * - The open region: the box never overlaps a full tile, and it moves one axis at a time in
 *   steps of at most a tile, so the cells it overlaps always stay in the 4-connected set of
 *   non-full cells it started in. Oneway tiles count as open.
 * - Standing levels: from feet at level y, the next place to stand is never above y - riseBound
 *   (`measureRiseBound`). Every row with a supporting tile next to the open region is assumed
 *   to be reachable when it is low enough, whatever lies in between.
 */
export class Proofs {
  private readonly contexts: readonly CollisionContext[];
  /** 1 for every cell of the open region, row-major. */
  private readonly region: Uint8Array;
  /** Levels (Fx, y down) of the rows the feet could rest on, lowest level (largest y) first. */
  private readonly levels: number[] = [];
  /** The highest level the feet can stand on, coming from the start (smallest y). */
  private readonly topFromStart: number;

  private constructor(
    private readonly grid: CollisionGrid,
    contexts: readonly CollisionContext[],
    startCells: ReadonlyArray<readonly [col: number, row: number]>,
    startBottom: Fx,
    /** Upper bound of the rise between two moments of standing. May be Infinity. */
    readonly riseBound: Fx,
  ) {
    this.contexts = contexts;
    this.region = this.flood(startCells);
    const size = grid.tileSize * FX_ONE;
    // The room border below the last row is a floor too, but it is the lowest level there is,
    // and only levels above the feet matter for climbing.
    for (let row = grid.heightTiles - 1; row >= 1; row--) {
      for (let col = 0; col < grid.widthTiles; col++) {
        if (this.inRegion(col, row - 1) && this.supports(col, row)) {
          this.levels.push(row * size);
          break;
        }
      }
    }
    this.topFromStart = this.highestLevelFrom(startBottom);
  }

  /**
   * Builds the proofs for the party (one member or more) at the start of `world` (before any
   * tick). Returns undefined when the box starts in a closed cell: the arguments above do not
   * cover that.
   */
  static of(
    grid: CollisionGrid,
    members: readonly CharacterDef[],
    world: World,
    riseBound: Fx,
  ): Proofs | undefined {
    const s = world.entities;
    const slot = s.slotOf(world.party.entityId);
    const T = grid.tileSize;
    const left = (s.x[slot] as number) + (s.colOx[slot] as number);
    const top = (s.y[slot] as number) + (s.colOy[slot] as number);
    const width = s.colW[slot] as number;
    const height = s.colH[slot] as number;
    if (width <= 0 || height <= 0) {
      return undefined;
    }
    if (members.length === 0) {
      return undefined;
    }
    const contexts = members.map((member) => ({ abilityTags: effectiveTags(member) }));
    const closed = (col: number, row: number) =>
      contexts.every((context) => solidAt(grid, col, row, context) === 'full');
    const cells: Array<readonly [number, number]> = [];
    for (let row = cellOf(top, T); row <= cellOf(top + height - 1, T); row++) {
      for (let col = cellOf(left, T); col <= cellOf(left + width - 1, T); col++) {
        if (closed(col, row)) {
          return undefined;
        }
        cells.push([col, row]);
      }
    }
    return new Proofs(grid, contexts, cells, top + height, riseBound);
  }

  /** Full for every member: no member's box can ever enter it. */
  private closed(col: number, row: number): boolean {
    return this.contexts.every((context) => solidAt(this.grid, col, row, context) === 'full');
  }

  /** Some member could stand on top of this tile. */
  private supports(col: number, row: number): boolean {
    return this.contexts.some((context) => solidAt(this.grid, col, row, context) !== 'none');
  }

  private inRegion(col: number, row: number): boolean {
    const { widthTiles, heightTiles } = this.grid;
    if (col < 0 || row < 0 || col >= widthTiles || row >= heightTiles) {
      return false;
    }
    return this.region[row * widthTiles + col] === 1;
  }

  private flood(startCells: ReadonlyArray<readonly [number, number]>): Uint8Array {
    const { widthTiles, heightTiles } = this.grid;
    const region = new Uint8Array(widthTiles * heightTiles);
    const stack: number[] = [];
    const visit = (col: number, row: number) => {
      if (col < 0 || row < 0 || col >= widthTiles || row >= heightTiles) return;
      const index = row * widthTiles + col;
      if (region[index] === 1 || this.closed(col, row)) return;
      region[index] = 1;
      stack.push(index);
    };
    for (const [col, row] of startCells) {
      visit(col, row);
    }
    for (let index = stack.pop(); index !== undefined; index = stack.pop()) {
      const col = index % widthTiles;
      const row = (index - col) / widthTiles;
      visit(col - 1, row);
      visit(col + 1, row);
      visit(col, row - 1);
      visit(col, row + 1);
    }
    return region;
  }

  /**
   * The highest level (smallest y) the feet can ever stand on, starting with the feet at
   * `bottom`: climb from level to level while the next one is within the rise bound.
   */
  highestLevelFrom(bottom: Fx): Fx {
    let top = bottom;
    for (const level of this.levels) {
      if (level < top && level >= top - this.riseBound) {
        top = level;
      }
    }
    return top;
  }

  /** True when the box can never be in the cells right above this foothold. */
  private enclosed(foothold: Foothold): boolean {
    for (let col = foothold.colFrom; col <= foothold.colTo; col++) {
      if (this.inRegion(col, foothold.row - 1)) {
        return false;
      }
    }
    return true;
  }

  /** A proof that the foothold cannot be reached from the start, if there is one. */
  unreachable(foothold: Foothold): ProvenBlocker | undefined {
    if (this.enclosed(foothold)) {
      return { certainty: 'proven', reason: 'enclosed' };
    }
    const level = foothold.topPx * FX_ONE;
    if (level < this.topFromStart) {
      return {
        certainty: 'proven',
        reason: 'tooHigh',
        riseNeeded: this.topFromStart - level,
        riseBound: this.riseBound,
      };
    }
    return undefined;
  }

  /**
   * A proof that no state standing on `from` can get to `to`: `to` is above every level the
   * feet can stand on when they start on `from`. Returns the rise that would be needed.
   */
  cannotClimb(from: Foothold, to: Foothold): { riseNeeded: Fx; riseBound: Fx } | undefined {
    const top = this.highestLevelFrom(from.topPx * FX_ONE);
    const level = to.topPx * FX_ONE;
    return level < top ? { riseNeeded: top - level, riseBound: this.riseBound } : undefined;
  }
}
