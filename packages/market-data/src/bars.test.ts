import { describe, expect, it } from "vitest";
import { alpacaBars } from "./bars.js";
import { AlpacaError } from "./http.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const AT = Date.UTC(2026, 8, 9, 19, 54); // Wed Sep 9, 15:54 ET

const bar = (t: string, c: number) => ({ c, h: c + 0.02, l: c - 0.02, n: 40, o: c, t, v: 5200, vw: c });

/** M's minute bars up to 15:54 ET, as Alpaca sends them. Nothing printed in the 15:52 minute. */
const M_BARS = {
  bars: {
    M: [
      bar("2026-09-09T19:50:00Z", 21.7),
      bar("2026-09-09T19:51:00Z", 21.68),
      bar("2026-09-09T19:53:00Z", 21.66),
      bar("2026-09-09T19:54:00Z", 21.61),
    ],
  },
  next_page_token: null,
};

describe("alpacaBars.priceAt", () => {
  it("asks for SIP minute bars, unadjusted, from the open to the moment", async () => {
    const { fetch, calls } = fakeFetch(json(M_BARS));
    await alpacaBars(KEYS, { fetch }).priceAt("M", AT);

    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://data.alpaca.markets/v2/stocks/bars");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      symbols: "M",
      timeframe: "1Min",
      start: "2026-09-09T13:30:00.000Z",
      end: "2026-09-09T19:54:00.000Z",
      feed: "sip",
      adjustment: "raw",
      limit: "1000",
    });
    expect(calls[0]?.headers.get("APCA-API-KEY-ID")).toBe("PKTESTKEYID");
  });

  it("takes the close of the last bar that started before the moment, across a gap", async () => {
    const { fetch } = fakeFetch(json(M_BARS));
    // The bar stamped 15:54 is still forming at 15:54; the one stamped 15:53 closed then.
    expect(await alpacaBars(KEYS, { fetch }).priceAt("M", AT)).toBe(21.66);
  });

  it.each([
    ["an empty map", { bars: {} }],
    ["the symbol missing", { bars: { AAPL: [bar("2026-09-09T19:50:00Z", 230)] } }],
    ["the symbol with null", { bars: { M: null } }],
    ["null bars", { bars: null }],
  ])("has no price when Alpaca sends %s", async (_case, reply) => {
    const { fetch } = fakeFetch(json(reply));
    expect(await alpacaBars(KEYS, { fetch }).priceAt("M", AT)).toBeNull();
  });

  it("has no price, rather than an error, for the last 15 minutes the free plan withholds", async () => {
    const { fetch } = fakeFetch(
      json({ message: "subscription does not permit querying recent SIP data" }, 403),
    );
    expect(await alpacaBars(KEYS, { fetch }).priceAt("M", AT)).toBeNull();
  });

  it("has no price for a symbol Alpaca doesn't know", async () => {
    const { fetch } = fakeFetch(json({ message: "code=400, message=invalid symbol: ZZZZ1" }, 400));
    expect(await alpacaBars(KEYS, { fetch }).priceAt("ZZZZ1", AT)).toBeNull();
  });

  it("throws any other refusal, for the caller to report", async () => {
    const refused = fakeFetch(json({ message: "forbidden." }, 403));
    await expect(alpacaBars(KEYS, { fetch: refused.fetch }).priceAt("M", AT)).rejects.toBeInstanceOf(
      AlpacaError,
    );
    const down = fakeFetch(new Response("upstream down", { status: 502 }));
    await expect(alpacaBars(KEYS, { fetch: down.fetch }).priceAt("M", AT)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("alpacaBars.closeOn", () => {
  it("reads the close from that date's daily bar", async () => {
    const { fetch, calls } = fakeFetch(json({ bars: { BB: [bar("2026-09-25T04:00:00Z", 8.21)] } }));
    expect(await alpacaBars(KEYS, { fetch }).closeOn("BB", "2026-09-25")).toBe(8.21);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toMatchObject({
      symbols: "BB",
      timeframe: "1Day",
      start: "2026-09-25",
      end: "2026-09-25",
      feed: "sip",
      adjustment: "raw",
    });
  });

  it("has no close on a day without a bar", async () => {
    const { fetch } = fakeFetch(json({ bars: {} }));
    expect(await alpacaBars(KEYS, { fetch }).closeOn("BB", "2026-09-26")).toBeNull();
  });
});
