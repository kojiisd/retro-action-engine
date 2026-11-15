import { MODERN, RETRO } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { edgeMacros, groundMacros, jumpHolds } from './macros';

describe('jumpHolds', () => {
  it('needs one hold when the profile has no variable jump', () => {
    expect(jumpHolds(RETRO, 18, 4)).toEqual([1]);
  });

  it('spreads the holds from the shortest effective one to the full rise', () => {
    const holds = jumpHolds(MODERN, 25, 4);
    expect(holds).toEqual([4, 11, 18, 25]);
    expect(holds[0]).toBe(MODERN.minJumpTicks);
  });

  it('always includes the full rise, whatever the sample count', () => {
    for (const samples of [0, 1, 2, 3, 7, 100]) {
      const holds = jumpHolds(MODERN, 25, samples);
      expect(holds.at(-1)).toBe(25);
      expect(holds).toEqual([...new Set(holds)].sort((a, b) => a - b));
    }
    // A rise shorter than the minimum hold still gives one hold.
    expect(jumpHolds(MODERN, 2, 4)).toEqual([MODERN.minJumpTicks]);
  });
});

describe('macro lists', () => {
  it('tries a change of direction at the apex only when the air is steerable', () => {
    const jumps = (profile: typeof RETRO) =>
      groundMacros(profile, [1]).filter((macro) => macro.kind === 'jump');
    expect(jumps(RETRO)).toHaveLength(3);
    expect(jumps(MODERN)).toHaveLength(9);
  });

  it('tries a jump on every tick of the coyote window', () => {
    const delays = (profile: typeof RETRO) => [
      ...new Set(
        edgeMacros(profile, [1], 1).flatMap((macro) =>
          macro.kind === 'walkOffJump' ? [macro.delay] : [],
        ),
      ),
    ];
    expect(delays(RETRO)).toEqual([0]);
    expect(delays(MODERN)).toEqual(Array.from({ length: MODERN.coyoteTicks + 1 }, (_, i) => i));
  });

  it('lists macros in the same order every time', () => {
    expect(groundMacros(MODERN, [4, 25])).toEqual(groundMacros(MODERN, [4, 25]));
    expect(edgeMacros(MODERN, [4, 25], -1)).toEqual(edgeMacros(MODERN, [4, 25], -1));
  });
});
