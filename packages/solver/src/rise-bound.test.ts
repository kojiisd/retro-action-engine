import {
  actionMask,
  CONTACT_GROUNDED,
  createWorld,
  FX_ONE,
  type InputFrame,
  type PackRuntime,
  step,
} from '@retro-action-engine/core';
import { type FeelInPx, MODERN_PX, RETRO_PX, WALKER } from '@retro-action-engine/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { measureRise, measureRiseBound } from './probe';
import { emptyRows, fill, roomRuntime, START } from './test-support';

const JUMP = actionMask('jump');
const OPEN = { rows: ['...', '###'], tileSize: 16, spawn: [1, 0] as const };
const boundOf = (feel: Partial<FeelInPx>, profile = 'modern') =>
  measureRiseBound(roomRuntime({ ...OPEN, feel }), WALKER, profile);
const fullHoldOf = (feel: Partial<FeelInPx>, profile = 'modern') =>
  measureRise(roomRuntime({ ...OPEN, feel }), WALKER, profile).height;

/** A tall room with nothing but a floor. */
function tallRoom(feel: Partial<FeelInPx>): PackRuntime {
  const rows = emptyRows(6, 40);
  fill(rows, '#', 0, 5, 39);
  return roomRuntime({ rows, tileSize: 16, spawn: [3, 38], feel });
}

/** Highest point of the feet above the start while playing these frames, then idling. */
function riseOf(runtime: PackRuntime, frames: readonly InputFrame[], ticks = 600): number {
  const world = createWorld(runtime, { ...START, feelProfile: 'modern' });
  const s = world.entities;
  const startY = s.y[0] as number;
  let minY = startY;
  for (let t = 0; t < ticks; t++) {
    step(world, frames[t] ?? { held: 0, pressed: 0, released: 0 }, runtime);
    minY = Math.min(minY, s.y[0] as number);
  }
  return startY - minY;
}

/** Jump pressed on the first tick and held for `hold` ticks, as a device would send it. */
function holdFrames(hold: number): InputFrame[] {
  return Array.from({ length: hold + 1 }, (_, t) => ({
    held: t < hold ? JUMP : 0,
    pressed: t === 0 ? JUMP : 0,
    released: t === hold ? JUMP : 0,
  }));
}

