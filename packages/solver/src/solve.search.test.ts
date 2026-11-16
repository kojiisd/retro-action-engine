// The searches of solveRoom: coyote time, take-off points, the way back, limits.
import {
  FX_ONE,
  type PackRuntime,
  type ReplayFile,
  runReplayHeadless,
  type StartState,
} from '@retro-action-engine/core';
import { MODERN_PX, WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { measureRise, measureRiseBound } from './probe';
import { solveRoom } from './solve';
import {
  emptyRows,
  fill,
  footholdAt,
  jumpPresses,
  kindsBetween,
  nameOf,
  replayEndsOn,
  returnProblems,
  roomRuntime,
  START,
  scopeOf,
} from './test-support';
import type { FootholdReport, ScopeReport } from './types';

/** An open room, for measuring jumps. */
const _shelfOpen = { rows: ['...', '###'], tileSize: 16, spawn: [1, 0] as const };

/** Independent check of a witness: replay it and look at where the character ends up. */
function expectWitnessEndsOn(runtime: PackRuntime, foothold: FootholdReport): void {
  expect(foothold.witness).toBeDefined();
  expect(replayEndsOn(runtime, foothold.witness?.replay, foothold)).toBe(true);
}

/** Every "way back" of the scope checks out when replayed. */
function expectReturnsHold(runtime: PackRuntime, scope: ScopeReport): void {
  expect(returnProblems(runtime, scope)).toEqual([]);
}

const _PROVEN_ENCLOSED = { certainty: 'proven', reason: 'enclosed' } as const;

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
    // there is no proof either way. The estimate says the height is not the problem.
    expect(footholdAt(scope, 24, 15).blocker).toEqual({ certainty: 'estimated', reason: 'tooFar' });
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
      expect(scope.stats.nodes).toBeLessThan(scopeOf(full, nameOf(scope)).stats.nodes);
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
