import type { GimmickPlacement, ItemDef, RoomData } from '@retro-action-engine/core';
import type { z } from 'zod';
import { toFx } from './convert';
import type { IssueList } from './errors';
import type { gimmicksSchema } from './schema/data';
import type { GimmickObject } from './tiled';

type GimmickDef = z.infer<typeof gimmicksSchema>['gimmicks'][number];
type Where = ReadonlyArray<string | number>;

/** The gimmick types that work as of M3-3 (ADR-0021); the others are refused at load. */
const TYPES = ['pickup', 'breakable', 'switch', 'gate'] as const;
type Type = (typeof TYPES)[number];

/** Parameters each type reads, and those it refuses for now (ADR-0021). */
const PARAMS: Record<Type, { read: readonly string[]; later: readonly string[] }> = {
  pickup: { read: ['itemId', 'count', 'onceFlag'], later: [] },
  breakable: { read: ['requiresAnyTag', 'flag'], later: ['drops'] },
  switch: { read: ['setsFlag'], later: [] },
  gate: { read: ['requiresFlag'], later: ['requiresAnyTag', 'consumesItem'] },
};
/** Fields of a definition that are not parameters. */
const META = ['id', 'type', 'sprite', 'frameOn'];

export interface GimmickContext {
  readonly roomFile: string;
  readonly gimmicksFile: string | undefined;
  readonly defs: ReadonlyMap<string, { def: GimmickDef; index: number }>;
  readonly items: Readonly<Record<string, ItemDef>>;
  readonly frameOf: (atlas: string) => ReadonlySet<string> | undefined;
  readonly tileSize: number;
  readonly issues: IssueList;
}

/** Checks the definitions of `gimmicks.json` on their own (types and parameters). */
export function checkGimmickDefs(
  defs: readonly GimmickDef[],
  file: string,
  frameOf: GimmickContext['frameOf'],
  issues: IssueList,
): void {
  const seen = new Set<string>();
  defs.forEach((def, i) => {
    const where = ['gimmicks', i];
    if (seen.has(def.id))
      issues.error(file, [...where, 'id'], `gimmick "${def.id}" is defined twice`);
    seen.add(def.id);
    if (!(TYPES as readonly string[]).includes(def.type)) {
      issues.error(
        file,
        [...where, 'type'],
        `type "${def.type}" is not supported yet (${TYPES.join(', ')} work)`,
      );
      return;
    }
    const type = def.type as Type;
    for (const key of Object.keys(def)) {
      if (META.includes(key)) continue;
      if (PARAMS[type].later.includes(key)) {
        issues.error(file, [...where, key], `${key} of a "${type}" is not supported yet`);
      } else if (!PARAMS[type].read.includes(key)) {
        issues.error(file, [...where, key], `a "${type}" has no parameter "${key}"`);
      }
    }
    if (type === 'pickup') {
      if (def.sprite !== undefined) {
        issues.error(file, [...where, 'sprite'], "a pickup is drawn with its item's sprite");
      }
    } else if (def.sprite === undefined) {
      issues.error(file, [...where, 'sprite'], `a "${type}" needs a sprite`);
    } else {
      checkFrame(def.sprite.atlas, def.sprite.frame, file, [...where, 'sprite'], frameOf, issues);
    }
    if (def.frameOn !== undefined) {
      if (type !== 'switch') {
        issues.error(file, [...where, 'frameOn'], 'only a switch has frameOn');
      } else if (def.sprite !== undefined) {
        checkFrame(def.sprite.atlas, def.frameOn, file, [...where, 'frameOn'], frameOf, issues);
      }
    }
  });
}

function checkFrame(
  atlas: string,
  frame: string,
  file: string,
  where: Where,
  frameOf: GimmickContext['frameOf'],
  issues: IssueList,
): void {
  const frames = frameOf(atlas);
  if (frames === undefined) {
    issues.error(
      file,
      [...where, 'atlas'],
      `atlas "${atlas}" is not listed in pack.json files.atlases`,
    );
  } else if (!frames.has(frame)) {
    issues.error(file, [...where, 'frame'], `frame "${frame}" is not in atlas "${atlas}"`);
  }
}

/**
 * The gimmicks of a room (ADR-0021): each `gimmick` object merged with its definition (the
 * object's properties win), its flag named, and its box in Fx. Problems go to `issues`.
 */
