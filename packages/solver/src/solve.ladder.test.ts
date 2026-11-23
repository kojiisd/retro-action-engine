import { fromPx, type PackRuntime, type StartState } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { solveRoom } from './solve';
import { emptyRows, fill, footholdAt, roomRuntime, START, scopeOf } from './test-support';

const start: StartState = { ...START, feelProfile: 'retro' };

/** A floor, and a shelf far above it; `ladder` puts a ladder from the floor up to the shelf. */
function shelfRoom(ladder: boolean): PackRuntime {
  const rows = emptyRows(20, 12);
  fill(rows, '#', 0, 19, 11);
  fill(rows, '=', 9, 14, 3);
  if (ladder) fill(rows, 'H', 8, 8, 3, 10);
  const runtime = roomRuntime({ rows, tileSize: 16, spawn: [2, 10] });
  const retro = runtime.feel.retro as NonNullable<(typeof runtime.feel)['retro']>;
  return {
    ...runtime,
    feel: { ...runtime.feel, retro: { ...retro, climbSpeed: fromPx(1) } },
  };
}

describe('solveRoom: ladders take away the height proofs (ADR-0019)', () => {
  it('without the ladder, the shelf is proven too high', () => {
    const scope = scopeOf(solveRoom(shelfRoom(false), start), 'walker');
    expect(scope.proofs.height).toBe(true);
    expect(footholdAt(scope, 10, 3).blocker).toMatchObject({
      certainty: 'proven',
      reason: 'tooHigh',
    });
  });

  it('with a ladder, nothing is proven too high or proven not to come back', () => {
    const scope = scopeOf(solveRoom(shelfRoom(true), start), 'walker');
    expect(scope.proofs).toEqual({ region: true, height: false });
    expect(scope.riseBound).toBeNull();
    // The macros do not climb: the shelf (with the ladder's top rung) is not found, not proven.
    const shelf = footholdAt(scope, 10, 3);
    expect(shelf.status).toBe('unreached');
    expect(shelf.blocker?.certainty).not.toBe('proven');
    expect(scope.footholds.some((f) => f.return?.status === 'provenNo')).toBe(false);
  });
});
