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
  /** Contact damage (M3). */
  readonly hazard?: number;
  /** The tile is solid unless the entity has at least one of these ability tags. */
  readonly requiresAnyTag?: readonly string[];
}
