import { readBuildInfo, summarizeBuild } from './build-info';

// Placeholder page until the game runs here (M1-5). It shows which build is being served.
const summary = summarizeBuild(readBuildInfo(import.meta.env));

const main = document.createElement('main');

const title = document.createElement('h1');
title.textContent = 'retro-action-engine';

const subtitle = document.createElement('p');
subtitle.className = 'channel';
subtitle.textContent = summary.heading;

const list = document.createElement('dl');
for (const [label, value] of summary.details) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

const note = document.createElement('p');
note.className = 'note';
note.textContent = 'This is a placeholder page. The game will appear here in a later milestone.';

main.append(title, subtitle, list, note);
document.body.append(main);
document.title = `retro-action-engine · ${summary.heading}`;
