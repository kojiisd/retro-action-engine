import { describe, expect, it } from 'vitest';
import { PackLoadError } from './errors';
import { type FetchLike, loadPack } from './load';
import { localize, pickLanguage } from './text';

// A small fictional pack, built per test so each test can break one thing.
// Room "start" is 6x4 tiles: walls (tile 0 = solid), a oneway tile (1), a swim-only tile (2).
const W = 6;
const H = 4;

function motion(jumpVelocity: number) {
  return {
    runSpeed: 1.5,
    groundAccel: 0.25,
    groundDecel: 0.3,
    turnDecel: 0.5,
    airAccel: 0.2,
    airDecel: 0.05,
    airControl: 1,
    jumpVelocity,
    gravity: 0.21,
    fallGravityScale: 1.5,
    maxFallSpeed: 5,
    jumpCutScale: 0.4,
    minJumpTicks: 4,
    apexGravityScale: 0.6,
    apexThreshold: 0.5,
    coyoteTicks: 6,
    jumpBufferTicks: 6,
    dropThroughTicks: 8,
    landingLagTicks: 0,
  };
}

function mainLayer(): number[] {
  // gid = local + 1 (firstgid 1); 0 = empty.
  const rows = [
    [1, 1, 1, 1, 1, 1],
    [1, 0, 2, 0, 3, 1],
    [1, 0, 0, 0, 3, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  return rows.flat();
}

type Files = Record<string, unknown>;

function packFiles(): Files {
  return {
    'pack.json': {
      formatVersion: '1.0',
      id: 'fixture',
      name: 'Fixture Pack',
      version: '0.1.0',
      engine: { formatVersion: '^1.0' },
      display: { width: 96, height: 64, hudReserve: { top: 0, bottom: 0 }, orientation: 'any' },
      tileSize: 16,
      entry: { roomId: 'start', spawnId: 'begin' },
      files: {
        rooms: ['rooms/start.tmj'],
        tilesets: ['tilesets/blocks.json'],
        atlases: { people: 'atlases/people.json' },
        characters: 'data/characters.json',
        rules: 'data/rules.json',
        feel: 'data/feel.json',
        input: 'data/input.json',
      },
      saveCompat: '1',
      licenses: { code: 'MIT', assets: 'CC0-1.0' },
      credits: 'credits.json',
    },
    'credits.json': { assets: [] },
    'data/characters.json': {
      characters: [
        {
          id: 'runner',
          name: 'Runner',
          abilityTags: [],
          collider: { w: 10, h: 20, ox: -5, oy: -20 },
          sprite: {
            atlas: 'people',
            animations: {
              idle: { frames: [{ frame: 'runner-idle', ticks: 30 }], loop: true },
              run: { frames: [{ frame: 'runner-run', ticks: 6 }], loop: true },
            },
          },
        },
        {
          id: 'swimmer',
          name: 'Swim',
          abilityTags: ['move:swim'],
          collider: { w: 10, h: 20, ox: -5, oy: -20 },
          sprite: {
            atlas: 'people',
            animations: { idle: { frames: [{ frame: 'swimmer-idle', ticks: 30 }], loop: true } },
          },
          feelOverrides: { jumpVelocity: 3.3 },
        },
      ],
    },
    'data/rules.json': {
      party: {
        members: ['runner', 'swimmer'],
        switch: { mode: 'anywhere', cooldownTicks: 10, requireGrounded: true, placement: 'same' },
      },
      lives: 3,
    },
    'data/feel.json': {
      default: 'smooth',
      profiles: {
        smooth: { interpolation: 'linear', socd: 'lastWins', ...motion(4) },
        crisp: { name: 'Crisp', interpolation: 'none', socd: 'neutral', ...motion(4.5) },
      },
    },
    'data/input.json': {
      keyboard: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['KeyZ'] },
      gamepad: { standard: { jump: ['button0'], left: ['dpadLeft', 'leftStickLeft'] } },
      analog: { deadzone: 0.5, release: 0.35 },
      touch: {
        layout: 'default',
        layouts: {
          default: {
            handedness: 'right',
            opacity: 0.5,
            dpad: { cx: 0.15, cy: 0.7, radius: 0.2, deadzoneRatio: 0.25, floating: false },
            buttons: [{ action: 'jump', cx: 0.9, cy: 0.75, radius: 0.1 }],
          },
        },
      },
    },
    'atlases/people.json': {
      frames: {
        'runner-idle': { frame: { x: 0, y: 0, w: 16, h: 24 } },
        'runner-run': { frame: { x: 16, y: 0, w: 16, h: 24 } },
        'swimmer-idle': { frame: { x: 0, y: 24, w: 16, h: 24 } },
      },
      meta: { image: 'people.png' },
    },
    'tilesets/blocks.json': {
      tilewidth: 16,
      tileheight: 16,
      tilecount: 4,
      columns: 4,
      image: 'blocks.png',
      tiles: [
        { id: 0, class: 'solid' },
        { id: 1, class: 'oneway' },
        {
          id: 2,
          class: 'solid',
          properties: [{ name: 'requiresAnyTag', type: 'string', value: 'move:swim' }],
        },
      ],
    },
    'rooms/start.tmj': {
      orientation: 'orthogonal',
      infinite: false,
      width: W,
      height: H,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [{ firstgid: 1, source: '../tilesets/blocks.json' }],
      layers: [
        {
          type: 'tilelayer',
          name: 'bg',
          width: W,
          height: H,
          data: new Array(W * H).fill(4),
        },
        { type: 'tilelayer', name: 'main', width: W, height: H, data: mainLayer() },
        {
          type: 'objectgroup',
          name: 'entities',
          objects: [{ name: 'begin', class: 'spawn', x: 24, y: 24, width: 16, height: 8 }],
        },
      ],
    },
  };
}

const BASE = 'https://example.test/packs/fixture/';

/** Serves `files` (JSON values, or raw strings) under BASE; records the URLs read. */
function memoryFetch(files: Files): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const fetchLike = async (url: string) => {
    urls.push(url);
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : undefined;
    const value = path === undefined ? undefined : files[path];
    if (value === undefined) return { ok: false, status: 404, text: async () => '' };
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { ok: true, status: 200, text: async () => text };
  };
  return Object.assign(fetchLike, { urls });
}

/** Loads, expecting a PackLoadError; returns its issues. */
async function issuesOf(files: Files): Promise<readonly string[]> {
  try {
    await loadPack(memoryFetch(files), BASE);
  } catch (error) {
    if (error instanceof PackLoadError) return error.issues;
    throw error;
  }
  throw new Error('expected the load to fail');
}

/** Edits a JSON file of the fixture in place. Tests reach into the JSON freely, untyped. */
// biome-ignore lint/suspicious/noExplicitAny: fixture JSON edited by path in tests
type Json = Record<string, any>;
function edit(files: Files, path: string, change: (json: Json) => void): Files {
  change(files[path] as Json);
  return files;
}

