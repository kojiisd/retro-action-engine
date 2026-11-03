/**
 * Builds the whole site into dist-site/ at the repository root:
 *   dist-site/            the gallery (game list)
 *   dist-site/play/<slug>/ each game listed in site.json
 *
 * Usage: SITE_BASE=/ pnpm site:build          (production)
 *        SITE_BASE=/pr-12/ pnpm site:build    (PR preview)
 * Other VITE_* variables (PR number, commit) pass through to every build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSiteBase, parseSiteConfig, planSiteBuild } from './site-config.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outRoot = join(repoRoot, 'dist-site');

const config = parseSiteConfig(JSON.parse(readFileSync(join(repoRoot, 'site.json'), 'utf8')));
const base = parseSiteBase(process.env.SITE_BASE);

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const step of planSiteBuild(config, base)) {
  const outDir = join(outRoot, step.outSubdir);
  console.log(`[site] ${step.packageName} -> ${outDir} (base ${step.base})`);
  const result = spawnSync(
    'pnpm',
    ['--filter', step.packageName, 'exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'],
    { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, VITE_BASE: step.base } },
  );
  if (result.status !== 0) {
    console.error(`[site] build failed: ${step.packageName}`);
    process.exit(result.status ?? 1);
  }
  if (!existsSync(join(outDir, 'index.html'))) {
    console.error(`[site] ${step.packageName} produced no index.html in ${outDir}`);
    process.exit(1);
  }
}

console.log(`[site] done: ${outRoot}`);
