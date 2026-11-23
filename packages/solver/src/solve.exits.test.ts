// A room with exits (ADR-0018): the solver explores that one room and never follows an exit, so
// the report is the same as for the room without them.
import { FX_ONE, type PackRuntime, type RoomData } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';

const T = 16;

describe('solveRoom with exits', () => {
  const rows = emptyRows(12, 6);
  fill(rows, '#', 0, 11, 5);
  fill(rows, '=', 6, 8, 3);
  const plain = roomRuntime({ rows, tileSize: T, spawn: [2, 4], members: ['walker'] });
  const room = plain.rooms.room as RoomData;
  // A warp under the start and over the whole floor, to another room: following it would end
  // the search there.
  const withExits: PackRuntime = {
    ...plain,
    rooms: {
      room: {
        ...room,
        spawns: { ...room.spawns, away: { x: 2 * T * FX_ONE, y: 5 * T * FX_ONE } },
        exits: [
          {
            kind: 'warp',
            rect: { x: 0, y: 4 * T * FX_ONE, w: 12 * T * FX_ONE, h: T * FX_ONE },
            toRoomId: 'other',
            spawnId: 'away',
            effect: 'cut',
          },
        ],
      },
      other: {
        ...room,
        id: 'other',
        spawns: { away: room.spawns.start as RoomData['spawns'][string] },
      },
    },
    roomTransition: { effect: 'fade', lockTicks: 20 },
  };

  it('gives the same report as the room without its exits', () => {
    const start = { ...START, feelProfile: 'retro' };
    // No clock is passed, so the report has no time in it and compares as a whole.
    expect(JSON.stringify(solveRoom(withExits, start))).toBe(
      JSON.stringify(solveRoom(plain, start)),
    );
  });
});
