import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nyMinuteOfDay, nyWallClock } from "./calendar.js";
import {
  aggregate,
  dailyFromMinutes,
  ema,
  nyClock,
  PREMARKET_OPEN,
  type PriceBar,
  sessionLevels,
  vwap,
} from "./chart.js";
import { nyDate } from "./marks.js";

const DAY = "2026-09-28";
/** A New York wall-clock time as epoch ms. */
const at = (date: string, hhmm: string) => {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return nyWallClock(date, hours * 60 + minutes);
};
const bar = (date: string, hhmm: string, o: number, h: number, l: number, c: number, v = 100): PriceBar => ({
  t: at(date, hhmm),
  o,
  h,
  l,
  c,
  v,
});

describe("nyClock", () => {
  it("reads New York's date and minute in summer and in winter time", () => {
    expect(nyClock(Date.UTC(2026, 8, 28, 13, 31))).toEqual({ date: "2026-09-28", minute: 9 * 60 + 31 });
    expect(nyClock(Date.UTC(2026, 11, 1, 14, 30))).toEqual({ date: "2026-12-01", minute: 9 * 60 + 30 });
  });

  it("crosses the November clock change, when 01:30 happens twice", () => {
    // 2026-11-01: daylight time until 02:00, then standard time.
    expect(nyClock(Date.UTC(2026, 10, 1, 5, 30))).toEqual({ date: "2026-11-01", minute: 90 });
    expect(nyClock(Date.UTC(2026, 10, 1, 6, 30))).toEqual({ date: "2026-11-01", minute: 90 });
    expect(nyClock(Date.UTC(2026, 10, 2, 14, 30))).toEqual({ date: "2026-11-02", minute: 570 });
  });

  it("agrees with the Intl formatter at any instant (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }), (t) => {
        expect(nyClock(t)).toEqual({ date: nyDate(t), minute: nyMinuteOfDay(t) });
      }),
    );
  });
});

describe("aggregate", () => {
  it("builds 3-minute candles on boundaries counted from 04:00, so 09:30 starts one", () => {
    const candles = aggregate(
      [
        bar(DAY, "09:29", 1, 1.1, 0.9, 1, 100),
        bar(DAY, "09:30", 1, 1.2, 0.95, 1.1, 200),
        bar(DAY, "09:31", 1.1, 1.3, 1.05, 1.25, 300),
        bar(DAY, "09:32", 1.25, 1.26, 1, 1.02, 400),
        bar(DAY, "09:33", 1.02, 1.1, 1, 1.05, 500),
      ],
      3,
    );
    expect(candles).toEqual([
      { t: at(DAY, "09:27"), o: 1, h: 1.1, l: 0.9, c: 1, v: 100, extended: true },
      { t: at(DAY, "09:30"), o: 1, h: 1.3, l: 0.95, c: 1.02, v: 900, extended: false },
      { t: at(DAY, "09:33"), o: 1.02, h: 1.1, l: 1, c: 1.05, v: 500, extended: false },
    ]);
  });

  it("never lets a candle span two days", () => {
    const candles = aggregate([bar(DAY, "19:59", 1, 1, 1, 1), bar("2026-09-29", "04:00", 2, 2, 2, 2)], 60);
    expect(candles.map((candle) => candle.t)).toEqual([at(DAY, "19:00"), at("2026-09-29", "04:00")]);
  });

  it("starts hourly candles at 04:00, 05:00 and so on, marking those that start before 09:30 as extended", () => {
    const [candle] = aggregate([bar(DAY, "09:45", 1, 1, 1, 1)], 60);
    expect(candle).toMatchObject({ t: at(DAY, "09:00"), extended: true });
  });

  it("keeps 1-minute bars as they are, marking the regular session", () => {
    const candles = aggregate([bar(DAY, "15:59", 1, 1, 1, 1), bar(DAY, "16:00", 1, 1, 1, 1)], 1);
    expect(candles.map((candle) => candle.extended)).toEqual([false, true]);
  });

  it("keeps every share and the day's extremes, whatever the timeframe (property)", () => {
    const dayOfBars = fc
      .uniqueArray(
        fc.record({
          minute: fc.integer({ min: PREMARKET_OPEN, max: 20 * 60 - 1 }),
          low: fc.integer({ min: 100, max: 10_000 }),
          spread: fc.integer({ min: 0, max: 500 }),
          v: fc.integer({ min: 0, max: 100_000 }),
        }),
        { selector: (raw) => raw.minute, minLength: 1, maxLength: 300 },
      )
      .map((raws) =>
        [...raws]
          .sort((a, b) => a.minute - b.minute)
          .map(({ minute, low, spread, v }) => ({
            t: nyWallClock(DAY, minute),
            o: low / 100,
            h: (low + spread) / 100,
            l: low / 100,
            c: (low + spread) / 100,
            v,
          })),
      );
    fc.assert(
      fc.property(dayOfBars, fc.constantFrom(1, 2, 3, 5, 10, 15, 30, 60), (bars, minutes) => {
        const candles = aggregate(bars, minutes);
        const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
        expect(sum(candles.map((candle) => candle.v))).toBe(sum(bars.map((each) => each.v)));
        expect(Math.max(...candles.map((candle) => candle.h))).toBe(Math.max(...bars.map((each) => each.h)));
        expect(Math.min(...candles.map((candle) => candle.l))).toBe(Math.min(...bars.map((each) => each.l)));
        expect(candles.every((candle, index) => index === 0 || candle.t > (candles[index - 1]?.t ?? 0))).toBe(
          true,
        );
      }),
    );
  });
});

