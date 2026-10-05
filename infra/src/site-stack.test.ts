import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CERTIFICATE_STACK_NAME, defineStacks, SITE_STACK_NAME } from './app.ts';
import { CertificateStack } from './certificate-stack.ts';
import { type DeployConfig, PLACEHOLDERS } from './config.ts';
import { SiteStack } from './site-stack.ts';
import { asList, renderCfn, TEST_CONFIG } from './test-support.ts';

type Resource = { Type: string; Properties: Record<string, unknown> };
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};

function synthSite(config: DeployConfig = TEST_CONFIG) {
  const stack = new SiteStack(new App(), SITE_STACK_NAME, { config });
  const template = Template.fromStack(stack);
  const resources = template.toJSON().Resources as Record<string, Resource>;
  const logicalId = (construct: { node: { defaultChild?: unknown } }): string =>
    stack.getLogicalId(construct.node.defaultChild as never);
  return { stack, template, resources, logicalId };
}

function resourcesOfType(resources: Record<string, Resource>, type: string): [string, Resource][] {
  return Object.entries(resources).filter(([, r]) => r.Type === type);
}

function resourceById(resources: Record<string, Resource>, logicalId: string): Resource {
  const resource = resources[logicalId];
  if (!resource) throw new Error(`resource ${logicalId} not found`);
  return resource;
}

function onlyResourceOfType(resources: Record<string, Resource>, type: string): Resource {
  const found = resourcesOfType(resources, type);
  const [first] = found;
  if (found.length !== 1 || !first) throw new Error(`expected exactly one ${type}`);
  return first[1];
}

