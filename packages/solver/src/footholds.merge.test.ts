import { roomGrid } from '@retro-action-engine/core';
import { SWIMMER, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { FootholdIndex, mergeFootholds } from './footholds';
import { emptyRows, fill, roomRuntime } from './test-support';

describe('mergeFootholds', () => {
  const rows = emptyRows(14, 6);
  fill(rows, '#', 0, 5, 5);
  fill(rows, '~', 6, 7, 5);
  fill(rows, '#', 9, 13, 5);
  fill(rows, '=', 2, 3, 2);
  const grid = roomGrid(roomRuntime({ rows, tileSize: 16, spawn: [1, 4] }), 'room');

  it('keeps the footholds of a single character as they are', () => {
    const index = new FootholdIndex(grid, [WALKER]);
    const { runs, runOf } = mergeFootholds(index, ['walker']);
    expect(runs).toEqual(index.all);
    expect(runOf).toEqual(index.all.map((_, i) => i));
  });

  it('merges overlapping footholds on a row, and keeps a gap a gap', () => {
    const index = new FootholdIndex(grid, [WALKER, SWIMMER]);
    const { runs, runOf } = mergeFootholds(index, ['walker', 'swimmer']);
    expect(runs.map((run) => `${run.id} ${run.characterIds.join('+')}`)).toEqual([
      'party:r2c2-3 walker+swimmer',
      // The water is a floor for the walker and open for the swimmer: the walker's run
      // bridges the swimmer's two. Column 8 is a hole for both, so the row has two runs.
      'party:r5c0-7 walker+swimmer',
      'party:r5c9-13 walker+swimmer',
    ]);
    // Every foothold belongs to the run that covers it.
    index.all.forEach((foothold, i) => {
      const run = runs[runOf[i] as number];
      expect(run?.row).toBe(foothold.row);
      expect(run?.colFrom).toBeLessThanOrEqual(foothold.colFrom);
      expect(run?.colTo).toBeGreaterThanOrEqual(foothold.colTo);
    });
  });

  it('names the members in party order, whatever order the footholds come in', () => {
    const index = new FootholdIndex(grid, [SWIMMER, WALKER]);
    const { runs } = mergeFootholds(index, ['swimmer', 'walker']);
    expect(runs.map((run) => run.characterIds)).toEqual([
      ['swimmer', 'walker'],
      ['swimmer', 'walker'],
      ['swimmer', 'walker'],
    ]);
  });
});
