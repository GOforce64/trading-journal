import { nyWallClock, type PriceBar } from "@tj/core";
import { describe, expect, it } from "vitest";
import { type ChartTrade, dailyModel, intradayModel, priceText, tradeMarks } from "./model.js";

/** One-minute bars on `date` from minute `from` to `to` (exclusive), rising a cent a minute. */
const minutesOf = (date: string, from: number, to: number, price: number): PriceBar[] =>
  Array.from({ length: to - from }, (_, index) => {
    const c = price + index * 0.01;
    return { t: nyWallClock(date, from + index), o: c, h: c + 0.05, l: c - 0.05, c, v: 1_000 };
  });
const DAY = "2026-09-28";
const SEP_28 = minutesOf(DAY, 240, 1200, 229); // 04:00–20:00

/** This morning's NVDA 232.5C scalp, as synced from IBKR. */
const fill = (
  at: number,
  quantity: number,
  price: number,
  extra: Partial<ChartTrade["fills"][number]> = {},
) => ({
  executedAt: at,
  quantity,
  price,
  kind: "trade",
  canceled: false,
  ...extra,
});
const NVDA: ChartTrade = {
  openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
  closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
  fills: [
    fill(Date.UTC(2026, 8, 28, 13, 31, 5), 1, 1.06),
    fill(Date.UTC(2026, 8, 28, 13, 31, 5), 1, 1.06),
    fill(Date.UTC(2026, 8, 28, 13, 31, 49), -1, 1.44),
    fill(Date.UTC(2026, 8, 28, 13, 46, 12), -1, 1.15),
  ],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};

describe("priceText", () => {
  it("shows two decimals, or more when the price has them", () => {
    expect([priceText(1.06), priceText(1.295), priceText(4.2)]).toEqual(["1.06", "1.295", "4.20"]);
  });
});

describe("tradeMarks", () => {
  it("marks each fill with its side, size and price", () => {
    expect(tradeMarks(NVDA).map((mark) => [mark.side, mark.text])).toEqual([
      ["buy", "B 1 @ 1.06"],
      ["buy", "B 1 @ 1.06"],
      ["sell", "S 1 @ 1.44"],
      ["sell", "S 1 @ 1.15"],
    ]);
  });

  it("leaves canceled fills out and labels expiries", () => {
    const marks = tradeMarks({
      ...NVDA,
      fills: [fill(1, 1, 1, { canceled: true }), fill(2, -1, 0, { kind: "expiration" })],
    });
    expect(marks).toEqual([{ t: 2, side: "expired", text: "expired" }]);
  });

  it("marks a trade typed in by hand at its open and close", () => {
    expect(tradeMarks({ ...NVDA, fills: [] }).map((mark) => mark.text)).toEqual([
      "B 2 @ 1.06",
      "S 2 @ 1.295",
    ]);
    const fly = tradeMarks({
      ...NVDA,
      fills: [],
      legs: [
        { quantity: -2, openPrice: 1.37, closePrice: 0.325 },
        { quantity: 2, openPrice: 0.13, closePrice: 0 },
      ],
    });
    expect(fly.map((mark) => mark.text)).toEqual(["Open", "Close"]);
  });
});

