import { type Fx, fromPx } from '../fx/fx';
import { type CollisionContext, type CollisionGrid, solidAt } from './grid';

/** Contact flags stored per entity after each move (ADR-0004). */
export const CONTACT_GROUNDED = 1;
export const CONTACT_WALL = 2;
export const CONTACT_HEAD = 4;
export const CONTACT_ONEWAY = 8;

/**
 * A moving box. The position is the bottom-center point; the collider is relative to it. All Fx.
 * The box covers [x + ox, x + ox + w) horizontally and [y + oy, y + oy + h) vertically (y down).
 */
export interface Body {
  x: Fx;
  y: Fx;
  vx: Fx;
  vy: Fx;
  readonly w: Fx;
  readonly h: Fx;
  readonly ox: Fx;
  readonly oy: Fx;
}

/** floor(a / b) for integers. Exact: a non-integer quotient is at least 1/|b| from an integer. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Tile column or row that contains the Fx coordinate `v` (floor, also for negatives). */
function cellOf(v: Fx, tileSize: number): number {
  return floorDiv(v >> 8, tileSize);
}

function blocksSideways(kind: string): boolean {
  return kind === 'full';
}

/**
 * Moves the body by its velocity, X axis first, then Y (ADR-0004). Each axis advances in sub-steps
 * of at most one tile, so a fast body cannot pass through a one-tile wall. On a hit the leading
 * edge snaps to the tile boundary and that velocity component becomes 0.
 *
 * `oneway` tiles only stop a body moving down whose bottom was at or above the tile top when the
 * move started (ADR-0004). Only rows the bottom edge newly enters are checked, and their tops are
 * never above the bottom at the start, so a body whose bottom is already inside a oneway row
 * falls through it. Returns the contact flags.
 */
export function moveBody(grid: CollisionGrid, body: Body, context: CollisionContext): number {
  let contact = 0;
  const tileSize = grid.tileSize;
  const step = fromPx(tileSize);

  // ---- X axis ----
  let remaining = body.vx;
  while (remaining !== 0) {
    const delta = remaining > 0 ? Math.min(remaining, step) : Math.max(remaining, -step);
    remaining -= delta;
    const top = body.y + body.oy;
    const rowFirst = cellOf(top, tileSize);
    const rowLast = cellOf(top + body.h - 1, tileSize);
    const left0 = body.x + body.ox;
    const left1 = left0 + delta;
    let hit = false;
    if (delta > 0) {
      const colFrom = cellOf(left0 + body.w - 1, tileSize) + 1;
      const colTo = cellOf(left1 + body.w - 1, tileSize);
      for (let col = colFrom; col <= colTo && !hit; col++) {
        for (let row = rowFirst; row <= rowLast; row++) {
          if (blocksSideways(solidAt(grid, col, row, context))) {
            body.x = fromPx(col * tileSize) - body.w - body.ox;
            hit = true;
            break;
          }
        }
      }
    } else {
      const colFrom = cellOf(left0, tileSize) - 1;
      const colTo = cellOf(left1, tileSize);
      for (let col = colFrom; col >= colTo && !hit; col--) {
        for (let row = rowFirst; row <= rowLast; row++) {
          if (blocksSideways(solidAt(grid, col, row, context))) {
            body.x = fromPx((col + 1) * tileSize) - body.ox;
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) {
      body.vx = 0;
      contact |= CONTACT_WALL;
      break;
    }
    body.x += delta;
  }

  // ---- Y axis ----
  remaining = body.vy;
  while (remaining !== 0) {
    const delta = remaining > 0 ? Math.min(remaining, step) : Math.max(remaining, -step);
    remaining -= delta;
    const left = body.x + body.ox;
    const colFirst = cellOf(left, tileSize);
    const colLast = cellOf(left + body.w - 1, tileSize);
    const top0 = body.y + body.oy;
    const top1 = top0 + delta;
    let hit = false;
    if (delta > 0) {
      const rowFrom = cellOf(top0 + body.h - 1, tileSize) + 1;
      const rowTo = cellOf(top1 + body.h - 1, tileSize);
      for (let row = rowFrom; row <= rowTo && !hit; row++) {
        const rowTop = fromPx(row * tileSize);
        const floor = floorKind(grid, row, colFirst, colLast, context, true);
        if (floor !== 0) {
          body.y = rowTop - body.h - body.oy;
          contact |= floor;
          hit = true;
        }
      }
    } else {
      const rowFrom = cellOf(top0, tileSize) - 1;
      const rowTo = cellOf(top1, tileSize);
      for (let row = rowFrom; row >= rowTo && !hit; row--) {
        for (let col = colFirst; col <= colLast; col++) {
          if (solidAt(grid, col, row, context) === 'full') {
            body.y = fromPx((row + 1) * tileSize) - body.oy;
            contact |= CONTACT_HEAD;
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) {
      body.vy = 0;
      break;
    }
    body.y += delta;
  }

  // Standing still on a floor still counts as grounded.
  if ((contact & CONTACT_GROUNDED) === 0 && body.vy === 0) {
    contact |= supportBelow(grid, body, context);
  }
  return contact;
}

/** Grounded flags when the bottom edge rests exactly on a full or oneway tile top. */
function supportBelow(grid: CollisionGrid, body: Body, context: CollisionContext): number {
  const tileSize = grid.tileSize;
  const bottom = body.y + body.oy + body.h;
  const row = cellOf(bottom, tileSize);
  if (fromPx(row * tileSize) !== bottom) {
    return 0;
  }
  const left = body.x + body.ox;
  return floorKind(
    grid,
    row,
    cellOf(left, tileSize),
    cellOf(left + body.w - 1, tileSize),
    context,
    true,
  );
}

/**
 * Contact flags for landing on `row` across the given columns: grounded when any column is full
 * or (if `onewayCounts`) oneway; oneway only when every supporting tile is oneway, so that a body
 * also standing on a full tile is not reported as on a platform it could drop through.
 */
function floorKind(
  grid: CollisionGrid,
  row: number,
  colFirst: number,
  colLast: number,
  context: CollisionContext,
  onewayCounts: boolean,
): number {
  let full = false;
  let oneway = false;
  for (let col = colFirst; col <= colLast; col++) {
    const kind = solidAt(grid, col, row, context);
    if (kind === 'full') {
      full = true;
    } else if (kind === 'oneway' && onewayCounts) {
      oneway = true;
    }
  }
  if (full) {
    return CONTACT_GROUNDED;
  }
  return oneway ? CONTACT_GROUNDED | CONTACT_ONEWAY : 0;
}
