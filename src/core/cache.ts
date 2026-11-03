/** In-process TTL cache. Dies with the process (Constitution III). Never stores errors. */
export interface Cache<T> {
  key(ecosystem: string, name: string): string;
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_CACHE_MAX_ENTRIES = 10_000;

export function createCache<T>(options: CacheOptions = {}): Cache<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  // Map preserves insertion order, which gives oldest-first eviction for free.
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    key: (ecosystem, name) => `${ecosystem}\0${name}`,
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlMs });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
  };
}
