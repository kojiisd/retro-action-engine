import { describe, expect, it } from 'vitest';
import { TEST_TILE_CLASSES } from '../test-support';
import { createCollisionGrid, NO_ABILITIES, solidAt } from './grid';

const base = {
  widthTiles: 2,
  heightTiles: 2,
  tileSize: 16,
  collision: new Uint16Array([0, 1, 2, 0]),
  tileClasses: TEST_TILE_CLASSES,
};

describe('createCollisionGrid', () => {
  it('indexes tile classes by id', () => {
    const grid = createCollisionGrid(base);
    expect(solidAt(grid, 1, 0, NO_ABILITIES)).toBe('full');
    expect(solidAt(grid, 0, 1, NO_ABILITIES)).toBe('oneway');
  });

  it('treats every tile outside the room as full', () => {
    const grid = createCollisionGrid(base);
    for (const [col, row] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const) {
      expect(solidAt(grid, col, row, NO_ABILITIES)).toBe('full');
    }
  });

  it('rejects a collision layer whose size does not match the room', () => {
    expect(() => createCollisionGrid({ ...base, collision: new Uint16Array(3) })).toThrow(
      /expected 2 x 2/,
    );
  });

  it('rejects tiles that use an undefined class', () => {
    expect(() =>
      createCollisionGrid({ ...base, collision: new Uint16Array([0, 0, 0, 9]) }),
    ).toThrow(/tile class 9/);
  });

  it('rejects duplicate class ids and invalid sizes', () => {
    const dup = [...TEST_TILE_CLASSES, { id: 1, solid: 'none' as const }];
    expect(() => createCollisionGrid({ ...base, tileClasses: dup })).toThrow(/defined twice/);
    expect(() => createCollisionGrid({ ...base, tileSize: 0 })).toThrow(/tileSize/);
    expect(() => createCollisionGrid({ ...base, widthTiles: 1.5 })).toThrow(/widthTiles/);
  });

  it('rejects slopes until they are implemented (M5)', () => {
    const withSlope = [...TEST_TILE_CLASSES, { id: 7, solid: 'slope' as const, heights: [0] }];
    expect(() => createCollisionGrid({ ...base, tileClasses: withSlope })).toThrow(
      /"slope" is not supported/,
    );
  });
});
