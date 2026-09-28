import { nyDate, nyWallClock } from "@tj/core";
import { z } from "zod";
import { INVALID_SYMBOL } from "./alpaca.js";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";

export const STOCK_BARS = `${DATA_API}/v2/stocks/bars`;

/** What a stock traded at in the past: when a fly was opened or closed, or the day it expired. */
export interface BarSource {
  /**
   * The close of the last regular-session 1-min bar that started before `at`, or null if Alpaca has none.
   * `at` is a whole minute inside the session: core's sessionMoment.
   */
  priceAt(symbol: string, at: number): Promise<number | null>;
  /** The regular-session close on a New York date, from the daily bar, or null. */
  closeOn(symbol: string, date: string): Promise<number | null>;
}

const barsSchema = z.object({
  bars: z
    .record(
      z.string(),
      z.array(z.object({ t: z.iso.datetime({ offset: true }), c: z.number().positive() })).nullable(),
    )
    .nullish(),
});

interface Bar {
  t: number;
  c: number;
}

const SESSION_OPEN = 9 * 60 + 30;
/** The free plan's refusal of SIP data from the last 15 minutes: no price yet, not a bad key. */
const RECENT_SIP = /recent SIP data/i;

/** Refusals that mean "no price" rather than an error: too recent for the free plan, or an unknown symbol. */
const meansNoPrice = (error: unknown) =>
  error instanceof AlpacaError &&
  ((error.status === 403 && RECENT_SIP.test(error.detail)) ||
    (error.status === 400 && INVALID_SYMBOL.test(error.detail)));

/**
 * Historical SIP bars from the free plan. Prices are raw, never split-adjusted, so they match the strikes.
 * Nothing is cached: each price is fetched once and then stored with its trade.
 */
export function alpacaBars(keys: AlpacaKeys, options: AlpacaOptions = {}): BarSource {
  async function bars(symbol: string, query: Record<string, string>): Promise<Bar[]> {
    const params = new URLSearchParams({
      symbols: symbol,
      ...query,
      feed: "sip",
      adjustment: "raw",
      limit: "1000",
    });
    try {
      const reply = barsSchema.parse(await alpacaGet(`${STOCK_BARS}?${params}`, keys, options));
      return (reply.bars?.[symbol] ?? []).map((bar) => ({ t: Date.parse(bar.t), c: bar.c }));
    } catch (error) {
      if (meansNoPrice(error)) return [];
      throw error;
    }
  }

  return {
    async priceAt(symbol, at) {
      // One session is at most 390 bars, so a single page always reaches back to the open.
      const start = nyWallClock(nyDate(at), SESSION_OPEN);
      const found = await bars(symbol, {
        timeframe: "1Min",
        start: new Date(start).toISOString(),
        end: new Date(at).toISOString(),
      });
      // A bar is stamped with its start: the one stamped 15:53 closes at 15:54.
      const last = found
        .filter((bar) => bar.t < at)
        .reduce<Bar | null>((latest, bar) => (!latest || bar.t > latest.t ? bar : latest), null);
      return last?.c ?? null;
    },
    async closeOn(symbol, date) {
      const found = await bars(symbol, { timeframe: "1Day", start: date, end: date });
      return found.at(-1)?.c ?? null;
    },
  };
}
