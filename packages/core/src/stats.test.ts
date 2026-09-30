import { describe, expect, it } from "vitest";
import { FIXTURE, makeTrade, ny } from "./stats.fixture.js";
import {
  closedTrades,
  dailyPnl,
  equityCurve,
  largestLosses,
  maxDrawdown,
  monthlyPnl,
  rollingExpectancy,
  summarize,
} from "./stats.js";

const closed = closedTrades(FIXTURE);

describe("closedTrades", () => {
  it("drops open trades and orders the rest by close, keeping trades that close together in their order", () => {
    const open = makeTrade({ id: "open", closedAt: null, netPnl: null });
    const ids = closedTrades([open, ...[...FIXTURE].reverse()]).map((trade) => trade.id);
    expect(ids).toEqual(["A", "B", "D", "C", "E", "F", "G", "H"]);
  });
});

describe("summarize", () => {
  it("works out the headline numbers", () => {
    expect(summarize(closed)).toEqual({
      trades: 8,
      wins: 4,
      losses: 3,
      scratches: 1,
      net: 200,
      grossWins: 750,
      grossLosses: -550,
      fees: 36,
      beforeFees: 236,
      winRate: 0.5,
      profitFactor: 750 / 550,
      expectancy: 25,
      avgWin: 187.5,
      avgLoss: -183.33,
      maxDrawdown: -300,
      avgR: null,
      rCount: 0,
    });
  });

  it("has no ratios without trades, and an infinite profit factor without losses", () => {
    expect(summarize([])).toMatchObject({
      trades: 0,
      net: 0,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      avgWin: null,
      avgLoss: null,
      maxDrawdown: 0,
    });
    const winners = closedTrades(FIXTURE.filter((trade) => (trade.netPnl ?? 0) > 0));
    expect(summarize(winners).profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it("averages R over the trades that have one, to 0.01", () => {
    const withR = closedTrades([
      makeTrade({ id: "a", risk: { r: 0.43 } }),
      makeTrade({ id: "b", risk: { r: -1.07 } }),
      makeTrade({ id: "c", risk: { r: null } }),
      makeTrade({ id: "d" }),
    ]);
    expect(summarize(withR)).toMatchObject({ avgR: -0.32, rCount: 2 });
    expect(summarize([])).toMatchObject({ avgR: null, rCount: 0 });
  });
});

describe("equityCurve", () => {
  it("runs cumulative net P&L from $0, with the drop from the running peak", () => {
    expect(equityCurve(closed).map((point) => [point.id, point.equity, point.drawdown])).toEqual([
      ["A", 100, 0],
      ["B", -200, -300],
      ["C", 0, -100],
      ["D", 0, -100],
      ["E", 50, -50],
      ["F", -100, -200],
      ["G", 300, 0],
      ["H", 200, -100],
    ]);
    expect(maxDrawdown(closed)).toBe(-300);
  });

  it("counts a first loss as drawdown from the $0 start", () => {
    expect(maxDrawdown(closedTrades([makeTrade({ netPnl: -50 })]))).toBe(-50);
  });
});

describe("dailyPnl and monthlyPnl", () => {
  it("adds up each New York close date", () => {
    const days = [...dailyPnl(closed)].map(([date, day]) => [
      date,
      day.net,
      day.trades.map((trade) => trade.id),
    ]);
    expect(days).toEqual([
      ["2026-09-03", 100, ["A"]],
      ["2026-09-04", -300, ["B"]],
      ["2026-09-08", 200, ["C", "D"]],
      ["2026-09-10", 50, ["E"]],
      ["2026-09-16", -150, ["F"]],
      ["2026-10-01", 400, ["G"]],
      ["2026-10-02", -100, ["H"]],
    ]);
  });

  it("puts a late-evening close on New York's date, not UTC's", () => {
    const late = makeTrade({ closedAt: ny("2026-09-30 23:30"), netPnl: 10 });
    expect([...dailyPnl(closedTrades([late])).keys()]).toEqual(["2026-09-30"]);
    expect(monthlyPnl(closedTrades([late]))).toEqual([{ month: "2026-09", net: 10, trades: 1 }]);
  });

  it("adds up each New York close month", () => {
    expect(monthlyPnl(closed)).toEqual([
      { month: "2026-09", net: -100, trades: 6 },
      { month: "2026-10", net: 300, trades: 2 },
    ]);
  });
});

describe("rollingExpectancy", () => {
  it("averages the last N trades at each trade from the Nth on", () => {
    const points = rollingExpectancy(closed, 3);
    expect(points.map((point) => point.value)).toEqual([0, -33.33, 83.33, -33.33, 100, 50]);
    expect(points[0]?.closedAt).toBe(ny("2026-09-08 09:45"));
  });

  it("is empty until there are enough trades", () => {
    expect(rollingExpectancy(closed)).toEqual([]);
  });
});

describe("largestLosses", () => {
  it("lists the worst losses first", () => {
    expect(largestLosses(closed).map((trade) => [trade.id, trade.netPnl])).toEqual([
      ["B", -300],
      ["F", -150],
      ["H", -100],
    ]);
  });
});
