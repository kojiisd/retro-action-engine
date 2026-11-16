import {
  actionMask,
  type CharacterDef,
  CONTACT_HEAD,
  createWorld,
  FX_ONE,
  type Fx,
  type InputFrame,
  type PackRuntime,
  type RoomData,
  resolveFeel,
  step,
} from '@retro-action-engine/core';

/** How high and for how long a full-hold jump rises in open space. */
export interface Rise {
  /** Highest point above the take-off height, in Fx. Infinity when nothing stops the rise. */
  readonly height: Fx;
  /** Ticks from the jump press until the body stops rising. */
  readonly ticks: number;
}

const PROBE = '__solver_probe';
const MAX_PROBE_ROWS = 4096;

/** A room with a floor and nothing else, tall enough for the given number of rows. */
function openRoom(runtime: PackRuntime, character: CharacterDef, rows: number): RoomData {
  const widthPx = Math.ceil(character.collider.w / FX_ONE);
  const widthTiles = Math.ceil(widthPx / runtime.tileSize) + 2;
  const collision = new Uint16Array(widthTiles * rows);
  collision.fill(1, widthTiles * (rows - 1));
  const centerPx = Math.floor((widthTiles * runtime.tileSize) / 2);
  return {
    id: PROBE,
    widthTiles,
    heightTiles: rows,
    collision,
    tileClasses: [
      { id: 0, solid: 'none' },
      { id: 1, solid: 'full' },
    ],
    spawns: { s: { x: centerPx * FX_ONE, y: (rows - 1) * runtime.tileSize * FX_ONE } },
  };
}

/** One jump in an empty room: the rise above the take-off height and how long it took. */
interface ProbeResult {
  readonly height: Fx;
  readonly ticks: number;
}

/**
 * Runs one jump with the real simulation in an empty room and returns how far the feet rose.
 * `hold` is the number of ticks the button stays down, counted from the take-off tick; 0 means
 * the jump starts with the button already up (as a buffered press does). The run ends when the
 * body stops rising. A rise that nothing stops gives an infinite height.
 */
function probeJump(
  runtime: PackRuntime,
  character: CharacterDef,
  feelProfileId: string,
  hold: number,
): ProbeResult {
  const jump = actionMask('jump');
  for (let rows = 64; rows <= MAX_PROBE_ROWS; rows *= 2) {
    const probeRuntime: PackRuntime = {
      ...runtime,
      rooms: { [PROBE]: openRoom(runtime, character, rows) },
      characters: { ...runtime.characters, [character.id]: character },
    };
    const world = createWorld(probeRuntime, {
      roomId: PROBE,
      spawnId: 's',
      party: [character.id],
      seed: 1,
      feelProfile: feelProfileId,
    });
    const s = world.entities;
    const startY = s.y[0] as number;
    const limit = rows * runtime.tileSize * FX_ONE;
    let minY = startY;
    let ticks = 0;
    let hitCeiling = false;
    // The body rises while vy < 0. A profile without gravity never stops: bail out by height.
    for (;;) {
      const held = ticks < hold ? jump : 0;
      const frame: InputFrame = { held, pressed: ticks === 0 ? jump : 0, released: 0 };
      step(world, frame, probeRuntime);
      ticks++;
      const y = s.y[0] as number;
      minY = Math.min(minY, y);
      if (((s.contact[0] as number) & CONTACT_HEAD) !== 0 || startY - y >= limit) {
        hitCeiling = true;
        break;
      }
      if ((s.vy[0] as number) >= 0) {
        break;
      }
    }
    if (!hitCeiling) {
      return { height: startY - minY, ticks };
    }
  }
  return { height: Number.POSITIVE_INFINITY, ticks: MAX_PROBE_ROWS };
}

/**
 * Measures a full-hold jump by running the real simulation in an empty room, so the result
 * follows whatever the controller does (apex gravity, clamps) without a second physics model.
 * This is what the jump macros use; it is not an upper bound (see `measureRiseBound`).
 */
export function measureRise(
  runtime: PackRuntime,
  character: CharacterDef,
  feelProfileId: string,
): Rise {
  return probeJump(runtime, character, feelProfileId, Number.POSITIVE_INFINITY);
}

/**
 * An upper bound of the rise (ADR-0015, "上昇量の上限"): between two moments of standing, no
 * input sequence lifts the feet of this character higher than this above where they last stood.
 * Infinity when no bound can be given.
 *
 * Why it holds, for one character alone in a room of static tiles:
 * 1. Without a jump the body never moves up: gravity only adds to vy, and the fall speed clamp
 *    is not negative. This needs the four checks below; otherwise the answer is Infinity.
 * 2. A jump needs to stand first, or to have stood within the coyote window. In that window the
 *    body has only fallen (1), so the jump starts at or below where the feet last stood.
 * 3. After the take-off tick the vertical speed depends on the inputs in one way only: the tick
 *    on which the jump is cut (the first tick with the button up, not before minJumpTicks), and
 *    a jump is cut at most once. Steering changes vx only.
 * 4. So the highest rise in open air is the largest over all cut ticks, and every one of them is
 *    run here with the real `step`. The full hold is not always the highest: with a weaker
 *    gravity near the apex, a cut can slow the body into that range a tick earlier.
 * 5. Tiles only take height away: a ceiling stops the rise and sets vy to 0, after which (1)
 *    applies again; walls change vx only.
 */
export function measureRiseBound(
  runtime: PackRuntime,
  character: CharacterDef,
  feelProfileId: string,
): Fx {
  const profile = runtime.feel[feelProfileId];
  if (profile === undefined) {
    throw new RangeError(`feel profile "${feelProfileId}" is not defined`);
  }
  const feel = resolveFeel(profile, character.feelOverrides);
  // Step 1 of the argument: gravity is never negative at any speed, and neither is the clamp.
  // A measured jump cannot stand in for these checks: when the jump itself does not go up, it
  // ends at once, although the standing body would drift up on its own.
  if (
    feel.gravity < 0 ||
    feel.fallGravityScale < 0 ||
    feel.apexGravityScale < 0 ||
    feel.maxFallSpeed < 0
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const full = probeJump(runtime, character, feelProfileId, Number.POSITIVE_INFINITY);
  let bound = full.height;
  // A cut needs vy < 0, so no cut tick lies beyond the end of the full-hold rise.
  for (let hold = 0; hold <= full.ticks && bound !== Number.POSITIVE_INFINITY; hold++) {
    bound = Math.max(bound, probeJump(runtime, character, feelProfileId, hold).height);
  }
  return bound;
}
