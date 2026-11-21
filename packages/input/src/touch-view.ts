import type { ActionId, TouchLayout } from '@retro-action-engine/core';
import type { FocusTargets } from './input-buffer';
import { type PlacedLayout, placeLayout, sectorMask } from './touch-geometry';
import { type TouchPart, touchPartAt } from './touch-layout-edit';
import type { TouchPadDevice, TouchPadState } from './touch-pad';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Icons in a -1..1 box (docs/input-and-feel.md 9.1). No text: the HUD has none either. Actions
 * without an icon get a plain button.
 */
const ICONS: Partial<Record<ActionId, string>> = {
  // An arrow pointing up.
  jump: 'M0,-0.55 L0.45,0 L0.18,0 L0.18,0.5 L-0.18,0.5 L-0.18,0 L-0.45,0 Z',
  // A sword pointing up (ADR-0017): blade with its tip, guard, grip and pommel.
  attack:
    'M0,-0.62 L0.09,-0.48 L0.09,0.14 L-0.09,0.14 L-0.09,-0.48 Z ' +
    'M-0.32,0.14 L0.32,0.14 L0.32,0.24 L-0.32,0.24 Z ' +
    'M-0.06,0.24 L0.06,0.24 L0.06,0.46 L-0.06,0.46 Z ' +
    'M-0.1,0.46 L0.1,0.46 L0.1,0.56 L-0.1,0.56 Z',
  // Two arrows pointing opposite ways: swap.
  switch:
    'M-0.5,-0.29 L0.2,-0.29 L0.2,-0.42 L0.5,-0.22 L0.2,-0.02 L0.2,-0.15 L-0.5,-0.15 Z ' +
    'M0.5,0.15 L-0.2,0.15 L-0.2,0.02 L-0.5,0.22 L-0.2,0.42 L-0.2,0.29 L0.5,0.29 Z',
};

/**
 * The d-pad looks like an analog stick (owner's choice, 2026-11-19): a ring, and a knob that
 * follows the finger. Drawing proportions of the ring's radius; the input stays 8-way (9.2).
 */
const KNOB_RADIUS = 0.4;
/** How far the knob's center may leave the ring's center. */
const KNOB_TRAVEL = 0.6;
const REST_RADIUS = 0.34;

/** What the layout editor is told while the pad is being edited (docs/input-and-feel.md 9.5). */
export interface TouchEditHandlers {
  /** A part was touched, or the empty area (`undefined`). */
  select(part: TouchPart | undefined): void;
  /** The touched part is dragged: its center should go to (x, y) px in a `width` x `height` area. */
  move(part: TouchPart, x: number, y: number, width: number, height: number): void;
  /** The finger dragging `part` left the screen. */
  end(part: TouchPart): void;
}

export interface TouchPadView {
  /** Shows or hides the pad. Hiding lets go of every finger. */
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  /** Shows or hides one action's button (e.g. `switch` when the party cannot switch). */
  setActionEnabled(action: ActionId, enabled: boolean): void;
  /** Uses another layout (the user's changes), placed at once. */
  setLayout(layout: TouchLayout): void;
  /**
   * Edit mode: touches go to `handlers` instead of the game, and every button is shown (also
   * hidden ones). `undefined` goes back to play.
   */
  setEditing(handlers: TouchEditHandlers | undefined): void;
  /** The part drawn as selected in edit mode. */
  setSelected(part: TouchPart | undefined): void;
  /** Places the layout again for the area's current size. */
  refresh(): void;
  destroy(): void;
}

export interface MountOptions {
  readonly document: Document;
  readonly focus: FocusTargets;
}

/**
 * Draws the virtual pad in `area` (an element the app positions inside the safe area) and feeds
 * its pointers to `device`. The opacity of the layout is set as the CSS variable
 * `--touch-opacity`, for the app to use where the pad sits over the game screen.
 */
