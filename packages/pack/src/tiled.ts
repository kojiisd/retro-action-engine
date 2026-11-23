import type { ExitDef, RenderLayerData, RoomData, TileClass } from '@retro-action-engine/core';
import { toFx } from './convert';
import type { IssueList } from './errors';
import type { MapJson, TilesetJson } from './schema/tiled';

/** A tileset used by a map: its key in the pack (pack-relative path) and its first gid. */
export interface MapTileset {
  readonly firstgid: number;
  readonly key: string;
  readonly json: TilesetJson;
}

/** Tile layers drawn (in this order); `main` also makes the collision grid. */
const RENDER_LAYERS = ['bg', 'main', 'fg'] as const;
/** Object layers of the convention that the importer does not read yet (M3). */
const LATER_LAYERS = ['zones'] as const;
const EXIT_KINDS = ['edge', 'door', 'warp'] as const;

/** Where each imported exit is in its map file, for the loader's messages. */
export const exitSource = new WeakMap<ExitDef, ReadonlyArray<string | number>>();
/** Tiled stores flips in the top three bits of a gid. */
const GID_MASK = 0x1fffffff;

interface TileMeta {
  readonly solid: TileClass['solid'];
  readonly ladder?: boolean;
  readonly hazard?: string;
  readonly medium?: string;
  readonly requiresAnyTag?: readonly string[];
}

const EMPTY: TileMeta = { solid: 'none' };

function propertyOf(
  props: ReadonlyArray<{ name: string; value: unknown }> | undefined,
  name: string,
): unknown {
  return props?.find((p) => p.name === name)?.value;
}

/** What a tileset tile means for collision (docs/pack-spec.md 5.3). */
function tileMeta(tileset: MapTileset, local: number, issues: IssueList, file: string): TileMeta {
  const tile = tileset.json.tiles?.find((t) => t.id === local);
  if (tile === undefined) return EMPTY;
  const cls = tile.class ?? tile.type ?? '';
  const tagsValue = propertyOf(tile.properties, 'requiresAnyTag');
  const tags =
    typeof tagsValue === 'string' && tagsValue.trim() !== ''
      ? tagsValue
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== '')
      : undefined;
  // `hazard` and `medium` (ADR-0016) may go with any class.
  const named = (name: 'hazard' | 'medium'): string | undefined => {
    const value = propertyOf(tile.properties, name);
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '') {
      issues.error(file, ['tiles', local], `${name} must be a non-empty string`);
      return undefined;
    }
    return value.trim();
  };
  const hazard = named('hazard');
  const medium = named('medium');
  const withTags = (meta: TileMeta): TileMeta => ({
    ...meta,
    ...(tags === undefined ? {} : { requiresAnyTag: tags }),
    ...(hazard === undefined ? {} : { hazard }),
    ...(medium === undefined ? {} : { medium }),
  });
  switch (cls) {
    case '':
      return withTags(EMPTY);
    case 'solid':
      return withTags({ solid: 'full' });
    case 'oneway':
      return withTags({ solid: 'oneway' });
    case 'ladder':
      return withTags({ solid: 'none', ladder: true });
    case 'hazard':
      // The contact-damage class was dropped (ADR-0016): use the `hazard` property instead.
      issues.error(
        file,
        ['tiles', local],
        'the "hazard" class was replaced by the "hazard" property (docs/pack-spec.md 5.3)',
      );
      return EMPTY;
    case 'slope':
      issues.error(file, ['tiles', local], 'slope tiles are not supported yet (M5)');
      return EMPTY;
    default:
      issues.error(file, ['tiles', local], `unknown tile class "${cls}"`);
      return EMPTY;
  }
}

/**
 * Converts a Tiled map to `RoomData` (docs/pack-spec.md 5). The `main` tile layer gives the
 * collision grid; `bg`, `main` and `fg` are kept for drawing; `spawn` objects in `entities` give
 * the spawns, at the bottom center of their rectangle. Problems go to `issues`, named by layer
 * and object, not by line.
 */
