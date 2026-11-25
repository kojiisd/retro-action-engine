import type { CharacterDef, PackRuntime } from '../runtime/pack';
import type { World } from '../world/world';
import { activeCharacter, isAlive } from './party';
import { effectiveTags } from './tags';

/**
 * The party's items and what they grant (ADR-0021). The inventory is shared: an item's `grants`
 * go to every member while the party holds one or more.
 */

const granted = new WeakMap<CharacterDef, { key: string; tags: ReadonlySet<string> }>();

/** The ids of the items held, sorted (the cache key and the hash order). */
function heldKey(world: World): string {
  return Object.keys(world.inventory).sort().join('\n');
}

/**
 * A character's effective tags now: its own and those its party's items grant. Only queried
 * with `has`, so the order of the set does not matter.
 */
export function tagsOf(
  world: World,
  runtime: PackRuntime,
  character: CharacterDef,
): ReadonlySet<string> {
  const own = effectiveTags(character);
  const items = runtime.items;
  if (items === undefined) return own;
  const key = heldKey(world);
  if (key === '') return own;
  const hit = granted.get(character);
  if (hit !== undefined && hit.key === key) return hit.tags;
  const tags = new Set(own);
  for (const id of key.split('\n')) {
    for (const tag of items[id]?.grants ?? []) tags.add(tag);
  }
  granted.set(character, { key, tags });
  return tags;
}

/** The active character's effective tags. */
export function activeTags(world: World, runtime: PackRuntime): ReadonlySet<string> {
  return tagsOf(world, runtime, activeCharacter(world, runtime));
}

/**
 * Whether the gating subject (`rules.gating.subject`, ADR-0021) has one of `tags`: the active
 * character, or any member who is not down.
 */
export function subjectHasAny(
  world: World,
  runtime: PackRuntime,
  tags: readonly string[],
): boolean {
  const has = (set: ReadonlySet<string>) => tags.some((tag) => set.has(tag));
  if ((runtime.rules.gating?.subject ?? 'active') === 'active') {
    return has(activeTags(world, runtime));
  }
  return world.party.members.some((id, index) => {
    const character = runtime.characters[id];
    return (
      character !== undefined && isAlive(world, index) && has(tagsOf(world, runtime, character))
    );
  });
}

/** Adds `count` of an item, up to its `stack`. Returns how many were added. */
export function giveItem(
  world: World,
  runtime: PackRuntime,
  itemId: string,
  count: number,
): number {
  const def = runtime.items?.[itemId];
  if (def === undefined || count <= 0) return 0;
  const now = world.inventory[itemId] ?? 0;
  const next = Math.min(def.stack, now + count);
  if (next > 0) world.inventory[itemId] = next;
  return next - now;
}

/** Removes up to `count` of an item. An item at 0 leaves the inventory. */
export function takeItem(world: World, itemId: string, count: number): void {
  const now = world.inventory[itemId] ?? 0;
  const next = Math.max(0, now - count);
  if (next === 0) delete world.inventory[itemId];
  else world.inventory[itemId] = next;
}
