import type { Fx } from '../fx/fx';

/** Collider in Fx, relative to the bottom-center position. */
export interface ColliderFx {
  readonly w: Fx;
  readonly h: Fx;
  readonly ox: Fx;
  readonly oy: Fx;
}

export interface EntityInit {
  readonly x: Fx;
  readonly y: Fx;
  readonly vx?: Fx;
  readonly vy?: Fx;
  readonly collider: ColliderFx;
}

const INITIAL_CAPACITY = 16;

/**
 * Entity table (ADR-0005). Hot components are typed arrays (SoA) indexed by a dense slot. Ids grow
 * monotonically within a room and slots are appended in id order, so iterating slots 0..length-1
 * visits entities in ascending id order. `destroy` leaves a tombstone (`alive = 0`); `compact`
 * removes tombstones while keeping that order (called on room entry).
 */
export class EntityStore {
  /** Number of slots in use, tombstones included. */
  length = 0;
  private nextIdValue = 1;
  private capacity = 0;

  id = new Int32Array(0);
  alive = new Uint8Array(0);
  x = new Int32Array(0);
  y = new Int32Array(0);
  vx = new Int32Array(0);
  vy = new Int32Array(0);
  colW = new Int32Array(0);
  colH = new Int32Array(0);
  colOx = new Int32Array(0);
  colOy = new Int32Array(0);
  /** CONTACT_* flags from the last move. */
  contact = new Uint8Array(0);

  /** The id the next `create` will return. */
  get nextId(): number {
    return this.nextIdValue;
  }

  /** Number of live entities. */
  get count(): number {
    let n = 0;
    for (let i = 0; i < this.length; i++) {
      n += this.alive[i] as number;
    }
    return n;
  }

  create(init: EntityInit): number {
    if (this.length === this.capacity) {
      this.grow(Math.max(INITIAL_CAPACITY, this.capacity * 2));
    }
    const slot = this.length++;
    const id = this.nextIdValue++;
    this.id[slot] = id;
    this.alive[slot] = 1;
    this.x[slot] = init.x;
    this.y[slot] = init.y;
    this.vx[slot] = init.vx ?? 0;
    this.vy[slot] = init.vy ?? 0;
    this.colW[slot] = init.collider.w;
    this.colH[slot] = init.collider.h;
    this.colOx[slot] = init.collider.ox;
    this.colOy[slot] = init.collider.oy;
    this.contact[slot] = 0;
    return id;
  }

  /** Marks the entity dead. Its slot stays until `compact`. */
  destroy(id: number): void {
    const slot = this.slotOf(id);
    if (slot < 0) {
      throw new RangeError(`entity ${id} does not exist`);
    }
    this.alive[slot] = 0;
  }

  isAlive(id: number): boolean {
    const slot = this.slotOf(id);
    return slot >= 0 && this.alive[slot] === 1;
  }

  /** Slot of the id, or -1. Binary search: ids are strictly increasing across slots. */
  slotOf(id: number): number {
    let lo = 0;
    let hi = this.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const value = this.id[mid] as number;
      if (value === id) {
        return mid;
      }
      if (value < id) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return -1;
  }

  /** Drops tombstones, keeping ascending id order. Ids are not reused. */
  compact(): void {
    let write = 0;
    for (let read = 0; read < this.length; read++) {
      if (this.alive[read] === 1) {
        if (write !== read) {
          this.copySlot(read, write);
        }
        write++;
      }
    }
    this.length = write;
  }

  /** Deep copy, for snapshots and determinism tests. */
  clone(): EntityStore {
    const copy = new EntityStore();
    copy.length = this.length;
    copy.nextIdValue = this.nextIdValue;
    copy.capacity = this.capacity;
    for (const key of COLUMNS) {
      (copy[key] as Int32Array | Uint8Array) = this[key].slice();
    }
    return copy;
  }

  private copySlot(from: number, to: number): void {
    for (const key of COLUMNS) {
      this[key][to] = this[key][from] as number;
    }
  }

  private grow(capacity: number): void {
    for (const key of COLUMNS) {
      const old = this[key];
      const next = old instanceof Uint8Array ? new Uint8Array(capacity) : new Int32Array(capacity);
      next.set(old);
      (this[key] as Int32Array | Uint8Array) = next;
    }
    this.capacity = capacity;
  }
}

/** Every per-slot column, in the fixed order used by `hash`. */
export const COLUMNS = [
  'id',
  'alive',
  'x',
  'y',
  'vx',
  'vy',
  'colW',
  'colH',
  'colOx',
  'colOy',
  'contact',
] as const;
