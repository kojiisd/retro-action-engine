import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CLAUDE.md and ADR-0002: core must not use these, because they are non-deterministic or
// implementation-dependent across JavaScript engines.
const FORBIDDEN: Array<[string, RegExp]> = [
  ['Math.random', /\bMath\.random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  [
    'Math transcendental functions',
    /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|pow|exp|expm1|log|log2|log10|log1p|sqrt|cbrt|hypot)\b/,
  ],
  ['exponent operator on non-literals', /[A-Za-z_)\]]\s*\*\*/],
  ['DOM globals', /\b(window|document|fetch|navigator|localStorage)\b/],
];

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    const isTestOnly = name.endsWith('.test.ts') || name.startsWith('test-');
    return name.endsWith('.ts') && !isTestOnly ? [path] : [];
  });
}

/** Strips comments so that prose such as "no Math.random" does not trip the guard. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('determinism guard for core sources', () => {
  const files = sourceFiles(SRC);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`does not use ${label}`, () => {
      const offenders = files.filter((file) => pattern.test(code(readFileSync(file, 'utf8'))));
      expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
    });
  }
});
