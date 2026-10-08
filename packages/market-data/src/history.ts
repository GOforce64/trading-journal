import type { PriceBar } from "@tj/core";
import { z } from "zod";
import { STOCK_BARS } from "./bars.js";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";

/** The chart's history (trade-chart spec §6): whole days of bars, where move data needs single prices. */
export interface BarHistory {
  /** 1-minute bars from `start` to `end` (epoch ms), extended hours included, oldest first. [] for an unknown symbol. */
  minuteBars(symbol: string, start: number, end: number): Promise<PriceBar[]>;
  /** Daily bars for the New York dates `from` to `to`, inclusive. */
  dailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
}

/** Alpaca's option bars (premium-chart spec §5.1): OPRA trades, regular hours only, from 2024-01-18. */
export const OPTION_BARS = `${DATA_API}/v1beta1/options/bars`;

/** The option chart's history (premium-chart spec §5.1). */
export interface OptionBarHistory {
  /** One contract's 1-minute bars from `start` to `end` (epoch ms), oldest first. [] for an unknown contract. */
  minuteBars(contract: string, start: number, end: number): Promise<PriceBar[]>;
}

const pageSchema = z.object({
  bars: z
    .record(
      z.string(),
      z
        .array(
          z.object({
            t: z.iso.datetime({ offset: true }),
            o: z.number(),
            h: z.number(),
            l: z.number(),
            c: z.number(),
            v: z.number(),
          }),
        )
        .nullable(),
    )
    .nullish(),
  next_page_token: z.string().nullish(),
});

/** The free plan's refusal of the last 15 minutes of SIP data: the caller asks again later. */
export const tooRecent = (error: unknown): boolean =>
  error instanceof AlpacaError && error.status === 403 && /recent SIP data/i.test(error.detail);

/** The free plan's refusal of the newest option bars (premium-chart spec §3): ask again with the long delay. */
export const optionTooRecent = (error: unknown): boolean =>
  error instanceof AlpacaError && error.status === 403 && /OPRA agreement/i.test(error.detail);

/**
 * Alpaca refusing a symbol it doesn't know: `invalid symbol: SPX` for a stock, and `invalid symbol: "SPXW1" does not
 * match …` for an option, quoted, which the batch pattern INVALID_SYMBOL doesn't read.
 */
const REFUSED_SYMBOL = /invalid symbol: /i;

/** Every page of one symbol's bars at `url`, 10,000 a page. A symbol Alpaca refuses as invalid answers []. */
async function allPages(
  url: string,
  symbol: string,
  query: Record<string, string>,
  keys: AlpacaKeys,
  options: AlpacaOptions,
): Promise<PriceBar[]> {
  const bars: PriceBar[] = [];
  let token: string | null | undefined;
  do {
    const params = new URLSearchParams({
      symbols: symbol,
      ...query,
      limit: "10000",
      ...(token ? { page_token: token } : {}),
    });
    let page: z.infer<typeof pageSchema>;
    try {
      page = pageSchema.parse(await alpacaGet(`${url}?${params}`, keys, options));
    } catch (error) {
      if (error instanceof AlpacaError && error.status === 400 && REFUSED_SYMBOL.test(error.detail))
        return [];
      throw error;
    }
    for (const bar of page.bars?.[symbol] ?? []) {
      bars.push({ t: Date.parse(bar.t), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
    token = page.next_page_token;
  } while (token);
  return bars;
}

/** SIP bars from the free plan, raw so they match the strikes, 10,000 a page. */
export function alpacaHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): BarHistory {
  const stock = (symbol: string, query: Record<string, string>) =>
    allPages(STOCK_BARS, symbol, { ...query, feed: "sip", adjustment: "raw" }, keys, options);
  return {
    minuteBars: (symbol, start, end) =>
      stock(symbol, {
        timeframe: "1Min",
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
    dailyBars: (symbol, from, to) => stock(symbol, { timeframe: "1Day", start: from, end: to }),
  };
}

/** One contract's OPRA bars from the free plan (premium-chart spec §5.1). */
export function alpacaOptionHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): OptionBarHistory {
  return {
    minuteBars: (contract, start, end) =>
      allPages(
        OPTION_BARS,
        contract,
        { timeframe: "1Min", start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        keys,
        options,
      ),
  };
}
