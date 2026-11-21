import {
  actionMask,
  CONTACT_GROUNDED,
  FX_ONE,
  type PackRuntime,
  type ReplayFile,
  runReplayHeadless,
  type StartState,
} from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { measureRiseBound } from './probe';
import { solveRoom } from './solve';
import { emptyRows, fill, type RoomFixture, roomRuntime, START } from './test-support';
import type { FootholdReport, ScopeReport, SolveReport } from './types';

const SWITCH = actionMask('switch');
const start: StartState = { ...START, feelProfile: 'retro' };

const scopeOf = (report: SolveReport, who: string): ScopeReport | undefined =>
  report.scopes.find((scope) =>
    who === 'party'
      ? scope.scope.kind === 'party'
      : scope.scope.kind === 'character' && scope.scope.characterId === who,
  );

function runAt(scope: ScopeReport | undefined, col: number, row: number): FootholdReport {
  const found = scope?.footholds.find((f) => f.row === row && f.colFrom <= col && col <= f.colTo);
  if (found === undefined) throw new Error(`no foothold at column ${col}, row ${row}`);
  return found;
}

/** Ticks on which the switch button was pressed. */
function switchPresses(replay: ReplayFile): number[] {
  const ticks: number[] = [];
  let tick = 0;
  for (const [count, , pressed] of replay.frames) {
    if ((pressed & SWITCH) !== 0) ticks.push(tick);
    tick += count;
  }
  return ticks;
}

/** Independent check: the replay ends with the active character standing on the run. */
function expectEndsOn(runtime: PackRuntime, replay: ReplayFile | undefined, run: FootholdReport) {
  expect(replay).toBeDefined();
  if (replay === undefined) return;
  const { world } = runReplayHeadless(replay, runtime);
  const s = world.entities;
  const T = runtime.tileSize;
  const left = ((s.x[0] as number) + (s.colOx[0] as number)) / FX_ONE;
  const right = left + (s.colW[0] as number) / FX_ONE;
  expect((s.contact[0] as number) & CONTACT_GROUNDED).toBe(CONTACT_GROUNDED);
  expect(s.y[0]).toBe(run.topPx * FX_ONE);
  expect(right).toBeGreaterThan(run.colFrom * T);
  expect(left).toBeLessThan((run.colTo + 1) * T);
}

// A floor, a water column from the ceiling to the floor, and beyond it a oneway shelf 48 px up.
// The walker jumps higher than the shelf but cannot pass the water; the swimmer passes the
// water but its jump (38.25 px, the retro profile) is too low. Only switching gets there.
const rows = emptyRows(12, 6);
fill(rows, '#', 0, 11, 5);
fill(rows, '~', 6, 6, 0, 4);
fill(rows, '=', 8, 10, 2);
const fixture: RoomFixture = {
  rows,
  tileSize: 16,
  spawn: [2, 4],
  members: ['walker', 'swimmer'],
  switching: {},
  walker: { feelOverrides: { jumpVelocity: Math.round(5.5 * FX_ONE) } },
};

describe('solveRoom: the party with switching', () => {
  const runtime = roomRuntime(fixture);
  const report = solveRoom(runtime, start);
  const party = scopeOf(report, 'party');

  it('the fixture needs both: one is too low, the other cannot pass', () => {
    const walkerBound = measureRiseBound(runtime, runtime.characters.walker as never, 'retro');
    const swimmerBound = measureRiseBound(runtime, runtime.characters.swimmer as never, 'retro');
    expect(swimmerBound).toBeLessThan(48 * FX_ONE);
    expect(walkerBound).toBeGreaterThan(48 * FX_ONE);
  });

  it('alone, neither reaches the shelf, and both cases are proven', () => {
    expect(runAt(scopeOf(report, 'walker'), 9, 2)).toMatchObject({
      status: 'unreached',
      blocker: { certainty: 'proven', reason: 'enclosed' },
    });
    expect(runAt(scopeOf(report, 'swimmer'), 9, 2)).toMatchObject({
      status: 'unreached',
      blocker: { certainty: 'proven', reason: 'tooHigh' },
    });
  });

  it('together they reach it, with a verified replay that switches twice', () => {
    expect(party?.scope).toEqual({ kind: 'party', members: ['walker', 'swimmer'] });
    const shelf = runAt(party, 9, 2);
    expect(shelf.status).toBe('reached');
    expect(shelf.characterIds).toEqual(['walker', 'swimmer']);
    expect(shelf.witness?.replay.start.party).toEqual(['walker', 'swimmer']);
    expectEndsOn(runtime, shelf.witness?.replay, shelf);
    const presses = switchPresses(shelf.witness?.replay as ReplayFile);
    expect(presses.length).toBeGreaterThanOrEqual(2);
    // Never faster than the cooldown allows.
    for (let i = 1; i < presses.length; i++) {
      expect((presses[i] as number) - (presses[i - 1] as number)).toBeGreaterThanOrEqual(20);
    }
    // The final state has the walker active (the swimmer could not have jumped that high).
    const { world } = runReplayHeadless(shelf.witness?.replay as ReplayFile, runtime);
    expect(world.party.members[world.party.activeIndex]).toBe('walker');
  });

  it('merges the footholds of the members into runs of the room', () => {
    // The walker has two floor footholds (the water splits them), the swimmer one: one run.
    const floor = runAt(party, 9, 5);
    expect(floor).toMatchObject({ colFrom: 0, colTo: 11, characterIds: ['walker', 'swimmer'] });
    expect(floor.id).toBe('party:r5c0-11');
    expect(party?.startFootholds).toEqual([floor.id]);
    // A run lists who can stand on it.
    expect(runAt(scopeOf(report, 'walker'), 2, 5).characterIds).toEqual(['walker']);
  });

  it('uses the proofs, with the highest rise of the members', () => {
    expect(party?.proofs).toEqual({ region: true, height: true });
    expect(party?.riseBound).toBe(
      measureRiseBound(runtime, runtime.characters.walker as never, 'retro'),
    );
    // Down through the shelf and back home: a verified round trip.
    const shelf = runAt(party, 9, 2);
    expect(shelf.return?.status).toBe('verified');
    if (shelf.return?.status === 'verified') {
      expectEndsOn(runtime, shelf.return.witness.replay, runAt(party, 2, 5));
    }
    expect(party?.edges.some((edge) => edge.kinds.includes('switch'))).toBe(false);
  });

  it('reports the same thing twice', () => {
    expect(solveRoom(runtime, start)).toEqual(report);
  });
});

