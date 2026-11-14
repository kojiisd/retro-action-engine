// Feel scenarios (roadmap M1-3). Expectations are derived from the profile values, never fixed
// numbers, so that tuning a profile does not break these tests (CLAUDE.md, ADR-0012).
import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { fromPx } from '../fx/fx';
import type { InputFrame } from '../input/frame';
import { script } from '../replay/script';
import type { FeelProfile } from '../runtime/feel';
import type { PackRuntime } from '../runtime/pack';
import {
  boxRoom,
  DISPLAYS,
  type FeelInPx,
  MODERN,
  MODERN_PX,
  RETRO,
  RETRO_PX,
  setTile,
  simRuntime,
} from '../test-support';
import type { World } from '../world/world';
import { createWorld, step, type UiState } from './sim';

const T = 16;

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly ui: UiState;
}

/** Runs the frames and returns the state after each tick. */
function run(runtime: PackRuntime, profile: string, frames: readonly InputFrame[]): Sample[] {
  const world: World = createWorld(runtime, {
    roomId: 'room',
    spawnId: 'start',
    seed: 1,
    feelProfile: profile,
  });
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return frames.map((frame) => {
    const { ui } = step(world, frame, runtime);
    return {
      x: s.x[slot] as number,
      y: s.y[slot] as number,
      vx: s.vx[slot] as number,
      vy: s.vy[slot] as number,
      grounded: ((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0,
      ui,
    };
  });
}

/**
 * Highest point of a jump with the button held, from the px values (docs/input-and-feel.md 8.3,
 * with the apex gravity scale): velocity first, then position. Independent of the Fx code.
 */
function derivedJumpHeight(p: FeelInPx): number {
  let v = p.jumpVelocity; // upward positive
  let height = 0;
  for (;;) {
    const g = Math.abs(v) < p.apexThreshold ? p.gravity * p.apexGravityScale : p.gravity;
    v -= g;
    if (v <= 0) return height;
    height += v;
  }
}

const PROFILES: ReadonlyArray<[FeelProfile, FeelInPx]> = [
  [RETRO, RETRO_PX],
  [MODERN, MODERN_PX],
];

for (const display of DISPLAYS) {
  for (const [profile, px] of PROFILES) {
    describe(`Feel scenario: ${profile.id} at ${display.name}`, () => {
      const { widthTiles: W, heightTiles: H } = display;
      const floorRow = H - 1;
      const standRow = H - 2;

      it('reaches runSpeed on flat ground and keeps it', () => {
        const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [2, standRow] });
        const accelTicks = Math.ceil(profile.runSpeed / profile.groundAccel);
        const trace = run(
          runtime,
          profile.id,
          script()
            .hold('right', accelTicks + 5)
            .build(),
        );
        expect(trace[accelTicks - 1]?.vx).toBe(profile.runSpeed);
        if (accelTicks > 1) {
          expect(trace[accelTicks - 2]?.vx).toBeLessThan(profile.runSpeed);
        }
        expect(trace[accelTicks + 4]?.vx).toBe(profile.runSpeed);
      });

      it('jumps as high as the derived height (within 1 px)', () => {
        const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [3, standRow] });
        const trace = run(runtime, profile.id, script().hold('jump', 80).build());
        const startY = fromPx((standRow + 1) * T);
        const peak = Math.min(...trace.map((sample) => sample.y));
        const height = (startY - peak) / 256;
        const expected = derivedJumpHeight(px);
        expect(Math.abs(height - expected)).toBeLessThanOrEqual(1);
      });

      describe('coyote time', () => {
        // A ledge at the left; walking right walks off it into a pit.
        const ledgeRow = H - 5;
        const rows = boxRoom(W, H);
        for (let c = 1; c <= 5; c++) setTile(rows, c, ledgeRow, '#');
        const runtime = simRuntime({ rows, spawn: [2, ledgeRow - 1] });
        const walk = run(runtime, profile.id, script().hold('right', 60).build());
        const leaveTick = walk.findIndex((sample) => !sample.grounded);

        const jumpAfter = (k: number) => {
          const frames = script()
            .hold('right', leaveTick + k + 5)
            .tap('jump', { at: leaveTick + k })
            .build();
          return run(runtime, profile.id, frames)[leaveTick + k] as Sample;
        };

        it(`succeeds ${profile.coyoteTicks} ticks after leaving the ledge`, () => {
          expect(leaveTick).toBeGreaterThan(0);
          expect(jumpAfter(profile.coyoteTicks).vy).toBeLessThan(0);
        });

        it(`fails ${profile.coyoteTicks + 1} ticks after leaving the ledge`, () => {
          expect(jumpAfter(profile.coyoteTicks + 1).vy).toBeGreaterThanOrEqual(0);
        });
      });

      describe('jump buffer', () => {
        const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [4, standRow] });
        // A first jump; G is the first tick that starts on the ground again.
        const first = run(runtime, profile.id, script().tap('jump').build(120));
        const landTick = first.findIndex((sample, i) => i > 0 && sample.grounded);
        const groundTick = landTick + 1;

        const secondJumpAt = (before: number) => {
          const frames = script()
            .tap('jump')
            .tap('jump', { at: groundTick - before })
            .build(groundTick + 3);
          return run(runtime, profile.id, frames)[groundTick] as Sample;
        };

        it(`a press ${profile.jumpBufferTicks} ticks before landing jumps on landing`, () => {
          expect(landTick).toBeGreaterThan(profile.jumpBufferTicks + 2);
          expect(secondJumpAt(profile.jumpBufferTicks).vy).toBeLessThan(0);
        });

        it(`a press ${profile.jumpBufferTicks + 1} ticks before landing does not`, () => {
          expect(secondJumpAt(profile.jumpBufferTicks + 1).vy).toBeGreaterThanOrEqual(0);
        });
      });

      it('never passes through a wall while running into it', () => {
        const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [2, standRow] });
        const trace = run(runtime, profile.id, script().hold('right', 400).build());
        const wallLeft = fromPx((W - 1) * T);
        const halfWidth = fromPx(6);
        for (const sample of trace) {
          expect(sample.x + halfWidth).toBeLessThanOrEqual(wallLeft);
        }
        expect((trace.at(-2) as Sample).x + halfWidth).toBe(wallLeft);
      });

      describe('requiresAnyTag tiles', () => {
        const rows = boxRoom(W, H);
        const waterCol = 7;
        for (let r = 0; r < floorRow; r++) setTile(rows, waterCol, r, '~');
        const waterLeft = fromPx(waterCol * T);
        const halfWidth = fromPx(6);
        const frames = script().hold('right', 300).build();

        it('blocks a character without the tag', () => {
          const runtime = simRuntime({ rows, spawn: [2, standRow], members: ['walker'] });
          const trace = run(runtime, profile.id, frames);
          expect(Math.max(...trace.map((sample) => sample.x)) + halfWidth).toBe(waterLeft);
        });

        it('lets a character with the tag through', () => {
          const runtime = simRuntime({ rows, spawn: [2, standRow], members: ['swimmer'] });
          const trace = run(runtime, profile.id, frames);
          expect((trace.at(-1) as Sample).x).toBeGreaterThan(waterLeft + fromPx(T));
        });
      });

      describe('party switch', () => {
        const members = ['walker', 'swimmer'];

        it('keeps the position with placement "same"', () => {
          const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [3, standRow], members });
          const frames = script().wait(5).tap('switch').wait(3).build();
          const trace = run(runtime, profile.id, frames);
          expect(trace[4]?.ui.activeCharacterId).toBe('walker');
          expect(trace[5]?.ui.activeCharacterId).toBe('swimmer');
          expect(trace[5]?.x).toBe(trace[4]?.x);
          expect(trace[5]?.y).toBe(trace[4]?.y);
        });

        it('moves to the spawn with placement "spawn"', () => {
          const runtime = simRuntime({
            rows: boxRoom(W, H),
            spawn: [3, standRow],
            members,
            switchRules: { placement: 'spawn' },
          });
          const frames = script().hold('right', 20).tap('switch').wait(3).build();
          const trace = run(runtime, profile.id, frames);
          expect(trace[19]?.x).toBeGreaterThan(fromPx(3 * T + 8));
          expect(trace[20]?.ui.activeCharacterId).toBe('swimmer');
          expect(trace[20]?.x).toBe(fromPx(3 * T + 8));
          expect(trace[20]?.y).toBe(fromPx((standRow + 1) * T));
        });

        it('ignores a switch during the cooldown and accepts one right after it', () => {
          const cooldown = 30;
          const runtime = simRuntime({
            rows: boxRoom(W, H),
            spawn: [3, standRow],
            members,
            switchRules: { cooldownTicks: cooldown },
          });
          const at = 2;
          const early = run(
            runtime,
            profile.id,
            script()
              .tap('switch', { at })
              .tap('switch', { at: at + cooldown - 1 })
              .build(),
          );
          expect(early[at]?.ui.activeCharacterId).toBe('swimmer');
          expect(early[at + cooldown - 1]?.ui.activeCharacterId).toBe('swimmer');
          const onTime = run(
            runtime,
            profile.id,
            script()
              .tap('switch', { at })
              .tap('switch', { at: at + cooldown })
              .build(),
          );
          expect(onTime[at + cooldown]?.ui.activeCharacterId).toBe('walker');
        });

        it('reports canSwitch === false with one member and ignores the switch', () => {
          const runtime = simRuntime({ rows: boxRoom(W, H), spawn: [3, standRow] });
          const trace = run(runtime, profile.id, script().tap('switch', { at: 1 }).build());
          for (const sample of trace) {
            expect(sample.ui.canSwitch).toBe(false);
            expect(sample.ui.activeCharacterId).toBe('walker');
          }
        });

        it('reports canSwitch === false with mode "never"', () => {
          const runtime = simRuntime({
            rows: boxRoom(W, H),
            spawn: [3, standRow],
            members,
            switchRules: { mode: 'never' },
          });
          const trace = run(runtime, profile.id, script().tap('switch', { at: 1 }).build());
          expect(trace.every((sample) => !sample.ui.canSwitch)).toBe(true);
          expect(trace.at(-1)?.ui.activeCharacterId).toBe('walker');
        });
      });

      it('drops through a oneway floor with down + jump instead of jumping', () => {
        const rows = boxRoom(W, H);
        const platformRow = H - 4;
        for (let c = 1; c < W - 1; c++) setTile(rows, c, platformRow, '=');
        const runtime = simRuntime({ rows, spawn: [4, platformRow - 1] });
        const platformTop = fromPx(platformRow * T);
        const frames = script()
          .wait(2)
          .press('down', { ticks: 4 })
          .tap('jump', { at: 3 })
          .build(40);
        const trace = run(runtime, profile.id, frames);
        expect(trace[2]?.y).toBe(platformTop);
        expect(trace.every((sample) => sample.vy >= 0)).toBe(true);
        expect((trace.at(-1) as Sample).y).toBe(fromPx(floorRow * T));
      });
    });
  }
}
