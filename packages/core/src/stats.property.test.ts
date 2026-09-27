import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { closedTrades, equityCurve, maxDrawdown, summarize } from "./stats.js";

describe("stats properties", () => {
  it("counts every trade as a win, a loss or a scratch", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const summary = summarize(closedTrades(trades));
        expect(summary.wins + summary.losses + summary.scratches).toBe(summary.trades);
      }),
    );
  });

  it("ends the equity curve at the total net", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const closed = closedTrades(trades);
        // toBeCloseTo, not toBe: round2 can return -0 where the other side is 0.
        expect(equityCurve(closed).at(-1)?.equity ?? 0).toBeCloseTo(summarize(closed).net, 6);
      }),
    );
  });

  it("keeps max drawdown at or below $0, and no deeper than all the losses together", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const closed = closedTrades(trades);
        const drawdown = maxDrawdown(closed);
        expect(drawdown).toBeLessThanOrEqual(0);
        expect(drawdown).toBeGreaterThanOrEqual(summarize(closed).grossLosses);
      }),
    );
  });
});
