import { zValidator } from "@hono/zod-validator";
import type { OptionQuote } from "@tj/core";
import { CONTRACT, type ListedExpiration } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import type { MarketData } from "../marketData.js";
import { TICKER } from "./quotes.js";

// Date.parse rolls 2026-02-30 over to March 2, so the date must come back unchanged.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
  }, "not a date");

interface Unavailable {
  reason: "no_key" | "none_listed" | "unreachable";
  message: string;
}

const NO_KEY: Unavailable = {
  reason: "no_key",
  message: "Add an Alpaca key in Settings to pick from the chain.",
};
const UNREACHABLE: Unavailable = {
  reason: "unreachable",
  message: "Alpaca didn't answer, so type the expiry and strikes.",
};
const CLOSE_NO_KEY: Unavailable = {
  reason: "no_key",
  message: "Add an Alpaca key in Settings to settle from the close.",
};
const CLOSE_UNREACHABLE: Unavailable = {
  reason: "unreachable",
  message: "Alpaca didn't answer, so type the exits in Edit.",
};

/** Read-only market data for the builder and the marks (spec §7.2). Estimates are made in the browser, never here. */
export function marketRoutes(market?: MarketData) {
  return (
    new Hono()
      .get("/chains/:symbol", zValidator("query", z.object({ since: isoDate.optional() })), async (c) => {
        const symbol = c.req.param("symbol").toUpperCase();
        if (!TICKER.test(symbol)) return c.json({ error: "not a ticker" }, 400);
        const answer = (expirations: ListedExpiration[], unavailable: Unavailable | null) =>
          c.json({ symbol, expirations, unavailable }, 200);
        const sources = market?.sources();
        if (!sources) return answer([], NO_KEY);
        try {
          const expirations = await sources.chains.listed(symbol, c.req.valid("query").since);
          if (expirations.length > 0) return answer(expirations, null);
          return answer([], {
            reason: "none_listed",
            message: `No listed options for ${symbol} in that period.`,
          });
        } catch (error) {
          sources.report(error);
          return answer([], UNREACHABLE);
        }
      })
      .get("/option-quotes", zValidator("query", z.object({ contracts: z.string() })), async (c) => {
        const requested = c.req.valid("query").contracts.split(",");
        const contracts = [...new Set(requested.map((code) => code.trim().toUpperCase()))].filter((code) =>
          CONTRACT.test(code),
        );
        const sources = market?.sources();
        // The cached source reports its own failures and answers with what it has.
        const found =
          sources && contracts.length > 0
            ? await sources.optionQuotes.latest(contracts)
            : new Map<string, OptionQuote>();
        // `available` lets the page tell "no key" (show nothing) from "Alpaca has no quote" (say so).
        return c.json({ quotes: Object.fromEntries(found), available: sources != null }, 200);
      })
      .get("/company/:symbol", async (c) => {
        const symbol = c.req.param("symbol").toUpperCase();
        if (!TICKER.test(symbol)) return c.json({ error: "not a ticker" }, 400);
        const sources = market?.sources();
        let name: string | null = null;
        if (sources) {
          try {
            name = await sources.companies.name(symbol);
          } catch (error) {
            sources.report(error);
          }
        }
        return c.json({ name }, 200);
      })
      // The expiry-day close a settle proposal is priced from (spec §8.3). Null with no bar that day.
      .get("/close/:symbol", zValidator("query", z.object({ date: isoDate })), async (c) => {
        const symbol = c.req.param("symbol").toUpperCase();
        if (!TICKER.test(symbol)) return c.json({ error: "not a ticker" }, 400);
        const { date } = c.req.valid("query");
        const answer = (close: number | null, unavailable: Unavailable | null) =>
          c.json({ symbol, date, close, unavailable }, 200);
        const sources = market?.sources();
        if (!sources) return answer(null, CLOSE_NO_KEY);
        try {
          return answer(await sources.bars.closeOn(symbol, date), null);
        } catch (error) {
          sources.report(error);
          return answer(null, CLOSE_UNREACHABLE);
        }
      })
  );
}
