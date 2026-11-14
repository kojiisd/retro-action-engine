import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Fx, fromPx } from '../fx/fx';
import { bodyAt, buildRoom, mirrorRows, overlapsTiles, TILE } from '../test-support';
import { type CollisionContext, NO_ABILITIES, solidAt } from './grid';
import {
  type Body,
  CONTACT_GROUNDED,
  CONTACT_HEAD,
  CONTACT_ONEWAY,
  CONTACT_WALL,
  moveBody,
} from './move';

const T = 16;
const SWIMMER: CollisionContext = { abilityTags: new Set(['move:swim']) };

describe('moveBody: full tiles', () => {
  const room = buildRoom(['........', '........', '........', '...#....', '........', '########']);

  it('moves freely through empty space', () => {
    const body = bodyAt(24, 40, 8, 8);
    body.vx = fromPx(5);
    body.vy = fromPx(-3);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(0);
    expect([body.x, body.y]).toEqual([fromPx(29), fromPx(37)]);
  });

  it('lands on the floor, snaps to the tile top and reports grounded', () => {
    const body = bodyAt(12, 70, 8, 8);
    body.vy = fromPx(20);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_GROUNDED);
    expect(body.y).toBe(fromPx(5 * T));
    expect(body.vy).toBe(0);
  });

  it('stops at a wall on the right and on the left', () => {
    const right = bodyAt(40, 64, 8, 8);
    right.vx = fromPx(10);
    expect(moveBody(room, right, NO_ABILITIES) & CONTACT_WALL).toBe(CONTACT_WALL);
    expect(right.x + right.ox + right.w).toBe(fromPx(3 * T));
    expect(right.vx).toBe(0);

    const left = bodyAt(72, 64, 8, 8);
    left.vx = fromPx(-30);
    expect(moveBody(room, left, NO_ABILITIES) & CONTACT_WALL).toBe(CONTACT_WALL);
    expect(left.x + left.ox).toBe(fromPx(4 * T));
  });

  it('bumps its head on a tile above', () => {
    const body = bodyAt(56, 88, 8, 8);
    body.vy = fromPx(-40);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_HEAD);
    expect(body.y + body.oy).toBe(fromPx(4 * T));
    expect(body.vy).toBe(0);
  });

  it('treats the room border as a wall', () => {
    const body = bodyAt(8, 40, 8, 8);
    body.vx = fromPx(-50);
    body.vy = fromPx(-200);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_WALL | CONTACT_HEAD);
    expect(body.x + body.ox).toBe(0);
    expect(body.y + body.oy).toBe(0);
  });

  it('reports grounded while standing still on a floor', () => {
    const body = bodyAt(12, 5 * T, 8, 8);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_GROUNDED);
    const floating = bodyAt(12, 5 * T - 1, 8, 8);
    expect(moveBody(room, floating, NO_ABILITIES)).toBe(0);
  });

  it('does not pass through a one-tile wall at several tiles per tick', () => {
    // The box's right edge starts at 32 px; the wall starts at 48 px.
    for (const speedPx of [15, 16, 17, 31, 32, 47, 64, 200]) {
      const body = bodyAt(28, 64, 8, 8);
      body.vx = fromPx(speedPx);
      moveBody(room, body, NO_ABILITIES);
      expect(body.x + body.ox + body.w).toBe(fromPx(Math.min(32 + speedPx, 3 * T)));
    }
  });

  it('resolves X before Y: a diagonal move into a corner slides along the floor', () => {
    const body = bodyAt(20, 72, 8, 8);
    body.vx = fromPx(30);
    body.vy = fromPx(30);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_GROUNDED);
    expect(body.x).toBe(fromPx(50));
    expect(body.y).toBe(fromPx(5 * T));
  });
});