export function importRoom(
  roomId: string,
  file: string,
  map: MapJson,
  tilesets: readonly MapTileset[],
  tileSize: number,
  issues: IssueList,
  /** `camera.json`'s `roomTransition.effect`, for exits that set none (ADR-0018). */
  defaultEffect: ExitDef['effect'] = 'cut',
): RoomData | undefined {
  const errorsBefore = issues.errors.length;
  if (map.tilewidth !== tileSize || map.tileheight !== tileSize) {
    issues.error(file, ['tilewidth'], `tiles must be ${tileSize}x${tileSize} like the pack`);
  }
  const { width, height } = map;
  const sorted = [...tilesets].sort((a, b) => b.firstgid - a.firstgid);
  const tilesetOf = (gid: number) => sorted.find((t) => gid >= t.firstgid);

  const tileClasses: TileClass[] = [{ id: 0, solid: 'none' }];
  const classIds = new Map<string, number>([[JSON.stringify(EMPTY), 0]]);
  const collision = new Uint16Array(width * height);
  const renderLayers: RenderLayerData[] = [];
  const spawns: Record<string, { x: number; y: number }> = {};
  const exits: ExitDef[] = [];
  const metaCache = new Map<string, TileMeta>();
  let mainSeen = false;

  map.layers.forEach((layer, li) => {
    const where = ['layers', li];
    const known =
      (RENDER_LAYERS as readonly string[]).includes(layer.name) ||
      layer.name === 'entities' ||
      layer.name === 'exits';
    if (!known) {
      if ((LATER_LAYERS as readonly string[]).includes(layer.name)) {
        issues.warn(file, where, `layer "${layer.name}" is not read yet (M3)`);
      } else {
        issues.warn(file, where, `layer "${layer.name}" is not part of the convention; ignored`);
      }
      return;
    }
    if (layer.name === 'exits') {
      if (layer.type !== 'objectgroup' || !('objects' in layer)) {
        issues.error(file, where, 'layer "exits" must be an object layer');
        return;
      }
      (layer.objects as MapObjects).forEach((obj, oi) => {
        const exit = importExit(obj, [...where, 'objects', oi], width, height, tileSize, {
          file,
          issues,
          defaultEffect,
        });
        if (exit !== undefined) {
          exits.push(exit);
          exitSource.set(exit, [...where, 'objects', oi]);
        }
      });
      return;
    }
    if (layer.name === 'entities') {
      if (layer.type !== 'objectgroup' || !('objects' in layer)) {
        issues.error(file, where, 'layer "entities" must be an object layer');
        return;
      }
      (layer.objects as MapObjects).forEach((obj, oi) => {
        const cls = obj.class ?? obj.type ?? '';
        if (cls === 'spawn') {
          if (spawns[obj.name] !== undefined) {
            issues.error(file, [...where, 'objects', oi], `spawn "${obj.name}" is defined twice`);
          }
          spawns[obj.name] = {
            x: toFx(obj.x + (obj.width ?? 0) / 2),
            y: toFx(obj.y + (obj.height ?? 0)),
          };
        } else {
          issues.warn(
            file,
            [...where, 'objects', oi],
            `object "${obj.name}" (${cls || 'no class'}) is not read yet (M3)`,
          );
        }
      });
      return;
    }
    if (layer.type !== 'tilelayer' || !('data' in layer)) {
      issues.error(file, where, `layer "${layer.name}" must be a tile layer`);
      return;
    }
    if (layer.name === 'main') {
      if (mainSeen) issues.error(file, where, 'more than one "main" layer');
      mainSeen = true;
    }
    const data = layer.data as number[];
    if (layer.width !== width || layer.height !== height || data.length !== width * height) {
      issues.error(file, where, `layer "${layer.name}" must be ${width}x${height} tiles`);
      return;
    }
    let layerTileset: MapTileset | undefined;
    let flipped = false;
    // Each kind of problem is reported once per layer, not once per tile.
    const reported = new Set<string>();
    const once = (message: string) => {
      if (reported.has(message)) return;
      reported.add(message);
      issues.error(file, where, message);
    };
    const rows: number[][] = [];
    for (let r = 0; r < height; r++) {
      const row: number[] = [];
      for (let c = 0; c < width; c++) {
        const raw = data[r * width + c] as number;
        const gid = raw & GID_MASK;
        if (raw !== gid) flipped = true;
        if (gid === 0) {
          row.push(-1);
          continue;
        }
        const tileset = tilesetOf(gid);
        if (tileset === undefined) {
          once(`layer "${layer.name}" uses gid ${gid}, which no tileset covers`);
          row.push(-1);
          continue;
        }
        if (layerTileset !== undefined && layerTileset !== tileset) {
          once(`layer "${layer.name}" mixes tilesets; use one per layer`);
        }
        layerTileset = tileset;
        const local = gid - tileset.firstgid;
        if (local >= tileset.json.tilecount) {
          once(`layer "${layer.name}" uses tile ${local} past the end of its tileset`);
        }
        row.push(local);
        if (layer.name === 'main') {
          const cacheKey = `${tileset.key}|${local}`;
          let meta = metaCache.get(cacheKey);
          if (meta === undefined) {
            meta = tileMeta(tileset, local, issues, tileset.key);
            metaCache.set(cacheKey, meta);
          }
          const key = JSON.stringify(meta);
          let id = classIds.get(key);
          if (id === undefined) {
            id = tileClasses.length;
            classIds.set(key, id);
            tileClasses.push({ id, ...meta });
          }
          collision[r * width + c] = id;
        }
      }
      rows.push(row);
    }
    if (flipped) {
      issues.warn(file, where, `layer "${layer.name}" has flipped tiles; they are drawn unflipped`);
    }
    if (layerTileset !== undefined) {
      renderLayers.push({ name: layer.name, tileset: layerTileset.key, data: rows });
    }
  });

  if (!mainSeen) issues.error(file, ['layers'], 'a tile layer named "main" is required');
  if (issues.errors.length > errorsBefore) return undefined;
  // Draw order follows the convention, whatever the order in the file.
  renderLayers.sort(
    (a, b) =>
      RENDER_LAYERS.indexOf(a.name as (typeof RENDER_LAYERS)[number]) -
      RENDER_LAYERS.indexOf(b.name as (typeof RENDER_LAYERS)[number]),
  );
  return {
    id: roomId,
    widthTiles: width,
    heightTiles: height,
    collision,
    tileClasses,
    spawns,
    renderLayers,
    exits,
  };
}

