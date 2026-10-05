import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import {
  type DeployConfig,
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_HOST,
  previewSubject,
  productionSubject,
} from './config.ts';

/** Key prefix of PR previews: pr-<number>/. Production never writes or deletes under it. */
export const PREVIEW_KEY_PATTERN = 'pr-*';

/** CloudFront path pattern of PR previews. */
export const PREVIEW_PATH_PATTERN = 'pr-*';

/** Two years, the usual HSTS max-age. */
const HSTS_MAX_AGE = Duration.days(730);

const VIEWER_REQUEST_FUNCTION_PATH = fileURLToPath(
  new URL('../functions/viewer-request.js', import.meta.url),
);

export interface SiteStackProps extends Omit<StackProps, 'env'> {
  readonly config: DeployConfig;
}

/**
 * Static hosting for the player: private S3 bucket, CloudFront with OAC, the custom domain,
 * and the two GitHub OIDC roles (production and preview). See ADR-0014.
 */
export class SiteStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly productionRole: iam.Role;
  readonly previewRole: iam.Role;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    const { config, ...rest } = props;
    super(scope, id, {
      ...rest,
      env: { account: config.account, region: config.region },
    });

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Created in us-east-1 by the certificate stack and passed in through the config file.
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      config.certificateArn,
    );

    const viewerRequest = new cloudfront.Function(this, 'ViewerRequestFunction', {
      code: cloudfront.FunctionCode.fromFile({ filePath: VIEWER_REQUEST_FUNCTION_PATH }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment:
        'Serve index.html for directory paths and add a trailing slash to extensionless paths',
    });

    const securityHeadersBehavior: cloudfront.ResponseSecurityHeadersBehavior = {
      // No includeSubdomains: the policy must not leak to other subdomains of the zone.
      strictTransportSecurity: {
        accessControlMaxAge: HSTS_MAX_AGE,
        includeSubdomains: false,
        preload: false,
        override: true,
      },
      contentTypeOptions: { override: true },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      // Content-Security-Policy is deferred to M4 (Phaser and the service worker need care).
    };

    const siteHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeadersPolicy', {
      comment: 'Security headers for production paths',
      securityHeadersBehavior,
    });

    const previewHeaders = new cloudfront.ResponseHeadersPolicy(this, 'PreviewHeadersPolicy', {
      comment: 'Security headers and noindex for PR previews',
      securityHeadersBehavior,
      customHeadersBehavior: {
        customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex', override: true }],
      },
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);
    const behavior = (
      responseHeadersPolicy: cloudfront.IResponseHeadersPolicy,
    ): cloudfront.BehaviorOptions => ({
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      responseHeadersPolicy,
      functionAssociations: [
        { function: viewerRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
      ],
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `retro-action-engine site (${config.domainName})`,
      defaultBehavior: behavior(siteHeaders),
      additionalBehaviors: { [PREVIEW_PATH_PATTERN]: behavior(previewHeaders) },
      domainNames: [config.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass[priceClassKey(config.priceClass)],
      defaultRootObject: 'index.html',
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: config.hostedZone.id,
      zoneName: config.hostedZone.name,
    });
    const aliasTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(this.distribution),
    );
    new route53.ARecord(this, 'AliasRecord', {
      zone,
      recordName: config.domainName,
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, 'AliasRecordIpv6', {
      zone,
      recordName: config.domainName,
      target: aliasTarget,
    });

    const oidcProvider =
      config.github.oidcProvider === 'create'
        ? new iam.OidcProviderNative(this, 'GitHubOidcProvider', {
            url: `https://${GITHUB_OIDC_HOST}`,
            clientIds: [GITHUB_OIDC_AUDIENCE],
            // Keep it if the stack is deleted: other workloads in the account may rely on it.
            removalPolicy: RemovalPolicy.RETAIN,
          })
        : iam.OidcProviderNative.fromOidcProviderArn(
            this,
            'GitHubOidcProvider',
            `arn:aws:iam::${config.account}:oidc-provider/${GITHUB_OIDC_HOST}`,
          );

    const githubRole = (roleId: string, subject: string, description: string): iam.Role =>
      new iam.Role(this, roleId, {
        description,
        maxSessionDuration: Duration.hours(1),
        assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
          StringEquals: {
            [`${GITHUB_OIDC_HOST}:aud`]: GITHUB_OIDC_AUDIENCE,
            [`${GITHUB_OIDC_HOST}:sub`]: subject,
          },
        }),
      });

    this.productionRole = githubRole(
      'DeployProductionRole',
      productionSubject(config),
      'GitHub Actions deploy to production (environment-bound)',
    );
    this.productionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteSiteObjects',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [this.bucket.arnForObjects('*')],
      }),
    );
    this.productionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListSiteBucket',
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
      }),
    );
    this.distribution.grantCreateInvalidation(this.productionRole);

    this.previewRole = githubRole(
      'DeployPreviewRole',
      previewSubject(config),
      'GitHub Actions deploy of PR previews (pr-* keys only)',
    );
    this.previewRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WritePreviewObjects',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [this.bucket.arnForObjects(PREVIEW_KEY_PATTERN)],
      }),
    );
    this.previewRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListPreviewPrefixes',
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [PREVIEW_KEY_PATTERN] } },
      }),
    );
    // CloudFront cannot scope invalidations by path in IAM. Accepted in ADR-0014: the preview
    // role can flush the cache but cannot write production objects.
    this.distribution.grantCreateInvalidation(this.previewRole);

    const outputs: Record<string, [string, string]> = {
      Region: [this.region, 'GitHub variable AWS_REGION'],
      BucketName: [this.bucket.bucketName, 'GitHub variable S3_BUCKET'],
      DistributionId: [this.distribution.distributionId, 'GitHub variable CF_DISTRIBUTION_ID'],
      SiteDomain: [config.domainName, 'GitHub variable SITE_DOMAIN'],
      ProductionRoleArn: [this.productionRole.roleArn, 'GitHub variable AWS_ROLE_ARN_PRODUCTION'],
      PreviewRoleArn: [this.previewRole.roleArn, 'GitHub variable AWS_ROLE_ARN_PREVIEW'],
      DistributionDomainName: [
        this.distribution.distributionDomainName,
        'CloudFront domain (for troubleshooting)',
      ],
    };
    for (const [outputId, [value, description]] of Object.entries(outputs)) {
      new CfnOutput(this, outputId, { value, description });
    }
  }
}

function priceClassKey(name: DeployConfig['priceClass']): keyof typeof cloudfront.PriceClass {
  switch (name) {
    case 'PriceClass_100':
      return 'PRICE_CLASS_100';
    case 'PriceClass_200':
      return 'PRICE_CLASS_200';
    case 'PriceClass_All':
      return 'PRICE_CLASS_ALL';
  }
}
