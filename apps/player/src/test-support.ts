// Test helpers for apps/player: the sample pack read from disk, the way the app reads it over
// HTTP. Not part of the app bundle (excluded from the app tsconfig; imported by tests only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FetchLike, type LoadedRuntime, loadPack } from '@retro-action-engine/pack';

const PACK_DIR = fileURLToPath(new URL('../../../packs/sample/', import.meta.url));
const BASE = 'pack:/';

const diskFetch: FetchLike = async (url) => {
  try {
    const text = readFileSync(join(PACK_DIR, url.slice(BASE.length)), 'utf8');
    return { ok: true, status: 200, text: async () => text };
  } catch {
    return { ok: false, status: 404, text: async () => '' };
  }
};

export async function loadSamplePack(): Promise<LoadedRuntime> {
  return (await loadPack(diskFetch, BASE)).runtime;
}
