import type { Fx } from '../fx/fx';
import type { ColliderFx } from '../world/entity-store';
import type { FeelMotion, FeelProfile } from './feel';
import type { TileClass } from './tile';

/**
 * The part of `PackRuntime` (docs/architecture.md 6) that the simulation reads as of M1-3.
 * `pack` builds it (M4); core tests build it inline. Enemies, items, gimmicks, camera and assets
 * are added with the systems that use them.
 */
export interface CharacterDef {
  readonly id: string;
  /** e.g. `move:swim`. Core only does set operations on them (ADR-0007). */
  readonly abilityTags: readonly string[];
  readonly collider: ColliderFx;
  readonly feelOverrides?: Partial<FeelMotion>;
}

export interface PartyRules {
  readonly members: readonly string[];
  readonly switch: {
    /** `atPoints` needs zones (M3); until then it behaves like `never`. */
    readonly mode: 'anywhere' | 'atPoints' | 'never';
    readonly cooldownTicks: number;
    readonly requireGrounded: boolean;
    /** Position after a switch: the same position, or the room's entry spawn. */
    readonly placement: 'same' | 'spawn';
  };
}

export interface RulesDef {
  readonly party: PartyRules;
}

export interface RoomData {
  readonly id: string;
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** tileClassId per tile, row-major. */
  readonly collision: Uint16Array;
  readonly tileClasses: readonly TileClass[];
  /** Bottom-center positions. */
  readonly spawns: Readonly<Record<string, { readonly x: Fx; readonly y: Fx }>>;
}

export interface PackRuntime {
  readonly id: string;
  readonly version: string;
  readonly tileSize: number;
  readonly rooms: Readonly<Record<string, RoomData>>;
  readonly characters: Readonly<Record<string, CharacterDef>>;
  readonly feel: Readonly<Record<string, FeelProfile>>;
  readonly rules: RulesDef;
}

export interface StartState {
  readonly roomId: string;
  readonly spawnId: string;
  /** Overrides `rules.party.members`. */
  readonly party?: readonly string[];
  readonly seed: number;
  readonly feelProfile: string;
}
