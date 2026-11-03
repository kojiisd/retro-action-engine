import { describe, expect, it } from 'vitest';
import { renderViewerRequestCode } from './viewer-request-code.ts';

type QueryString = Record<string, { value: string; multiValue?: { value: string }[] }>;
type Headers = Record<string, { value: string }>;
type Request = { uri: string; querystring: QueryString; headers: Headers };
type Redirect = { statusCode: number; headers: { location: { value: string } } };

const SITE_DOMAIN = 'arcade.example.com';

// The function is a plain script for CloudFront, so evaluate the rendered code and take
// `handler` out.
const handler = new Function(
  `${renderViewerRequestCode(SITE_DOMAIN)}\nreturn handler;`,
)() as (event: { request: Request }) => Request | Redirect;

const run = (uri: string, querystring: QueryString = {}, host: string | null = SITE_DOMAIN) =>
  handler({
    request: { uri, querystring, headers: host === null ? {} : { host: { value: host } } },
  });

describe('viewer-request CloudFront Function', () => {
  it('serves index.html for directory paths', () => {
    expect(run('/')).toMatchObject({ uri: '/index.html' });
    expect(run('/pr-12/')).toMatchObject({ uri: '/pr-12/index.html' });
    expect(run('/play/2dsample/')).toMatchObject({ uri: '/play/2dsample/index.html' });
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

  describe('host check', () => {
    it('redirects the default CloudFront domain to the site domain, keeping path and query', () => {
      expect(
        run('/play/2dsample/', { a: { value: '1' } }, 'd111111abcdef8.cloudfront.net'),
      ).toEqual({
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: { location: { value: 'https://arcade.example.com/play/2dsample/?a=1' } },
      });
    });

    it('redirects files and preview paths on other hosts too', () => {
      expect(
        (run('/pr-3/assets/x.js', {}, 'other.example.net') as Redirect).headers.location,
      ).toEqual({
        value: 'https://arcade.example.com/pr-3/assets/x.js',
      });
    });

    it('redirects when the Host header is missing', () => {
      expect((run('/', {}, null) as Redirect).statusCode).toBe(301);
    });

    it('accepts the site domain in any letter case', () => {
      expect(run('/', {}, 'ARCADE.Example.com')).toMatchObject({ uri: '/index.html' });
    });

    it('does not treat a look-alike host as the site domain', () => {
      expect((run('/', {}, 'arcade.example.com.evil.test') as Redirect).statusCode).toBe(301);
      expect((run('/', {}, 'xarcade.example.com') as Redirect).statusCode).toBe(301);
    });
  });
});

describe('renderViewerRequestCode', () => {
  it('embeds the domain exactly once and leaves no placeholder', () => {
    const code = renderViewerRequestCode(SITE_DOMAIN);
    expect(code).toContain(`const SITE_DOMAIN = '${SITE_DOMAIN}';`);
    expect(code).not.toContain('__SITE_DOMAIN__');
  });

  it('rejects values that are not plain lower-case host names', () => {
    expect(() => renderViewerRequestCode("x.com'; alert(1); '")).toThrow(/not a lower-case host/);
    expect(() => renderViewerRequestCode('Arcade.Example.com')).toThrow(/not a lower-case host/);
    expect(() => renderViewerRequestCode('')).toThrow(/not a lower-case host/);
  });
});
