import { describe, expect, it } from 'vitest';
import { ASCII, buildAtlas, charsOf } from './atlas';
import { jisX0208Char, latin1Char, mplus12, parseBdf } from './bdf';

// A tiny BDF in the shape of the M+ files: "A" (half width) and "あ" (JIS 0x2422, full width).
const HALF = `STARTFONT 2.1
FONT_ASCENT 3
FONT_DESCENT 1
STARTCHAR A
ENCODING 65
DWIDTH 3 0
BBX 2 3 0 0
BITMAP
40
C0
40
ENDCHAR
ENDFONT
`;
const FULL = `STARTFONT 2.1
FONT_ASCENT 3
FONT_DESCENT 1
STARTCHAR 2422
ENCODING 9250
DWIDTH 4 0
BBX 4 2 0 -1
BITMAP
F0
90
ENDCHAR
ENDFONT
`;

describe('BDF reading (ADR-0020)', () => {
  it('reads the bitmaps and places them on the baseline', () => {
    const font = mplus12(HALF, FULL);
    expect(font).toMatchObject({ ascent: 3, height: 4 });
    // "A": 3 rows from the top, the bottom row is the descent.
    expect([...(font.glyphs.get('A')?.pixels ?? [])]).toEqual([0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0]);
    // "あ": two rows, one of them below the baseline.
    expect([...(font.glyphs.get('あ')?.pixels ?? [])]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1,
    ]);
    expect(parseBdf(HALF).chars.size).toBe(1);
  });

  it('maps JIS codes to characters', () => {
    expect(jisX0208Char(0x2422)).toBe('あ');
    expect(jisX0208Char(0x2573)).toBe('ン');
    expect(latin1Char(0x41)).toBe('A');
    expect(latin1Char(0x5c)).toBe(String.fromCharCode(0x5c));
    expect(latin1Char(0xe9)).toBe('é');
    expect(latin1Char(0x07)).toBeUndefined();
  });

  it('lists ASCII and then the other characters of the texts, once each', () => {
    expect(charsOf(['あ い あ\n', 'A'])).toEqual([...ASCII, 'あ', 'い']);
  });

  it('lays the glyphs out in cells, and refuses a character the font lacks', () => {
    const font = mplus12(HALF, FULL);
    const atlas = buildAtlas(font.glyphs, ['A', 'あ'], { w: 4, h: 4 }, 2);
    expect(atlas).toMatchObject({ width: 8, height: 4 });
    expect(atlas.list).toEqual([
      ['A', 3],
      ['あ', 4],
    ]);
    expect(() => buildAtlas(font.glyphs, ['B'], { w: 4, h: 4 })).toThrow('B');
  });
});
