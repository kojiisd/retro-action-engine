import { describe, expect, it } from 'vitest';
import { readBuildInfo, summarizeBuild } from './build-info';

describe('readBuildInfo', () => {
  it('reports a PR preview when a PR number is set', () => {
    const info = readBuildInfo({
      VITE_PR_NUMBER: '12',
      VITE_COMMIT_SHA: '0123456789abcdef',
      VITE_BUILD_TIME: '2026-10-05T00:00:00Z',
      BASE_URL: '/pr-12/',
    });
    expect(info).toEqual({
      channel: 'preview',
      prNumber: 12,
      commitSha: '0123456789abcdef',
      builtAt: '2026-10-05T00:00:00Z',
      base: '/pr-12/',
    });
  });

  it('reports production when only the commit is set', () => {
    expect(readBuildInfo({ VITE_COMMIT_SHA: 'abc', BASE_URL: '/' }).channel).toBe('production');
  });

  it('reports a local build when nothing is set', () => {
    expect(readBuildInfo({})).toEqual({
      channel: 'local',
      prNumber: null,
      commitSha: null,
      builtAt: null,
      base: '/',
    });
  });

  it('ignores a PR number that is empty or not numeric', () => {
    expect(readBuildInfo({ VITE_PR_NUMBER: '' }).prNumber).toBeNull();
    expect(readBuildInfo({ VITE_PR_NUMBER: '12a' }).prNumber).toBeNull();
  });
});

describe('summarizeBuild', () => {
  it('describes a preview with the short commit', () => {
    const summary = summarizeBuild(
      readBuildInfo({ VITE_PR_NUMBER: '7', VITE_COMMIT_SHA: '0123456789', BASE_URL: '/pr-7/' }),
    );
    expect(summary.heading).toBe('Preview of PR #7');
    expect(summary.details).toEqual([
      ['Commit', '0123456'],
      ['Built at', 'unknown'],
      ['Base path', '/pr-7/'],
    ]);
  });

  it('describes production and local builds', () => {
    expect(summarizeBuild(readBuildInfo({ VITE_COMMIT_SHA: 'abc' })).heading).toBe(
      'Production build',
    );
    expect(summarizeBuild(readBuildInfo({})).heading).toBe('Local development build');
  });
});
