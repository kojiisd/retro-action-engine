// The sword swing (ADR-0017). Expectations come from the fixture's animation and feel values,
// never fixed numbers (CLAUDE.md, ADR-0012). Frames and boxes here are fictional test data.
import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { fromPx } from '../fx/fx';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { script } from '../replay/script';
import type { AnimationDef, CharacterDef, PackRuntime } from '../runtime/pack';
import { boxRoom, MODERN, RETRO, simRuntime, WALKER } from '../test-support';
import { NEVER, type World } from '../world/world';
import { attackTicks } from './anim';
import { createWorld, type StepOutput, step } from './sim';

const box = (x: number, y: number, w: number, h: number) => ({
  x: fromPx(x),
  y: fromPx(y),
  w: fromPx(w),
  h: fromPx(h),
});

const SWING: AnimationDef = {
  frames: [
    { frame: 'wind', ticks: 3 },
    { frame: 'slash', ticks: 5, hitbox: box(4, -20, 12, 10) },
    { frame: 'rest', ticks: 4 },
  ],
  loop: false,
};
const LENGTH = 3 + 5 + 4;

const anims = (attack: boolean) => ({
  idle: { frames: [{ frame: 'idle', ticks: 1 }], loop: true },
  run: { frames: [{ frame: 'run', ticks: 1 }], loop: true },
  jump: { frames: [{ frame: 'jump', ticks: 1 }], loop: false },
  fall: { frames: [{ frame: 'fall', ticks: 1 }], loop: false },
  ...(attack ? { attack: SWING } : {}),
});
const fencer: CharacterDef = {
  ...WALKER,
  id: 'fencer',
  sprite: { atlas: 'a', animations: anims(true) },
};
const unarmed: CharacterDef = {
  ...WALKER,
  id: 'unarmed',
  sprite: { atlas: 'a', animations: anims(false) },
};

function runtimeWith(attackOnGround?: 'stop' | 'move', members = ['fencer']): PackRuntime {
  const base = simRuntime({ rows: boxRoom(20, 8), spawn: [5, 6], members });
  const feel = attackOnGround === undefined ? {} : { attackOnGround };
  return {
    ...base,
    characters: { fencer, unarmed },
    feel: { retro: { ...RETRO, ...feel }, modern: { ...MODERN, ...feel } },
  };
}

function start(runtime: PackRuntime, profile = 'retro'): World {
  return createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: profile });
}

const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]): StepOutput[] =>
  frames.map((frame) => step(world, frame, runtime));

const slotOf = (world: World) => world.entities.slotOf(world.party.entityId);
const frameOf = (out: StepOutput | undefined) => out?.render.sprites[0]?.frame;

