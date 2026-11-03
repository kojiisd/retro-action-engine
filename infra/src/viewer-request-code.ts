import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = fileURLToPath(new URL('../functions/viewer-request.js', import.meta.url));
const DOMAIN_PLACEHOLDER = '__SITE_DOMAIN__';
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Returns the viewer-request CloudFront Function code with the site domain filled in.
 * The domain is validated so that nothing but a plain lower-case host name reaches the code.
 */
export function renderViewerRequestCode(siteDomain: string): string {
  if (!DOMAIN_PATTERN.test(siteDomain)) {
    throw new Error(`site domain "${siteDomain}" is not a lower-case host name`);
  }
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const occurrences = source.split(DOMAIN_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `expected exactly one ${DOMAIN_PLACEHOLDER} in ${SOURCE_PATH}, found ${occurrences}`,
    );
  }
  return source.replace(DOMAIN_PLACEHOLDER, siteDomain);
}
