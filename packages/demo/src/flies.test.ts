import { addDays, nyWallClock, type PriceBar } from "@tj/core";
import { describe, expect, it } from "vitest";
import { earningsSchedule, type FlyPlan, planFly } from "./flies.js";
import { minuteBars, tradingDays } from "./prices.js";
import { mulberry32, stream } from "./random.js";

const SESSIONS = tradingDays("2025-01-02", "2026-12-31");
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** A fly on `event`, with the stock flat into the report and opening at its gap the next session. */
function flyFor(seed: number): { plan: FlyPlan; before: number; reactionOpen: number } {
  const [event] = earningsSchedule(stream(seed, "events"), "NFLX", SESSIONS);
  if (!event) throw new Error("no event");
  const before = 1_000;
  const reactionOpen = Math.round(before * (1 + event.gap) * 100) / 100;
  const entry: PriceBar[] = minuteBars(mulberry32(seed), event.entryDate, 998, before, 0.35, 8_000);
  const exit: PriceBar[] = minuteBars(
    mulberry32(seed + 1),
    event.exitDate,
    reactionOpen,
    reactionOpen,
    0.35,
    8_000,
  );
  return { plan: planFly(stream(seed, "fly"), event, entry, exit), before, reactionOpen };
}

describe("earningsSchedule", () => {
  it("reports about every 13 weeks, inside the sessions, entering before the report and leaving after", () => {
    const events = earningsSchedule(mulberry32(1), "NFLX", SESSIONS);
    expect(events.length).toBeGreaterThanOrEqual(6);
    for (const [index, event] of events.entries()) {
      expect(SESSIONS).toContain(event.entryDate);
      expect(SESSIONS).toContain(event.exitDate);
      expect(event.exitDate).toBe(event.reactionDate);
      if (event.timing === "AMC") {
        expect(event.entryDate).toBe(event.date);
        expect(SESSIONS[SESSIONS.indexOf(event.date) + 1]).toBe(event.exitDate);
      } else {
        expect(event.exitDate).toBe(event.date);
        expect(SESSIONS[SESSIONS.indexOf(event.date) - 1]).toBe(event.entryDate);
      }
      const previous = events[index - 1];
      if (previous) {
        expect(daysBetween(previous.date, event.date)).toBeGreaterThanOrEqual(13 * 7 - 10);
        expect(daysBetween(previous.date, event.date)).toBeLessThanOrEqual(13 * 7 + 10);
      }
      expect(event.impliedMove).toBeGreaterThan(0.02);
      expect(event.impliedMove).toBeLessThan(0.2);
    }
  });
});

describe("planFly", () => {
  it("sells the body at the money with wings around it, for a credit, with P&L from the legs less fees", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { plan, before, reactionOpen } = flyFor(seed);
      expect(plan.creditPerShare).toBeGreaterThan(0);
      expect(plan.putWing).toBeLessThan(plan.bodyStrike);
      expect(plan.callWing).toBeGreaterThan(plan.bodyStrike);
      expect(plan.legs.map((leg) => leg.quantity)).toEqual([
        plan.contracts,
        -plan.contracts,
        -plan.contracts,
        plan.contracts,
      ]);
      const legs = plan.legs.reduce(
        (sum, leg) => sum + (leg.closePrice - leg.openPrice) * leg.quantity * 100,
        0,
      );
      const fees = Math.round(4 * plan.contracts * 2 * 0.67 * 100) / 100;
      expect(plan.fees).toBeCloseTo(fees, 2);
      expect(plan.netPnl).toBeCloseTo(legs - fees, 2);
      expect(plan.actualMovePct).toBeCloseTo((reactionOpen / before - 1) * 100, 1);
      expect(plan.openedAt).toBeGreaterThanOrEqual(nyWallClock(plan.entryDate, 15 * 60 + 40));
      expect(plan.closedAt).toBeLessThanOrEqual(nyWallClock(plan.exitDate, 10 * 60 + 31));
      expect(
        plan.legs.every((leg) => leg.expiry >= plan.exitDate && leg.expiry <= addDays(plan.exitDate, 7)),
      ).toBe(true);
    }
  });

  it("wins more often than not, but not always", () => {
    let wins = 0;
    for (let seed = 1; seed <= 100; seed++) if (flyFor(seed).plan.netPnl > 0) wins++;
    expect(wins).toBeGreaterThan(50);
    expect(wins).toBeLessThan(95);
  });
});