describe('loadPack', () => {
  it('builds a runtime from a valid pack', async () => {
    const { runtime, warnings } = await loadPack(memoryFetch(packFiles()), BASE);
    expect(warnings).toEqual([]);
    expect(runtime.id).toBe('fixture');
    expect(runtime.name).toBe('Fixture Pack');
    expect(runtime.entry).toEqual({ roomId: 'start', spawnId: 'begin' });
    expect(runtime.feelDefault).toBe('smooth');
    expect(Object.keys(runtime.rooms)).toEqual(['start']);
    expect(runtime.rules.party.members).toEqual(['runner', 'swimmer']);
    expect(runtime.assets).toEqual({
      atlases: {
        people: { json: `${BASE}atlases/people.json`, image: `${BASE}atlases/people.png` },
      },
      tilesets: {
        'tilesets/blocks.json': { image: `${BASE}tilesets/blocks.png`, columns: 4, tileCount: 4 },
      },
    });
    expect(runtime.input.gamepad.standard.left).toEqual(['dpadLeft', 'leftStickLeft']);
  });

  it('converts px to Fx with Math.round(v * 256), and keeps tick counts as they are', async () => {
    const files = edit(packFiles(), 'data/feel.json', (f) => {
      f.profiles.smooth.gravity = 0.211; // 54.016 -> 54
      f.profiles.smooth.airDecel = 0.0507; // 12.9792 -> 13
    });
    const { runtime } = await loadPack(memoryFetch(files), BASE);
    const smooth = runtime.feel.smooth;
    expect(smooth?.gravity).toBe(54);
    expect(smooth?.airDecel).toBe(13);
    expect(smooth?.jumpVelocity).toBe(1024);
    expect(smooth?.coyoteTicks).toBe(6);
    expect(smooth?.name).toBe('smooth');
    expect(runtime.feel.crisp?.name).toBe('Crisp');
    expect(runtime.characters.runner?.collider).toEqual({ w: 2560, h: 5120, ox: -1280, oy: -5120 });
    expect(runtime.characters.swimmer?.feelOverrides).toEqual({ jumpVelocity: 845 }); // 844.8
    expect(runtime.characters.runner?.feelOverrides).toBeUndefined();
  });

  it('turns the main layer into collision, tile classes and render layers', async () => {
    const { runtime } = await loadPack(memoryFetch(packFiles()), BASE);
    const room = runtime.rooms.start;
    if (room === undefined) throw new Error('no room');
    expect(room.widthTiles).toBe(W);
    expect(room.heightTiles).toBe(H);
    // Class ids by first appearance: 0 empty, 1 solid, 2 oneway, 3 swim-only.
    expect(room.tileClasses).toEqual([
      { id: 0, solid: 'none' },
      { id: 1, solid: 'full' },
      { id: 2, solid: 'oneway' },
      { id: 3, solid: 'full', requiresAnyTag: ['move:swim'] },
    ]);
    expect(Array.from(room.collision)).toEqual(
      [
        [1, 1, 1, 1, 1, 1],
        [1, 0, 2, 0, 3, 1],
        [1, 0, 0, 0, 3, 1],
        [1, 1, 1, 1, 1, 1],
      ].flat(),
    );
    expect(room.renderLayers?.map((l) => l.name)).toEqual(['bg', 'main']);
    expect(room.renderLayers?.[1]?.tileset).toBe('tilesets/blocks.json');
    expect(room.renderLayers?.[1]?.data[1]).toEqual([0, -1, 1, -1, 2, 0]);
    expect(room.renderLayers?.[0]?.data[0]).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('places a spawn at the bottom center of its rectangle, in Fx', async () => {
    const { runtime } = await loadPack(memoryFetch(packFiles()), BASE);
    expect(runtime.rooms.start?.spawns.begin).toEqual({ x: 32 * 256, y: 32 * 256 });
  });

  it('draws bg, main, fg in that order whatever the order in the file', async () => {
    const files = edit(packFiles(), 'rooms/start.tmj', (m) => {
      const fg = {
        type: 'tilelayer',
        name: 'fg',
        width: W,
        height: H,
        data: new Array(W * H).fill(0),
      };
      fg.data[7] = 2;
      m.layers.unshift(fg);
      m.layers.reverse();
    });
    const { runtime } = await loadPack(memoryFetch(files), BASE);
    expect(runtime.rooms.start?.renderLayers?.map((l) => l.name)).toEqual(['bg', 'main', 'fg']);
  });

  it('warns about layers outside the convention and objects it does not read yet', async () => {
    const files = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers.push({
        type: 'objectgroup',
        name: 'zones',
        objects: [{ name: 'view', class: 'camera', x: 0, y: 0, width: 16, height: 16 }],
      });
      m.layers.push({ type: 'tilelayer', name: 'decor', width: W, height: H, data: [] });
      m.layers[2].objects.push({ name: 'slime', class: 'enemy', x: 0, y: 0 });
    });
    const { warnings } = await loadPack(memoryFetch(files), BASE);
    expect(warnings).toEqual([
      'rooms/start.tmj#/layers/2/objects/1: object "slime" (enemy) is not read yet (M3)',
      'rooms/start.tmj#/layers/3/objects/0: zone "view" (camera) is not read yet',
      'rooms/start.tmj#/layers/4: layer "decor" is not part of the convention; ignored',
    ]);
  });

  it('warns about flipped tiles and draws them unflipped', async () => {
    const files = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers[1].data[0] = (0x80000000 | 1) >>> 0;
    });
    const { runtime, warnings } = await loadPack(memoryFetch(files), BASE);
    expect(warnings).toEqual([
      'rooms/start.tmj#/layers/1: layer "main" has flipped tiles; they are drawn unflipped',
    ]);
    expect(runtime.rooms.start?.collision[0]).toBe(1);
  });
});

