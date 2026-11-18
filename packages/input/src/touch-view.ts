import { type ActionId, actionBit, type TouchLayout } from '@retro-action-engine/core';
import type { FocusTargets } from './input-buffer';
import { placeLayout, sectorMask } from './touch-geometry';
import type { TouchPadDevice, TouchPadState } from './touch-pad';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Icons in a -1..1 box (docs/input-and-feel.md 9.1). No text: the HUD has none either. Actions
 * without an icon get a plain button.
 */
const ICONS: Partial<Record<ActionId, string>> = {
  // An arrow pointing up.
  jump: 'M0,-0.55 L0.45,0 L0.18,0 L0.18,0.5 L-0.18,0.5 L-0.18,0 L-0.45,0 Z',
  // Two arrows pointing opposite ways: swap.
  switch:
    'M-0.5,-0.29 L0.2,-0.29 L0.2,-0.42 L0.5,-0.22 L0.2,-0.02 L0.2,-0.15 L-0.5,-0.15 Z ' +
    'M0.5,0.15 L-0.2,0.15 L-0.2,0.02 L-0.5,0.22 L-0.2,0.42 L-0.2,0.29 L0.5,0.29 Z',
};

/** The d-pad arrows: up, right, down, left, and the action each one shows. */
const ARROWS: ReadonlyArray<readonly [ActionId, number]> = [
  ['up', 0],
  ['right', 90],
  ['down', 180],
  ['left', 270],
];
const ARROW_PATH = 'M0,-0.82 L0.24,-0.5 L-0.24,-0.5 Z';

export interface TouchPadView {
  /** Shows or hides the pad. Hiding lets go of every finger. */
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  /** Shows or hides one action's button (e.g. `switch` when the party cannot switch). */
  setActionEnabled(action: ActionId, enabled: boolean): void;
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
  root.style.setProperty('--touch-opacity', String(layout.opacity));
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  root.append(svg);
  area.append(root);

  let visible = false;
  root.hidden = true;
  let dpadArrows: Array<[number, SVGPathElement]> = [];
  let dpadGroup: SVGGElement | undefined;
  let buttonGroups: SVGGElement[] = [];

  const draw = (state: TouchPadState) => {
    const held = sectorMask(state.dpadSector);
    for (const [bit, arrow] of dpadArrows) {
      arrow.setAttribute('fill-opacity', (held & bit) !== 0 ? '1' : '0.55');
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
    dpadArrows = [];
    buttonGroups = [];
    if (rect.width <= 0 || rect.height <= 0) {
      device.setLayout(undefined);
      return;
    }
    const placed = placeLayout(layout, rect.width, rect.height);
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
    dpad.setAttribute('transform', `translate(${placed.dpad.x} ${placed.dpad.y})`);
    dpad.append(circle(placed.dpad.r, '0.18'));
    for (const [action, degrees] of ARROWS) {
      const arrow = doc.createElementNS(SVG, 'path');
      arrow.setAttribute('d', ARROW_PATH);
      arrow.setAttribute('fill', '#ffffff');
      arrow.setAttribute('transform', `rotate(${degrees}) scale(${placed.dpad.r})`);
      dpad.append(arrow);
      dpadArrows.push([actionBit(action), arrow]);
    }
    svg.append(dpad);
    dpadGroup = dpad;

    placed.buttons.forEach((button) => {
      const group = doc.createElementNS(SVG, 'g');
      group.setAttribute('class', 'touch-button');
      group.setAttribute('data-action', button.action);
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
      if (!device.isActionEnabled(button.action)) group.style.display = 'none';
      svg.append(group);
      buttonGroups.push(group);
    });
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
    device.pointerDown(event.pointerId, x, y);
  };
  const onMove = (event: PointerEvent) => {
    event.preventDefault();
    const [x, y] = local(event);
    device.pointerMove(event.pointerId, x, y);
  };
  const onUp = (event: PointerEvent) => device.pointerUp(event.pointerId);
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
