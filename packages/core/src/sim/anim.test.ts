// Animation Feel scenarios (M1-5): the sprite follows the movement state, frames advance by
// ticks from the data, and the render snapshot never feeds back into the World.
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { script } from '../replay/script';
import type { AnimationDef, CharacterDef, PackRuntime } from '../runtime/pack';
import { boxRoom, SWIMMER, simRuntime, WALKER } from '../test-support';
import { cloneWorld } from '../world/world';
import type { RenderSprite } from './output';
import { createWorld, step } from './sim';

const anim = (prefix: string, ticks: readonly number[], loop = true): AnimationDef => ({
  frames: ticks.map((t, i) => ({ frame: `${prefix}-${i}`, ticks: t })),
  loop,
});

/** A test sprite: two idle frames, four run frames, single jump and fall frames. */
const SPRITE = {
  atlas: 'chars',
  animations: {
    idle: anim('idle', [30, 30]),
    run: anim('run', [6, 6, 6, 6]),
    jump: anim('jump', [1], false),
    fall: anim('fall', [1], false),
  },
};
const SPRITED: CharacterDef = { ...WALKER, sprite: SPRITE };

function runtimeWith(walker: CharacterDef, members = ['walker']): PackRuntime {
  const base = simRuntime({ rows: boxRoom(16, 8), spawn: [4, 6], members });
  return { ...base, characters: { ...base.characters, walker } };
}

/** The sprite after each tick. */
function sprites(runtime: PackRuntime, frames: readonly InputFrame[], profile = 'retro') {
  const world = createWorld(runtime, {
    roomId: 'room',
    spawnId: 'start',
    seed: 1,
    feelProfile: profile,
  });
  return frames.map((frame) => step(world, frame, runtime).render.sprites[0] as RenderSprite);
}

