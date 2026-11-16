// Fixtures for the solver tests. Built on the core test fixtures (@retro-action-engine/core/testing).
import {
  actionMask,
  type CharacterDef,
  CONTACT_GROUNDED,
  createWorld,
  type FeelProfile,
  FX_ONE,
  type PackRuntime,
  type PartyRules,
  Player,
  type ReplayFile,
  runReplayHeadless,
  startOf,
  step,
} from '@retro-action-engine/core';
import {
  buildRoom,
  type FeelInPx,
  feelProfile,
  MODERN_PX,
  RETRO_PX,
  SWIMMER,
  TEST_TILE_CLASSES,
  WALKER,
} from '@retro-action-engine/core/testing';
import type { Foothold, FootholdReport, ScopeReport, SolveReport } from './types';

export interface RoomFixture {
  /** `.` empty, `#` full, `=` oneway, `~` full unless the character has `move:swim`. */
  readonly rows: readonly string[];
  readonly tileSize: number;
  /** Spawn tile: the character starts with its feet on the bottom edge of this tile. */
  readonly spawn: readonly [col: number, row: number];
  readonly members?: readonly string[];
  /** Replaces values of both test profiles (px, as in the pack file). */
  readonly feel?: Partial<FeelInPx>;
  /**
   * Switching rules. Without them the party cannot switch (`mode: 'never'`), so a fixture with
   * two members is solved one character at a time only. With them, missing fields are
   * `mode: 'anywhere'`, `cooldownTicks: 20`, `requireGrounded: true`, `placement: 'same'`.
   */
  readonly switching?: Partial<PartyRules['switch']>;
  /** Replaces fields of the test characters (collider, feelOverrides). */
  readonly walker?: Partial<CharacterDef>;
  readonly swimmer?: Partial<CharacterDef>;
}

/** A one-room runtime with the two test characters and the retro and modern profiles. */
export function roomRuntime(fixture: RoomFixture): PackRuntime {
  const T = fixture.tileSize;
  const grid = buildRoom(fixture.rows, T);
  const [col, row] = fixture.spawn;
  const profile = (id: string, px: FeelInPx, base: Pick<FeelProfile, 'interpolation' | 'socd'>) =>
    feelProfile({ id, name: id, ...base }, { ...px, ...fixture.feel });
  return {
    id: 'solver-fixture',
    version: '0.0.0',
    tileSize: T,
    rooms: {
      room: {
        id: 'room',
        widthTiles: grid.widthTiles,
        heightTiles: grid.heightTiles,
        collision: grid.collision,
        tileClasses: TEST_TILE_CLASSES,
        spawns: {
          start: { x: Math.floor((col * T + T / 2) * FX_ONE), y: (row + 1) * T * FX_ONE },
        },
      },
    },
    characters: {
      walker: { ...WALKER, ...fixture.walker },
      swimmer: { ...SWIMMER, ...fixture.swimmer },
    },
    feel: {
      retro: profile('retro', RETRO_PX, { interpolation: 'none', socd: 'neutral' }),
      modern: profile('modern', MODERN_PX, { interpolation: 'linear', socd: 'lastWins' }),
    },
    rules: {
      party: {
        members: fixture.members ?? ['walker'],
        switch:
          fixture.switching === undefined
            ? { mode: 'never', cooldownTicks: 20, requireGrounded: true, placement: 'same' }
            : {
                mode: 'anywhere',
                cooldownTicks: 20,
                requireGrounded: true,
                placement: 'same',
                ...fixture.switching,
              },
      },
    },
  };
}

/** Rows of empty tiles, to be drawn on with `fill`. */
export function emptyRows(widthTiles: number, heightTiles: number): string[] {
  return Array.from({ length: heightTiles }, () => '.'.repeat(widthTiles));
}

/** Draws `tile` over columns colFrom..colTo and rows rowFrom..rowTo (inclusive). */
export function fill(
  rows: string[],
  tile: string,
  colFrom: number,
  colTo: number,
  rowFrom: number,
  rowTo: number = rowFrom,
): void {
  for (let r = rowFrom; r <= rowTo; r++) {
    const line = rows[r] as string;
    rows[r] = line.slice(0, colFrom) + tile.repeat(colTo - colFrom + 1) + line.slice(colTo + 1);
  }
}

export const START = { roomId: 'room', spawnId: 'start', seed: 1 } as const;

// ---- Reading reports (pure functions; the test files make the assertions) ----

