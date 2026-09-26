import {
  AlpacaError,
  type AlpacaKeys,
  alpacaChains,
  alpacaCompanyNames,
  alpacaOptionQuotes,
  alpacaQuotes,
  type ChainSource,
  type CompanyNames,
  cachedChains,
  cachedLatest,
  type OptionQuoteSource,
  type QuoteSource,
} from "@tj/market-data";

export interface MarketSources {
  quotes: QuoteSource;
  optionQuotes: OptionQuoteSource;
  chains: ChainSource;
  companies: CompanyNames;
}

export interface MarketStatus {
  state: "on" | "off" | "error";
  message: string | null;
}

/** The Alpaca clients for the current key, rebuilt in place when Settings saves or removes one. */
export interface MarketData {
  /** Null without a key; routes then answer as if nothing were known. */
  sources(): MarketSources | null;
  configure(keys: AlpacaKeys | null): void;
  status(): MarketStatus;
  /** The key ID's first 2 and last 4 characters, e.g. PK…7QXA. Never the secret. */
  keyIdHint(): string | null;
  /** Logs a failed call. A refused key turns the status to error until a key is saved or removed. */
  report(error: unknown): void;
}

export interface MarketDataOptions {
  /** Builds the sources for a key; tests pass fakes. */
  build?: (keys: AlpacaKeys, report: (error: unknown) => void) => MarketSources;
  log?: (message: string) => void;
}

const REJECTED = "Alpaca rejected the saved key. Save a new one below.";

export function createMarketData(keys: AlpacaKeys | null, options: MarketDataOptions = {}): MarketData {
  const { build = alpacaSources, log = console.warn } = options;
  let current: { keys: AlpacaKeys; sources: MarketSources } | null = null;
  let rejected = false;

  const market: MarketData = {
    sources: () => current?.sources ?? null,
    configure(next) {
      rejected = false;
      current = next ? { keys: next, sources: build(next, market.report) } : null;
    },
    status() {
      if (!current) return { state: "off", message: null };
      return rejected ? { state: "error", message: REJECTED } : { state: "on", message: null };
    },
    keyIdHint: () => (current ? `${current.keys.keyId.slice(0, 2)}…${current.keys.keyId.slice(-4)}` : null),
    report(error) {
      log(`Market data unavailable: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof AlpacaError && (error.status === 401 || error.status === 403)) rejected = true;
    },
  };
  market.configure(keys);
  return market;
}

/** The live Alpaca clients, each behind its cache. */
function alpacaSources(keys: AlpacaKeys, report: (error: unknown) => void): MarketSources {
  return {
    // Shorter than the page's one-minute refresh, so every refresh gets a new price.
    quotes: cachedLatest(alpacaQuotes(keys), { ttlMs: 30_000, onError: report }),
    optionQuotes: cachedLatest(alpacaOptionQuotes(keys), { ttlMs: 30_000, onError: report }),
    chains: cachedChains(alpacaChains(keys), { ttlMs: 15 * 60_000 }),
    companies: alpacaCompanyNames(keys),
  };
}
