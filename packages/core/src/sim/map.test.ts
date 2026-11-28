// The map (ADR-0020, M3-6b): the screens the body has been in, per room, and what the menu shows.
// Sizes come from the fixture's display and room, never fixed numbers. Values are fictional.
import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { script } from '../replay/script';
import type { DisplayDef, PackRuntime, RoomData } from '../runtime/pack';
import { boxRoom, buildRoom, simRuntime, TEST_TILE_CLASSES } from '../test-support';
import type { World } from '../world/world';
import { roomMap, screenGrid } from './map';
import { createWorld, step } from './sim';

const T = 16;
const DISPLAY: DisplayDef = {
  width: 320,
  height: 180,
  hudReserve: { top: 20, bottom: 0 },
  orientation: 'landscape',
};
const VIEW = { w: DISPLAY.width / T, h: (DISPLAY.height - DISPLAY.hudReserve.top) / T };
// Three and a half screens wide (the last one a part screen) and two high.
const W = VIEW.w * 3 + VIEW.w / 2;
const H = VIEW.h * 2;
const SPAWN: [number, number] = [2, H - 2];

function runtimeOf(options: { camera?: boolean; warpCol?: number } = {}): PackRuntime {
  const rows = boxRoom(W, H);
  const base = simRuntime({ rows, spawn: SPAWN });
  const room = base.rooms.room as RoomData;
  const otherGrid = buildRoom(boxRoom(VIEW.w, VIEW.h), T);
  const other: RoomData = {
    id: 'other',
    widthTiles: otherGrid.widthTiles,
    heightTiles: otherGrid.heightTiles,
    collision: otherGrid.collision,
    tileClasses: TEST_TILE_CLASSES,
    spawns: { start: { x: fromPx(3 * T + T / 2), y: fromPx((VIEW.h - 1) * T) } },
  };
  const exits =
    options.warpCol === undefined
      ? []
      : [
          {
            kind: 'warp' as const,
            rect: {
              x: fromPx(options.warpCol * T),
              y: fromPx((H - 2) * T),
              w: fromPx(T),
              h: fromPx(T),
            },
            toRoomId: 'other',
            spawnId: 'start',
            effect: 'cut' as const,
          },
        ];
  return {
    ...base,
    rooms: { room: { ...room, exits }, other },
    items: {
      chart: { id: 'chart', kind: 'key', stack: 1, revealsMap: true },
      pebble: { id: 'pebble', kind: 'key', stack: 1 },
    },
    ...(options.camera === false
      ? {}
      : {
          display: DISPLAY,
          camera: {
            mode: 'scroll',
            activationMarginPx: 0,
            scroll: {
              deadzone: { w: 32, h: 48 },
              lookahead: { x: 24, y: 0 },
              lerpShift: 3,
              lockY: false,
              followY: 'grounded',
            },
          },
        }),
  };
}

const start = (runtime: PackRuntime): World =>
  createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: 'retro' });
const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]) => {
  for (const frame of frames) step(world, frame, runtime);
};
const cols = Math.ceil(W / VIEW.w);
const bottomLeft = (H / VIEW.h - 1) * cols;

describe('map (ADR-0020, M3-6b)', () => {
  it('cuts the room into play-area screens, a part screen counting as one', () => {
    const runtime = runtimeOf();
    expect(screenGrid(runtime, runtime.rooms.room as RoomData)).toEqual({
      w: VIEW.w * T,
      h: VIEW.h * T,
      cols,
      rows: H / VIEW.h,
    });
    // Without a camera the whole room is one screen.
    const flat = runtimeOf({ camera: false });
    expect(screenGrid(flat, flat.rooms.room as RoomData)).toMatchObject({ cols: 1, rows: 1 });
    expect(start(flat).visited).toEqual({ room: [0] });
  });

  it('marks the screen of the start, then each screen walked into, and only those', () => {
    const runtime = runtimeOf();
    const world = start(runtime);
    expect(world.visited).toEqual({ room: [bottomLeft] });
    expect(roomMap(world, runtime)).toEqual({
      roomId: 'room',
      cols,
      rows: H / VIEW.h,
      visited: [bottomLeft],
      revealed: false,
      here: bottomLeft,
      exits: [],
    });
    // Walk to the right end: every screen of the bottom row, none of the top row.
    run(world, runtime, script().hold('right', 1200).build(1200));
    const bottomRow = Array.from({ length: cols }, (_, c) => bottomLeft + c);
    expect(world.visited.room).toEqual(bottomRow);
    expect(roomMap(world, runtime).here).toBe(bottomLeft + cols - 1);
    // Back again: nothing new, and the list stays in order.
    run(world, runtime, script().hold('left', 1200).build(1200));
    expect(world.visited.room).toEqual(bottomRow);
  });

  it('shows the screens not visited while an item with revealsMap is held', () => {
    const runtime = runtimeOf();
    const world = start(runtime);
    world.inventory.pebble = 1;
    expect(roomMap(world, runtime).revealed).toBe(false);
    world.inventory.chart = 1;
    expect(roomMap(world, runtime).revealed).toBe(true);
    // Revealing does not make screens visited.
    expect(roomMap(world, runtime).visited).toEqual([bottomLeft]);
  });

  it('keeps a map per room: another room has its own, and the first one stays', () => {
    const runtime = runtimeOf({ warpCol: SPAWN[0] + 4 });
    const world = start(runtime);
    expect(roomMap(world, runtime).exits).toEqual([bottomLeft]);
    run(world, runtime, script().hold('right', 40).build(40));
    run(world, runtime, script().build(60));
    expect(world.roomId).toBe('other');
    expect(world.visited).toEqual({ room: [bottomLeft], other: [0] });
    expect(roomMap(world, runtime)).toMatchObject({ roomId: 'other', cols: 1, rows: 1, here: 0 });
  });

  it('is in the hash', () => {
    const runtime = runtimeOf();
    const a = start(runtime);
    const b = start(runtime);
    expect(hashWorld(a)).toEqual(hashWorld(b));
    b.visited.room = [bottomLeft, bottomLeft + 1];
    expect(hashWorld(a)).not.toEqual(hashWorld(b));
    b.visited = { room: [bottomLeft], other: [] };
    expect(hashWorld(a)).not.toEqual(hashWorld(b));
  });
});
