// Writes a pack's menu font from the M+ BITMAP FONTS 12 px BDF files (ADR-0020): the image of
// the glyphs the texts need, and the glyph list in ui.json. The BDF files are not in the
// repository (credits.json says where they come from).
//
//   node scripts/font/src/build-font.ts --bdf <dir with mplus_f12r.bdf, mplus_j12r.bdf> \
//     --ui packs/sample/data/ui.json --text apps/player/src/menu-strings.ts \
//     --text packs/sample/data/strings.ja.json ...
//   pnpm format   # ui.json in the repository's JSON style
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildAtlas, charsOf } from './atlas.ts';
import { mplus12 } from './bdf.ts';
import { encodePng } from './png.ts';

const { values } = parseArgs({
  options: {
    bdf: { type: 'string' },
    ui: { type: 'string' },
    text: { type: 'string', multiple: true },
  },
});
if (values.bdf === undefined || values.ui === undefined) {
  throw new Error('usage: build-font.ts --bdf <dir> --ui <ui.json> --text <file>...');
}
const font = mplus12(
  readFileSync(join(values.bdf, 'mplus_f12r.bdf'), 'latin1'),
  readFileSync(join(values.bdf, 'mplus_j12r.bdf'), 'latin1'),
);
const texts = (values.text ?? []).map((file) => readFileSync(file, 'utf8'));
const chars = charsOf(texts);
const cell = { w: 12, h: font.height };
const atlas = buildAtlas(font.glyphs, chars, cell);
const uiPath = resolve(values.ui);
const ui = JSON.parse(readFileSync(uiPath, 'utf8'));
ui.font = { ...ui.font, cellW: cell.w, cellH: cell.h, ascent: font.ascent, glyphs: atlas.list };
const image = resolve(dirname(uiPath), ui.font.image);
writeFileSync(image, encodePng(atlas.width, atlas.height, atlas.rgba));
writeFileSync(uiPath, `${JSON.stringify(ui, null, 2)}\n`);
console.log(`${chars.length} glyphs -> ${image} (${atlas.width}x${atlas.height})`);
