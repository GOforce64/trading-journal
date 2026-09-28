import { zValidator } from "@hono/zod-validator";
import type { Quote } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import type { MarketData } from "../marketData.js";

/** A plain ticker such as M or BRK.B. Anything else is dropped rather than sent on. */
export const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

const querySchema = z.object({ symbols: z.string() });

/** Reference prices only: they are shown, never stored (spec §8.6). */
export function quoteRoutes(market?: MarketData) {
  return new Hono().get("/", zValidator("query", querySchema), async (c) => {
    const requested = c.req.valid("query").symbols.split(",");
    const symbols = [...new Set(requested.map((symbol) => symbol.trim().toUpperCase()))].filter((symbol) =>
      TICKER.test(symbol),
    );
    // Asked on every request, so a key saved in Settings is used straight away.
    const quotes = market?.sources()?.quotes;
    const found = quotes ? await quotes.latest(symbols) : new Map<string, Quote>();
    return c.json({ quotes: Object.fromEntries(found) }, 200);
  });
}
