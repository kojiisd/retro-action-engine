import { describe, expect, it } from 'vitest';
import { type InputFrame, mirrorFrame } from '../input/frame';
import { script } from '../replay/script';
import type { FeelProfile } from '../runtime/feel';
import { MODERN } from '../test-support';
import { newWorld } from '../world/world';
import { inputIntent } from './intent';

function moveDirs(socd: FeelProfile['socd'], frames: readonly InputFrame[]): number[] {
  const world = newWorld({ seed: 1, roomId: 'room' });
  const feel: FeelProfile = { ...MODERN, socd };
  return frames.map((frame) => {
    const dir = inputIntent(world, frame, feel).moveDir;
    world.tick++;
    return dir;
  });
}

// right from tick 0, left added at tick 2 (both held on 2..3), right alone again on 4.
const overlap = script()
  .press('right', { at: 0, ticks: 5 })
  .press('left', { at: 2, ticks: 2 })
  .build();

describe('inputIntent: SOCD', () => {
  it('neutral stops while both are held', () => {
    expect(moveDirs('neutral', overlap)).toEqual([1, 1, 0, 0, 1, 0]);
  });

  it('lastWins follows the later press', () => {
    expect(moveDirs('lastWins', overlap)).toEqual([1, 1, -1, -1, 1, 0]);
  });

  it('lastWins treats presses in the same tick as neutral', () => {
    const both = script().hold(['left', 'right'], 2).build();
    expect(moveDirs('lastWins', both)).toEqual([0, 0, 0]);
  });

  it('leftWins prefers left', () => {
    expect(moveDirs('leftWins', overlap)).toEqual([1, 1, -1, -1, 1, 0]);
    expect(moveDirs('leftWins', overlap.map(mirrorFrame))).toEqual([-1, -1, -1, -1, -1, 0]);
  });

  it('neutral and lastWins are mirror-symmetric', () => {
    for (const socd of ['neutral', 'lastWins'] as const) {
      expect(moveDirs(socd, overlap.map(mirrorFrame))).toEqual(
        moveDirs(socd, overlap).map((d) => -d || 0),
      );
    }
  });
});
