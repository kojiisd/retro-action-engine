import type { CharacterDef } from '../runtime/pack';

const cache = new WeakMap<CharacterDef, ReadonlySet<string>>();

/**
 * Effective ability tags of a character (ADR-0007): its own tags for now. Item and flag grants
 * and revokes join in M3. The set is only queried with `has`, never iterated, so its order does
 * not matter for determinism.
 */
export function effectiveTags(character: CharacterDef): ReadonlySet<string> {
  let tags = cache.get(character);
  if (tags === undefined) {
    tags = new Set(character.abilityTags);
    cache.set(character, tags);
  }
  return tags;
}
