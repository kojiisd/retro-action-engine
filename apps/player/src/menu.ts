import type {
  PackRuntime,
  RoomMap,
  SwitchCheck,
  UiDef,
  UiItem,
  UiMember,
} from '@retro-action-engine/core';
import { localize, textWidth } from '@retro-action-engine/pack';
import type {
  OverlayRect,
  OverlaySprite,
  OverlayText,
  OverlayView,
} from '@retro-action-engine/renderer-phaser';
import type { MenuStrings } from './menu-strings';

/**
 * The in-game menu (ADR-0020): which screen and which line is chosen, how the menu buttons move
 * that, and what to draw. Pure: the wiring (boot.ts) feeds the buttons and carries out the
 * effects (open the settings, close, send a switch command).
 */

export const TOP_ITEMS = ['party', 'items', 'map', 'settings', 'close'] as const;
export type TopItem = (typeof TOP_ITEMS)[number];

export interface MenuState {
  readonly level: 'top' | 'party';
  /** The line chosen in the top list. */
  readonly top: number;
  /** The member chosen in the party list. */
  readonly member: number;
}

/** What a button does in the menu (ADR-0020: confirm or jump, cancel or attack, menu). */
export type MenuButton = 'up' | 'down' | 'confirm' | 'cancel' | 'menu';

export type MenuEffect =
  | { readonly kind: 'close' }
  | { readonly kind: 'openSettings' }
  | { readonly kind: 'switch'; readonly member: number };

/** What the menu needs to know about the game while it is open (the game is stopped). */
export interface MenuContext {
  readonly members: readonly string[];
  readonly activeIndex: number;
  /** Every member's HP; empty when the pack has no HP rules. */
  readonly party: readonly UiMember[];
  readonly switchCheck: (index: number) => SwitchCheck;
  /** The items held, in the pack's order (ADR-0021). */
  readonly items: readonly UiItem[];
  /** The map of the room the party is in (ADR-0020, M3-6b). */
  readonly map: RoomMap;
}

