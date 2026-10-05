import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type QueryString = Record<string, { value: string; multiValue?: { value: string }[] }>;
type Request = { uri: string; querystring: QueryString };
type Redirect = { statusCode: number; headers: { location: { value: string } } };

// The function is a plain script for CloudFront, so evaluate it and take `handler` out.
const source = readFileSync(
  fileURLToPath(new URL('../functions/viewer-request.js', import.meta.url)),
  'utf8',
);
const handler = new Function(`${source}\nreturn handler;`)() as (event: {
  request: Request;
}) => Request | Redirect;

const run = (uri: string, querystring: QueryString = {}) =>
  handler({ request: { uri, querystring } });

describe('viewer-request CloudFront Function', () => {
  it('serves index.html for directory paths', () => {
    expect(run('/')).toMatchObject({ uri: '/index.html' });
    expect(run('/pr-12/')).toMatchObject({ uri: '/pr-12/index.html' });
    expect(run('/play/sample/')).toMatchObject({ uri: '/play/sample/index.html' });
  });

  it('redirects extensionless paths to the directory with a trailing slash', () => {
    expect(run('/pr-12')).toEqual({
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: '/pr-12/' } },
    });
  });

  it('keeps the query string when redirecting', () => {
    const result = run('/pr-12', {
      debug: { value: '1' },
      tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] },
      flag: { value: '' },
    }) as Redirect;
    expect(result.headers.location.value).toBe('/pr-12/?debug=1&tag=a&tag=b&flag');
  });

  it('passes files through unchanged', () => {
    expect(run('/assets/index-abc123.js')).toMatchObject({ uri: '/assets/index-abc123.js' });
    expect(run('/pr-12/index.html')).toMatchObject({ uri: '/pr-12/index.html' });
  });
});
