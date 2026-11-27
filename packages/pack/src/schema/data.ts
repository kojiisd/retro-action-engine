import { ACTIONS, type ActionId } from '@retro-action-engine/core';
import { z } from 'zod';

const px = z.number().finite();
const ticks = z.int().nonnegative();
const name = z.string().min(1);

/** Animation (docs/pack-spec.md 4.1). */
export const animationSchema = z.object({
  frames: z
    .array(
      z.object({
        frame: name,
        ticks: z.int().positive(),
        // Attack hitbox (ADR-0017), px from the feet center, facing right.
        hitbox: z.object({ x: px, y: px, w: px.positive(), h: px.positive() }).optional(),
      }),
    )
    .min(1),
  loop: z.boolean(),
});

/** The motion values of a feel profile, in px (docs/input-and-feel.md 8.2). */
export const feelMotionShape = {
  runSpeed: px,
  groundAccel: px,
  groundDecel: px,
  turnDecel: px,
  airAccel: px,
  airDecel: px,
  airControl: px,
  jumpVelocity: px,
  gravity: px,
  fallGravityScale: px,
  maxFallSpeed: px,
  jumpCutScale: px,
  minJumpTicks: ticks,
  apexGravityScale: px,
  apexThreshold: px,
  coyoteTicks: ticks,
  jumpBufferTicks: ticks,
  dropThroughTicks: ticks,
  landingLagTicks: ticks,
};

/** `characters.json`. Enemies-only fields (hitboxes) come with M3. */
export const charactersSchema = z.object({
  characters: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and "-"'),
        name,
        abilityTags: z.array(name),
        hp: z.object({ max: z.int().positive() }).optional(),
        collider: z.object({ w: px.positive(), h: px.positive(), ox: px, oy: px }),
        sprite: z.object({ atlas: name, animations: z.record(name, animationSchema) }),
        feelOverrides: z.object(feelMotionShape).partial().optional(),
      }),
    )
    .min(1),
});

/** One kind of HP-draining tile (ADR-0016). */
const hazardSchema = z.object({
  damage: z.int().positive(),
  intervalTicks: z.int().positive(),
  byTag: z
    .array(
      z.object({
        anyTag: z.array(name).min(1),
        damage: z.int().positive().optional(),
        intervalTicks: z.int().positive().optional(),
      }),
    )
    .optional(),
});

/**
 * `rules.json`. `party`, and `hp` and `hazards` in the part ADR-0016 brings forward, are used;
 * the rest is kept for later milestones.
 */
export const rulesSchema = z.looseObject({
  party: z.object({
    members: z.array(name).min(1),
    switch: z.object({
      mode: z.enum(['anywhere', 'atPoints', 'never']),
      cooldownTicks: ticks,
      requireGrounded: z.boolean(),
      placement: z.enum(['same', 'spawn']),
    }),
  }),
  hp: z
    .object({
      // `shared` and `gameOver` come with M3-5.
      scope: z.literal('perCharacter'),
      onDeath: z.enum(['switchToAlive', 'respawnAtSavePoint']),
      onAllDown: z.literal('respawnAtSavePoint'),
    })
    .optional(),
  hazards: z.record(name, hazardSchema).optional(),
  // ADR-0021. `perCharacter` comes with M3-5 (the loader says so).
  inventory: z.object({ scope: z.enum(['shared', 'perCharacter']) }).optional(),
  gating: z.object({ subject: z.enum(['active', 'anyInParty']) }).optional(),
});

const spriteRef = z.object({ atlas: name, frame: name });

/** `items.json` (docs/pack-spec.md 4.3, ADR-0021). `effect` is refused by the loader (later). */
export const itemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and "-"'),
      name,
      kind: z.enum(['key', 'consumable', 'equipment', 'upgrade']),
      grants: z.array(name).optional(),
      effect: z.unknown().optional(),
      stack: z.int().positive(),
      sprite: spriteRef,
    }),
  ),
});

/**
 * `gimmicks.json` (docs/pack-spec.md 4.4, ADR-0021). The parameters depend on the type, and a
 * room's object may override them, so the loader checks them after merging.
 */
export const gimmicksSchema = z.object({
  gimmicks: z.array(
    z.looseObject({
      id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and "-"'),
      type: name,
      sprite: spriteRef.optional(),
      frameOn: name.optional(),
    }),
  ),
});

/** One condition of an event zone (`zones` layer, ADR-0021). */
export const eventConditionSchema = z.union([
  z.strictObject({ flag: name, is: z.union([z.boolean(), z.int()]) }),
  z.strictObject({ hasItem: name, count: z.int().positive().optional() }),
  z.strictObject({ notItem: name }),
]);

/** One action of an event zone (ADR-0021). */
export const eventActionSchema = z.union([
  z.strictObject({ setFlag: name, value: z.union([z.boolean(), z.int()]).optional() }),
  z.strictObject({ giveItem: name, count: z.int().positive().optional() }),
  z.strictObject({ takeItem: name, count: z.int().positive().optional() }),
]);

