import type { PackRuntime } from '@retro-action-engine/core';

/** A text in pack data that refers to `strings.<lang>.json` (docs/pack-spec.md 4.10). */
export const STRINGS_PREFIX = '@strings:';

/**
 * The longest character name, in characters (Unicode code points): what the menu's window has
 * room for (ADR-0020). A mechanism constant of the menu, not a game value.
 */
export const MAX_NAME_LENGTH = 6;

/** Length in characters (code points), as the menu counts them. */
export function textLength(text: string): number {
  return [...text].length;
}

/**
 * The pack language to show: the first of `preferred` (e.g. the browser's languages, `ja-JP`
 * matching `ja`) that the pack has, else the pack's default (its first). Undefined when the
 * pack has no strings.
 */
export function pickLanguage(
  runtime: Pick<PackRuntime, 'strings'>,
  preferred: readonly string[],
): string | undefined {
  const languages = Object.keys(runtime.strings ?? {});
  for (const want of preferred) {
    const base = want.toLowerCase().split('-')[0];
    const hit = languages.find((l) => l.toLowerCase() === want.toLowerCase() || l === base);
    if (hit !== undefined) return hit;
  }
  return languages[0];
}

/**
 * A text from pack data in `language`: `@strings:key` looked up (the loader has checked that
 * every language has every key used), anything else as it is.
 */
export function localize(
  runtime: Pick<PackRuntime, 'strings'>,
  text: string,
  language: string | undefined,
): string {
  if (!text.startsWith(STRINGS_PREFIX)) return text;
  const key = text.slice(STRINGS_PREFIX.length);
  const table = language === undefined ? undefined : runtime.strings?.[language];
  return table?.[key] ?? key;
}
