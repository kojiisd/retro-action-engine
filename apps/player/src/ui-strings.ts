import type { ActionId } from '@retro-action-engine/core';

/**
 * Text of the engine's own screens (ADR-0008, revision 2026-11-19): Japanese when the browser
 * prefers it, English otherwise. Public text: changes need the owner's confirmation.
 */
export interface UiStrings {
  readonly lang: 'ja' | 'en';
  readonly settings: string;
  readonly openSettings: string;
  /** The gear's label when it opens the game menu (ADR-0020). */
  readonly openMenu: string;
  readonly close: string;
  readonly bindingsTitle: string;
  readonly add: string;
  readonly remove: (input: string) => string;
  readonly capturePrompt: string;
  readonly reset: string;
  readonly conflict: string;
  readonly unbound: string;
  readonly touchTitle: string;
  readonly touchAuto: string;
  readonly touchShow: string;
  readonly touchHide: string;
  readonly touchEdit: string;
  readonly touchEditTitle: (orientation: 'landscape' | 'portrait') => string;
  readonly touchEditHint: string;
  readonly touchStick: string;
  readonly touchEditSize: (part: string) => string;
  readonly touchEditOpacity: string;
  readonly touchEditMirror: string;
  readonly touchEditFloating: string;
  readonly touchEditReset: string;
  readonly touchEditDone: string;
  readonly notSaved: string;
  readonly feelTitle: string;
  readonly feelNote: string;
  readonly smoothingTitle: string;
  readonly smoothingProfile: string;
  readonly smoothingLinear: string;
  readonly smoothingNone: string;
  readonly buildInfo: string;
  readonly otherPad: string;
  readonly actions: Readonly<Record<ActionId, string>>;
  readonly keys: Readonly<Record<string, string>>;
  readonly button: (n: string) => string;
  readonly dpad: (direction: string) => string;
  readonly leftStick: (direction: string) => string;
  readonly axis: (n: string, sign: string) => string;
}

const ARROWS = { Up: '↑', Down: '↓', Left: '←', Right: '→' } as const;

const JA: UiStrings = {
  lang: 'ja',
  settings: '設定',
  openSettings: '設定を開く',
  openMenu: 'メニューを開く',
  close: '閉じる',
  bindingsTitle: '操作の割り当て',
  add: '追加',
  remove: (input) => `${input} を外す`,
  capturePrompt: 'キーかボタンを押してください（Esc で中止）',
  reset: '既定に戻す',
  conflict: 'ほかの操作にも割り当てられています',
  unbound: '割り当てなし',
  touchTitle: 'タッチ操作のパッド',
  touchAuto: '自動（タッチ画面で、ゲームパッドが無いとき）',
  touchShow: '常に表示',
  touchHide: '表示しない',
  touchEdit: '配置を変える',
  touchEditTitle: (o) => (o === 'landscape' ? 'パッドの配置（横向き）' : 'パッドの配置（縦向き）'),
  touchEditHint:
    'スティックやボタンをドラッグして動かします。タップして選ぶと大きさを変えられます。',
  touchStick: 'スティック',
  touchEditSize: (part) => `大きさ（${part}）`,
  touchEditOpacity: '濃さ',
  touchEditMirror: '左右を入れ替える',
  touchEditFloating: 'スティックを触れた位置に出す',
  touchEditReset: 'この向きを既定に戻す',
  touchEditDone: '完了',
  notSaved: 'この端末では設定を保存できません。ページを閉じると元に戻ります。',
  feelTitle: '操作感',
  feelNote: '切り替えると、部屋の入口からやり直します。',
  smoothingTitle: '動きの補間',
  smoothingProfile: '操作感に合わせる',
  smoothingLinear: '滑らか',
  smoothingNone: 'なし（コマ送り）',
  buildInfo: 'ビルド情報',
  otherPad: 'ほかのパッド',
  actions: {
    left: '左',
    right: '右',
    up: '上',
    down: '下',
    jump: 'ジャンプ',
    attack: '攻撃',
    switch: 'キャラクター切替',
    item: 'アイテム',
    pause: 'ポーズ',
    menu: 'メニュー',
    confirm: '決定',
    cancel: 'キャンセル',
    extra1: '拡張 1',
    extra2: '拡張 2',
    extra3: '拡張 3',
    extra4: '拡張 4',
  },
  keys: {
    Space: 'スペース',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'BackSpace',
    ShiftLeft: '左 Shift',
    ShiftRight: '右 Shift',
    ControlLeft: '左 Ctrl',
    ControlRight: '右 Ctrl',
    AltLeft: '左 Alt',
    AltRight: '右 Alt',
  },
  button: (n) => `ボタン ${n}`,
  dpad: (d) => `十字キー ${d}`,
  leftStick: (d) => `左スティック ${d}`,
  axis: (n, sign) => `軸 ${n} ${sign}`,
};

