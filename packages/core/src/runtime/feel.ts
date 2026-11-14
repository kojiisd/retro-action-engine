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

export interface FeelProfile extends FeelMotion {
  readonly id: string;
  readonly name: string;
  readonly interpolation: 'linear' | 'none';
  readonly socd: 'neutral' | 'lastWins' | 'leftWins';
}

/** Profile with a character's overrides applied: `{ ...profile, ...overrides }`. */
export function resolveFeel(profile: FeelProfile, overrides?: Partial<FeelMotion>): FeelProfile {
  return overrides === undefined ? profile : { ...profile, ...overrides };
}
