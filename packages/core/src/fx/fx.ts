/**
 * 8.8 fixed-point arithmetic (ADR-0002).
 *
 * `Fx` is a plain `number` alias that always holds an int32. 1 px = 256. Positions, velocities and
 * accelerations are Fx; timers and tick counts are plain integers.
 *
 * Rounding: scaling (`mul`, `div`) truncates toward zero; conversions to px or tile coordinates
 * floor (`toPxFloor`, `>>`). No other rounding is used in core.
 */
export type Fx = number;

export const FX_SHIFT = 8;
export const FX_ONE = 1 << FX_SHIFT;

/** abs(px) must stay below this for `fromPx` (2^31 / 256). */
const PX_LIMIT = 2 ** 23;
/** abs(a), abs(b) must stay below this for `mul`, so that a * b < 2^52 is exact in a double. */
const MUL_LIMIT = 2 ** 26;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

let checks = false;

export class FxRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'FxRangeError';
  }
}

function isInt32(v: number): boolean {
  return Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX;
}

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new FxRangeError(message);
  }
}

/** Enables the range assertions. Tests run with checks on; production builds leave them off. */
export function setChecks(enabled: boolean): void {
  checks = enabled;
}

export function checksEnabled(): boolean {
  return checks;
}

/** Integer px to Fx. abs(px) < 2^23. */
export function fromPx(px: number): Fx {
  if (checks) {
    check(Number.isInteger(px) && Math.abs(px) < PX_LIMIT, `fromPx: ${px} is out of range`);
  }
  return px << FX_SHIFT;
}

/** Fx to px, rounding toward negative infinity. */
export function toPxFloor(v: Fx): number {
  if (checks) {
    check(isInt32(v), `toPxFloor: ${v} is not an int32`);
  }
  return v >> FX_SHIFT;
}

/** trunc(a * b / 256). abs(a), abs(b) < 2^26. */
export function mul(a: Fx, b: Fx): Fx {
  const result = Math.trunc((a * b) / FX_ONE);
  if (checks) {
    check(isInt32(a) && Math.abs(a) < MUL_LIMIT, `mul: a = ${a} is out of range`);
    check(isInt32(b) && Math.abs(b) < MUL_LIMIT, `mul: b = ${b} is out of range`);
    check(isInt32(result), `mul: result ${result} overflows int32`);
  }
  return result | 0;
}

/** trunc(a * 256 / b). b != 0. `a * 256` may exceed int32, so it is a multiplication, not a shift. */
export function div(a: Fx, b: Fx): Fx {
  if (checks) {
    check(isInt32(a), `div: a = ${a} is not an int32`);
    check(isInt32(b) && b !== 0, `div: b = ${b} is zero or not an int32`);
  }
  const result = Math.trunc((a * FX_ONE) / b);
  if (checks) {
    check(isInt32(result), `div: result ${result} overflows int32`);
  }
  return result | 0;
}

/** The operations as one object, matching the `FxOps` sketch in docs/architecture.md. */
export const fx = { fromPx, toPxFloor, mul, div, setChecks } as const;