/** All IAM statements attached to the role with the given logical ID. */
function statementsFor(resources: Record<string, Resource>, roleLogicalId: string): Statement[] {
  return resourcesOfType(resources, 'AWS::IAM::Policy')
    .filter(([, policy]) =>
      asList(policy.Properties.Roles as unknown[]).some(
        (role) => renderCfn(role) === `\${${roleLogicalId}}`,
      ),
    )
    .flatMap(
      ([, policy]) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

const S3_OBJECT_WRITE_ACTIONS = ['s3:PutObject', 's3:DeleteObject'];

describe('SiteStack', () => {
  const site = synthSite();
  const bucketArn = `\${${site.logicalId(site.stack.bucket)}.Arn}`;
  const previewRoleId = site.logicalId(site.stack.previewRole);
  const productionRoleId = site.logicalId(site.stack.productionRole);
  const distributionConfig = () =>
    onlyResourceOfType(site.resources, 'AWS::CloudFront::Distribution').Properties
      .DistributionConfig as Record<string, unknown>;

  describe('regions', () => {
    it('deploys the site stack to the configured region, not us-east-1', () => {
      expect(site.stack.region).toBe('us-west-2');
      expect(site.stack.account).toBe(TEST_CONFIG.account);
    });

    it('deploys the certificate stack to us-east-1 regardless of the site region', () => {
      const cert = new CertificateStack(new App(), CERTIFICATE_STACK_NAME, {
        config: { ...TEST_CONFIG, region: 'eu-west-1' },
      });
      expect(cert.region).toBe('us-east-1');
      expect(Stack.of(cert.certificate).region).toBe('us-east-1');
    });
  });

  describe('IAM trust policies', () => {
    const trustOf = (roleLogicalId: string) =>
      (
        resourceById(site.resources, roleLogicalId).Properties.AssumeRolePolicyDocument as {
          Statement: Statement[];
        }
      ).Statement;

    const expectedTrust = (subject: string) => [
      {
        Action: 'sts:AssumeRoleWithWebIdentity',
        Effect: 'Allow',
        Principal: { Federated: { Ref: expect.any(String) } },
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': subject,
          },
        },
      },
    ];

    it('lets only the production GitHub environment assume the production role', () => {
      expect(trustOf(productionRoleId)).toEqual(
        expectedTrust('repo:example-owner/example-repo:environment:production'),
      );
    });

    it('lets only pull_request events assume the preview role', () => {
      expect(trustOf(previewRoleId)).toEqual(
        expectedTrust('repo:example-owner/example-repo:pull_request'),
      );
    });
  });

  describe('preview role permissions', () => {
    const statements = statementsFor(site.resources, previewRoleId);
    const s3Statements = statements.filter((s) =>
      asList(s.Action).some((action) => action.startsWith('s3:')),
    );

    it('writes and deletes objects only under pr-*', () => {
      const writes = s3Statements.filter((s) =>
        asList(s.Action).some((action) => S3_OBJECT_WRITE_ACTIONS.includes(action)),
      );
      expect(writes.length).toBeGreaterThan(0);
      for (const statement of writes) {
        expect(statement.Effect).toBe('Allow');
        expect(asList(statement.Resource).map(renderCfn)).toEqual([`${bucketArn}/pr-*`]);
      }
    });

    it('never grants object access to the whole bucket or wildcard S3 actions', () => {
      for (const statement of s3Statements) {
        const resources = asList(statement.Resource).map(renderCfn);
        expect(resources).not.toContain(`${bucketArn}/*`);
        expect(resources).not.toContain('*');
        expect(asList(statement.Action)).not.toContain('s3:*');
      }
      const actions = s3Statements.flatMap((s) => asList(s.Action)).sort();
      expect(actions).toEqual(['s3:DeleteObject', 's3:ListBucket', 's3:PutObject']);
    });

    it('lists the bucket only for pr-* prefixes', () => {
      const list = s3Statements.filter((s) => asList(s.Action).includes('s3:ListBucket'));
      expect(list).toHaveLength(1);
      expect(asList(list[0]?.Resource).map(renderCfn)).toEqual([bucketArn]);
      expect(list[0]?.Condition).toEqual({ StringLike: { 's3:prefix': ['pr-*'] } });
    });

    it('can invalidate the distribution', () => {
      const invalidation = statements.find((s) =>
        asList(s.Action).includes('cloudfront:CreateInvalidation'),
      );
      expect(renderCfn(invalidation?.Resource)).toContain(site.logicalId(site.stack.distribution));
    });
  });

  describe('production role permissions', () => {
    it('writes and deletes objects anywhere in the bucket and lists it', () => {
      const statements = statementsFor(site.resources, productionRoleId);
      const writes = statements.find((s) => asList(s.Action).includes('s3:PutObject'));
      expect(asList(writes?.Resource).map(renderCfn)).toEqual([`${bucketArn}/*`]);
      const list = statements.find((s) => asList(s.Action).includes('s3:ListBucket'));
      expect(asList(list?.Resource).map(renderCfn)).toEqual([bucketArn]);
    });
  });

  describe('response headers', () => {
    const policyOf = (policyRef: unknown) => {
      const id = renderCfn(policyRef).slice(2, -1);
      return resourceById(site.resources, id).Properties.ResponseHeadersPolicyConfig as Record<
        string,
        unknown
      >;
    };

    const expectedSecurityHeaders = {
      StrictTransportSecurity: {
        AccessControlMaxAgeSec: 63_072_000,
        IncludeSubdomains: false,
        Preload: false,
        Override: true,
      },
      ContentTypeOptions: { Override: true },
      ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
      FrameOptions: { FrameOption: 'DENY', Override: true },
    };

    it('has exactly one additional behavior, for pr-*', () => {
      const behaviors = distributionConfig().CacheBehaviors as Record<string, unknown>[];
      expect(behaviors.map((b) => b.PathPattern)).toEqual(['pr-*']);
    });

    it('adds the security headers to the default behavior without noindex', () => {
      const defaults = distributionConfig().DefaultCacheBehavior as Record<string, unknown>;
      const policy = policyOf(defaults.ResponseHeadersPolicyId);
      expect(policy.SecurityHeadersConfig).toEqual(expectedSecurityHeaders);
      expect(JSON.stringify(policy)).not.toContain('X-Robots-Tag');
    });

    it('adds the security headers and X-Robots-Tag: noindex to pr-*', () => {
      const [preview] = distributionConfig().CacheBehaviors as Record<string, unknown>[];
      const policy = policyOf(preview?.ResponseHeadersPolicyId);
      expect(policy.SecurityHeadersConfig).toEqual(expectedSecurityHeaders);
      expect(policy.CustomHeadersConfig).toEqual({
        Items: [{ Header: 'X-Robots-Tag', Value: 'noindex', Override: true }],
      });
    });

    it('does not set Content-Security-Policy yet (deferred to M4)', () => {
      for (const [, policy] of resourcesOfType(
        site.resources,
        'AWS::CloudFront::ResponseHeadersPolicy',
      )) {
        expect(JSON.stringify(policy)).not.toContain('ContentSecurityPolicy');
      }
    });
  });

  describe('distribution', () => {
    it('serves the custom domain over HTTPS with the us-east-1 certificate', () => {
      const config = distributionConfig();
      expect(config.Aliases).toEqual(['arcade.example.com']);
      expect(config.ViewerCertificate).toEqual({
        AcmCertificateArn: TEST_CONFIG.certificateArn,
        MinimumProtocolVersion: 'TLSv1.2_2021',
        SslSupportMethod: 'sni-only',
      });
      expect(config.DefaultRootObject).toBe('index.html');
      expect(config.HttpVersion).toBe('http2and3');
      expect(config.PriceClass).toBe('PriceClass_200');
    });

    it('redirects to HTTPS and runs the viewer-request function on every behavior', () => {
      const config = distributionConfig();
      const behaviors = [
        config.DefaultCacheBehavior,
        ...(config.CacheBehaviors as unknown[]),
      ] as Record<string, unknown>[];
      for (const behavior of behaviors) {
        expect(behavior.ViewerProtocolPolicy).toBe('redirect-to-https');
        expect(behavior.FunctionAssociations).toEqual([
          { EventType: 'viewer-request', FunctionARN: expect.anything() },
        ]);
      }
    });

    it('deploys the viewer-request function file unchanged on the JS 2.0 runtime', () => {
      const fn = onlyResourceOfType(site.resources, 'AWS::CloudFront::Function');
      const source = readFileSync(
        fileURLToPath(new URL('../functions/viewer-request.js', import.meta.url)),
        'utf8',
      );
      expect(fn.Properties.FunctionCode).toBe(source);
      expect((fn.Properties.FunctionConfig as Record<string, unknown>).Runtime).toBe(
        'cloudfront-js-2.0',
      );
    });

    it('reads the bucket through origin access control only', () => {
      site.template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
      site.template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
      const policy = onlyResourceOfType(site.resources, 'AWS::S3::BucketPolicy');
      const statements = (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement;
      expect(statements).toContainEqual(
        expect.objectContaining({
          Effect: 'Deny',
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
      );
      expect(statements).toContainEqual(
        expect.objectContaining({
          Effect: 'Allow',
          Action: 's3:GetObject',
          Principal: { Service: 'cloudfront.amazonaws.com' },
        }),
      );
    });
  });

  describe('DNS', () => {
    it('creates A and AAAA alias records in the existing hosted zone', () => {
      const records = resourcesOfType(site.resources, 'AWS::Route53::RecordSet').map(
        ([, r]) => r.Properties,
      );
      expect(records.map((r) => r.Type).sort()).toEqual(['A', 'AAAA']);
      for (const record of records) {
        expect(record.Name).toBe('arcade.example.com.');
        expect(record.HostedZoneId).toBe(TEST_CONFIG.hostedZone.id);
        expect(renderCfn((record.AliasTarget as Record<string, unknown>).DNSName)).toBe(
          `\${${site.logicalId(site.stack.distribution)}.DomainName}`,
        );
      }
      site.template.resourceCountIs('AWS::Route53::HostedZone', 0);
    });
  });

  describe('GitHub OIDC provider', () => {
    it('creates the provider when configured to', () => {
      site.template.resourceCountIs('AWS::IAM::OIDCProvider', 1);
      site.template.hasResourceProperties('AWS::IAM::OIDCProvider', {
        Url: 'https://token.actions.githubusercontent.com',
        ClientIdList: ['sts.amazonaws.com'],
      });
    });

    it('references the existing provider by ARN when configured to import it', () => {
      const imported = synthSite({
        ...TEST_CONFIG,
        github: { ...TEST_CONFIG.github, oidcProvider: 'import' },
      });
      imported.template.resourceCountIs('AWS::IAM::OIDCProvider', 0);
      for (const [, role] of resourcesOfType(imported.resources, 'AWS::IAM::Role')) {
        const [statement] = (
          role.Properties.AssumeRolePolicyDocument as {
            Statement: Statement[];
          }
        ).Statement as (Statement & { Principal: unknown })[];
        expect(statement?.Principal).toEqual({
          Federated: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
        });
      }
    });
  });

  it('exports the values the GitHub workflows need', () => {
    const outputs = Object.keys(site.template.toJSON().Outputs as Record<string, unknown>).sort();
    expect(outputs).toEqual([
      'BucketName',
      'DistributionDomainName',
      'DistributionId',
      'PreviewRoleArn',
      'ProductionRoleArn',
      'Region',
      'SiteDomain',
    ]);
  });
});

describe('CertificateStack', () => {
  it('creates a DNS-validated certificate in the existing hosted zone', () => {
    const stack = new CertificateStack(new App(), CERTIFICATE_STACK_NAME, { config: TEST_CONFIG });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'arcade.example.com',
      ValidationMethod: 'DNS',
      DomainValidationOptions: [
        { DomainName: 'arcade.example.com', HostedZoneId: TEST_CONFIG.hostedZone.id },
      ],
    });
    template.resourceCountIs('AWS::Route53::HostedZone', 0);
    expect(Object.keys(template.toJSON().Outputs as Record<string, unknown>)).toEqual([
      'CertificateArn',
    ]);
  });
});

describe('defineStacks', () => {
  const parsed = (certificateArn: string) => ({
    config: { ...TEST_CONFIG, certificateArn },
    certificateArnIsPlaceholder: certificateArn === PLACEHOLDERS.certificateArn,
  });

  it('leaves the site stack out until the certificate ARN is filled in', () => {
    const stacks = defineStacks(new App(), parsed(PLACEHOLDERS.certificateArn), {
      allowPlaceholders: false,
    });
    expect(stacks.certificate.region).toBe('us-east-1');
    expect(stacks.site).toBeNull();
  });

  it('defines both stacks once the certificate ARN is known', () => {
    const stacks = defineStacks(new App(), parsed(TEST_CONFIG.certificateArn), {
      allowPlaceholders: false,
    });
    expect(stacks.site?.region).toBe('us-west-2');
  });

  it('defines both stacks with placeholders when they are allowed (CI synth)', () => {
    const stacks = defineStacks(new App(), parsed(PLACEHOLDERS.certificateArn), {
      allowPlaceholders: true,
    });
    expect(stacks.site).not.toBeNull();
  });
});
