// In-memory Storage stand-in for localStorage/sessionStorage.

class MemoryStorage {
  constructor() {
    this._store = new Map();
  }
  getItem(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }
  setItem(key, value) {
    this._store.set(key, String(value));
  }
  removeItem(key) {
    this._store.delete(key);
  }
  clear() {
    this._store.clear();
  }
  get length() {
    return this._store.size;
  }
}

export function installStorageStubs() {
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
}

export function resetStorageStubs() {
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
}
