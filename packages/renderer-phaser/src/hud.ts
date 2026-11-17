import type { PackRuntime, UiState } from '@retro-action-engine/core';

/** One party icon in the HUD band. No text (M1-5). */
export interface HudIcon {
  readonly characterId: string;
  readonly atlas: string;
  readonly frame: string;
  readonly active: boolean;
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
    return [{ characterId: id, atlas: sprite.atlas, frame, active: id === ui.activeCharacterId }];
  });
}
