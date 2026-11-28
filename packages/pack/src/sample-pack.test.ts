import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attackTicks,
  type CharacterDef,
  createWorld,
  fromPx,
  type Notice,
  type PackRuntime,
  roomMap,
  type StepOutput,
  script,
  step,
  type World,
} from '@retro-action-engine/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FetchLike, type LoadedRuntime, loadPack } from './load';
import { localize, MAX_NAME_LENGTH, textLength } from './text';

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

type Frames = ReturnType<ReturnType<typeof script>['build']>;

/**
 * Drives the party in a test: walks to an x (backing off for a run-up where a step stops it, as
 * the retro profile cannot steer in the air), swings, and takes the way on out of the room.
 */
function driver(world: World, runtime: PackRuntime) {
  const slot = () => world.entities.slotOf(world.party.entityId);
  const x = () => world.entities.x[slot()] as number;
  const notices: Notice[] = [];
  const play = (frames: Frames): StepOutput[] =>
    frames.map((frame) => {
      const out = step(world, frame, runtime);
      notices.push(...out.notices);
      return out;
    });
  /** Walks until the body is within 2 px of `target`; false when it never gets there. */
  const walkTo = (target: number, limit = 3000): boolean => {
    let backOff = 0;
    let runUp = 0;
    let still = 0;
    let lastX = x();
    for (let i = 0; i < limit && world.transition.phase === 'none'; i++) {
      const dir =
        x() < target - fromPx(2) ? 'right' : x() > target + fromPx(2) ? 'left' : undefined;
      if (dir === undefined) return true;
      const back = dir === 'right' ? 'left' : 'right';
      if (backOff > 0) {
        backOff--;
        play(script().hold(back, 1).build(1));
        if (backOff === 0) runUp = 30;
      } else if (runUp > 0) {
        runUp--;
        play(
          script()
            .hold(runUp < 22 ? [dir, 'jump'] : dir, 1)
            .build(1),
        );
      } else {
        play(script().hold(dir, 1).build(1));
        still = x() === lastX ? still + 1 : 0;
        if (still >= 3) backOff = 12;
      }
      lastX = x();
    }
    return false;
  };
  /** Walks up to just left of `left` (so facing right, within the sword's reach) and swings. */
  const swingAt = (left: number) => {
    walkTo(left - fromPx(8));
    play(script().tap('attack').wait(30).build());
  };
  return {
    x,
    notices,
    play,
    walkTo,
    swingAt,
    /** Puts the body at a place (feet), at rest. */
    place(px: number, py: number) {
      world.entities.x[slot()] = px;
      world.entities.y[slot()] = py;
      world.entities.vx[slot()] = 0;
      world.entities.vy[slot()] = 0;
      play(script().build(10));
    },
    /**
     * Takes the room's way on: first the switches of closed gates in the room, then the first
     * exit that is not an edge on the left, pressing up on a door. Returns the exit's kind.
     */
    takeWayOn(): string {
      const room = runtime.rooms[world.roomId];
      for (const g of room?.gimmicks ?? []) {
        if (g.type === 'switch' && world.flags[g.flag] === undefined) swingAt(g.rect.x);
      }
      const exit = room?.exits?.find((e) => e.kind !== 'edge' || e.rect.x > 0);
      if (exit === undefined) throw new Error(`no way on from ${world.roomId}`);
      const center = exit.rect.x + (exit.rect.w >> 1);
      for (let i = 0; i < 100 && world.transition.phase === 'none'; i++) {
        if (walkTo(center)) play(script().wait(30).tap('up', { at: 0 }).build(1));
      }
      const kind = world.transition.kind;
      play(script().build(runtime.roomTransition?.lockTicks ?? 0));
      expect(world.transition.phase).toBe('none');
      return kind;
    },
  };
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
    expect(Object.keys(runtime.rooms)).toEqual(['hub', 'cellar']);
    expect(runtime.rules.party.members).toEqual(['explorer', 'diver']);
    expect(Object.keys(runtime.feel)).toEqual(['retro', 'modern']);
  });

  it('keeps the play area a whole number of tiles', () => {
    const { display, tileSize } = runtime;
    const playHeight = display.height - display.hudReserve.top - display.hudReserve.bottom;
    expect(display.width % tileSize).toBe(0);
    expect(playHeight % tileSize).toBe(0);
    // Rooms are whole screens; the hub is 5 x 3 of them and scrolls (M3-2, owner's decision).
    const screen = { w: display.width / tileSize, h: playHeight / tileSize };
    for (const room of Object.values(runtime.rooms)) {
      expect(room.widthTiles % screen.w).toBe(0);
      expect(room.heightTiles % screen.h).toBe(0);
    }
    expect(runtime.rooms.hub?.widthTiles).toBe(screen.w * 5);
    expect(runtime.rooms.hub?.heightTiles).toBe(screen.h * 3);
    expect(runtime.camera?.mode).toBe('scroll');
  });

  it('goes round the rooms: a door down, the switch, then a warp back (ADR-0018, ADR-0021)', () => {
    // From the spawn past the rock, so that the trip needs no pickaxe.
    const world = createWorld(runtime, {
      roomId: 'hub',
      spawnId: 'door',
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    });
    const drive = driver(world, runtime);
    const visited: string[] = [world.roomId];
    // Without the switch, the gate stops the way to the warp in the cellar.
    const probe = createWorld(runtime, {
      roomId: 'cellar',
      spawnId: 'entry',
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    });
    const gate = runtime.rooms.cellar?.gimmicks?.find((g) => g.type === 'gate');
    const warp = runtime.rooms.cellar?.exits?.[0];
    if (gate === undefined || warp === undefined) throw new Error('no gate or warp');
    expect(driver(probe, runtime).walkTo(warp.rect.x, 1500)).toBe(false);
    expect(probe.roomId).toBe('cellar');
    expect(driver(probe, runtime).x()).toBeLessThan(gate.rect.x);
    const kinds: string[] = [];
    for (let leg = 0; leg < 2; leg++) {
      kinds.push(drive.takeWayOn());
      visited.push(world.roomId);
    }
    expect(kinds).toEqual(['door', 'warp']);
    expect(visited).toEqual(['hub', 'cellar', 'hub']);
    expect(world.flags['cellar-gate-open']).toBe(true);
  });

  it('plays the agreed flow: pickaxe, rock, door, switch, gate, warp (ADR-0021)', () => {
    const T = runtime.tileSize;
    const world = createWorld(runtime, {
      ...(runtime.entry as { roomId: string; spawnId: string }),
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    });
    const drive = driver(world, runtime);
    const hub = runtime.rooms.hub;
    const rocks = hub?.gimmicks?.filter((g) => g.type === 'breakable') ?? [];
    const pickaxe = hub?.gimmicks?.find((g) => g.type === 'pickup');
    if (pickaxe === undefined || rocks.length !== 2) throw new Error('no pickaxe or rocks');
    const rockX = rocks[0]?.rect.x as number;
    // The rock fills the passage to the door: no way past it, even jumping.
    expect(drive.walkTo(rockX + fromPx(T * 3), 1500)).toBe(false);
    expect(drive.x()).toBeLessThan(rockX);
    // Without the pickaxe the sword does nothing to it.
    drive.swingAt(rockX);
    expect(rocks.every((r) => world.flags[r.flag] === undefined)).toBe(true);

    // The pickaxe is on the top shelf, by the left ladder (the ladders are tested above).
    const shelfRow = (pickaxe.rect.y + pickaxe.rect.h) / fromPx(T);
    const shelf =
      hub?.tileClasses[
        hub.collision[shelfRow * hub.widthTiles + pickaxe.rect.x / fromPx(T)] as number
      ];
    expect(shelf?.solid).toBe('full');
    drive.place(fromPx(26 * T + T / 2 + T * 2), fromPx(shelfRow * T));
    expect(drive.walkTo(pickaxe.rect.x + (pickaxe.rect.w >> 1), 600)).toBe(true);
    expect(drive.notices).toEqual([{ kind: 'pickup', itemId: 'pickaxe', count: 1 }]);
    expect(world.inventory).toEqual({ pickaxe: 1 });

    // Back on the floor before the rock: one swing breaks both pieces, and the way is open.
    drive.place(rockX - fromPx(T * 4), fromPx(((hub?.heightTiles as number) - 1) * T));
    drive.swingAt(rockX);
    expect(rocks.every((r) => world.flags[r.flag] === true)).toBe(true);
    expect(drive.takeWayOn()).toBe('door');
    expect(world.roomId).toBe('cellar');
    expect(drive.takeWayOn()).toBe('warp');
    expect(world.roomId).toBe('hub');
    // Back in the hub: the rock stays broken and the pickaxe gone; nothing of them is drawn
    // (only the map, on the right shelf, is still there).
    const [out] = drive.play(script().build(1));
    expect(out?.render.sprites.filter((sprite) => sprite.id < 0).map((s) => s.frame)).toEqual([
      'items/map',
    ]);
    expect(out?.ui.inventory).toEqual([{ id: 'pickaxe', count: 1 }]);
  });

  it('has the map on the top right shelf: it shows every screen of the rooms (ADR-0020)', () => {
    const T = runtime.tileSize;
    const world = createWorld(runtime, {
      ...(runtime.entry as { roomId: string; spawnId: string }),
      seed: 1,
      feelProfile: runtime.feelDefault as string,
    });
    const drive = driver(world, runtime);
    const hub = runtime.rooms.hub;
    const map = hub?.gimmicks?.find((g) => g.type === 'pickup' && g.itemId === 'map');
    if (hub === undefined || map === undefined) throw new Error('no map in the hub');
    expect(runtime.items?.map?.revealsMap).toBe(true);
    const before = roomMap(world, runtime);
    expect(before).toMatchObject({ cols: 5, rows: 3, revealed: false });
    expect(before.visited).toEqual([before.here]);
    // On the shelf, at the top of the right ladder (the ladders are tested above).
    const shelfRow = (map.rect.y + map.rect.h) / fromPx(T);
    drive.place(fromPx(78 * T + T / 2), fromPx(shelfRow * T));
    expect(drive.walkTo(map.rect.x + (map.rect.w >> 1), 600)).toBe(true);
    expect(world.inventory.map).toBe(1);
    expect(drive.notices.map((n) => n.itemId)).toEqual(['map']);
    expect(roomMap(world, runtime).revealed).toBe(true);
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
    // The pack's own images are CC0; the menu font is the M+ bitmap font (ADR-0020).
    const licenses = new Map(credits.assets.map((a) => [a.path, a.license]));
    expect(licenses.get('ui/font.png')).toBe('M+ FONT LICENSE');
    licenses.delete('ui/font.png');
    expect(new Set(licenses.values())).toEqual(new Set(['CC0-1.0']));
  });

  it('lets everyone into the water, and drains the swimmer slower (ADR-0016)', () => {
    // The water is the only tile class with a hazard in the hub; find the first pool on the way
    // right from the start (the one nearest the left wall) from the data.
    const hub = runtime.rooms.hub;
    if (hub === undefined) throw new Error('no hub');
    const waterClass = hub.tileClasses.find((c) => c.hazard !== undefined);
    if (waterClass === undefined) throw new Error('no water tile class');
    expect(waterClass).toMatchObject({ solid: 'none', medium: waterClass.hazard });
    const allCells = [...hub.collision.keys()].filter((i) => hub.collision[i] === waterClass.id);
    const firstCol = Math.min(...allCells.map((i) => i % hub.widthTiles));
    const poolCols = new Set<number>();
    for (let c = firstCol; allCells.some((i) => i % hub.widthTiles === c); c++) poolCols.add(c);
    const cells = allCells.filter((i) => poolCols.has(i % hub.widthTiles));
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

  it('climbs both ladders from the middle shelf up to the top shelf (ADR-0019)', () => {
    const hub = runtime.rooms.hub;
    if (hub === undefined) throw new Error('no hub');
    const T = runtime.tileSize;
    const W = hub.widthTiles;
    const ladderIds = new Set(hub.tileClasses.filter((c) => c.ladder === true).map((c) => c.id));
    const isLadder = (col: number, row: number) =>
      row >= 0 && ladderIds.has(hub.collision[row * W + col] as number);
    // Each ladder from the data: its top rung, and the floor under its last tile.
    const ladders: Array<{ col: number; top: number; floor: number }> = [];
    for (let i = 0; i < hub.collision.length; i++) {
      const col = i % W;
      const row = Math.floor(i / W);
      if (!isLadder(col, row) || isLadder(col, row - 1)) continue;
      let floor = row;
      while (isLadder(col, floor)) floor++;
      ladders.push({ col, top: row, floor });
    }
    expect(ladders).toHaveLength(2);
    for (const profile of Object.keys(runtime.feel)) {
      for (const member of runtime.rules.party.members) {
        for (const ladder of ladders) {
          const entry = runtime.entry as { roomId: string; spawnId: string };
          const world = createWorld(runtime, {
            ...entry,
            party: [member],
            seed: 1,
            feelProfile: profile,
          });
          const slot = world.entities.slotOf(world.party.entityId);
          // Stand on the floor at the foot of the ladder, a little off its center.
          world.entities.x[slot] = fromPx(ladder.col * T + 5);
          world.entities.y[slot] = fromPx(ladder.floor * T);
          for (const frame of script().build(10)) step(world, frame, runtime);
          const rise = (ladder.floor - ladder.top) * T;
          const speed = runtime.feel[profile]?.climbSpeed as number;
          const ticks = Math.ceil(fromPx(rise) / speed) + 10;
          for (const frame of script().hold('up', ticks).build(ticks)) step(world, frame, runtime);
          // Standing on the top rung, level with the top shelf, and walking off onto it.
          expect(world.controller.climbing).toBe(false);
          expect(world.entities.y[slot]).toBe(fromPx(ladder.top * T));
          for (const frame of script().hold('right', 30).build(30)) step(world, frame, runtime);
          expect(world.entities.y[slot]).toBe(fromPx(ladder.top * T));
          expect(world.entities.x[slot]).toBeGreaterThan(fromPx((ladder.col + 1) * T));
        }
      }
    }
  });

  it('names the characters in Japanese and English, six characters at most (ADR-0020)', () => {
    expect(Object.keys(runtime.strings ?? {})).toEqual(['ja', 'en']);
    const names = (lang: string) =>
      runtime.rules.party.members.map((m) =>
        localize(runtime, runtime.characters[m]?.name as string, lang),
      );
    expect(names('ja')).toEqual(['ソラト', 'ミナモ']);
    expect(names('en')).toEqual(['Sorato', 'Minamo']);
    for (const lang of ['ja', 'en']) {
      for (const name of names(lang)) expect(textLength(name)).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    }
  });

  it('has a menu font with every character of the names, and a "?" (ADR-0020)', () => {
    const font = runtime.ui?.font;
    if (font === undefined) throw new Error('no menu font');
    const glyphs = new Set(font.glyphs.map(([ch]) => ch));
    expect(glyphs.has('?')).toBe(true);
    for (const lang of Object.keys(runtime.strings ?? {})) {
      for (const m of runtime.rules.party.members) {
        for (const ch of localize(runtime, runtime.characters[m]?.name as string, lang)) {
          expect(glyphs.has(ch), `"${ch}" of a name in ${lang}`).toBe(true);
        }
      }
    }
    // The image holds every cell.
    const png = readFileSync(join(PACK_DIR, 'ui/font.png'));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const columns = width / font.cellW;
    expect(Number.isInteger(columns)).toBe(true);
    expect(height).toBe(Math.ceil(font.glyphs.length / columns) * font.cellH);
  });

  it('swings without a break when mashed, and once when held (M3-2c)', () => {
    const entry = runtime.entry as { roomId: string; spawnId: string };
    for (const profile of Object.keys(runtime.feel)) {
      const buffer = runtime.feel[profile]?.attackBufferTicks as number;
      for (const member of runtime.rules.party.members) {
        const length = attackTicks(runtime.characters[member] as CharacterDef) as number;
        expect(buffer).toBeGreaterThan(0);
        expect(buffer).toBeLessThan(length);
        const swingsOf = (frames: ReturnType<ReturnType<typeof script>['build']>) => {
          const world = createWorld(runtime, {
            ...entry,
            party: [member],
            seed: 1,
            feelProfile: profile,
          });
          // Ticks on which a swing began.
          const starts: number[] = [];
          for (const frame of frames) {
            const before = world.controller.attackUntilTick;
            step(world, frame, runtime);
            if (world.controller.attackUntilTick !== before) starts.push(world.tick - 1);
          }
          return starts;
        };
        const mash = script();
        for (let at = 0; at < 2 * length + 1; at += buffer) mash.tap('attack', { at });
        expect(swingsOf(mash.build(4 * length))).toEqual([0, length, 2 * length]);
        expect(
          swingsOf(
            script()
              .hold('attack', 4 * length)
              .build(4 * length),
          ),
        ).toEqual([0]);
      }
    }
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