describe('moveBody: oneway tiles', () => {
  const room = buildRoom(['........', '........', '..====..', '........', '........', '########']);

  it('lands on a oneway tile from above', () => {
    const body = bodyAt(40, 24, 8, 8);
    body.vy = fromPx(20);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_GROUNDED | CONTACT_ONEWAY);
    expect(body.y).toBe(fromPx(2 * T));
  });

  it('lands even when falling several tiles in one tick', () => {
    const body = bodyAt(40, 4, 8, 8);
    body.vy = fromPx(60);
    expect(moveBody(room, body, NO_ABILITIES) & CONTACT_ONEWAY).toBe(CONTACT_ONEWAY);
    expect(body.y).toBe(fromPx(2 * T));
  });

  it('lets a body pass from below and sideways', () => {
    const up = bodyAt(40, 70, 8, 8);
    up.vy = fromPx(-50);
    expect(moveBody(room, up, NO_ABILITIES)).toBe(0);
    expect(up.y).toBe(fromPx(20));

    const side = bodyAt(12, 40, 8, 12);
    side.vx = fromPx(60);
    expect(moveBody(room, side, NO_ABILITIES)).toBe(0);
    expect(side.x).toBe(fromPx(72));
  });

  it('does not catch a body whose bottom started below the tile top', () => {
    // Bottom 1/256 px below the platform top, moving down: falls through.
    const body = bodyAt(40, 2 * T, 8, 8);
    body.y += 1;
    body.vy = fromPx(4);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(0);
  });

  it('reports oneway only when no full tile also supports the body', () => {
    const mixed = buildRoom(['....', '....', '#=..']);
    const body = bodyAt(16, 2 * T, 8, 8);
    expect(moveBody(mixed, body, NO_ABILITIES)).toBe(CONTACT_GROUNDED);
  });
});

describe('CollisionContext and requiresAnyTag', () => {
  const room = buildRoom(['......', '......', '..~~..', '..~~..', '######']);

  it('blocks entities without the tag', () => {
    const body = bodyAt(12, 56, 8, 8);
    body.vx = fromPx(40);
    expect(moveBody(room, body, NO_ABILITIES)).toBe(CONTACT_WALL);
    expect(body.x + body.ox + body.w).toBe(fromPx(2 * T));
  });

  it('lets entities with one of the tags through', () => {
    const body = bodyAt(12, 56, 8, 8);
    body.vx = fromPx(40);
    expect(moveBody(room, body, SWIMMER)).toBe(0);
    expect(body.x).toBe(fromPx(52));
    expect(solidAt(room, 2, 2, SWIMMER)).toBe('none');
    expect(solidAt(room, 2, 2, NO_ABILITIES)).toBe('full');
  });
});

// ---- Property tests (fast-check) ----

const TILE_CHARS = ['.', '.', '.', '#', '='] as const;

/** A random room with an empty tile somewhere to start in, plus that start tile. */
const roomArb = fc
  .record({
    w: fc.integer({ min: 3, max: 12 }),
    h: fc.integer({ min: 3, max: 10 }),
    seed: fc.array(fc.constantFrom(...TILE_CHARS), { minLength: 120, maxLength: 120 }),
  })
  .chain(({ w, h, seed }) => {
    const rows = Array.from({ length: h }, (_, r) =>
      Array.from({ length: w }, (_, c) => seed[(r * w + c) % seed.length]).join(''),
    );
    const empties: Array<[number, number]> = [];
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === '.') empties.push([c, r]);
      });
    });
    if (empties.length === 0) {
      rows[0] = `.${(rows[0] as string).slice(1)}`;
      empties.push([0, 0]);
    }
    return fc.record({
      rows: fc.constant(rows),
      start: fc.constantFrom(...empties),
      box: fc.record({ w: fc.integer({ min: 1, max: 8 }), h: fc.integer({ min: 1, max: 16 }) }),
    });
  });

/** Up to four tiles per tick in either direction, at sub-pixel resolution. */
const velocityArb = fc.integer({ min: -fromPx(4 * T), max: fromPx(4 * T) });
const velocitiesArb = fc.array(fc.tuple(velocityArb, velocityArb), { minLength: 1, maxLength: 30 });

/** Places a box of even px width inside the start tile, resting on its bottom edge. */
function startBody(start: readonly [number, number], box: { w: number; h: number }): Body {
  const wPx = box.w * 2;
  const hPx = Math.min(box.h, T);
  return bodyAt(start[0] * T + T / 2, (start[1] + 1) * T, wPx, hPx);
}

