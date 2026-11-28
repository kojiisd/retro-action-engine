import type {
  AssetManifest,
  CameraDef,
  CharacterDef,
  FeelProfile,
  ItemDef,
  PackRuntime,
  RoomData,
  UiDef,
} from '@retro-action-engine/core';
import type { z } from 'zod';
import { convertMotion, convertProfile, toFx } from './convert';
import { IssueList, PackLoadError, zodIssues } from './errors';
import { checkGimmickDefs, placeGimmicks } from './gimmicks';
import { PathError, packUrl, resolvePackPath } from './paths';
import {
  atlasSchema,
  cameraSchema,
  charactersSchema,
  feelSchema,
  gimmicksSchema,
  inputSchema,
  itemsSchema,
  rulesSchema,
  stringsSchema,
  uiSchema,
} from './schema/data';
import { type Manifest, manifestSchema } from './schema/manifest';
import { type MapJson, mapSchema, type TilesetJson, tilesetSchema } from './schema/tiled';
import { MAX_NAME_LENGTH, STRINGS_PREFIX, textLength } from './text';
import { exitSource, gimmickObjects, importRoom, type MapTileset, zoneSource } from './tiled';

/**
 * The part of `fetch` the loader needs. The app passes `window.fetch`; tests and Node pass a
 * function that reads files. `pack` never calls DOM APIs itself.
 */
export type FetchLike = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

/** A runtime with every field `pack` fills (core treats them as optional). */
export type LoadedRuntime = PackRuntime &
  Required<Pick<PackRuntime, 'name' | 'entry' | 'feelDefault' | 'display' | 'input' | 'assets'>>;

export interface LoadedPack {
  readonly runtime: LoadedRuntime;
  /** Problems that did not stop the load (ignored layers, for example). */
  readonly warnings: readonly string[];
}

/** Pack format versions this engine reads (docs/pack-spec.md 9). */
const SUPPORTED_MAJOR = 1;

const roomIdOf = (path: string) => (path.split('/').pop() as string).replace(/\.tmj$/, '');

/**
 * Loads a pack from `baseUrl` (ends with `/`): reads `pack.json` and the files it lists, checks
 * them, converts px to Fx and Tiled maps to rooms, and checks the references between files
 * (docs/pack-spec.md 8). Throws `PackLoadError` with every problem found.
 */
