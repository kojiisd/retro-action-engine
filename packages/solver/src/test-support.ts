// Fixtures for the solver tests. Built on the core test fixtures (@retro-action-engine/core/testing).
import { type FeelProfile, FX_ONE, type PackRuntime } from '@retro-action-engine/core';
import {
  buildRoom,
  type FeelInPx,
  feelProfile,
  MODERN_PX,
  RETRO_PX,
  SWIMMER,
  TEST_TILE_CLASSES,
  WALKER,
} from '@retro-action-engine/core/testing';

export interface RoomFixture {
  /** `.` empty, `#` full, `=` oneway, `~` full unless the character has `move:swim`. */
  readonly rows: readonly string[];
  readonly tileSize: number;
  /** Spawn tile: the character starts with its feet on the bottom edge of this tile. */
  readonly spawn: readonly [col: number, row: number];
  readonly members?: readonly string[];
  /** Replaces values of both test profiles (px, as in the pack file). */
  readonly feel?: Partial<FeelInPx>;
}

/** A one-room runtime with the two test characters and the retro and modern profiles. */
export function roomRuntime(fixture: RoomFixture): PackRuntime {
  const T = fixture.tileSize;
  const grid = buildRoom(fixture.rows, T);
  const [col, row] = fixture.spawn;
  const profile = (id: string, px: FeelInPx, base: Pick<FeelProfile, 'interpolation' | 'socd'>) =>
    feelProfile({ id, name: id, ...base }, { ...px, ...fixture.feel });
  return {
    id: 'solver-fixture',
    version: '0.0.0',
    tileSize: T,
    rooms: {
      room: {
        id: 'room',
        widthTiles: grid.widthTiles,
        heightTiles: grid.heightTiles,
        collision: grid.collision,
        tileClasses: TEST_TILE_CLASSES,
        spawns: {
          start: { x: Math.floor((col * T + T / 2) * FX_ONE), y: (row + 1) * T * FX_ONE },
        },
      },
    },
    characters: { walker: WALKER, swimmer: SWIMMER },
    feel: {
      retro: profile('retro', RETRO_PX, { interpolation: 'none', socd: 'neutral' }),
      modern: profile('modern', MODERN_PX, { interpolation: 'linear', socd: 'lastWins' }),
    },
    rules: {
      party: {
        members: fixture.members ?? ['walker'],
        switch: { mode: 'anywhere', cooldownTicks: 20, requireGrounded: false, placement: 'same' },
      },
    },
  };
}

/** Rows of empty tiles, to be drawn on with `fill`. */
export function emptyRows(widthTiles: number, heightTiles: number): string[] {
  return Array.from({ length: heightTiles }, () => '.'.repeat(widthTiles));
}

/** Draws `tile` over columns colFrom..colTo and rows rowFrom..rowTo (inclusive). */
export function fill(
  rows: string[],
  tile: string,
  colFrom: number,
  colTo: number,
  rowFrom: number,
  rowTo: number = rowFrom,
): void {
  for (let r = rowFrom; r <= rowTo; r++) {
    const line = rows[r] as string;
    rows[r] = line.slice(0, colFrom) + tile.repeat(colTo - colFrom + 1) + line.slice(colTo + 1);
  }
}

export const START = { roomId: 'room', spawnId: 'start', seed: 1 } as const;
