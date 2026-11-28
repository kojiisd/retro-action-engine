import type { SwitchCheck } from '@retro-action-engine/core';

/**
 * Text of the in-game menu (ADR-0020), drawn with the pack's pixel font: every character here
 * must be in the font (scripts/font reads this file to make it, and a test checks the sample
 * pack). Public text: changes need the owner's confirmation. The language follows the other
 * screens (`uiStrings`).
 */
export interface MenuStrings {
  readonly items: {
    readonly party: string;
    readonly items: string;
    readonly map: string;
    readonly settings: string;
    readonly close: string;
  };
  /** The one-line help under the window, for each top item. */
  readonly help: {
    readonly party: string;
    readonly items: string;
    readonly map: string;
    readonly settings: string;
    readonly close: string;
  };
  readonly hp: string;
  /** The items page with nothing held (ADR-0021). */
  readonly noItems: string;
  /** The message when the party gets an item (ADR-0021); `name` is the item's name. */
  readonly got: (name: string) => string;
  /** The help line for a party member, by what a switch to them would do now. */
  readonly switch: Readonly<Record<SwitchCheck, string>>;
}

const JA: MenuStrings = {
  items: {
    party: 'パーティ',
    items: 'もちもの',
    map: 'ちず',
    settings: 'せってい',
    close: 'とじる',
  },
  help: {
    party: 'なかまを みる・こうたい する',
    items: 'もっている ものを みる',
    map: 'いま いる へやの ちず',
    settings: 'そうさや がめんを かえる',
    close: 'ゲームに もどる',
  },
  hp: 'HP',
  noItems: 'なにも もって いない',
  got: (name) => `${name} を てにいれた`,
  switch: {
    ok: 'えらぶと こうたい します',
    active: 'いま うごかして います',
    down: 'たおれて います',
    never: 'こうたい できません',
    airborne: 'じめんで こうたい できます',
    cooldown: 'すこし まって ください',
  },
};

const EN: MenuStrings = {
  items: { party: 'Party', items: 'Items', map: 'Map', settings: 'Settings', close: 'Close' },
  help: {
    party: 'See the party and switch',
    items: 'See what you carry',
    map: 'Map of this room',
    settings: 'Controls and display',
    close: 'Back to the game',
  },
  hp: 'HP',
  noItems: 'Nothing yet',
  got: (name) => `Got the ${name}`,
  switch: {
    ok: 'Select to switch',
    active: 'In control now',
    down: 'Knocked out',
    never: 'Cannot switch',
    airborne: 'Switch on the ground',
    cooldown: 'Wait a moment',
  },
};

export const MENU_STRINGS = { ja: JA, en: EN } as const;

/** The menu text in the language of the other screens. */
export function menuStrings(lang: 'ja' | 'en'): MenuStrings {
  return MENU_STRINGS[lang];
}
