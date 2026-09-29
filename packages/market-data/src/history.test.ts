import { describe, expect, it } from "vitest";
import { alpacaHistory, tooRecent } from "./history.js";
import { AlpacaError } from "./http.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const START = Date.UTC(2026, 8, 21, 8, 0); // Mon Sep 21, 04:00 ET
const END = Date.UTC(2026, 8, 29, 0, 0); // Sep 28, 20:00 ET

/** A bar as Alpaca sends it, with the fields the chart ignores. */
const raw = (t: string, o: number, h: number, l: number, c: number) => ({
  t,
  o,
  h,
  l,
  c,
  v: 1200,
  n: 30,
  vw: c,
});

describe("alpacaHistory.minuteBars", () => {
  it("asks for SIP 1-minute bars, raw, 10,000 at a time, and follows next_page_token", async () => {
    const { fetch, calls } = fakeFetch(
      json({
        bars: { NVDA: [raw("2026-09-28T13:30:00Z", 229.5, 229.6, 229.4, 229.5)] },
        next_page_token: "abc",
      }),
      json({
        bars: { NVDA: [raw("2026-09-28T13:31:00Z", 229.8, 229.9, 229.7, 229.8)] },
        next_page_token: null,
      }),
    );
    const bars = await alpacaHistory(KEYS, { fetch }).minuteBars("NVDA", START, END);

    expect(bars).toEqual([
      { t: Date.UTC(2026, 8, 28, 13, 30), o: 229.5, h: 229.6, l: 229.4, c: 229.5, v: 1200 },
      { t: Date.UTC(2026, 8, 28, 13, 31), o: 229.8, h: 229.9, l: 229.7, c: 229.8, v: 1200 },
    ]);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      symbols: "NVDA",
      timeframe: "1Min",
      start: "2026-09-21T08:00:00.000Z",
      end: "2026-09-29T00:00:00.000Z",
      feed: "sip",
      adjustment: "raw",
      limit: "10000",
    });
    expect(calls[1]?.url.searchParams.get("page_token")).toBe("abc");
  });

  it("answers no bars for a symbol Alpaca doesn't carry", async () => {
    const { fetch } = fakeFetch(json({ message: "code=400, message=invalid symbol: SPX" }, 400));
    expect(await alpacaHistory(KEYS, { fetch }).minuteBars("SPX", START, END)).toEqual([]);
  });

  it("throws the free plan's refusal of the last 15 minutes, for the caller to decide", async () => {
    const { fetch } = fakeFetch(
      json({ message: "subscription does not permit querying recent SIP data" }, 403),
    );
    const error = await alpacaHistory(KEYS, { fetch })
      .minuteBars("NVDA", START, END)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AlpacaError);
    expect(tooRecent(error)).toBe(true);
    expect(tooRecent(new AlpacaError(403, "forbidden."))).toBe(false);
  });

  it("throws any other refusal", async () => {
    const { fetch } = fakeFetch(new Response("upstream down", { status: 502 }));
    await expect(alpacaHistory(KEYS, { fetch }).minuteBars("NVDA", START, END)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("alpacaHistory.dailyBars", () => {
  it("asks for daily bars between two dates", async () => {
    const { fetch, calls } = fakeFetch(
      json({ bars: { SPY: [raw("2026-09-25T04:00:00Z", 766.1, 772.4, 765.2, 771.35)] } }),
    );
    const bars = await alpacaHistory(KEYS, { fetch }).dailyBars("SPY", "2024-09-29", "2026-09-28");
    expect(bars.map((bar) => bar.c)).toEqual([771.35]);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toMatchObject({
      timeframe: "1Day",
      start: "2024-09-29",
      end: "2026-09-28",
    });
  });
});
