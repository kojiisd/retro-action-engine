import { CONTACT_GROUNDED } from '../collision/move';
import type { CharacterDef, PackRuntime } from '../runtime/pack';
import { NEVER, type World } from '../world/world';
import type { Intent } from './intent';

/** Whether switching exists at all for this party: false with one member or `mode: 'never'`. */
export function canSwitch(world: World, runtime: PackRuntime): boolean {
  return world.party.members.length > 1 && runtime.rules.party.switch.mode === 'anywhere';
}

export function activeCharacter(world: World, runtime: PackRuntime): CharacterDef {
  const id = world.party.members[world.party.activeIndex] as string;
  const character = runtime.characters[id];
  if (character === undefined) {
    throw new RangeError(`party member "${id}" is not a defined character`);
  }
  return character;
}

/** Whether a member can play: always, without HP rules (ADR-0016). */
export function isAlive(world: World, index: number): boolean {
  const hp = world.party.hp;
  return hp.length === 0 || (hp[index] as number) > 0;
}

/** The next living member after the active one, in `members` order, if any. */
export function nextAlive(world: World): number | undefined {
  const count = world.party.members.length;
  for (let k = 1; k < count; k++) {
    const index = (world.party.activeIndex + k) % count;
    if (isAlive(world, index)) return index;
  }
  return undefined;
}

/** Puts the character's collider on the party entity. */
export function applyCharacter(world: World, character: CharacterDef): void {
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  s.colW[slot] = character.collider.w;
  s.colH[slot] = character.collider.h;
  s.colOx[slot] = character.collider.ox;
  s.colOy[slot] = character.collider.oy;
}

/**
 * The `party` system (docs/architecture.md 4.3, ADR-0007). A switch request moves to the next
 * member when switching is enabled, the cooldown is over and, if required, the character is on
 * the ground. `placement: 'spawn'` moves the body to the room's entry spawn and stops it.
 * Members whose HP is 0 are skipped; with no other living member nothing happens (ADR-0016).
 */
export function partyStep(world: World, intent: Intent, runtime: PackRuntime): void {
  const party = world.party;
  const rules = runtime.rules.party.switch;
  if (!intent.switchRequested || !canSwitch(world, runtime) || party.cooldownTicks > 0) {
    return;
  }
  const s = world.entities;
  const slot = s.slotOf(party.entityId);
  if (rules.requireGrounded && ((s.contact[slot] as number) & CONTACT_GROUNDED) === 0) {
    return;
  }
  const next = nextAlive(world);
  if (next === undefined) {
    return;
  }
  party.activeIndex = next;
  party.cooldownTicks = rules.cooldownTicks;
  // A swing does not carry over to the next character (ADR-0017).
  world.controller.attackUntilTick = NEVER;
  applyCharacter(world, activeCharacter(world, runtime));
  if (rules.placement === 'spawn') {
    s.x[slot] = party.spawnX;
    s.y[slot] = party.spawnY;
    s.vx[slot] = 0;
    s.vy[slot] = 0;
  }
}
