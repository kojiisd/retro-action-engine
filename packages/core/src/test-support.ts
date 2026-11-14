// Inline fixtures for core tests. Not exported from the package; tests import it directly.
import { type CollisionGrid, createCollisionGrid } from './collision/grid';
import type { Body } from './collision/move';
import { fromPx } from './fx/fx';
import type { TileClass } from './runtime/tile';

/** Tile class ids used by `buildRoom`. */
export const TILE = { empty: 0, full: 1, oneway: 2, water: 3 } as const;

export const TEST_TILE_CLASSES: readonly TileClass[] = [
  { id: TILE.empty, solid: 'none' },
  { id: TILE.full, solid: 'full' },
  { id: TILE.oneway, solid: 'oneway' },
  { id: TILE.water, solid: 'full', requiresAnyTag: ['move:swim'] },
];

const LEGEND: Record<string, number> = {
  '.': TILE.empty,
  '#': TILE.full,
  '=': TILE.oneway,
  '~': TILE.water,
};

/**
 * Builds a collision grid from rows of characters:
 * `.` empty, `#` full, `=` oneway, `~` full unless the entity has `move:swim`.
 */
export function buildRoom(rows: readonly string[], tileSize = 16): CollisionGrid {
  const heightTiles = rows.length;
  const widthTiles = rows[0]?.length ?? 0;
  const collision = new Uint16Array(widthTiles * heightTiles);
  rows.forEach((row, r) => {
    if (row.length !== widthTiles) {
      throw new Error(`row ${r} has ${row.length} tiles, expected ${widthTiles}`);
    }
    for (let c = 0; c < widthTiles; c++) {
      const id = LEGEND[row[c] as string];
      if (id === undefined) {
        throw new Error(`unknown tile "${row[c]}" at row ${r}, column ${c}`);
      }
      collision[r * widthTiles + c] = id;
    }
  });
  return createCollisionGrid({
    widthTiles,
    heightTiles,
    tileSize,
    collision,
    tileClasses: TEST_TILE_CLASSES,
  });
}

/** Mirrors a room left to right. */
export function mirrorRows(rows: readonly string[]): string[] {
  return rows.map((row) => [...row].reverse().join(''));
}

/** A body with a centered collider of the given size in px, at a position in px. */
export function bodyAt(xPx: number, yPx: number, wPx: number, hPx: number): Body {
  return {
    x: fromPx(xPx),
    y: fromPx(yPx),
    vx: 0,
    vy: 0,
    w: fromPx(wPx),
    h: fromPx(hPx),
    ox: -fromPx(wPx) / 2,
    oy: -fromPx(hPx),
  };
}

/** True when the body's box overlaps a tile the predicate marks, or leaves the room. */
export function overlapsTiles(
  grid: CollisionGrid,
  body: Body,
  blocks: (col: number, row: number) => boolean,
): boolean {
  const size = fromPx(grid.tileSize);
  const left = body.x + body.ox;
  const top = body.y + body.oy;
  const colFirst = Math.floor(left / size);
  const colLast = Math.floor((left + body.w - 1) / size);
  const rowFirst = Math.floor(top / size);
  const rowLast = Math.floor((top + body.h - 1) / size);
  for (let row = rowFirst; row <= rowLast; row++) {
    for (let col = colFirst; col <= colLast; col++) {
      const outside = col < 0 || row < 0 || col >= grid.widthTiles || row >= grid.heightTiles;
      if (outside || blocks(col, row)) {
        return true;
      }
    }
  }
  return false;
}
