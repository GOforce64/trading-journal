import { nyDate } from "@tj/core";
import { z } from "zod";
import { type AlpacaKeys, type AlpacaOptions, alpacaGet, TRADING_API } from "./http.js";

const CONTRACTS = `${TRADING_API}/v2/options/contracts`;

/** A runaway page token must not loop forever; 20 pages of 10,000 is far beyond any real chain. */
const MAX_PAGES = 20;

/**
 * Expired contracts are asked for this far past `since`: far enough for any trade this journal holds
 * to find its expiry, without pulling a year of a busy name's expired chains.
 */
const EXPIRED_WINDOW_DAYS = 90;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface ListedExpiration {
  /** YYYY-MM-DD */
  date: string;
  /** Before today in New York. */
  expired: boolean;
  /** Every strike listed for this date, calls and puts together, ascending. */
  strikes: number[];
}

export interface ChainSource {
  /** Every expiration on or after `since` (today when omitted), with its strikes. Empty when nothing is listed. */
  listed(symbol: string, since?: string): Promise<ListedExpiration[]>;
}

export interface ChainOptions extends AlpacaOptions {
  /** Today's New York date; injectable for tests. */
  today?: () => string;
}

const contractsSchema = z.object({
  option_contracts: z.array(z.object({ expiration_date: z.string(), strike_price: z.string() })).nullish(),
  next_page_token: z.string().nullish(),
  page_token: z.string().nullish(),
});

type ListedContract = { expiration_date: string; strike_price: string };

/**
 * The listed contracts for a symbol, from the paper trading API. Its default window ends at the
 * coming weekend, so a range is always given; expired contracts need `status=inactive`.
 */
export function alpacaChains(keys: AlpacaKeys, options: ChainOptions = {}): ChainSource {
  const today = options.today ?? (() => nyDate(Date.now()));

  async function contracts(params: Record<string, string>): Promise<ListedContract[]> {
    const found: ListedContract[] = [];
    let token: string | null | undefined;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const query = new URLSearchParams({ ...params, limit: "10000" });
      if (token) query.set("page_token", token);
      const reply = contractsSchema.parse(await alpacaGet(`${CONTRACTS}?${query}`, keys, options));
      found.push(...(reply.option_contracts ?? []));
      token = reply.next_page_token ?? reply.page_token;
      if (!token) return found;
    }
    throw new Error(`Alpaca kept sending pages of contracts past ${MAX_PAGES} pages`);
  }

  return {
    async listed(symbol, since) {
      const now = today();
      const lastYear = Number(now.slice(0, 4)) + 3;
      const found = await contracts({
        underlying_symbols: symbol,
        status: "active",
        expiration_date_gte: now,
        expiration_date_lte: `${lastYear}-12-31`,
      });
      if (since && since < now) {
        found.push(
          ...(await contracts({
            underlying_symbols: symbol,
            status: "inactive",
            expiration_date_gte: since,
            expiration_date_lte: [now, addDays(since, EXPIRED_WINDOW_DAYS)].sort()[0] ?? now,
          })),
        );
      }
      return byExpiration(found, now);
    },
  };
}

function byExpiration(contracts: ListedContract[], today: string): ListedExpiration[] {
  const strikes = new Map<string, Set<number>>();
  for (const listed of contracts) {
    const strike = Number(listed.strike_price);
    if (!Number.isFinite(strike)) continue;
    const forDate = strikes.get(listed.expiration_date) ?? new Set<number>();
    forDate.add(strike);
    strikes.set(listed.expiration_date, forDate);
  }
  return [...strikes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, set]) => ({ date, expired: date < today, strikes: [...set].sort((a, b) => a - b) }));
}

/** Keeps each (symbol, since) answer for `ttlMs`. A failure is never kept, so the next call tries again. */
export function cachedChains(
  source: ChainSource,
  options: { ttlMs: number; now?: () => number },
): ChainSource {
  const { ttlMs, now = Date.now } = options;
  const cache = new Map<string, { value: ListedExpiration[]; fetchedAt: number }>();
  return {
    async listed(symbol, since) {
      const key = `${symbol}|${since ?? ""}`;
      const time = now();
      const hit = cache.get(key);
      if (hit && time - hit.fetchedAt < ttlMs) return hit.value;
      const value = await source.listed(symbol, since);
      cache.set(key, { value, fetchedAt: time });
      return value;
    },
  };
}
