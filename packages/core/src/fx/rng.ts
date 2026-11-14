/**
 * xorshift32 (ADR-0002). The state is a non-zero uint32 kept on the World as `rng`. Every random
 * decision in core goes through these functions.
 */

/** Any object that carries the generator state, typically the World. */
export interface RngHolder {
  rng: number;
}

/** Used when a seed maps to the forbidden all-zero state. */
const ZERO_SEED_REPLACEMENT = 0x9e3779b9;
const TWO_POW_32 = 2 ** 32;
/** `nextInt(n)` keeps `x / 2^32 * n` exact within 52 bits. */
const NEXT_INT_LIMIT = 2 ** 20;

/** Normalizes a seed to a valid state: uint32 and non-zero. */
export function seedRng(seed: number): number {
  const state = seed >>> 0;
  return state === 0 ? ZERO_SEED_REPLACEMENT : state;
}

/** Advances the state and returns it as a uint32. */
export function nextU32(holder: RngHolder): number {
  let x = holder.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  holder.rng = x >>> 0;
  return holder.rng;
}

/** Uniform integer in [0, n). n is an integer in [1, 2^20]. */
export function nextInt(holder: RngHolder, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > NEXT_INT_LIMIT) {
    throw new RangeError(`nextInt: n = ${n} must be an integer in [1, ${NEXT_INT_LIMIT}]`);
  }
  return Math.floor((nextU32(holder) / TWO_POW_32) * n);
}
