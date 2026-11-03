// CloudFront Function (runtime cloudfront-js-2.0), viewer-request event.
//
// - A request whose Host is not the site domain (for example the default *.cloudfront.net
//   domain) gets a 301 to the same path and query on https://<site domain>.
// - "/pr-12/" -> serve "/pr-12/index.html" (defaultRootObject only covers "/").
// - "/pr-12"  -> 301 to "/pr-12/" so that relative URLs resolve under the directory.
// - Paths whose last segment has a dot (assets, index.html) pass through unchanged.
//
// This file is a plain script: CloudFront calls the top-level `handler` function.
// The SITE_DOMAIN value below is replaced with the configured domain at synth time
// (infra/src/viewer-request-code.ts). It is unit-tested by infra/src/viewer-request.test.ts.

const SITE_DOMAIN = '__SITE_DOMAIN__';

// biome-ignore lint/correctness/noUnusedVariables: entry point invoked by CloudFront.
function handler(event) {
  const request = event.request;
  const uri = request.uri;
  const query = toQueryString(request.querystring);

  // biome-ignore lint/complexity/useOptionalChain: keep to syntax the CloudFront JS runtime surely supports.
  const hostHeader = request.headers && request.headers.host;
  const host = hostHeader ? hostHeader.value.toLowerCase() : '';
  if (host !== SITE_DOMAIN) {
    return redirect(`https://${SITE_DOMAIN}${uri}${query}`);
  }

  if (uri.endsWith('/')) {
    request.uri = `${uri}index.html`;
    return request;
  }

  const lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    return redirect(`${uri}/${query}`);
  }

  return request;
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: { location: { value: location } },
  };
}

// Rebuilds "?a=1&b=2" from the CloudFront querystring object, keeping repeated keys.
function toQueryString(querystring) {
  const parts = [];
  for (const name of Object.keys(querystring || {})) {
    const entry = querystring[name];
    const values = entry.multiValue ? entry.multiValue : [entry];
    for (const item of values) {
      parts.push(item.value === '' ? name : `${name}=${item.value}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
