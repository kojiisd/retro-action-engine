import {
  actionMask,
  CONTACT_GROUNDED,
  createWorld,
  FX_ONE,
  type PackRuntime,
  Player,
  type ReplayFile,
  runReplayHeadless,
  type StartState,
  startOf,
  step,
} from '@retro-action-engine/core';
import { type FeelInPx, MODERN_PX, RETRO_PX, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { measureRise, measureRiseBound } from './probe';
import { solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';
import type { FootholdReport, ScopeReport, SolveReport } from './types';

const scopeOf = (report: SolveReport, characterId: string): ScopeReport =>
  report.scopes.find((scope) => scope.scope.characterId === characterId) as ScopeReport;

/** The foothold of a scope that covers the given tile. */
function footholdAt(scope: ScopeReport, col: number, row: number): FootholdReport {
  const found = scope.footholds.find((f) => f.row === row && f.colFrom <= col && col <= f.colTo);
  if (found === undefined) {
    throw new Error(`no foothold at column ${col}, row ${row}`);
  }
  return found;
}

/** Independent check of a witness: replay it and look at where the character ends up. */
function expectWitnessEndsOn(runtime: PackRuntime, foothold: FootholdReport): void {
  expect(foothold.witness).toBeDefined();
  const replay = foothold.witness?.replay;
  if (replay === undefined) return;
  const { world } = runReplayHeadless(replay, runtime);
  const s = world.entities;
  const T = runtime.tileSize;
  expect((s.contact[0] as number) & CONTACT_GROUNDED).toBe(CONTACT_GROUNDED);
  // Feet exactly on the foothold's top edge, and the box over at least one of its columns.
  expect(s.y[0]).toBe(foothold.topPx * 256);
  const left = ((s.x[0] as number) + (s.colOx[0] as number)) / 256;
  const right = left + (s.colW[0] as number) / 256;
  expect(right).toBeGreaterThan(foothold.colFrom * T);
  expect(left).toBeLessThan((foothold.colTo + 1) * T);
}

/** Held mask of every tick of a replay. */
function heldsOf(replay: ReplayFile): number[] {
  return replay.frames.flatMap(([count, held]) => Array.from({ length: count }, () => held));
}

/**
 * Checks every "way back" of a scope independently of the solver: a verified one is a replay
 * that first goes to the foothold exactly as its own witness does, and ends standing on a
 * start foothold.
 */
function expectReturnsHold(runtime: PackRuntime, scope: ScopeReport): void {
  const starts = scope.footholds.filter((f) => scope.startFootholds.includes(f.id));
  for (const foothold of scope.footholds) {
    if (foothold.status === 'unreached') {
      expect(foothold.witness).toBeUndefined();
      expect(foothold.return).toBeUndefined();
      continue;
    }
    expect(foothold.blocker).toBeUndefined();
    expect(foothold.return).toBeDefined();
    if (foothold.return?.status !== 'verified') {
      // A start foothold always has the trivial way back.
      expect(scope.startFootholds).not.toContain(foothold.id);
      continue;
    }
    const there = foothold.witness as NonNullable<FootholdReport['witness']>;
    const back = foothold.return.witness;
    const helds = heldsOf(back.replay);
    expect(helds.slice(0, there.ticks)).toEqual(heldsOf(there.replay));
    expect(back.ticks).toBe(helds.length);
    expect(back.macros).toBeGreaterThanOrEqual(there.macros);
    const { world } = runReplayHeadless(back.replay, runtime);
    const s = world.entities;
    const T = runtime.tileSize;
    const left = ((s.x[0] as number) + (s.colOx[0] as number)) / 256;
    const right = left + (s.colW[0] as number) / 256;
    expect((s.contact[0] as number) & CONTACT_GROUNDED).toBe(CONTACT_GROUNDED);
    expect(
      starts.some(
        (start) =>
          s.y[0] === start.topPx * 256 && right > start.colFrom * T && left < (start.colTo + 1) * T,
      ),
    ).toBe(true);
  }
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

/** Kinds of macro seen from one foothold to another, or undefined when no transition was seen. */
function kindsBetween(scope: ScopeReport, from: FootholdReport, to: FootholdReport) {
  return scope.edges.find((edge) => edge.from === from.id && edge.to === to.id)?.kinds;
}

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

/** Ticks of a replay on which jump was pressed, with whether the character stood on something. */
function jumpPresses(runtime: PackRuntime, replay: ReplayFile) {
  const world = createWorld(runtime, startOf(replay));
  const player = new Player(replay.frames);
  const jump = actionMask('jump');
  const presses: Array<{ tick: number; grounded: boolean }> = [];
  for (let tick = 0; tick < player.length; tick++) {
    const frame = player.next();
    if ((frame.pressed & jump) !== 0) {
      const grounded = ((world.entities.contact[0] as number) & CONTACT_GROUNDED) !== 0;
      presses.push({ tick, grounded });
    }
    step(world, frame, runtime);
  }
  return presses;
}

describe('solveRoom: a foothold that needs coyote time', () => {
  // 4 px tiles. A corridor only 2 px taller than the character, so a jump inside it bumps the
  // ceiling at once. The ceiling reaches one tile past the end of the corridor floor: the last
  // jump from the ground is still under it. Walking off and jumping a few ticks later is clear
  // of it. The target is 20 px above the corridor floor, and far above the floor of the pit.
  const T = 4;
  const rows = emptyRows(32, 36);
  fill(rows, '#', 0, 12, 0, 15); // ceiling block, bottom edge at 64 px
  fill(rows, '#', 0, 11, 20, 35); // corridor floor (top edge at 80 px) and everything below
  fill(rows, '#', 20, 27, 15); // target, top edge at 60 px
  fill(rows, '#', 0, 31, 35); // floor of the pit
  const fixture = { rows, tileSize: T, spawn: [4, 19] as const };
  const start: StartState = { ...START, feelProfile: 'modern' };

  it('the fixture needs a real jump: the target is above the corridor hop and below the rise', () => {
    const runtime = roomRuntime(fixture);
    const rise = measureRise(runtime, WALKER, 'modern').height;
    const corridorHeadroom = 4 * T * FX_ONE - WALKER.collider.h;
    const targetAboveCorridor = 5 * T * FX_ONE;
    const targetAbovePit = 20 * T * FX_ONE;
    expect(corridorHeadroom).toBeLessThan(targetAboveCorridor);
    expect(targetAboveCorridor).toBeLessThan(rise);
    expect(rise).toBeLessThan(targetAbovePit);
    expect(MODERN_PX.coyoteTicks).toBeGreaterThan(0);
  });

  it('with coyote time the target is reached, by a jump pressed in the air', () => {
    const runtime = roomRuntime(fixture);
    const report = solveRoom(runtime, start);
    const scope = scopeOf(report, 'walker');
    const corridor = footholdAt(scope, 4, 20);
    const target = footholdAt(scope, 24, 15);
    expect(report.complete).toBe(true);
    expect(target.status).toBe('reached');
    expectWitnessEndsOn(runtime, target);
    expect(kindsBetween(scope, corridor, target)).toEqual(['walkOffJump']);
    const presses = jumpPresses(runtime, target.witness?.replay as ReplayFile);
    expect(presses.some((press) => !press.grounded)).toBe(true);
    // The pit is too deep to climb out of, whatever the inputs.
    expect(footholdAt(scope, 24, 35).return?.status).toBe('provenNo');
    expectReturnsHold(runtime, scope);
  });

  it('without coyote time the same target is not reached', () => {
    const runtime = roomRuntime({ ...fixture, feel: { coyoteTicks: 0 } });
    const report = solveRoom(runtime, start);
    const scope = scopeOf(report, 'walker');
    expect(report.complete).toBe(true);
    expect(footholdAt(scope, 24, 15).status).toBe('unreached');
    // "Not found", not "impossible": the target is within the rise and not walled off, so
    // there is no proof either way.
    expect(footholdAt(scope, 24, 15).blocker).toBeUndefined();
    // The pit is still reached, by falling.
    expect(footholdAt(scope, 24, 35).status).toBe('reached');
  });
});

describe('solveRoom: a take-off point in the middle of a floor', () => {
  // The shelf is one tile wide and the profile has no air control: it is only reached by jumps
  // that start from a narrow range of positions on the floor, away from the walls.
  const rows = emptyRows(12, 6);
  fill(rows, '#', 0, 11, 5);
  fill(rows, '=', 6, 6, 3);
  const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 4] });

  it('is found with the default position quantum', () => {
    const scope = scopeOf(solveRoom(runtime, { ...START, feelProfile: 'retro' }), 'walker');
    const shelf = footholdAt(scope, 6, 3);
    expect(shelf.status).toBe('reached');
    expectWitnessEndsOn(runtime, shelf);
  });
});

