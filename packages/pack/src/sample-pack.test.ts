import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, fromPx, type PackRuntime, script, step } from '@retro-action-engine/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FetchLike, type LoadedRuntime, loadPack } from './load';

// The sample pack in the repository (docs/architecture.md 3: tests that read packs/sample live in
// `pack` and `apps/player`).
const PACK_DIR = fileURLToPath(new URL('../../../packs/sample/', import.meta.url));
const BASE = 'pack:/';

/** Reads pack files from disk, the way the app reads them over HTTP. */
const diskFetch: FetchLike = async (url) => {
  const path = join(PACK_DIR, url.slice(BASE.length));
  try {
    const text = readFileSync(path, 'utf8');
    return { ok: true, status: 200, text: async () => text };
  } catch {
    return { ok: false, status: 404, text: async () => '' };
  }
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/**
 * Holds right from the entry spawn with one character, jumping now and then to get over steps;
 * returns the largest x reached (Fx).
 */
function walkRight(runtime: PackRuntime, member: string, ticks: number): number {
  const entry = runtime.entry as { roomId: string; spawnId: string };
  const world = createWorld(runtime, {
    ...entry,
    party: [member],
    seed: 1,
    feelProfile: runtime.feelDefault as string,
  });
  const slot = world.entities.slotOf(world.party.entityId);
  let maxX = world.entities.x[slot] as number;
  const input = script().hold('right', ticks);
  for (let at = 0; at < ticks; at += 30) input.press('jump', { at, ticks: 20 });
  for (const frame of input.build()) {
    step(world, frame, runtime);
    maxX = Math.max(maxX, world.entities.x[slot] as number);
  }
  return maxX;
}

describe('packs/sample', () => {
  let runtime: LoadedRuntime;
  let warnings: readonly string[];

  beforeAll(async () => {
    ({ runtime, warnings } = await loadPack(diskFetch, BASE));
  });

  it('passes the pack checks without warnings', () => {
    expect(warnings).toEqual([]);
    expect(runtime.id).toBe('sample');
    expect(runtime.entry).toEqual({ roomId: 'hub', spawnId: 'start' });
    expect(Object.keys(runtime.rooms)).toEqual(['hub']);
    expect(runtime.rules.party.members).toEqual(['explorer', 'diver']);
    expect(Object.keys(runtime.feel)).toEqual(['retro', 'modern']);
  });

  it('keeps the play area a whole number of tiles', () => {
    const { display, tileSize } = runtime;
    const playHeight = display.height - display.hudReserve.top - display.hudReserve.bottom;
    expect(display.width % tileSize).toBe(0);
    expect(playHeight % tileSize).toBe(0);
    const hub = runtime.rooms.hub;
    expect(hub?.widthTiles).toBe(display.width / tileSize);
    expect(hub?.heightTiles).toBe(playHeight / tileSize);
  });

  it('holds data only: no code files (issue #3)', () => {
    const files = filesUnder(PACK_DIR).map((file) => relative(PACK_DIR, file));
    const allowed = /\.(json|tmj|png)$/;
    expect(files.filter((file) => !allowed.test(file))).toEqual([]);
  });

  it('lists a credit for every image', () => {
    const credits = JSON.parse(readFileSync(join(PACK_DIR, 'credits.json'), 'utf8')) as {
      assets: Array<{ path: string; license: string }>;
    };
    const images = filesUnder(PACK_DIR)
      .map((file) => relative(PACK_DIR, file).split('\\').join('/'))
      .filter((file) => file.endsWith('.png'))
      .sort();
    expect(credits.assets.map((a) => a.path).sort()).toEqual(images);
    expect(new Set(credits.assets.map((a) => a.license))).toEqual(new Set(['CC0-1.0']));
  });

  it('lets only the swimmer through the water column', () => {
    // The water column is the only swim-only tile in the hub; find its left edge from the data.
    const hub = runtime.rooms.hub;
    if (hub === undefined) throw new Error('no hub');
    const swimClass = hub.tileClasses.find((c) => c.requiresAnyTag?.includes('move:swim'));
    if (swimClass === undefined) throw new Error('no swim-only tile class');
    const cols = [...hub.collision.keys()]
      .filter((i) => hub.collision[i] === swimClass.id)
      .map((i) => i % hub.widthTiles);
    const waterLeft = fromPx(Math.min(...cols) * runtime.tileSize);
    const waterRight = fromPx((Math.max(...cols) + 1) * runtime.tileSize);

    const walker = runtime.characters.explorer;
    const swimmer = runtime.characters.diver;
    expect(walker?.abilityTags).not.toContain('move:swim');
    expect(swimmer?.abilityTags).toContain('move:swim');

    const ticks = 600;
    const walkerX = walkRight(runtime, 'explorer', ticks);
    const walkerRight = walkerX + (walker?.collider.ox ?? 0) + (walker?.collider.w ?? 0);
    expect(walkerRight).toBe(waterLeft);
    expect(walkRight(runtime, 'diver', ticks)).toBeGreaterThan(waterRight);
  });
});
