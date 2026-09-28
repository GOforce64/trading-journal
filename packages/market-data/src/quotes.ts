/** The last trade seen for a symbol: a reference price, never a record (spec §8.6). */
export interface Quote {
  price: number;
  /** When that trade printed, in epoch milliseconds. */
  at: number;
}

/** Answers "what is the latest value for each of these keys". Keys it knows nothing about are left out, never guessed. */
export interface LatestSource<T> {
  latest(keys: readonly string[]): Promise<Map<string, T>>;
}

export type QuoteSource = LatestSource<Quote>;
