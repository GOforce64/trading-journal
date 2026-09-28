/** The last trade seen for a symbol: a reference price, never a record (spec §8.6). */
export interface Quote {
  price: number;
  /** When that trade printed, in epoch milliseconds. */
  at: number;
}

export interface QuoteSource {
  /** Symbols without a known price are left out rather than guessed. */
  latest(symbols: readonly string[]): Promise<Map<string, Quote>>;
}
