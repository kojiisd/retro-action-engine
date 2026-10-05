/**
 * Build metadata shown on the placeholder page. The values come from VITE_* environment variables
 * that the deploy workflows set at build time (.github/workflows/preview.yml and deploy.yml).
 */

export type BuildChannel = 'preview' | 'production' | 'local';

export interface BuildInfo {
  readonly channel: BuildChannel;
  readonly prNumber: number | null;
  readonly commitSha: string | null;
  readonly builtAt: string | null;
  readonly base: string;
}

/** The subset of `import.meta.env` this module reads. */
export interface BuildEnv {
  readonly VITE_PR_NUMBER?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
  readonly BASE_URL?: string;
}

const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.trim() !== '' ? value.trim() : null;

export function readBuildInfo(env: BuildEnv): BuildInfo {
  const prText = nonEmpty(env.VITE_PR_NUMBER);
  const prNumber = prText !== null && /^\d+$/.test(prText) ? Number(prText) : null;
  const commitSha = nonEmpty(env.VITE_COMMIT_SHA);
  const channel: BuildChannel =
    prNumber !== null ? 'preview' : commitSha !== null ? 'production' : 'local';
  return {
    channel,
    prNumber,
    commitSha,
    builtAt: nonEmpty(env.VITE_BUILD_TIME),
    base: nonEmpty(env.BASE_URL) ?? '/',
  };
}

export interface BuildSummary {
  readonly heading: string;
  readonly details: readonly (readonly [label: string, value: string])[];
}

export function summarizeBuild(info: BuildInfo): BuildSummary {
  const heading =
    info.channel === 'preview'
      ? `Preview of PR #${info.prNumber}`
      : info.channel === 'production'
        ? 'Production build'
        : 'Local development build';
  return {
    heading,
    details: [
      ['Commit', info.commitSha !== null ? info.commitSha.slice(0, 7) : 'unknown'],
      ['Built at', info.builtAt ?? 'unknown'],
      ['Base path', info.base],
    ],
  };
}
