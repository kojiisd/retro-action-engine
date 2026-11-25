import type { Glyph } from './bdf';

/** Printable ASCII: always in the font (English texts, digits, "?" for missing glyphs). */
export const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));

/**
 * The characters a font needs for these texts: printable ASCII, then every other character in
 * them (whitespace and control characters aside), in code point order.
 */
export function charsOf(texts: readonly string[]): string[] {
  const extra = new Set<string>();
  for (const text of texts) {
    for (const ch of text) {
      const code = ch.codePointAt(0) as number;
      if (code >= 0x80 && !/\s/u.test(ch)) extra.add(ch);
    }
  }
  return [
    ...ASCII,
    ...[...extra].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)),
  ];
}

/**
 * The font image (white ink on transparent, `columns` cells a row) and the glyph list for
 * `ui.json` (docs/pack-spec.md 4.11). Throws when the font lacks a character.
 */
export function buildAtlas(
  glyphs: ReadonlyMap<string, Glyph>,
  chars: readonly string[],
  cell: { readonly w: number; readonly h: number },
  columns = 16,
): { width: number; height: number; rgba: Uint8Array; list: Array<[string, number]> } {
  const missing = chars.filter((ch) => !glyphs.has(ch));
  if (missing.length > 0) throw new Error(`the font has no glyph for: ${missing.join(' ')}`);
  const rows = Math.ceil(chars.length / columns);
  const width = columns * cell.w;
  const height = rows * cell.h;
  const rgba = new Uint8Array(width * height * 4);
  const list: Array<[string, number]> = [];
  chars.forEach((ch, i) => {
    const g = glyphs.get(ch) as Glyph;
    if (g.width > cell.w || g.pixels.length / g.width > cell.h) {
      throw new Error(`the glyph "${ch}" does not fit the ${cell.w}x${cell.h} cell`);
    }
    const ox = (i % columns) * cell.w;
    const oy = Math.floor(i / columns) * cell.h;
    const gh = g.pixels.length / g.width;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.pixels[y * g.width + x] === 1)
          rgba.fill(255, ((oy + y) * width + ox + x) * 4, ((oy + y) * width + ox + x) * 4 + 4);
      }
    }
    list.push([ch, g.width]);
  });
  return { width, height, rgba, list };
}