describe('solveRoom: when there is a party scope', () => {
  const kinds = (fixtureChange: Partial<RoomFixture>) =>
    solveRoom(roomRuntime({ ...fixture, ...fixtureChange }), start, { maxNodes: 1 }).scopes.map(
      (scope) => scope.scope.kind,
    );

  it('only when the party can switch: two members and mode anywhere', () => {
    expect(kinds({})).toEqual(['character', 'character', 'party']);
    expect(kinds({ switching: undefined })).toEqual(['character', 'character']);
    expect(kinds({ switching: { mode: 'never' } })).toEqual(['character', 'character']);
    expect(kinds({ switching: { mode: 'atPoints' } })).toEqual(['character', 'character']);
    expect(kinds({ members: ['walker'] })).toEqual(['character']);
    expect(kinds({ members: ['walker', 'walker'] })).toEqual(['character']);
  });
});

describe('solveRoom: a cooldown longer than any macro', () => {
  it('allows one switch per macro limit, so the second one never comes', () => {
    const runtime = roomRuntime({ ...fixture, switching: { cooldownTicks: 1000 } });
    const party = scopeOf(solveRoom(runtime, start), 'party');
    // Switching to the swimmer works; switching back to the walker would need 1000 ticks.
    expect(runAt(party, 9, 5).status).toBe('reached');
    expect(runAt(party, 9, 2).status).toBe('unreached');
    expect(party?.stats.timeouts).toBeGreaterThan(0);
  });
});

describe('solveRoom: party proofs only where the ADR has an argument', () => {
  const partyOf = (change: Partial<RoomFixture>) =>
    scopeOf(solveRoom(roomRuntime({ ...fixture, ...change }), start), 'party');

  it('switching in the air: no height proofs', () => {
    const party = partyOf({ switching: { requireGrounded: false } });
    expect(party?.proofs).toEqual({ region: true, height: false });
    expect(party?.riseBound).toBeNull();
    expect(
      party?.footholds.some(
        (f) => f.blocker?.certainty === 'proven' && f.blocker.reason === 'tooHigh',
      ),
    ).toBe(false);
    expect(party?.footholds.some((f) => f.return?.status === 'provenNo')).toBe(false);
  });

  it('switching moves the body to the spawn: no height proofs', () => {
    const party = partyOf({ switching: { placement: 'spawn' } });
    expect(party?.proofs).toEqual({ region: true, height: false });
    expect(party?.riseBound).toBeNull();
  });

  it('members with different boxes: no proofs at all', () => {
    const tall = { w: 12 * FX_ONE, h: 20 * FX_ONE, ox: -6 * FX_ONE, oy: -20 * FX_ONE };
    const party = partyOf({ swimmer: { collider: tall } });
    expect(party?.proofs).toEqual({ region: false, height: false });
    expect(party?.riseBound).toBeNull();
    expect(party?.footholds.some((f) => f.blocker?.certainty === 'proven')).toBe(false);
    // The members alone still use their own proofs.
    const report = solveRoom(roomRuntime({ ...fixture, swimmer: { collider: tall } }), start);
    expect(scopeOf(report, 'walker')?.proofs).toEqual({ region: true, height: true });
  });

  it('a wall that nobody can pass is still proven in the party', () => {
    const walled = [...rows];
    fill(walled, '#', 4, 4, 0, 4);
    const party = partyOf({ rows: walled });
    expect(runAt(party, 9, 2).blocker).toEqual({ certainty: 'proven', reason: 'enclosed' });
    expect(runAt(party, 9, 5).blocker).toEqual({ certainty: 'proven', reason: 'enclosed' });
  });

  it('a shelf too high for every member is proven too high for the party', () => {
    const high = emptyRows(12, 8);
    fill(high, '#', 0, 11, 7);
    fill(high, '=', 8, 10, 3);
    const party = partyOf({ rows: high, spawn: [2, 6] });
    // 64 px up: above the walker's 57.75 px.
    expect(runAt(party, 9, 3)).toMatchObject({
      status: 'unreached',
      blocker: { certainty: 'proven', reason: 'tooHigh', riseNeeded: 64 * FX_ONE },
    });
  });
});

