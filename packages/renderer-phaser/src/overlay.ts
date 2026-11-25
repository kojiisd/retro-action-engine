/**
 * What to draw over the game and the HUD (the menu, ADR-0020), in screen px with the origin at
 * the top-left of the whole display. Made by apps/player; the renderer only draws it.
 */
export interface OverlayView {
  /** How dark to make the game behind (0 = not at all, 1 = black). */
  readonly dim: number;
  readonly rects: ReadonlyArray<OverlayRect>;
  readonly texts: ReadonlyArray<OverlayText>;
  readonly sprites: ReadonlyArray<OverlaySprite>;
}

export interface OverlayRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** `#rrggbb`. */
  readonly color: string;
}

export interface OverlayText {
  /** The top-left of the first glyph's cell. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** `#rrggbb`. */
  readonly color: string;
}

export interface OverlaySprite {
  /** The top-left of the frame. */
  readonly x: number;
  readonly y: number;
  readonly atlas: string;
  readonly frame: string;
  readonly alpha?: number;
}

/** `#rrggbb` to a number for Phaser. */
export function colorOf(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