/** The report of one character alone, or of the whole party with `'party'`. */
export const scopeOf = (report: SolveReport, who: string): ScopeReport =>
  report.scopes.find((scope) =>
    who === 'party'
      ? scope.scope.kind === 'party'
      : scope.scope.kind === 'character' && scope.scope.characterId === who,
  ) as ScopeReport;

export const nameOf = (scope: ScopeReport): string =>
  scope.scope.kind === 'party' ? 'party' : scope.scope.characterId;

/** The foothold of a scope that covers the given tile. Throws when there is none. */
export function footholdAt(scope: ScopeReport, col: number, row: number): FootholdReport {
  const found = scope.footholds.find((f) => f.row === row && f.colFrom <= col && col <= f.colTo);
  if (found === undefined) {
    throw new Error(`no foothold at column ${col}, row ${row}`);
  }
  return found;
}

/** Kinds of macro seen from one foothold to another, or undefined when no transition was seen. */
export function kindsBetween(scope: ScopeReport, from: FootholdReport, to: FootholdReport) {
  return scope.edges.find((edge) => edge.from === from.id && edge.to === to.id)?.kinds;
}

/** Held mask of every tick of a replay. */
export function heldsOf(replay: ReplayFile): number[] {
  return replay.frames.flatMap(([count, held]) => Array.from({ length: count }, () => held));
}

/**
 * Independent check of a replay: run it and look at where the character ends up. True when it
 * stands with its feet exactly on the foothold's top and its box over one of its columns.
 */
export function replayEndsOn(
  runtime: PackRuntime,
  replay: ReplayFile | undefined,
  foothold: Foothold,
): boolean {
  if (replay === undefined) return false;
  const { world } = runReplayHeadless(replay, runtime);
  const s = world.entities;
  const T = runtime.tileSize;
  const left = ((s.x[0] as number) + (s.colOx[0] as number)) / FX_ONE;
  const right = left + (s.colW[0] as number) / FX_ONE;
  return (
    ((s.contact[0] as number) & CONTACT_GROUNDED) !== 0 &&
    s.y[0] === foothold.topPx * FX_ONE &&
    right > foothold.colFrom * T &&
    left < (foothold.colTo + 1) * T
  );
}

/**
 * Checks every "way back" of a scope independently of the solver. A verified one is a replay
 * that first goes to the foothold exactly as its own witness does, and ends standing on a
 * start foothold. Returns what is wrong, one line per problem.
 */
export function returnProblems(runtime: PackRuntime, scope: ScopeReport): string[] {
  const problems: string[] = [];
  const starts = scope.footholds.filter((f) => scope.startFootholds.includes(f.id));
  for (const foothold of scope.footholds) {
    const id = foothold.id;
    if (foothold.status === 'unreached') {
      if (foothold.witness !== undefined) problems.push(`${id}: unreached with a witness`);
      if (foothold.return !== undefined) problems.push(`${id}: unreached with a way back`);
      continue;
    }
    if (foothold.blocker !== undefined) problems.push(`${id}: reached with a blocker`);
    if (foothold.return === undefined) {
      problems.push(`${id}: reached without a way back`);
      continue;
    }
    if (foothold.return.status !== 'verified') {
      // A start foothold always has the trivial way back.
      if (scope.startFootholds.includes(id)) problems.push(`${id}: the start cannot return`);
      continue;
    }
    const there = foothold.witness;
    const back = foothold.return.witness;
    if (there === undefined) {
      problems.push(`${id}: no witness`);
      continue;
    }
    const helds = heldsOf(back.replay);
    if (helds.slice(0, there.ticks).join() !== heldsOf(there.replay).join()) {
      problems.push(`${id}: the way back does not start with the way there`);
    }
    if (back.ticks !== helds.length) problems.push(`${id}: wrong tick count`);
    if (back.macros < there.macros) problems.push(`${id}: fewer macros than the way there`);
    if (!starts.some((start) => replayEndsOn(runtime, back.replay, start))) {
      problems.push(`${id}: the way back does not end on a start foothold`);
    }
  }
  return problems;
}

/** Ticks of a replay on which jump was pressed, with whether the character stood on something. */
export function jumpPresses(runtime: PackRuntime, replay: ReplayFile) {
  const world = createWorld(runtime, startOf(replay));
  const player = new Player(replay.frames);
  const jump = actionMask('jump');
  const presses: Array<{ tick: number; grounded: boolean }> = [];
  for (let tick = 0; tick < player.length; tick++) {
    const frame = player.next();
    if ((frame.pressed & jump) !== 0) {
      const grounded = ((world.entities.contact[0] as number) & CONTACT_GROUNDED) !== 0;
      presses.push({ tick, grounded });
    }
    step(world, frame, runtime);
  }
  return presses;
}
