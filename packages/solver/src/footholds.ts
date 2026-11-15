import {
  type CharacterDef,
  CONTACT_GROUNDED,
  type CollisionContext,
  type CollisionGrid,
  effectiveTags,
  FX_ONE,
  solidAt,
  type World,
} from '@retro-action-engine/core';
import type { Foothold } from './types';

/** floor(a / b) for integers. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Tile column or row of an Fx coordinate. */
function cellOf(v: number, tileSize: number): number {
  return floorDiv(v >> 8, tileSize);
}

function supports(kind: string): boolean {
  return kind === 'full' || kind === 'oneway';
}

/** True when the character's box, standing on the top of `row` with its center at x, is clear. */
function boxIsClear(
  grid: CollisionGrid,
  character: CharacterDef,
  context: CollisionContext,
  x: number,
  row: number,
): boolean {
  const T = grid.tileSize;
  const { w, h, ox } = character.collider;
  const bottom = row * T * FX_ONE;
  const left = x + ox;
  const colFirst = cellOf(left, T);
  const colLast = cellOf(left + w - 1, T);
  const rowFirst = cellOf(bottom - h, T);
  for (let r = rowFirst; r < row; r++) {
    for (let c = colFirst; c <= colLast; c++) {
      if (solidAt(grid, c, r, context) === 'full') {
        return false;
      }
    }
  }
  return true;
}

/**
 * Lists the footholds of one character: runs of adjacent tiles that are solid for it (full or
 * oneway, tags considered) and have room for its box on top. This is a list of shapes only;
 * whether a foothold is reachable is decided by simulation, never from this list.
 */
export function listFootholds(grid: CollisionGrid, character: CharacterDef): Foothold[] {
  const T = grid.tileSize;
  const context: CollisionContext = { abilityTags: effectiveTags(character) };
  const { w, ox } = character.collider;
  const footholds: Foothold[] = [];
  for (let row = 0; row < grid.heightTiles; row++) {
    let runStart = -1;
    for (let col = 0; col <= grid.widthTiles; col++) {
      let standable = false;
      if (col < grid.widthTiles && supports(solidAt(grid, col, row, context))) {
        // Every center position, in 1 px steps, at which the box overlaps this column.
        const firstPx = Math.floor((col * T * FX_ONE - ox - w) / FX_ONE) + 1;
        const lastPx = Math.ceil(((col + 1) * T * FX_ONE - ox) / FX_ONE) - 1;
        for (let px = firstPx; px <= lastPx && !standable; px++) {
          standable = boxIsClear(grid, character, context, px * FX_ONE, row);
        }
      }
      if (standable && runStart < 0) {
        runStart = col;
      } else if (!standable && runStart >= 0) {
        footholds.push({
          id: `${character.id}:r${row}c${runStart}-${col - 1}`,
          characterId: character.id,
          row,
          colFrom: runStart,
          colTo: col - 1,
          topPx: row * T,
        });
        runStart = -1;
      }
    }
  }
  return footholds;
}

/** Looks footholds up by character and tile. */
export class FootholdIndex {
  readonly all: Foothold[] = [];
  private readonly byCell = new Map<string, number>();

  constructor(grid: CollisionGrid, members: readonly CharacterDef[]) {
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      for (const foothold of listFootholds(grid, member)) {
        const index = this.all.length;
        this.all.push(foothold);
        for (let col = foothold.colFrom; col <= foothold.colTo; col++) {
          this.byCell.set(`${member.id}|${foothold.row}|${col}`, index);
        }
      }
    }
  }

  at(characterId: string, row: number, col: number): number {
    return this.byCell.get(`${characterId}|${row}|${col}`) ?? -1;
  }
}

/**
 * Footholds the active character is standing on in this state: the tiles under its box that hold
 * it up. Empty when it is in the air. Sorted, without duplicates.
 */
export function standingOn(
  grid: CollisionGrid,
  index: FootholdIndex,
  world: World,
  character: CharacterDef,
): number[] {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  if (((s.contact[slot] as number) & CONTACT_GROUNDED) === 0) {
    return [];
  }
  const T = grid.tileSize;
  const bottom = (s.y[slot] as number) + (s.colOy[slot] as number) + (s.colH[slot] as number);
  const row = cellOf(bottom, T);
  if (row * T * FX_ONE !== bottom) {
    return [];
  }
  // The contact flags come from the tick that just ran (world.tick - 1).
  const context: CollisionContext = {
    abilityTags: effectiveTags(character),
    ignoreOneway: world.tick - 1 < world.controller.dropThroughUntilTick,
  };
  const left = (s.x[slot] as number) + (s.colOx[slot] as number);
  const colFirst = cellOf(left, T);
  const colLast = cellOf(left + (s.colW[slot] as number) - 1, T);
  const found: number[] = [];
  for (let col = colFirst; col <= colLast; col++) {
    if (supports(solidAt(grid, col, row, context))) {
      const foothold = index.at(character.id, row, col);
      if (foothold >= 0 && !found.includes(foothold)) {
        found.push(foothold);
      }
    }
  }
  return found.sort((a, b) => a - b);
}