/** `feel.json` (docs/pack-spec.md 4.6). */
export const feelSchema = z.object({
  default: name,
  profiles: z.record(
    name,
    z.object({
      name: name.optional(),
      interpolation: z.enum(['linear', 'none']),
      socd: z.enum(['neutral', 'lastWins', 'leftWins']),
      ...feelMotionShape,
      // Motion inside a medium (a tile's `medium`), ADR-0016.
      media: z
        .record(name, z.object({ ...feelMotionShape, swim: z.boolean() }).partial())
        .optional(),
      // While attacking on the ground (ADR-0017). Absent is `stop`.
      attackOnGround: z.enum(['stop', 'move']).optional(),
      // Ladders (ADR-0019). Without `climbSpeed` the profile cannot hold on to a ladder.
      climbSpeed: px.positive().optional(),
      climbJumpVelocity: px.nonnegative().optional(),
      // Attack buffer in ticks (ADR-0017, M3-2c). Absent is 0.
      attackBufferTicks: ticks.optional(),
    }),
  ),
});

const actionId = z.enum(ACTIONS as unknown as [ActionId, ...ActionId[]]);
const gamepadInput = z.union([
  z.custom<`button${number}`>((v) => typeof v === 'string' && /^button\d+$/.test(v), {
    message: 'expected "button<number>"',
  }),
  z.custom<`axis${number}+` | `axis${number}-`>(
    (v) => typeof v === 'string' && /^axis\d+[+-]$/.test(v),
    { message: 'expected "axis<number>+" or "axis<number>-"' },
  ),
  z.enum([
    'dpadUp',
    'dpadDown',
    'dpadLeft',
    'dpadRight',
    'leftStickUp',
    'leftStickDown',
    'leftStickLeft',
    'leftStickRight',
  ]),
]);

const unit = z.number().min(0).max(1);
const touchRadius = z.number().positive().max(0.5);

/** One virtual pad layout (docs/pack-spec.md 4.7, docs/input-and-feel.md 9). */
const touchLayoutSchema = z.object({
  handedness: z.enum(['right', 'left']),
  opacity: unit,
  dpad: z.object({
    cx: unit,
    cy: unit,
    radius: touchRadius,
    deadzoneRatio: z.number().min(0).lt(1),
    floating: z.boolean(),
  }),
  buttons: z.array(z.object({ action: actionId, cx: unit, cy: unit, radius: touchRadius })),
});

/** `input.json` (docs/pack-spec.md 4.7). */
export const inputSchema = z
  .object({
    keyboard: z.partialRecord(actionId, z.array(name)),
    gamepad: z.object({ standard: z.partialRecord(actionId, z.array(gamepadInput)) }),
    analog: z.object({ deadzone: z.number().min(0).max(1), release: z.number().min(0).max(1) }),
    touch: z
      .object({ layout: name, layouts: z.record(name, touchLayoutSchema) })
      .refine((t) => t.layouts[t.layout] !== undefined, {
        message: 'touch.layout must name one of touch.layouts',
        path: ['layout'],
      }),
  })
  .refine((v) => v.analog.release < v.analog.deadzone, {
    message: 'analog.release must be smaller than analog.deadzone (hysteresis)',
    path: ['analog', 'release'],
  });

/** `camera.json` (ADR-0009, ADR-0018). */
export const cameraSchema = z
  .looseObject({
    mode: z.enum(['scroll', 'screenFlip']),
    activationMarginPx: z.int().nonnegative().optional(),
    scroll: z
      .object({
        deadzone: z.object({ w: z.int().nonnegative(), h: z.int().nonnegative() }),
        lookahead: z.object({ x: z.int(), y: z.int() }),
        lerpShift: z.int().min(0).max(8),
        lockY: z.boolean(),
        snapToTileRows: z
          .boolean()
          .refine((v) => !v, 'snapToTileRows is not supported yet (ADR-0009)')
          .optional(),
        followY: z.enum(['always', 'grounded']).optional(),
      })
      .optional(),
    screenFlip: z
      .object({
        transition: z.enum(['cut', 'scroll']),
        transitionTicks: z.int().nonnegative(),
        pauseSimulation: z.boolean(),
        triggerInsetPx: z.int().nonnegative(),
      })
      .optional(),
    roomTransition: z
      .object({ effect: z.enum(['fade', 'cut']), lockTicks: z.int().nonnegative() })
      .optional(),
  })
  .refine((c) => c.mode !== 'scroll' || c.scroll !== undefined, {
    message: 'mode "scroll" needs "scroll"',
    path: ['scroll'],
  })
  .refine((c) => c.mode !== 'screenFlip' || c.screenFlip !== undefined, {
    message: 'mode "screenFlip" needs "screenFlip"',
    path: ['screenFlip'],
  });

/** A JSON Hash atlas (TexturePacker, free-tex-packer, Aseprite). */
export const atlasSchema = z.object({
  frames: z.record(
    name,
    z.looseObject({
      frame: z.object({ x: z.int(), y: z.int(), w: z.int().positive(), h: z.int().positive() }),
    }),
  ),
  meta: z.looseObject({ image: name }),
});

/** `strings.<lang>.json` (docs/pack-spec.md 4.10): flat keys to texts. */
export const stringsSchema = z.record(z.string().min(1), z.string());

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected "#rrggbb"');

/** `ui.json` (docs/pack-spec.md 4.11, ADR-0020). */
export const uiSchema = z.object({
  font: z.object({
    image: name,
    cellW: z.int().positive(),
    cellH: z.int().positive(),
    ascent: z.int().nonnegative(),
    glyphs: z.array(z.tuple([z.string().min(1), z.int().positive()])).min(1),
  }),
  colors: z.object({
    border: color,
    fill: color,
    text: color,
    accent: color,
    dim: color,
    cursor: color,
    gauge: color,
    gaugeBack: color,
  }),
});
