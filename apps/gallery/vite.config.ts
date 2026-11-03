import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gamePath, parseSiteConfig } from '@retro-action-engine/site-tools/site-config';
import { defineConfig } from 'vite';
import type { GalleryData } from './src/gallery-data';

// The site build (scripts/site) passes the base: "/" in production, "/pr-<n>/" for previews.
const base = process.env.VITE_BASE ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`VITE_BASE must start and end with "/", got "${base}"`);
}

// site.json is read and validated at build time; the page only receives the result.
const sitePath = fileURLToPath(new URL('../../site.json', import.meta.url));
const site = parseSiteConfig(JSON.parse(readFileSync(sitePath, 'utf8')));
const data: GalleryData = {
  page: site.page,
  cards: site.games.map((game) => ({
    href: gamePath(game.slug),
    title: game.title,
    description: game.description,
    image: game.image,
    imageAlt: game.imageAlt,
  })),
};

export default defineConfig({
  base,
  define: { __GALLERY_DATA__: JSON.stringify(data) },
});
