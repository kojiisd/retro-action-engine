import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { CERTIFICATE_STACK_NAME, defineStacks, SITE_STACK_NAME } from '../src/app.ts';
import { ConfigError, parseConfig } from '../src/config.ts';

const configPath = (name: string): string =>
  fileURLToPath(new URL(`../config/${name}`, import.meta.url));

const app = new App();
const allowPlaceholders = String(app.node.tryGetContext('allowPlaceholders')) === 'true';

// config/deploy.json is the owner's local file (gitignored). Fall back to the example so that
// `cdk synth -c allowPlaceholders=true` works in CI without it.
const localConfig = configPath('deploy.json');
const file = existsSync(localConfig) ? localConfig : configPath('deploy.example.json');

let parsed: ReturnType<typeof parseConfig>;
try {
  parsed = parseConfig(JSON.parse(readFileSync(file, 'utf8')), { allowPlaceholders });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`${file}\n${error.message}`);
    process.exit(1);
  }
  throw error;
}

const { site } = defineStacks(app, parsed, { allowPlaceholders });
if (site === null) {
  console.warn(
    `[infra] ${SITE_STACK_NAME} is not synthesized: certificateArn is still the placeholder.\n` +
      `        Deploy ${CERTIFICATE_STACK_NAME} first, then copy its CertificateArn output into ` +
      'config/deploy.json.',
  );
}

app.synth();
