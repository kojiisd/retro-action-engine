import { COLUMNS } from '../world/entity-store';
import type { World } from '../world/world';

/** `[hi, lo]`: two independent FNV-1a 32-bit lanes (ADR-0002). */
export type WorldHash = readonly [number, number];

const FNV_PRIME = 0x01000193;
/** Standard FNV-1a offset basis. */
const LANE_HI_BASIS = 0x811c9dc5;
/** Second lane: FNV-1a of the ASCII bytes "retro-action-engine", fixed so it never changes. */
const LANE_LO_BASIS = 0xea4bc20d;

/**
 * Byte-level FNV-1a over two lanes. Inputs:
 * - int32: 4 bytes, little-endian.
 * - bool: 1 byte (0 or 1).
 * - string: its length as int32, then each UTF-16 code unit as 2 bytes, little-endian.
 */
export class Hasher {
  private hi = LANE_HI_BASIS;
  private lo = LANE_LO_BASIS;

  byte(value: number): this {
    const b = value & 0xff;
    this.hi = Math.imul(this.hi ^ b, FNV_PRIME);
    this.lo = Math.imul(this.lo ^ b, FNV_PRIME);
    return this;
  }

  int32(value: number): this {
    if (!Number.isInteger(value) || value < -(2 ** 31) || value > 2 ** 32 - 1) {
      throw new RangeError(`hash: ${value} is not a 32-bit integer`);
    }
    const v = value | 0;
    return this.byte(v)
      .byte(v >>> 8)
      .byte(v >>> 16)
      .byte(v >>> 24);
  }

  bool(value: boolean): this {
    return this.byte(value ? 1 : 0);
  }

  string(value: string): this {
    this.int32(value.length);
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      this.byte(unit).byte(unit >>> 8);
    }
    return this;
  }

  digest(): WorldHash {
    return [this.hi >>> 0, this.lo >>> 0];
  }
}

const FLAG_NUMBER = 0;
const FLAG_BOOLEAN = 1;

/**
 * Deterministic hash of the World. Order (ADR-0002): tick, rng, roomId, party (with hp and the
 * hazard state last, ADR-0016), controller,
 * animation, transition and the closed exits (ADR-0018), flags
 * (keys sorted by UTF-16 code units), entities (live ones in ascending id order, columns in
 * `COLUMNS` order).
 * Tombstones and slot positions do not affect the result, so `compact` keeps the hash.
 */
export function hashWorld(world: World): WorldHash {
  const h = new Hasher();
  h.int32(world.tick).int32(world.rng).string(world.roomId);

  const p = world.party;
  h.int32(p.members.length);
  for (const member of p.members) {
    h.string(member);
  }
  h.int32(p.activeIndex).int32(p.cooldownTicks).int32(p.entityId).int32(p.spawnX).int32(p.spawnY);
  // ADR-0016 (M2-5): HP per member, then the HP-draining tile being touched.
  h.int32(p.hp.length);
  for (const hp of p.hp) {
    h.int32(hp);
  }
  h.string(p.hazardId).int32(p.hazardTicks);
  // ADR-0018 (M3-1): the spawn the room was entered at.
  h.string(p.spawnId);

  const c = world.controller;
  h.string(c.feelProfileId)
    .int32(c.facing)
    .int32(c.lastGroundedTick)
    .bool(c.jumpedSinceGrounded)
    .int32(c.jumpPressedTick)
    .int32(c.jumpStartTick)
    .bool(c.jumpCut)
    .int32(c.dropThroughUntilTick)
    .int32(c.landingLagUntilTick)
    .int32(c.leftPressedTick)
    .int32(c.rightPressedTick)
    // ADR-0017 (M2-5).
    .int32(c.attackUntilTick);

  const a = world.animation;
  h.string(a.name).int32(a.frame).int32(a.ticks);

  // ADR-0018 (M3-1): the room change in progress, then the exits closed until the body leaves.
  const tr = world.transition;
  h.string(tr.phase)
    .int32(tr.tick)
    .int32(tr.outTicks)
    .int32(tr.inTicks)
    .string(tr.toRoomId)
    .string(tr.spawnId)
    .string(tr.kind)
    .string(tr.effect);
  h.int32(world.disarmedExits.length);
  for (const index of world.disarmedExits) {
    h.int32(index);
  }

  const keys = Object.keys(world.flags).sort();
  h.int32(keys.length);
  for (const key of keys) {
    const value = world.flags[key] as number | boolean;
    h.string(key);
    if (typeof value === 'boolean') {
      h.byte(FLAG_BOOLEAN).bool(value);
    } else {
      h.byte(FLAG_NUMBER).int32(value);
    }
  }

  const store = world.entities;
  h.int32(store.count);
  for (let slot = 0; slot < store.length; slot++) {
    if (store.alive[slot] !== 1) {
      continue;
    }
    for (const key of COLUMNS) {
      if (key !== 'alive') {
        h.int32(store[key][slot] as number);
      }
    }
  }
  return h.digest();
}
