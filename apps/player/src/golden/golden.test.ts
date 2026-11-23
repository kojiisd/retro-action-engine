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
  it.each(PROFILES)(
    '%s: ends with the swimmer past the first water, the view scrolled',
    (profile) => {
      const entry = runtime.entry as { roomId: string };
      const room = runtime.rooms[entry.roomId];
      if (room === undefined) throw new Error('no entry room');
      const water = room.tileClasses.find((c) => c.hazard !== undefined);
      const firstWaterCol = Math.min(
        ...[...room.collision.keys()]
          .filter((i) => room.collision[i] === water?.id)
          .map((i) => i % room.widthTiles),
      );
      const { world } = runReplayHeadless(representativeReplay(runtime, profile), runtime);
      expect(world.roomId).toBe(entry.roomId);
      expect(world.party.members[world.party.activeIndex]).toBe('diver');
      const slot = world.entities.slotOf(world.party.entityId);
      // Past the first pool (it is a few tiles wide), and the camera has moved right (M3-2).
      expect((world.entities.x[slot] as number) >> 8).toBeGreaterThan(
        (firstWaterCol + 4) * runtime.tileSize,
      );
      expect(world.camera.x).toBeGreaterThan(0);
    },
  );
});