describe('moveBody: properties', () => {
  it('never leaves the box overlapping a full tile or outside the room', () => {
    fc.assert(
      fc.property(roomArb, velocitiesArb, ({ rows, start, box }, velocities) => {
        const room = buildRoom(rows);
        const body = startBody(start, box);
        const isFull = (c: number, r: number) => (rows[r] as string)[c] === '#';
        for (const [vx, vy] of velocities) {
          body.vx = vx;
          body.vy = vy;
          moveBody(room, body, NO_ABILITIES);
          expect(overlapsTiles(room, body, isFull)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('does not tunnel: a body left of a full column never ends up right of it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.integer({ min: 1, max: fromPx(5 * T) }), { minLength: 1, maxLength: 10 }),
        (wallCol, pushes) => {
          const rows = Array.from({ length: 4 }, () =>
            Array.from({ length: 12 }, (_, c) => (c === wallCol ? '#' : '.')).join(''),
          );
          const room = buildRoom(rows);
          const body = bodyAt(T / 2, 2 * T, 8, 8);
          for (const vx of pushes) {
            body.vx = vx;
            body.vy = 0;
            moveBody(room, body, NO_ABILITIES);
            expect(body.x + body.ox + body.w).toBeLessThanOrEqual(fromPx(wallCol * T));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('mirrors: a mirrored room with mirrored X velocities gives a mirrored trajectory', () => {
    fc.assert(
      fc.property(roomArb, velocitiesArb, ({ rows, start, box }, velocities) => {
        const room = buildRoom(rows);
        const mirrored = buildRoom(mirrorRows(rows));
        const width: Fx = fromPx(room.widthTiles * T);
        const a = startBody(start, box);
        const b = startBody([room.widthTiles - 1 - start[0], start[1]], box);
        expect(b.x).toBe(width - a.x);
        for (const [vx, vy] of velocities) {
          a.vx = vx;
          a.vy = vy;
          b.vx = 0 - vx; // velocities come from Int32Array, which never holds -0
          b.vy = vy;
          const contactA = moveBody(room, a, NO_ABILITIES);
          const contactB = moveBody(mirrored, b, NO_ABILITIES);
          expect(b.x).toBe(width - a.x);
          expect(b.y).toBe(a.y);
          expect(b.vx).toBe(-a.vx || 0);
          expect(b.vy).toBe(a.vy);
          expect(contactB).toBe(contactA);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('oneway tiles only stop bodies coming from above', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 1, max: fromPx(3 * T) }),
        (platformRow, col, speed) => {
          const rows = Array.from({ length: 8 }, (_, r) =>
            (r === platformRow ? '=' : '.').repeat(8),
          );
          const room = buildRoom(rows);
          const platformTop = fromPx(platformRow * T);

          // From above, falling: never ends below the platform top.
          const falling = bodyAt(col * T + T / 2, platformRow * T, 8, 8);
          falling.y -= fromPx(1);
          falling.vy = speed;
          moveBody(room, falling, NO_ABILITIES);
          expect(falling.y).toBeLessThanOrEqual(platformTop);

          // From below, rising: passes as if the tile were empty (unless it reaches the ceiling).
          const rising = bodyAt(col * T + T / 2, (platformRow + 2) * T, 8, 8);
          const expected = Math.max(rising.y - speed, -rising.oy);
          rising.vy = -speed;
          const contact = moveBody(room, rising, NO_ABILITIES);
          expect(rising.y).toBe(expected);
          expect(contact & (CONTACT_GROUNDED | CONTACT_ONEWAY)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('only full tiles or the border stop sideways motion (oneway never does)', () => {
    fc.assert(
      fc.property(roomArb, velocityArb, ({ rows, start, box }, vx) => {
        const onewayOnly = rows.map((row) => row.replaceAll('#', '='));
        const room = buildRoom(onewayOnly);
        const body = startBody(start, box);
        const width = fromPx(room.widthTiles * T);
        const left0 = body.x + body.ox;
        body.vx = vx;
        const contact = moveBody(room, body, NO_ABILITIES);
        const expectedLeft = Math.min(Math.max(left0 + vx, 0), width - body.w);
        expect(body.x + body.ox).toBe(expectedLeft);
        expect((contact & CONTACT_WALL) !== 0).toBe(expectedLeft !== left0 + vx);
      }),
      { numRuns: 300 },
    );
  });
});

describe('test fixtures', () => {
  it('buildRoom maps characters to tile classes', () => {
    const room = buildRoom(['.#=~']);
    expect(Array.from(room.collision)).toEqual([TILE.empty, TILE.full, TILE.oneway, TILE.water]);
  });
});
