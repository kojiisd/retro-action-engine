import { beforeEach, describe, expect, it, vi } from 'vitest';
import { solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';
import { verifyWitness, WitnessError } from './witness';

// The real gate, wrapped so that a test can watch it or make it refuse.
vi.mock('./witness', async (importOriginal) => {
  const original = await importOriginal<typeof import('./witness')>();
  return { ...original, verifyWitness: vi.fn(original.verifyWitness) };
});

const rows = emptyRows(8, 6);
fill(rows, '#', 0, 7, 5);
fill(rows, '=', 4, 6, 3);
const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 4] });
const start = { ...START, feelProfile: 'retro' };

describe('solveRoom: nothing is reported as reached without passing the gate', () => {
  const gate = vi.mocked(verifyWitness);

  beforeEach(() => {
    gate.mockClear();
  });

  it('sends every reached foothold through the gate, with its own replay', () => {
    const report = solveRoom(runtime, start);
    const reached = report.scopes.flatMap((s) => s.footholds.filter((f) => f.status === 'reached'));
    expect(reached.length).toBeGreaterThan(1);
    expect(gate).toHaveBeenCalledTimes(reached.length);
    const checked = gate.mock.calls.map(([, , , , replay]) => replay);
    expect(checked).toEqual(reached.map((foothold) => foothold.witness?.replay));
  });

  it('fails instead of reporting when the gate refuses a replay', () => {
    gate.mockImplementationOnce(() => {
      throw new WitnessError('refused by the test');
    });
    expect(() => solveRoom(runtime, start)).toThrow(WitnessError);
  });
});
