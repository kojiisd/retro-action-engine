import { createStore, get, set } from 'idb-keyval';
import type { KeyValueStore } from './settings';

/** Settings in IndexedDB through idb-keyval (ADR-0011), in a database of this app's own. */
export function idbStore(): KeyValueStore {
  const store = createStore('retro-action-engine', 'settings');
  return {
    kind: 'indexedDB',
    get: (key) => get(key, store),
    set: (key, value) => set(key, value, store),
  };
}