describe("intradayModel", () => {
  const model = intradayModel(SEP_28, NVDA, 3, [8, 20, 50, 167]);

  it("puts each fill on the 3-minute candle it happened in", () => {
    expect(model.markers.map((marker) => [marker.t, marker.text])).toEqual([
      [nyWallClock(DAY, 570), "B 1 @ 1.06"],
      [nyWallClock(DAY, 570), "B 1 @ 1.06"],
      [nyWallClock(DAY, 570), "S 1 @ 1.44"],
      [nyWallClock(DAY, 585), "S 1 @ 1.15"],
    ]);
  });

  it("opens 20 candles before the first fill to 20 after the last", () => {
    // 3m candles from 04:00: 09:30 is candle 110 and 09:45 is candle 115.
    expect(model.candles).toHaveLength(320);
    expect(model.window).toEqual({ from: 90, to: 135 });
  });

  it("keeps a fill outside the bars off the chart, or on the last candle, and keeps the window valid", () => {
    const early = intradayModel(SEP_28, { ...NVDA, fills: [fill(nyWallClock(DAY, 238), 1, 1)] }, 3, [8]);
    expect(early.markers).toEqual([]);
    expect(early.window).toEqual({ from: 0, to: 20 });
    const late = intradayModel(
      SEP_28,
      { ...NVDA, fills: [fill(nyWallClock("2026-09-29", 5), -1, 1)] },
      3,
      [8],
    );
    expect(late.markers.map((marker) => marker.t)).toEqual([nyWallClock(DAY, 1197)]);
    expect(late.window).toEqual({ from: 299, to: 339 });
  });

  it("draws an EMA only where it has enough history", () => {
    // 320 candles: EMA 8 starts at candle 23; EMA 167 needs 501 and has none.
    expect(model.emas.map((line) => line.length)).toEqual([8, 20, 50, 167]);
    expect(model.emas[0]?.points[0]?.t).toBe(model.candles[23]?.t);
    expect(model.emas[3]?.points).toEqual([]);
  });

  it("draws the premarket and prior-day levels across the trade's first day only", () => {
    const withPriorDay = [...minutesOf("2026-09-25", 570, 960, 200), ...SEP_28];
    const levels = intradayModel(withPriorDay, NVDA, 3, [8]);
    expect(levels.levels.map((level) => level.label)).toEqual(["PM H", "PM L", "PD H", "PD L"]);
    expect(levels.levels[0]?.price).toBeCloseTo(232.34, 6); // 229 + 329 minutes × 0.01 + 0.05
    expect(levels.levels[1]?.price).toBeCloseTo(228.95, 6);
    expect(levels.levels[2]?.price).toBeCloseTo(203.94, 6); // 200 + 389 × 0.01 + 0.05
    expect(levels.levels[3]?.price).toBeCloseTo(199.95, 6);
    expect(levels.levelTimes[0]).toBe(nyWallClock(DAY, 240));
    expect(levels.levelTimes).toHaveLength(320);
  });

  it("has no VWAP before 09:30", () => {
    expect(model.vwap[0]?.t).toBe(nyWallClock(DAY, 570));
  });
});

describe("dailyModel", () => {
  it("adds today's candle from its minute bars, since Alpaca's daily bar comes only once the day is over", () => {
    const daily = [
      { t: nyWallClock("2026-09-24", 0), o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: nyWallClock("2026-09-25", 0), o: 2, h: 2, l: 2, c: 2, v: 2 },
    ];
    const today = {
      ...NVDA,
      openedAt: nyWallClock("2026-09-29", 571),
      closedAt: nyWallClock("2026-09-29", 590),
    };
    const model = dailyModel(daily, minutesOf("2026-09-29", 570, 960, 230), today, [8], "2026-09-29");
    expect(model.candles.map((candle) => candle.t)).toEqual([
      nyWallClock("2026-09-24", 0),
      nyWallClock("2026-09-25", 0),
      nyWallClock("2026-09-29", 0),
    ]);
    expect(model.candles[2]).toMatchObject({ o: 230, c: 233.89 });
    expect(model.markers).toEqual([{ t: nyWallClock("2026-09-29", 0), side: "held", text: "" }]);
    expect(model.window).toEqual({ from: 0, to: 2 });
  });

  it("shows about six months, ending on the trade's last day", () => {
    const daily = Array.from({ length: 300 }, (_, index) => ({
      t: index * 86_400_000,
      o: 1,
      h: 1,
      l: 1,
      c: 1,
      v: 1,
    }));
    expect(dailyModel(daily, [], NVDA, [8], DAY).window).toEqual({ from: 174, to: 299 });
  });
});
