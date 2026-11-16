import { type ReplayFile, roomGrid, runReplayHeadless } from '@retro-action-engine/core';
import { WALKER } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { FootholdIndex } from './footholds';
import { solveRoom } from './solve';
import { emptyRows, fill, roomRuntime, START } from './test-support';
import { replayFromHelds, verifyWitness, WitnessError } from './witness';

const rows = emptyRows(8, 6);
fill(rows, '#', 0, 7, 5);
fill(rows, '=', 4, 6, 3);
const runtime = roomRuntime({ rows, tileSize: 16, spawn: [1, 4] });
const start = { ...START, feelProfile: 'retro', party: ['walker'] };

/** Held mask of every tick of a replay. */
function heldsOf(replay: ReplayFile): number[] {
  return replay.frames.flatMap(([count, held]) => Array.from({ length: count }, () => held));
}

describe('verifyWitness: the gate every reached foothold passes', () => {
  const grid = roomGrid(runtime, 'room');
  const index = new FootholdIndex(grid, [WALKER]);
  const floor = index.at('walker', 5, 1);
  const shelf = index.at('walker', 3, 5);
  const report = solveRoom(runtime, start);
  const replayTo = (foothold: number): ReplayFile => {
    const id = index.all[foothold]?.id;
    const replay = report.scopes[0]?.footholds.find((f) => f.id === id)?.witness?.replay;
    if (replay === undefined) {
      throw new Error('fixture: the foothold should be reached');
    }
    return replay;
  };
  const toShelf = replayTo(shelf);
  const endOnShelf = runReplayHeadless(toShelf, runtime).world;
  const verify = (replay: ReplayFile, foothold: number, expected = endOnShelf) =>
    verifyWitness(runtime, grid, index, WALKER, replay, foothold, expected);

  it('accepts a replay that ends on the foothold in the expected state', () => {
    expect(floor).toBeGreaterThanOrEqual(0);
    expect(shelf).toBeGreaterThanOrEqual(0);
    expect(heldsOf(toShelf).length).toBeGreaterThan(0);
    expect(() => verify(toShelf, shelf)).not.toThrow();
  });

  it('rejects a replay that ends on another foothold', () => {
    expect(() => verify(toShelf, floor)).toThrow(WitnessError);
    expect(() => verify(replayTo(floor), shelf)).toThrow(/does not end on foothold/);
  });

  it('rejects a replay that stops before the landing', () => {
    const helds = heldsOf(toShelf);
    const cut = replayFromHelds(runtime, start, helds.slice(0, helds.length - 3));
    expect(() => verify(cut, shelf)).toThrow(WitnessError);
  });

  it('rejects a replay that ends on the foothold but in another state than the search saw', () => {
    // One more idle tick: still standing on the shelf, but the world is a tick older.
    const longer = replayFromHelds(runtime, start, [...heldsOf(toShelf), 0]);
    expect(() => verify(longer, shelf)).toThrow(/different state/);
  });

  it('builds replays with the press and release edges a device would produce', () => {
    const replay = replayFromHelds(runtime, start, heldsOf(toShelf));
    expect(replay).toEqual(toShelf);
    for (const [, held, pressed, released] of replay.frames) {
      expect(pressed & ~held).toBe(0);
      expect(released & held).toBe(0);
    }
  });
});
