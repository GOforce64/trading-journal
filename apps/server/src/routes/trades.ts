import { zValidator } from "@hono/zod-validator";
import {
  type IronFlyMetrics,
  type IronFlyOutcome,
  ironFlyMetrics,
  ironFlyOutcome,
  newTradeSchema,
  type ReviewStatus,
  reviewStatus,
  type ScalpRisk,
  scalpRisk,
  tradePatchSchema,
} from "@tj/core";
import {
  createIbkrRepo,
  createTradesRepo,
  type Db,
  type FillRow,
  ReviewRuleError,
  type TradeRecord,
} from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const listQuerySchema = z.object({
  strategy: z.enum(["scalp", "iron_fly"]).optional(),
  book: z.enum(["live", "paper", "missed"]).optional(),
  underlying: z.string().optional(),
  includeExcluded: z.enum(["true", "false"]).optional(),
  /** Every trade rather than the newest 500, for pages that aggregate. */
  all: z.enum(["true"]).optional(),
  /** The To review queue (scalp-review spec §6.2): pending trades only, oldest first, with no row limit. */
  review: z.enum(["pending"]).optional(),
});

export interface TradeView extends TradeRecord {
  metrics: (IronFlyMetrics & IronFlyOutcome) | null;
  /** Whether the trade waits in the To review queue (scalp-review spec §6.1); null where the queue doesn't apply. */
  review: ReviewStatus | null;
  /** A scalp's R (scalp-R spec §6), worked out on read; null for a fly. */
  risk: ScalpRisk | null;
}

/** Metrics, the review status and R are derived on read, so a stored trade and its numbers can never drift apart. */
export function withMetrics(trade: TradeRecord): TradeView {
  return { ...trade, metrics: flyMetrics(trade), review: reviewStatus(trade), risk: scalpRisk(trade) };
}

function flyMetrics(trade: TradeRecord): TradeView["metrics"] {
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
    return null;
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
  // An open trade has no P&L yet, so its return stays empty rather than reading 0%.
  const outcome: IronFlyOutcome =
    trade.netPnl == null
      ? { returnOnRisk: null, pctOfMaxProfit: null, pnlPctOfCost: null }
      : ironFlyOutcome(metrics, trade.netPnl);
  return { ...metrics, ...outcome };
}

/** What the trade page's Fills panel shows of a fill. */
const fillView = (fill: FillRow) => ({
  id: fill.id,
  executedAt: fill.executedAt,
  quantity: fill.quantity,
  price: fill.price,
  commission: fill.commission,
  kind: fill.kind,
  canceled: fill.canceled,
  openClose: fill.openClose,
  right: fill.right,
  strike: fill.strike,
  expiry: fill.expiry,
});

export function tradeRoutes(db: Db, now?: () => number) {
  const repo = createTradesRepo(db, now);
  const ibkr = createIbkrRepo(db, now);

  return new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) => {
      const query = c.req.valid("query");
      const filter = { strategy: query.strategy, book: query.book, underlying: query.underlying };
      if (query.review === "pending") {
        // Every pending trade, oldest first: the queue must never stop at the newest 500.
        return c.json(
          repo
            .list({ ...filter, limit: null })
            .map(withMetrics)
            .filter((trade) => trade.review?.status === "pending")
            .reverse(),
        );
      }
      return c.json(
        repo
          .list({
            ...filter,
            includeExcluded: query.includeExcluded === "true",
            limit: query.all === "true" ? null : undefined,
          })
          .map(withMetrics),
      );
    })
    .post("/", zValidator("json", newTradeSchema), (c) =>
      c.json(withMetrics(repo.create(c.req.valid("json"))), 201),
    )
    .get("/:id", (c) => {
      const trade = repo.get(c.req.param("id"));
      return trade
        ? c.json({ ...withMetrics(trade), fills: ibkr.fillsForTrade(trade.id).map(fillView) })
        : c.json({ error: "not found" }, 404);
    })
    .patch("/:id", zValidator("json", tradePatchSchema), (c) => {
      try {
        const updated = repo.update(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(withMetrics(updated)) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof ReviewRuleError)
          return c.json({ error: "invalid", message: error.message }, 400);
        throw error;
      }
    })
    .delete("/:id", (c) =>
      repo.softDelete(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404),
    );
}
