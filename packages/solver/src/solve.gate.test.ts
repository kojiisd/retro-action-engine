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

  it('sends every reached foothold and every way back through the gate, with its own replay', () => {
    const report = solveRoom(runtime, start);
    const reached = report.scopes.flatMap((s) => s.footholds.filter((f) => f.status === 'reached'));
    expect(reached.length).toBeGreaterThan(1);
    const reported = reached.flatMap((foothold) => [
      foothold.witness?.replay,
      ...(foothold.return?.status === 'verified' ? [foothold.return.witness.replay] : []),
    ]);
    // The shelf is reached and left again, so there is at least one real way back.
    expect(reported.length).toBeGreaterThan(reached.length);
    expect(gate).toHaveBeenCalledTimes(reported.length);
    expect(gate.mock.calls.map(([, , , , replay]) => replay)).toEqual(reported);
  });

  it('fails instead of reporting when the gate refuses a way back', () => {
    // Footholds are checked from the top row down: the first replay goes to the shelf, the
    // second one goes there and back to the floor. Refuse the second.
    const reach = gate.getMockImplementation();
    let calls = 0;
    gate.mockImplementation((...args) => {
      calls++;
      if (calls === 2) {
        throw new WitnessError('refused by the test');
      }
      return reach?.(...args);
    });
    try {
      expect(() => solveRoom(runtime, start)).toThrow(WitnessError);
      expect(calls).toBe(2);
      // Same replay start, another target foothold, and more ticks.
      const [first, second] = gate.mock.calls.slice(-2);
      expect(second?.[5]).not.toBe(first?.[5]);
    } finally {
      gate.mockImplementation(reach as NonNullable<typeof reach>);
    }
  });

  it('fails instead of reporting when the gate refuses a replay', () => {
    gate.mockImplementationOnce(() => {
      throw new WitnessError('refused by the test');
    });
    expect(() => solveRoom(runtime, start)).toThrow(WitnessError);
  });
});
