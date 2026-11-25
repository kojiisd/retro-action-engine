import type { UiFontDef } from '@retro-action-engine/core';

// Laying out text in a pack's menu font (ADR-0020). Shared by the renderer, which draws it, and
// the app, which places it.

/** Cell index by character; "?" stands in for characters the font does not have. */
export function glyphIndex(font: UiFontDef): (ch: string) => number {
  const index = new Map<string, number>();
  font.glyphs.forEach(([ch], i) => {
    index.set(ch, i);
  });
  const fallback = index.get('?') ?? 0;
  return (ch) => index.get(ch) ?? fallback;
}

/** The cells to draw for `text` at `x`, `y`: each glyph advances by its width. */
export function layoutText(
  font: UiFontDef,
  text: string,
  x: number,
  y: number,
  indexOf: (ch: string) => number = glyphIndex(font),
): Array<{ readonly cell: number; readonly x: number; readonly y: number }> {
  const out: Array<{ cell: number; x: number; y: number }> = [];
  let at = x;
  for (const ch of text) {
    const cell = indexOf(ch);
    out.push({ cell, x: at, y });
    at += font.glyphs[cell]?.[1] ?? font.cellW;
  }
  return out;
}

/** The width of `text` in px, as `layoutText` lays it out. */
export function textWidth(font: UiFontDef, text: string): number {
  const indexOf = glyphIndex(font);
  let width = 0;
  for (const ch of text) width += font.glyphs[indexOf(ch)]?.[1] ?? font.cellW;
  return width;
}
