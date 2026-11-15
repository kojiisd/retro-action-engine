import { actionMask, createWorld, roomGrid, step } from '@retro-action-engine/core';
import { SWIMMER, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { FootholdIndex, listFootholds, standingOn } from './footholds';
import { emptyRows, fill, roomRuntime, START } from './test-support';

const spans = (rows: string[], tileSize: number, character = WALKER) => {
  const runtime = roomRuntime({ rows, tileSize, spawn: [0, 0] });
  return listFootholds(roomGrid(runtime, 'room'), character).map(
    (f) => `r${f.row}:${f.colFrom}-${f.colTo}`,
  );
};

describe('listFootholds', () => {
  it('lists runs of full and oneway tiles with room for the box on top', () => {
    const rows = emptyRows(8, 5);
    fill(rows, '#', 0, 7, 4);
    fill(rows, '=', 1, 3, 2);
    fill(rows, '#', 6, 6, 2);
    expect(spans(rows, 16)).toEqual(['r2:1-3', 'r2:6-6', 'r4:0-7']);
  });

  it('gives every foothold an id, its character and its top edge in px', () => {
    const rows = emptyRows(4, 3);
    fill(rows, '#', 0, 3, 2);
    const runtime = roomRuntime({ rows, tileSize: 8, spawn: [0, 0] });
    expect(listFootholds(roomGrid(runtime, 'room'), WALKER)).toEqual([
      { id: 'walker:r2c0-3', characterId: 'walker', row: 2, colFrom: 0, colTo: 3, topPx: 16 },
    ]);
  });

  it('leaves out tiles with no room to stand: under a low ceiling and below other tiles', () => {
    // 8 px tiles and a 14 px tall box: one open tile above the floor is not enough.
    const rows = emptyRows(8, 5);
    fill(rows, '#', 0, 7, 4);
    fill(rows, '#', 0, 3, 2);
    expect(spans(rows, 8)).toEqual(['r2:0-3', 'r4:4-7']);
  });

  it('keeps a tile the box can stand on while hanging over its edge', () => {
    // 8 px tiles and a 12 px wide box. Column 2 is next to the block: the box cannot stand
    // inside that column alone, but it can stand further right while still overlapping it.
    const rows = emptyRows(6, 6);
    fill(rows, '#', 0, 5, 5);
    fill(rows, '#', 0, 1, 3, 4);
    expect(spans(rows, 8)).toEqual(['r3:0-1', 'r5:2-5']);
    // The top row of a room has no room above it: outside the room is solid.
    fill(rows, '#', 4, 5, 0);
    expect(spans(rows, 8)).toEqual(['r3:0-1', 'r5:2-5']);
  });

  it('follows the ability tags of the character', () => {
    const rows = emptyRows(6, 3);
    fill(rows, '#', 0, 5, 2);
    fill(rows, '~', 3, 3, 0, 1);
    // The water column is a wall for one and open for the other.
    expect(spans(rows, 16, WALKER)).toEqual(['r2:0-2', 'r2:4-5']);
    expect(spans(rows, 16, SWIMMER)).toEqual(['r2:0-5']);
  });
});

describe('standingOn', () => {
  const rows = emptyRows(6, 4);
  fill(rows, '#', 0, 5, 3);
  fill(rows, '=', 3, 5, 2);
  const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 2] });
  const grid = roomGrid(runtime, 'room');
  const index = new FootholdIndex(grid, [WALKER]);
  const idle = { held: 0, pressed: 0, released: 0 };

  it('names the foothold under a standing character, and nothing in the air', () => {
    const world = createWorld(runtime, { ...START, feelProfile: 'retro' });
    step(world, idle, runtime);
    expect(standingOn(grid, index, world, WALKER)).toEqual([index.at('walker', 3, 1)]);
    const jump = actionMask('jump');
    step(world, { held: jump, pressed: jump, released: 0 }, runtime);
    expect(standingOn(grid, index, world, WALKER)).toEqual([]);
    expect(index.at('walker', 3, 1)).toBe(index.at('walker', 3, 5));
    expect(index.at('walker', 2, 3)).not.toBe(index.at('walker', 3, 1));
    expect(index.at('walker', 0, 0)).toBe(-1);
    expect(index.at('swimmer', 3, 1)).toBe(-1);
  });
});