export function mountTouchPad(
  area: HTMLElement,
  device: TouchPadDevice,
  layout: TouchLayout,
  options: MountOptions,
): TouchPadView {
  const doc = options.document;
  const root = doc.createElement('div');
  root.className = 'touch-pad';
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    touchAction: 'none',
    userSelect: 'none',
    webkitUserSelect: 'none',
  });
  root.style.setProperty('-webkit-touch-callout', 'none');
  let current = layout;
  let editing: TouchEditHandlers | undefined;
  let selected: TouchPart | undefined;
  /** The finger dragging a part in edit mode, and its offset from the part's center. */
  let drag: { id: number; part: TouchPart; dx: number; dy: number } | undefined;
  let placedNow: PlacedLayout | undefined;
  root.style.setProperty('--touch-opacity', String(current.opacity));
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  root.append(svg);
  area.append(root);

  let visible = false;
  root.hidden = true;
  let dpadGroup: SVGGElement | undefined;
  let knob: SVGCircleElement | undefined;
  let dpadRadius = 0;
  let buttonGroups: SVGGElement[] = [];

  const draw = (state: TouchPadState) => {
    if (knob !== undefined) {
      // The knob follows the finger, held inside its travel; at rest it sits in the center.
      const finger = state.dpadFinger ?? { dx: 0, dy: 0 };
      const travel = dpadRadius * KNOB_TRAVEL;
      const distance = Math.hypot(finger.dx, finger.dy);
      const scale = distance > travel ? travel / distance : 1;
      knob.setAttribute('cx', String(finger.dx * scale));
      knob.setAttribute('cy', String(finger.dy * scale));
      const active = sectorMask(state.dpadSector) !== 0;
      knob.setAttribute('fill-opacity', active ? '0.55' : state.dpadFinger ? '0.4' : '0.28');
      knob.setAttribute('data-active', String(active));
    }
    if (dpadGroup !== undefined && state.dpadCenter !== undefined) {
      dpadGroup.setAttribute('transform', `translate(${state.dpadCenter.x} ${state.dpadCenter.y})`);
    }
    buttonGroups.forEach((group, i) => {
      group.setAttribute('data-pressed', String(state.pressed.has(i)));
      const face = group.firstElementChild;
      face?.setAttribute('fill-opacity', state.pressed.has(i) ? '0.65' : '0.3');
    });
  };

  const render = () => {
    const rect = area.getBoundingClientRect();
    svg.replaceChildren();
    knob = undefined;
    buttonGroups = [];
    placedNow = undefined;
    root.dataset.editing = String(editing !== undefined);
    if (rect.width <= 0 || rect.height <= 0) {
      device.setLayout(undefined);
      return;
    }
    const placed = placeLayout(current, rect.width, rect.height);
    placedNow = placed;
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    const circle = (r: number, fillOpacity: string) => {
      const c = doc.createElementNS(SVG, 'circle');
      c.setAttribute('r', String(r));
      c.setAttribute('fill', '#ffffff');
      c.setAttribute('fill-opacity', fillOpacity);
      c.setAttribute('stroke', '#ffffff');
      c.setAttribute('stroke-opacity', '0.7');
      c.setAttribute('stroke-width', '2');
      return c;
    };

    const dpad = doc.createElementNS(SVG, 'g');
    dpad.setAttribute('class', 'touch-dpad');
    dpad.setAttribute('data-selected', String(editing !== undefined && selected === 'dpad'));
    dpad.setAttribute('transform', `translate(${placed.dpad.x} ${placed.dpad.y})`);
    dpadRadius = placed.dpad.r;
    const ring = circle(placed.dpad.r, '0.1');
    ring.setAttribute('stroke-opacity', '0.35');
    dpad.append(ring);
    const rest = circle(placed.dpad.r * REST_RADIUS, '0.04');
    rest.setAttribute('stroke-opacity', '0.18');
    rest.setAttribute('stroke-dasharray', '3 4');
    dpad.append(rest);
    knob = circle(placed.dpad.r * KNOB_RADIUS, '0.28');
    knob.setAttribute('class', 'touch-knob');
    knob.setAttribute('stroke-opacity', '0.9');
    dpad.append(knob);
    svg.append(dpad);
    dpadGroup = dpad;

    placed.buttons.forEach((button) => {
      const group = doc.createElementNS(SVG, 'g');
      group.setAttribute('class', 'touch-button');
      group.setAttribute('data-action', button.action);
      group.setAttribute(
        'data-selected',
        String(editing !== undefined && selected === button.action),
      );
      group.setAttribute('transform', `translate(${button.x} ${button.y})`);
      group.append(circle(button.r, '0.3'));
      const icon = ICONS[button.action];
      if (icon !== undefined) {
        const path = doc.createElementNS(SVG, 'path');
        path.setAttribute('d', icon);
        path.setAttribute('fill', '#ffffff');
        path.setAttribute('transform', `scale(${button.r * 0.8})`);
        group.append(path);
      }
      // The editor places every button, also those the game hides for now.
      if (editing === undefined && !device.isActionEnabled(button.action)) {
        group.style.display = 'none';
      }
      svg.append(group);
      buttonGroups.push(group);
    });
    // The selected part in edit mode: a dashed ring around it.
    if (editing !== undefined && selected !== undefined) {
      const part =
        selected === 'dpad' ? placed.dpad : placed.buttons.find((b) => b.action === selected);
      if (part !== undefined) {
        const mark = circle(part.r + 6, '0');
        mark.setAttribute('class', 'touch-selection');
        mark.setAttribute('cx', String(part.x));
        mark.setAttribute('cy', String(part.y));
        mark.setAttribute('stroke', '#ffd75e');
        mark.setAttribute('stroke-opacity', '1');
        mark.setAttribute('stroke-width', '3');
        mark.setAttribute('stroke-dasharray', '6 5');
        svg.append(mark);
      }
    }
    if (editing !== undefined) {
      // No touches reach the game while editing.
      device.setLayout(undefined);
      return;
    }
    device.setLayout(placed);
    draw(device.state());
  };

  const local = (event: PointerEvent) => {
    const rect = area.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };
  const onDown = (event: PointerEvent) => {
    event.preventDefault();
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Not every pointer can be captured (e.g. synthetic ones); moves still arrive on the pad.
    }
    const [x, y] = local(event);
    if (editing !== undefined) {
      if (drag !== undefined || placedNow === undefined) return;
      const part = touchPartAt(placedNow, x, y);
      if (part !== undefined) {
        const at =
          part === 'dpad' ? placedNow.dpad : placedNow.buttons.find((b) => b.action === part);
        drag = { id: event.pointerId, part, dx: x - (at?.x ?? x), dy: y - (at?.y ?? y) };
      }
      editing.select(part);
      return;
    }
    device.pointerDown(event.pointerId, x, y);
  };
  const onMove = (event: PointerEvent) => {
    event.preventDefault();
    const [x, y] = local(event);
    if (editing !== undefined) {
      if (drag === undefined || drag.id !== event.pointerId) return;
      const rect = area.getBoundingClientRect();
      editing.move(drag.part, x - drag.dx, y - drag.dy, rect.width, rect.height);
      return;
    }
    device.pointerMove(event.pointerId, x, y);
  };
  const onUp = (event: PointerEvent) => {
    if (drag !== undefined && drag.id === event.pointerId) {
      const { part } = drag;
      drag = undefined;
      editing?.end(part);
      return;
    }
    device.pointerUp(event.pointerId);
  };
  const onMenu = (event: Event) => event.preventDefault();

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('lostpointercapture', onUp);
  root.addEventListener('contextmenu', onMenu);
  device.onChange(draw);
  const detachFocus = device.attachFocus(options.focus);
  const observer =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => render());
  observer?.observe(area);

  return {
    get visible() {
      return visible;
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      root.hidden = !next;
      if (next) render();
      else device.setLayout(undefined);
    },
    setActionEnabled(action, enabled) {
      if (device.isActionEnabled(action) === enabled) return;
      device.setActionEnabled(action, enabled);
      if (visible) render();
    },
    setLayout(next) {
      if (next === current) return;
      current = next;
      root.style.setProperty('--touch-opacity', String(current.opacity));
      if (visible) render();
    },
    setEditing(handlers) {
      editing = handlers;
      drag = undefined;
      if (handlers === undefined) selected = undefined;
      device.releaseAll();
      if (visible) render();
    },
    setSelected(part) {
      if (part === selected) return;
      selected = part;
      if (visible) render();
    },
    refresh() {
      if (visible) render();
    },
    destroy() {
      observer?.disconnect();
      detachFocus();
      device.onChange(undefined);
      device.setLayout(undefined);
      root.remove();
    },
  };
}
