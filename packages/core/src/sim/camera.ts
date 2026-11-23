import { CONTACT_GROUNDED } from '../collision/move';
import type { PackRuntime, ScreenFlipCameraDef, ScrollCameraDef } from '../runtime/pack';
import type { World } from '../world/world';

/** A rectangle in room px. */
export interface PxRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The view's size: the play area (`display` minus the HUD), or none without `display`. */
export function viewSize(runtime: PackRuntime): { w: number; h: number } | undefined {
  const d = runtime.display;
  if (d === undefined || runtime.camera === undefined) return undefined;
  return { w: d.width, h: d.height - d.hudReserve.top - d.hudReserve.bottom };
}

/** The view in room px (ADR-0009), or undefined when the pack has no camera. */
export function cameraView(world: World, runtime: PackRuntime): PxRect | undefined {
  const view = viewSize(runtime);
  if (view === undefined) return undefined;
  return { x: world.camera.x, y: world.camera.y, w: view.w, h: view.h };
}

/**
 * Whether a box (room px) is active: it overlaps the view grown by `activationMarginPx`
 * (ADR-0009). Without a camera everything is active. Enemies and gimmicks use it (M3-4).
 */
export function isActive(world: World, runtime: PackRuntime, box: PxRect): boolean {
  const view = cameraView(world, runtime);
  if (view === undefined) return true;
  const m = runtime.camera?.activationMarginPx ?? 0;
  return (
    box.x < view.x + view.w + m &&
    view.x - m < box.x + box.w &&
    box.y < view.y + view.h + m &&
    view.y - m < box.y + box.h
  );
}

/** Divides by 2^shift toward zero (the scaling rule of ADR-0002). */
function shiftTowardZero(value: number, shift: number): number {
  return value < 0 ? -(-value >> shift) : value >> shift;
}

/** Keeps a view coordinate inside the room; 0 when the room is not larger than the view. */
function clamp(value: number, roomPx: number, viewPx: number): number {
  return Math.max(0, Math.min(value, roomPx - viewPx));
}

interface Followed {
  /** Center of the body's box, px (floor). */
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly grounded: boolean;
}

