import type { PriceBar } from "@tj/core";
import { z } from "zod";
import { INVALID_SYMBOL } from "./alpaca.js";
import { STOCK_BARS } from "./bars.js";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet } from "./http.js";

/** The chart's history (trade-chart spec §6): whole days of bars, where move data needs single prices. */
export interface BarHistory {
  /** 1-minute bars from `start` to `end` (epoch ms), extended hours included, oldest first. [] for an unknown symbol. */
  minuteBars(symbol: string, start: number, end: number): Promise<PriceBar[]>;
  /** Daily bars for the New York dates `from` to `to`, inclusive. */
  dailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
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

/** SIP bars from the free plan, raw so they match the strikes, 10,000 a page. */
export function alpacaHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): BarHistory {
  async function all(symbol: string, query: Record<string, string>): Promise<PriceBar[]> {
    const bars: PriceBar[] = [];
    let token: string | null | undefined;
    do {
      const params = new URLSearchParams({
        symbols: symbol,
        ...query,
        feed: "sip",
        adjustment: "raw",
        limit: "10000",
        ...(token ? { page_token: token } : {}),
      });
      let page: z.infer<typeof pageSchema>;
      try {
        page = pageSchema.parse(await alpacaGet(`${STOCK_BARS}?${params}`, keys, options));
      } catch (error) {
        if (error instanceof AlpacaError && error.status === 400 && INVALID_SYMBOL.test(error.detail))
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

  return {
    minuteBars: (symbol, start, end) =>
      all(symbol, {
        timeframe: "1Min",
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
    dailyBars: (symbol, from, to) => all(symbol, { timeframe: "1Day", start: from, end: to }),
  };
}
