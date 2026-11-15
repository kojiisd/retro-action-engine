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

/**
 * Measures a full-hold jump by running the real simulation in an empty room, so the result
 * follows whatever the controller does (apex gravity, clamps) without a second physics model.
 */
export function measureRise(
  runtime: PackRuntime,
  character: CharacterDef,
  feelProfileId: string,
): Rise {
  const jump = actionMask('jump');
  const first: InputFrame = { held: jump, pressed: jump, released: 0 };
  const hold: InputFrame = { held: jump, pressed: 0, released: 0 };
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
      step(world, ticks === 0 ? first : hold, probeRuntime);
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
