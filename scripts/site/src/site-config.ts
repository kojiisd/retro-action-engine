/**
 * site.json at the repository root lists what https://<site>/ shows: the gallery page at the top
 * and each game under play/<slug>/. Changing a game's URL means changing its slug here only.
 */

/** Apps that can serve a game, and the workspace package that builds each. */
export const GAME_APPS = { player: '@retro-action-engine/player' } as const;
export type GameApp = keyof typeof GAME_APPS;

export const GALLERY_PACKAGE = '@retro-action-engine/gallery';

/** Path segment under which every game lives: <base>play/<slug>/. */
export const PLAY_SEGMENT = 'play';

export interface GameEntry {
  readonly slug: string;
  readonly app: GameApp;
  readonly title: string;
  readonly description: string;
  /** Image path relative to the gallery's base, e.g. images/foo.svg. */
  readonly image: string;
  readonly imageAlt: string;
}

export interface SiteConfig {
  readonly page: { readonly title: string; readonly heading: string; readonly lead: string };
  readonly games: readonly GameEntry[];
}

// Lower-case letters, digits and single hyphens. "pr-" is reserved for PR previews (ADR-0014).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^images\/[a-z0-9][a-z0-9._-]*\.(svg|png|jpg|webp)$/;

export class SiteConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid site.json:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'SiteConfigError';
    this.problems = problems;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(source: Record<string, unknown>, key: string, path: string, problems: string[]) {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`${path} is required and must be a non-empty string`);
    return '';
  }
  return value;
}

export function parseSiteConfig(raw: unknown): SiteConfig {
  const problems: string[] = [];
  const root = isRecord(raw) ? raw : {};
  const pageRaw = isRecord(root.page) ? root.page : {};
  if (!isRecord(root.page)) problems.push('page is required and must be an object');
  const page = {
    title: text(pageRaw, 'title', 'page.title', problems),
    heading: text(pageRaw, 'heading', 'page.heading', problems),
    lead: text(pageRaw, 'lead', 'page.lead', problems),
  };

  const games: GameEntry[] = [];
  if (!Array.isArray(root.games) || root.games.length === 0) {
    problems.push('games is required and must be a non-empty array');
  } else {
    const seen = new Set<string>();
    root.games.forEach((entry: unknown, index: number) => {
      const path = `games[${index}]`;
      const game = isRecord(entry) ? entry : {};
      const slug = text(game, 'slug', `${path}.slug`, problems);
      const app = text(game, 'app', `${path}.app`, problems);
      const image = text(game, 'image', `${path}.image`, problems);
      if (slug && !SLUG_PATTERN.test(slug)) {
        problems.push(`${path}.slug "${slug}" must be lower-case letters, digits and hyphens`);
      }
      if (slug.startsWith('pr-')) {
        problems.push(`${path}.slug "${slug}" must not start with "pr-" (reserved for previews)`);
      }
      if (slug && seen.has(slug)) problems.push(`${path}.slug "${slug}" is used twice`);
      seen.add(slug);
      if (app && !Object.hasOwn(GAME_APPS, app)) {
        problems.push(`${path}.app "${app}" must be one of ${Object.keys(GAME_APPS).join(', ')}`);
      }
      if (image && !IMAGE_PATTERN.test(image)) {
        problems.push(
          `${path}.image "${image}" must be a file under images/ (svg, png, jpg, webp)`,
        );
      }
      games.push({
        slug,
        app: app as GameApp,
        title: text(game, 'title', `${path}.title`, problems),
        description: text(game, 'description', `${path}.description`, problems),
        image,
        imageAlt: text(game, 'imageAlt', `${path}.imageAlt`, problems),
      });
    });
  }

  if (problems.length > 0) throw new SiteConfigError(problems);
  return { page, games };
}

/** Path of a game relative to the site base: play/<slug>/. */
export function gamePath(slug: string): string {
  return `${PLAY_SEGMENT}/${slug}/`;
}

/** Validates the site base: "/" in production, "/pr-<n>/" for previews. */
export function parseSiteBase(value: string | undefined): string {
  const base = value === undefined || value === '' ? '/' : value;
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(base)) {
    throw new Error(`SITE_BASE must look like "/" or "/pr-12/", got "${base}"`);
  }
  return base;
}

export interface BuildStep {
  readonly packageName: string;
  /** Vite base (public URL prefix) for this build. */
  readonly base: string;
  /** Output directory relative to the site output root. "" is the root. */
  readonly outSubdir: string;
}

/** The gallery goes to the root, each game to play/<slug>/, all under the same base. */
export function planSiteBuild(config: SiteConfig, base: string): BuildStep[] {
  return [
    { packageName: GALLERY_PACKAGE, base, outSubdir: '' },
    ...config.games.map((game) => ({
      packageName: GAME_APPS[game.app],
      base: `${base}${gamePath(game.slug)}`,
      outSubdir: gamePath(game.slug),
    })),
  ];
}
