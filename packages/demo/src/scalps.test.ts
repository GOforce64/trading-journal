import { nyWallClock, REGULAR_OPEN, regularClose } from "@tj/core";
import { describe, expect, it } from "vitest";
import { minuteBars, tradingDays } from "./prices.js";
import { mulberry32, stream } from "./random.js";
import { expiryFor, planScalps, type ScalpPlan } from "./scalps.js";

const DAY = "2026-11-24";
const stockOn = (date: string, seed: number) => minuteBars(mulberry32(seed), date, 180, 181.5, 0.45, 300_000);

describe("expiryFor", () => {
  it("trades SPY and QQQ same-day, and the rest that week's Friday, or Thursday before a Friday holiday", () => {
    expect(expiryFor("SPY", "2026-11-23")).toBe("2026-11-23");
    expect(expiryFor("NVDA", "2026-11-23")).toBe("2026-11-27");
    expect(expiryFor("NVDA", "2026-04-01")).toBe("2026-04-02");
  });
});

describe("planScalps", () => {
  it("plans the same scalps for the same seed", () => {
    const stock = stockOn(DAY, 1);
    expect(planScalps(mulberry32(9), DAY, "NVDA", stock, true)).toEqual(
      planScalps(mulberry32(9), DAY, "NVDA", stock, true),
    );
  });

  it("enters and exits inside the session, with P&L from the legs less fees, and trims within the position", () => {
    const plans: { plan: ScalpPlan; date: string; stock: ReturnType<typeof stockOn> }[] = [];
    for (const [index, date] of tradingDays("2026-10-01", "2026-12-31").entries()) {
      const stock = stockOn(date, index);
      for (const plan of planScalps(stream(42, date), date, "NVDA", stock, true)) {
        plans.push({ plan, date, stock });
      }
    }
    expect(plans.length).toBeGreaterThan(40);
    for (const { plan, date, stock } of plans) {
      expect(plan.openedAt).toBeGreaterThanOrEqual(nyWallClock(date, REGULAR_OPEN));
      expect(plan.closedAt).toBeGreaterThan(plan.openedAt);
      expect(plan.closedAt).toBeLessThan(nyWallClock(date, regularClose(date)));
      const fees = Math.round(plan.contracts * 2 * 0.67 * 100) / 100;
      expect(plan.fees).toBeCloseTo(fees, 2);
      expect(plan.netPnl).toBeCloseTo((plan.closePrice - plan.openPrice) * plan.contracts * 100 - fees, 2);
      expect(plan.targets.reduce((sum, target) => sum + target.contracts, 0)).toBeLessThanOrEqual(
        plan.contracts,
      );
      expect(plan.contracts).toBeGreaterThanOrEqual(1);
      expect(plan.contracts).toBeLessThanOrEqual(5);
      expect(plan.optionBars.length).toBeGreaterThan(0);
      if (plan.exit === "stop" && plan.stop.basis === "premium") {
        expect(plan.closePrice).toBeLessThanOrEqual(plan.stop.price);
      }
      if (plan.exit === "stop" && plan.stop.basis === "stock") {
        const minute = plan.closedAt - (plan.closedAt % 60_000);
        const bar = stock.find((each) => each.t === minute);
        if (!bar) throw new Error("no stock bar at the exit");
        if (plan.right === "C") expect(bar.l).toBeLessThanOrEqual(plan.stop.price);
        else expect(bar.h).toBeGreaterThanOrEqual(plan.stop.price);
      }
    }
  });

  it("wins about half the time, with real losers", () => {
    let wins = 0;
    let count = 0;
    const days = tradingDays("2025-01-02", "2025-12-31").slice(0, 200);
    for (const [index, date] of days.entries()) {
      const stock = minuteBars(
        mulberry32(index + 100),
        date,
        180,
        180 * (1 + (index % 7) / 1000),
        0.45,
        300_000,
      );
      for (const plan of planScalps(stream(7, date), date, "NVDA", stock, true)) {
        count++;
        if (plan.netPnl > 0) wins++;
      }
    }
    expect(count).toBeGreaterThan(150);
    expect(wins / count).toBeGreaterThan(0.45);
    expect(wins / count).toBeLessThan(0.65);
  });

  it("leaves a scalp still to review without its grade or its setup", () => {
    const plans = tradingDays("2026-10-01", "2026-10-30").flatMap((date, index) =>
      planScalps(stream(3, date), date, "TSLA", stockOn(date, index), false),
    );
    expect(plans.length).toBeGreaterThan(5);
    for (const plan of plans) expect(plan.grade === null || plan.setup === null).toBe(true);
  });
});