describe('attack', () => {
  it('lasts the ticks of the attack animation, frame by frame', () => {
    expect(attackTicks(fencer)).toBe(LENGTH);
    expect(attackTicks(unarmed)).toBeUndefined();
    const runtime = runtimeWith();
    const world = start(runtime);
    const out = run(
      world,
      runtime,
      script()
        .hold('attack', 1)
        .build(LENGTH + 2),
    );
    const frames = out.map(frameOf);
    expect(frames.slice(0, LENGTH)).toEqual([
      ...Array(3).fill('wind'),
      ...Array(5).fill('slash'),
      ...Array(4).fill('rest'),
    ]);
    expect(frames[LENGTH]).toBe('idle');
  });

  it('roots the character on the ground: no walking, no jump, no turning', () => {
    const runtime = runtimeWith();
    const world = start(runtime);
    const s = world.entities;
    const slot = slotOf(world);
    run(world, runtime, script().hold('right', 20).build(20));
    expect(s.vx[slot]).toBeGreaterThan(0);
    // Swing while holding left and pressing jump: it stays put, faces right, and stays down.
    const x0 = s.x[slot];
    run(
      world,
      runtime,
      script()
        .hold('attack', 1)
        .hold('left', LENGTH - 1)
        .build(LENGTH - 1),
    );
    run(world, runtime, script().hold('jump', 1).build(1));
    expect(s.x[slot]).toBe(x0);
    expect(world.controller.facing).toBe(1);
    expect((s.contact[slot] as number) & CONTACT_GROUNDED).not.toBe(0);
    // Once it is over, the character moves again.
    run(world, runtime, script().hold('left', 10).build(10));
    expect(s.x[slot]).toBeLessThan(x0 as number);
    expect(world.controller.facing).toBe(-1);
  });

  it('keeps walking with "attackOnGround: move"', () => {
    const runtime = runtimeWith('move');
    const world = start(runtime);
    const s = world.entities;
    const slot = slotOf(world);
    const x0 = s.x[slot] as number;
    run(
      world,
      runtime,
      script().hold('right', LENGTH).press('attack', { at: 0, ticks: 1 }).build(LENGTH),
    );
    expect(s.x[slot]).toBeGreaterThan(x0);
    expect(world.tick < world.controller.attackUntilTick).toBe(false);
  });

  it('keeps the facing during a swing, even while walking the other way', () => {
    const runtime = runtimeWith('move');
    const world = start(runtime);
    const s = world.entities;
    const slot = slotOf(world);
    run(world, runtime, script().hold('right', 2).build(2));
    const x0 = s.x[slot] as number;
    run(
      world,
      runtime,
      script()
        .hold('attack', 1)
        .hold('left', LENGTH - 2)
        .build(LENGTH - 1),
    );
    expect(world.tick < world.controller.attackUntilTick).toBe(true);
    expect(world.controller.facing).toBe(1);
    expect(s.x[slot]).toBeLessThan(x0);
    // After the swing, the held direction turns the character.
    run(world, runtime, script().hold('left', 2).build(2));
    expect(world.controller.facing).toBe(-1);
  });

  it('keeps flying in the air: the same flight as without the swing', () => {
    const runtime = runtimeWith();
    for (const profile of ['retro', 'modern']) {
      const flight = (attack: boolean) => {
        const world = start(runtime, profile);
        const s = world.entities;
        const slot = slotOf(world);
        // Jump forward, then (or not) swing at once in the air.
        run(world, runtime, script().hold(['right', 'jump'], 3).build(3));
        run(
          world,
          runtime,
          script()
            .hold(attack ? ['right', 'attack'] : 'right', 1)
            .hold('right', 3)
            .build(4),
        );
        return { world, x: s.x[slot], y: s.y[slot], vx: s.vx[slot], grounded: s.contact[slot] };
      };
      const swing = flight(true);
      const plain = flight(false);
      expect(swing.world.tick < swing.world.controller.attackUntilTick).toBe(true);
      expect((swing.grounded as number) & CONTACT_GROUNDED).toBe(0);
      expect([swing.x, swing.y, swing.vx]).toEqual([plain.x, plain.y, plain.vx]);
    }
  });

  it('does nothing for a character without an attack animation', () => {
    const runtime = runtimeWith(undefined, ['unarmed']);
    const world = start(runtime);
    const out = run(world, runtime, script().hold('attack', 1).build(3));
    expect(world.controller.attackUntilTick).toBe(NEVER);
    expect(out.every((o) => o.render.hitboxes.length === 0)).toBe(true);
  });

  it('ignores presses during a swing, and starts the next one from frame 0', () => {
    const runtime = runtimeWith();
    const world = start(runtime);
    run(world, runtime, script().hold('attack', 1).build(1));
    const until = world.controller.attackUntilTick;
    run(world, runtime, script().wait(1).hold('attack', 1).build(3));
    expect(world.controller.attackUntilTick).toBe(until);
    // Run to the very end of the swing and press again at once.
    run(world, runtime, script().build(until - world.tick));
    const next = run(world, runtime, script().hold('attack', 1).build(1));
    expect(frameOf(next[0])).toBe('wind');
    expect(world.controller.attackUntilTick).toBe(world.tick - 1 + LENGTH);
  });

  it('puts the hitbox out on its frame only, mirrored when facing left', () => {
    const runtime = runtimeWith();
    const world = start(runtime);
    const s = world.entities;
    const slot = slotOf(world);
    const feetX = (s.x[slot] as number) >> 8;
    const feetY = (s.y[slot] as number) >> 8;
    const out = run(world, runtime, script().hold('attack', 1).build(LENGTH));
    const boxes = out.map((o) => o.render.hitboxes);
    expect(boxes.slice(0, 3).every((b) => b.length === 0)).toBe(true);
    expect(boxes.slice(8).every((b) => b.length === 0)).toBe(true);
    expect(boxes[3]).toEqual([
      { id: world.party.entityId, x: feetX + 4, y: feetY - 20, w: 12, h: 10 },
    ]);
    // Facing left: the same box on the other side.
    run(world, runtime, script().hold('left', 1).build(1));
    // Facing left, the box spans -(x + w) .. -x from the feet, with the same floor rule.
    const bl = (s.x[slot] as number) - fromPx(4 + 12);
    const left = run(world, runtime, script().hold('attack', 1).build(4));
    expect(left[3]?.render.hitboxes[0]).toMatchObject({
      x: bl >> 8,
      w: ((bl + fromPx(12) - 1) >> 8) - (bl >> 8) + 1,
    });
    // Hitboxes are drawing data only: the hash ignores them.
    expect(left[3]?.render.hitboxes).toHaveLength(1);
  });

  it('stops when the party switches', () => {
    const runtime = runtimeWith(undefined, ['fencer', 'unarmed']);
    const world = start(runtime);
    run(world, runtime, script().hold('attack', 1).build(2));
    expect(world.tick < world.controller.attackUntilTick).toBe(true);
    run(world, runtime, script().hold('switch', 1).build(1));
    expect(world.controller.attackUntilTick).toBe(NEVER);
  });

  it('gives the same hashes for the same run', () => {
    const runtime = runtimeWith();
    const frames = script()
      .hold('right', 10)
      .hold('attack', 1)
      .wait(20)
      .hold(['jump', 'right'], 8)
      .hold('attack', 1)
      .wait(40)
      .build();
    const hashes = () => {
      const world = start(runtime);
      return frames.map((frame) => {
        step(world, frame, runtime);
        return hashWorld(world).join(':');
      });
    };
    expect(hashes()).toEqual(hashes());
  });
});
