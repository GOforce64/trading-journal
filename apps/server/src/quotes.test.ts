import type { Quote, QuoteSource } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import type { createApp } from "./app.js";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const M = { price: 22.68, at: 1_790_279_911_052 };
const ENVX = { price: 9.87, at: 1_790_279_999_246 };

/** Knows prices for M and ENVX, and records every list of symbols it is asked for. */
function fakeSource() {
  const prices: Record<string, Quote> = { M, ENVX };
  const asked: string[][] = [];
  const source: QuoteSource = {
    async latest(symbols) {
      asked.push([...symbols]);
      return new Map(
        symbols.flatMap((symbol) => (prices[symbol] ? [[symbol, prices[symbol]] as const] : [])),
      );
    },
  };
  return { source, asked };
}

function appWith(quotes?: QuoteSource) {
  return testApp({
    market: quotes ? createMarketData(KEYS, { build: () => fakeSources({ quotes }) }) : undefined,
  });
}

const getQuotes = async (app: ReturnType<typeof createApp>, symbols: string) => {
  const res = await app.request(`/api/quotes?symbols=${symbols}`, { headers: LOCAL });
  return { status: res.status, body: (await res.json()) as { quotes: Record<string, Quote> } };
};

describe("GET /api/quotes", () => {
  it("answers with each symbol's last price and when it printed", async () => {
    const { source } = fakeSource();
    const { status, body } = await getQuotes(appWith(source), "ENVX,M,ZZZZ");
    expect(status).toBe(200);
    expect(body).toEqual({ quotes: { ENVX, M } });
  });

  it("asks for each symbol once, in capitals", async () => {
    const { source, asked } = fakeSource();
    await getQuotes(appWith(source), "m,%20envx,M");
    expect(asked).toEqual([["M", "ENVX"]]);
  });

  it("passes on only plain ticker symbols", async () => {
    const { source, asked } = fakeSource();
    await getQuotes(appWith(source), "M,..%2Fetc,BRK.B,,SPX%20INDEX");
    expect(asked).toEqual([["M", "BRK.B"]]);
  });

  it("answers with no prices when no data key is set up", async () => {
    const { status, body } = await getQuotes(appWith(), "M");
    expect(status).toBe(200);
    expect(body).toEqual({ quotes: {} });
  });

  it("answers from a newly configured key on the very next request", async () => {
    const { source } = fakeSource();
    const market = createMarketData(null, { build: () => fakeSources({ quotes: source }) });
    const app = testApp({ market });
    expect((await getQuotes(app, "M")).body).toEqual({ quotes: {} });
    market.configure(KEYS);
    expect((await getQuotes(app, "M")).body).toEqual({ quotes: { M } });
  });
});
