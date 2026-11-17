import { z } from 'zod';

const property = z.looseObject({ name: z.string(), value: z.unknown() });

/** A Tiled external tileset (JSON, Tiled 1.11). Only the fields the importer reads. */
export const tilesetSchema = z.looseObject({
  name: z.string().optional(),
  tilewidth: z.int().positive(),
  tileheight: z.int().positive(),
  tilecount: z.int().positive(),
  columns: z.int().positive(),
  image: z.string().min(1),
  margin: z.literal(0).optional(),
  spacing: z.literal(0).optional(),
  tiles: z
    .array(
      z.looseObject({
        id: z.int().nonnegative(),
        // Tiled 1.9+ writes "class"; older files write "type".
        class: z.string().optional(),
        type: z.string().optional(),
        properties: z.array(property).optional(),
      }),
    )
    .optional(),
});
export type TilesetJson = z.infer<typeof tilesetSchema>;

const tileLayer = z.looseObject({
  type: z.literal('tilelayer'),
  name: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  data: z.array(z.int().nonnegative()),
  encoding: z.literal('csv').optional(),
});

const objectLayer = z.looseObject({
  type: z.literal('objectgroup'),
  name: z.string(),
  objects: z.array(
    z.looseObject({
      name: z.string(),
      class: z.string().optional(),
      type: z.string().optional(),
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      properties: z.array(property).optional(),
    }),
  ),
});

/** A Tiled map (`.tmj`, Tiled 1.11). Finite orthogonal maps only (docs/pack-spec.md 5.1). */
export const mapSchema = z.looseObject({
  orientation: z.literal('orthogonal'),
  infinite: z.literal(false),
  width: z.int().positive(),
  height: z.int().positive(),
  tilewidth: z.int().positive(),
  tileheight: z.int().positive(),
  tilesets: z.array(z.object({ firstgid: z.int().positive(), source: z.string().min(1) })),
  layers: z.array(
    z.union([tileLayer, objectLayer, z.looseObject({ type: z.string(), name: z.string() })]),
  ),
});
export type MapJson = z.infer<typeof mapSchema>;