function followed(world: World): Followed {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return {
    x: ((s.x[slot] as number) + (s.colOx[slot] as number) + ((s.colW[slot] as number) >> 1)) >> 8,
    y: ((s.y[slot] as number) + (s.colOy[slot] as number) + ((s.colH[slot] as number) >> 1)) >> 8,
    facing: world.controller.facing,
    grounded: ((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0,
  };
}

function roomPx(world: World, runtime: PackRuntime): { w: number; h: number } {
  const room = runtime.rooms[world.roomId];
  return {
    w: (room?.widthTiles ?? 0) * runtime.tileSize,
    h: (room?.heightTiles ?? 0) * runtime.tileSize,
  };
}

/** The scroll camera's look point: the body's center, ahead in the facing direction. */
function lookPoint(f: Followed, scroll: ScrollCameraDef): { x: number; y: number } {
  return { x: f.x + f.facing * scroll.lookahead.x, y: f.y + scroll.lookahead.y };
}

/** The screen (index) a point is on, within the room's screens. */
function screenOf(point: number, viewPx: number, roomPx: number): number {
  const last = roomPx <= 0 ? 0 : Math.floor((roomPx - 1) / viewPx);
  return Math.max(0, Math.min(Math.floor(point / viewPx), last));
}

/**
 * Puts the camera where it belongs at once, with no deadzone and no scroll (ADR-0009): on
 * entering a room and at the start of a game.
 */
export function snapCamera(world: World, runtime: PackRuntime): void {
  const view = viewSize(runtime);
  const config = runtime.camera;
  const cam = world.camera;
  cam.tick = 0;
  cam.ticks = 0;
  if (view === undefined || config === undefined) {
    cam.x = 0;
    cam.y = 0;
    return;
  }
  const room = roomPx(world, runtime);
  const f = followed(world);
  if (config.mode === 'screenFlip') {
    cam.screenX = screenOf(f.x, view.w, room.w);
    cam.screenY = screenOf(f.y, view.h, room.h);
    cam.x = clamp(cam.screenX * view.w, room.w, view.w);
    cam.y = clamp(cam.screenY * view.h, room.h, view.h);
    return;
  }
  const scroll = config.scroll as ScrollCameraDef;
  const look = lookPoint(f, scroll);
  cam.x = clamp(look.x - (view.w >> 1), room.w, view.w);
  cam.y = clamp(look.y - (view.h >> 1), room.h, view.h);
}

/** A target coordinate of the view's center: keeps `point` within the deadzone around `center`. */
function intoDeadzone(point: number, center: number, deadzone: number): number {
  const half = deadzone >> 1;
  if (point > center + half) return point - half;
  if (point < center - half) return point + half;
  return center;
}

/** One step toward `target`: a 2^shift fraction, at least 1 px while not there. */
function approach(now: number, target: number, shift: number): number {
  const diff = target - now;
  let move = shift === 0 ? diff : shiftTowardZero(diff, shift);
  if (move === 0 && diff !== 0) move = Math.sign(diff);
  return now + move;
}

function scrollStep(world: World, runtime: PackRuntime, scroll: ScrollCameraDef): void {
  const view = viewSize(runtime) as { w: number; h: number };
  const room = roomPx(world, runtime);
  const cam = world.camera;
  const f = followed(world);
  const look = lookPoint(f, scroll);
  const halfW = view.w >> 1;
  const halfH = view.h >> 1;
  const centerX = intoDeadzone(look.x, cam.x + halfW, scroll.deadzone.w);
  let centerY = cam.y + halfH;
  if (!scroll.lockY) {
    centerY =
      scroll.followY === 'grounded' && f.grounded
        ? look.y
        : intoDeadzone(look.y, cam.y + halfH, scroll.deadzone.h);
  }
  const targetX = clamp(centerX - halfW, room.w, view.w);
  const targetY = clamp(centerY - halfH, room.h, view.h);
  cam.x = clamp(approach(cam.x, targetX, scroll.lerpShift), room.w, view.w);
  cam.y = clamp(approach(cam.y, targetY, scroll.lerpShift), room.h, view.h);
}

/** The next screen along one axis, when the point is far enough past the current one's edge. */
function nextScreen(
  current: number,
  point: number,
  viewPx: number,
  roomPx: number,
  inset: number,
): number {
  const target = screenOf(point, viewPx, roomPx);
  if (target === current) return current;
  const left = current * viewPx;
  const past = target > current ? point - (left + viewPx) : left - 1 - point;
  return past >= inset ? target : current;
}

/** One tick of a screen-flip scroll in progress. */
export function flipProgress(world: World): void {
  const cam = world.camera;
  cam.tick++;
  // Linear, with the division toward zero (ADR-0002's scaling rule).
  cam.x = cam.fromX + Math.trunc(((cam.toX - cam.fromX) * cam.tick) / cam.ticks);
  cam.y = cam.fromY + Math.trunc(((cam.toY - cam.fromY) * cam.tick) / cam.ticks);
  if (cam.tick >= cam.ticks) {
    cam.tick = 0;
    cam.ticks = 0;
  }
}

function screenFlipStep(world: World, runtime: PackRuntime, flip: ScreenFlipCameraDef): void {
  const cam = world.camera;
  if (cam.ticks > 0) {
    flipProgress(world);
    return;
  }
  const view = viewSize(runtime) as { w: number; h: number };
  const room = roomPx(world, runtime);
  const f = followed(world);
  const sx = nextScreen(cam.screenX, f.x, view.w, room.w, flip.triggerInsetPx);
  const sy = nextScreen(cam.screenY, f.y, view.h, room.h, flip.triggerInsetPx);
  if (sx === cam.screenX && sy === cam.screenY) return;
  cam.screenX = sx;
  cam.screenY = sy;
  const toX = clamp(sx * view.w, room.w, view.w);
  const toY = clamp(sy * view.h, room.h, view.h);
  if (flip.transition === 'cut' || flip.transitionTicks <= 0) {
    cam.x = toX;
    cam.y = toY;
    return;
  }
  cam.fromX = cam.x;
  cam.fromY = cam.y;
  cam.toX = toX;
  cam.toY = toY;
  cam.tick = 0;
  cam.ticks = flip.transitionTicks;
}

/** True while a screen-flip scroll stops the simulation (ADR-0009). */
export function cameraHoldsSimulation(world: World, runtime: PackRuntime): boolean {
  return (
    world.camera.ticks > 0 &&
    runtime.camera?.mode === 'screenFlip' &&
    runtime.camera.screenFlip?.pauseSimulation === true
  );
}

/** The `camera` system (docs/architecture.md 4.3, ADR-0009). */
export function cameraStep(world: World, runtime: PackRuntime): void {
  const config = runtime.camera;
  if (config === undefined || viewSize(runtime) === undefined) return;
  if (config.mode === 'screenFlip') {
    if (config.screenFlip !== undefined) screenFlipStep(world, runtime, config.screenFlip);
  } else if (config.scroll !== undefined) {
    scrollStep(world, runtime, config.scroll);
  }
}
