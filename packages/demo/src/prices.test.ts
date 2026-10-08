import { intrinsic, nyWallClock, type PriceBar } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dailyBar, dailyWalk, minuteBars, optionBars, syntheticDailyBar, tradingDays } from "./prices.js";
import { mulberry32 } from "./random.js";

const sane = (bar: PriceBar) =>
  bar.l <= Math.min(bar.o, bar.c) && bar.h >= Math.max(bar.o, bar.c) && bar.l > 0;

describe("tradingDays", () => {
  it("lists the sessions between two dates, skipping weekends and holidays", () => {
    expect(tradingDays("2026-11-23", "2026-11-30")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-27",
      "2026-11-30",
    ]);
  });
});

describe("minuteBars", () => {
  it("runs from the open to the close, bridged from the open price to the close price", () => {
    const bars = minuteBars(mulberry32(1), "2026-11-24", 180.5, 183.25, 0.45, 50_000);
    expect(bars).toHaveLength(390);
    expect(bars[0]?.t).toBe(nyWallClock("2026-11-24", 9 * 60 + 30));
    expect(bars.at(-1)?.t).toBe(nyWallClock("2026-11-24", 15 * 60 + 59));
    expect(bars[0]?.o).toBe(180.5);
    expect(bars.at(-1)?.c).toBe(183.25);
    expect(bars.every(sane)).toBe(true);
    for (let index = 1; index < bars.length; index++) expect(bars[index]?.o).toBe(bars[index - 1]?.c);
  });

  it("stops at 13:00 on a half day", () => {
    const bars = minuteBars(mulberry32(2), "2026-11-27", 600, 601, 0.16, 100_000);
    expect(bars).toHaveLength(210);
    expect(bars.at(-1)?.t).toBe(nyWallClock("2026-11-27", 12 * 60 + 59));
  });
});

describe("daily bars", () => {
  it("aggregate a day's minutes", () => {
    const minutes = minuteBars(mulberry32(3), "2026-11-24", 100, 101, 0.3, 1_000);
    expect(dailyBar("2026-11-24", minutes)).toEqual({
      t: nyWallClock("2026-11-24", 0),
      o: 100,
      h: Math.max(...minutes.map((bar) => bar.h)),
      l: Math.min(...minutes.map((bar) => bar.l)),
      c: 101,
      v: minutes.reduce((sum, bar) => sum + bar.v, 0),
    });
  });

  it("make a plausible bar for a day without minutes", () => {
    const bar = syntheticDailyBar(mulberry32(4), "2026-11-24", 100, 99, 0.3, 1_000);
    expect(sane(bar)).toBe(true);
    expect(bar).toMatchObject({ t: nyWallClock("2026-11-24", 0), o: 100, c: 99 });
  });
});

describe("dailyWalk", () => {
  const sessions = tradingDays("2026-10-01", "2026-11-30");

  it("opens an earnings day at the previous close times its gap, and repeats for the same seed", () => {
    const gaps = new Map([["2026-11-04", -0.08]]);
    const walk = dailyWalk(mulberry32(5), "NFLX", sessions, gaps);
    const before = walk.get("2026-11-03");
    expect(walk.get("2026-11-04")?.open).toBeCloseTo((before?.close ?? 0) * 0.92, 2);
    expect(dailyWalk(mulberry32(5), "NFLX", sessions, gaps)).toEqual(walk);
    expect([...walk.keys()]).toEqual(sessions);
  });
});

describe("optionBars", () => {
  it("prices a contract on the stock's bars, never below intrinsic, rising with the stock for a call", () => {
    const stock = minuteBars(mulberry32(6), "2026-11-24", 180, 184, 0.45, 50_000);
    const contract = { right: "C" as const, strike: 182.5, expiry: "2026-11-24" };
    const bars = optionBars(stock, contract, 0.5, mulberry32(7));
    expect(bars).toHaveLength(stock.length);
    expect(bars.every(sane)).toBe(true);
    for (const [index, bar] of bars.entries()) {
      const under = stock[index];
      if (!under) throw new Error("no stock bar");
      expect(bar.t).toBe(under.t);
      expect(bar.c).toBeGreaterThanOrEqual(intrinsic("C", under.c, 182.5) + 0.01 - 1e-9);
    }
    const at = nyWallClock("2026-11-24", 11 * 60);
    const flat = (t: number, price: number) => ({ t, o: price, h: price, l: price, c: price, v: 1 });
    const [cheap, dear] = optionBars([flat(at, 180), flat(at + 60_000, 185)], contract, 0.5, mulberry32(8));
    expect(dear?.c).toBeGreaterThan(cheap?.c ?? Number.POSITIVE_INFINITY);
    expect(bars.at(-1)?.c).toBeCloseTo(Math.max(intrinsic("C", 184, 182.5), 0.01), 1);
  });
});