describe('solveRoom: switching without a cooldown', () => {
  it('still tells the two members apart at the same place', () => {
    // A switch that lands where it started is a new state only because someone else is active.
    const runtime = roomRuntime({ ...fixture, switching: { cooldownTicks: 0 } });
    const party = scopeOf(solveRoom(runtime, start), 'party');
    const shelf = runAt(party, 9, 2);
    expect(shelf.status).toBe('reached');
    expectEndsOn(runtime, shelf.witness?.replay, shelf);
  });
});

describe('solveRoom: a party that starts inside a tile only some members can pass', () => {
  // The spawn is in the water: closed for the walker, open for the swimmer.
  const wet = emptyRows(12, 6);
  fill(wet, '#', 0, 11, 5);
  fill(wet, '~', 1, 3, 3, 4);
  fill(wet, '#', 8, 8, 0, 4);
  const room: RoomFixture = {
    ...fixture,
    rows: wet,
    spawn: [2, 4],
    members: ['swimmer', 'walker'],
  };

  it('the party keeps its proofs: the cell is open for someone', () => {
    const report = solveRoom(roomRuntime(room), start);
    const party = scopeOf(report, 'party');
    expect(party?.proofs.region).toBe(true);
    expect(runAt(party, 10, 5).blocker).toEqual({ certainty: 'proven', reason: 'enclosed' });
  });

  it('the member that cannot be there alone has no proofs', () => {
    const report = solveRoom(roomRuntime({ ...room, members: ['walker', 'swimmer'] }), start, {
      maxNodes: 50,
    });
    expect(scopeOf(report, 'walker')?.proofs.region).toBe(false);
    expect(scopeOf(report, 'swimmer')?.proofs.region).toBe(true);
  });
});

describe('solveRoom: media and HP-draining tiles take away the height proofs (ADR-0016)', () => {
  const base = roomRuntime(fixture);
  const room = base.rooms.room as NonNullable<(typeof base.rooms)['room']>;
  const retro = base.feel.retro as NonNullable<(typeof base.feel)['retro']>;
  const withHp = (runtime: PackRuntime, hazards: boolean): PackRuntime => ({
    ...runtime,
    characters: Object.fromEntries(
      Object.entries(runtime.characters).map(([id, c]) => [id, { ...c, hp: { max: 3 } }]),
    ),
    rules: {
      ...runtime.rules,
      hp: { scope: 'perCharacter', onDeath: 'switchToAlive', onAllDown: 'respawnAtSavePoint' },
      ...(hazards ? { hazards: { acid: { damage: 1, intervalTicks: 1000 } } } : {}),
    },
  });
  const hazardRoom: PackRuntime = {
    ...base,
    rooms: {
      room: {
        ...room,
        tileClasses: [...room.tileClasses, { id: 9, solid: 'none', hazard: 'acid' }],
      },
    },
  };
  const cases: Array<readonly [string, PackRuntime]> = [
    [
      'a profile with a medium',
      { ...base, feel: { ...base.feel, retro: { ...retro, media: { goo: { swim: true } } } } },
    ],
    ['an HP-draining tile with HP rules', withHp(hazardRoom, true)],
  ];

  for (const [name, runtime] of cases) {
    it(`${name}: no height proofs in any scope`, () => {
      for (const scope of solveRoom(runtime, start).scopes) {
        expect(scope.proofs.height).toBe(false);
        expect(scope.riseBound).toBeNull();
        expect(
          scope.footholds.some(
            (f) => f.blocker?.certainty === 'proven' && f.blocker.reason === 'tooHigh',
          ),
        ).toBe(false);
        expect(scope.footholds.some((f) => f.return?.status === 'provenNo')).toBe(false);
      }
    });
  }

  it('HP rules alone, without such a tile, keep the proofs', () => {
    const party = scopeOf(solveRoom(withHp(base, false), start), 'party');
    expect(party?.proofs).toEqual({ region: true, height: true });
  });
});