describe('loadPack: HP, HP-draining tiles and media (ADR-0016)', () => {
  /** The swim-only tile becomes an open tile of fumes and mist; both members get HP. */
  function withHazards(): Files {
    const files = edit(packFiles(), 'tilesets/blocks.json', (t) => {
      t.tiles[2] = {
        id: 2,
        properties: [
          { name: 'hazard', type: 'string', value: 'fumes' },
          { name: 'medium', type: 'string', value: 'mist' },
        ],
      };
    });
    edit(files, 'data/characters.json', (c) => {
      c.characters[0].hp = { max: 4 };
      c.characters[1].hp = { max: 6 };
    });
    edit(files, 'data/rules.json', (r) => {
      r.hp = { scope: 'perCharacter', onDeath: 'switchToAlive', onAllDown: 'respawnAtSavePoint' };
      r.hazards = {
        fumes: { damage: 1, intervalTicks: 30, byTag: [{ anyTag: ['move:swim'], damage: 2 }] },
      };
    });
    edit(files, 'data/feel.json', (f) => {
      f.profiles.smooth.media = { mist: { gravity: 0.1, maxFallSpeed: 1.25, swim: true } };
    });
    return files;
  }

  it('reads them into the runtime, media values in Fx', async () => {
    const { runtime, warnings } = await loadPack(memoryFetch(withHazards()), BASE);
    expect(warnings).toEqual([]);
    expect(runtime.rooms.start?.tileClasses[3]).toEqual({
      id: 3,
      solid: 'none',
      hazard: 'fumes',
      medium: 'mist',
    });
    expect(runtime.characters.runner?.hp).toEqual({ max: 4 });
    expect(runtime.rules.hp?.onDeath).toBe('switchToAlive');
    expect(runtime.rules.hazards?.fumes?.byTag?.[0]).toEqual({ anyTag: ['move:swim'], damage: 2 });
    expect(runtime.feel.smooth?.media).toEqual({
      mist: { gravity: Math.round(0.1 * 256), maxFallSpeed: Math.round(1.25 * 256), swim: true },
    });
    expect(runtime.feel.crisp?.media).toBeUndefined();
  });

  it('requires HP for every member, HP rules for hazards, and every tile hazard defined', async () => {
    const noHp = edit(withHazards(), 'data/characters.json', (c) => {
      delete c.characters[1].hp;
    });
    expect(await issuesOf(noHp)).toEqual([
      'data/rules.json#/party/members/1: character "swimmer" needs hp.max, because rules.hp is set',
    ]);
    const noRules = edit(withHazards(), 'data/rules.json', (r) => {
      delete r.hp;
    });
    expect(await issuesOf(noRules)).toEqual(['data/rules.json#/hazards: hazards need rules.hp']);
    const undefinedKind = edit(withHazards(), 'data/rules.json', (r) => {
      r.hazards = { smoke: { damage: 1, intervalTicks: 10 } };
    });
    expect(await issuesOf(undefinedKind)).toEqual([
      'data/rules.json#/hazards: hazard "fumes" (a tile in room "start") is not defined',
    ]);
  });

  it('rejects the old contact-damage class and empty names', async () => {
    const files = edit(packFiles(), 'tilesets/blocks.json', (t) => {
      t.tiles[1] = { id: 1, class: 'hazard', properties: [{ name: 'damage', value: 1 }] };
      t.tiles[2].properties.push({ name: 'medium', type: 'string', value: ' ' });
    });
    expect(await issuesOf(files)).toEqual([
      'tilesets/blocks.json#/tiles/1: the "hazard" class was replaced by the "hazard" property (docs/pack-spec.md 5.3)',
      'tilesets/blocks.json#/tiles/2: medium must be a non-empty string',
    ]);
  });
});

describe('loadPack: exits (ADR-0018)', () => {
  /** A second room "side" (a copy of "start" with a spawn "back"), and exits between them. */
  function withExits(exits: Json[], camera?: Json): Files {
    const files = packFiles();
    const manifest = files['pack.json'] as Json;
    manifest.files.rooms.push('rooms/side.tmj');
    if (camera !== undefined) {
      manifest.files.camera = 'data/camera.json';
      files['data/camera.json'] = camera;
    }
    const side = structuredClone(files['rooms/start.tmj']) as Json;
    side.layers[2].objects = [{ name: 'back', class: 'spawn', x: 24, y: 24, width: 16, height: 8 }];
    files['rooms/side.tmj'] = side;
    edit(files, 'rooms/start.tmj', (m) => {
      m.layers.push({ type: 'objectgroup', name: 'exits', objects: exits });
    });
    return files;
  }
  const prop = (name: string, value: string) => ({ name, type: 'string', value });
  const exit = (x: number, y: number, w: number, h: number, props: Json[]) => ({
    name: 'way',
    class: 'exit',
    x,
    y,
    width: w,
    height: h,
    properties: props,
  });
  const to = (kind: string, more: Json[] = []) => [
    prop('kind', kind),
    prop('toRoomId', 'side'),
    prop('spawnId', 'back'),
    ...more,
  ];

  it('reads exits in px to Fx, with the effect from camera.json when none is set', async () => {
    const files = withExits(
      [
        exit(80, 16, 16, 32, to('edge')),
        exit(32, 16, 16, 32, to('door', [prop('effect', 'cut')])),
        exit(
          48,
          16,
          16,
          32,
          to('warp', [prop('requiresAnyTag', 'move:swim, size:small'), prop('requiresFlag', 'on')]),
        ),
      ],
      {
        mode: 'screenFlip',
        screenFlip: {
          transition: 'cut',
          transitionTicks: 0,
          pauseSimulation: false,
          triggerInsetPx: 0,
        },
        roomTransition: { effect: 'fade', lockTicks: 12 },
      },
    );
    const { runtime } = await loadPack(memoryFetch(files), BASE);
    expect(runtime.rooms.start?.exits).toEqual([
      {
        kind: 'edge',
        rect: { x: 80 * 256, y: 16 * 256, w: 16 * 256, h: 32 * 256 },
        toRoomId: 'side',
        spawnId: 'back',
        effect: 'fade',
      },
      {
        kind: 'door',
        rect: { x: 32 * 256, y: 16 * 256, w: 16 * 256, h: 32 * 256 },
        toRoomId: 'side',
        spawnId: 'back',
        effect: 'cut',
      },
      {
        kind: 'warp',
        rect: { x: 48 * 256, y: 16 * 256, w: 16 * 256, h: 32 * 256 },
        toRoomId: 'side',
        spawnId: 'back',
        effect: 'fade',
        requiresAnyTag: ['move:swim', 'size:small'],
        requiresFlag: 'on',
      },
    ]);
    expect(runtime.rooms.side?.exits).toEqual([]);
    expect(runtime.roomTransition).toEqual({ effect: 'fade', lockTicks: 12 });
  });

  it('falls back to "cut" without camera.json', async () => {
    const { runtime } = await loadPack(
      memoryFetch(withExits([exit(32, 16, 16, 32, to('warp'))])),
      BASE,
    );
    expect(runtime.rooms.start?.exits?.[0]?.effect).toBe('cut');
    expect(runtime.roomTransition).toBeUndefined();
  });

  it('rejects broken exits, naming the object', async () => {
    const files = withExits([
      exit(32, 16, 16, 32, to('edge')),
      exit(32, 16, 16, 32, [prop('kind', 'hole'), prop('effect', 'scroll')]),
      exit(32, 16, 0, 32, [...to('warp'), prop('requiresFlag', ' ')]),
      { name: 'x', class: 'zone', x: 0, y: 0, width: 16, height: 16 },
    ]);
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/layers/3/objects/0: an "edge" exit must touch the border of the room',
      'rooms/start.tmj#/layers/3/objects/1/properties/kind: kind must be one of edge, door, warp',
      'rooms/start.tmj#/layers/3/objects/1/properties/toRoomId: toRoomId is required',
      'rooms/start.tmj#/layers/3/objects/1/properties/spawnId: spawnId is required',
      'rooms/start.tmj#/layers/3/objects/1/properties/effect: effect "scroll" comes with the camera (M3-2); use "fade" or "cut"',
      'rooms/start.tmj#/layers/3/objects/2/properties/requiresFlag: requiresFlag must be a flag name',
      'rooms/start.tmj#/layers/3/objects/2: an exit must be a rectangle with a size',
      'rooms/start.tmj#/layers/3/objects/3/class: objects in "exits" must have the class "exit"',
    ]);
  });

  it('rejects an exit to a room or spawn that does not exist', async () => {
    const files = withExits([
      exit(32, 16, 16, 32, [
        prop('kind', 'door'),
        prop('toRoomId', 'nowhere'),
        prop('spawnId', 'back'),
      ]),
      exit(48, 16, 16, 32, [
        prop('kind', 'door'),
        prop('toRoomId', 'side'),
        prop('spawnId', 'nope'),
      ]),
    ]);
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/layers/3/objects/0/properties/toRoomId: room "nowhere" is not defined',
      'rooms/start.tmj#/layers/3/objects/1/properties/spawnId: spawn "nope" is not in room "side"',
    ]);
  });
});

