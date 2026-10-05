// Shared helpers for the infra tests. Not imported by the stacks.
import type { DeployConfig } from './config.ts';

/** A valid, non-placeholder config used by the tests. The values are fictional. */
export const TEST_CONFIG: DeployConfig = {
  account: '123456789012',
  region: 'us-west-2',
  hostedZone: { id: 'Z0123456789ABCDEFGHIJ', name: 'example.com' },
  domainName: 'arcade.example.com',
  certificateArn:
    'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555',
  github: {
    owner: 'example-owner',
    repo: 'example-repo',
    productionEnvironment: 'production',
    oidcProvider: 'create',
  },
  priceClass: 'PriceClass_200',
};

/** Returns TEST_CONFIG as raw JSON with the given top-level and github fields replaced. */
export function rawConfig(
  overrides: Record<string, unknown> = {},
  githubOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(TEST_CONFIG)) as Record<string, unknown>;
  Object.assign(raw, overrides);
  raw.github = { ...(raw.github as Record<string, unknown>), ...githubOverrides };
  return raw;
}

type CfnValue = string | number | boolean | null | CfnValue[] | { [key: string]: CfnValue };

/**
 * Renders a CloudFormation value as a readable string so tests can compare ARNs:
 * { "Fn::Join": ["", [{ "Fn::GetAtt": ["Bucket", "Arn"] }, "/pr-*"]] } -> "${Bucket.Arn}/pr-*".
 */
export function renderCfn(value: unknown): string {
  const v = value as CfnValue;
  if (typeof v === 'string') return v;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    if ('Ref' in v) return `\${${String(v.Ref)}}`;
    if ('Fn::GetAtt' in v) {
      const [id, attr] = v['Fn::GetAtt'] as [string, string];
      return `\${${id}.${attr}}`;
    }
    if ('Fn::Join' in v) {
      const [separator, parts] = v['Fn::Join'] as [string, unknown[]];
      return parts.map(renderCfn).join(separator);
    }
  }
  return JSON.stringify(v);
}

/** Always returns an array: IAM allows a single value or a list in Action and Resource. */
export function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
