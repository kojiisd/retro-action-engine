import type { core } from 'zod';

/** One problem in a pack file, written as `file#/json/pointer: message` (docs/pack-spec.md 8). */
export type PackIssue = string;

/** The pack could not be loaded. `issues` lists every problem found, not only the first. */
export class PackLoadError extends Error {
  constructor(readonly issues: readonly PackIssue[]) {
    super(`the pack has ${issues.length} problem(s):\n${issues.join('\n')}`);
    this.name = 'PackLoadError';
  }
}

/** JSON Pointer (RFC 6901) of a path of keys and indexes. */
export function pointer(path: ReadonlyArray<PropertyKey>): string {
  return path.map((key) => `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** Formats zod issues of one file. */
export function zodIssues(file: string, issues: readonly core.$ZodIssue[]): PackIssue[] {
  return issues.map((issue) => `${file}#${pointer(issue.path)}: ${issue.message}`);
}

/** Collects problems; `fail` throws them all at once. */
export class IssueList {
  readonly errors: PackIssue[] = [];
  readonly warnings: PackIssue[] = [];

  error(file: string, path: ReadonlyArray<PropertyKey>, message: string): void {
    this.errors.push(`${file}#${pointer(path)}: ${message}`);
  }

  warn(file: string, path: ReadonlyArray<PropertyKey>, message: string): void {
    this.warnings.push(`${file}#${pointer(path)}: ${message}`);
  }

  throwIfAny(): void {
    if (this.errors.length > 0) throw new PackLoadError(this.errors);
  }
}
