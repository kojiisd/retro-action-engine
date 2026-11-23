// The camera (ADR-0009): scroll and screen flip, at two resolutions. Expectations come from the
// fixture's view, deadzone and room sizes, never from fixed numbers in the engine. Rooms and
// values here are fictional test data.
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../hash/hash';
import type { InputFrame } from '../input/frame';
import { Recorder, runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import type {
  CameraDef,
  DisplayDef,
  PackRuntime,
  ScreenFlipCameraDef,
  ScrollCameraDef,
} from '../runtime/pack';
import { GameSession, type InputSource } from '../session/session';
import { boxRoom, setTile, simRuntime } from '../test-support';
import type { World } from '../world/world';
import { cameraView, isActive, viewSize } from './camera';
import { createWorld, type StepOutput, step } from './sim';

const T = 16;
const DISPLAYS: readonly DisplayDef[] = [
  { width: 320, height: 180, hudReserve: { top: 20, bottom: 0 }, orientation: 'landscape' },
  { width: 256, height: 192, hudReserve: { top: 0, bottom: 0 }, orientation: 'landscape' },
];
const SCROLL: ScrollCameraDef = {
  deadzone: { w: 32, h: 48 },
  lookahead: { x: 24, y: 0 },
  lerpShift: 3,
  lockY: false,
  followY: 'grounded',
};
const CUT: ScreenFlipCameraDef = {
  transition: 'cut',
  transitionTicks: 0,
  pauseSimulation: false,
  triggerInsetPx: 4,
};

/** A wide, tall box room: a floor, and steps of floor going up to the right (`stairs`). */
function bigRoom(widthTiles: number, heightTiles: number, stairs = false): string[] {
  const rows = boxRoom(widthTiles, heightTiles);
  if (stairs) {
    // A ledge every few tiles, each one 3 tiles above the previous.
    for (let i = 0, col = 6; col + 4 < widthTiles - 1 && heightTiles - 2 - 3 * (i + 1) > 1; i++) {
      for (let c = col; c < col + 4; c++) setTile(rows, c, heightTiles - 2 - 3 * (i + 1), '=');
      col += 5;
    }
  }
  return rows;
}

function runtimeWith(
  display: DisplayDef,
  camera: Partial<CameraDef> & Pick<CameraDef, 'mode'>,
  rows: string[],
  spawn: [number, number],
): PackRuntime {
  const base = simRuntime({ rows, spawn });
  return { ...base, display, camera: { activationMarginPx: 0, ...camera } };
}

const start = (runtime: PackRuntime, profile = 'retro'): World =>
  createWorld(runtime, { roomId: 'room', spawnId: 'start', seed: 1, feelProfile: profile });

const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]): StepOutput[] =>
  frames.map((frame) => step(world, frame, runtime));

/** The center of the body's box in px, as the camera follows it. */
function center(world: World): { x: number; y: number } {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return {
    x: ((s.x[slot] as number) + (s.colOx[slot] as number) + ((s.colW[slot] as number) >> 1)) >> 8,
    y: ((s.y[slot] as number) + (s.colOy[slot] as number) + ((s.colH[slot] as number) >> 1)) >> 8,
  };
}

