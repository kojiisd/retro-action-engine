import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  PackRuntime,
  RenderSnapshot,
  RenderSprite,
  RoomData,
} from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { gaugeFill, HP_BAR, HUD_PAD, hudIcons, hudLayout } from './hud';
import { interpolateColliders, interpolateSprites } from './interpolate';
import { tileLayerPlans } from './tile-layers';

// These tests cover the parts that do not touch Phaser. The scene itself is checked in the
// browser (apps/player e2e).

function sprite(id: number, x: number, y: number, extra: Partial<RenderSprite> = {}): RenderSprite {
  return {
    id,
    atlas: 'chars',
    frame: 'a',
    x,
    y,
    flipX: false,
    depth: 0,
    visible: true,
    teleported: false,
    ...extra,
  };
}

function snapshot(tick: number, sprites: RenderSprite[]): RenderSnapshot {
  return { tick, camera: { x: 0, y: 0 }, sprites, colliders: [] };
}

describe('interpolateSprites', () => {
  const prev = snapshot(1, [sprite(1, 10, 100)]);
  const curr = snapshot(2, [sprite(1, 13, 96, { frame: 'b', flipX: true })]);

  it('blends positions by alpha and floors them to whole pixels', () => {
    expect(interpolateSprites(prev, curr, 0, 'linear')[0]).toMatchObject({ x: 10, y: 100 });
    expect(interpolateSprites(prev, curr, 0.5, 'linear')[0]).toMatchObject({ x: 11, y: 98 });
    expect(interpolateSprites(prev, curr, 0.99, 'linear')[0]).toMatchObject({ x: 12, y: 96 });
  });

  it('uses the current frame and facing, whatever alpha is', () => {
    expect(interpolateSprites(prev, curr, 0.1, 'linear')[0]).toMatchObject({
      frame: 'b',
      flipX: true,
    });
  });

  it('draws at the current position with "none", for teleports, and for new sprites', () => {
    expect(interpolateSprites(prev, curr, 0.5, 'none')[0]).toMatchObject({ x: 13, y: 96 });
    const warped = snapshot(2, [sprite(1, 200, 50, { teleported: true })]);
    expect(interpolateSprites(prev, warped, 0.5, 'linear')[0]).toMatchObject({ x: 200, y: 50 });
    const added = snapshot(2, [sprite(1, 13, 96), sprite(2, 40, 40)]);
    expect(interpolateSprites(prev, added, 0.5, 'linear')[1]).toMatchObject({ x: 40, y: 40 });
  });

  it('never changes the snapshots it reads', () => {
    const before = JSON.stringify([prev, curr]);
    interpolateSprites(prev, curr, 0.5, 'linear');
    expect(JSON.stringify([prev, curr])).toBe(before);
  });
});

describe('interpolateColliders', () => {
  const box = (id: number, x: number, y: number) => ({ id, x, y, w: 10, h: 20 });
  const prev = { ...snapshot(1, [sprite(1, 15, 120)]), colliders: [box(1, 10, 100)] };
  const curr = { ...snapshot(2, [sprite(1, 18, 116)]), colliders: [box(1, 13, 96)] };

  it('moves the boxes with the sprites', () => {
    expect(interpolateColliders(prev, curr, 0.5, 'linear')[0]).toEqual(box(1, 11, 98));
    expect(interpolateColliders(prev, curr, 0.5, 'none')[0]).toEqual(box(1, 13, 96));
  });

  it('does not blend a teleported sprite or a new box', () => {
    const warped = {
      ...snapshot(2, [sprite(1, 200, 50, { teleported: true })]),
      colliders: [box(1, 195, 30)],
    };
    expect(interpolateColliders(prev, warped, 0.5, 'linear')[0]).toEqual(box(1, 195, 30));
    const added = { ...curr, colliders: [box(1, 13, 96), box(2, 40, 40)] };
    expect(interpolateColliders(prev, added, 0.5, 'linear')[1]).toEqual(box(2, 40, 40));
  });
});

describe('tileLayerPlans', () => {
  const room: RoomData = {
    id: 'r',
    widthTiles: 2,
    heightTiles: 1,
    collision: new Uint16Array(2),
    tileClasses: [{ id: 0, solid: 'none' }],
    spawns: {},
    renderLayers: [
      { name: 'bg', tileset: 'tiles.json', data: [[3, -1]] },
      { name: 'main', tileset: 'tiles.json', data: [[0, 1]] },
      { name: 'fg', tileset: 'tiles.json', data: [[-1, 2]] },
    ],
  };
  const tilesets = { 'tiles.json': { image: 'tiles.png', columns: 4, tileCount: 4 } };

  it('keeps the draw order and puts fg above the sprites (depth 0)', () => {
    const plans = tileLayerPlans(room, tilesets);
    expect(plans.map((p) => [p.name, Math.sign(p.depth)])).toEqual([
      ['bg', -1],
      ['main', -1],
      ['fg', 1],
    ]);
    expect((plans[0]?.depth ?? 0) < (plans[1]?.depth ?? 0)).toBe(true);
    expect(plans[2]).toMatchObject({ texture: 'tiles.json', columns: 4, data: [[-1, 2]] });
  });

  it('copies the layer data, so Phaser can never change the room', () => {
    const plans = tileLayerPlans(room, tilesets);
    (plans[1]?.data[0] as number[])[0] = 9;
    expect(room.renderLayers?.[1]?.data[0]).toEqual([0, 1]);
  });

  it('fails on a tileset without an image', () => {
    expect(() => tileLayerPlans(room, {})).toThrow(/tileset "tiles.json" has no image/);
  });
});

