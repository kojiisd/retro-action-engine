import {
  CONTACT_GROUNDED,
  type PackRuntime,
  runReplayHeadless,
  type StartState,
} from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
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

describe('solveRoom: a wall that needs an ability tag', () => {
  // A floor, with a column of water from the ceiling to the floor in the middle.
  const rows = emptyRows(12, 6);
  fill(rows, '#', 0, 11, 5);
  fill(rows, '~', 6, 6, 0, 4);
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
    });
  }
});
