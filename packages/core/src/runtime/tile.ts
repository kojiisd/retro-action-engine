/**
 * Tile classes as built by `pack` from the Tiled tile properties (docs/pack-spec.md, ADR-0004).
 * Part of the `PackRuntime` contract; core only reads them.
 */
export type SolidKind = 'none' | 'full' | 'oneway' | 'slope';

export interface TileClass {
  readonly id: number;
  readonly solid: SolidKind;
  /** slope: surface height per column in px (M5). */
  readonly heights?: readonly number[];
  readonly ladder?: boolean;
  /** Kind of HP-draining tile: a key of `rules.hazards` (ADR-0016). */
  readonly hazard?: string;
  /** Medium the tile is made of: a key of the feel profiles' `media` (ADR-0016). */
  readonly medium?: string;
  /** The tile is solid unless the entity has at least one of these ability tags. */
  readonly requiresAnyTag?: readonly string[];
}
