import { zValidator } from "@hono/zod-validator";
import { addDays, MAX_BAR_DAYS } from "@tj/core";
import { Hono } from "hono";
import { z } from "zod";
import { type BarService, BarsUnreachable } from "../bars.js";
import { isoDate } from "./market.js";
import { TICKER } from "./quotes.js";

const UNREACHABLE = { error: "unreachable", message: "Alpaca didn't answer. Try again." };

/** The chart's bars (trade-chart spec §6). */
export function barRoutes(service: BarService) {
  return new Hono()
    .get("/:symbol", zValidator("query", z.object({ from: isoDate, to: isoDate })), async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      const { from, to } = c.req.valid("query");
      if (!TICKER.test(symbol) || from > to || addDays(from, MAX_BAR_DAYS) < to) {
        return c.json({ error: "bad request" }, 400);
      }
      try {
        const answer = await service.minute(symbol, from, to);
        return c.json(
          { symbol, bars: answer.bars, partial: answer.partial, unavailable: answer.unavailable },
          200,
        );
      } catch (error) {
        if (error instanceof BarsUnreachable) return c.json(UNREACHABLE, 502);
        throw error;
      }
    })
    .get("/:symbol/daily", zValidator("query", z.object({ to: isoDate })), async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      if (!TICKER.test(symbol)) return c.json({ error: "bad request" }, 400);
      try {
        const answer = await service.daily(symbol, c.req.valid("query").to);
        return c.json(
          { symbol, bars: answer.bars, partial: answer.partial, unavailable: answer.unavailable },
          200,
        );
      } catch (error) {
        if (error instanceof BarsUnreachable) return c.json(UNREACHABLE, 502);
        throw error;
      }
    });
}