describe('loadPack: camera (ADR-0009)', () => {
  function withCamera(camera: Json): Files {
    const files = packFiles();
    (files['pack.json'] as Json).files.camera = 'data/camera.json';
    files['data/camera.json'] = camera;
    return files;
  }
  const scroll = {
    deadzone: { w: 32, h: 48 },
    lookahead: { x: 24, y: 0 },
    lerpShift: 3,
    lockY: false,
  };

  it('reads a scroll camera, with the defaults filled in', async () => {
    const { runtime } = await loadPack(memoryFetch(withCamera({ mode: 'scroll', scroll })), BASE);
    expect(runtime.camera).toEqual({
      mode: 'scroll',
      activationMarginPx: 0,
      scroll: { ...scroll, followY: 'always' },
    });
  });

  it('rejects a mode without its settings, and snapToTileRows', async () => {
    expect(await issuesOf(withCamera({ mode: 'scroll' }))).toEqual([
      'data/camera.json#/scroll: mode "scroll" needs "scroll"',
    ]);
    expect(await issuesOf(withCamera({ mode: 'screenFlip' }))).toEqual([
      'data/camera.json#/screenFlip: mode "screenFlip" needs "screenFlip"',
    ]);
    expect(
      await issuesOf(withCamera({ mode: 'scroll', scroll: { ...scroll, snapToTileRows: true } })),
    ).toEqual([
      'data/camera.json#/scroll/snapToTileRows: snapToTileRows is not supported yet (ADR-0009)',
    ]);
  });
});

describe('loadPack: attack (ADR-0017)', () => {
  function withAttack(): Files {
    const files = edit(packFiles(), 'data/characters.json', (c) => {
      const idle = c.characters[0].sprite.animations.idle.frames[0].frame;
      c.characters[0].sprite.animations.attack = {
        frames: [
          { frame: idle, ticks: 3 },
          { frame: idle, ticks: 5, hitbox: { x: 4.5, y: -20, w: 12, h: 10 } },
        ],
        loop: false,
      };
    });
    edit(files, 'data/feel.json', (f) => {
      f.profiles.smooth.attackOnGround = 'move';
    });
    return files;
  }

  it('reads hitboxes in Fx, and the ground rule of the profile', async () => {
    const { runtime } = await loadPack(memoryFetch(withAttack()), BASE);
    const frames = runtime.characters.runner?.sprite?.animations.attack?.frames;
    expect(frames?.[0]?.hitbox).toBeUndefined();
    expect(frames?.[1]?.hitbox).toEqual({
      x: Math.round(4.5 * 256),
      y: -20 * 256,
      w: 12 * 256,
      h: 10 * 256,
    });
    expect(runtime.feel.smooth?.attackOnGround).toBe('move');
    expect(runtime.feel.crisp?.attackOnGround).toBeUndefined();
  });

  it('reads the attack buffer in ticks, and rejects one that is not a whole number (M3-2c)', async () => {
    const files = edit(withAttack(), 'data/feel.json', (f) => {
      f.profiles.smooth.attackBufferTicks = 5;
    });
    const { runtime } = await loadPack(memoryFetch(files), BASE);
    expect(runtime.feel.smooth?.attackBufferTicks).toBe(5);
    expect(runtime.feel.crisp?.attackBufferTicks).toBeUndefined();
    const bad = edit(withAttack(), 'data/feel.json', (f) => {
      f.profiles.smooth.attackBufferTicks = 1.5;
    });
    expect((await issuesOf(bad))[0]).toMatch(
      /^data\/feel\.json#\/profiles\/smooth\/attackBufferTicks: /,
    );
  });

  it('rejects a looping attack and an empty hitbox', async () => {
    const files = edit(withAttack(), 'data/characters.json', (c) => {
      c.characters[0].sprite.animations.attack.loop = true;
    });
    expect(await issuesOf(files)).toEqual([
      'data/characters.json#/characters/0/sprite/animations/attack/loop: the "attack" animation must not loop (its length is the swing)',
    ]);
    const empty = edit(withAttack(), 'data/characters.json', (c) => {
      c.characters[0].sprite.animations.attack.frames[1].hitbox.w = 0;
    });
    expect((await issuesOf(empty))[0]).toMatch(
      /^data\/characters\.json#\/characters\/0\/sprite\/animations\/attack\/frames\/1\/hitbox\/w: /,
    );
  });
});

describe('loadPack: ladders (ADR-0019)', () => {
  it('reads the climbing values of a profile in Fx, absent where not given', async () => {
    const files = edit(packFiles(), 'data/feel.json', (f) => {
      f.profiles.smooth.climbSpeed = 1.25;
      f.profiles.smooth.climbJumpVelocity = 2;
    });
    const { runtime } = await loadPack(memoryFetch(files), BASE);
    expect(runtime.feel.smooth?.climbSpeed).toBe(Math.round(1.25 * 256));
    expect(runtime.feel.smooth?.climbJumpVelocity).toBe(2 * 256);
    expect(runtime.feel.crisp?.climbSpeed).toBeUndefined();
    expect(runtime.feel.crisp?.climbJumpVelocity).toBeUndefined();
  });

  it('rejects a climbing speed that is not positive', async () => {
    const files = edit(packFiles(), 'data/feel.json', (f) => {
      f.profiles.smooth.climbSpeed = 0;
    });
    expect((await issuesOf(files))[0]).toMatch(
      /^data\/feel\.json#\/profiles\/smooth\/climbSpeed: /,
    );
  });
});

