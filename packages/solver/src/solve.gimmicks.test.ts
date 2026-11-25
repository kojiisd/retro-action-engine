// Gimmicks in the solver (ADR-0021): closed ones are walls it can stand on, pickups and event
// zones are left out, and no proofs are made where a wall could open.
import { FX_ONE, type GimmickPlacement, type PackRuntime } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { solveRoom } from './solve';
import { emptyRows, fill, footholdAt, roomRuntime, START, scopeOf } from './test-support';

const T = 16;
const rect = (col: number, row: number, cols: number, rows: number) => ({
  x: col * T * FX_ONE,
  y: row * T * FX_ONE,
  w: cols * T * FX_ONE,
  h: rows * T * FX_ONE,
});

function withRoom(runtime: PackRuntime, gimmicks: GimmickPlacement[], zones = false): PackRuntime {
  const room = runtime.rooms.room;
  if (room === undefined) throw new Error('no room');
  return {
    ...runtime,
    items: { fins: { id: 'fins', kind: 'upgrade', grants: ['move:swim'], stack: 1 } },
    rooms: {
      room: {
        ...room,
        gimmicks,
        ...(zones
          ? {
              zones: [
                {
                  objectId: 1,
                  rect: rect(0, 0, 12, 6),
                  trigger: 'onZoneEnter' as const,
                  conditions: [],
                  actions: [{ giveItem: 'fins' }],
                },
              ],
            }
          : {}),
      },
    },
  };
}

describe('solveRoom: gimmicks (ADR-0021)', () => {
  // A floor, a wall from the ceiling down to a gate two tiles high, and a rock to stand on.
  const rows = emptyRows(12, 6);
  fill(rows, '#', 0, 11, 5);
  fill(rows, '#', 7, 7, 0, 2);
  const runtime = withRoom(roomRuntime({ rows, tileSize: T, spawn: [1, 4] }), [
    { objectId: 1, type: 'gate', rect: rect(7, 3, 1, 2), flag: 'open' },
    {
      objectId: 2,
      type: 'breakable',
      rect: rect(4, 4, 1, 1),
      flag: 'obj:room:2',
      requiresAnyTag: ['break:x'],
    },
  ]);
  const report = solveRoom(runtime, { ...START, feelProfile: 'retro' });
  const walker = scopeOf(report, 'walker');

  it('stands on a closed gimmick, and does not get past a closed gate', () => {
    expect(footholdAt(walker, 4, 4).status).toBe('reached');
    expect(footholdAt(walker, 10, 5).status).toBe('unreached');
  });

  it('makes no proofs where a wall could open', () => {
    expect(walker.proofs).toEqual({ region: false, height: false });
    expect(walker.riseBound).toBeNull();
    const far = footholdAt(walker, 10, 5);
    expect(far.blocker?.certainty).not.toBe('proven');
  });

  it('leaves pickups and event zones out', () => {
    // A column of water the walker cannot pass; an item and a zone that would grant swimming.
    const water = emptyRows(12, 6);
    fill(water, '#', 0, 11, 5);
    fill(water, '~', 7, 7, 0, 4);
    const base = roomRuntime({ rows: water, tileSize: T, spawn: [1, 4] });
    const fins: GimmickPlacement = {
      objectId: 3,
      type: 'pickup',
      rect: rect(3, 4, 1, 1),
      flag: 'obj:room:3',
      itemId: 'fins',
      count: 1,
    };
    for (const pack of [withRoom(base, [fins]), withRoom(base, [], true)]) {
      const scope = scopeOf(solveRoom(pack, { ...START, feelProfile: 'retro' }), 'walker');
      expect(footholdAt(scope, 3, 5).status).toBe('reached');
      expect(footholdAt(scope, 10, 5).status).toBe('unreached');
    }
  });
});
