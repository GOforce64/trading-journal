import { zValidator } from "@hono/zod-validator";
import {
  type IronFlyMetrics,
  type IronFlyOutcome,
  ironFlyMetrics,
  ironFlyOutcome,
  newTradeSchema,
  tradePatchSchema,
} from "@tj/core";
import { createTradesRepo, type Db, type TradeRecord } from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const listQuerySchema = z.object({
  strategy: z.enum(["scalp", "iron_fly"]).optional(),
  book: z.enum(["live", "paper", "missed"]).optional(),
  underlying: z.string().optional(),
  includeExcluded: z.enum(["true", "false"]).optional(),
});

export interface TradeView extends TradeRecord {
  metrics: (IronFlyMetrics & IronFlyOutcome) | null;
}

/** Metrics are derived on read, so a stored trade and its numbers can never drift apart. */
export function withMetrics(trade: TradeRecord): TradeView {
  const detail = trade.ironFly;
  if (
    !detail ||
    detail.bodyPutStrike == null ||
    detail.bodyCallStrike == null ||
    detail.putWingStrike == null ||
    detail.callWingStrike == null ||
    detail.contracts == null ||
    detail.creditPerShare == null
  ) {
    return { ...trade, metrics: null };
  }
  const metrics = ironFlyMetrics({
    bodyPutStrike: detail.bodyPutStrike,
    bodyCallStrike: detail.bodyCallStrike,
    putWingStrike: detail.putWingStrike,
    callWingStrike: detail.callWingStrike,
    contracts: detail.contracts,
    creditPerShare: detail.creditPerShare,
    fees: trade.fees,
  });
  return { ...trade, metrics: { ...metrics, ...ironFlyOutcome(metrics, trade.netPnl ?? 0) } };
}

export function tradeRoutes(db: Db, now?: () => number) {
  const repo = createTradesRepo(db, now);

  return new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) => {
      const query = c.req.valid("query");
      return c.json(
        repo
          .list({
            strategy: query.strategy,
            book: query.book,
            underlying: query.underlying,
            includeExcluded: query.includeExcluded === "true",
          })
          .map(withMetrics),
      );
    })
    .post("/", zValidator("json", newTradeSchema), (c) =>
      c.json(withMetrics(repo.create(c.req.valid("json"))), 201),
    )
    .get("/:id", (c) => {
      const trade = repo.get(c.req.param("id"));
      return trade ? c.json(withMetrics(trade)) : c.json({ error: "not found" }, 404);
    })
    .patch("/:id", zValidator("json", tradePatchSchema), (c) => {
      const updated = repo.update(c.req.param("id"), c.req.valid("json"));
      return updated ? c.json(withMetrics(updated)) : c.json({ error: "not found" }, 404);
    })
    .delete("/:id", (c) =>
      repo.softDelete(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404),
    );
}