export function placeGimmicks(
  room: RoomData,
  objects: readonly GimmickObject[],
  context: GimmickContext,
): GimmickPlacement[] {
  const { roomFile: file, issues } = context;
  const placements: GimmickPlacement[] = [];
  for (const obj of objects) {
    const found = context.defs.get(obj.gimmickId);
    if (found === undefined) {
      issues.error(
        file,
        [...obj.where, 'properties', 'gimmickId'],
        context.gimmicksFile === undefined
          ? `gimmick "${obj.gimmickId}" needs pack.json files.gimmicks`
          : `gimmick "${obj.gimmickId}" is not in ${context.gimmicksFile}`,
      );
      continue;
    }
    const { def } = found;
    if (!(TYPES as readonly string[]).includes(def.type)) continue; // reported with the defs
    const type = def.type as Type;
    const at = (key: string) => [...obj.where, 'properties', key];
    let ok = true;
    const fail = (key: string, message: string) => {
      issues.error(file, at(key), message);
      ok = false;
    };
    for (const key of Object.keys(obj.props)) {
      if (PARAMS[type].later.includes(key)) fail(key, `${key} of a "${type}" is not supported yet`);
      else if (!PARAMS[type].read.includes(key)) fail(key, `a "${type}" has no parameter "${key}"`);
    }
    const param = (key: string): unknown => obj.props[key] ?? (def as Record<string, unknown>)[key];
    const text = (key: string): string | undefined => {
      const value = param(key);
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || value.trim() === '') {
        fail(key, `${key} must be a non-empty text`);
        return undefined;
      }
      return value.trim();
    };
    // A list in gimmicks.json; a comma-separated text in Tiled (it has no list properties).
    const tags = (key: string): string[] | undefined => {
      const value = param(key);
      const list = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',').map((t) => t.trim())
          : undefined;
      const clean = list?.filter((t): t is string => typeof t === 'string' && t !== '');
      if (clean === undefined || clean.length === 0 || clean.length !== list?.length) {
        fail(key, `${key} must list one or more tags`);
        return undefined;
      }
      return clean;
    };
    const defaultFlag = `obj:${room.id}:${obj.objectId}`;
    const rect = { x: toFx(obj.x), y: toFx(obj.y), w: toFx(obj.w), h: toFx(obj.h) };
    let placement: GimmickPlacement | undefined;
    if (type === 'pickup') {
      const itemId = text('itemId');
      const countValue = param('count') ?? 1;
      const count =
        Number.isInteger(countValue) && (countValue as number) > 0
          ? (countValue as number)
          : undefined;
      if (count === undefined) fail('count', 'count must be a positive integer');
      const item = itemId === undefined ? undefined : context.items[itemId];
      if (itemId === undefined) {
        if (ok) fail('itemId', 'itemId is required');
      } else if (item === undefined) {
        fail('itemId', `item "${itemId}" is not defined`);
      }
      placement = {
        objectId: obj.objectId,
        type,
        rect,
        flag: text('onceFlag') ?? defaultFlag,
        itemId: itemId as string,
        count: count as number,
        ...(item?.sprite === undefined ? {} : { sprite: item.sprite }),
      };
    } else if (type === 'breakable') {
      const requiresAnyTag = tags('requiresAnyTag');
      placement = {
        objectId: obj.objectId,
        type,
        rect,
        flag: text('flag') ?? defaultFlag,
        requiresAnyTag: requiresAnyTag ?? [],
        ...(def.sprite === undefined ? {} : { sprite: def.sprite }),
      };
    } else {
      const key = type === 'switch' ? 'setsFlag' : 'requiresFlag';
      const flag = text(key);
      if (flag === undefined && param(key) === undefined) fail(key, `${key} is required`);
      placement = {
        objectId: obj.objectId,
        type,
        rect,
        flag: flag as string,
        ...(def.sprite === undefined ? {} : { sprite: def.sprite }),
        ...(type === 'switch' && def.sprite !== undefined && def.frameOn !== undefined
          ? { spriteOn: { atlas: def.sprite.atlas, frame: def.frameOn } }
          : {}),
      };
    }
    // Gimmicks that make walls fill whole tiles (ADR-0021).
    if (type === 'breakable' || type === 'gate') {
      const t = context.tileSize;
      if (obj.x % t !== 0 || obj.y % t !== 0 || obj.w % t !== 0 || obj.h % t !== 0) {
        issues.error(file, obj.where, `a "${type}" must be aligned to the ${t} px tile grid`);
        ok = false;
      } else if (
        obj.x < 0 ||
        obj.y < 0 ||
        obj.x + obj.w > room.widthTiles * t ||
        obj.y + obj.h > room.heightTiles * t
      ) {
        issues.error(file, obj.where, `a "${type}" must be inside the room`);
        ok = false;
      }
    }
    if (ok) placements.push(placement);
  }
  return placements;
}
