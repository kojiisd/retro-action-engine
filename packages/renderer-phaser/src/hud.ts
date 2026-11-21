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
/**
 * The HP gauge of a member (ADR-0016): a bar of fixed length that shrinks pixel by pixel with
 * the HP left, so that a fine-grained HP shows every small loss. No text.
 */
export const HP_BAR = { w: 40, h: 5 } as const;
/** Space between the icon and its gauge, and between members. */
const HP_LEFT = 3;
const MEMBER_GAP = 6;

export interface HudBar {
  readonly x: number;
  readonly y: number;
  /** The whole bar (HP lost shows as the part beyond `fill`). */
  readonly w: number;
  readonly h: number;
  /** px of the bar that are full: floor(w * hp / max), and at least 1 while any HP is left. */
  readonly fill: number;
  /** Which icon it belongs to. */
  readonly icon: number;
}

/** px of a gauge of `width` that show `hp` of `max`. */
export function gaugeFill(hp: number, max: number, width: number): number {
  if (max <= 0 || hp <= 0) return 0;
  // A member with any HP left never looks empty.
  return Math.max(1, Math.min(width, Math.floor((width * hp) / max)));
}

/**
 * Where the icons and the HP gauges go in a band of `bandHeight` px: icons from the left, each
 * followed by its gauge, vertically centered. `iconWidths` are the icons' frame widths.
 */
export function hudLayout(
  icons: readonly HudIcon[],
  iconWidths: readonly number[],
  bandHeight: number,
): { readonly icons: ReadonlyArray<{ x: number; y: number }>; readonly bars: HudBar[] } {
  const placed: Array<{ x: number; y: number }> = [];
  const bars: HudBar[] = [];
  const barY = Math.floor((bandHeight - HP_BAR.h) / 2);
  let x = HUD_PAD;
  icons.forEach((icon, i) => {
    placed.push({ x, y: HUD_PAD });
    x += iconWidths[i] ?? 0;
    if (icon.hp !== undefined) {
      x += HP_LEFT;
      bars.push({
        x,
        y: barY,
        w: HP_BAR.w,
        h: HP_BAR.h,
        fill: gaugeFill(icon.hp.value, icon.hp.max, HP_BAR.w),
        icon: i,
      });
      x += HP_BAR.w;
    }
    x += MEMBER_GAP;
  });
  return { icons: placed, bars };
}