describe.each(DISPLAYS)('camera at $width x $height', (display) => {
  const view = {
    w: display.width,
    h: display.height - display.hudReserve.top - display.hudReserve.bottom,
  };
  // Five screens wide and three high, rounded up to whole tiles.
  const W = Math.ceil((view.w * 5) / T);
  const H = Math.ceil((view.h * 3) / T);
  const roomW = W * T;
  const roomH = H * T;

  describe('scroll', () => {
    const runtime = runtimeWith(display, { mode: 'scroll', scroll: SCROLL }, bigRoom(W, H), [
      2,
      H - 2,
    ]);

    it('starts snapped and inside the room, at its bottom-left', () => {
      const world = start(runtime);
      expect(viewSize(runtime)).toEqual(view);
      expect(world.camera.x).toBe(0);
      expect(world.camera.y).toBe(roomH - view.h);
    });

    it('follows to the right, keeping the body near the middle, and stops at the room edge', () => {
      const world = start(runtime);
      const xs: number[] = [];
      for (let i = 0; i < 2000 && center(world).x < roomW - 3 * T; i++) {
        run(world, runtime, script().hold('right', 1).build(1));
        xs.push(world.camera.x);
        const c = center(world).x - world.camera.x;
        // Never off screen.
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(view.w);
      }
      // It only ever moves right, a little at a time (never more than the body in a tick
      // plus the lerp of the lookahead).
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] as number);
      run(world, runtime, script().hold('right', 120).build(120));
      expect(world.camera.x).toBe(roomW - view.w);
    });

    it('settles with the look point inside the deadzone, and exactly on target', () => {
      const world = start(runtime);
      run(world, runtime, script().hold('right', 200).wait(200).build());
      const look = center(world).x + world.controller.facing * SCROLL.lookahead.x;
      const mid = world.camera.x + (view.w >> 1);
      expect(Math.abs(look - mid)).toBeLessThanOrEqual(SCROLL.deadzone.w >> 1);
      // Standing still: the camera does not move any more.
      const x = world.camera.x;
      run(world, runtime, script().wait(30).build(30));
      expect(world.camera.x).toBe(x);
    });

    it('with followY "grounded", keeps still in a jump and centers on the body after landing', () => {
      const stairs = bigRoom(W, H, true);
      // A deadzone taller than a jump: the body never leaves it in the air.
      const deadzone = { w: 32, h: view.h - 2 * T };
      const runFor = (followY: ScrollCameraDef['followY']) => {
        const rt = runtimeWith(
          display,
          { mode: 'scroll', scroll: { ...SCROLL, followY, deadzone } },
          stairs,
          // On the sixth ledge, high above the floor, so the view is not held by the room's
          // bottom edge.
          [32, H - 2 - 18 - 1],
        );
        const world = start(rt);
        run(world, rt, script().wait(60).build(60));
        const before = world.camera.y;
        const ys = run(world, rt, script().hold('jump', 20).build(20)).map(() => world.camera.y);
        // Walk off the ledge to the floor below, and stand there.
        run(world, rt, script().hold('left', 40).wait(300).build());
        const centered = world.camera.y + (view.h >> 1) - center(world).y;
        return { before, ys, centered, world };
      };
      const grounded = runFor('grounded');
      expect(new Set(grounded.ys)).toEqual(new Set([grounded.before]));
      expect(grounded.centered).toBe(0);
      // "always" stays wherever the deadzone lets it: off center after the drop.
      const always = runFor('always');
      expect(always.centered).not.toBe(0);
    });

    it('lockY keeps the height it had on entering', () => {
      const rt = runtimeWith(
        display,
        { mode: 'scroll', scroll: { ...SCROLL, lockY: true } },
        bigRoom(W, H),
        [2, 1],
      );
      const world = start(rt);
      const y = world.camera.y;
      run(world, rt, script().hold('right', 300).build(300));
      expect(world.camera.y).toBe(y);
    });
  });

  describe('screenFlip', () => {
    const flipRoom = (widthScreens: number) => {
      const cols = Math.ceil((view.w * widthScreens) / T);
      return { rows: bigRoom(cols, Math.ceil(view.h / T) + 1), cols };
    };

    it('cuts to the next screen once the body is past the edge by the inset', () => {
      const { rows } = flipRoom(3);
      const rt = runtimeWith(display, { mode: 'screenFlip', screenFlip: CUT }, rows, [
        2,
        rows.length - 2,
      ]);
      const world = start(rt);
      expect([world.camera.x, world.camera.screenX]).toEqual([0, 0]);
      for (let i = 0; i < 1000 && world.camera.screenX === 0; i++) {
        const before = center(world).x;
        run(world, rt, script().hold('right', 1).build(1));
        if (world.camera.screenX === 0) {
          expect(center(world).x - view.w).toBeLessThan(CUT.triggerInsetPx);
        } else {
          // The tick it changed: past the inset, and the view moved by a whole screen at once.
          expect(center(world).x - view.w).toBeGreaterThanOrEqual(CUT.triggerInsetPx);
          expect(before - view.w).toBeLessThan(CUT.triggerInsetPx);
          expect(world.camera.x).toBe(view.w);
        }
      }
      expect(world.camera.screenX).toBe(1);
    });

    it('clamps the last, partial screen to the room', () => {
      const { rows, cols } = flipRoom(1.5);
      const rt = runtimeWith(display, { mode: 'screenFlip', screenFlip: CUT }, rows, [
        cols - 3,
        rows.length - 2,
      ]);
      const world = start(rt);
      expect(world.camera.screenX).toBe(1);
      expect(world.camera.x).toBe(cols * T - view.w);
    });

    it('scrolls over transitionTicks and stops the play meanwhile with pauseSimulation', () => {
      const { rows } = flipRoom(3);
      const flip = {
        ...CUT,
        transition: 'scroll',
        transitionTicks: 24,
        pauseSimulation: true,
      } as const;
      const rt = runtimeWith(display, { mode: 'screenFlip', screenFlip: flip }, rows, [
        2,
        rows.length - 2,
      ]);
      const world = start(rt);
      for (let i = 0; i < 1000 && world.camera.ticks === 0; i++) {
        run(world, rt, script().hold('right', 1).build(1));
      }
      expect(world.camera).toMatchObject({
        screenX: 1,
        fromX: 0,
        toX: view.w,
        ticks: flip.transitionTicks,
      });
      const x = center(world).x;
      const xs = run(
        world,
        rt,
        script()
          .hold('left', flip.transitionTicks)
          .tap('jump', { at: 3 })
          .build(flip.transitionTicks),
      ).map((o) => o.render.camera.x);
      // Straight from one screen to the next, and the body did not move at all.
      expect(xs).toEqual(
        Array.from({ length: flip.transitionTicks }, (_, i) =>
          Math.trunc((view.w * (i + 1)) / flip.transitionTicks),
        ),
      );
      expect(center(world).x).toBe(x);
      expect(world.camera.ticks).toBe(0);
      run(world, rt, script().hold('left', 5).build(5));
      expect(center(world).x).toBeLessThan(x);
    });
  });
});

