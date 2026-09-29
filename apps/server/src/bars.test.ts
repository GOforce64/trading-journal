import { addDays, isTradingDay, nyWallClock, type PriceBar } from "@tj/core";
import { AlpacaError, type BarHistory } from "@tj/market-data";
import { describe, expect, it, vi } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const NOW = Date.UTC(2026, 8, 29, 18, 0); // Tue Sep 29, 14:00 ET
const bar = (date: string, minute: number, c: number): PriceBar => ({
  t: nyWallClock(date, minute),
  o: c,
  h: c,
  l: c,
  c,
  v: 100,
});
const FRIDAY = bar("2026-09-25", 570, 228);
const MONDAY = bar("2026-09-28", 571, 229.5);
const TODAY = bar("2026-09-29", 600, 231);

interface Answer {
  symbol: string;
  bars: PriceBar[];
  partial: boolean;
  unavailable: { reason: string; message: string } | null;
}

function setup(history: Partial<BarHistory> = {}, withKey = true) {
  const minuteBars = vi.fn(history.minuteBars ?? (async () => [FRIDAY, MONDAY, TODAY]));
  const dailyBars = vi.fn(history.dailyBars ?? (async () => []));
  const market = createMarketData(withKey ? { keyId: "PKTEST", secretKey: "s" } : null, {
    build: () => fakeSources({ history: { minuteBars, dailyBars } }),
    log: () => {},
  });
  const app = testApp({ market, now: () => NOW });
  const get = async (path: string) => {
    const res = await app.request(path, { headers: LOCAL });
    return { status: res.status, body: (await res.json()) as Answer };
  };
  return { market, minuteBars, dailyBars, get };
}

