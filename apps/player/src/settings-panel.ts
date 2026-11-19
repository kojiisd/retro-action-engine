import type { ActionId } from '@retro-action-engine/core';
import type { ActionMap } from '@retro-action-engine/input';
import { STANDARD_PAD } from '@retro-action-engine/input';
import { addBinding, type Binding, bindingsOf, conflicts, removeBinding } from './bindings-edit';
import type { TouchPadMode } from './settings';
import { keyLabel, padLabel, type UiStrings } from './ui-strings';

/** What the panel needs from the app. The panel only draws and edits; the app applies. */
export interface SettingsPanelHost {
  readonly document: Document;
  readonly strings: UiStrings;
  readonly map: ActionMap;
  /** One line about the build (moved here from the corner of the screen). */
  readonly buildInfo: string;
  /** False when settings only last until the page closes (no storage). */
  readonly persistent: boolean;
  touchMode(): TouchPadMode;
  setTouchMode(mode: TouchPadMode): void;
  /** The map's overrides changed: apply and save. */
  bindingsChanged(): void;
  /** Starts listening for the next key or gamepad input; `done` gets it, or undefined (cancel). */
  capture(done: (binding: Binding | undefined) => void): void;
  /** Stops listening (closing the panel, another row). */
  cancelCapture(): void;
  /** The close button (or Esc) was used. */
  requestClose(): void;
}

export interface SettingsPanel {
  readonly element: HTMLElement;
  readonly open: boolean;
  show(): void;
  hide(): void;
}

const GEAR =
  'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7Z';

/** The gear button that opens the settings (HUD band, right end). No text, an icon. */
export function createGearButton(doc: Document, s: UiStrings, onClick: () => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'settings-button';
  button.setAttribute('aria-label', s.openSettings);
  button.title = s.openSettings;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 26 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GEAR);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  button.append(svg);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * The settings screen (docs/input-and-feel.md 4.3): the controls of every action the pack binds,
 * with add (the next key or button), remove, and reset to the pack's defaults; the touch pad
 * mode; the build information. Text comes from `UiStrings` only.
 */
export function createSettingsPanel(host: SettingsPanelHost): SettingsPanel {
  const { document: doc, strings: s, map } = host;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const root = el('div', 'settings');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', s.settings);
  root.lang = s.lang;
  root.hidden = true;
  let open = false;
  let capturing: ActionId | undefined;

  const label = (b: Binding): string => {
    if (b.device === 'keyboard') return keyLabel(b.code, s);
    const text = padLabel(b.input, s);
    return b.pad === STANDARD_PAD ? text : `${text}（${s.otherPad}）`;
  };

  const startCapture = (action: ActionId) => {
    host.cancelCapture();
    capturing = action;
    render();
    host.capture((binding) => {
      capturing = undefined;
      if (binding !== undefined) {
        map.setOverrides(addBinding(map, action, binding));
        host.bindingsChanged();
      }
      render();
    });
  };

  const render = () => {
    const panel = el('div', 'settings-panel');
    const header = el('header', 'settings-header');
    header.append(el('h2', undefined, s.settings));
    const close = el('button', 'settings-close', s.close);
    close.type = 'button';
    close.addEventListener('click', () => host.requestClose());
    header.append(close);
    panel.append(header);

    const controls = el('section', 'settings-section');
    controls.append(el('h3', undefined, s.bindingsTitle));
    const list = el('ul', 'settings-bindings');
    for (const action of map.packActions()) {
      const row = el('li', 'settings-row');
      row.dataset.action = action;
      row.append(el('span', 'settings-action', s.actions[action]));
      const chips = el('span', 'settings-chips');
      const bindings = bindingsOf(map, action);
      if (bindings.length === 0) chips.append(el('span', 'settings-unbound', s.unbound));
      for (const binding of bindings) {
        const chip = el('span', 'settings-chip');
        chip.dataset.input = binding.device === 'keyboard' ? binding.code : binding.input;
        if (binding.device === 'gamepad' && binding.pad !== STANDARD_PAD) chip.title = binding.pad;
        const text = label(binding);
        if (conflicts(map, action, binding)) {
          chip.classList.add('settings-conflict');
          chip.title = s.conflict;
          chip.append(el('span', 'settings-warn', '⚠'));
        }
        chip.append(el('span', 'settings-chip-label', text));
        const remove = el('button', 'settings-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', s.remove(text));
        remove.addEventListener('click', () => {
          map.setOverrides(removeBinding(map, action, binding));
          host.bindingsChanged();
          render();
        });
        chip.append(remove);
        chips.append(chip);
      }
      row.append(chips);
      if (capturing === action) {
        row.classList.add('settings-capturing');
        row.append(el('span', 'settings-prompt', s.capturePrompt));
      } else {
        const add = el('button', 'settings-add', s.add);
        add.type = 'button';
        add.addEventListener('click', () => startCapture(action));
        row.append(add);
      }
      list.append(row);
    }
    controls.append(list);
    const reset = el('button', 'settings-reset', s.reset);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      host.cancelCapture();
      capturing = undefined;
      map.setOverrides({});
      host.bindingsChanged();
      render();
    });
    controls.append(reset);
    panel.append(controls);

    const touch = el('section', 'settings-section');
    touch.append(el('h3', undefined, s.touchTitle));
    const options: ReadonlyArray<readonly [TouchPadMode, string]> = [
      ['auto', s.touchAuto],
      ['show', s.touchShow],
      ['hide', s.touchHide],
    ];
    for (const [mode, text] of options) {
      const option = el('label', 'settings-option');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'touch-pad';
      radio.value = mode;
      radio.checked = host.touchMode() === mode;
      radio.addEventListener('change', () => host.setTouchMode(mode));
      option.append(radio, doc.createTextNode(` ${text}`));
      touch.append(option);
    }
    panel.append(touch);

    const footer = el('footer', 'settings-footer');
    if (!host.persistent) footer.append(el('p', 'settings-note', s.notSaved));
    footer.append(el('p', 'settings-build', `${s.buildInfo}: ${host.buildInfo}`));
    panel.append(footer);

    root.replaceChildren(panel);
  };

  // Esc closes the panel (while capturing, the capture gets Esc and cancels instead). On the
  // document, so that it works wherever the focus is.
  doc.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape' && capturing === undefined) {
      event.preventDefault();
      host.requestClose();
    }
  });

  return {
    element: root,
    get open() {
      return open;
    },
    show() {
      if (open) return;
      open = true;
      render();
      root.hidden = false;
      root.querySelector<HTMLElement>('.settings-close')?.focus();
    },
    hide() {
      if (!open) return;
      open = false;
      host.cancelCapture();
      capturing = undefined;
      root.hidden = true;
    },
  };
}