const EN: UiStrings = {
  lang: 'en',
  settings: 'Settings',
  openSettings: 'Open settings',
  openMenu: 'Open the menu',
  close: 'Close',
  bindingsTitle: 'Controls',
  add: 'Add',
  remove: (input) => `Remove ${input}`,
  capturePrompt: 'Press a key or button (Esc to cancel)',
  reset: 'Reset to defaults',
  conflict: 'Also assigned to another control',
  unbound: 'Not assigned',
  touchTitle: 'Touch pad',
  touchAuto: 'Auto (on touch screens without a gamepad)',
  touchShow: 'Always show',
  touchHide: 'Hide',
  touchEdit: 'Edit layout',
  touchEditTitle: (o) => (o === 'landscape' ? 'Pad layout (landscape)' : 'Pad layout (portrait)'),
  touchEditHint: 'Drag the stick and buttons to move them. Tap one to change its size.',
  touchStick: 'Stick',
  touchEditSize: (part) => `Size (${part})`,
  touchEditOpacity: 'Opacity',
  touchEditMirror: 'Swap left and right',
  touchEditFloating: 'Stick appears where you touch',
  touchEditReset: 'Reset this layout',
  touchEditDone: 'Done',
  notSaved: 'Settings cannot be saved on this device. They reset when the page closes.',
  feelTitle: 'Feel',
  feelNote: 'Switching starts the room over.',
  smoothingTitle: 'Motion smoothing',
  smoothingProfile: 'Match the feel',
  smoothingLinear: 'Smooth',
  smoothingNone: 'Off (frame by frame)',
  buildInfo: 'Build',
  otherPad: 'other pad',
  actions: {
    left: 'Left',
    right: 'Right',
    up: 'Up',
    down: 'Down',
    jump: 'Jump',
    attack: 'Attack',
    switch: 'Switch character',
    item: 'Item',
    pause: 'Pause',
    menu: 'Menu',
    confirm: 'Confirm',
    cancel: 'Cancel',
    extra1: 'Extra 1',
    extra2: 'Extra 2',
    extra3: 'Extra 3',
    extra4: 'Extra 4',
  },
  keys: {
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'Backspace',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  },
  button: (n) => `Button ${n}`,
  dpad: (d) => `D-pad ${d}`,
  leftStick: (d) => `Left stick ${d}`,
  axis: (n, sign) => `Axis ${n} ${sign}`,
};

/** Japanese if the browser's first language is Japanese, English otherwise. */
export function uiStrings(languages: readonly string[]): UiStrings {
  return languages[0]?.toLowerCase().startsWith('ja') === true ? JA : EN;
}

/** How a `KeyboardEvent.code` is shown: the letter, digit or arrow, else a name. */
export function keyLabel(code: string, s: UiStrings): string {
  const named = s.keys[code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) return letter[1] as string;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit !== null) return digit[1] as string;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow !== null) return ARROWS[arrow[1] as keyof typeof ARROWS];
  return code;
}

/** How a gamepad input is shown. */
export function padLabel(input: string, s: UiStrings): string {
  const button = /^button(\d+)$/.exec(input);
  if (button !== null) return s.button(button[1] as string);
  const dpad = /^dpad(Up|Down|Left|Right)$/.exec(input);
  if (dpad !== null) return s.dpad(ARROWS[dpad[1] as keyof typeof ARROWS]);
  const stick = /^leftStick(Up|Down|Left|Right)$/.exec(input);
  if (stick !== null) return s.leftStick(ARROWS[stick[1] as keyof typeof ARROWS]);
  const axis = /^axis(\d+)([+-])$/.exec(input);
  if (axis !== null) return s.axis(axis[1] as string, axis[2] as string);
  return input;
}