describe('loadPack errors', () => {
  it('reports schema errors as file#/pointer: message, from every file at once', async () => {
    const files = packFiles();
    edit(files, 'pack.json', (p) => {
      p.tileSize = 0;
    });
    const issues = await issuesOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^pack\.json#\/tileSize: /);

    const more = packFiles();
    edit(more, 'data/characters.json', (c) => {
      c.characters[1].collider.w = -1;
    });
    edit(more, 'data/input.json', (i) => {
      i.gamepad.standard.jump = ['trigger'];
    });
    const all = await issuesOf(more);
    expect(all.some((m) => m.startsWith('data/characters.json#/characters/1/collider/w: '))).toBe(
      true,
    );
    expect(all.some((m) => m.startsWith('data/input.json#/gamepad/standard/jump/0: '))).toBe(true);
  });

  it('requires the analog release threshold below the deadzone', async () => {
    const files = edit(packFiles(), 'data/input.json', (i) => {
      i.analog.release = 0.5;
    });
    expect(await issuesOf(files)).toEqual([
      'data/input.json#/analog/release: analog.release must be smaller than analog.deadzone (hysteresis)',
    ]);
  });

  it('checks the virtual pad layouts', async () => {
    const missing = edit(packFiles(), 'data/input.json', (i) => {
      i.touch.layout = 'compact';
    });
    expect(await issuesOf(missing)).toEqual([
      'data/input.json#/touch/layout: touch.layout must name one of touch.layouts',
    ]);
    const bad = edit(packFiles(), 'data/input.json', (i) => {
      i.touch.layouts.default.buttons[0].action = 'dash';
      i.touch.layouts.default.dpad.radius = 0.6;
      i.touch.layouts.default.dpad.deadzoneRatio = 1;
    });
    const issues = await issuesOf(bad);
    expect(issues.map((m) => m.split(':')[0])).toEqual([
      'data/input.json#/touch/layouts/default/dpad/radius',
      'data/input.json#/touch/layouts/default/dpad/deadzoneRatio',
      'data/input.json#/touch/layouts/default/buttons/0/action',
    ]);
  });

  it('keeps the virtual pad layout as it is (ratios, not px)', async () => {
    const { runtime } = await loadPack(memoryFetch(packFiles()), BASE);
    expect(runtime.input.touch.layouts.default?.dpad).toEqual({
      cx: 0.15,
      cy: 0.7,
      radius: 0.2,
      deadzoneRatio: 0.25,
      floating: false,
    });
  });

  it('skips rooms whose tileset is broken instead of reporting follow-on errors', async () => {
    const files = edit(packFiles(), 'tilesets/blocks.json', (t) => {
      t.columns = 0;
    });
    expect(await issuesOf(files)).toEqual([
      'tilesets/blocks.json#/columns: Too small: expected number to be >0',
    ]);
  });

  it('reports a missing file and invalid JSON', async () => {
    const files = packFiles();
    delete files['data/rules.json'];
    files['data/feel.json'] = '{ not json';
    const issues = await issuesOf(files);
    expect(issues).toContain('data/rules.json#: could not be read (HTTP 404)');
    expect(issues.some((m) => m.startsWith('data/feel.json#: is not valid JSON'))).toBe(true);
  });

  it('rejects an engine format it cannot read', async () => {
    const files = edit(packFiles(), 'pack.json', (p) => {
      p.engine.formatVersion = '^2.0';
    });
    expect(await issuesOf(files)).toEqual([
      'pack.json#/engine/formatVersion: this engine reads format 1.x',
    ]);
  });

  it.each([
    ['../outside.json', 'leaves the pack'],
    ['../../etc/rules.json', 'leaves the pack'],
    ['/data/rules.json', 'is not a relative path'],
    ['https://example.test/rules.json', 'is a URL'],
    ['//example.test/rules.json', 'is a URL'],
    ['data\\rules.json', 'characters a pack path cannot have'],
  ])('rejects the path %s and reads nothing outside the pack', async (path, message) => {
    const files = edit(packFiles(), 'pack.json', (p) => {
      p.files.rules = path;
    });
    const fetchLike = memoryFetch(files);
    await expect(loadPack(fetchLike, BASE)).rejects.toThrow(message);
    expect(fetchLike.urls).toEqual([`${BASE}pack.json`]);
  });

  it('rejects paths that leave the pack from inside other files', async () => {
    const files = packFiles();
    edit(files, 'rooms/start.tmj', (m) => {
      m.tilesets[0].source = '../../blocks.json';
    });
    edit(files, 'atlases/people.json', (a) => {
      a.meta.image = 'https://example.test/people.png';
    });
    const issues = await issuesOf(files);
    expect(issues).toContain(
      'rooms/start.tmj#/tilesets/0/source: "../../blocks.json" leaves the pack',
    );
    expect(issues).toContain(
      'atlases/people.json#/meta/image: "https://example.test/people.png" is a URL; only paths inside the pack are allowed',
    );
  });

  it('checks references between files', async () => {
    const files = packFiles();
    edit(files, 'pack.json', (p) => {
      p.entry.spawnId = 'nowhere';
    });
    edit(files, 'data/rules.json', (r) => {
      r.party.members.push('ghost');
    });
    edit(files, 'data/feel.json', (f) => {
      f.default = 'missing';
    });
    edit(files, 'data/characters.json', (c) => {
      c.characters[0].sprite.animations.run.frames[0].frame = 'runner-dash';
      c.characters[1].sprite.atlas = 'others';
      c.characters[1].sprite.animations = { run: c.characters[0].sprite.animations.idle };
    });
    expect(await issuesOf(files)).toEqual([
      'data/characters.json#/characters/0/sprite/animations/run/frames/0/frame: frame "runner-dash" is not in atlases/people.json',
      'data/characters.json#/characters/1/sprite/atlas: atlas "others" is not listed in pack.json files.atlases',
      'data/characters.json#/characters/1/sprite/animations: an "idle" animation is required',
      'data/rules.json#/party/members/2: character "ghost" is not defined',
      'data/feel.json#/default: profile "missing" is not defined',
      'pack.json#/entry/spawnId: spawn "nowhere" is not in room "start"',
    ]);
  });

  it('reports an entry room that does not exist and a tileset the pack does not list', async () => {
    const files = packFiles();
    edit(files, 'pack.json', (p) => {
      p.entry.roomId = 'attic';
    });
    files['tilesets/other.json'] = files['tilesets/blocks.json'];
    edit(files, 'rooms/start.tmj', (m) => {
      m.tilesets[0].source = '../tilesets/other.json';
    });
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/tilesets/0/source: "tilesets/other.json" is not listed in pack.json files.tilesets',
      'pack.json#/entry/roomId: room "attic" is not defined',
    ]);
  });

  it('rejects tile sizes that differ from the pack', async () => {
    const files = packFiles();
    edit(files, 'tilesets/blocks.json', (t) => {
      t.tilewidth = 8;
    });
    edit(files, 'rooms/start.tmj', (m) => {
      m.tileheight = 8;
    });
    expect(await issuesOf(files)).toEqual([
      'tilesets/blocks.json#/tilewidth: tiles must be 16x16 like the pack',
      'rooms/start.tmj#/tilewidth: tiles must be 16x16 like the pack',
    ]);
  });

  it('rejects unknown and unsupported tile classes', async () => {
    const files = edit(packFiles(), 'tilesets/blocks.json', (t) => {
      t.tiles[0].class = 'lava';
      t.tiles[1].class = 'slope';
    });
    expect(await issuesOf(files)).toEqual([
      'tilesets/blocks.json#/tiles/0: unknown tile class "lava"',
      'tilesets/blocks.json#/tiles/1: slope tiles are not supported yet (M5)',
    ]);
  });

  it('requires a main layer of the map size, one tileset per layer, and gids in range', async () => {
    const noMain = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers[1].name = 'fg';
    });
    expect(await issuesOf(noMain)).toEqual([
      'rooms/start.tmj#/layers: a tile layer named "main" is required',
    ]);

    const badSize = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers[1].data.pop();
    });
    expect(await issuesOf(badSize)).toEqual([
      'rooms/start.tmj#/layers/1: layer "main" must be 6x4 tiles',
    ]);

    const outOfRange = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers[1].data[0] = 9;
    });
    expect(await issuesOf(outOfRange)).toEqual([
      'rooms/start.tmj#/layers/1: layer "main" uses tile 8 past the end of its tileset',
    ]);

    const twoSets = packFiles();
    twoSets['tilesets/more.json'] = { ...(twoSets['tilesets/blocks.json'] as object), tiles: [] };
    edit(twoSets, 'pack.json', (p) => {
      p.files.tilesets.push('tilesets/more.json');
    });
    edit(twoSets, 'rooms/start.tmj', (m) => {
      m.tilesets.push({ firstgid: 5, source: '../tilesets/more.json' });
      m.layers[1].data[0] = 5;
    });
    expect(await issuesOf(twoSets)).toEqual([
      'rooms/start.tmj#/layers/1: layer "main" mixes tilesets; use one per layer',
    ]);
  });

  it('reports each uncovered gid once per layer', async () => {
    const files = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.tilesets[0].firstgid = 5;
    });
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/layers/0: layer "bg" uses gid 4, which no tileset covers',
      'rooms/start.tmj#/layers/1: layer "main" uses gid 1, which no tileset covers',
      'rooms/start.tmj#/layers/1: layer "main" uses gid 2, which no tileset covers',
      'rooms/start.tmj#/layers/1: layer "main" uses gid 3, which no tileset covers',
    ]);
  });

  it('rejects two spawns with the same name', async () => {
    const files = edit(packFiles(), 'rooms/start.tmj', (m) => {
      m.layers[2].objects.push({ name: 'begin', class: 'spawn', x: 0, y: 0 });
    });
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/layers/2/objects/1: spawn "begin" is defined twice',
    ]);
  });
});

