import { createWorld, FX_ONE, roomGrid } from '@retro-action-engine/core';
import { SWIMMER, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { listFootholds } from './footholds';
import { Proofs } from './proofs';
import { emptyRows, fill, type RoomFixture, roomRuntime, START } from './test-support';
import type { Foothold } from './types';

const px = (value: number) => Math.round(value * FX_ONE);

/** Proofs for the spawn of the fixture, with a rise bound given in px. */
function setup(fixture: RoomFixture, riseBoundPx: number, character = WALKER) {
  const runtime = roomRuntime(fixture);
  const grid = roomGrid(runtime, 'room');
  const world = createWorld(runtime, { ...START, feelProfile: 'retro', party: [character.id] });
  const footholds = listFootholds(grid, character);
  const at = (col: number, row: number): Foothold => {
    const found = footholds.find((f) => f.row === row && f.colFrom <= col && col <= f.colTo);
    if (found === undefined) throw new Error(`no foothold at column ${col}, row ${row}`);
    return found;
  };
  const bound = riseBoundPx === Number.POSITIVE_INFINITY ? riseBoundPx : px(riseBoundPx);
  return { proofs: Proofs.of(grid, character, world, bound), at, footholds };
}

describe('Proofs: enclosed', () => {
  // A floor, and a chamber closed on all sides with its own floor.
  const rows = emptyRows(14, 8);
  fill(rows, '#', 0, 13, 7);
  fill(rows, '#', 8, 12, 2);
  fill(rows, '#', 8, 8, 2, 6);
  fill(rows, '#', 12, 12, 2, 6);
  const fixture = { rows, tileSize: 16, spawn: [2, 6] as const };

  it('proves a foothold behind walls out of reach, and nothing about the open side', () => {
    const { proofs, at } = setup(fixture, 1000);
    expect(proofs?.unreachable(at(10, 7))).toEqual({ certainty: 'proven', reason: 'enclosed' });
    expect(proofs?.unreachable(at(2, 7))).toBeUndefined();
    // The roof of the chamber is outside it, and low enough for this bound.
    expect(proofs?.unreachable(at(10, 2))).toBeUndefined();
  });

  it('opens the chamber when one wall tile is a oneway tile or missing', () => {
    for (const tile of ['=', '.']) {
      const open = [...rows];
      fill(open, tile, 8, 8, 5);
      const { proofs, at } = setup({ ...fixture, rows: open }, 1000);
      expect(proofs?.unreachable(at(10, 7))).toBeUndefined();
    }
  });

  it('follows the ability tags: a tagged wall closes the region only without the tag', () => {
    const tagged = emptyRows(10, 5);
    fill(tagged, '#', 0, 9, 4);
    fill(tagged, '~', 5, 5, 0, 3);
    const room = {
      rows: tagged,
      tileSize: 16,
      spawn: [1, 3] as const,
      members: ['walker', 'swimmer'],
    };
    const walker = setup(room, 1000, WALKER);
    expect(walker.proofs?.unreachable(walker.at(8, 4))?.reason).toBe('enclosed');
    const swimmer = setup(room, 1000, SWIMMER);
    expect(swimmer.footholds.every((f) => swimmer.proofs?.unreachable(f) === undefined)).toBe(true);
  });

  it('gives no proofs when the box starts inside a wall', () => {
    const { proofs } = setup({ ...fixture, spawn: [10, 2] }, 1000);
    expect(proofs).toBeUndefined();
  });
});

describe('Proofs: too high', () => {
  /** 1 px tiles: a floor and full-width oneway shelves at the given heights above it. */
  function shelves(heights: readonly number[], extra?: (rows: string[], floorRow: number) => void) {
    const rows = emptyRows(40, 120);
    const floorRow = rows.length - 1;
    fill(rows, '#', 0, 39, floorRow);
    for (const height of heights) {
      fill(rows, '=', 0, 39, floorRow - height);
    }
    extra?.(rows, floorRow);
    return { fixture: { rows, tileSize: 1, spawn: [20, floorRow - 1] as const }, floorRow };
  }

  it('is exact at the bound: a level at the bound is possible, one sub-pixel above is not', () => {
    const { fixture, floorRow } = shelves([30]);
    const atBound = setup(fixture, 30);
    expect(atBound.proofs?.unreachable(atBound.at(20, floorRow - 30))).toBeUndefined();
    const below = setup(fixture, 30 - 1 / FX_ONE);
    expect(below.proofs?.unreachable(below.at(20, floorRow - 30))).toEqual({
      certainty: 'proven',
      reason: 'tooHigh',
      riseNeeded: px(30),
      riseBound: px(30) - 1,
    });
  });

  it('climbs from level to level: a step in between makes the upper shelf possible', () => {
    const stairs = shelves([30, 60]);
    const withStep = setup(stairs.fixture, 38.25);
    expect(withStep.proofs?.unreachable(withStep.at(20, stairs.floorRow - 60))).toBeUndefined();

    const gap = shelves([60]);
    const without = setup(gap.fixture, 38.25);
    expect(without.proofs?.unreachable(without.at(20, gap.floorRow - 60))).toEqual({
      certainty: 'proven',
      reason: 'tooHigh',
      riseNeeded: px(60),
      riseBound: px(38.25),
    });
  });

  it('measures the rise needed from the highest level that is possible', () => {
    const { fixture, floorRow } = shelves([30, 90]);
    const { proofs, at } = setup(fixture, 38.25);
    expect(proofs?.unreachable(at(20, floorRow - 90))).toMatchObject({
      reason: 'tooHigh',
      riseNeeded: px(60),
    });
  });

  it('does not count a step the character can never be next to', () => {
    // The step at 30 px is sealed in a box: it must not help to reach the shelf at 60 px.
    const { fixture, floorRow } = shelves([60], (rows, floor) => {
      fill(rows, '#', 2, 24, floor - 30);
      fill(rows, '#', 2, 24, floor - 50);
      fill(rows, '#', 2, 2, floor - 50, floor - 30);
      fill(rows, '#', 24, 24, floor - 50, floor - 30);
      // Keep the shelf a single piece above the box.
      fill(rows, '=', 0, 39, floor - 60);
    });
    const { proofs, at } = setup(fixture, 38.25);
    expect(proofs?.unreachable(at(20, floorRow - 60))?.reason).toBe('tooHigh');
    // The sealed step itself is enclosed (its inside floor), the box roof is just too high.
    expect(proofs?.unreachable(at(12, floorRow - 30))?.reason).toBe('enclosed');
    expect(proofs?.unreachable(at(12, floorRow - 50))?.reason).toBe('tooHigh');
  });

  it('proves nothing about height without a bound', () => {
    const { fixture, floorRow } = shelves([100]);
    const { proofs, at } = setup(fixture, Number.POSITIVE_INFINITY);
    expect(proofs?.unreachable(at(20, floorRow - 100))).toBeUndefined();
  });

  it('never calls a lower foothold too high', () => {
    // Spawn on the upper shelf: everything is at or below the start.
    const { fixture, floorRow } = shelves([30, 100]);
    const { proofs, footholds } = setup({ ...fixture, spawn: [20, floorRow - 101] }, 1);
    expect(footholds.map((f) => proofs?.unreachable(f))).toEqual([undefined, undefined, undefined]);
  });
});

describe('Proofs: cannotClimb', () => {
  const rows = emptyRows(40, 120);
  fill(rows, '#', 0, 39, 119);
  fill(rows, '=', 0, 39, 119 - 48);
  fill(rows, '=', 0, 39, 119 - 78);
  const fixture = { rows, tileSize: 1, spawn: [20, 119 - 79] as const };

  it('proves that a lower foothold cannot get back up, and never the other way', () => {
    const { proofs, at } = setup(fixture, 38.25);
    const floor = at(20, 119);
    const middle = at(20, 119 - 48);
    const top = at(20, 119 - 78);
    expect(proofs?.cannotClimb(floor, middle)).toEqual({
      riseNeeded: px(48),
      riseBound: px(38.25),
    });
    expect(proofs?.cannotClimb(floor, top)).toEqual({ riseNeeded: px(78), riseBound: px(38.25) });
    // 30 px from the middle shelf to the top one: possible.
    expect(proofs?.cannotClimb(middle, top)).toBeUndefined();
    expect(proofs?.cannotClimb(top, floor)).toBeUndefined();
    expect(proofs?.cannotClimb(top, top)).toBeUndefined();
  });

  it('climbs from the room border below the last row as from any floor', () => {
    // No floor tiles at all: the character rests on the border.
    const bare = emptyRows(20, 60);
    fill(bare, '=', 0, 19, 60 - 30);
    const { proofs, at } = setup({ rows: bare, tileSize: 1, spawn: [10, 59] }, 38.25);
    expect(proofs?.unreachable(at(10, 30))).toBeUndefined();
    const low = setup({ rows: bare, tileSize: 1, spawn: [10, 59] }, 20);
    expect(low.proofs?.unreachable(low.at(10, 30))).toMatchObject({ riseNeeded: px(30) });
  });
});
