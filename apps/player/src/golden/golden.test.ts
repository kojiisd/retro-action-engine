import { fromPx, runReplayHeadless } from '@retro-action-engine/core';
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
  it.each(PROFILES)('%s: ends with the swimmer past the water column', (profile) => {
    const { world } = runReplayHeadless(representativeReplay(runtime, profile), runtime);
    const room = runtime.rooms[world.roomId];
    if (room === undefined) throw new Error('no room');
    const swim = room.tileClasses.find((c) => c.requiresAnyTag?.includes('move:swim'));
    const cols = [...room.collision.keys()]
      .filter((i) => room.collision[i] === swim?.id)
      .map((i) => i % room.widthTiles);
    const waterRight = fromPx((Math.max(...cols) + 1) * runtime.tileSize);
    const slot = world.entities.slotOf(world.party.entityId);
    expect(world.party.members[world.party.activeIndex]).toBe('diver');
    expect(world.entities.x[slot]).toBeGreaterThan(waterRight);
  });
});