describe('solveRoom: the way back', () => {
  // 4 px tiles. The start is the top of a block; next to it is a shaft only 4 px wider than
  // the character, with a floor 32 px lower. The rise is enough to get back up (so nothing is
  // proven), but the block's side is in the way of any jump that already moves left.
  const T = 4;
  const rows = emptyRows(16, 25);
  fill(rows, '#', 0, 15, 24);
  fill(rows, '#', 0, 7, 16, 24);
  fill(rows, '#', 12, 15, 0, 24);
  const fixture = { rows, tileSize: T, spawn: [3, 15] as const };

  it('the fixture is not decided by the rise bound', () => {
    const runtime = roomRuntime(fixture);
    for (const feelProfile of ['retro', 'modern']) {
      expect(measureRiseBound(runtime, WALKER, feelProfile)).toBeGreaterThan(8 * T * FX_ONE);
    }
  });

  it('without air control no way back is found, and it is not called impossible', () => {
    const runtime = roomRuntime(fixture);
    const report = solveRoom(runtime, { ...START, feelProfile: 'retro' });
    const scope = scopeOf(report, 'walker');
    const top = footholdAt(scope, 3, 16);
    const shaft = footholdAt(scope, 9, 24);
    expect(scope.startFootholds).toEqual([top.id]);
    expect(shaft.status).toBe('reached');
    expect(shaft.return).toEqual({ status: 'notFound' });
    // The search for a way back ran to its end: "not found" is not a cut-off here.
    expect(report.complete).toBe(true);
    expect(scope.stats.returnSearches).toBe(1);
    expectReturnsHold(runtime, scope);
  });

  it('with air control the way back is found and replayed', () => {
    const runtime = roomRuntime(fixture);
    const report = solveRoom(runtime, { ...START, feelProfile: 'modern' });
    const scope = scopeOf(report, 'walker');
    const shaft = footholdAt(scope, 9, 24);
    expect(shaft.return?.status).toBe('verified');
    expectWitnessEndsOn(runtime, {
      ...footholdAt(scope, 3, 16),
      witness: shaft.return?.status === 'verified' ? shaft.return.witness : undefined,
    } as FootholdReport);
    expectReturnsHold(runtime, scope);
  });

  it('the start foothold has the trivial way back', () => {
    const runtime = roomRuntime(fixture);
    const scope = scopeOf(solveRoom(runtime, { ...START, feelProfile: 'retro' }), 'walker');
    const top = footholdAt(scope, 3, 16);
    expect(top.return).toEqual({ status: 'verified', witness: top.witness });
  });

  it('a search for a way back that runs out of budget says so', () => {
    const runtime = roomRuntime(fixture);
    const start: StartState = { ...START, feelProfile: 'retro' };
    const full = solveRoom(runtime, start);
    // Enough for the search from the start, not for the whole search from the shaft.
    const report = solveRoom(runtime, start, { maxSteps: full.totals.steps - 1 });
    const scope = scopeOf(report, 'walker');
    expect(footholdAt(scope, 9, 24).status).toBe('reached');
    expect(footholdAt(scope, 9, 24).return).toEqual({ status: 'notFound' });
    expect(report.complete).toBe(false);
  });
});

