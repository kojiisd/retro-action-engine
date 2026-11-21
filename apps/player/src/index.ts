import { PackLoadError } from '@retro-action-engine/pack';
import { bootGame } from './boot';
import { readBuildInfo, summarizeBuild } from './build-info';
import { debugAllowed } from './debug';
import { openStore } from './settings';
import { idbStore } from './settings-idb';
import { uiStrings } from './ui-strings';

const summary = summarizeBuild(readBuildInfo(import.meta.env));
document.title = `retro-action-engine · ${summary.heading}`;
// Build information now lives in the settings screen (out of the play area's way).
const buildInfo = [summary.heading, ...summary.details.map(([, value]) => value)].join(' · ');
const strings = uiStrings(
  navigator.languages.length > 0 ? navigator.languages : [navigator.language],
);
document.documentElement.lang = strings.lang;

const stage = document.createElement('main');
stage.className = 'stage';
// The virtual pad: over the game screen in landscape, below it in portrait (see index.html).
const touchArea = document.createElement('div');
touchArea.className = 'touch-area';
document.body.append(stage, touchArea);
document.body.dataset.state = 'loading';
const coarse = window.matchMedia('(pointer: coarse)');
// The same query as the page's CSS (index.html), so the pad's layout follows its place.
const portrait = window.matchMedia('(orientation: portrait)');

/**
 * The game screen in the page (ADR-0010, revision 2026-11-21, the owner's choice): on a PC, a
 * whole zoom up to 3x so every dot keeps its size and the screen never fills a large window; on a
 * touch screen, stretched to fit (small screens need all the room).
 */
const PC_MAX_ZOOM = 3;
const scaling = coarse.matches
  ? ({ kind: 'fit' } as const)
  : ({ kind: 'integer', maxZoom: PC_MAX_ZOOM } as const);

const exposeHooks = import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === '1';
const warn = (message: string) => console.warn(`[settings] ${message}`);

openStore({
  ...(typeof indexedDB === 'undefined' ? {} : { idb: idbStore }),
  localStorage: () => window.localStorage,
  warn,
})
  .then((store) =>
    bootGame({
      parent: stage,
      packUrl: `${import.meta.env.BASE_URL}packs/sample/`,
      fetch: (url) => window.fetch(url),
      focus: { window, document },
      getGamepads: () => navigator.getGamepads(),
      scaling,
      onReady: () => {
        document.body.dataset.state = 'ready';
      },
      onDisplay: ({ width, height }) => {
        document.documentElement.style.setProperty('--game-ratio', String(height / width));
      },
      touch: {
        area: touchArea,
        document,
        coarsePointer: () => coarse.matches,
        portrait: () => portrait.matches,
        onVisibleChange: (visible) => document.body.classList.toggle('touch', visible),
      },
      settings: { store, strings, container: document.body, buildInfo, warn },
      // Dev builds and PR previews only, never production (ADR-0008, revision M2-3).
      ...(debugAllowed(import.meta.env) ? { debug: { now: () => performance.now() } } : {}),
    }),
  )
  .then((game) => {
    if (exposeHooks) window.__engine = game.hooks;
  })
  .catch((error: unknown) => {
    document.body.dataset.state = 'error';
    const message = document.createElement('pre');
    message.className = 'error';
    message.textContent =
      error instanceof PackLoadError
        ? `The pack could not be loaded:\n${error.issues.join('\n')}`
        : `The game could not start: ${String(error)}`;
    stage.replaceChildren(message);
    console.error(error);
  });