describe('loadPack determinism', () => {
  it('gives the same runtime and issues whatever order the files arrive in', async () => {
    // Answers each request after a delay that reverses the request order.
    const delayed = (files: Files, reverse: boolean): FetchLike => {
      const inner = memoryFetch(files);
      let n = 0;
      return async (url) => {
        const i = n++;
        await new Promise((r) => setTimeout(r, reverse ? 40 - i : i));
        return inner(url);
      };
    };
    const twoRooms = () => {
      const files = edit(packFiles(), 'pack.json', (p) => {
        p.files.rooms.push('rooms/annex.tmj');
      });
      files['rooms/annex.tmj'] = structuredClone(files['rooms/start.tmj']);
      return files;
    };
    const a = await loadPack(delayed(twoRooms(), false), BASE);
    const b = await loadPack(delayed(twoRooms(), true), BASE);
    expect(Object.keys(a.runtime.rooms)).toEqual(['start', 'annex']);
    expect(JSON.stringify(b.runtime, (_k, v) => (v instanceof Uint16Array ? [...v] : v))).toBe(
      JSON.stringify(a.runtime, (_k, v) => (v instanceof Uint16Array ? [...v] : v)),
    );

    const broken = () =>
      edit(packFiles(), 'data/characters.json', (c) => {
        c.characters[0].sprite.atlas = 'nope';
        c.characters[1].sprite.atlas = 'none';
      });
    const issues = async (reverse: boolean) => {
      try {
        await loadPack(delayed(broken(), reverse), BASE);
      } catch (error) {
        return (error as PackLoadError).issues;
      }
      return [];
    };
    expect(await issues(true)).toEqual(await issues(false));
  });
});

