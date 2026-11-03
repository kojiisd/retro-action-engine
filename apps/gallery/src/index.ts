import { isRelativePath } from './gallery-data';

// The game list at the top of the site. Cards come from site.json (see vite.config.ts).
const data = __GALLERY_DATA__;

document.title = data.page.title;

const main = document.createElement('main');

const heading = document.createElement('h1');
heading.textContent = data.page.heading;

const lead = document.createElement('p');
lead.className = 'lead';
lead.textContent = data.page.lead;

const list = document.createElement('ul');
list.className = 'cards';

for (const card of data.cards) {
  if (!isRelativePath(card.href) || !isRelativePath(card.image)) {
    throw new Error(`gallery card "${card.title}" must use relative paths`);
  }
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = card.href;

  const image = document.createElement('img');
  image.src = card.image;
  image.alt = card.imageAlt;
  image.width = 320;
  image.height = 180;
  image.loading = 'lazy';

  const title = document.createElement('h2');
  title.textContent = card.title;

  const description = document.createElement('p');
  description.textContent = card.description;

  link.append(image, title, description);
  item.append(link);
  list.append(item);
}

main.append(heading, lead, list);
document.body.append(main);
