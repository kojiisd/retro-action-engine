import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and "-"');
const path = z.string().min(1);

/** `pack.json` (docs/pack-spec.md 3). */
export const manifestSchema = z.object({
  formatVersion: z.literal('1.0'),
  id,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'not a semver version'),
  engine: z.object({ formatVersion: z.string().min(1) }),
  display: z.object({
    width: z.int().positive(),
    height: z.int().positive(),
    hudReserve: z.object({ top: z.int().nonnegative(), bottom: z.int().nonnegative() }),
    orientation: z.enum(['landscape', 'portrait', 'any']),
  }),
  tileSize: z.int().positive(),
  entry: z.object({ roomId: z.string().min(1), spawnId: z.string().min(1) }),
  files: z.object({
    rooms: z.array(path).min(1),
    tilesets: z.array(path).min(1),
    atlases: z.record(z.string().min(1), path),
    characters: path,
    rules: path,
    feel: path,
    input: path,
    camera: path.optional(),
    enemies: path.optional(),
    items: path.optional(),
    gimmicks: path.optional(),
    audio: path.optional(),
    strings: z.record(z.string().min(1), path).optional(),
    ui: path.optional(),
  }),
  saveCompat: z.string().min(1),
  licenses: z.object({ code: z.string().min(1), assets: z.string().min(1) }),
  credits: path,
});
export type Manifest = z.infer<typeof manifestSchema>;
