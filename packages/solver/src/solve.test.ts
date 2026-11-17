import { FX_ONE, type PackRuntime, type StartState } from '@retro-action-engine/core';
import { type FeelInPx, RETRO_PX, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { measureHighestJump, measureRise, measureRiseBound } from './probe';
import { solveRoom } from './solve';
import {
  emptyRows,
  fill,
  footholdAt,
  kindsBetween,
  replayEndsOn,
  returnProblems,
  roomRuntime,
  START,
  scopeOf,
} from './test-support';
import type { FootholdReport, ScopeReport } from './types';

/** An open room, for measuring jumps. */
const shelfOpen = { rows: ['...', '###'], tileSize: 16, spawn: [1, 0] as const };

/** Independent check of a witness: replay it and look at where the character ends up. */
function expectWitnessEndsOn(runtime: PackRuntime, foothold: FootholdReport): void {
  expect(foothold.witness).toBeDefined();
  expect(replayEndsOn(runtime, foothold.witness?.replay, foothold)).toBe(true);
}

/** Every "way back" of the scope checks out when replayed. */
function expectReturnsHold(runtime: PackRuntime, scope: ScopeReport): void {
  expect(returnProblems(runtime, scope)).toEqual([]);
}

const PROVEN_ENCLOSED = { certainty: 'proven', reason: 'enclosed' } as const;

describe('solveRoom: a wall that needs an ability tag', () => {
  // A floor, with a column of water from the ceiling to the floor in the middle, and a shelf
  // on the far side.
  const rows = emptyRows(12, 6);
  fill(rows, '#', 0, 11, 5);
  fill(rows, '~', 6, 6, 0, 4);
  fill(rows, '=', 8, 10, 3);
  const runtime = roomRuntime({
    rows,
    tileSize: 16,
    spawn: [2, 4],
    members: ['walker', 'swimmer'],
  });

  for (const feelProfile of ['retro', 'modern']) {
    const start: StartState = { ...START, feelProfile };
    const report = solveRoom(runtime, start);

    it(`${feelProfile}: the character without the tag stays on its side`, () => {
      const walker = scopeOf(report, 'walker');
      // For the walker the water is a wall, so the floor is two footholds.
      const near = footholdAt(walker, 2, 5);
      const far = footholdAt(walker, 9, 5);
      expect(near.id).not.toBe(far.id);
      expect(near.status).toBe('reached');
      expect(far.status).toBe('unreached');
      expect(far.witness).toBeUndefined();
      expect(footholdAt(walker, 9, 3).status).toBe('unreached');
      // For this character the water is a wall from floor to ceiling: proven out of reach.
      expect(far.blocker).toEqual(PROVEN_ENCLOSED);
      expect(footholdAt(walker, 9, 3).blocker).toEqual(PROVEN_ENCLOSED);
      expect(near.blocker).toBeUndefined();
      expectReturnsHold(runtime, walker);
      expect(walker.startFootholds).toEqual([near.id]);
      expect(walker.complete).toBe(true);
    });

    it(`${feelProfile}: the character with the tag crosses, with a replay that proves it`, () => {
      const swimmer = scopeOf(report, 'swimmer');
      // For the swimmer the water is open, so the floor is one foothold.
      const floor = footholdAt(swimmer, 9, 5);
      expect(floor.colFrom).toBe(0);
      expect(floor.colTo).toBe(11);
      expect(floor.status).toBe('reached');
      expectWitnessEndsOn(runtime, floor);
      // The shelf is only reached by going through the water.
      const shelf = footholdAt(swimmer, 9, 3);
      expect(shelf.status).toBe('reached');
      expectWitnessEndsOn(runtime, shelf);
      // The replay is for this character alone.
      expect(shelf.witness?.replay.start.party).toEqual(['swimmer']);
      // And it can come back through the water.
      expect(shelf.return?.status).toBe('verified');
      expectReturnsHold(runtime, swimmer);
    });
  }
});

describe('solveRoom: the highest reachable foothold', () => {
  /**
   * Rise of a full jump under constant gravity, from the pack values alone: gravity applies on
   * the take-off tick, and the body moves by its velocity every tick while it still rises.
   * All values are multiples of 1/256 px, so the sum is exact.
   */
  function riseInPx(jumpVelocity: number, gravity: number): number {
    let rise = 0;
    for (let v = jumpVelocity - gravity; v > 0; v -= gravity) {
      rise += v;
    }
    return rise;
  }

  /** 1 px tiles: a floor, and a oneway shelf over the whole width, `shelfPx` above the floor. */
  function shelfRoom(shelfPx: number, feel: Partial<FeelInPx>) {
    const colliderPx = WALKER.collider.h / FX_ONE;
    const rows = emptyRows(24, shelfPx + colliderPx + 9);
    const floorRow = rows.length - 1;
    fill(rows, '#', 0, 23, floorRow);
    fill(rows, '=', 0, 23, floorRow - shelfPx);
    const runtime = roomRuntime({ rows, tileSize: 1, spawn: [12, floorRow - 1], feel });
    const report = solveRoom(runtime, { ...START, feelProfile: 'retro' });
    const scope = scopeOf(report, 'walker');
    return {
      runtime,
      report,
      floor: footholdAt(scope, 12, floorRow),
      shelf: footholdAt(scope, 12, floorRow - shelfPx),
    };
  }

  const cases: Array<Partial<FeelInPx> & { jumpVelocity: number; gravity: number }> = [
    { jumpVelocity: RETRO_PX.jumpVelocity, gravity: RETRO_PX.gravity },
    { jumpVelocity: 3, gravity: 0.125 },
    { jumpVelocity: 5, gravity: 0.5 },
    // The rise is a whole number of px: the feet reach the shelf top exactly.
    { jumpVelocity: 4, gravity: 0.5 },
    // A variable jump: only the longest hold gets the full rise.
    { jumpVelocity: 4, gravity: 0.25, jumpCutScale: 0.5, minJumpTicks: 2 },
  ];

  for (const feel of cases) {
    const rise = riseInPx(feel.jumpVelocity, feel.gravity);
    const highest = Math.floor(rise);

    const name = `jump ${feel.jumpVelocity}, gravity ${feel.gravity}, cut ${feel.jumpCutScale ?? 1}`;

    it(`${name}: reaches ${highest} px (rise ${rise})`, () => {
      const { runtime, report, floor, shelf } = shelfRoom(highest, feel);
      expect(floor.status).toBe('reached');
      expect(shelf.status).toBe('reached');
      expectWitnessEndsOn(runtime, shelf);
      expect(shelf.blocker).toBeUndefined();
      expect(report.complete).toBe(true);
      expectReturnsHold(runtime, scopeOf(report, 'walker'));
    });

    it(`${name}: does not reach ${highest + 1} px`, () => {
      const { report, floor, shelf } = shelfRoom(highest + 1, feel);
      expect(floor.status).toBe('reached');
      expect(shelf.status).toBe('unreached');
      expect(report.complete).toBe(true);
      // Not only "not found": no input sequence rises that far.
      expect(shelf.blocker).toEqual({
        certainty: 'proven',
        reason: 'tooHigh',
        riseNeeded: (highest + 1) * FX_ONE,
        riseBound: rise * FX_ONE,
      });
      expect(scopeOf(report, 'walker').riseBound).toBe(rise * FX_ONE);
    });
  }

  it('the measured rise equals the rise derived from the pack values', () => {
    for (const feel of cases) {
      const runtime = roomRuntime({ rows: ['...', '###'], tileSize: 16, spawn: [1, 0], feel });
      const measured = measureRise(runtime, WALKER, 'retro');
      expect(measured.height / FX_ONE).toBe(riseInPx(feel.jumpVelocity, feel.gravity));
    }
  });
});

describe('solveRoom: the highest jump is not the full hold', () => {
  // With a weak gravity near the apex, letting go early rises higher (ADR-0015, "上昇量の上限").
  const earlyRelease = {
    jumpCutScale: 0.95,
    minJumpTicks: 0,
    apexThreshold: 1,
    apexGravityScale: 0.1,
  };
  const start: StartState = { ...START, feelProfile: 'modern' };

  function shelf(heightPx: number, feel: Partial<FeelInPx>) {
    const rows = emptyRows(24, heightPx + 14 + 9);
    const floorRow = rows.length - 1;
    fill(rows, '#', 0, 23, floorRow);
    fill(rows, '=', 0, 23, floorRow - heightPx);
    const runtime = roomRuntime({ rows, tileSize: 1, spawn: [12, floorRow - 1], feel });
    const scope = scopeOf(solveRoom(runtime, start), 'walker');
    return { runtime, scope, shelf: footholdAt(scope, 12, floorRow - heightPx) };
  }

  it('a shelf at the bound is reached with the early release, one px higher is proven too high', () => {
    const bound = measureRiseBound(
      roomRuntime({ ...shelfOpen, feel: earlyRelease }),
      WALKER,
      'modern',
    );
    const fullHold = measureRise(
      roomRuntime({ ...shelfOpen, feel: earlyRelease }),
      WALKER,
      'modern',
    );
    const highest = Math.floor(bound / FX_ONE);
    // Above the full hold: only the early release gets there.
    expect(highest * FX_ONE).toBeGreaterThan(fullHold.height);
    const at = shelf(highest, earlyRelease);
    expect(at.shelf.status).toBe('reached');
    expectWitnessEndsOn(at.runtime, at.shelf);
    const above = shelf(highest + 1, earlyRelease);
    expect(above.shelf.blocker).toMatchObject({ certainty: 'proven', reason: 'tooHigh' });
  });

  it('a highest jump that needs a buffered press is not tried (a known gap, not proven)', () => {
    // Here the highest jump starts with the button already up: no macro from the ground does
    // that. The shelf at the bound is missed, and nothing claims it is impossible.
    const buffered = { ...earlyRelease, apexThreshold: 2, jumpVelocity: 2.1 };
    const runtime = roomRuntime({ ...shelfOpen, feel: buffered });
    expect(measureHighestJump(runtime, WALKER, 'modern').hold).toBe(0);
    const highest = Math.floor(measureRiseBound(runtime, WALKER, 'modern') / FX_ONE);
    const at = shelf(highest, buffered);
    expect(at.shelf.status).toBe('unreached');
    expect(at.shelf.blocker?.certainty).toBe('estimated');
  });
});

describe('solveRoom: oneway floors', () => {
  const T = 16;

  for (const feelProfile of ['retro', 'modern']) {
    const start: StartState = { ...START, feelProfile };

    /** A floor and a shelf over the whole width, `tilesUp` tiles above it. */
    function shelfRoom(shelf: '=' | '#', tilesUp: number, spawnOn: 'floor' | 'shelf') {
      const rows = emptyRows(10, 9);
      fill(rows, '#', 0, 9, 8);
      fill(rows, shelf, 0, 9, 8 - tilesUp);
      const spawnRow = spawnOn === 'floor' ? 7 : 7 - tilesUp;
      const runtime = roomRuntime({ rows, tileSize: T, spawn: [4, spawnRow] });
      const scope = scopeOf(solveRoom(runtime, start), 'walker');
      return {
        runtime,
        scope,
        floor: footholdAt(scope, 4, 8),
        shelf: footholdAt(scope, 4, 8 - tilesUp),
      };
    }

    it(`${feelProfile}: the fixture heights sit on both sides of the jump height`, () => {
      const runtime = roomRuntime({ rows: ['...', '###'], tileSize: T, spawn: [1, 0] });
      const rise = measureRise(runtime, WALKER, feelProfile).height;
      expect(rise).toBeGreaterThan(2 * T * FX_ONE);
      expect(rise).toBeLessThan(3 * T * FX_ONE);
    });

    it(`${feelProfile}: a oneway shelf lets a jump through from below`, () => {
      const { runtime, scope, floor, shelf } = shelfRoom('=', 2, 'floor');
      expect(shelf.status).toBe('reached');
      expectWitnessEndsOn(runtime, shelf);
      expect(kindsBetween(scope, floor, shelf)).toContain('jump');
      // Down again through the shelf: a replay of the round trip.
      expect(shelf.return?.status).toBe('verified');
      expectReturnsHold(runtime, scope);
    });

    it(`${feelProfile}: a full shelf at the same height does not, and that is proven`, () => {
      const { shelf } = shelfRoom('#', 2, 'floor');
      expect(shelf.status).toBe('unreached');
      expect(shelf.blocker).toEqual(PROVEN_ENCLOSED);
    });

    it(`${feelProfile}: from a oneway shelf the only way down is the drop, and there is no way back`, () => {
      const { runtime, scope, floor, shelf } = shelfRoom('=', 3, 'shelf');
      expect(scope.startFootholds).toEqual([shelf.id]);
      expect(floor.status).toBe('reached');
      expectWitnessEndsOn(runtime, floor);
      expect(kindsBetween(scope, shelf, floor)).toEqual(['drop']);
      // Too high to jump back up: no transition from the floor to the shelf was seen.
      expect(kindsBetween(scope, floor, shelf)).toBeUndefined();
      // And that is a proof, not only a search result: whatever the inputs, no way back.
      const riseBound = measureRiseBound(runtime, WALKER, feelProfile);
      expect(floor.return).toEqual({
        status: 'provenNo',
        riseNeeded: 3 * T * FX_ONE,
        riseBound,
      });
      expect(scope.riseBound).toBe(riseBound);
      expect(shelf.return?.status).toBe('verified');
      expect(scope.stats.returnSearches).toBe(0);
      expectReturnsHold(runtime, scope);
    });

    it(`${feelProfile}: a full shelf cannot be dropped through, and that is proven`, () => {
      const { floor } = shelfRoom('#', 3, 'shelf');
      expect(floor.status).toBe('unreached');
      expect(floor.blocker).toEqual(PROVEN_ENCLOSED);
    });
  }
});