describe('measureRiseBound', () => {
  it('equals the full-hold rise when a cut cannot help', () => {
    expect(boundOf({}, 'retro')).toBe(fullHoldOf({}, 'retro'));
    expect(boundOf({}, 'modern')).toBe(fullHoldOf({}, 'modern'));
    // No variable jump at all: the closed form of solve.test.ts.
    expect(boundOf({}, 'retro') / FX_ONE).toBe(38.25);
    expect(RETRO_PX.jumpCutScale).toBe(1);
  });

  it('is never below the full-hold rise', () => {
    for (const jumpCutScale of [0, 0.4, 0.9, 1, 1.5]) {
      for (const apexGravityScale of [0.1, 0.6, 1, 2]) {
        const feel = { jumpCutScale, apexGravityScale, apexThreshold: 1 };
        expect(boundOf(feel)).toBeGreaterThanOrEqual(fullHoldOf(feel));
      }
    }
  });

  // With a weak gravity near the apex, letting go early can slow the body into that range a
  // tick sooner than gravity alone would, and the jump ends up higher than with a full hold.
  const earlyRelease = {
    jumpCutScale: 0.95,
    minJumpTicks: 0,
    apexThreshold: 1,
    apexGravityScale: 0.1,
  };

  it('is above the full-hold rise when an early release goes higher, and that release reaches it', () => {
    const bound = boundOf(earlyRelease);
    expect(bound).toBeGreaterThan(fullHoldOf(earlyRelease));
    const runtime = tallRoom(earlyRelease);
    const rises = Array.from({ length: 60 }, (_, i) => riseOf(runtime, holdFrames(i + 1)));
    // Some hold length reaches the bound exactly, and none goes above it.
    expect(Math.max(...rises)).toBe(bound);
    expect(riseOf(runtime, holdFrames(599))).toBe(fullHoldOf(earlyRelease));
    expect(riseOf(runtime, holdFrames(599))).toBeLessThan(bound);
  });

  it('covers a jump that starts with the button already up (a buffered press)', () => {
    // Here the highest jump is the one cut on its very first tick.
    const feel = { ...earlyRelease, apexThreshold: 2, jumpVelocity: 2.1 };
    const bound = boundOf(feel);
    const runtime = tallRoom(feel);
    const held = Array.from({ length: 60 }, (_, i) => riseOf(runtime, holdFrames(i + 1)));
    expect(Math.max(...held)).toBeLessThan(bound);

    // Jump, press again shortly before landing and let go: the buffer starts the next jump on
    // the landing tick, with the button up.
    expect(MODERN_PX.jumpBufferTicks).toBeGreaterThanOrEqual(2);
    const world = createWorld(runtime, { ...START, feelProfile: 'modern' });
    const s = world.entities;
    const startY = s.y[0] as number;
    const idle: InputFrame = { held: 0, pressed: 0, released: 0 };
    for (const frame of holdFrames(1)) step(world, frame, runtime);
    // Find the landing tick on a copy of the inputs, then replay with the buffered press.
    let airTicks = 2;
    while (((s.contact[0] as number) & CONTACT_GROUNDED) === 0) {
      step(world, idle, runtime);
      airTicks++;
    }
    const frames: InputFrame[] = [
      ...holdFrames(1),
      ...Array.from({ length: airTicks - 2 - 2 }, () => idle),
      { held: JUMP, pressed: JUMP, released: 0 },
      { held: 0, pressed: 0, released: JUMP },
    ];
    const first = riseOf(runtime, holdFrames(1));
    const both = riseOf(runtime, frames);
    expect(both).toBeGreaterThan(first);
    expect(both).toBe(bound);
    expect(startY).toBeGreaterThan(0);
  });

  it('gives no bound when the body could rise without a jump', () => {
    expect(boundOf({ gravity: -0.1 })).toBe(Number.POSITIVE_INFINITY);
    expect(boundOf({ fallGravityScale: -1 })).toBe(Number.POSITIVE_INFINITY);
    expect(boundOf({ apexGravityScale: -1 })).toBe(Number.POSITIVE_INFINITY);
    expect(boundOf({ maxFallSpeed: -1 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('gives no bound when nothing ends the rise', () => {
    expect(boundOf({ gravity: 0 })).toBe(Number.POSITIVE_INFINITY);
    // Gravity vanishes near the apex, so the body never stops.
    expect(boundOf({ apexGravityScale: 0, apexThreshold: 1 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the feel overrides of the character', () => {
    const runtime = roomRuntime(OPEN);
    const light = { ...WALKER, feelOverrides: { gravity: Math.round(0.125 * FX_ONE) } };
    expect(measureRiseBound(runtime, light, 'retro')).toBeGreaterThan(
      measureRiseBound(runtime, WALKER, 'retro'),
    );
  });

  it('rejects an unknown profile', () => {
    expect(() => measureRiseBound(roomRuntime(OPEN), WALKER, 'nope')).toThrow(RangeError);
  });
});

describe('measureRiseBound: no input sequence goes higher', () => {
  // A room with platforms, a oneway shelf, ceilings and a pillar, so that coyote jumps, head
  // bumps, drop-throughs and wall contacts all happen.
  const rows = emptyRows(30, 30);
  fill(rows, '#', 0, 29, 29);
  fill(rows, '#', 3, 8, 25);
  fill(rows, '=', 10, 16, 22);
  fill(rows, '#', 12, 20, 16);
  fill(rows, '#', 22, 23, 20, 28);
  fill(rows, '=', 24, 29, 24);
  fill(rows, '#', 0, 5, 18);

  /** Values in 1/256 px, so that the conversion to Fx is exact. */
  const q = (min: number, max: number) => fc.integer({ min, max }).map((v) => v / FX_ONE);
  const feelArb = fc.record({
    jumpVelocity: q(128, 1280),
    gravity: q(26, 154),
    fallGravityScale: q(0, 768),
    apexGravityScale: q(26, 384),
    apexThreshold: q(0, 512),
    jumpCutScale: q(0, 300),
    maxFallSpeed: q(256, 2048),
    minJumpTicks: fc.integer({ min: 0, max: 8 }),
    coyoteTicks: fc.integer({ min: 0, max: 8 }),
    jumpBufferTicks: fc.integer({ min: 0, max: 8 }),
    airControl: fc.constantFrom(0, 1),
  });
  const ACTIONS = [actionMask('left'), actionMask('right'), JUMP, actionMask('down')];
  const segmentArb = fc.record({
    held: fc.integer({ min: 0, max: 15 }),
    ticks: fc.integer({ min: 1, max: 14 }),
    // A press edge without the button held: not what a device sends, but a legal frame.
    ghostJump: fc.boolean(),
  });

  it('holds for random profiles and random inputs, tick by tick', () => {
    fc.assert(
      fc.property(
        feelArb,
        fc.array(segmentArb, { minLength: 10, maxLength: 60 }),
        (feel, segments) => {
          const runtime = roomRuntime({ rows, tileSize: 8, spawn: [1, 28], feel });
          const bound = measureRiseBound(runtime, WALKER, 'modern');
          fc.pre(bound !== Number.POSITIVE_INFINITY);
          const world = createWorld(runtime, { ...START, feelProfile: 'modern' });
          const s = world.entities;
          const bottom = () => (s.y[0] as number) + (s.colOy[0] as number) + (s.colH[0] as number);
          let stoodAt = bottom();
          let previous = 0;
          for (const segment of segments) {
            let held = 0;
            ACTIONS.forEach((mask, bit) => {
              if ((segment.held & (1 << bit)) !== 0) held |= mask;
            });
            for (let i = 0; i < segment.ticks; i++) {
              const ghost = i === 0 && segment.ghostJump ? JUMP : 0;
              step(
                world,
                { held, pressed: (held & ~previous) | ghost, released: previous & ~held },
                runtime,
              );
              previous = held;
              if (((s.contact[0] as number) & CONTACT_GROUNDED) !== 0) {
                stoodAt = bottom();
              }
              // y grows downward: the feet are never more than `bound` above where they stood.
              if (bottom() < stoodAt - bound) {
                return false;
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 150, seed: 20261116 },
    );
  });
});
