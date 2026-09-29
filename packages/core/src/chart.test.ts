import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nyMinuteOfDay, nyWallClock } from "./calendar.js";
import { aggregate, ema, nyClock, PREMARKET_OPEN, type PriceBar } from "./chart.js";
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
