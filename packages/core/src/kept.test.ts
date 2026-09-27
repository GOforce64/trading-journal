import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flyMaxProfit, pctKept } from "./ironFly.js";
import { keptHistogram, keptStats } from "./kept.js";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { FIXTURE, makeTrade } from "./stats.fixture.js";
import { closedTrades } from "./stats.js";

const flies = closedTrades(FIXTURE).filter((trade) => trade.strategy === "iron_fly");

describe("keptStats", () => {
  it("measures winners and losers against max profit", () => {
    const stats = keptStats(flies);
    expect(stats).toMatchObject({ counted: 7, skipped: 0, avgCredit: 561.71, avgMaxProfit: 557.14 });
    expect(stats.winnersKeep?.mean).toBeCloseTo(0.3875, 10);
    expect(stats.winnersKeep?.median).toBe(0.5);
    expect(stats.losersLose?.mean).toBeCloseTo(0.625, 10);
    expect(stats.losersLose?.median).toBeCloseTo(0.625, 10);
    expect(stats.keptOverall).toBeCloseTo(300 / 3900, 10);
  });

  it("leaves out a fly whose fees ate the credit, and counts it", () => {
    const eaten = makeTrade({ id: "X", netPnl: -5, fees: 300 });
    expect(keptStats([...flies, ...closedTrades([eaten])])).toMatchObject({ counted: 7, skipped: 1 });
  });

  it("has nothing to say without flies", () => {
    expect(keptStats([])).toEqual({
      counted: 0,
      skipped: 0,
      avgCredit: null,
      avgMaxProfit: null,
      winnersKeep: null,
      losersLose: null,
      keptOverall: null,
    });
  });
});

describe("keptHistogram", () => {
  it("bins % kept in 25-point steps from −150%", () => {
    const bins = keptHistogram(flies);
    expect(bins.map((bin) => bin.label)).toEqual([
      "< −150%",
      "−150% to −125%",
      "−125% to −100%",
      "−100% to −75%",
      "−75% to −50%",
      "−50% to −25%",
      "−25% to 0%",
      "0% to 25%",
      "25% to 50%",
      "50% to 75%",
      "75% to 100%",
    ]);
    expect(bins.filter((bin) => bin.tradeIds.length > 0).map((bin) => [bin.label, bin.tradeIds])).toEqual([
      ["−100% to −75%", ["B"]],
      ["−25% to 0%", ["F"]],
      ["0% to 25%", ["D", "E"]],
      ["50% to 75%", ["A", "C", "G"]],
    ]);
  });

  it("puts a loss past −150% in the first bin and a full keep in the last", () => {
    // Max profit 200: −334 keeps −167%, +200 keeps 100%.
    const deep = makeTrade({ id: "deep", netPnl: -334 });
    const full = makeTrade({ id: "full", netPnl: 200 });
    const bins = keptHistogram(closedTrades([deep, full]));
    expect(bins[0]?.tradeIds).toEqual(["deep"]);
    expect(bins.at(-1)?.tradeIds).toEqual(["full"]);
  });
});

describe("kept properties", () => {
  it("has no % kept exactly when there is no max profit", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        for (const trade of closedTrades(trades)) {
          const fly = trade.ironFly;
          if (!fly || fly.creditPerShare == null || fly.contracts == null) continue;
          const maxProfit = flyMaxProfit(fly.creditPerShare, fly.contracts, trade.fees);
          expect(pctKept(trade) === null).toBe(maxProfit <= 0);
        }
      }),
    );
  });
});
