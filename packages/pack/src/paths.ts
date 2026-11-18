/**
 * Pack-relative paths. Every path in a pack file is relative to the file that names it, and may
 * not leave the pack root (no `..` past the root, no absolute paths, no URLs). This keeps a pack
 * from reading anything outside its own directory.
 */
export class PathError extends Error {}

/** Resolves `relative` against the directory of `fromFile` (both pack-relative, `/` separated). */
export function resolvePackPath(fromFile: string, relative: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.startsWith('//')) {
    throw new PathError(`"${relative}" is a URL; only paths inside the pack are allowed`);
  }
  if (relative === '' || relative.startsWith('/') || relative.startsWith('\\')) {
    throw new PathError(`"${relative}" is not a relative path`);
  }
  if (relative.includes('\\') || relative.includes('?') || relative.includes('#')) {
    throw new PathError(`"${relative}" has characters a pack path cannot have`);
  }
  const parts = fromFile.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new PathError(`"${relative}" leaves the pack`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (parts.length === 0) throw new PathError(`"${relative}" names the pack root`);
  return parts.join('/');
}

/** The URL of a pack-relative path under `baseUrl` (which ends with `/`). */
export function packUrl(baseUrl: string, path: string): string {
  return baseUrl.endsWith('/') ? baseUrl + path : `${baseUrl}/${path}`;
}
