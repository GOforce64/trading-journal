import { addDays, isTradingDay, nyWallClock, type PriceBar, swingMetrics } from "@tj/core";
import { describe, expect, it } from "vitest";
import { type SwingChartTrade, swingChartModel, swingLines, swingMarks } from "./swing.js";

/** Daily bars, stamped at New York midnight, for every session from `from` to `to`. */
function dailyBars(from: string, to: string): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isTradingDay(date)) bars.push({ t: nyWallClock(date, 0), o: 230, h: 236, l: 228, c: 233, v: 1_000 });
  }
  return bars;
}
const at = (date: string, minute = 10 * 60) => nyWallClock(date, minute);
const fill = (date: string, strike: number, quantity: number, price: number, kind = "trade") => ({
  executedAt: at(date),
  right: "C",
  strike,
  quantity,
  price,
  kind,
  canceled: false,
});
const legs = [
  {
    right: "C",
    strike: 230,
    expiry: "2026-11-06",
    quantity: 1,
    multiplier: 100,
    openPrice: 5.1,
    closePrice: 9,
  },
  {
    right: "C",
    strike: 240,
    expiry: "2026-11-06",
    quantity: -1,
    multiplier: 100,
    openPrice: 1.3,
    closePrice: 1.15,
  },
];
const spread: SwingChartTrade = {
  openedAt: at("2026-10-02"),
  closedAt: at("2026-10-09"),
  legs,
  fills: [
    fill("2026-10-02", 230, 1, 5.1),
    fill("2026-10-02", 240, -1, 1.3),
    fill("2026-10-09", 230, -1, 9),
    fill("2026-10-09", 240, 1, 1.15),
  ],
};
const texts = (trade: SwingChartTrade, period: "daily" | "weekly" = "daily") =>
  swingMarks(trade, period).map((mark) => [mark.key, mark.marker.text, mark.marker.side]);

describe("swingMarks (swing spec §4.3)", () => {
  it("makes one marker a day for opening and for closing, at the net price per spread", () => {
    expect(texts(spread)).toEqual([
      ["2026-10-02", "B 1 @ 3.80", "buy"],
      ["2026-10-09", "S 1 @ 7.85", "sell"],
    ]);
  });

  it("reads a legged-in short as the sale it was", () => {
    const legged = { ...spread, fills: [fill("2026-10-02", 230, 1, 5.1), fill("2026-10-05", 240, -1, 1.3)] };
    expect(texts(legged)).toEqual([
      ["2026-10-02", "B 1 @ 5.10", "buy"],
      ["2026-10-05", "S 1 @ 1.30", "sell"],
    ]);
  });

  it("sizes a partial close by its contracts", () => {
    const two = {
      ...spread,
      fills: [
        fill("2026-10-02", 230, 2, 5.1),
        fill("2026-10-02", 240, -2, 1.3),
        fill("2026-10-07", 230, -1, 8),
        fill("2026-10-07", 240, 1, 1.2),
      ],
    };
    expect(texts(two)).toEqual([
      ["2026-10-02", "B 2 @ 3.80", "buy"],
      ["2026-10-07", "S 1 @ 6.80", "sell"],
    ]);
  });

  it("marks an expiry on its day", () => {
    const expired = {
      ...spread,
      fills: [
        fill("2026-10-02", 230, 1, 5.1),
        fill("2026-10-02", 240, -1, 1.3),
        { ...fill("2026-11-06", 230, -1, 0, "expiration"), executedAt: at("2026-11-06", 16 * 60 + 20) },
        { ...fill("2026-11-06", 240, 1, 0, "expiration"), executedAt: at("2026-11-06", 16 * 60 + 20) },
      ],
    };
    expect(texts(expired).at(-1)).toEqual(["2026-11-06", "expired", "expired"]);
  });

  it("uses the legs of a trade typed in by hand", () => {
    expect(texts({ ...spread, fills: [] })).toEqual([
      ["2026-10-02", "B 1 @ 3.80", "buy"],
      ["2026-10-09", "S 1 @ 7.85", "sell"],
    ]);
  });

  it("merges a week's fills under its Monday", () => {
    expect(texts(spread, "weekly")).toEqual([
      ["2026-09-28", "B 1 @ 3.80", "buy"],
      ["2026-10-05", "S 1 @ 7.85", "sell"],
    ]);
  });
});

describe("swingChartModel", () => {
  const daily = dailyBars("2026-06-01", "2026-10-12");

  it("puts the markers on their days' candles and opens on the trade", () => {
    const model = swingChartModel(daily, [], spread, [8], "2026-10-09", "daily");
    expect(model.markers.map((marker) => marker.t)).toEqual([
      nyWallClock("2026-10-02", 0),
      nyWallClock("2026-10-09", 0),
    ]);
    const first = model.candles.findIndex((candle) => candle.t === nyWallClock("2026-10-02", 0));
    expect(model.window?.from).toBe(first - 20);
  });

  it("draws weeks, with the markers on their weeks' first sessions", () => {
    const model = swingChartModel(daily, [], spread, [8, 167], "2026-10-09", "weekly");
    expect(model.markers.map((marker) => marker.t)).toEqual([
      nyWallClock("2026-09-28", 0),
      nyWallClock("2026-10-05", 0),
    ]);
    expect(model.emas[1]?.points).toEqual([]);
  });
});

describe("swingLines", () => {
  it("draws both strikes and the break-even", () => {
    const metrics = swingMetrics(
      { legs, netPnl: 402.1, openedAt: spread.openedAt, closedAt: spread.closedAt },
      "2026-10-13",
    );
    expect(swingLines(metrics, legs).map((line) => [line.price, line.label])).toEqual([
      [230, "230"],
      [240, "240"],
      [233.8, "BE 233.80"],
    ]);
  });
});
