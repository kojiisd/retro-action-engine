import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ADR-0015: the solver chooses inputs and reads results. Positions and velocities change only
// inside core's `step`; the solver's own reports must not depend on a clock or on randomness.
const SRC = fileURLToPath(new URL('.', import.meta.url));
const isSource = (name: string) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.startsWith('test-');

/** Strips comments, so that prose about these rules does not trip the guard. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const sources = readdirSync(SRC)
  .filter(isSource)
  .map((name) => ({ name, text: code(readFileSync(join(SRC, name), 'utf8')) }));

const filesWith = (pattern: RegExp) =>
  sources.filter((file) => pattern.test(file.text)).map((file) => file.name);

describe('guard: the solver has no physics of its own', () => {
  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it('advances the simulation only where inputs are chosen and where the jump is measured', () => {
    expect(filesWith(/\bstep\(/).sort()).toEqual(['macros.ts', 'probe.ts']);
  });

  it('never writes to the state of an entity', () => {
    const write = /\.(x|y|vx|vy|contact|facing)\[[^\]]*\]\s*([-+*/%]|<<|>>)?=(?!=)/;
    expect(filesWith(write)).toEqual([]);
  });

  it('does not use the movement or fixed-point arithmetic of core directly', () => {
    expect(filesWith(/\b(moveBody|moveEntities|fx)\b/)).toEqual([]);
  });

  it('does not use randomness or a clock of its own', () => {
    expect(filesWith(/\bMath\.random\b|\bDate\b|\bperformance\b/)).toEqual([]);
  });
});
