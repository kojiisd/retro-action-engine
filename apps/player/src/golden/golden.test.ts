import { runReplayHeadless } from '@retro-action-engine/core';
import type { LoadedRuntime } from '@retro-action-engine/pack';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSamplePack } from '../test-support';
import { representativeReplay } from './replays';

// Golden (ADR-0012): the end hash of the representative replay, one per feel profile of the
// sample pack. Update with `pnpm golden:update` only together with a feel / rules / physics /
// system order change, and say which in the PR (CLAUDE.md).
const PROFILES = ['retro', 'modern'] as const;

describe('golden: sample pack representative replay', () => {
  let runtime: LoadedRuntime;

  beforeAll(async () => {
    runtime = await loadSamplePack();
  });

  it.each(PROFILES)('%s: the end hash is unchanged', (profile) => {
    const result = runReplayHeadless(representativeReplay(runtime, profile), runtime);
    expect({ tick: result.tick, hash: result.hash }).toMatchSnapshot();
  });

  // Not golden: checks that the replay still covers what it is meant to cover, so that a pack
  // change cannot silently turn it into a replay of standing still.
  it.each(PROFILES)('%s: ends with the swimmer in the next room, past the edge', (profile) => {
    const entry = runtime.entry as { roomId: string };
    const edge = runtime.rooms[entry.roomId]?.exits?.find((e) => e.kind === 'edge');
    if (edge === undefined) throw new Error('no edge exit in the entry room');
    const { world } = runReplayHeadless(representativeReplay(runtime, profile), runtime);
    // Getting to the east edge takes crossing the water column first.
    expect(world.roomId).toBe(edge.toRoomId);
    expect(world.transition.phase).toBe('none');
    expect(world.party.members[world.party.activeIndex]).toBe('diver');
    const slot = world.entities.slotOf(world.party.entityId);
    const spawn = runtime.rooms[edge.toRoomId]?.spawns[edge.spawnId];
    expect(world.entities.x[slot]).toBeGreaterThan(spawn?.x as number);
  });
});
