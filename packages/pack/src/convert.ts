import type { FeelMedium, FeelMotion, FeelProfile, Fx } from '@retro-action-engine/core';

/**
 * px (with decimals) to Fx, once at load time (ADR-0002): `Math.round(v * 256)`. The same in every
 * JavaScript engine, so the browser and Node build the same runtime.
 */
export function toFx(px: number): Fx {
  return Math.round(px * 256);
}

/** Feel fields given in px (or as ratios) that become Fx. The others are tick counts. */
const FX_FIELDS = [
  'runSpeed',
  'groundAccel',
  'groundDecel',
  'turnDecel',
  'airAccel',
  'airDecel',
  'airControl',
  'jumpVelocity',
  'gravity',
  'fallGravityScale',
  'maxFallSpeed',
  'jumpCutScale',
  'apexGravityScale',
  'apexThreshold',
] as const satisfies ReadonlyArray<keyof FeelMotion>;

const TICK_FIELDS = [
  'minJumpTicks',
  'coyoteTicks',
  'jumpBufferTicks',
  'dropThroughTicks',
  'landingLagTicks',
] as const satisfies ReadonlyArray<keyof FeelMotion>;

/** Converts the motion values present in `values` (a profile or a character's overrides). */
export function convertMotion(
  values: Partial<Record<keyof FeelMotion, number>>,
): Partial<FeelMotion> {
  const out: Partial<Record<keyof FeelMotion, number>> = {};
  for (const key of FX_FIELDS) {
    const v = values[key];
    if (v !== undefined) out[key] = toFx(v);
  }
  for (const key of TICK_FIELDS) {
    const v = values[key];
    if (v !== undefined) out[key] = v;
  }
  return out as Partial<FeelMotion>;
}

export function convertProfile(
  id: string,
  profile: Record<keyof FeelMotion, number> & {
    readonly name?: string | undefined;
    readonly interpolation: FeelProfile['interpolation'];
    readonly socd: FeelProfile['socd'];
    readonly media?:
      | Record<string, Partial<Record<keyof FeelMotion, number>> & { swim?: boolean | undefined }>
      | undefined;
  },
): FeelProfile {
  const media: Record<string, FeelMedium> = {};
  for (const [medium, values] of Object.entries(profile.media ?? {})) {
    media[medium] = {
      ...convertMotion(values),
      ...(values.swim === undefined ? {} : { swim: values.swim }),
    };
  }
  return {
    id,
    name: profile.name ?? id,
    interpolation: profile.interpolation,
    socd: profile.socd,
    ...(convertMotion(profile) as FeelMotion),
    ...(profile.media === undefined ? {} : { media }),
  };
}
