import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { CERTIFICATE_REGION, type DeployConfig } from './config.ts';

export interface CertificateStackProps extends Omit<StackProps, 'env'> {
  readonly config: DeployConfig;
}

/**
 * The ACM certificate for the CloudFront distribution. CloudFront only accepts certificates in
 * us-east-1, so this stack always deploys there. It is deployed before the site stack, and its
 * CertificateArn output is copied into config/deploy.json by hand (ADR-0014, option C).
 */
export class CertificateStack extends Stack {
  readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    const { config, ...rest } = props;
    super(scope, id, {
      ...rest,
      env: { account: config.account, region: CERTIFICATE_REGION },
    });

    // The zone already exists. Reference it by ID so that synth never calls AWS.
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: config.hostedZone.id,
      zoneName: config.hostedZone.name,
    });

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: config.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'Copy this value into certificateArn in infra/config/deploy.json.',
    });
  }
}
