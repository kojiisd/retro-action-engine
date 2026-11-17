import { describe, expect, it } from 'vitest';
import { PathError, packUrl, resolvePackPath } from './paths';

describe('resolvePackPath', () => {
  it('resolves relative to the directory of the naming file', () => {
    expect(resolvePackPath('pack.json', 'data/rules.json')).toBe('data/rules.json');
    expect(resolvePackPath('rooms/a.tmj', '../tilesets/main.json')).toBe('tilesets/main.json');
    expect(resolvePackPath('atlases/x.json', 'x.png')).toBe('atlases/x.png');
    expect(resolvePackPath('a/b/c.json', './../d/./e.png')).toBe('a/d/e.png');
  });

  it.each([
    ['pack.json', '../x.json'],
    ['rooms/a.tmj', '../../x.json'],
    ['rooms/a.tmj', '..'],
    ['pack.json', '.'],
    ['pack.json', ''],
    ['pack.json', '/x.json'],
    ['pack.json', 'C:/x.json'],
    ['pack.json', 'file:///x.json'],
    ['pack.json', 'data:application/json,{}'],
    ['pack.json', 'x.json?y'],
    ['pack.json', 'x.json#y'],
  ])('rejects %s -> %s', (from, relative) => {
    expect(() => resolvePackPath(from, relative)).toThrow(PathError);
  });
});

describe('packUrl', () => {
  it('joins a base URL and a pack path', () => {
    expect(packUrl('/play/sample/packs/sample/', 'rooms/hub.tmj')).toBe(
      '/play/sample/packs/sample/rooms/hub.tmj',
    );
    expect(packUrl('/packs/sample', 'pack.json')).toBe('/packs/sample/pack.json');
  });
});
