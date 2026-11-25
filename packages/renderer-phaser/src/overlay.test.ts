import { describe, expect, it } from 'vitest';
import { colorOf } from './overlay';

describe('menu overlay (ADR-0020)', () => {
  it('reads #rrggbb colors', () => {
    expect(colorOf('#182860')).toBe(0x182860);
  });
});
