/**
 * Deployment configuration for the site infrastructure.
 *
 * The real values live in config/deploy.json, which is gitignored. config/deploy.example.json
 * holds the placeholders below so that `cdk synth` and the tests run without AWS credentials.
 * No value is looked up from AWS at synth time.
 */

/** ACM certificates used by CloudFront must live in us-east-1. */
export const CERTIFICATE_REGION = 'us-east-1';

/** Issuer of GitHub Actions OIDC tokens. */
export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/** Audience used by aws-actions/configure-aws-credentials. */
export const GITHUB_OIDC_AUDIENCE = 'sts.amazonaws.com';

/** Placeholder values shipped in config/deploy.example.json. */
export const PLACEHOLDERS = {
  account: '000000000000',
  hostedZoneId: 'Z000000000000000PLACEHOLDER',
  certificateArn:
    'arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000',
} as const;

export type OidcProviderMode = 'create' | 'import';

export const PRICE_CLASSES = ['PriceClass_100', 'PriceClass_200', 'PriceClass_All'] as const;
export type PriceClassName = (typeof PRICE_CLASSES)[number];

export interface DeployConfig {
  /** AWS account that owns every resource, including the Route 53 hosted zone. */
  readonly account: string;
  /** Region of the site stack. Required, no default, and never us-east-1 (see ADR-0014). */
  readonly region: string;
  readonly hostedZone: { readonly id: string; readonly name: string };
  /** Public domain served by CloudFront, e.g. arcade.example.com. */
  readonly domainName: string;
  /** ARN of the us-east-1 certificate created by the certificate stack. */
  readonly certificateArn: string;
  readonly github: {
    readonly owner: string;
    readonly repo: string;
    /** GitHub Environment whose OIDC subject may assume the production role. */
    readonly productionEnvironment: string;
    /** Create the GitHub OIDC provider, or import the one that already exists in the account. */
    readonly oidcProvider: OidcProviderMode;
  };
  readonly priceClass: PriceClassName;
}

export interface ParseOptions {
  /** Accept placeholder values. Used by `cdk synth` in CI and by tests only. */
  readonly allowPlaceholders: boolean;
}

export interface ParsedConfig {
  readonly config: DeployConfig;
  /** True while certificateArn still holds the placeholder (before the certificate exists). */
  readonly certificateArnIsPlaceholder: boolean;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid deploy config:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ACCOUNT_PATTERN = /^\d{12}$/;
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const HOSTED_ZONE_ID_PATTERN = /^Z[A-Z0-9]{5,31}$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const CERTIFICATE_ARN_PATTERN =
  /^arn:aws:acm:([a-z0-9-]+):(\d{12}):certificate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  problems: string[],
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`${path} is required and must be a non-empty string`);
    return '';
  }
  return value;
}

function readObject(
  source: Record<string, unknown>,
  key: string,
  path: string,
  problems: string[],
): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) {
    problems.push(`${path} is required and must be an object`);
    return {};
  }
  return value;
}

/**
 * Validates raw JSON and returns a typed config. Every problem is collected so the owner can fix
 * the file in one pass.
 */
