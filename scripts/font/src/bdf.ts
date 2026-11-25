// Reads the M+ BITMAP FONTS 12 px BDF files into glyph bitmaps by character (ADR-0020).

/** A glyph in a cell of the font's height: one byte per pixel (1 = ink), row by row. */
export interface Glyph {
  readonly width: number;
  readonly pixels: Uint8Array;
}

interface BdfChar {
  encoding: number;
  dwidth: number;
  bbx: [number, number, number, number];
  rows: number[];
}

/** The glyphs of a BDF file by encoding, with the font's ascent and descent. */
export function parseBdf(text: string): {
  ascent: number;
  descent: number;
  chars: Map<number, BdfChar>;
} {
  let ascent = 0;
  let descent = 0;
  const chars = new Map<number, BdfChar>();
  let current: Partial<BdfChar> | undefined;
  let inBitmap = false;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const key = parts[0];
    if (key === 'FONT_ASCENT') ascent = Number(parts[1]);
    else if (key === 'FONT_DESCENT') descent = Number(parts[1]);
    else if (key === 'STARTCHAR') current = { rows: [] };
    else if (current === undefined) continue;
    else if (key === 'ENCODING') current.encoding = Number(parts[1]);
    else if (key === 'DWIDTH') current.dwidth = Number(parts[1]);
    else if (key === 'BBX') current.bbx = parts.slice(1, 5).map(Number) as BdfChar['bbx'];
    else if (key === 'BITMAP') inBitmap = true;
    else if (key === 'ENDCHAR') {
      const c = current as BdfChar;
      if (c.encoding !== undefined && c.encoding >= 0) chars.set(c.encoding, c);
      current = undefined;
      inBitmap = false;
    } else if (inBitmap && key !== undefined && key !== '') {
      current.rows?.push(Number.parseInt(key, 16));
    }
  }
  return { ascent, descent, chars };
}

/** Draws a BDF character into a cell `height` tall with the baseline `ascent` from the top. */
export function toGlyph(c: BdfChar, ascent: number, height: number): Glyph {
  const [w, h, ox, oy] = c.bbx;
  const width = c.dwidth;
  const pixels = new Uint8Array(width * height);
  const bytes = Math.ceil(w / 8);
  const top = ascent - (h + oy);
  c.rows.forEach((bits, r) => {
    for (let x = 0; x < w; x++) {
      if ((bits >> (bytes * 8 - 1 - x)) & 1) {
        const px = ox + x;
        const py = top + r;
        if (px >= 0 && px < width && py >= 0 && py < height) pixels[py * width + px] = 1;
      }
    }
  });
  return { width, pixels };
}

const eucJp = new TextDecoder('euc-jp', { fatal: true });

/** The character of a JIS X 0208 code (as BDF encodes it), or undefined. */
export function jisX0208Char(code: number): string | undefined {
  try {
    return eucJp.decode(Uint8Array.of((code >> 8) | 0x80, (code & 0xff) | 0x80));
  } catch {
    return undefined;
  }
}

/**
 * The character of an ISO 8859-1 code, printable ones only. (The JIS X 0201 file has the yen
 * sign and an overline where ASCII has the backslash and the tilde, so ASCII comes from here.)
 */
export function latin1Char(code: number): string | undefined {
  if ((code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff)) {
    return String.fromCharCode(code);
  }
  return undefined;
}

/**
 * The 12 px font by character: half-width glyphs from the ISO 8859-1 file (`mplus_f12r`) first,
 * then the full width ones from the JIS X 0208 file (`mplus_j12r`). Both share one cell height
 * and baseline.
 */
export function mplus12(halfWidth: string, fullWidth: string) {
  const half = parseBdf(halfWidth);
  const full = parseBdf(fullWidth);
  const ascent = Math.max(half.ascent, full.ascent);
  const height = ascent + Math.max(half.descent, full.descent);
  const glyphs = new Map<string, Glyph>();
  for (const [code, c] of half.chars) {
    const ch = latin1Char(code);
    if (ch !== undefined) glyphs.set(ch, toGlyph(c, ascent, height));
  }
  for (const [code, c] of full.chars) {
    const ch = jisX0208Char(code);
    if (ch !== undefined && !glyphs.has(ch)) glyphs.set(ch, toGlyph(c, ascent, height));
  }
  return { ascent, height, glyphs };
}