/** The menu as it opens: the top list, its first line; in the party, the active member. */
export function openMenu(context: Pick<MenuContext, 'activeIndex'>): MenuState {
  return { level: 'top', top: 0, member: context.activeIndex };
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** One button press in the menu: the next state, and what the game should do, if anything. */
export function menuStep(
  state: MenuState,
  button: MenuButton,
  context: MenuContext,
): { readonly state: MenuState; readonly effect?: MenuEffect } {
  if (button === 'menu') return { state, effect: { kind: 'close' } };
  if (state.level === 'top') {
    if (button === 'up' || button === 'down') {
      const top = wrap(state.top + (button === 'up' ? -1 : 1), TOP_ITEMS.length);
      return { state: { ...state, top } };
    }
    if (button === 'cancel') return { state, effect: { kind: 'close' } };
    const item = TOP_ITEMS[state.top];
    if (item === 'party')
      return { state: { ...state, level: 'party', member: context.activeIndex } };
    if (item === 'settings') return { state, effect: { kind: 'openSettings' } };
    // The items are only to look at for now (ADR-0021): they show while the line is chosen.
    if (item === 'items' || item === 'map') return { state };
    return { state, effect: { kind: 'close' } };
  }
  // The party list.
  if (button === 'up' || button === 'down') {
    const member = wrap(state.member + (button === 'up' ? -1 : 1), context.members.length);
    return { state: { ...state, member } };
  }
  if (button === 'cancel') return { state: { ...state, level: 'top' } };
  if (context.switchCheck(state.member) === 'ok') {
    return { state, effect: { kind: 'switch', member: state.member } };
  }
  return { state };
}

/** What a character shows in the menu: its name in `language` and its idle picture. */
function memberLook(runtime: PackRuntime, id: string, language: string | undefined) {
  const character = runtime.characters[id];
  const frame = character?.sprite?.animations.idle?.frames[0]?.frame;
  return {
    name: localize(runtime, character?.name ?? id, language),
    atlas: character?.sprite?.atlas,
    frame,
  };
}

/** Sizes of the menu's layout, from the font (ADR-0020). */
function metrics(ui: UiDef) {
  const line = ui.font.cellH + 2;
  return { line, pad: 6, cursorW: 8 };
}

/**
 * The windows, texts and pictures of the menu in `state`, for a display of `width` x `height`
 * (the whole canvas, HUD band included).
 */
export function menuView(
  state: MenuState,
  context: MenuContext,
  look: {
    readonly runtime: PackRuntime;
    readonly ui: UiDef;
    readonly strings: MenuStrings;
    readonly language: string | undefined;
    readonly width: number;
    readonly height: number;
  },
): OverlayView {
  const { ui, strings, width, height } = look;
  const { colors, font } = ui;
  const { line, pad, cursorW } = metrics(ui);
  const rects: OverlayRect[] = [];
  const texts: OverlayText[] = [];
  const sprites: OverlaySprite[] = [];
  const window = (x: number, y: number, w: number, h: number) => {
    rects.push({ x, y, w, h, color: colors.border });
    rects.push({ x: x + 1, y: y + 1, w: w - 2, h: h - 2, color: colors.fill });
  };
  // A right-pointing triangle, 4 px wide, centered on a text line at `y`.
  const cursor = (x: number, y: number) => {
    const mid = y + (font.ascent >> 1) + 1;
    for (let i = 0; i < 4; i++) {
      rects.push({ x: x + i, y: mid - 3 + i, w: 1, h: 7 - 2 * i, color: colors.cursor });
    }
  };

  // The top list, on the left.
  const margin = 6;
  const labels = TOP_ITEMS.map((item) => strings.items[item]);
  const listW =
    pad + cursorW + Math.max(...labels.map((label) => textWidth(font, label))) + pad + 2;
  const listH = pad * 2 + line * TOP_ITEMS.length;
  window(margin, margin, listW, listH);
  labels.forEach((label, i) => {
    const y = margin + pad + i * line;
    const chosen = state.level === 'top' && state.top === i;
    texts.push({ x: margin + pad + cursorW, y, text: label, color: colors.text });
    if (chosen) cursor(margin + pad, y);
  });
  // The party list keeps its item marked while it is open.
  if (state.level === 'party') {
    const y = margin + pad + TOP_ITEMS.indexOf('party') * line;
    texts.push({ x: margin + pad + cursorW, y, text: strings.items.party, color: colors.accent });
  }

  // The content window, on the right, with the help line at its bottom.
  const cx = margin + listW + 4;
  const cw = width - cx - margin;
  const ch = height - margin * 2;
  window(cx, margin, cw, ch);
  const helpY = margin + ch - pad - font.cellH;
  let help = strings.help[TOP_ITEMS[state.top] as TopItem];

  if (state.level === 'party' || TOP_ITEMS[state.top] === 'party') {
    const top = margin + pad;
    texts.push({ x: cx + pad, y: top, text: strings.items.party, color: colors.accent });
    const rowH = line * 2 + 6;
    context.members.forEach((id, i) => {
      const y = top + line + 6 + i * rowH;
      const m = memberLook(look.runtime, id, look.language);
      const check = context.switchCheck(i);
      const active = i === context.activeIndex;
      const nameColor = active ? colors.accent : check === 'ok' ? colors.text : colors.dim;
      if (m.atlas !== undefined && m.frame !== undefined) {
        sprites.push({
          x: cx + pad + cursorW,
          y: y - 2,
          atlas: m.atlas,
          frame: m.frame,
          ...(check === 'down' ? { alpha: 0.4 } : {}),
        });
      }
      const tx = cx + pad + cursorW + 20;
      texts.push({ x: tx, y, text: m.name, color: nameColor });
      const hp = context.party[i];
      if (hp !== undefined && hp.hpMax > 0) {
        const hy = y + line;
        texts.push({ x: tx, y: hy, text: strings.hp, color: colors.text });
        const numbers = `${hp.hp}/${hp.hpMax}`;
        const numbersW = textWidth(font, numbers);
        const nx = cx + cw - pad - numbersW;
        texts.push({ x: nx, y: hy, text: numbers, color: colors.text });
        const gx = tx + textWidth(font, strings.hp) + 4;
        const gw = nx - 6 - gx;
        const gy = hy + font.ascent - 6;
        rects.push({ x: gx, y: gy, w: gw, h: 6, color: colors.gaugeBack });
        const fill = Math.floor(((gw - 2) * Math.max(0, hp.hp)) / hp.hpMax);
        if (fill > 0) rects.push({ x: gx + 1, y: gy + 1, w: fill, h: 4, color: colors.gauge });
      }
      if (state.level === 'party' && state.member === i) {
        cursor(cx + pad, y);
        help = strings.switch[check];
      }
    });
  }
  if (state.level === 'top' && TOP_ITEMS[state.top] === 'items') {
    const top = margin + pad;
    texts.push({ x: cx + pad, y: top, text: strings.items.items, color: colors.accent });
    const rowH = Math.max(line, ITEM_ICON + 2);
    if (context.items.length === 0) {
      texts.push({
        x: cx + pad + cursorW,
        y: top + line + 6,
        text: strings.noItems,
        color: colors.dim,
      });
    }
    context.items.forEach((held, i) => {
      const y = top + line + 6 + i * rowH;
      const item = itemLook(look.runtime, held.id, look.language);
      if (item.sprite !== undefined) {
        sprites.push({ x: cx + pad + cursorW, y: y + ((line - ITEM_ICON) >> 1), ...item.sprite });
      }
      texts.push({ x: cx + pad + cursorW + ITEM_ICON + 4, y, text: item.name, color: colors.text });
      if (held.count > 1) {
        const count = `x${held.count}`;
        const countX = cx + cw - pad - textWidth(font, count);
        texts.push({ x: countX, y, text: count, color: colors.text });
      }
    });
  }
  if (state.level === 'top' && TOP_ITEMS[state.top] === 'map') {
    const top = margin + pad;
    texts.push({ x: cx + pad, y: top, text: strings.items.map, color: colors.accent });
    const area = {
      x: cx + pad,
      y: top + line + 6,
      w: cw - pad * 2,
      h: helpY - 4 - (top + line + 6),
    };
    rects.push(...mapRects(context.map, area, ui));
  }
  texts.push({ x: cx + pad, y: helpY, text: help, color: colors.dim });
  return { dim: 0.5, rects, texts, sprites };
}

/** The largest a screen is drawn on the map, in px wide (half as high, like a screen). */
const MAP_CELL_MAX = 32;

/**
 * The map's rectangles (ADR-0020, M3-6b), centered in `area`: a 2:1 cell per screen, filled
 * when visited, in a dimmer color when only revealed, nothing otherwise; a mark in the screen
 * the party is in, and a small mark on screens with an exit that show.
 */
export function mapRects(
  map: RoomMap,
  area: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ui: UiDef,
): OverlayRect[] {
  const c = ui.colors;
  const color = c.map ?? { visited: c.text, revealed: c.dim, here: c.accent, exit: c.cursor };
  let cellW = Math.min(
    MAP_CELL_MAX,
    Math.floor(area.w / map.cols),
    Math.floor(area.h / map.rows) * 2,
  );
  cellW -= cellW % 2;
  const cellH = cellW >> 1;
  if (cellW < 4) return [];
  const x0 = area.x + ((area.w - cellW * map.cols) >> 1);
  const y0 = area.y + ((area.h - cellH * map.rows) >> 1);
  const rects: OverlayRect[] = [];
  const visited = new Set(map.visited);
  for (let i = 0; i < map.cols * map.rows; i++) {
    const shown = visited.has(i) || map.revealed;
    if (!shown) continue;
    const x = x0 + (i % map.cols) * cellW;
    const y = y0 + Math.floor(i / map.cols) * cellH;
    rects.push({
      x,
      y,
      w: cellW - 1,
      h: cellH - 1,
      color: visited.has(i) ? color.visited : color.revealed,
    });
    if (map.exits.includes(i)) {
      rects.push({ x: x + cellW - 4, y: y + cellH - 4, w: 2, h: 2, color: color.exit });
    }
    if (i === map.here) {
      const s = Math.max(2, cellH >> 2);
      rects.push({
        x: x + ((cellW - 1 - s) >> 1),
        y: y + ((cellH - 1 - s) >> 1),
        w: s,
        h: s,
        color: color.here,
      });
    }
  }
  return rects;
}

/** The size of an item's picture in the menu (the sample pack's item frames). */
const ITEM_ICON = 16;

/** What an item shows: its name in `language` and its picture. */
export function itemLook(runtime: PackRuntime, id: string, language: string | undefined) {
  const item = runtime.items?.[id];
  return {
    name: localize(runtime, item?.name ?? id, language),
    sprite: item?.sprite,
  };
}
