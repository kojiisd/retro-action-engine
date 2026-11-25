import type { UiFontDef } from '@retro-action-engine/core';
import { describe, expect, it } from 'vitest';
import { glyphIndex, layoutText, textWidth } from './font';

// Fictional font data: half and full width glyphs in 12 x 13 cells.
const FONT: UiFontDef = {
  image: 'font.png',
  cellW: 12,
  cellH: 13,
  ascent: 11,
  glyphs: [
    ['?', 6],
    ['A', 6],
    ['あ', 12],
    [' ', 6],
  ],
};

describe('menu text (ADR-0020)', () => {
  it('advances each glyph by its own width', () => {
    expect(layoutText(FONT, 'Aあ A', 10, 4)).toEqual([
      { cell: 1, x: 10, y: 4 },
      { cell: 2, x: 16, y: 4 },
      { cell: 3, x: 28, y: 4 },
      { cell: 1, x: 34, y: 4 },
    ]);
    expect(textWidth(FONT, 'Aあ A')).toBe(30);
  });

  it('draws "?" for a character the font lacks, counted in code points', () => {
    const indexOf = glyphIndex(FONT);
    expect(indexOf('Z')).toBe(0);
    expect(layoutText(FONT, '😀A', 0, 0).map((g) => g.cell)).toEqual([0, 1]);
    expect(textWidth(FONT, 'ZZ')).toBe(12);
  });
});
