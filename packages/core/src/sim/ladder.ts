import { type CollisionGrid, isLadderAt, isLadderTopAt } from '../collision/grid';
import { CONTACT_GROUNDED, moveBody } from '../collision/move';
import type { PackRuntime } from '../runtime/pack';
import { NEVER, type World } from '../world/world';
import type { Intent } from './intent';
import { activeCharacter } from './party';
import { effectiveTags } from './tags';

type ClimbFeel = {
  readonly climbSpeed?: number;
  readonly climbJumpVelocity?: number;
  readonly runSpeed: number;
};

/** The body's box in Fx, and the column of its center (ladders are judged there, ADR-0019). */
function bodyOf(world: World, tileSize: number) {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const top = (s.y[slot] as number) + (s.colOy[slot] as number);
  const bottom = top + (s.colH[slot] as number);
  const centerX =
    (s.x[slot] as number) + (s.colOx[slot] as number) + ((s.colW[slot] as number) >> 1);
  return {
    s,
    slot,
    top,
    bottom,
    col: Math.floor((centerX >> 8) / tileSize),
    /** Rows the box covers, top to bottom (cell of its last pixel row). */
    rowTop: Math.floor((top >> 8) / tileSize),
    rowBottom: Math.floor(((bottom >> 8) - 1) / tileSize),
  };
}

/** Whether a ladder tile is under the body's center column, anywhere along the body. */
function onLadder(grid: CollisionGrid, body: ReturnType<typeof bodyOf>): boolean {
  for (let row = body.rowTop; row <= body.rowBottom; row++) {
    if (isLadderAt(grid, body.col, row)) return true;
  }
  return false;
}

/** Puts the body's feet in the middle of the ladder's column. */
function centerOnLadder(world: World, tileSize: number, col: number): void {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  s.x[slot] = (col * tileSize + (tileSize >> 1)) << 8;
}

/**
 * Ladders before the `controller` (ADR-0019). Grabs a ladder (`up` on one, `down` standing on
 * its top rung), then, while holding on, sets the body's speed from `up` and `down`, starts a
 * swing, or lets go with a jump. Returns true while it drives the body (the controller then
 * does nothing this tick).
 */
export function climbStep(
  world: World,
  intent: Intent,
  feel: ClimbFeel,
  grid: CollisionGrid,
  tileSize: number,
  attackTicks: number | undefined,
): boolean {
  const c = world.controller;
  const t = world.tick;
  const body = bodyOf(world, tileSize);
  const { s, slot } = body;
  if (!c.climbing) {
    const speed = feel.climbSpeed;
    if (speed === undefined || speed <= 0) return false;
    const grounded = ((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0;
    const grabUp = intent.upHeld && onLadder(grid, body);
    const feetRow = Math.floor((body.bottom >> 8) / tileSize);
    const grabDown = intent.downHeld && grounded && isLadderTopAt(grid, body.col, feetRow);
    if (!grabUp && !grabDown) return false;
    c.climbing = true;
    c.jumpPressedTick = NEVER;
    c.jumpStartTick = NEVER;
    c.jumpedSinceGrounded = false;
    c.dropThroughUntilTick = NEVER;
    centerOnLadder(world, tileSize, body.col);
  }

  // A swing from the ladder (ADR-0017): it holds the climb while it lasts.
  if (
    intent.attackPressed &&
    t >= c.attackUntilTick &&
    attackTicks !== undefined &&
    attackTicks > 0
  ) {
    c.attackUntilTick = t + attackTicks;
  }
  const attacking = t < c.attackUntilTick;
  if (!attacking && intent.moveDir !== 0) c.facing = intent.moveDir;

  if (intent.jumpPressed) {
    // Let go with a hop, sideways with left or right.
    c.climbing = false;
    c.jumpedSinceGrounded = true;
    c.jumpStartTick = t;
    c.jumpCut = false;
    c.jumpPressedTick = NEVER;
    s.vx[slot] = intent.moveDir * feel.runSpeed;
    s.vy[slot] = -(feel.climbJumpVelocity ?? 0);
    return true;
  }
  const speed = feel.climbSpeed ?? 0;
  s.vx[slot] = 0;
  s.vy[slot] = attacking ? 0 : intent.upHeld ? -speed : intent.downHeld ? speed : 0;
  return true;
}

/**
 * Ladders after `movement` (ADR-0019): stands on the top rung once the feet are above it, stops
 * on the floor at the bottom, and lets go when the ladder has ended under the body.
 */
export function climbAfterMove(world: World, runtime: PackRuntime, grid: CollisionGrid): void {
  const c = world.controller;
  if (!c.climbing) return;
  const tileSize = runtime.tileSize;
  const body = bodyOf(world, tileSize);
  const { s, slot } = body;
  const vy = s.vy[slot] as number;
  if (
    vy < 0 &&
    !isLadderAt(grid, body.col, body.rowBottom) &&
    isLadderAt(grid, body.col, body.rowBottom + 1)
  ) {
    // Climbed above the top rung: stand on it.
    s.y[slot] = ((body.rowBottom + 1) * tileSize) << 8;
    s.vy[slot] = 0;
    c.climbing = false;
    s.contact[slot] = settledContact(world, runtime, grid);
    return;
  }
  const grounded = ((s.contact[slot] as number) & CONTACT_GROUNDED) !== 0;
  if ((vy > 0 && grounded) || !onLadder(grid, body)) {
    c.climbing = false;
  }
}

/** What the body stands on where it is, without moving it. */
function settledContact(world: World, runtime: PackRuntime, grid: CollisionGrid): number {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  return moveBody(
    grid,
    {
      x: s.x[slot] as number,
      y: s.y[slot] as number,
      vx: 0,
      vy: 0,
      w: s.colW[slot] as number,
      h: s.colH[slot] as number,
      ox: s.colOx[slot] as number,
      oy: s.colOy[slot] as number,
    },
    { abilityTags: effectiveTags(activeCharacter(world, runtime)) },
  );
}

/**
 * On entering a room (ADR-0018, ADR-0019): keeps holding on when the body arrives on a ladder
 * (a ladder going on into the next room), centered on it; otherwise lets go.
 */
export function climbOnEnter(world: World, grid: CollisionGrid, tileSize: number): void {
  const c = world.controller;
  if (!c.climbing) return;
  const body = bodyOf(world, tileSize);
  if (onLadder(grid, body)) {
    centerOnLadder(world, tileSize, body.col);
  } else {
    c.climbing = false;
  }
}
