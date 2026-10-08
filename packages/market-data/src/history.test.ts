import { describe, expect, it } from "vitest";
import { alpacaHistory, alpacaOptionHistory, optionTooRecent, tooRecent } from "./history.js";
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

  it("throws when a later page fails, rather than answering with the first page alone", async () => {
    // A half-read range stored as complete would leave a gap in the cache for good.
    const { fetch } = fakeFetch(
      json({
        bars: { NVDA: [raw("2026-09-28T13:30:00Z", 229.5, 229.6, 229.4, 229.5)] },
        next_page_token: "abc",
      }),
      new Response("upstream down", { status: 502 }),
    );
    await expect(alpacaHistory(KEYS, { fetch }).minuteBars("NVDA", START, END)).rejects.toMatchObject({
      status: 502,
    });
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

describe("alpacaOptionHistory.minuteBars", () => {
  const CONTRACT = "SPY261006C00779000";

  it("asks the option bars endpoint for 1-minute bars, 10,000 at a time, and follows next_page_token", async () => {
    const { fetch, calls } = fakeFetch(
      json({
        bars: { [CONTRACT]: [raw("2026-10-06T13:30:00Z", 0.83, 1.09, 0.76, 1.07)] },
        next_page_token: "abc",
      }),
      json({
        bars: { [CONTRACT]: [raw("2026-10-06T13:31:00Z", 1.07, 1.1, 1, 1.02)] },
        next_page_token: null,
      }),
    );
    const bars = await alpacaOptionHistory(KEYS, { fetch }).minuteBars(
      CONTRACT,
      Date.UTC(2026, 9, 6, 4),
      Date.UTC(2026, 9, 7, 4),
    );
    expect(bars).toEqual([
      { t: Date.UTC(2026, 9, 6, 13, 30), o: 0.83, h: 1.09, l: 0.76, c: 1.07, v: 1200 },
      { t: Date.UTC(2026, 9, 6, 13, 31), o: 1.07, h: 1.1, l: 1, c: 1.02, v: 1200 },
    ]);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://data.alpaca.markets/v1beta1/options/bars");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      symbols: CONTRACT,
      timeframe: "1Min",
      start: "2026-10-06T04:00:00.000Z",
      end: "2026-10-07T04:00:00.000Z",
      limit: "10000",
    });
    expect(calls[1]?.url.searchParams.get("page_token")).toBe("abc");
  });

  it("answers [] for a contract Alpaca doesn't know, as an empty reply or a refused code", async () => {
    const empty = fakeFetch(json({ bars: {}, next_page_token: null }));
    expect(await alpacaOptionHistory(KEYS, { fetch: empty.fetch }).minuteBars(CONTRACT, 0, 1)).toEqual([]);
    const refused = fakeFetch(
      json({ message: 'invalid symbol: "SPXW1" does not match ^[A-Z]{1,5}\\d{6,7}[CP]\\d{8}$' }, 400),
    );
    expect(await alpacaOptionHistory(KEYS, { fetch: refused.fetch }).minuteBars("SPXW1", 0, 1)).toEqual([]);
  });

  it("throws Alpaca's refusals, telling the OPRA delay apart", async () => {
    const { fetch } = fakeFetch(json({ message: "OPRA agreement is not signed" }, 403));
    const error = await alpacaOptionHistory(KEYS, { fetch })
      .minuteBars(CONTRACT, 0, 1)
      .catch((caught: unknown) => caught);
    expect(optionTooRecent(error)).toBe(true);
    expect(optionTooRecent(new AlpacaError(403, "forbidden"))).toBe(false);
    expect(
      optionTooRecent(new AlpacaError(403, "subscription does not permit querying recent SIP data")),
    ).toBe(false);
  });
});