export async function loadPack(fetchLike: FetchLike, baseUrl: string): Promise<LoadedPack> {
  const issues = new IssueList();

  const read = async (file: string): Promise<unknown> => {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchLike(packUrl(baseUrl, file));
    } catch (error) {
      issues.error(file, [], `could not be read (${(error as Error).message})`);
      return undefined;
    }
    if (!response.ok) {
      issues.error(file, [], `could not be read (HTTP ${response.status})`);
      return undefined;
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      issues.error(file, [], `is not valid JSON (${(error as Error).message})`);
      return undefined;
    }
  };

  const parse = <S extends z.ZodType>(file: string, schema: S, value: unknown) => {
    if (value === undefined) return undefined;
    const result = schema.safeParse(value);
    if (!result.success) {
      issues.errors.push(...zodIssues(file, result.error.issues));
      return undefined;
    }
    return result.data as z.output<S>;
  };

  const resolve = (from: string, relative: string, where: ReadonlyArray<PropertyKey>) => {
    try {
      return resolvePackPath(from, relative);
    } catch (error) {
      if (!(error instanceof PathError)) throw error;
      issues.error(from, where, error.message);
      return undefined;
    }
  };

  // ---- pack.json ----
  const manifest = parse('pack.json', manifestSchema, await read('pack.json')) as
    | Manifest
    | undefined;
  issues.throwIfAny();
  if (manifest === undefined) throw new PackLoadError(issues.errors);
  const major = /^[\^~>=\s]*(\d+)/.exec(manifest.engine.formatVersion)?.[1];
  if (major === undefined || Number(major) !== SUPPORTED_MAJOR) {
    issues.error(
      'pack.json',
      ['engine', 'formatVersion'],
      `this engine reads format ${SUPPORTED_MAJOR}.x`,
    );
  }
  const f = manifest.files;
  const path = (relative: string, where: ReadonlyArray<PropertyKey>) =>
    resolve('pack.json', relative, ['files', ...where]);

  // ---- data files ----
  const files = {
    characters: path(f.characters, ['characters']),
    rules: path(f.rules, ['rules']),
    feel: path(f.feel, ['feel']),
    input: path(f.input, ['input']),
    camera: f.camera === undefined ? undefined : path(f.camera, ['camera']),
    ui: f.ui === undefined ? undefined : path(f.ui, ['ui']),
    items: f.items === undefined ? undefined : path(f.items, ['items']),
    gimmicks: f.gimmicks === undefined ? undefined : path(f.gimmicks, ['gimmicks']),
    credits: resolve('pack.json', manifest.credits, ['credits']),
  };
  const stringFiles = Object.entries(f.strings ?? {}).map(
    ([lang, p]) => [lang, path(p, ['strings', lang])] as const,
  );
  const roomFiles = f.rooms.map((p, i) => path(p, ['rooms', i]));
  const tilesetFiles = f.tilesets.map((p, i) => path(p, ['tilesets', i]));
  const atlasFiles = Object.entries(f.atlases).map(
    ([key, p]) => [key, path(p, ['atlases', key])] as const,
  );
  issues.throwIfAny();

  const readParsed = async <S extends z.ZodType>(file: string | undefined, schema: S) =>
    file === undefined ? undefined : parse(file, schema, await read(file));
  const [characters, rules, feel, input, camera, ui, items, gimmicks, credits] = await Promise.all([
    readParsed(files.characters, charactersSchema),
    readParsed(files.rules, rulesSchema),
    readParsed(files.feel, feelSchema),
    readParsed(files.input, inputSchema),
    readParsed(files.camera, cameraSchema),
    readParsed(files.ui, uiSchema),
    readParsed(files.items, itemsSchema),
    readParsed(files.gimmicks, gimmicksSchema),
    files.credits === undefined ? undefined : read(files.credits),
  ]);
  void credits;
  const strings: Record<string, Record<string, string>> = {};
  for (const [lang, file] of stringFiles) {
    const table = await readParsed(file, stringsSchema);
    if (table !== undefined) strings[lang] = table;
  }
  const tilesets = new Map<string, TilesetJson>();
  await Promise.all(
    tilesetFiles.map(async (file) => {
      if (file === undefined) return;
      const json = await readParsed(file, tilesetSchema);
      if (json !== undefined) tilesets.set(file, json);
    }),
  );
  const atlases = new Map<
    string,
    { file: string; frames: Set<string>; image: string | undefined }
  >();
  await Promise.all(
    atlasFiles.map(async ([key, file]) => {
      if (file === undefined) return;
      const json = await readParsed(file, atlasSchema);
      if (json === undefined) return;
      atlases.set(key, {
        file,
        frames: new Set(Object.keys(json.frames)),
        image: resolve(file, json.meta.image, ['meta', 'image']),
      });
    }),
  );
  const maps = new Map<string, MapJson>();
  await Promise.all(
    roomFiles.map(async (file) => {
      if (file === undefined) return;
      const json = await readParsed(file, mapSchema);
      if (json !== undefined) maps.set(file, json);
    }),
  );
  // Keep going after errors in single files so that one load reports as much as it can. Parts
  // that depend on a broken file are skipped below instead of reporting follow-on errors.
  if (
    characters === undefined ||
    rules === undefined ||
    feel === undefined ||
    input === undefined
  ) {
    issues.throwIfAny();
    throw new PackLoadError(issues.errors);
  }
  // Files arrive in any order; everything below walks them in the order pack.json lists them.
  const listed = <T>(files: ReadonlyArray<string | undefined>, parsed: Map<string, T>) =>
    files.flatMap((file) => {
      const json = file === undefined ? undefined : parsed.get(file);
      return file === undefined || json === undefined ? [] : [[file, json] as const];
    });

  // ---- tilesets ----
  const tilesetAssets: Record<string, AssetManifest['tilesets'][string]> = {};
  const listedTilesets = new Set(tilesetFiles.filter((file) => file !== undefined));
  for (const [file, json] of listed(tilesetFiles, tilesets)) {
    if (json.tilewidth !== manifest.tileSize || json.tileheight !== manifest.tileSize) {
      issues.error(
        file,
        ['tilewidth'],
        `tiles must be ${manifest.tileSize}x${manifest.tileSize} like the pack`,
      );
    }
    const image = resolve(file, json.image, ['image']);
    if (image !== undefined) {
      tilesetAssets[file] = {
        image: packUrl(baseUrl, image),
        columns: json.columns,
        tileCount: json.tilecount,
      };
    }
  }

  // ---- rooms ----
  const rooms: Record<string, RoomData> = {};
  const roomIds = new Set<string>();
  for (const [file, map] of listed(roomFiles, maps)) {
    const id = roomIdOf(file);
    if (roomIds.has(id)) {
      issues.error('pack.json', ['files', 'rooms'], `two rooms are named "${id}"`);
      continue;
    }
    roomIds.add(id);
    const used: MapTileset[] = [];
    let complete = true;
    map.tilesets.forEach((ref, i) => {
      const key = resolve(file, ref.source, ['tilesets', i, 'source']);
      const json = key === undefined ? undefined : tilesets.get(key);
      if (key !== undefined && !listedTilesets.has(key)) {
        issues.error(
          file,
          ['tilesets', i, 'source'],
          `"${key}" is not listed in pack.json files.tilesets`,
        );
      }
      if (key === undefined || json === undefined || !listedTilesets.has(key)) {
        complete = false;
        return;
      }
      used.push({ firstgid: ref.firstgid, key, json });
    });
    // Without all its tilesets the room cannot be read; the cause is already reported.
    if (!complete) continue;
    const room = importRoom(
      id,
      file,
      map,
      used,
      manifest.tileSize,
      issues,
      camera?.roomTransition?.effect,
    );
    if (room !== undefined) rooms[id] = room;
  }

  /**
   * The texts of a name in every language: itself, or the strings of a `@strings:key`
   * (docs/pack-spec.md 4.10). A key missing from a strings file is an error.
   */
  const textsOf = (value: string, file: string, where: ReadonlyArray<PropertyKey>): string[] => {
    if (!value.startsWith(STRINGS_PREFIX)) return [value];
    const key = value.slice(STRINGS_PREFIX.length);
    if (stringFiles.length === 0) {
      issues.error(file, where, `"${value}" needs pack.json files.strings`);
    }
    const texts: string[] = [];
    for (const [lang, stringsFile] of stringFiles) {
      const text = strings[lang]?.[key];
      if (text === undefined) {
        if (strings[lang] !== undefined)
          issues.error(file, where, `"${key}" is not in ${stringsFile}`);
      } else {
        texts.push(text);
      }
    }
    return texts;
  };
  const framesOf = (atlas: string) => atlases.get(atlas)?.frames;

  // ---- items (ADR-0021) ----
  const itemDefs: Record<string, ItemDef> = {};
  if (items !== undefined && files.items !== undefined) {
    const file = files.items;
    items.items.forEach((item, i) => {
      const where = ['items', i];
      if (itemDefs[item.id] !== undefined) {
        issues.error(file, [...where, 'id'], `item "${item.id}" is defined twice`);
      }
      if (item.effect !== undefined) {
        issues.error(
          file,
          [...where, 'effect'],
          'effect comes with items to use (not supported yet)',
        );
      }
      for (const text of textsOf(item.name, file, [...where, 'name'])) {
        if (textLength(text) < 1) issues.error(file, [...where, 'name'], 'the name is empty');
      }
      const frames = framesOf(item.sprite.atlas);
      if (frames === undefined) {
        issues.error(
          file,
          [...where, 'sprite', 'atlas'],
          `atlas "${item.sprite.atlas}" is not listed in pack.json files.atlases`,
        );
      } else if (!frames.has(item.sprite.frame)) {
        issues.error(
          file,
          [...where, 'sprite', 'frame'],
          `frame "${item.sprite.frame}" is not in atlas "${item.sprite.atlas}"`,
        );
      }
      itemDefs[item.id] = {
        id: item.id,
        name: item.name,
        kind: item.kind,
        ...(item.grants === undefined ? {} : { grants: item.grants }),
        stack: item.stack,
        sprite: item.sprite,
        ...(item.revealsMap === true ? { revealsMap: true } : {}),
      };
    });
  }
  // ---- gimmicks (ADR-0021) ----
  const gimmickDefs = new Map<
    string,
    { def: NonNullable<typeof gimmicks>['gimmicks'][number]; index: number }
  >();
  if (gimmicks !== undefined && files.gimmicks !== undefined) {
    checkGimmickDefs(gimmicks.gimmicks, files.gimmicks, framesOf, issues);
    gimmicks.gimmicks.forEach((def, index) => {
      if (!gimmickDefs.has(def.id)) gimmickDefs.set(def.id, { def, index });
    });
  }
  for (const [roomId, room] of Object.entries(rooms)) {
    const roomFile = roomFiles.find(
      (file) => file !== undefined && roomIdOf(file) === roomId,
    ) as string;
    const objects = gimmickObjects.get(room) ?? [];
    if (objects.length > 0) {
      const placed = placeGimmicks(room, objects, {
        roomFile,
        gimmicksFile: files.gimmicks,
        defs: gimmickDefs,
        items: itemDefs,
        frameOf: framesOf,
        tileSize: manifest.tileSize,
        issues,
      });
      if (placed.length > 0) rooms[roomId] = { ...room, gimmicks: placed };
    }
    // Items named by event zones.
    for (const zone of room.zones ?? []) {
      const where = zoneSource.get(zone) ?? [];
      const check = (id: string, key: string, i: number) => {
        if (itemDefs[id] === undefined) {
          issues.error(roomFile, [...where, 'properties', key, i], `item "${id}" is not defined`);
        }
      };
      zone.conditions.forEach((c, i) => {
        if ('hasItem' in c) check(c.hasItem, 'conditions', i);
        if ('notItem' in c) check(c.notItem, 'conditions', i);
      });
      zone.actions.forEach((a, i) => {
        if ('giveItem' in a) check(a.giveItem, 'actions', i);
        if ('takeItem' in a) check(a.takeItem, 'actions', i);
      });
    }
  }

  // ---- characters ----
  const characterDefs: Record<string, CharacterDef> = {};
  characters.characters.forEach((c, i) => {
    const file = files.characters as string;
    if (characterDefs[c.id] !== undefined) {
      issues.error(file, ['characters', i, 'id'], `character "${c.id}" is defined twice`);
    }
    const atlas = atlases.get(c.sprite.atlas);
    if (atlas === undefined) {
      issues.error(
        file,
        ['characters', i, 'sprite', 'atlas'],
        `atlas "${c.sprite.atlas}" is not listed in pack.json files.atlases`,
      );
    } else {
      for (const [animName, anim] of Object.entries(c.sprite.animations)) {
        anim.frames.forEach((frame, fi) => {
          if (!atlas.frames.has(frame.frame)) {
            issues.error(
              file,
              ['characters', i, 'sprite', 'animations', animName, 'frames', fi, 'frame'],
              `frame "${frame.frame}" is not in ${atlas.file}`,
            );
          }
        });
      }
    }
    // The swing lasts the attack animation once (ADR-0017): it cannot loop.
    if (c.sprite.animations.attack?.loop === true) {
      issues.error(
        file,
        ['characters', i, 'sprite', 'animations', 'attack', 'loop'],
        'the "attack" animation must not loop (its length is the swing)',
      );
    }
    if (c.sprite.animations.idle === undefined) {
      issues.error(
        file,
        ['characters', i, 'sprite', 'animations'],
        'an "idle" animation is required',
      );
    }
    // The name: a text or a string key (4.10), at most MAX_NAME_LENGTH characters in every
    // language (the menu, ADR-0020).
    const names = textsOf(c.name, file, ['characters', i, 'name']);
    for (const text of names) {
      if (textLength(text) < 1 || textLength(text) > MAX_NAME_LENGTH) {
        issues.error(
          file,
          ['characters', i, 'name'],
          `"${text}" is ${textLength(text)} characters; a name has 1 to ${MAX_NAME_LENGTH}`,
        );
      }
    }
    characterDefs[c.id] = {
      id: c.id,
      name: c.name,
      abilityTags: c.abilityTags,
      collider: {
        w: toFx(c.collider.w),
        h: toFx(c.collider.h),
        ox: toFx(c.collider.ox),
        oy: toFx(c.collider.oy),
      },
      // Hitboxes are px in the file and Fx in the runtime, like the collider.
      sprite: {
        atlas: c.sprite.atlas,
        animations: Object.fromEntries(
          Object.entries(c.sprite.animations).map(([key, anim]) => [
            key,
            {
              loop: anim.loop,
              frames: anim.frames.map((f) => ({
                frame: f.frame,
                ticks: f.ticks,
                ...(f.hitbox === undefined
                  ? {}
                  : {
                      hitbox: {
                        x: toFx(f.hitbox.x),
                        y: toFx(f.hitbox.y),
                        w: toFx(f.hitbox.w),
                        h: toFx(f.hitbox.h),
                      },
                    }),
              })),
            },
          ]),
        ),
      },
      ...(c.hp === undefined ? {} : { hp: c.hp }),
      ...(c.feelOverrides === undefined ? {} : { feelOverrides: convertMotion(c.feelOverrides) }),
    };
  });

  // ---- rules, feel, entry ----
  rules.party.members.forEach((member, i) => {
    if (characters.characters.every((c) => c.id !== member)) {
      issues.error(
        files.rules as string,
        ['party', 'members', i],
        `character "${member}" is not defined`,
      );
    }
  });
  // HP and HP-draining tiles (ADR-0016).
  if (rules.hp !== undefined) {
    rules.party.members.forEach((member, i) => {
      const character = characters.characters.find((c) => c.id === member);
      if (character !== undefined && character.hp === undefined) {
        issues.error(
          files.rules as string,
          ['party', 'members', i],
          `character "${member}" needs hp.max, because rules.hp is set`,
        );
      }
    });
  } else if (rules.hazards !== undefined) {
    issues.error(files.rules as string, ['hazards'], 'hazards need rules.hp');
  }
  // Items held per character come with saves (M3-5); the party shares them (ADR-0021).
  if (rules.inventory?.scope === 'perCharacter') {
    issues.error(
      files.rules as string,
      ['inventory', 'scope'],
      '"perCharacter" is not supported yet',
    );
  }
  for (const room of Object.values(rooms)) {
    for (const tileClass of room.tileClasses) {
      if (tileClass.hazard !== undefined && rules.hazards?.[tileClass.hazard] === undefined) {
        issues.error(
          files.rules as string,
          ['hazards'],
          `hazard "${tileClass.hazard}" (a tile in room "${room.id}") is not defined`,
        );
      }
    }
  }
  const profiles: Record<string, FeelProfile> = {};
  for (const [id, profile] of Object.entries(feel.profiles)) {
    profiles[id] = convertProfile(id, profile);
  }
  if (profiles[feel.default] === undefined) {
    issues.error(files.feel as string, ['default'], `profile "${feel.default}" is not defined`);
  }
  // A listed room that failed to import has its own errors already; do not repeat them here.
  const listedRooms = new Set(
    roomFiles.flatMap((file) => (file === undefined ? [] : [roomIdOf(file)])),
  );
  const entryRoom = rooms[manifest.entry.roomId];
  if (!listedRooms.has(manifest.entry.roomId)) {
    issues.error(
      'pack.json',
      ['entry', 'roomId'],
      `room "${manifest.entry.roomId}" is not defined`,
    );
  } else if (entryRoom !== undefined && entryRoom.spawns[manifest.entry.spawnId] === undefined) {
    issues.error(
      'pack.json',
      ['entry', 'spawnId'],
      `spawn "${manifest.entry.spawnId}" is not in room "${manifest.entry.roomId}"`,
    );
  }
  // Where each exit leads (ADR-0018).
  for (const [roomId, room] of Object.entries(rooms)) {
    const file = roomFiles.find((f) => f !== undefined && roomIdOf(f) === roomId) as string;
    for (const exit of room.exits ?? []) {
      const where = exitSource.get(exit) ?? [];
      const target = rooms[exit.toRoomId];
      if (!listedRooms.has(exit.toRoomId)) {
        issues.error(
          file,
          [...where, 'properties', 'toRoomId'],
          `room "${exit.toRoomId}" is not defined`,
        );
      } else if (target !== undefined && target.spawns[exit.spawnId] === undefined) {
        issues.error(
          file,
          [...where, 'properties', 'spawnId'],
          `spawn "${exit.spawnId}" is not in room "${exit.toRoomId}"`,
        );
      }
    }
  }
  // ---- the menu's font and colors (ADR-0020) ----
  let uiDef: UiDef | undefined;
  if (ui !== undefined && files.ui !== undefined) {
    const uiFile = files.ui;
    const seen = new Set<string>();
    ui.font.glyphs.forEach(([ch, width], gi) => {
      const where = ['font', 'glyphs', gi];
      if (textLength(ch) !== 1) issues.error(uiFile, [...where, 0], `"${ch}" is not one character`);
      if (seen.has(ch)) issues.error(uiFile, [...where, 0], `"${ch}" is listed twice`);
      seen.add(ch);
      if (width > ui.font.cellW) {
        issues.error(uiFile, [...where, 1], `the width ${width} is wider than the cell`);
      }
    });
    if (!seen.has('?')) {
      issues.error(
        uiFile,
        ['font', 'glyphs'],
        'a "?" glyph is required (it stands in for missing ones)',
      );
    }
    if (ui.font.ascent > ui.font.cellH) {
      issues.error(uiFile, ['font', 'ascent'], 'the baseline is below the cell');
    }
    const image = resolve(uiFile, ui.font.image, ['font', 'image']);
    if (image !== undefined) {
      uiDef = {
        font: { ...ui.font, image: packUrl(baseUrl, image) },
        colors: ui.colors,
      };
    }
  }
  issues.throwIfAny();

  const atlasAssets: Record<string, AssetManifest['atlases'][string]> = {};
  for (const [key] of atlasFiles) {
    const atlas = atlases.get(key);
    if (atlas?.image !== undefined) {
      atlasAssets[key] = {
        json: packUrl(baseUrl, atlas.file),
        image: packUrl(baseUrl, atlas.image),
      };
    }
  }

  const runtime: LoadedRuntime = {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    tileSize: manifest.tileSize,
    entry: manifest.entry,
    feelDefault: feel.default,
    display: manifest.display,
    input,
    assets: { atlases: atlasAssets, tilesets: tilesetAssets },
    rooms,
    characters: characterDefs,
    feel: profiles,
    rules: {
      party: rules.party,
      ...(rules.hp === undefined ? {} : { hp: rules.hp }),
      ...(rules.hazards === undefined ? {} : { hazards: rules.hazards }),
      ...(rules.gating === undefined ? {} : { gating: rules.gating }),
    },
    ...(items === undefined ? {} : { items: itemDefs }),
    ...(camera?.roomTransition === undefined ? {} : { roomTransition: camera.roomTransition }),
    ...(camera === undefined ? {} : { camera: cameraDef(camera) }),
    ...(stringFiles.length === 0 ? {} : { strings }),
    ...(uiDef === undefined ? {} : { ui: uiDef }),
  };
  return { runtime, warnings: issues.warnings };
}

/** `camera.json` as core reads it (ADR-0009): defaults filled in. */
function cameraDef(camera: z.infer<typeof cameraSchema>): CameraDef {
  const { scroll, screenFlip } = camera;
  return {
    mode: camera.mode,
    activationMarginPx: camera.activationMarginPx ?? 0,
    ...(scroll === undefined
      ? {}
      : {
          scroll: {
            deadzone: scroll.deadzone,
            lookahead: scroll.lookahead,
            lerpShift: scroll.lerpShift,
            lockY: scroll.lockY,
            followY: scroll.followY ?? 'always',
          },
        }),
    ...(screenFlip === undefined ? {} : { screenFlip }),
  };
}
