import { FX_ONE, type StartState } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { measureRise } from './probe';
import { solveRoom } from './solve';
import { emptyRows, fill, type RoomFixture, roomRuntime, START } from './test-support';
import type { FootholdReport, ScopeReport, SolveReport } from './types';

const start: StartState = { ...START, feelProfile: 'retro' };

const scopeOf = (report: SolveReport, who: string): ScopeReport =>
  report.scopes.find((scope) =>
    who === 'party'
      ? scope.scope.kind === 'party'
      : scope.scope.kind === 'character' && scope.scope.characterId === who,
  ) as ScopeReport;

function runAt(scope: ScopeReport, col: number, row: number): FootholdReport {
  const found = scope.footholds.find((f) => f.row === row && f.colFrom <= col && col <= f.colTo);
  if (found === undefined) throw new Error(`no foothold at column ${col}, row ${row}`);
  return found;
}

describe('estimates: needsTag', () => {
  // 8 px tiles. A water column from the floor up to one tile below the ceiling. The gap above
  // it is open (so nothing is proven), but 8 px is too low for the 14 px box to pass.
  const rows = emptyRows(16, 10);
  fill(rows, '#', 0, 15, 9);
  fill(rows, '#', 0, 15, 0);
  fill(rows, '~', 8, 8, 2, 8);
  const fixture: RoomFixture = { rows, tileSize: 8, spawn: [3, 8], members: ['walker', 'swimmer'] };
  const report = solveRoom(roomRuntime(fixture), start);

  it('names the tag that, given to the character, gets the search there', () => {
    const walker = scopeOf(report, 'walker');
    expect(runAt(walker, 12, 9)).toMatchObject({
      status: 'unreached',
      blocker: { certainty: 'estimated', reason: 'needsTag', tag: 'move:swim' },
    });
    expect(walker.stats.tagSearches).toBe(1);
    // A hypothetical search never makes the real one incomplete, and is counted in its steps.
    expect(walker.complete).toBe(true);
  });

  it('is not tried for the character that has the tag already', () => {
    const swimmer = scopeOf(report, 'swimmer');
    expect(runAt(swimmer, 12, 9).status).toBe('reached');
    expect(swimmer.stats.tagSearches).toBe(0);
  });

  it('a wall from floor to ceiling stays a proof, with no estimate and no extra search', () => {
    const walled = [...rows];
    fill(walled, '~', 8, 8, 1, 1);
    const walker = scopeOf(solveRoom(roomRuntime({ ...fixture, rows: walled }), start), 'walker');
    expect(runAt(walker, 12, 9).blocker).toEqual({ certainty: 'proven', reason: 'enclosed' });
    expect(walker.stats.tagSearches).toBe(0);
  });
});

describe('estimates: budget', () => {
  it('says the search was cut short, and only where nothing is proven', () => {
    const rows = emptyRows(12, 6);
    fill(rows, '#', 0, 11, 5);
    fill(rows, '=', 6, 9, 3);
    fill(rows, '#', 2, 3, 0, 4);
    fill(rows, '#', 1, 1, 2);
    const report = solveRoom(roomRuntime({ rows, tileSize: 16, spawn: [8, 4] }), start, {
      maxNodes: 1,
    });
    const walker = scopeOf(report, 'walker');
    expect(walker.complete).toBe(false);
    expect(runAt(walker, 7, 3).blocker).toEqual({ certainty: 'estimated', reason: 'budget' });
    // The floor left of the wall is walled off: proven, whatever the budget.
    expect(runAt(walker, 0, 5).blocker).toEqual({ certainty: 'proven', reason: 'enclosed' });
    expect(walker.stats.tagSearches).toBe(0);
  });
});

describe('estimates: tooHigh and tooFar', () => {
  it('too high when no proof is allowed: every reached foothold is too low for the jump', () => {
    // Switching in the air: the party has no height proofs. The shelf is 64 px up, above the
    // walker's 57.75 px jump.
    const rows = emptyRows(12, 8);
    fill(rows, '#', 0, 11, 7);
    fill(rows, '=', 8, 10, 3);
    const runtime = roomRuntime({
      rows,
      tileSize: 16,
      spawn: [2, 6],
      members: ['walker', 'swimmer'],
      switching: { requireGrounded: false },
      walker: { feelOverrides: { jumpVelocity: Math.round(5.5 * FX_ONE) } },
    });
    const party = scopeOf(solveRoom(runtime, start), 'party');
    expect(party.proofs.height).toBe(false);
    const rise = measureRise(runtime, runtime.characters.walker as never, 'retro').height;
    expect(rise).toBe(57.75 * FX_ONE);
    expect(runAt(party, 9, 3).blocker).toEqual({
      certainty: 'estimated',
      reason: 'tooHigh',
      riseNeeded: 64 * FX_ONE,
      rise,
    });
  });

  it('too far: a foothold at the same height across a gap the jump cannot clear', () => {
    // A pit 6 tiles wide and 64 px deep: no way out once in. Nothing is walled off and
    // nothing is above the start, so there is no proof.
    const rows = emptyRows(16, 10);
    fill(rows, '#', 0, 4, 5, 9);
    fill(rows, '#', 11, 15, 5, 9);
    fill(rows, '#', 5, 10, 9);
    const walker = scopeOf(
      solveRoom(roomRuntime({ rows, tileSize: 16, spawn: [2, 4] }), start),
      'walker',
    );
    expect(runAt(walker, 7, 9).status).toBe('reached');
    expect(runAt(walker, 13, 5)).toMatchObject({
      status: 'unreached',
      blocker: { certainty: 'estimated', reason: 'tooFar' },
    });
  });

  it('too far, not too high, when the jump would be high enough from a reached foothold', () => {
    // The same pit, the far side one tile higher: 16 px is within the jump.
    const rows = emptyRows(16, 10);
    fill(rows, '#', 0, 4, 5, 9);
    fill(rows, '#', 11, 15, 4, 9);
    fill(rows, '#', 5, 10, 9);
    const walker = scopeOf(
      solveRoom(roomRuntime({ rows, tileSize: 16, spawn: [2, 4] }), start),
      'walker',
    );
    expect(runAt(walker, 13, 4).blocker).toEqual({ certainty: 'estimated', reason: 'tooFar' });
  });
});