describe('loadPack: strings, names and the menu (ADR-0020)', () => {
  function withStrings(ja: string, en: string): Files {
    const files = packFiles();
    (files['pack.json'] as Json).files.strings = {
      ja: 'data/strings.ja.json',
      en: 'data/strings.en.json',
    };
    files['data/strings.ja.json'] = { 'char.runner': ja };
    files['data/strings.en.json'] = { 'char.runner': en };
    return edit(files, 'data/characters.json', (c) => {
      c.characters[0].name = '@strings:char.runner';
    });
  }
  const UI = {
    font: {
      image: '../ui/font.png',
      cellW: 12,
      cellH: 13,
      ascent: 11,
      glyphs: [
        ['?', 6],
        ['A', 6],
        ['あ', 12],
      ],
    },
    colors: {
      border: '#ffffff',
      fill: '#182860',
      text: '#ffffff',
      accent: '#ffe678',
      dim: '#7880a0',
      cursor: '#ffffff',
      gauge: '#f05a50',
      gaugeBack: '#1c1216',
    },
  };
  function withUi(change: (ui: Json) => void = () => {}): Files {
    const files = packFiles();
    (files['pack.json'] as Json).files.ui = 'data/ui.json';
    const ui = structuredClone(UI) as Json;
    change(ui);
    files['data/ui.json'] = ui;
    return files;
  }

  it('reads the strings by language, the first one being the default, and picks a language', async () => {
    const { runtime } = await loadPack(memoryFetch(withStrings('ソラト', 'Sorato')), BASE);
    expect(Object.keys(runtime.strings ?? {})).toEqual(['ja', 'en']);
    const name = runtime.characters.runner?.name as string;
    expect(localize(runtime, name, pickLanguage(runtime, ['ja-JP']))).toBe('ソラト');
    expect(localize(runtime, name, pickLanguage(runtime, ['en-US', 'ja']))).toBe('Sorato');
    expect(localize(runtime, name, pickLanguage(runtime, ['fr']))).toBe('ソラト');
    expect(localize(runtime, 'Plain', 'en')).toBe('Plain');
  });

  it('rejects a name key missing in a language, and a name longer than six characters', async () => {
    const missing = withStrings('ソラト', 'Sorato');
    missing['data/strings.en.json'] = {};
    expect(await issuesOf(missing)).toEqual([
      'data/characters.json#/characters/0/name: "char.runner" is not in data/strings.en.json',
    ]);
    expect(await issuesOf(withStrings('ソラトソラト1', 'Sorato'))).toEqual([
      'data/characters.json#/characters/0/name: "ソラトソラト1" is 7 characters; a name has 1 to 6',
    ]);
    // Six is fine, counted in characters, not bytes.
    await expect(
      loadPack(memoryFetch(withStrings('ソラトソラト', 'Sorato')), BASE),
    ).resolves.toBeDefined();
    const plain = edit(packFiles(), 'data/characters.json', (c) => {
      c.characters[0].name = 'Runner77';
    });
    expect(await issuesOf(plain)).toEqual([
      'data/characters.json#/characters/0/name: "Runner77" is 8 characters; a name has 1 to 6',
    ]);
  });

  it('reads the menu font and colors, with the image as a URL', async () => {
    const { runtime } = await loadPack(memoryFetch(withUi()), BASE);
    expect(runtime.ui?.font).toMatchObject({ cellW: 12, cellH: 13, ascent: 11 });
    expect(runtime.ui?.font.image).toBe(`${BASE}ui/font.png`);
    expect(runtime.ui?.font.glyphs).toEqual(UI.font.glyphs);
    expect(runtime.ui?.colors.fill).toBe('#182860');
    // No ui.json: no menu.
    expect((await loadPack(memoryFetch(packFiles()), BASE)).runtime.ui).toBeUndefined();
  });

  it('rejects a font without "?", a glyph of two characters or listed twice, and a bad color', async () => {
    expect(
      await issuesOf(
        withUi((ui) => {
          ui.font.glyphs = [
            ['AB', 6],
            ['あ', 12],
            ['あ', 12],
            ['A', 13],
          ];
          ui.colors.text = 'white';
        }),
      ),
    ).toEqual(['data/ui.json#/colors/text: expected "#rrggbb"']);
    expect(
      await issuesOf(
        withUi((ui) => {
          ui.font.glyphs = [
            ['AB', 6],
            ['あ', 12],
            ['あ', 12],
            ['A', 13],
          ];
        }),
      ),
    ).toEqual([
      'data/ui.json#/font/glyphs/0/0: "AB" is not one character',
      'data/ui.json#/font/glyphs/2/0: "あ" is listed twice',
      'data/ui.json#/font/glyphs/3/1: the width 13 is wider than the cell',
      'data/ui.json#/font/glyphs: a "?" glyph is required (it stands in for missing ones)',
    ]);
  });
});

