import type { PackRuntime, UiState } from '@retro-action-engine/core';

/** One party icon in the HUD band. No text (M1-5). */
export interface HudIcon {
  readonly characterId: string;
  readonly atlas: string;
  readonly frame: string;
  readonly active: boolean;
  /** False once the member's HP is 0 (ADR-0016). Always true without HP. */
  readonly alive: boolean;
  /** HP and its maximum, when the pack has HP. */
  readonly hp?: { readonly value: number; readonly max: number };
}

/**
 * What the HUD shows: every party member's icon (the first frame of its `idle` animation), the
 * active one highlighted. Without switching (one member, or `mode: 'never'`) only the active
 * character is shown, so there is nothing that looks like a switch control.
 */
export function hudIcons(ui: UiState, members: readonly string[], runtime: PackRuntime): HudIcon[] {
  const shown = ui.canSwitch ? members : [ui.activeCharacterId];
  return shown.flatMap((id) => {
    const sprite = runtime.characters[id]?.sprite;
    const frame = sprite?.animations.idle?.frames[0]?.frame;
    if (sprite === undefined || frame === undefined) return [];
    const member = ui.party.find((m) => m.id === id);
    return [
      {
        characterId: id,
        atlas: sprite.atlas,
        frame,
        active: id === ui.activeCharacterId,
        alive: member?.alive ?? true,
        ...(member === undefined ? {} : { hp: { value: member.hp, max: member.hpMax } }),
      },
    ];
  });
}

/** Layout of the HUD band, in px. Drawing only: these numbers never reach the game. */
export const HUD_PAD = 2;
/** One HP cell (ADR-0016: one small square per HP, no text). */
export const HP_CELL = { w: 3, h: 6, gap: 1 } as const;
/** Space between the icon and its HP cells, and between members. */
const HP_LEFT = 2;
const MEMBER_GAP = 6;

export interface HudCell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** True for HP left, false for HP lost. */
  readonly full: boolean;
  /** Which icon it belongs to. */
  readonly icon: number;
}

/**
 * Where the icons and the HP cells go in a band of `bandHeight` px: icons from the left, each
 * followed by its cells in a row, vertically centered. `iconWidths` are the icons' frame widths.
 */
export function hudLayout(
  icons: readonly HudIcon[],
  iconWidths: readonly number[],
  bandHeight: number,
): { readonly icons: ReadonlyArray<{ x: number; y: number }>; readonly cells: HudCell[] } {
  const placed: Array<{ x: number; y: number }> = [];
  const cells: HudCell[] = [];
  const cellY = Math.floor((bandHeight - HP_CELL.h) / 2);
  let x = HUD_PAD;
  icons.forEach((icon, i) => {
    placed.push({ x, y: HUD_PAD });
    x += iconWidths[i] ?? 0;
    if (icon.hp !== undefined) {
      x += HP_LEFT;
      for (let k = 0; k < icon.hp.max; k++) {
        cells.push({ x, y: cellY, w: HP_CELL.w, h: HP_CELL.h, full: k < icon.hp.value, icon: i });
        x += HP_CELL.w + HP_CELL.gap;
      }
    }
    x += MEMBER_GAP;
  });
  return { icons: placed, cells };
}
