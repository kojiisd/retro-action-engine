import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attackTicks,
  createWorld,
  fromPx,
  type PackRuntime,
  script,
  step,
} from '@retro-action-engine/core';
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
    expect(Object.keys(runtime.rooms)).toEqual(['hub', 'hall', 'cellar']);
    expect(runtime.rules.party.members).toEqual(['explorer', 'diver']);
    expect(Object.keys(runtime.feel)).toEqual(['retro', 'modern']);
  });

  it('keeps the play area a whole number of tiles', () => {
    const { display, tileSize } = runtime;
    const playHeight = display.height - display.hudReserve.top - display.hudReserve.bottom;
    expect(display.width % tileSize).toBe(0);
    expect(playHeight % tileSize).toBe(0);
    // One screen per room until the camera moves (M3-2).
    for (const room of Object.values(runtime.rooms)) {
      expect(room.widthTiles).toBe(display.width / tileSize);
      expect(room.heightTiles).toBe(playHeight / tileSize);
    }
  });

  it('goes round the rooms: an edge, a door, then a warp back (ADR-0018)', () => {
    const entry = runtime.entry as { roomId: string; spawnId: string };
    const world = createWorld(runtime, {
      ...entry,
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    });
    const slot = world.entities.slotOf(world.party.entityId);
    const x = () => world.entities.x[slot] as number;
    const tick = (frames: ReturnType<ReturnType<typeof script>['build']>) => {
      for (const frame of frames) step(world, frame, runtime);
    };
    // Each leg: walk to the room's way on (up on a door), then wait out the change.
    const visited: string[] = [world.roomId];
    const kinds: string[] = [];
    for (let leg = 0; leg < 3; leg++) {
      const room = runtime.rooms[world.roomId];
      const exit = room?.exits?.find((e) => e.kind !== 'edge' || e.rect.x > 0);
      if (exit === undefined) throw new Error(`no way on from ${world.roomId}`);
      const center = exit.rect.x + (exit.rect.w >> 1);
      for (let i = 0; i < 1200 && world.transition.phase === 'none'; i++) {
        const dir =
          x() < center - fromPx(2) ? 'right' : x() > center + fromPx(2) ? 'left' : undefined;
        if (dir !== undefined) {
          // Walk there, hopping over steps.
          const hop = i % 30 < 20;
          tick(
            script()
              .hold(hop ? [dir, 'jump'] : dir, 1)
              .build(1),
          );
        } else {
          // On a door: settle, then up.
          tick(script().wait(30).tap('up', { at: 0 }).build(1));
        }
      }
      kinds.push(world.transition.kind);
      tick(script().build(runtime.roomTransition?.lockTicks ?? 0));
      expect(world.transition.phase).toBe('none');
      visited.push(world.roomId);
    }
    expect(kinds).toEqual(['edge', 'door', 'warp']);
    expect(visited).toEqual(['hub', 'hall', 'cellar', 'hub']);
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

  it('lets everyone into the water, and drains the swimmer slower (ADR-0016)', () => {
    // The water is the only tile class with a hazard in the hub; find its columns from the data.
    const hub = runtime.rooms.hub;
    if (hub === undefined) throw new Error('no hub');
    const waterClass = hub.tileClasses.find((c) => c.hazard !== undefined);
    if (waterClass === undefined) throw new Error('no water tile class');
    expect(waterClass).toMatchObject({ solid: 'none', medium: waterClass.hazard });
    const cells = [...hub.collision.keys()].filter((i) => hub.collision[i] === waterClass.id);
    const cols = cells.map((i) => i % hub.widthTiles);
    const waterRight = fromPx((Math.max(...cols) + 1) * runtime.tileSize);
    // Both get through now.
    expect(walkRight(runtime, 'explorer', 600)).toBeGreaterThan(waterRight);
    expect(walkRight(runtime, 'diver', 600)).toBeGreaterThan(waterRight);

    // Standing in the water: HP drops by the rules' interval, slower with `move:swim`.
    const hazard = runtime.rules.hazards?.[waterClass.hazard as string];
    if (hazard === undefined) throw new Error('no water hazard');
    const swimInterval = hazard.byTag?.find((b) => b.anyTag.includes('move:swim'))?.intervalTicks;
    expect(swimInterval).toBeGreaterThan(hazard.intervalTicks);
    const lowest = Math.max(...cells.map((i) => Math.floor(i / hub.widthTiles)));
    const ticks = (swimInterval as number) * 3;
    const hpAfter = (member: string) => {
      const entry = runtime.entry as { roomId: string; spawnId: string };
      const world = createWorld(runtime, {
        ...entry,
        party: [member],
        seed: 1,
        feelProfile: runtime.feelDefault as string,
      });
      const slot = world.entities.slotOf(world.party.entityId);
      world.entities.x[slot] = fromPx(Math.min(...cols) * runtime.tileSize + runtime.tileSize);
      world.entities.y[slot] = fromPx((lowest + 1) * runtime.tileSize);
      for (const frame of script().build(ticks)) step(world, frame, runtime);
      return world.party.hp[0];
    };
    const max = (id: string) => runtime.characters[id]?.hp?.max as number;
    expect(hpAfter('explorer')).toBe(
      max('explorer') - Math.floor(ticks / hazard.intervalTicks) * hazard.damage,
    );
    expect(hpAfter('diver')).toBe(
      max('diver') - Math.floor(ticks / (swimInterval as number)) * hazard.damage,
    );
  });

  it('lets both characters swing, with a hitbox on the slash frames (ADR-0017)', () => {
    const entry = runtime.entry as { roomId: string; spawnId: string };
    for (const member of runtime.rules.party.members) {
      const character = runtime.characters[member];
      const length = character === undefined ? undefined : attackTicks(character);
      expect(length).toBeGreaterThan(0);
      const world = createWorld(runtime, {
        ...entry,
        party: [member],
        seed: 1,
        feelProfile: runtime.feelDefault as string,
      });
      const outs = script()
        .hold('attack', 1)
        .build(length as number)
        .map((frame) => step(world, frame, runtime));
      expect(outs.some((o) => o.render.hitboxes.length > 0)).toBe(true);
      // Over at the end of the animation.
      expect(world.tick).toBe(world.controller.attackUntilTick);
    }
  });
});