describe('activation (ADR-0009)', () => {
  const display = DISPLAYS[0] as DisplayDef;
  const runtime = runtimeWith(
    display,
    { mode: 'scroll', scroll: SCROLL, activationMarginPx: 16 },
    bigRoom(80, 30),
    [2, 28],
  );

  it('takes the view grown by the margin', () => {
    const world = start(runtime);
    const view = cameraView(world, runtime);
    if (view === undefined) throw new Error('no view');
    const box = (x: number) => ({ x, y: view.y + 10, w: 8, h: 8 });
    expect(isActive(world, runtime, box(view.x + view.w + 15))).toBe(true);
    expect(isActive(world, runtime, box(view.x + view.w + 16))).toBe(false);
    expect(isActive(world, runtime, box(view.x - 16 - 7))).toBe(true);
    expect(isActive(world, runtime, box(view.x - 16 - 8))).toBe(false);
  });

  it('counts everything as active without a camera', () => {
    const plain = simRuntime({ rows: boxRoom(20, 8), spawn: [3, 6] });
    const world = createWorld(plain, {
      roomId: 'room',
      spawnId: 'start',
      seed: 1,
      feelProfile: 'retro',
    });
    expect(cameraView(world, plain)).toBeUndefined();
    expect(isActive(world, plain, { x: 9999, y: 9999, w: 1, h: 1 })).toBe(true);
  });
});

describe('camera determinism', () => {
  it('gives the same hashes live, from a replay, and for any split of the frame times', () => {
    const display = DISPLAYS[0] as DisplayDef;
    const flip = {
      ...CUT,
      transition: 'scroll',
      transitionTicks: 20,
      pauseSimulation: true,
    } as const;
    for (const camera of [
      { mode: 'scroll', scroll: SCROLL },
      { mode: 'screenFlip', screenFlip: flip },
    ] as const) {
      const runtime = runtimeWith(display, camera, bigRoom(70, 30, true), [3, 28]);
      const frames = script()
        .hold('right', 400)
        .tap('jump', { at: 60 })
        .tap('jump', { at: 140 })
        .hold('left', 200)
        .wait(30)
        .build();
      const startState = { roomId: 'room', spawnId: 'start', seed: 2, feelProfile: 'modern' };
      const world = createWorld(runtime, startState);
      const recorder = new Recorder();
      const live: string[] = [];
      for (const frame of frames) {
        recorder.push(frame);
        step(world, frame, runtime);
        live.push(hashWorld(world).join(':'));
      }
      expect(world.camera.x).toBeGreaterThan(0);
      const file = recorder.toFile(runtime, startState);
      const headless = runReplayHeadless(file, runtime, { checkpointEvery: 1 });
      expect(headless.checkpoints.map((c) => c.hash.join(':'))).toEqual(live);
      const none: InputSource = { nextFrame: () => ({ held: 0, pressed: 0, released: 0 }) };
      for (const pattern of [
        [7, 9, 40],
        [250, 3, 16.7],
      ]) {
        const session = new GameSession(runtime, startState, none);
        session.replay(file);
        for (let i = 0; !session.replayDone; i++)
          session.frame(pattern[i % pattern.length] as number);
        expect(session.hash().join(':')).toBe(live.at(-1));
      }
    }
  });
});