describe('loadPack: items, gimmicks and events (ADR-0021)', () => {
  /** The fixture with items, gimmicks, an `objects` atlas, and these objects in the room. */
  function withGimmicks(objects: Json[], zones: Json[] = []): Files {
    const files = packFiles();
    const manifest = files['pack.json'] as Json;
    manifest.files.items = 'data/items.json';
    manifest.files.gimmicks = 'data/gimmicks.json';
    manifest.files.atlases.objects = 'atlases/objects.json';
    files['atlases/objects.json'] = {
      frames: Object.fromEntries(
        ['charm', 'rock', 'lever', 'lever-on', 'bars'].map((name, i) => [
          name,
          { frame: { x: i * 16, y: 0, w: 16, h: 16 } },
        ]),
      ),
      meta: { image: 'objects.png' },
    };
    files['data/items.json'] = {
      items: [
        {
          id: 'charm',
          name: 'Charm',
          kind: 'upgrade',
          grants: ['break:test'],
          stack: 1,
          sprite: { atlas: 'objects', frame: 'charm' },
        },
        {
          id: 'coin',
          name: 'Coin',
          kind: 'key',
          stack: 9,
          sprite: { atlas: 'objects', frame: 'charm' },
        },
      ],
    };
    files['data/gimmicks.json'] = {
      gimmicks: [
        { id: 'charm', type: 'pickup', itemId: 'charm' },
        {
          id: 'rock',
          type: 'breakable',
          requiresAnyTag: ['break:test'],
          sprite: { atlas: 'objects', frame: 'rock' },
        },
        {
          id: 'lever',
          type: 'switch',
          setsFlag: 'bars-open',
          sprite: { atlas: 'objects', frame: 'lever' },
          frameOn: 'lever-on',
        },
        {
          id: 'bars',
          type: 'gate',
          requiresFlag: 'bars-open',
          sprite: { atlas: 'objects', frame: 'bars' },
        },
      ],
    };
    edit(files, 'data/rules.json', (r) => {
      r.inventory = { scope: 'shared' };
      r.gating = { subject: 'anyInParty' };
    });
    edit(files, 'rooms/start.tmj', (m) => {
      m.layers[2].objects.push(...objects);
      if (zones.length > 0) m.layers.push({ type: 'objectgroup', name: 'zones', objects: zones });
    });
    return files;
  }
  const prop = (name: string, value: unknown) => ({ name, type: typeof value, value });
  const gimmick = (
    id: number,
    gimmickId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    more: Json[] = [],
  ) => ({
    id,
    name: '',
    class: 'gimmick',
    x,
    y,
    width: w,
    height: h,
    properties: [prop('gimmickId', gimmickId), ...more],
  });
  const fx = (px: number) => px * 256;

  it('reads items, gimmicks merged with their object, and the rules', async () => {
    const files = withGimmicks([
      gimmick(7, 'charm', 20, 20, 8, 8),
      gimmick(8, 'rock', 16, 16, 16, 32),
      gimmick(9, 'lever', 48, 16, 16, 16),
      gimmick(10, 'bars', 64, 16, 16, 32),
      gimmick(11, 'charm', 40, 20, 8, 8, [
        prop('itemId', 'coin'),
        prop('count', 3),
        prop('onceFlag', 'coin-a'),
      ]),
      gimmick(12, 'rock', 32, 32, 16, 16, [
        prop('requiresAnyTag', 'move:swim, break:test'),
        prop('flag', 'cracked'),
      ]),
    ]);
    const { runtime, warnings } = await loadPack(memoryFetch(files), BASE);
    expect(warnings).toEqual([]);
    expect(runtime.items).toEqual({
      charm: {
        id: 'charm',
        name: 'Charm',
        kind: 'upgrade',
        grants: ['break:test'],
        stack: 1,
        sprite: { atlas: 'objects', frame: 'charm' },
      },
      coin: {
        id: 'coin',
        name: 'Coin',
        kind: 'key',
        stack: 9,
        sprite: { atlas: 'objects', frame: 'charm' },
      },
    });
    expect(runtime.rules.gating).toEqual({ subject: 'anyInParty' });
    const rect = (x: number, y: number, w: number, h: number) => ({
      x: fx(x),
      y: fx(y),
      w: fx(w),
      h: fx(h),
    });
    expect(runtime.rooms.start?.gimmicks).toEqual([
      {
        objectId: 7,
        type: 'pickup',
        rect: rect(20, 20, 8, 8),
        flag: 'obj:start:7',
        itemId: 'charm',
        count: 1,
        sprite: { atlas: 'objects', frame: 'charm' },
      },
      {
        objectId: 8,
        type: 'breakable',
        rect: rect(16, 16, 16, 32),
        flag: 'obj:start:8',
        requiresAnyTag: ['break:test'],
        sprite: { atlas: 'objects', frame: 'rock' },
      },
      {
        objectId: 9,
        type: 'switch',
        rect: rect(48, 16, 16, 16),
        flag: 'bars-open',
        sprite: { atlas: 'objects', frame: 'lever' },
        spriteOn: { atlas: 'objects', frame: 'lever-on' },
      },
      {
        objectId: 10,
        type: 'gate',
        rect: rect(64, 16, 16, 32),
        flag: 'bars-open',
        sprite: { atlas: 'objects', frame: 'bars' },
      },
      {
        objectId: 11,
        type: 'pickup',
        rect: rect(40, 20, 8, 8),
        flag: 'coin-a',
        itemId: 'coin',
        count: 3,
        sprite: { atlas: 'objects', frame: 'charm' },
      },
      {
        objectId: 12,
        type: 'breakable',
        rect: rect(32, 32, 16, 16),
        flag: 'cracked',
        requiresAnyTag: ['move:swim', 'break:test'],
        sprite: { atlas: 'objects', frame: 'rock' },
      },
    ]);
  });

  it('reads event zones, conditions and actions from JSON text', async () => {
    const zone = {
      id: 20,
      name: 'gift',
      class: 'event',
      x: 16,
      y: 16,
      width: 32,
      height: 16,
      properties: [
        prop('trigger', 'onZoneExit'),
        prop(
          'conditions',
          '[{"flag":"met","is":true},{"hasItem":"coin","count":2},{"notItem":"charm"}]',
        ),
        prop(
          'actions',
          '[{"takeItem":"coin","count":2},{"giveItem":"charm"},{"setFlag":"paid","value":1}]',
        ),
      ],
    };
    const { runtime } = await loadPack(memoryFetch(withGimmicks([], [zone])), BASE);
    expect(runtime.rooms.start?.zones).toEqual([
      {
        objectId: 20,
        rect: { x: fx(16), y: fx(16), w: fx(32), h: fx(16) },
        trigger: 'onZoneExit',
        conditions: [
          { flag: 'met', is: true },
          { hasItem: 'coin', count: 2 },
          { notItem: 'charm' },
        ],
        actions: [
          { takeItem: 'coin', count: 2 },
          { giveItem: 'charm' },
          { setFlag: 'paid', value: 1 },
        ],
      },
    ]);
  });

  it('refuses what is not supported yet, and checks types and references', async () => {
    const files = withGimmicks([
      gimmick(1, 'missing', 0, 0, 16, 16),
      gimmick(2, 'rock', 8, 16, 16, 16),
      gimmick(3, 'charm', 0, 0, 8, 8, [prop('itemId', 'nothing'), prop('speed', 2)]),
      gimmick(4, 'bars', 80, 48, 16, 32),
      gimmick(5, 'bars', 0, 0, 16, 16, [prop('consumesItem', 'coin')]),
    ]);
    edit(files, 'data/items.json', (f) => {
      f.items[1].effect = { heal: 1 };
      f.items.push({ ...f.items[0] });
    });
    edit(files, 'data/gimmicks.json', (f) => {
      f.gimmicks.push(
        { id: 'save', type: 'savePoint', sprite: { atlas: 'objects', frame: 'rock' } },
        {
          id: 'rubble',
          type: 'breakable',
          requiresAnyTag: ['x'],
          drops: 'coin',
          sprite: { atlas: 'objects', frame: 'nope' },
        },
        { id: 'plain', type: 'switch', setsFlag: 'f' },
      );
    });
    edit(files, 'data/rules.json', (r) => {
      r.inventory = { scope: 'perCharacter' };
    });
    expect(await issuesOf(files)).toEqual([
      'data/items.json#/items/1/effect: effect comes with items to use (not supported yet)',
      'data/items.json#/items/2/id: item "charm" is defined twice',
      'data/gimmicks.json#/gimmicks/4/type: type "savePoint" is not supported yet (pickup, breakable, switch, gate work)',
      'data/gimmicks.json#/gimmicks/5/drops: drops of a "breakable" is not supported yet',
      'data/gimmicks.json#/gimmicks/5/sprite/frame: frame "nope" is not in atlas "objects"',
      'data/gimmicks.json#/gimmicks/6/sprite: a "switch" needs a sprite',
      'rooms/start.tmj#/layers/2/objects/1/properties/gimmickId: gimmick "missing" is not in data/gimmicks.json',
      'rooms/start.tmj#/layers/2/objects/2: a "breakable" must be aligned to the 16 px tile grid',
      'rooms/start.tmj#/layers/2/objects/3/properties/speed: a "pickup" has no parameter "speed"',
      'rooms/start.tmj#/layers/2/objects/3/properties/itemId: item "nothing" is not defined',
      'rooms/start.tmj#/layers/2/objects/4: a "gate" must be inside the room',
      'rooms/start.tmj#/layers/2/objects/5/properties/consumesItem: consumesItem of a "gate" is not supported yet',
      'data/rules.json#/inventory/scope: "perCharacter" is not supported yet',
    ]);
  });

  it('rejects broken event zones and items they name that do not exist', async () => {
    const zone = (id: number, props: Json[]) => ({
      id,
      name: '',
      class: 'event',
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      properties: props,
    });
    const files = withGimmicks(
      [],
      [
        zone(1, [prop('trigger', 'onTouch'), prop('conditions', '{"flag":"a"}')]),
        zone(2, [
          prop('trigger', 'onZoneEnter'),
          prop('actions', '[{"warp":"x"},{"giveItem":"gem"}]'),
        ]),
        zone(3, [prop('trigger', 'onZoneEnter'), prop('conditions', 'not json')]),
      ],
    );
    expect(await issuesOf(files)).toEqual([
      'rooms/start.tmj#/layers/3/objects/0/properties/trigger: trigger must be "onZoneEnter" or "onZoneExit"',
      'rooms/start.tmj#/layers/3/objects/0/properties/conditions: conditions must be a JSON array (as text)',
      'rooms/start.tmj#/layers/3/objects/1/properties/actions/0: not a action this engine reads',
      'rooms/start.tmj#/layers/3/objects/2/properties/conditions: conditions must be a JSON array (as text)',
    ]);
    // A zone that reads well but names an item that does not exist.
    const files2 = withGimmicks(
      [],
      [zone(4, [prop('trigger', 'onZoneEnter'), prop('actions', '[{"giveItem":"gem"}]')])],
    );
    expect(await issuesOf(files2)).toEqual([
      'rooms/start.tmj#/layers/3/objects/0/properties/actions/0: item "gem" is not defined',
    ]);
  });
});
