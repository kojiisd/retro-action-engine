import type { TouchLayout } from '@retro-action-engine/core';
import {
  moveTouchPart,
  resizeTouchPart,
  setTouchFloating,
  setTouchHandedness,
  setTouchOpacity,
  TOUCH_OPACITY_MIN,
  TOUCH_SIZE_MAX,
  TOUCH_SIZE_MIN,
  type TouchPadView,
  type TouchPart,
  touchPartScale,
} from '@retro-action-engine/input';
import type { Orientation } from './settings';
import type { UiStrings } from './ui-strings';

/** What the editor needs from the app. The editor edits; the app keeps and saves. */
export interface TouchLayoutEditorHost {
  readonly document: Document;
  readonly strings: UiStrings;
  readonly pad: TouchPadView;
  /** The pack's own layout (what "reset" goes back to, and what sizes are relative to). */
  readonly base: TouchLayout;
  orientation(): Orientation;
  /** The layout in use for an orientation (the pack's, or the user's). */
  layout(orientation: Orientation): TouchLayout;
  /** Saves the user's layout for an orientation; `null` goes back to the pack's. */
  save(orientation: Orientation, layout: TouchLayout | null): void;
  /** "Done" (or Esc): the editor has closed. */
  done(): void;
}

export interface TouchLayoutEditor {
  readonly element: HTMLElement;
  readonly open: boolean;
  show(): void;
  /** Leaves edit mode (the app calls `done` itself when it closes the editor this way). */
  hide(): void;
  /** The screen turned: edit the layout of the new orientation. */
  orientationChanged(): void;
}

/**
 * The virtual pad layout editor (docs/input-and-feel.md 9.5). The pad itself is the canvas:
 * drag a part to move it, tap it to select it; the bar holds the size of the selected part, the
 * opacity (landscape only: in portrait the pad is not over the game), left/right, the floating
 * stick, reset and done. Every change is saved at once, for the orientation being edited.
 */
export function createTouchLayoutEditor(host: TouchLayoutEditorHost): TouchLayoutEditor {
  const { document: doc, strings: s, pad, base } = host;
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

  const root = el('div', 'touch-editor');
  root.setAttribute('role', 'dialog');
  root.lang = s.lang;
  root.hidden = true;
  let open = false;
  let orientation: Orientation = 'landscape';
  let layout = base;
  let selected: TouchPart | undefined;

  const save = () => host.save(orientation, layout);
  const show = (next: TouchLayout) => {
    layout = next;
    pad.setLayout(layout);
  };
  const partName = (part: TouchPart) => (part === 'dpad' ? s.touchStick : s.actions[part]);

  /** A labeled range input (percent), which shows the layout as it is dragged. */
  const slider = (
    name: string,
    text: string,
    min: number,
    max: number,
    value: number,
    change: (v: number) => TouchLayout,
  ) => {
    const label = el('label', 'touch-editor-field');
    const input = el('input');
    input.type = 'range';
    input.name = name;
    input.min = String(Math.round(min * 100));
    input.max = String(Math.round(max * 100));
    input.step = '5';
    input.value = String(Math.round(value * 100));
    input.addEventListener('input', () => show(change(Number(input.value) / 100)));
    input.addEventListener('change', save);
    label.append(el('span', undefined, text), input);
    return label;
  };

  const checkbox = (
    name: string,
    text: string,
    checked: boolean,
    change: (on: boolean) => TouchLayout,
  ) => {
    const label = el('label', 'touch-editor-field');
    const box = el('input');
    box.type = 'checkbox';
    box.name = name;
    box.checked = checked;
    box.addEventListener('change', () => {
      show(change(box.checked));
      save();
    });
    label.append(box, doc.createTextNode(` ${text}`));
    return label;
  };

  const render = () => {
    root.setAttribute('aria-label', s.touchEditTitle(orientation));
    const bar = el('div', 'touch-editor-bar');
    // Title and buttons on one row, to keep the bar low over the pad.
    const header = el('div', 'touch-editor-header');
    header.append(el('h2', undefined, s.touchEditTitle(orientation)));
    bar.append(header);
    bar.append(el('p', 'touch-editor-hint', s.touchEditHint));

    const fields = el('div', 'touch-editor-fields');
    const part = selected;
    if (part !== undefined) {
      fields.append(
        slider(
          'touch-size',
          s.touchEditSize(partName(part)),
          TOUCH_SIZE_MIN,
          TOUCH_SIZE_MAX,
          touchPartScale(base, layout, part),
          (v) => resizeTouchPart(base, layout, part, v),
        ),
      );
    }
    // In portrait the pad is below the game screen and fully shown: no opacity to choose.
    if (orientation === 'landscape') {
      fields.append(
        slider('touch-opacity', s.touchEditOpacity, TOUCH_OPACITY_MIN, 1, layout.opacity, (v) =>
          setTouchOpacity(layout, v),
        ),
      );
    }
    fields.append(
      checkbox('touch-mirror', s.touchEditMirror, layout.handedness === 'left', (on) =>
        setTouchHandedness(layout, on ? 'left' : 'right'),
      ),
      checkbox('touch-floating', s.touchEditFloating, layout.dpad.floating, (on) =>
        setTouchFloating(layout, on),
      ),
    );
    bar.append(fields);

    const actions = el('div', 'touch-editor-actions');
    const reset = el('button', 'touch-editor-reset', s.touchEditReset);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      selected = undefined;
      pad.setSelected(undefined);
      show(base);
      host.save(orientation, null);
      render();
    });
    const done = el('button', 'touch-editor-done', s.touchEditDone);
    done.type = 'button';
    done.addEventListener('click', () => close());
    actions.append(reset, done);
    header.append(actions);
    root.replaceChildren(bar);
  };

  const close = () => {
    if (!open) return;
    editor.hide();
    host.done();
  };

  const start = () => {
    orientation = host.orientation();
    selected = undefined;
    pad.setSelected(undefined);
    show(host.layout(orientation));
    render();
  };

  doc.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  const editor: TouchLayoutEditor = {
    element: root,
    get open() {
      return open;
    },
    show() {
      if (open) return;
      open = true;
      pad.setEditing({
        select(part) {
          // A touched part is being dragged: the bar lets the pad under it show through.
          root.dataset.dragging = String(part !== undefined);
          selected = part;
          pad.setSelected(part);
          render();
        },
        move(part, x, y, width, height) {
          show(moveTouchPart(layout, part, x, y, width, height));
        },
        end() {
          root.dataset.dragging = 'false';
          save();
        },
      });
      start();
      root.hidden = false;
      root.querySelector<HTMLElement>('.touch-editor-done')?.focus();
    },
    hide() {
      if (!open) return;
      open = false;
      root.hidden = true;
      pad.setEditing(undefined);
    },
    orientationChanged() {
      if (open && host.orientation() !== orientation) start();
    },
  };
  return editor;
}
