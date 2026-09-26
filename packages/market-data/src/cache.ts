import type { LatestSource } from "./quotes.js";

export interface LatestCacheOptions {
  ttlMs: number;
  now?: () => number;
  /** A failed refresh never throws; it is reported here and those keys go without a value. */
  onError: (error: unknown) => void;
}

/** Remembers each key's value (or its lack of one) for `ttlMs`, asking the source only for the rest. */
export function cachedLatest<T>(source: LatestSource<T>, options: LatestCacheOptions): LatestSource<T> {
  const { ttlMs, now = Date.now, onError } = options;
  const cache = new Map<string, { value: T | null; fetchedAt: number }>();

  return {
    async latest(keys) {
      const time = now();
      const stale = keys.filter((key) => {
        const hit = cache.get(key);
        return !hit || time - hit.fetchedAt >= ttlMs;
      });
      if (stale.length > 0) {
        try {
          const fetched = await source.latest(stale);
          for (const key of stale) cache.set(key, { value: fetched.get(key) ?? null, fetchedAt: time });
        } catch (error) {
          // A stale value shown as current would mislead, so it goes rather than stays.
          for (const key of stale) cache.delete(key);
          onError(error);
        }
      }
      const found = new Map<string, T>();
      for (const key of keys) {
        const value = cache.get(key)?.value;
        if (value != null) found.set(key, value);
      }
      return found;
    },
  };
}
