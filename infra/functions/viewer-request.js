// CloudFront Function (runtime cloudfront-js-2.0), viewer-request event.
//
// - "/pr-12/" -> serve "/pr-12/index.html" (defaultRootObject only covers "/").
// - "/pr-12"  -> 301 to "/pr-12/" so that relative URLs resolve under the directory.
// - Paths whose last segment has a dot (assets, index.html) pass through unchanged.
//
// This file is a plain script: CloudFront calls the top-level `handler` function.
// It is loaded by infra/src/site-stack.ts and unit-tested by infra/src/viewer-request.test.ts.

// biome-ignore lint/correctness/noUnusedVariables: entry point invoked by CloudFront.
function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = `${uri}index.html`;
    return request;
  }

  const lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: `${uri}/${toQueryString(request.querystring)}` } },
    };
  }

  return request;
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
