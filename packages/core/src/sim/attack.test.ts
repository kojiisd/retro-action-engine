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

  it('roots the character on the ground with "attackOnGround: stop": no walking, no jump, no turning', () => {
    const runtime = runtimeWith('stop');
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

  it('keeps walking and jumping by default and with "attackOnGround: move"', () => {
    for (const setting of [undefined, 'move'] as const) {
      const runtime = runtimeWith(setting);
      const world = start(runtime);
      const s = world.entities;
      const slot = slotOf(world);
      const x0 = s.x[slot] as number;
      run(world, runtime, script().hold(['right', 'attack'], 1).hold('right', 4).build(5));
      expect(world.tick < world.controller.attackUntilTick).toBe(true);
      expect(s.x[slot]).toBeGreaterThan(x0);
      // A jump in the middle of the swing leaves the ground.
      run(world, runtime, script().hold('jump', 2).build(2));
      expect(world.tick < world.controller.attackUntilTick).toBe(true);
      expect((s.contact[slot] as number) & CONTACT_GROUNDED).toBe(0);
    }
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

describe('attack buffer (M3-2c)', () => {
  // Fictional values: the buffer is a little under half the swing.
  const BUFFER = 5;
  const buffered = (members = ['fencer'], buffer = BUFFER): PackRuntime => {
    const base = runtimeWith(undefined, members);
    return {
      ...base,
      // A second swordsman, so a switch lands on a character who can swing too.
      characters: { ...base.characters, second: { ...fencer, id: 'second' } },
      feel: {
        retro: { ...(base.feel.retro as typeof RETRO), attackBufferTicks: buffer },
        modern: { ...(base.feel.modern as typeof MODERN), attackBufferTicks: buffer },
      },
    };
  };
  const SWING_FRAMES = [
    ...Array(3).fill('wind'),
    ...Array(5).fill('slash'),
    ...Array(4).fill('rest'),
  ];

  for (const profile of ['retro', 'modern']) {
    it(`${profile}: mashing swings without a break, each one from frame 0`, () => {
      const runtime = buffered();
      const world = start(runtime, profile);
      const swings = 4;
      // One press every BUFFER ticks: every swing's last BUFFER + 1 ticks hold one.
      const input = script().wait(swings * LENGTH);
      for (let at = 0; at < (swings - 1) * LENGTH + 1; at += BUFFER) input.tap('attack', { at });
      const out = run(world, runtime, input.build(swings * LENGTH + 1));
      const frames = out.map(frameOf);
      expect(frames.slice(0, swings * LENGTH)).toEqual(
        Array.from({ length: swings }, () => SWING_FRAMES).flat(),
      );
      expect(frames[swings * LENGTH]).toBe('idle');
    });
  }

  it('holding the button swings once only', () => {
    const runtime = buffered();
    const world = start(runtime);
    const frames = run(
      world,
      runtime,
      script()
        .hold('attack', 3 * LENGTH)
        .build(3 * LENGTH),
    ).map(frameOf);
    expect(frames.slice(0, LENGTH)).toEqual(SWING_FRAMES);
    expect(frames.slice(LENGTH).every((f) => f === 'idle')).toBe(true);
  });

  it('a press exactly BUFFER ticks before the end starts the next swing at the end; one tick earlier does not', () => {
    for (const [before, next] of [
      [BUFFER, true],
      [BUFFER + 1, false],
    ] as const) {
      const runtime = buffered();
      const world = start(runtime);
      const out = run(
        world,
        runtime,
        script()
          .tap('attack', { at: 0 })
          .tap('attack', { at: LENGTH - before })
          .build(LENGTH + 1),
      );
      expect(frameOf(out[LENGTH - 1])).toBe('rest');
      expect(frameOf(out[LENGTH])).toBe(next ? 'wind' : 'idle');
      expect(world.controller.attackUntilTick).toBe(next ? 2 * LENGTH : LENGTH);
    }
  });

  it('without a buffer only a press in the same tick counts (as before M3-2c)', () => {
    const runtime = runtimeWith();
    const world = start(runtime);
    const out = run(
      world,
      runtime,
      script()
        .tap('attack', { at: 0 })
        .tap('attack', { at: LENGTH - 1 })
        .build(LENGTH + 1),
    );
    expect(frameOf(out[LENGTH])).toBe('idle');
    expect(world.controller.attackPressedTick).toBe(NEVER);
  });

  it('forgets a remembered press when the party switches', () => {
    const runtime = buffered(['fencer', 'second']);
    const world = start(runtime);
    run(
      world,
      runtime,
      script()
        .tap('attack', { at: 0 })
        .build(LENGTH - 2),
    );
    run(world, runtime, script().hold('attack', 1).build(1));
    expect(world.controller.attackPressedTick).toBe(world.tick - 1);
    run(world, runtime, script().hold('switch', 1).build(1));
    expect(world.controller.attackUntilTick).toBe(NEVER);
    expect(world.controller.attackPressedTick).toBe(NEVER);
    // The new member does not swing from it either.
    const after = run(world, runtime, script().build(LENGTH));
    expect(after.every((o) => frameOf(o) !== 'wind')).toBe(true);
  });

  it('one press is one swing, even with a buffer longer than the swing', () => {
    const runtime = buffered(['fencer'], LENGTH + 2);
    const world = start(runtime);
    const frames = run(
      world,
      runtime,
      script()
        .tap('attack', { at: 0 })
        .build(3 * LENGTH),
    ).map(frameOf);
    expect(frames.slice(0, LENGTH)).toEqual(SWING_FRAMES);
    expect(frames.slice(LENGTH).every((f) => f === 'idle')).toBe(true);
  });

  it('gives the same hashes for the same mashing', () => {
    const runtime = buffered();
    const input = script().hold('right', 60);
    for (let at = 0; at < 60; at += 3) input.tap('attack', { at });
    const frames = input.build(60);
    const hashes = () => {
      const world = start(runtime, 'modern');
      return frames.map((frame) => {
        step(world, frame, runtime);
        return hashWorld(world);
      });
    };
    expect(hashes()).toEqual(hashes());
  });
});
