import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextInt, nextU32, seedRng } from './rng';

describe('xorshift32', () => {
  it('produces the reference sequence for seed 1', () => {
    const holder = { rng: seedRng(1) };
    expect([nextU32(holder), nextU32(holder), nextU32(holder)]).toEqual([
      270369, 67634689, 2647435461,
    ]);
  });

  it('never uses the all-zero state', () => {
    expect(seedRng(0)).not.toBe(0);
    expect(seedRng(2 ** 32)).not.toBe(0);
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const holder = { rng: seedRng(seed) };
        for (let i = 0; i < 20; i++) {
          expect(nextU32(holder)).not.toBe(0);
        }
      }),
    );
  });

  it('keeps the state a uint32', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const holder = { rng: seedRng(seed) };
        const value = nextU32(holder);
        expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32).toBe(true);
        expect(holder.rng).toBe(value);
      }),
    );
  });

  it('nextInt stays in [0, n)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 2 ** 20 }), (seed, n) => {
        const holder = { rng: seedRng(seed) };
        for (let i = 0; i < 10; i++) {
          const v = nextInt(holder, n);
          expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
        }
      }),
    );
  });

  it('nextInt(1) is always 0, and it rejects n outside [1, 2^20]', () => {
    const holder = { rng: seedRng(42) };
    expect(nextInt(holder, 1)).toBe(0);
    expect(() => nextInt(holder, 0)).toThrow(RangeError);
    expect(() => nextInt(holder, 2 ** 20 + 1)).toThrow(RangeError);
    expect(() => nextInt(holder, 2.5)).toThrow(RangeError);
  });

  it('is a pure function of the seed', () => {
    const a = { rng: seedRng(7) };
    const b = { rng: seedRng(7) };
    for (let i = 0; i < 100; i++) {
      expect(nextInt(a, 1000)).toBe(nextInt(b, 1000));
    }
  });
});
