import { defineConfig } from 'vite';

// The deploy workflows build PR previews under /pr-<n>/ and production under /.
const base = process.env.VITE_BASE ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`VITE_BASE must start and end with "/", got "${base}"`);
}

export default defineConfig({
  base,
});
