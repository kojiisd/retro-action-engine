// Inline fixtures for core tests. Not exported from the package; tests import it directly.
import { type CollisionGrid, createCollisionGrid } from './collision/grid';
import type { Body } from './collision/move';
import { fromPx } from './fx/fx';
import type { FeelProfile } from './runtime/feel';
import type { CharacterDef, PackRuntime, PartyRules, RoomData } from './runtime/pack';
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

// ---- Simulation fixtures (M1-3) ----

/**
 * px (with decimals) to Fx, the way `pack` converts pack data at load time (ADR-0002).
 * Test-only: core itself never rounds this way.
 */
export function pxToFx(px: number): number {
  return Math.round(px * 256);
}

export type FeelInPx = Omit<FeelProfile, 'id' | 'name' | 'interpolation' | 'socd'>;

const FX_FIELDS = [
  'runSpeed',
  'groundAccel',
  'groundDecel',
  'turnDecel',
  'airAccel',
  'airDecel',
  'airControl',
  'jumpVelocity',
  'gravity',
  'fallGravityScale',
  'maxFallSpeed',
  'jumpCutScale',
  'apexGravityScale',
  'apexThreshold',
] as const;

/** Builds a runtime FeelProfile from the px values of docs/input-and-feel.md 8.2. */
export function feelProfile(
  meta: Pick<FeelProfile, 'id' | 'name' | 'interpolation' | 'socd'>,
  values: FeelInPx,
): FeelProfile {
  const converted: Record<string, number> = { ...values };
  for (const key of FX_FIELDS) {
    converted[key] = pxToFx(values[key]);
  }
  return { ...meta, ...(converted as unknown as FeelInPx) };
}

/** The example values of docs/input-and-feel.md 8.2 (px, before conversion). */
export const RETRO_PX: FeelInPx = {
  runSpeed: 1.5,
  groundAccel: 1.5,
  groundDecel: 1.5,
  turnDecel: 0,
  airAccel: 0,
  airDecel: 0,
  airControl: 0,
  jumpVelocity: 4.5,
  gravity: 0.25,
  fallGravityScale: 1,
  maxFallSpeed: 4,
  jumpCutScale: 1,
  minJumpTicks: 0,
  apexGravityScale: 1,
  apexThreshold: 0,
  coyoteTicks: 0,
  jumpBufferTicks: 0,
  dropThroughTicks: 8,
  landingLagTicks: 0,
};

export const MODERN_PX: FeelInPx = {
  runSpeed: 1.5,
  groundAccel: 0.25,
  groundDecel: 0.3,
  turnDecel: 0.5,
  airAccel: 0.2,
  airDecel: 0.05,
  airControl: 1,
  jumpVelocity: 4,
  gravity: 0.21,
  fallGravityScale: 1.5,
  maxFallSpeed: 5,
  jumpCutScale: 0.4,
  minJumpTicks: 4,
  apexGravityScale: 0.6,
  apexThreshold: 0.5,
  coyoteTicks: 6,
  jumpBufferTicks: 6,
  dropThroughTicks: 8,
  landingLagTicks: 0,
};

export const RETRO = feelProfile(
  { id: 'retro', name: 'Retro', interpolation: 'none', socd: 'neutral' },
  RETRO_PX,
);

export const MODERN = feelProfile(
  { id: 'modern', name: 'Modern', interpolation: 'linear', socd: 'lastWins' },
  MODERN_PX,
);

/** Collider of the pack-spec example character, in Fx. */
const COLLIDER = { w: fromPx(12), h: fromPx(14), ox: fromPx(-6), oy: fromPx(-14) };

/** Fictional characters for tests: one without tags, one that can swim. */
export const WALKER: CharacterDef = { id: 'walker', abilityTags: [], collider: COLLIDER };
export const SWIMMER: CharacterDef = {
  id: 'swimmer',
  abilityTags: ['move:swim', 'size:small'],
  collider: COLLIDER,
};

/** Play areas of the two acceptance resolutions, in 16 px tiles (180 px -> 11 rows). */
export const DISPLAYS = [
  { name: '320x180', widthTiles: 20, heightTiles: 11 },
  { name: '256x192', widthTiles: 16, heightTiles: 12 },
] as const;

export interface SimFixtureOptions {
  readonly rows: readonly string[];
  /** Spawn tile (the character stands on the tile below it). */
  readonly spawn: readonly [col: number, row: number];
  readonly members?: readonly string[];
  readonly switchRules?: Partial<PartyRules['switch']>;
}

/** A runtime with one room, the two test profiles and the two test characters. */
export function simRuntime(options: SimFixtureOptions): PackRuntime {
  const T = 16;
  const grid = buildRoom(options.rows, T);
  const [col, row] = options.spawn;
  const room: RoomData = {
    id: 'room',
    widthTiles: grid.widthTiles,
    heightTiles: grid.heightTiles,
    collision: grid.collision,
    tileClasses: TEST_TILE_CLASSES,
    spawns: { start: { x: fromPx(col * T + T / 2), y: fromPx((row + 1) * T) } },
  };
  return {
    id: 'test-pack',
    version: '0.0.0',
    tileSize: T,
    rooms: { room },
    characters: { walker: WALKER, swimmer: SWIMMER },
    feel: { retro: RETRO, modern: MODERN },
    rules: {
      party: {
        members: options.members ?? ['walker'],
        switch: {
          mode: 'anywhere',
          cooldownTicks: 30,
          requireGrounded: false,
          placement: 'same',
          ...options.switchRules,
        },
      },
    },
  };
}

/** Rows of a room: a floor at the bottom and walls on both sides. */
export function boxRoom(widthTiles: number, heightTiles: number): string[] {
  return Array.from({ length: heightTiles }, (_, r) =>
    r === heightTiles - 1 ? '#'.repeat(widthTiles) : `#${'.'.repeat(widthTiles - 2)}#`,
  );
}

/** Replaces one tile of a row list. */
export function setTile(rows: string[], col: number, row: number, tile: string): void {
  const line = rows[row] as string;
  rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
}
