import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  gamePath,
  parseSiteBase,
  parseSiteConfig,
  planSiteBuild,
  SiteConfigError,
} from './site-config.ts';

const validRaw = () => ({
  page: { title: 'T', heading: 'H', lead: 'L' },
  games: [
    {
      slug: 'demo-game',
      app: 'player',
      title: 'Demo',
      description: 'A demo.',
      image: 'images/demo.svg',
      imageAlt: 'Demo image',
    },
  ],
});

/** validRaw() with the first game's fields replaced. */
const withGame = (overrides: Record<string, unknown>) => {
  const raw = validRaw();
  return { ...raw, games: [{ ...raw.games[0], ...overrides }] };
};

function problemsOf(raw: unknown): readonly string[] {
  try {
    parseSiteConfig(raw);
  } catch (error) {
    if (error instanceof SiteConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseSiteConfig', () => {
  it('accepts the committed site.json', () => {
    const path = fileURLToPath(new URL('../../../site.json', import.meta.url));
    const config = parseSiteConfig(JSON.parse(readFileSync(path, 'utf8')));
    expect(config.games.length).toBeGreaterThan(0);
  });

  it('accepts a valid config', () => {
    expect(parseSiteConfig(validRaw()).games[0]?.slug).toBe('demo-game');
  });

  it('rejects slugs reserved for previews', () => {
    expect(problemsOf(withGame({ slug: 'pr-12' })).join('\n')).toMatch(/must not start with "pr-"/);
  });

  it('rejects slugs that are not URL-safe', () => {
    for (const slug of ['Demo', 'a/b', '../x', 'a--b', '-a', 'a b']) {
      expect(problemsOf(withGame({ slug })).join('\n')).toMatch(
        /lower-case letters, digits and hyphens/,
      );
    }
  });

  it('rejects duplicate slugs, unknown apps and images outside images/', () => {
    const raw = validRaw();
    const [first] = raw.games;
    const problems = problemsOf({
      ...raw,
      games: [first, { ...first, app: 'unknown', image: '../secret.png' }],
    }).join('\n');
    expect(problems).toMatch(/is used twice/);
    expect(problems).toMatch(/app "unknown" must be one of player/);
    expect(problems).toMatch(/must be a file under images\//);
  });

  it('requires the page texts and at least one game', () => {
    const problems = problemsOf({ page: { title: '' }, games: [] }).join('\n');
    expect(problems).toMatch(/page.title is required/);
    expect(problems).toMatch(/games is required/);
  });
});

describe('parseSiteBase', () => {
  it('defaults to the root', () => {
    expect(parseSiteBase(undefined)).toBe('/');
    expect(parseSiteBase('')).toBe('/');
  });

  it('accepts preview prefixes', () => {
    expect(parseSiteBase('/pr-12/')).toBe('/pr-12/');
  });

  it('rejects malformed values', () => {
    for (const value of ['pr-12/', '/pr-12', '/../', 'https://x/', '/PR-1/']) {
      expect(() => parseSiteBase(value)).toThrow(/SITE_BASE/);
    }
  });
});

describe('planSiteBuild', () => {
  const config = parseSiteConfig(validRaw());

  it('puts the gallery at the base and each game under play/<slug>/', () => {
    expect(planSiteBuild(config, '/')).toEqual([
      { packageName: '@retro-action-engine/gallery', base: '/', outSubdir: '' },
      {
        packageName: '@retro-action-engine/player',
        base: '/play/demo-game/',
        outSubdir: 'play/demo-game/',
      },
    ]);
  });

  it('nests everything under the preview prefix', () => {
    const steps = planSiteBuild(config, '/pr-7/');
    expect(steps.map((s) => s.base)).toEqual(['/pr-7/', '/pr-7/play/demo-game/']);
    expect(steps.map((s) => s.outSubdir)).toEqual(['', 'play/demo-game/']);
  });

  it('builds the game path from the slug only', () => {
    expect(gamePath('demo-game')).toBe('play/demo-game/');
  });
});
