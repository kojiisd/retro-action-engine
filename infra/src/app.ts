import type { App } from 'aws-cdk-lib';
import { CertificateStack } from './certificate-stack.ts';
import type { ParsedConfig } from './config.ts';
import { SiteStack } from './site-stack.ts';

export const CERTIFICATE_STACK_NAME = 'RetroActionEngineCertificate';
export const SITE_STACK_NAME = 'RetroActionEngineSite';

export interface DefinedStacks {
  readonly certificate: CertificateStack;
  /** Null until certificateArn holds the real ARN (unless placeholders are allowed). */
  readonly site: SiteStack | null;
}

/**
 * Defines both stacks. The site stack is left out while certificateArn is still the placeholder,
 * so that the certificate stack can be deployed first on its own (ADR-0014, option C).
 */
export function defineStacks(
  app: App,
  parsed: ParsedConfig,
  options: { readonly allowPlaceholders: boolean },
): DefinedStacks {
  const certificate = new CertificateStack(app, CERTIFICATE_STACK_NAME, {
    config: parsed.config,
  });
  const site =
    parsed.certificateArnIsPlaceholder && !options.allowPlaceholders
      ? null
      : new SiteStack(app, SITE_STACK_NAME, { config: parsed.config });
  return { certificate, site };
}
