import type { Fx } from '../fx/fx';

/**
 * Feel profile as core consumes it (docs/input-and-feel.md 8). The pack file writes these in px
 * with decimals; `pack` converts each value once at load time with `Math.round(v * 256)` (ADR-0002),
 * so every speed, acceleration and ratio here is Fx (a ratio of 1 is 256). Tick counts are integers.
 */
export interface FeelMotion {
  // Running
  readonly runSpeed: Fx;
  /** At or above runSpeed the change is immediate. */
  readonly groundAccel: Fx;
  readonly groundDecel: Fx;
  /** Deceleration while reversing. 0 means groundDecel. */
  readonly turnDecel: Fx;
  readonly airAccel: Fx;
  readonly airDecel: Fx;
  /** Ratio applied to airAccel and airDecel. 0 keeps the take-off speed. */
  readonly airControl: Fx;
  // Jump and gravity
  /** Upward speed at take-off (positive number; y grows downward). */
  readonly jumpVelocity: Fx;
  readonly gravity: Fx;
  readonly fallGravityScale: Fx;
  readonly maxFallSpeed: Fx;
  /** Ratio applied to the rising speed when jump is released. 1 (256) disables variable jumps. */
  readonly jumpCutScale: Fx;
  readonly minJumpTicks: number;
  readonly apexGravityScale: Fx;
  readonly apexThreshold: Fx;
  readonly coyoteTicks: number;
  readonly jumpBufferTicks: number;
  readonly dropThroughTicks: number;
  readonly landingLagTicks: number;
}

/**
 * How the character moves inside a medium (ADR-0016): motion values that replace the profile's,
 * and `swim`, which allows a jump (a stroke) at any time inside it.
 */
export interface FeelMedium extends Partial<FeelMotion> {
  readonly swim?: boolean;
}

export interface FeelProfile extends FeelMotion {
  readonly id: string;
  readonly name: string;
  readonly interpolation: 'linear' | 'none';
  readonly socd: 'neutral' | 'lastWins' | 'leftWins';
  /** By medium name (a tile's `medium`). A medium not listed changes nothing. */
  readonly media?: Readonly<Record<string, FeelMedium>>;
  /**
   * While attacking on the ground (ADR-0017): `stop` stands still (no walking, no jump), `move`
   * keeps walking. Absent is `move`.
   */
  readonly attackOnGround?: 'stop' | 'move';
}

/** The feel in effect at one tick: the profile, then the character's, then the medium's. */
export interface ActiveFeel extends FeelProfile {
  /** Inside a medium with `swim`: a jump is allowed without standing on anything. */
  readonly swim: boolean;
}

/** Profile with a character's overrides applied: `{ ...profile, ...overrides }`. */
export function resolveFeel(profile: FeelProfile, overrides?: Partial<FeelMotion>): FeelProfile {
  return overrides === undefined ? profile : { ...profile, ...overrides };
}

/**
 * The feel in a medium (ADR-0016): profile, then the character's overrides, then the medium's.
 * Without a medium, or with one the profile does not list, only the first two apply.
 */
export function activeFeel(
  profile: FeelProfile,
  overrides: Partial<FeelMotion> | undefined,
  medium: string | undefined,
): ActiveFeel {
  const base = resolveFeel(profile, overrides);
  const inside = medium === undefined ? undefined : profile.media?.[medium];
  if (inside === undefined) return { ...base, swim: false };
  const { swim, ...motion } = inside;
  return { ...base, ...motion, swim: swim === true };
}