export function parseConfig(raw: unknown, options: ParseOptions): ParsedConfig {
  const problems: string[] = [];
  const root = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) {
    problems.push('the config must be a JSON object');
  }

  const account = readString(root, 'account', 'account', problems);
  const region = readString(root, 'region', 'region', problems);
  const zone = readObject(root, 'hostedZone', 'hostedZone', problems);
  const hostedZoneId = readString(zone, 'id', 'hostedZone.id', problems);
  const zoneName = readString(zone, 'name', 'hostedZone.name', problems);
  const domainName = readString(root, 'domainName', 'domainName', problems);
  const certificateArn = readString(root, 'certificateArn', 'certificateArn', problems);
  const github = readObject(root, 'github', 'github', problems);
  const owner = readString(github, 'owner', 'github.owner', problems);
  const repo = readString(github, 'repo', 'github.repo', problems);
  const productionEnvironment = readString(
    github,
    'productionEnvironment',
    'github.productionEnvironment',
    problems,
  );
  const oidcProvider = readString(github, 'oidcProvider', 'github.oidcProvider', problems);
  const priceClass = readString(root, 'priceClass', 'priceClass', problems);

  if (account && !ACCOUNT_PATTERN.test(account)) {
    problems.push('account must be a 12-digit AWS account ID');
  }
  if (region) {
    if (!REGION_PATTERN.test(region)) {
      problems.push(`region "${region}" is not an AWS region name`);
    } else if (region === CERTIFICATE_REGION) {
      problems.push(
        `region must not be ${CERTIFICATE_REGION}. The site stack is kept out of ${CERTIFICATE_REGION} on purpose ` +
          'so that a missing region setting cannot work by accident (ADR-0014).',
      );
    }
  }
  if (hostedZoneId && !HOSTED_ZONE_ID_PATTERN.test(hostedZoneId)) {
    problems.push(
      'hostedZone.id must look like a Route 53 hosted zone ID (Z...), without the "/hostedzone/" prefix',
    );
  }
  if (zoneName && !DOMAIN_PATTERN.test(zoneName)) {
    problems.push(
      `hostedZone.name "${zoneName}" must be a lower-case domain name without a trailing dot`,
    );
  }
  if (domainName) {
    if (!DOMAIN_PATTERN.test(domainName)) {
      problems.push(`domainName "${domainName}" must be a lower-case domain name`);
    } else if (zoneName && !domainName.endsWith(`.${zoneName}`)) {
      problems.push(
        `domainName "${domainName}" must be a subdomain of hostedZone.name "${zoneName}"`,
      );
    }
  }
  if (certificateArn) {
    const match = CERTIFICATE_ARN_PATTERN.exec(certificateArn);
    if (!match) {
      problems.push('certificateArn must be an ACM certificate ARN');
    } else {
      const [, arnRegion, arnAccount] = match;
      if (arnRegion !== CERTIFICATE_REGION) {
        problems.push(
          `certificateArn must be in ${CERTIFICATE_REGION} (CloudFront requirement), got ${arnRegion}`,
        );
      }
      if (account && arnAccount !== account && certificateArn !== PLACEHOLDERS.certificateArn) {
        problems.push(`certificateArn belongs to account ${arnAccount}, not ${account}`);
      }
    }
  }
  if (owner && !GITHUB_NAME_PATTERN.test(owner)) {
    problems.push('github.owner contains characters that are not allowed in a GitHub name');
  }
  if (repo && !GITHUB_NAME_PATTERN.test(repo)) {
    problems.push('github.repo contains characters that are not allowed in a GitHub name');
  }
  if (oidcProvider && oidcProvider !== 'create' && oidcProvider !== 'import') {
    problems.push('github.oidcProvider must be "create" or "import"');
  }
  if (priceClass && !(PRICE_CLASSES as readonly string[]).includes(priceClass)) {
    problems.push(`priceClass must be one of ${PRICE_CLASSES.join(', ')}`);
  }

  const placeholderFields = [
    account === PLACEHOLDERS.account ? 'account' : null,
    hostedZoneId === PLACEHOLDERS.hostedZoneId ? 'hostedZone.id' : null,
  ].filter((field): field is string => field !== null);
  if (placeholderFields.length > 0 && !options.allowPlaceholders) {
    problems.push(
      `${placeholderFields.join(', ')} still hold placeholder values. Copy config/deploy.example.json ` +
        'to config/deploy.json and fill in the real values (see infra/README.md).',
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    config: {
      account,
      region,
      hostedZone: { id: hostedZoneId, name: zoneName },
      domainName,
      certificateArn,
      github: {
        owner,
        repo,
        productionEnvironment,
        oidcProvider: oidcProvider as OidcProviderMode,
      },
      priceClass: priceClass as PriceClassName,
    },
    certificateArnIsPlaceholder: certificateArn === PLACEHOLDERS.certificateArn,
  };
}

/** OIDC `sub` claim that GitHub issues for jobs bound to the production environment. */
export function productionSubject(config: DeployConfig): string {
  return `repo:${config.github.owner}/${config.github.repo}:environment:${config.github.productionEnvironment}`;
}

/** OIDC `sub` claim that GitHub issues for `pull_request` events. */
export function previewSubject(config: DeployConfig): string {
  return `repo:${config.github.owner}/${config.github.repo}:pull_request`;
}
