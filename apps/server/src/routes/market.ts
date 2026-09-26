import { zValidator } from "@hono/zod-validator";
import type { OptionQuote } from "@tj/core";
import { CONTRACT, type ListedExpiration } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import type { MarketData } from "../marketData.js";
import { TICKER } from "./quotes.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => !Number.isNaN(Date.parse(date)), "not a date");

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

/** Read-only market data for the builder and the marks (spec §7.2). Estimates are made in the browser, never here. */
export function marketRoutes(market?: MarketData) {
  return new Hono()
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
        market?.report(error);
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
      return c.json({ quotes: Object.fromEntries(found) }, 200);
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
          market?.report(error);
        }
      }
      return c.json({ name }, 200);
    });
}
