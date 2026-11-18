import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The deploy workflows build PR previews under /pr-<n>/ and production under /.
const base = process.env.VITE_BASE ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`VITE_BASE must start and end with "/", got "${base}"`);
}

/** The sample pack: data only, outside the app (docs/architecture.md 3, issue #3). */
const PACK_DIR = fileURLToPath(new URL('../../packs/sample/', import.meta.url));
/** Where the app finds it: `${BASE_URL}packs/sample/`. */
const PACK_PATH = 'packs/sample/';
/** Pack files are data. Anything else in the directory is not served or copied. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.tmj': 'application/json',
  '.png': 'image/png',
};

const typeOf = (file: string) => CONTENT_TYPES[file.slice(file.lastIndexOf('.'))];

function packFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? packFiles(path) : [path];
    })
    .filter((file) => typeOf(file) !== undefined);
}

/**
 * Serves the sample pack in dev and copies it into the build at the same URL, so the app loads it
 * the same way in both. Small and local on purpose: no extra dependency for a static copy.
 */
function samplePack(): Plugin {
  return {
    name: 'retro-action-engine:sample-pack',
    configureServer(server) {
      const prefix = `${base}${PACK_PATH}`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith(prefix)) return next();
        const file = resolve(PACK_DIR, decodeURIComponent(url.slice(prefix.length)));
        const type = typeOf(file);
        // Only files inside the pack directory, of a data type.
        if (!file.startsWith(PACK_DIR.endsWith(sep) ? PACK_DIR : PACK_DIR + sep) || !type) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          if (!statSync(file).isFile()) throw new Error('not a file');
          res.setHeader('Content-Type', type);
          res.end(readFileSync(file));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
    generateBundle() {
      for (const file of packFiles(PACK_DIR)) {
        const path = relative(PACK_DIR, file).split(sep).join('/');
        this.emitFile({
          type: 'asset',
          fileName: `${PACK_PATH}${path}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [samplePack()],
});
