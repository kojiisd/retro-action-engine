import { actionMask, createWorld } from '@retro-action-engine/core';
import { MODERN, RETRO } from '@retro-action-engine/core/testing';
import { describe, expect, it } from 'vitest';
import { edgeMacros, groundMacros, jumpHolds, runMacro, type Sim } from './macros';
import { emptyRows, fill, roomRuntime, START } from './test-support';

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

describe('runMacro: switch', () => {
  const rows = emptyRows(8, 4);
  fill(rows, '#', 0, 7, 3);
  const SWITCH = actionMask('switch');
  const simOf = (members: string[], cooldownTicks: number): Sim => {
    const runtime = roomRuntime({
      rows,
      tileSize: 16,
      spawn: [3, 2],
      members,
      switching: { cooldownTicks },
    });
    const world = createWorld(runtime, { ...START, feelProfile: 'retro' });
    return {
      world,
      runtime,
      held: 0,
      helds: [],
      budget: { steps: 0, maxSteps: 10_000, exhausted: false },
      maxTicks: 600,
    };
  };

  it('waits for the cooldown, presses once, and lands with the next member active', () => {
    const sim = simOf(['walker', 'swimmer'], 7);
    sim.world.party.cooldownTicks = 7;
    expect(runMacro(sim, { kind: 'switch' }, () => 0)).toEqual({
      status: 'landed',
      leftGround: false,
    });
    expect(sim.world.party.activeIndex).toBe(1);
    expect(sim.helds.filter((held) => held === SWITCH)).toHaveLength(1);
    expect(sim.helds.indexOf(SWITCH)).toBe(7);
  });

  it('lets go of a switch button still held from before', () => {
    const sim = simOf(['walker', 'swimmer'], 0);
    sim.held = SWITCH;
    runMacro(sim, { kind: 'switch' }, () => 0);
    expect(sim.helds).toEqual([0, SWITCH]);
    expect(sim.world.party.activeIndex).toBe(1);
  });

  it('is skipped when the rules refuse the switch', () => {
    const sim = simOf(['walker'], 0);
    expect(runMacro(sim, { kind: 'switch' }, () => 0)).toEqual({ status: 'skipped' });
  });

  it('is only listed when the party can switch', () => {
    expect(groundMacros(RETRO, [1]).some((macro) => macro.kind === 'switch')).toBe(false);
    expect(groundMacros(RETRO, [1], true).at(-1)).toEqual({ kind: 'switch' });
  });
});
