import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  PLACEHOLDERS,
  parseConfig,
  previewSubject,
  productionSubject,
} from './config.ts';
import { rawConfig, TEST_CONFIG } from './test-support.ts';

const strict = { allowPlaceholders: false };
const lenient = { allowPlaceholders: true };

function problemsOf(raw: unknown, options = strict): readonly string[] {
  try {
    parseConfig(raw, options);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseConfig', () => {
  it('accepts a complete config', () => {
    const parsed = parseConfig(rawConfig(), strict);
    expect(parsed.config).toEqual(TEST_CONFIG);
    expect(parsed.certificateArnIsPlaceholder).toBe(false);
  });

  it('accepts the committed example only when placeholders are allowed', () => {
    const examplePath = fileURLToPath(new URL('../config/deploy.example.json', import.meta.url));
    const example: unknown = JSON.parse(readFileSync(examplePath, 'utf8'));

    expect(parseConfig(example, lenient).certificateArnIsPlaceholder).toBe(true);
    expect(problemsOf(example, strict).join('\n')).toMatch(/account, hostedZone\.id .*placeholder/);
  });

  describe('region', () => {
    it('is required and has no default', () => {
      const raw = rawConfig();
      delete raw.region;
      expect(problemsOf(raw)).toContain('region is required and must be a non-empty string');
    });

    it('rejects us-east-1 for the site stack', () => {
      expect(problemsOf(rawConfig({ region: 'us-east-1' })).join('\n')).toMatch(
        /region must not be us-east-1/,
      );
    });

    it('rejects a value that is not a region name', () => {
      expect(problemsOf(rawConfig({ region: 'tokyo' })).join('\n')).toMatch(/not an AWS region/);
    });
  });

  describe('certificateArn', () => {
    it('must be in us-east-1', () => {
      const arn = TEST_CONFIG.certificateArn.replace('us-east-1', 'us-west-2');
      expect(problemsOf(rawConfig({ certificateArn: arn })).join('\n')).toMatch(
        /certificateArn must be in us-east-1/,
      );
    });

    it('must belong to the configured account', () => {
      const arn = TEST_CONFIG.certificateArn.replace('123456789012', '210987654321');
      expect(problemsOf(rawConfig({ certificateArn: arn })).join('\n')).toMatch(
        /belongs to account 210987654321/,
      );
    });

    it('must be an ACM certificate ARN', () => {
      expect(problemsOf(rawConfig({ certificateArn: 'arn:aws:s3:::bucket' })).join('\n')).toMatch(
        /must be an ACM certificate ARN/,
      );
    });

    it('may stay the placeholder so that the certificate stack can be deployed first', () => {
      const parsed = parseConfig(
        rawConfig({ certificateArn: PLACEHOLDERS.certificateArn }),
        strict,
      );
      expect(parsed.certificateArnIsPlaceholder).toBe(true);
    });
  });

  it('requires the domain to be inside the hosted zone', () => {
    expect(problemsOf(rawConfig({ domainName: 'arcade.example.net' })).join('\n')).toMatch(
      /must be a subdomain of hostedZone\.name/,
    );
  });

  it('rejects a hosted zone ID with the /hostedzone/ prefix', () => {
    const raw = rawConfig({
      hostedZone: { id: '/hostedzone/Z0123456789ABCDEFGHIJ', name: 'example.com' },
    });
    expect(problemsOf(raw).join('\n')).toMatch(/without the "\/hostedzone\/" prefix/);
  });

  it('rejects an unknown OIDC provider mode', () => {
    expect(problemsOf(rawConfig({}, { oidcProvider: 'lookup' })).join('\n')).toMatch(
      /must be "create" or "import"/,
    );
  });

  it('rejects placeholders unless they are allowed', () => {
    const raw = rawConfig({
      account: PLACEHOLDERS.account,
      certificateArn: PLACEHOLDERS.certificateArn,
    });
    expect(problemsOf(raw, strict).join('\n')).toMatch(/account still hold placeholder values/);
    expect(problemsOf(raw, lenient)).toEqual([]);
  });

  it('reports every problem at once', () => {
    const problems = problemsOf(
      rawConfig({ account: '123', region: 'us-east-1', priceClass: 'x' }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('OIDC subjects', () => {
  it('binds production to the GitHub environment and previews to pull_request events', () => {
    expect(productionSubject(TEST_CONFIG)).toBe(
      'repo:example-owner/example-repo:environment:production',
    );
    expect(previewSubject(TEST_CONFIG)).toBe('repo:example-owner/example-repo:pull_request');
  });
});