/**
 * One object of the `exits` layer (docs/pack-spec.md 5.4, ADR-0018). Where it leads is checked
 * by the loader, which knows every room.
 */
function importExit(
  obj: MapObjects[number],
  where: ReadonlyArray<string | number>,
  widthTiles: number,
  heightTiles: number,
  tileSize: number,
  context: { file: string; issues: IssueList; defaultEffect: ExitDef['effect'] },
): ExitDef | undefined {
  const { file, issues } = context;
  const cls = obj.class ?? obj.type ?? '';
  if (cls !== 'exit') {
    issues.error(file, [...where, 'class'], `objects in "exits" must have the class "exit"`);
    return undefined;
  }
  const props = obj.properties;
  const text = (name: string): string | undefined => {
    const value = propertyOf(props, name);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  let ok = true;
  const fail = (name: string, message: string) => {
    issues.error(file, [...where, 'properties', name], message);
    ok = false;
  };
  const kind = text('kind');
  if (kind === undefined || !(EXIT_KINDS as readonly string[]).includes(kind)) {
    fail('kind', `kind must be one of ${EXIT_KINDS.join(', ')}`);
  }
  const toRoomId = text('toRoomId');
  if (toRoomId === undefined) fail('toRoomId', 'toRoomId is required');
  const spawnId = text('spawnId');
  if (spawnId === undefined) fail('spawnId', 'spawnId is required');
  const effectText = text('effect');
  if (effectText === 'scroll') {
    fail('effect', 'effect "scroll" comes with the camera (M3-2); use "fade" or "cut"');
  } else if (effectText !== undefined && effectText !== 'fade' && effectText !== 'cut') {
    fail('effect', 'effect must be "fade" or "cut"');
  }
  if (propertyOf(props, 'requiresFlag') !== undefined) {
    fail('requiresFlag', 'requiresFlag comes with flags (M3-3)');
  }
  const tagsText = text('requiresAnyTag');
  const tags = tagsText
    ?.split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;
  if (w <= 0 || h <= 0) {
    issues.error(file, where, 'an exit must be a rectangle with a size');
    ok = false;
  }
  const roomW = widthTiles * tileSize;
  const roomH = heightTiles * tileSize;
  if (
    kind === 'edge' &&
    w > 0 &&
    h > 0 &&
    !(obj.x <= 0 || obj.y <= 0 || obj.x + w >= roomW || obj.y + h >= roomH)
  ) {
    issues.error(file, where, 'an "edge" exit must touch the border of the room');
    ok = false;
  }
  if (!ok) return undefined;
  return {
    kind: kind as ExitDef['kind'],
    rect: { x: toFx(obj.x), y: toFx(obj.y), w: toFx(w), h: toFx(h) },
    toRoomId: toRoomId as string,
    spawnId: spawnId as string,
    effect: (effectText as ExitDef['effect'] | undefined) ?? context.defaultEffect,
    ...(tags === undefined || tags.length === 0 ? {} : { requiresAnyTag: tags }),
  };
}

type MapObjects = ReadonlyArray<{
  name: string;
  class?: string | undefined;
  type?: string | undefined;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  properties?: ReadonlyArray<{ name: string; value: unknown }> | undefined;
}>;