describe('animation: the sprite follows the movement state', () => {
  for (const profile of ['retro', 'modern']) {
    it(`${profile}: idle while standing, run while moving, facing follows the direction`, () => {
      const frames = script().wait(10).hold('right', 30).hold('left', 30).wait(60).build();
      const out = sprites(runtimeWith(SPRITED), frames, profile);
      expect(out[5]?.frame).toMatch(/^idle-/);
      expect(out[25]?.frame).toMatch(/^run-/);
      expect(out[25]?.flipX).toBe(false);
      expect(out[55]?.frame).toMatch(/^run-/);
      expect(out[55]?.flipX).toBe(true);
      // Stopped again: idle, still facing left.
      expect(out.at(-1)?.frame).toMatch(/^idle-/);
      expect(out.at(-1)?.flipX).toBe(true);
    });

    it(`${profile}: jump while rising, fall after the apex, idle after landing`, () => {
      const frames = script().wait(5).hold('jump', 40).wait(80).build();
      const runtime = runtimeWith(SPRITED);
      const world = createWorld(runtime, {
        roomId: 'room',
        spawnId: 'start',
        seed: 1,
        feelProfile: profile,
      });
      const seen: Array<{ frame: string; vy: number }> = [];
      for (const frame of frames) {
        const sprite = step(world, frame, runtime).render.sprites[0] as RenderSprite;
        seen.push({ frame: sprite.frame, vy: world.entities.vy[0] as number });
      }
      const rising = seen.filter((s) => s.frame === 'jump-0');
      const falling = seen.filter((s) => s.frame === 'fall-0');
      expect(rising.length).toBeGreaterThan(0);
      expect(falling.length).toBeGreaterThan(0);
      expect(rising.every((s) => s.vy < 0)).toBe(true);
      expect(falling.every((s) => s.vy >= 0)).toBe(true);
      expect(seen.at(-1)?.frame).toMatch(/^idle-/);
    });
  }

  it('advances frames by the ticks in the data and loops', () => {
    const out = sprites(runtimeWith(SPRITED), script().wait(100).build());
    // The first tick picks the animation; frame 0 is shown for 30 ticks, then frame 1, then back.
    expect(out[0]?.frame).toBe('idle-0');
    expect(out[29]?.frame).toBe('idle-0');
    expect(out[30]?.frame).toBe('idle-1');
    expect(out[59]?.frame).toBe('idle-1');
    expect(out[60]?.frame).toBe('idle-0');
    // Each frame is shown for exactly its ticks.
    const runs = out.reduce<Array<[string, number]>>((acc, sprite) => {
      const last = acc.at(-1);
      if (last !== undefined && last[0] === sprite.frame) last[1]++;
      else acc.push([sprite.frame, 1]);
      return acc;
    }, []);
    expect(runs.slice(0, 3)).toEqual([
      ['idle-0', 30],
      ['idle-1', 30],
      ['idle-0', 30],
    ]);
  });

  it('a non-looping animation stays on its last frame', () => {
    const once = {
      ...SPRITED,
      sprite: {
        ...SPRITE,
        animations: { ...SPRITE.animations, idle: anim('idle', [2, 2], false) },
      },
    };
    const out = sprites(runtimeWith(once), script().wait(20).build());
    expect(out.slice(0, 2).map((s) => s.frame)).toEqual(['idle-0', 'idle-0']);
    expect(out.slice(2).every((s) => s.frame === 'idle-1')).toBe(true);
  });

  it('a missing animation shows idle; no sprite means nothing to draw', () => {
    const idleOnly = {
      ...WALKER,
      sprite: { atlas: 'chars', animations: { idle: anim('idle', [5]) } },
    };
    const idleRuntime = runtimeWith(idleOnly);
    const moving = createWorld(idleRuntime, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    for (const frame of script().hold('right', 20).build()) {
      const sprite = step(moving, frame, idleRuntime).render.sprites[0] as RenderSprite;
      expect(sprite.frame).toBe('idle-0');
      // The World records the animation actually shown, also while running.
      expect(moving.animation.name).toBe('idle');
    }
    const world = createWorld(runtimeWith(WALKER), {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    expect(
      step(world, { held: 0, pressed: 0, released: 0 }, runtimeWith(WALKER)).render.sprites,
    ).toEqual([]);
  });

  it('switching to a character with other animations starts over in range', () => {
    const swimmer = {
      ...SWIMMER,
      sprite: { atlas: 'chars', animations: { idle: anim('swim-idle', [3]) } },
    };
    const base = runtimeWith(SPRITED, ['walker', 'swimmer']);
    const runtime = { ...base, characters: { ...base.characters, swimmer } };
    const frames = script().wait(40).tap('switch').wait(5).build();
    const out = sprites(runtime, frames);
    expect(out[35]?.frame).toBe('idle-1');
    expect(out.at(-1)?.frame).toBe('swim-idle-0');
  });

  it('reports the bottom-center position in whole px', () => {
    const runtime = runtimeWith(SPRITED);
    const world = createWorld(runtime, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'modern',
    });
    for (const frame of script().hold('right', 7).build()) {
      const sprite = step(world, frame, runtime).render.sprites[0] as RenderSprite;
      expect(sprite.x).toBe(Math.floor((world.entities.x[0] as number) / 256));
      expect(sprite.y).toBe(Math.floor((world.entities.y[0] as number) / 256));
      expect(Number.isInteger(sprite.x)).toBe(true);
    }
  });
});

describe('render snapshot: no way back into the World', () => {
  it('changing a snapshot changes neither the hash nor the next tick', () => {
    const runtime = runtimeWith(SPRITED);
    const frames = script().hold('right', 20).tap('jump', { at: 8 }).wait(10).build();
    const world = createWorld(runtime, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    const control = cloneWorld(world);
    for (const frame of frames) {
      const out = step(world, frame, runtime);
      step(control, frame, runtime);
      const before = hashWorld(world);
      // A renderer that writes into what it was given.
      const sprite = out.render.sprites[0] as unknown as Record<string, unknown>;
      sprite.x = 999;
      sprite.frame = 'tampered';
      (out.render.sprites as unknown as unknown[]).length = 0;
      (out.render.camera as { x: number }).x = 50;
      expect(hashWorld(world)).toEqual(before);
      expect(hashWorld(world)).toEqual(hashWorld(control));
    }
    // And the next snapshot is built fresh.
    const next = step(world, { held: 0, pressed: 0, released: 0 }, runtime).render;
    expect(next.camera).toEqual({ x: 0, y: 0 });
    expect(next.sprites).toHaveLength(1);
  });

  it('the animation state is part of the hash', () => {
    const runtime = runtimeWith(SPRITED);
    const world = createWorld(runtime, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    step(world, { held: 0, pressed: 0, released: 0 }, runtime);
    const other = cloneWorld(world);
    other.animation.ticks++;
    expect(hashWorld(other)).not.toEqual(hashWorld(world));
  });
});