describe("ema", () => {
  it("smooths with α = 2 ÷ (length + 1), seeded with the first value, as TradingView's ta.ema", () => {
    // By hand, length 2 (α = 2/3): 1, 1.6667, 2.5556, 3.5185, 4.5062, 5.5021. Drawn from index 3 × 2 − 1 = 5.
    const values = ema([1, 2, 3, 4, 5, 6], 2);
    expect(values.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(values[5]).toBeCloseTo(5.50206, 5);
  });

  it("has nothing to draw before three times its length", () => {
    const values = ema(
      Array.from({ length: 30 }, (_, index) => index),
      8,
    );
    expect(values.findIndex((value) => value !== null)).toBe(23);
  });

  it("follows the values exactly at length 1", () => {
    expect(ema([4, 5, 6], 1)).toEqual([null, null, 6]);
  });
});
describe("vwap", () => {
  const bars = [
    bar(DAY, "09:29", 9, 9, 9, 9, 1_000),
    bar(DAY, "09:30", 10, 11, 9, 10, 100), // typical price 10
    bar(DAY, "09:31", 12, 13, 11, 12, 300), // typical price 12
    bar("2026-09-29", "09:30", 20, 21, 19, 20, 50),
  ];

  it("weights the regular session's typical prices by volume, and ignores premarket", () => {
    expect(vwap(bars, aggregate(bars, 1))).toEqual([null, 10, 11.5, 20]);
  });

  it("gives each candle the VWAP as of its last regular-session minute, restarting each day", () => {
    // 3m: the 09:27 candle holds only 09:29 (premarket); the 09:30 candle holds 09:30 and 09:31.
    expect(vwap(bars, aggregate(bars, 3))).toEqual([null, 11.5, 20]);
  });
});

describe("half days", () => {
  const FRIDAY = "2026-11-27"; // the day after Thanksgiving: the session ends at 13:00
  const bars = [bar(FRIDAY, "12:59", 10, 11, 9, 10, 100), bar(FRIDAY, "13:00", 20, 21, 19, 20, 100)];

  it("tints candles from 13:00 as extended hours, and leaves them out of VWAP and the daily candle", () => {
    expect(aggregate(bars, 1).map((candle) => candle.extended)).toEqual([false, true]);
    expect(vwap(bars, aggregate(bars, 1))).toEqual([10, null]);
    expect(dailyFromMinutes(bars, FRIDAY)).toMatchObject({ o: 10, h: 11, l: 9, c: 10 });
  });
});

describe("sessionLevels", () => {
  it("reads the premarket high and low of the day, and the prior session's regular high and low", () => {
    const bars = [
      bar("2026-09-25", "09:30", 100, 104, 99, 101),
      bar("2026-09-25", "15:59", 101, 102, 98, 100),
      bar("2026-09-25", "16:30", 100, 110, 90, 100), // after hours: not part of the prior day's range
      bar(DAY, "04:00", 101, 103, 100.5, 102),
      bar(DAY, "09:29", 102, 102.5, 99.5, 101),
      bar(DAY, "09:30", 101, 105, 101, 104), // the day itself: not a level
    ];
    expect(sessionLevels(bars, DAY)).toEqual({ pmHigh: 103, pmLow: 99.5, pdHigh: 104, pdLow: 98 });
  });

  it("skips a holiday: the Tuesday after Labor Day takes Friday's range", () => {
    const bars = [bar("2026-09-04", "10:00", 50, 52, 49, 51), bar("2026-09-08", "08:00", 51, 51.5, 50.5, 51)];
    expect(sessionLevels(bars, "2026-09-08")).toMatchObject({ pdHigh: 52, pdLow: 49 });
  });

  it("takes a half day's range as it is", () => {
    const bars = [
      bar("2026-11-27", "09:30", 70, 71, 69, 70),
      bar("2026-11-27", "12:59", 70, 73, 70, 72),
      bar("2026-11-30", "09:00", 72, 72, 72, 72),
    ];
    expect(sessionLevels(bars, "2026-11-30")).toMatchObject({ pdHigh: 73, pdLow: 69 });
  });

  it("leaves a half day's after hours out of its range, from 13:00", () => {
    const bars = [
      bar("2026-11-27", "09:30", 70, 71, 69, 70),
      bar("2026-11-27", "12:59", 70, 73, 70, 72),
      bar("2026-11-27", "14:00", 72, 80, 60, 72), // after the 13:00 close: extended hours
      bar("2026-11-30", "09:00", 72, 72, 72, 72),
    ];
    expect(sessionLevels(bars, "2026-11-30")).toMatchObject({ pdHigh: 73, pdLow: 69 });
  });

  it("has no level without bars behind it", () => {
    expect(sessionLevels([bar(DAY, "09:30", 1, 1, 1, 1)], DAY)).toEqual({
      pmHigh: null,
      pmLow: null,
      pdHigh: null,
      pdLow: null,
    });
  });
});

describe("dailyFromMinutes", () => {
  it("builds a day's candle from its regular session, stamped at midnight as Alpaca stamps daily bars", () => {
    const bars = [
      bar(DAY, "08:00", 5, 9, 1, 5, 10),
      bar(DAY, "09:30", 10, 11, 9.5, 10.5, 100),
      bar(DAY, "15:59", 10.5, 12, 10, 11, 200),
      bar(DAY, "16:01", 11, 13, 8, 12, 50),
    ];
    expect(dailyFromMinutes(bars, DAY)).toEqual({ t: at(DAY, "00:00"), o: 10, h: 12, l: 9.5, c: 11, v: 300 });
    expect(dailyFromMinutes(bars, "2026-09-29")).toBeNull();
  });
});
