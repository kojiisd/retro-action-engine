import { PackLoadError } from '@retro-action-engine/pack';
import { bootGame } from './boot';
import { readBuildInfo, summarizeBuild } from './build-info';

const summary = summarizeBuild(readBuildInfo(import.meta.env));
document.title = `retro-action-engine · ${summary.heading}`;

// Build information stays in a corner (small, out of the play area's way).
const info = document.createElement('p');
info.className = 'build-info';
info.textContent = [summary.heading, ...summary.details.map(([, value]) => value)].join(' · ');

const stage = document.createElement('main');
stage.className = 'stage';
// The virtual pad: over the game screen in landscape, below it in portrait (see index.html).
const touchArea = document.createElement('div');
touchArea.className = 'touch-area';
document.body.append(stage, touchArea, info);
const coarse = window.matchMedia('(pointer: coarse)');
document.body.dataset.state = 'loading';

const exposeHooks = import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === '1';

bootGame({
  parent: stage,
  packUrl: `${import.meta.env.BASE_URL}packs/sample/`,
  fetch: (url) => window.fetch(url),
  focus: { window, document },
  getGamepads: () => navigator.getGamepads(),
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
    onVisibleChange: (visible) => document.body.classList.toggle('touch', visible),
  },
})
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
