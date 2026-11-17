import { FX_ONE } from '@retro-action-engine/core';
import { describe, expect, it, vi } from 'vitest';
import { ProofError, solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';

// A rise bound that is far too small, so that the proofs built on it are wrong. The solver must
// notice the contradiction with what the simulation does, and refuse to report.
vi.mock('./probe', async (importOriginal) => {
  const original = await importOriginal<typeof import('./probe')>();
  return { ...original, measureRiseBound: vi.fn(() => FX_ONE) };
});

const start = { ...START, feelProfile: 'retro' };

describe('solveRoom: a proof that contradicts the simulation is a failure, not a report', () => {
  it('fails when a verified replay reaches a foothold that a proof calls too high', () => {
    const rows = emptyRows(8, 6);
    fill(rows, '#', 0, 7, 5);
    fill(rows, '=', 4, 6, 3);
    const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 4] });
    expect(() => solveRoom(runtime, start)).toThrow(ProofError);
    expect(() => solveRoom(runtime, start)).toThrow(/claims it cannot be/);
  });

  it('fails when the simulation makes a move between footholds that a proof denies', () => {
    // The start is the highest place, so nothing is "too high" from it. The small step from
    // the floor to the low shelf is denied by the wrong bound.
    const rows = emptyRows(12, 9);
    fill(rows, '#', 0, 11, 8);
    fill(rows, '=', 0, 3, 3);
    fill(rows, '=', 7, 10, 7);
    const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 2] });
    expect(() => solveRoom(runtime, start)).toThrow(/against a proof/);
  });
});
