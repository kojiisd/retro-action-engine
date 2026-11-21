/**
 * How the game screen is scaled in the page (ADR-0010, revision 2026-11-21): stretched to fit,
 * or by a whole number so that every dot stays the same size, up to `maxZoom`.
 */
export type Scaling =
  | { readonly kind: 'fit' }
  | { readonly kind: 'integer'; readonly maxZoom: number };

/**
 * The largest whole zoom at which a `width` x `height` screen fits in the space, capped at
 * `maxZoom`. Never below 1: a space smaller than the screen itself still shows it at 1x.
 */
export function integerZoom(
  width: number,
  height: number,
  spaceWidth: number,
  spaceHeight: number,
  maxZoom: number,
): number {
  if (width <= 0 || height <= 0) return 1;
  const fits = Math.floor(Math.min(spaceWidth / width, spaceHeight / height));
  return Math.max(1, Math.min(Math.floor(maxZoom), fits));
}