describe('hudIcons', () => {
  const runtime = {
    characters: {
      a: {
        id: 'a',
        abilityTags: [],
        collider: { w: 1, h: 1, ox: 0, oy: 0 },
        sprite: {
          atlas: 'chars',
          animations: { idle: { frames: [{ frame: 'a-0', ticks: 1 }], loop: true } },
        },
      },
      b: {
        id: 'b',
        abilityTags: [],
        collider: { w: 1, h: 1, ox: 0, oy: 0 },
        sprite: {
          atlas: 'chars',
          animations: { idle: { frames: [{ frame: 'b-0', ticks: 1 }], loop: true } },
        },
      },
    },
  } as unknown as PackRuntime;

  it('shows every member, the active one marked', () => {
    expect(
      hudIcons({ activeCharacterId: 'b', canSwitch: true, party: [] }, ['a', 'b'], runtime),
    ).toEqual([
      { characterId: 'a', atlas: 'chars', frame: 'a-0', active: false, alive: true },
      { characterId: 'b', atlas: 'chars', frame: 'b-0', active: true, alive: true },
    ]);
  });

  it('shows only the active character when switching is off', () => {
    expect(
      hudIcons({ activeCharacterId: 'a', canSwitch: false, party: [] }, ['a', 'b'], runtime),
    ).toEqual([{ characterId: 'a', atlas: 'chars', frame: 'a-0', active: true, alive: true }]);
  });
});

describe('HP in the HUD (ADR-0016)', () => {
  const runtime = {
    characters: Object.fromEntries(
      ['a', 'b'].map((id) => [
        id,
        {
          id,
          abilityTags: [],
          collider: { w: 1, h: 1, ox: 0, oy: 0 },
          sprite: {
            atlas: 'chars',
            animations: { idle: { frames: [{ frame: `${id}-0`, ticks: 1 }], loop: true } },
          },
        },
      ]),
    ),
  } as unknown as PackRuntime;
  const ui = {
    activeCharacterId: 'b',
    canSwitch: true,
    party: [
      { id: 'a', hp: 0, hpMax: 2, alive: false },
      { id: 'b', hp: 2, hpMax: 3, alive: true },
    ],
  };

  it('gives each icon its HP and whether the member is down', () => {
    expect(hudIcons(ui, ['a', 'b'], runtime).map((i) => [i.alive, i.hp])).toEqual([
      [false, { value: 0, max: 2 }],
      [true, { value: 2, max: 3 }],
    ]);
  });

  it('puts a gauge after each icon, filled by the HP left, inside the band', () => {
    const icons = hudIcons(ui, ['a', 'b'], runtime);
    const band = 20;
    const layout = hudLayout(icons, [16, 16], band);
    expect(layout.icons[0]).toEqual({ x: HUD_PAD, y: HUD_PAD });
    expect(layout.bars.map((b) => [b.icon, b.w, b.fill])).toEqual([
      [0, HP_BAR.w, 0],
      [1, HP_BAR.w, Math.floor((HP_BAR.w * 2) / 3)],
    ]);
    // Each gauge follows its icon, and the next icon comes after it.
    const [a, b] = layout.bars as [(typeof layout.bars)[number], (typeof layout.bars)[number]];
    expect(a.x).toBeGreaterThan((layout.icons[0]?.x ?? 0) + 16);
    expect(layout.icons[1]?.x).toBeGreaterThan(a.x + a.w);
    expect(b.x).toBeGreaterThan((layout.icons[1]?.x ?? 0) + 16);
    for (const bar of layout.bars) {
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.h).toBeLessThanOrEqual(band);
    }
  });

  it('shows every small loss of a fine-grained HP, and never looks empty while any is left', () => {
    const max = 120;
    const fills = Array.from({ length: max + 1 }, (_, hp) => gaugeFill(hp, max, HP_BAR.w));
    expect(fills[max]).toBe(HP_BAR.w);
    expect(fills[0]).toBe(0);
    expect(fills[1]).toBe(1);
    // Never grows as HP drops, and drops by at most one pixel per point.
    for (let hp = 1; hp <= max; hp++) {
      const step = (fills[hp] as number) - (fills[hp - 1] as number);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(1);
    }
  });

  it('draws no gauge without HP', () => {
    const icons = hudIcons({ ...ui, party: [] }, ['a', 'b'], runtime);
    expect(icons.every((i) => i.alive && i.hp === undefined)).toBe(true);
    expect(hudLayout(icons, [16, 16], 20).bars).toEqual([]);
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('renderer boundary', () => {
  // The renderer reads snapshots only (docs/input-and-feel.md: Determinism (c)). It must not
  // reach the World or run the simulation, and Phaser must not keep game time.
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    // Code only: comments may name what the code must not do.
    .map((f) => [f, stripComments(readFileSync(`${dir}${f}`, 'utf8'))] as const);

  it.each([
    'World',
    'step',
    'hashWorld',
    'createWorld',
    'cloneWorld',
    'EntityStore',
    'GameSession',
    'physics',
    'anims',
    'tweens',
    'time.addEvent',
  ])('no source refers to %s', (name) => {
    const pattern = new RegExp(`\\b${name.replace('.', '\\.')}\\b`);
    expect(sources.filter(([, text]) => pattern.test(text)).map(([file]) => file)).toEqual([]);
  });

  it('turns off Phaser input and frame smoothing', () => {
    const game = sources.find(([file]) => file === 'game.ts')?.[1] ?? '';
    expect(game).toContain(
      'input: { keyboard: false, mouse: false, touch: false, gamepad: false }',
    );
    expect(game).toContain('fps: { smoothStep: false }');
  });
});