describe('solveRoom: limits, statistics and determinism', () => {
  const rows = emptyRows(8, 7);
  fill(rows, '#', 0, 7, 6);
  fill(rows, '=', 2, 4, 4);
  fill(rows, '~', 6, 6, 0, 5);
  const runtime = roomRuntime({
    rows,
    tileSize: 16,
    spawn: [1, 5],
    members: ['walker', 'swimmer'],
  });
  const start: StartState = { ...START, feelProfile: 'modern' };
  const full = solveRoom(runtime, start);

  it('reports the same thing for the same input', () => {
    const again = solveRoom(runtime, start);
    expect(again).toEqual(full);
    expect(JSON.stringify(again)).toBe(JSON.stringify(full));
  });

  it('verifies one replay per reached foothold and counts the work', () => {
    expect(full.complete).toBe(true);
    for (const scope of full.scopes) {
      const reached = scope.footholds.filter((f) => f.status === 'reached');
      expect(reached.length).toBeGreaterThan(1);
      const returns = reached.filter((f) => f.return?.status === 'verified');
      expect(scope.stats.replaysVerified).toBe(reached.length + returns.length);
      for (const foothold of reached) {
        expectWitnessEndsOn(runtime, foothold);
        const witness = foothold.witness as NonNullable<FootholdReport['witness']>;
        expect(witness.ticks).toBe(runReplayHeadless(witness.replay, runtime).tick);
      }
      expect(scope.stats.nodes).toBeGreaterThan(0);
      expect(scope.stats.macros).toBeGreaterThanOrEqual(scope.stats.edges);
    }
    // The walker cannot pass the water; the swimmer reaches everything.
    expect(scopeOf(full, 'walker').footholds.some((f) => f.status === 'unreached')).toBe(true);
    expect(scopeOf(full, 'swimmer').footholds.every((f) => f.status === 'reached')).toBe(true);
    expect(full.totals.steps).toBe(full.scopes.reduce((sum, s) => sum + s.stats.steps, 0));
    expect(full.totals.elapsedMs).toBeUndefined();
  });

  it('a node limit cuts the search short and says so', () => {
    // One node: the start state is recorded, and nothing is tried from it.
    const report = solveRoom(runtime, start, { maxNodes: 1 });
    expect(report.complete).toBe(false);
    for (const scope of report.scopes) {
      expect(scope.complete).toBe(false);
      expect(scope.stats.nodes).toBeLessThan(scopeOf(full, scope.scope.characterId).stats.nodes);
      // What was found before the cut is still verified.
      for (const foothold of scope.footholds.filter((f) => f.status === 'reached')) {
        expectWitnessEndsOn(runtime, foothold);
      }
    }
    expect(scopeOf(report, 'walker').stats.macros).toBe(0);
    // The shelf is reachable (the full run found it) but the cut run did not get that far.
    const shelfId = footholdAt(scopeOf(full, 'walker'), 3, 4).id;
    expect(scopeOf(full, 'walker').footholds.find((f) => f.id === shelfId)?.status).toBe('reached');
    expect(scopeOf(report, 'walker').footholds.find((f) => f.id === shelfId)?.status).toBe(
      'unreached',
    );
  });

  it('a step limit covers the whole call', () => {
    const maxSteps = Math.floor(full.totals.steps / 4);
    const report = solveRoom(runtime, start, { maxSteps });
    expect(report.complete).toBe(false);
    expect(report.totals.steps).toBeLessThanOrEqual(maxSteps);
    expect(report.limits.maxSteps).toBe(maxSteps);
    // The budget ran out in the first scope, so the second one could not even start.
    expect(report.scopes.map((scope) => scope.complete)).toEqual([false, false]);
  });

  it('a macro that never lands is dropped and counted', () => {
    // Too few ticks for any jump to come down again.
    const report = solveRoom(runtime, start, { maxMacroTicks: 5, maxNodes: 50 });
    expect(scopeOf(report, 'walker').stats.timeouts).toBeGreaterThan(0);
    expect(scopeOf(full, 'walker').stats.timeouts).toBe(0);
  });

  it('measures the time only with the clock it is given', () => {
    let now = 0;
    const report = solveRoom(runtime, start, { maxNodes: 1, now: () => (now += 5) });
    expect(report.totals.elapsedMs).toBe(5);
  });

  it('rejects a party member that is not a character', () => {
    expect(() => solveRoom(runtime, { ...start, party: ['nobody'] })).toThrow(RangeError);
  });
});
