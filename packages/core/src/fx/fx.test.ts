import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checksEnabled, div, FX_ONE, FxRangeError, fromPx, mul, toPxFloor } from './fx';

describe('fx', () => {
  it('runs with range checks on in tests', () => {
    expect(checksEnabled()).toBe(true);
  });

  describe('fromPx / toPxFloor', () => {
    it('converts px to Fx and back', () => {
      expect(fromPx(3)).toBe(768);
      expect(fromPx(-3)).toBe(-768);
      expect(toPxFloor(768)).toBe(3);
    });

    it('floors toward negative infinity when converting to px', () => {
      expect(toPxFloor(255)).toBe(0);
      expect(toPxFloor(256)).toBe(1);
      expect(toPxFloor(-1)).toBe(-1);
      expect(toPxFloor(-256)).toBe(-1);
      expect(toPxFloor(-257)).toBe(-2);
    });

    it('rejects px outside abs(px) < 2^23 and non-integers', () => {
      expect(fromPx(2 ** 23 - 1)).toBe((2 ** 23 - 1) * 256);
      expect(() => fromPx(2 ** 23)).toThrow(FxRangeError);
      expect(() => fromPx(-(2 ** 23))).toThrow(FxRangeError);
      expect(() => fromPx(1.5)).toThrow(FxRangeError);
    });
  });

  describe('mul', () => {
    it('multiplies in 8.8 and truncates toward zero', () => {
      expect(mul(fromPx(2), fromPx(3))).toBe(fromPx(6));
      // 1 * 0.5 (128) = 0.5 exactly.
      expect(mul(FX_ONE, 128)).toBe(128);
      // 1/256 * 0.5 = 0.5/256 -> 0 for both signs (trunc, not floor).
      expect(mul(1, 128)).toBe(0);
      expect(mul(-1, 128)).toBe(0);
      // -3/256 * 0.5 = -1.5/256 -> -1 (trunc), not -2 (floor).
      expect(mul(-3, 128)).toBe(-1);
      expect(mul(3, 128)).toBe(1);
    });

    it('is symmetric for negated inputs (left and right decelerate alike)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -(2 ** 26) + 1, max: 2 ** 26 - 1 }),
          fc.integer({ min: 0, max: FX_ONE }),
          (v, k) => {
            expect(mul(-v, k)).toBe(-mul(v, k) || 0);
          },
        ),
      );
    });

    it('asserts abs(a), abs(b) < 2^26', () => {
      expect(() => mul(2 ** 26, 1)).toThrow(FxRangeError);
      expect(() => mul(1, -(2 ** 26))).toThrow(FxRangeError);
      expect(mul(2 ** 26 - 1, 1)).toBe(Math.trunc((2 ** 26 - 1) / 256));
    });

    it('asserts that the result fits in int32', () => {
      expect(() => mul(2 ** 26 - 1, 2 ** 26 - 1)).toThrow(FxRangeError);
    });
  });

  describe('div', () => {
    it('divides in 8.8 and truncates toward zero', () => {
      expect(div(fromPx(6), fromPx(3))).toBe(fromPx(2));
      expect(div(fromPx(1), fromPx(3))).toBe(85); // 256 / 3 = 85.33
      expect(div(fromPx(-1), fromPx(3))).toBe(-85); // trunc, not floor (-86)
      expect(div(fromPx(1), fromPx(-3))).toBe(-85);
    });

    it('handles a * 256 beyond int32 exactly', () => {
      // 2^22 px / 1024 px = 4096; the intermediate a * 256 = 2^38.
      expect(div(2 ** 30, fromPx(1024))).toBe(fromPx(4096));
    });

    it('asserts a non-zero divisor and an int32 result', () => {
      expect(() => div(fromPx(1), 0)).toThrow(FxRangeError);
      expect(() => div(2 ** 30, 1)).toThrow(FxRangeError);
    });
  });
});
