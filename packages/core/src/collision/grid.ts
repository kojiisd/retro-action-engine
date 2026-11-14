import type { SolidKind, TileClass } from '../runtime/tile';

/** What the movement code needs from a room: the collision layer and the tile size. */
export interface CollisionGridInput {
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** Tile edge in px, shared by every room of a pack. */
  readonly tileSize: number;
  /** tileClassId per tile, row-major. */
  readonly collision: Uint16Array;
  readonly tileClasses: readonly TileClass[];
}

/** Validated collision grid with tile classes indexed by id. */
export interface CollisionGrid {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly tileSize: number;
  readonly collision: Uint16Array;
  /** Tile class for each id; index = id. */
  readonly classById: readonly TileClass[];
}

/** Abilities of the moving entity. `requiresAnyTag` tiles let it through if it has one of them. */
export interface CollisionContext {
  readonly abilityTags: ReadonlySet<string>;
}

export const NO_ABILITIES: CollisionContext = { abilityTags: new Set<string>() };

/** Kinds handled by the movement code in this version. Slopes arrive in M5. */
const SUPPORTED_SOLIDS: readonly SolidKind[] = ['none', 'full', 'oneway'];

/**
 * Checks the grid and indexes the tile classes. Throws on anything the movement code could not
 * resolve deterministically, so that bad data fails at load time instead of mid-game.
 */
export function createCollisionGrid(input: CollisionGridInput): CollisionGrid {
  const { widthTiles, heightTiles, tileSize, collision, tileClasses } = input;
  if (!Number.isInteger(widthTiles) || widthTiles < 1) {
    throw new RangeError(`widthTiles must be a positive integer, got ${widthTiles}`);
  }
  if (!Number.isInteger(heightTiles) || heightTiles < 1) {
    throw new RangeError(`heightTiles must be a positive integer, got ${heightTiles}`);
  }
  if (!Number.isInteger(tileSize) || tileSize < 1) {
    throw new RangeError(`tileSize must be a positive integer, got ${tileSize}`);
  }
  if (collision.length !== widthTiles * heightTiles) {
    throw new RangeError(
      `collision has ${collision.length} tiles, expected ${widthTiles} x ${heightTiles}`,
    );
  }

  const classById: TileClass[] = [];
  for (const tileClass of tileClasses) {
    if (classById[tileClass.id] !== undefined) {
      throw new RangeError(`tile class ${tileClass.id} is defined twice`);
    }
    if (!SUPPORTED_SOLIDS.includes(tileClass.solid)) {
      throw new RangeError(
        `tile class ${tileClass.id}: solid "${tileClass.solid}" is not supported`,
      );
    }
    classById[tileClass.id] = tileClass;
  }
  for (let i = 0; i < collision.length; i++) {
    const id = collision[i] as number;
    if (classById[id] === undefined) {
      throw new RangeError(`tile ${i} uses tile class ${id}, which is not defined`);
    }
  }

  return { widthTiles, heightTiles, tileSize, collision, classById };
}

/**
 * Solid kind of a tile as seen by an entity with the given abilities. Tiles outside the room are
 * full: the room border is a wall, and exits are handled by zones (ADR-0004).
 */
export function solidAt(
  grid: CollisionGrid,
  col: number,
  row: number,
  context: CollisionContext,
): SolidKind {
  if (col < 0 || row < 0 || col >= grid.widthTiles || row >= grid.heightTiles) {
    return 'full';
  }
  const tileClass = grid.classById[
    grid.collision[row * grid.widthTiles + col] as number
  ] as TileClass;
  const tags = tileClass.requiresAnyTag;
  if (tags !== undefined) {
    for (const tag of tags) {
      if (context.abilityTags.has(tag)) {
        return 'none';
      }
    }
  }
  return tileClass.solid;
}
