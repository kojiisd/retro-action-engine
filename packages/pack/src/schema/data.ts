import { ACTIONS, type ActionId } from '@retro-action-engine/core';
import { z } from 'zod';

const px = z.number().finite();
const ticks = z.int().nonnegative();
const name = z.string().min(1);

/** Animation (docs/pack-spec.md 4.1). */
export const animationSchema = z.object({
  frames: z.array(z.object({ frame: name, ticks: z.int().positive() })).min(1),
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
});

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

/** `camera.json`. Not used before M3 (one screen per room); checked only for its shape. */
export const cameraSchema = z.looseObject({ mode: z.enum(['scroll', 'screenFlip']) });

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
