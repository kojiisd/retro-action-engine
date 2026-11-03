import { describe, expect, it } from 'vitest';
import { isRelativePath } from './gallery-data';

describe('isRelativePath', () => {
  it('accepts paths relative to the gallery page', () => {
    expect(isRelativePath('play/2dsample/')).toBe(true);
    expect(isRelativePath('images/2dsample.svg')).toBe(true);
  });

  it('rejects absolute paths, URLs, parent references and empty strings', () => {
    for (const path of [
      '/play/x/',
      'https://example.com/',
      'javascript:alert(1)',
      '../x',
      'a/../b',
      '',
    ]) {
      expect(isRelativePath(path)).toBe(false);
    }
  });
});