describe("GET /api/bars/:symbol", () => {
  it("fetches the finished days of a past range once, then serves them from the cache", async () => {
    const { minuteBars, get } = setup({ minuteBars: async () => [FRIDAY, MONDAY] });
    const first = await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28");
    expect(first).toMatchObject({
      status: 200,
      body: { symbol: "NVDA", bars: [FRIDAY, MONDAY], partial: false, unavailable: null },
    });
    expect(minuteBars).toHaveBeenCalledWith(
      "NVDA",
      nyWallClock("2026-09-21", 0),
      nyWallClock("2026-09-29", 0),
    );

    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28")).body.bars).toEqual([FRIDAY, MONDAY]);
    expect(minuteBars).toHaveBeenCalledTimes(1);
  });

  it("asks for today on its own, up to 16 minutes ago, and never caches it", async () => {
    const { minuteBars, get } = setup({
      minuteBars: async (_symbol, start) =>
        start === nyWallClock("2026-09-29", 0) ? [TODAY] : [FRIDAY, MONDAY],
    });
    const answer = await get("/api/bars/NVDA?from=2026-09-22&to=2026-09-29");
    expect(answer.body).toMatchObject({ bars: [FRIDAY, MONDAY, TODAY], partial: true });
    expect(minuteBars).toHaveBeenCalledWith(
      "NVDA",
      nyWallClock("2026-09-22", 0),
      nyWallClock("2026-09-29", 0),
    );
    expect(minuteBars).toHaveBeenCalledWith("NVDA", nyWallClock("2026-09-29", 0), NOW - 16 * 60_000);

    await get("/api/bars/NVDA?from=2026-09-22&to=2026-09-29");
    // The finished days came from the cache; today was asked for again.
    expect(minuteBars).toHaveBeenCalledTimes(3);
    expect(minuteBars).toHaveBeenLastCalledWith("NVDA", nyWallClock("2026-09-29", 0), NOW - 16 * 60_000);
  });

  it("stores nothing when Alpaca fails, so the days are asked for again", async () => {
    let fail = true;
    const { minuteBars, get } = setup({
      minuteBars: async () => {
        if (fail) throw new AlpacaError(502, "");
        return [FRIDAY, MONDAY];
      },
    });
    const failed = await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28");
    expect(failed).toEqual({
      status: 502,
      body: { error: "unreachable", message: "Alpaca didn't answer. Try again." },
    });

    fail = false;
    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28")).body.bars).toEqual([FRIDAY, MONDAY]);
    expect(minuteBars).toHaveBeenCalledTimes(2);
  });

  it("treats the free plan's refusal of today's last minutes as no bars yet", async () => {
    const { get } = setup({
      minuteBars: async (_symbol, start) => {
        if (start === nyWallClock("2026-09-29", 0)) {
          throw new AlpacaError(403, "subscription does not permit querying recent SIP data");
        }
        return [MONDAY];
      },
    });
    expect((await get("/api/bars/NVDA?from=2026-09-28&to=2026-09-29")).body).toMatchObject({
      bars: [MONDAY],
      unavailable: null,
    });
  });

  it("says there are no bars for a symbol Alpaca doesn't carry, and remembers the empty days", async () => {
    const { minuteBars, get } = setup({ minuteBars: async () => [] });
    const answer = await get("/api/bars/SPX?from=2026-09-21&to=2026-09-28");
    expect(answer.body).toMatchObject({
      bars: [],
      unavailable: { reason: "no_bars", message: "No stock bars for SPX." },
    });
    await get("/api/bars/SPX?from=2026-09-21&to=2026-09-28");
    expect(minuteBars).toHaveBeenCalledTimes(1);
  });

  it("asks for a key when it has to fetch, but serves days already cached without one", async () => {
    const { market, get } = setup({ minuteBars: async () => [FRIDAY] });
    await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-25");
    market.configure(null);
    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-25")).body).toMatchObject({
      bars: [FRIDAY],
      unavailable: null,
    });
    expect((await get("/api/bars/NVDA?from=2026-09-14&to=2026-09-18")).body).toMatchObject({
      bars: [],
      unavailable: { reason: "no_key", message: "Add your Alpaca key in Settings to see the chart." },
    });
  });

  it("refuses a range that runs backwards or spans more than 45 days, or a bad symbol", async () => {
    const { get } = setup();
    expect((await get("/api/bars/NVDA?from=2026-09-28&to=2026-09-21")).status).toBe(400);
    expect((await get("/api/bars/NVDA?from=2026-06-01&to=2026-09-28")).status).toBe(400);
    expect((await get("/api/bars/nv%20da?from=2026-09-21&to=2026-09-28")).status).toBe(400);
  });
});

describe("GET /api/bars/:symbol/daily", () => {
  it("fetches three years of daily bars up to yesterday once, never today", async () => {
    const daily = bar("2026-09-25", 0, 771.35);
    const { dailyBars, get } = setup({ dailyBars: async () => [daily] });
    expect((await get("/api/bars/SPY/daily?to=2026-09-29")).body).toMatchObject({
      bars: [daily],
      unavailable: null,
    });
    expect(dailyBars).toHaveBeenCalledWith("SPY", "2023-09-29", "2026-09-28");

    await get("/api/bars/SPY/daily?to=2026-09-29");
    expect(dailyBars).toHaveBeenCalledTimes(1);
  });

  it("asks for enough trading days to draw the 167 EMA across the six months the chart opens on", async () => {
    const { dailyBars, get } = setup();
    await get("/api/bars/SPY/daily?to=2026-09-29");
    const [, from = "", to = ""] = dailyBars.mock.calls[0] ?? [];
    let tradingDays = 0;
    for (let date = from; date <= to; date = addDays(date, 1)) {
      if (isTradingDay(date)) tradingDays++;
    }
    // EMA 167 draws from its 3 × 167th close, and the daily chart opens on the last 126.
    expect(tradingDays).toBeGreaterThanOrEqual(3 * 167 - 1 + 126);
  });

  it("ends at the trade's last day when that's in the past", async () => {
    const { dailyBars, get } = setup();
    await get("/api/bars/SPY/daily?to=2026-07-17");
    expect(dailyBars).toHaveBeenCalledWith("SPY", "2023-07-18", "2026-07-17");
  });
});
