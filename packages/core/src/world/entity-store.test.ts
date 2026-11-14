import { describe, expect, it } from 'vitest';
import { fromPx } from '../fx/fx';
import { EntityStore } from './entity-store';

const collider = { w: fromPx(8), h: fromPx(8), ox: fromPx(-4), oy: fromPx(-8) };
const spawn = (store: EntityStore, xPx: number) =>
  store.create({ x: fromPx(xPx), y: fromPx(0), collider });

describe('EntityStore', () => {
  it('hands out increasing ids starting at 1', () => {
    const store = new EntityStore();
    expect([spawn(store, 0), spawn(store, 1), spawn(store, 2)]).toEqual([1, 2, 3]);
    expect(store.count).toBe(3);
  });

  it('grows past its initial capacity and keeps the data', () => {
    const store = new EntityStore();
    for (let i = 0; i < 100; i++) {
      spawn(store, i);
    }
    expect(store.length).toBe(100);
    expect(store.x[99]).toBe(fromPx(99));
    expect(store.slotOf(100)).toBe(99);
  });

  it('leaves a tombstone on destroy and does not reuse ids', () => {
    const store = new EntityStore();
    spawn(store, 0);
    const b = spawn(store, 1);
    spawn(store, 2);
    store.destroy(b);
    expect(store.isAlive(b)).toBe(false);
    expect(store.length).toBe(3);
    expect(store.count).toBe(2);
    expect(spawn(store, 3)).toBe(4);
  });

  it('compacts tombstones while keeping ascending id order', () => {
    const store = new EntityStore();
    for (let i = 0; i < 6; i++) {
      spawn(store, i * 10);
    }
    store.destroy(2);
    store.destroy(5);
    store.compact();
    expect(store.length).toBe(4);
    expect(Array.from(store.id.subarray(0, store.length))).toEqual([1, 3, 4, 6]);
    expect(Array.from(store.x.subarray(0, store.length))).toEqual(
      [0, 20, 30, 50].map((px) => fromPx(px)),
    );
    expect(store.slotOf(4)).toBe(2);
    expect(store.slotOf(2)).toBe(-1);
  });

  it('rejects destroying an unknown id', () => {
    expect(() => new EntityStore().destroy(1)).toThrow(RangeError);
  });

  it('clones deeply', () => {
    const store = new EntityStore();
    spawn(store, 5);
    const copy = store.clone();
    copy.x[0] = 0;
    spawn(copy, 6);
    expect(store.x[0]).toBe(fromPx(5));
    expect(store.length).toBe(1);
    expect(copy.nextId).toBe(3);
    expect(store.nextId).toBe(2);
  });
});
