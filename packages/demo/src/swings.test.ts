import { newTradeSchema, swingShape } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dailyWalk, tradingDays } from "./prices.js";
import { stream } from "./random.js";
import { planSwings } from "./swings.js";

const sessions = tradingDays("2026-04-01", "2026-09-30");
const walks = new Map(
  ["NVDA", "TSLA"].map(
    (symbol) => [symbol, dailyWalk(stream(1, symbol), symbol, sessions, new Map())] as const,
  ),
);

describe("planSwings (swing spec §8)", () => {
  const plans = planSwings(stream(1, "swings"), sessions, walks, ["NVDA", "TSLA"]);

  it("makes eight closed swings, each a swing shape the model accepts", () => {
    expect(plans).toHaveLength(8);
    for (const plan of plans) {
      expect(swingShape(plan.legs)).not.toBeNull();
      expect(plan.closedAt).toBeGreaterThan(plan.openedAt);
      expect(
        newTradeSchema.safeParse({
          strategy: "swing",
          book: plan.book,
          underlying: plan.symbol,
          openedAt: plan.openedAt,
          closedAt: plan.closedAt,
          netPnl: plan.netPnl,
          fees: plan.fees,
          legs: plan.legs,
        }).success,
      ).toBe(true);
    }
  });

  it("makes every shape twice, each P&L its legs' less its fees", () => {
    const shapes = plans.map((plan) => swingShape(plan.legs));
    for (const shape of ["long_call", "long_put", "call_debit_spread", "put_debit_spread"]) {
      expect(shapes.filter((each) => each === shape)).toHaveLength(2);
    }
    for (const plan of plans) {
      const gross = plan.legs.reduce(
        (sum, leg) => sum + leg.quantity * 100 * (leg.closePrice - leg.openPrice),
        0,
      );
      expect(plan.netPnl).toBeCloseTo(gross - plan.fees, 2);
    }
  });

  it("prices a spread's long leg at or above its short leg, at the open and at the close", () => {
    // Nearer the money is never cheaper: a debit to open, and a credit (or nothing) to close.
    const many = Array.from({ length: 40 }, (_, seed) =>
      planSwings(stream(seed, "swings"), sessions, walks, ["NVDA", "TSLA"]),
    ).flat();
    for (const plan of many.filter((each) => each.legs.length === 2)) {
      const [long, short] = plan.legs;
      expect(long?.openPrice).toBeGreaterThan(short?.openPrice ?? Number.POSITIVE_INFINITY);
      expect(long?.closePrice).toBeGreaterThanOrEqual(short?.closePrice ?? Number.POSITIVE_INFINITY);
    }
  });

  it("makes the same swings from the same seed", () => {
    expect(planSwings(stream(1, "swings"), sessions, walks, ["NVDA", "TSLA"])).toEqual(plans);
  });
});
