import type { AssetManifest, RoomData } from '@retro-action-engine/core';

/** One tile layer to draw: Phaser's `make.tilemap({ data })` takes `data` as it is. */
export interface TileLayerPlan {
  readonly name: string;
  /** Texture key of the tileset image (the tileset's key in the pack). */
  readonly texture: string;
  readonly columns: number;
  /** Rows of tile indexes in the tileset; -1 is empty. */
  readonly data: number[][];
  /** Below the sprites (negative) or above them (fg). */
  readonly depth: number;
}

/** Sprites are drawn at depth 0; `bg` and `main` go under them, `fg` over them. */
const DEPTH: Readonly<Record<string, number>> = { bg: -20, main: -10, fg: 10 };

/** The tile layers of a room, in draw order, with copies of their data (the room stays as is). */
export function tileLayerPlans(
  room: RoomData,
  tilesets: AssetManifest['tilesets'],
): TileLayerPlan[] {
  return (room.renderLayers ?? []).map((layer) => {
    const tileset = tilesets[layer.tileset];
    if (tileset === undefined) {
      throw new RangeError(`room "${room.id}": tileset "${layer.tileset}" has no image`);
    }
    return {
      name: layer.name,
      texture: layer.tileset,
      columns: tileset.columns,
      data: layer.data.map((row) => [...row]),
      depth: DEPTH[layer.name] ?? 0,
    };
  });
}
