import type { Fx } from '../fx/fx';
import type { ColliderFx } from '../world/entity-store';
import type { FeelMotion, FeelProfile } from './feel';
import type { InputDefaults } from './input-bindings';
import type { TileClass } from './tile';

/** One animation of a sprite (docs/pack-spec.md 4.1). Core advances it tick by tick. */
export interface AnimationDef {
  readonly frames: ReadonlyArray<{
    readonly frame: string;
    readonly ticks: number;
    /**
     * Attack hitbox on this frame (ADR-0017), from the feet center, for a character facing
     * right; mirrored when facing left. Fx.
     */
    readonly hitbox?: { readonly x: Fx; readonly y: Fx; readonly w: Fx; readonly h: Fx };
  }>;
  readonly loop: boolean;
}

export interface SpriteDef {
  /** Atlas key (`files.atlases` in pack.json). */
  readonly atlas: string;
  /**
   * By name. Core picks `idle`, `run`, `jump` and `fall` from the movement state; a missing one
   * falls back to `idle`.
   */
  readonly animations: Readonly<Record<string, AnimationDef>>;
}

/**
 * The part of `PackRuntime` (docs/architecture.md 6) that core reads. `pack` builds it; core
 * tests build it inline. Enemies, items, gimmicks and camera are added with the systems that
 * use them.
 */
export interface CharacterDef {
  readonly id: string;
  /** Display name (`@strings:` keys come with M3). */
  readonly name?: string;
  /** e.g. `move:swim`. Core only does set operations on them (ADR-0007). */
  readonly abilityTags: readonly string[];
  readonly collider: ColliderFx;
  readonly feelOverrides?: Partial<FeelMotion>;
  /** How it is drawn. Without it, the character has no sprite in the render snapshot. */
  readonly sprite?: SpriteDef;
  /** Required for every party member when `rules.hp` is set (ADR-0016). */
  readonly hp?: { readonly max: number };
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

/** HP rules (ADR-0007, the part ADR-0016 brings forward). Without them there is no HP. */
export interface HpRules {
  readonly scope: 'perCharacter';
  /** When the active character's HP reaches 0. */
  readonly onDeath: 'switchToAlive' | 'respawnAtSavePoint';
  /** When no member is left: back where the party entered the room (no save points yet). */
  readonly onAllDown: 'respawnAtSavePoint';
}

/** One kind of HP-draining tile (ADR-0016). */
export interface HazardDef {
  readonly damage: number;
  readonly intervalTicks: number;
  /** The first entry whose tags the active character has (any of them) replaces the values. */
  readonly byTag?: ReadonlyArray<{
    readonly anyTag: readonly string[];
    readonly damage?: number;
    readonly intervalTicks?: number;
  }>;
}

export interface RulesDef {
  readonly party: PartyRules;
  readonly hp?: HpRules;
  /** By name (a tile's `hazard`). Needs `hp`. */
  readonly hazards?: Readonly<Record<string, HazardDef>>;
}

/** A tile layer for drawing only (`bg`, `main`, `fg`). Core never reads it. */
export interface RenderLayerData {
  readonly name: string;
  /** Tileset key. */
  readonly tileset: string;
  /** Tile index in the tileset per cell, rows of `widthTiles`; -1 is empty. */
  readonly data: ReadonlyArray<ReadonlyArray<number>>;
}

/** A way out of a room (ADR-0018). */
export interface ExitDef {
  /** `edge`: on the room's border; `door`: `up` on the ground; `warp`: on touch. */
  readonly kind: 'edge' | 'door' | 'warp';
  /** Top-left and size, Fx. */
  readonly rect: { readonly x: Fx; readonly y: Fx; readonly w: Fx; readonly h: Fx };
  readonly toRoomId: string;
  readonly spawnId: string;
  readonly effect: 'cut' | 'fade';
  /** Only a character with one of these effective tags can go through. */
  readonly requiresAnyTag?: readonly string[];
}

/** How rooms change (ADR-0018): `camera.json`'s `roomTransition`. */
export interface RoomTransitionDef {
  readonly effect: 'cut' | 'fade';
  /** Ticks the simulation stops for (fade: half dark, half light). */
  readonly lockTicks: number;
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
  /** Drawing only; `pack` fills it from the Tiled layers. */
  readonly renderLayers?: readonly RenderLayerData[];
  /** Ways out, in the order they are checked (ADR-0018). */
  readonly exits?: readonly ExitDef[];
}

/** Images the renderer loads (`pack` resolves the paths). Core never reads them. */
export interface AssetManifest {
  /** Atlas key -> JSON Hash atlas and its image. */
  readonly atlases: Readonly<Record<string, { readonly json: string; readonly image: string }>>;
  /** Tileset key -> image, with the tile size and the number of columns in the image. */
  readonly tilesets: Readonly<
    Record<string, { readonly image: string; readonly columns: number; readonly tileCount: number }>
  >;
}

/** Screen layout (docs/pack-spec.md 3). Core never reads it. */
export interface DisplayDef {
  readonly width: number;
  readonly height: number;
  readonly hudReserve: { readonly top: number; readonly bottom: number };
  readonly orientation: 'landscape' | 'portrait' | 'any';
}

export interface PackRuntime {
  readonly id: string;
  readonly version: string;
  /** Display name. The fields from here to `assets` are filled by `pack`; core does not use them. */
  readonly name?: string;
  /** Where a new game starts. */
  readonly entry?: { readonly roomId: string; readonly spawnId: string };
  /** The feel profile a new game uses. */
  readonly feelDefault?: string;
  readonly display?: DisplayDef;
  /** Default key and gamepad bindings (docs/pack-spec.md 4.7). */
  readonly input?: InputDefaults;
  readonly assets?: AssetManifest;
  readonly tileSize: number;
  readonly rooms: Readonly<Record<string, RoomData>>;
  readonly characters: Readonly<Record<string, CharacterDef>>;
  readonly feel: Readonly<Record<string, FeelProfile>>;
  readonly rules: RulesDef;
  /** Room changes (ADR-0018). Without it: `cut` with no stop. */
  readonly roomTransition?: RoomTransitionDef;
}

export interface StartState {
  readonly roomId: string;
  readonly spawnId: string;
  /** Overrides `rules.party.members`. */
  readonly party?: readonly string[];
  readonly seed: number;
  readonly feelProfile: string;
}
