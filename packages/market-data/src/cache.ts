import type { Quote, QuoteSource } from "./quotes.js";

export interface QuoteCacheOptions {
  ttlMs: number;
  now?: () => number;
  /** A failed refresh never throws; it is reported here and those symbols go without a price. */
  onError: (error: unknown) => void;
}

/** Remembers each symbol's price (or its lack of one) for `ttlMs`, asking the source only for the rest. */
export function cachedQuotes(source: QuoteSource, options: QuoteCacheOptions): QuoteSource {
  const { ttlMs, now = Date.now, onError } = options;
  const cache = new Map<string, { quote: Quote | null; fetchedAt: number }>();

  return {
    async latest(symbols) {
      const time = now();
      const stale = symbols.filter((symbol) => {
        const hit = cache.get(symbol);
        return !hit || time - hit.fetchedAt >= ttlMs;
      });
      if (stale.length > 0) {
        try {
          const fetched = await source.latest(stale);
          for (const symbol of stale)
            cache.set(symbol, { quote: fetched.get(symbol) ?? null, fetchedAt: time });
        } catch (error) {
          // A stale price shown as current would mislead, so it goes rather than stays.
          for (const symbol of stale) cache.delete(symbol);
          onError(error);
        }
      }
      const found = new Map<string, Quote>();
      for (const symbol of symbols) {
        const quote = cache.get(symbol)?.quote;
        if (quote) found.set(symbol, quote);
      }
      return found;
    },
  };
}
