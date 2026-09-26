import { AlpacaError, type ListedExpiration } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import type { createApp } from "./app.js";
import { createMarketData, type MarketSources } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const OCT: ListedExpiration[] = [{ date: "2026-10-02", expired: false, strikes: [21, 22, 22.5] }];
const QUOTE = { bid: 0.44, ask: 0.58, at: Date.UTC(2026, 8, 25, 19, 59, 51) };

function withSources(overrides: Partial<MarketSources>) {
  const market = createMarketData(KEYS, { build: () => fakeSources(overrides), log: () => {} });
  return { app: testApp({ market }), market };
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path, { headers: LOCAL });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/chains/:symbol", () => {
  it("answers with the listed expirations, asking in capitals from the given date", async () => {
    const asked: [string, string | undefined][] = [];
    const { app } = withSources({
      chains: {
        listed: async (symbol, since) => {
          asked.push([symbol, since]);
          return OCT;
        },
      },
    });
    const { status, body } = await get(app, "/api/chains/m?since=2026-09-01");
    expect(status).toBe(200);
    expect(body).toEqual({ symbol: "M", expirations: OCT, unavailable: null });
    expect(asked).toEqual([["M", "2026-09-01"]]);
  });

  it("says when nothing is listed", async () => {
    const { app } = withSources({});
    const { body } = await get(app, "/api/chains/ZZZZ");
    expect(body.unavailable).toEqual({
      reason: "none_listed",
      message: "No listed options for ZZZZ in that period.",
    });
  });

  it("says a key is needed when none is set up", async () => {
    const { body } = await get(testApp(), "/api/chains/M");
    expect(body).toEqual({
      symbol: "M",
      expirations: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
    });
  });

  it("says Alpaca didn't answer, and reports the failure", async () => {
    const { app, market } = withSources({
      chains: {
        listed: async () => {
          throw new AlpacaError(401, "request is not authorized");
        },
      },
    });
    const { status, body } = await get(app, "/api/chains/M");
    expect(status).toBe(200);
    expect(body.unavailable).toEqual({
      reason: "unreachable",
      message: "Alpaca didn't answer, so type the expiry and strikes.",
    });
    expect(market.status().state).toBe("error");
  });

  it.each(["/api/chains/SPX%20INDEX", "/api/chains/M?since=yesterday", "/api/chains/M?since=2026-13-45"])(
    "refuses %s",
    async (path) => {
      const { app } = withSources({});
      expect((await get(app, path)).status).toBe(400);
    },
  );
});

describe("GET /api/option-quotes", () => {
  it("answers with bid, ask and time for each contract the source knows", async () => {
    const { app } = withSources({
      optionQuotes: { latest: async () => new Map([["M261002C00022500", QUOTE]]) },
    });
    const { body } = await get(app, "/api/option-quotes?contracts=M261002C00022500,M261002C00022300");
    expect(body).toEqual({ quotes: { M261002C00022500: QUOTE } });
  });

  it("asks for each well-formed contract once, in capitals", async () => {
    const asked: string[][] = [];
    const { app } = withSources({
      optionQuotes: {
        latest: async (contracts) => {
          asked.push([...contracts]);
          return new Map();
        },
      },
    });
    await get(
      app,
      "/api/option-quotes?contracts=m261002c00022500,M261002C00022500,NOTASYMBOL,%20M261002P00021000",
    );
    expect(asked).toEqual([["M261002C00022500", "M261002P00021000"]]);
  });

  it("passes a long list on in one piece; the source splits it for Alpaca", async () => {
    const contracts = Array.from(
      { length: 150 },
      (_, i) => `M261002C${String(10_000 + i * 500).padStart(8, "0")}`,
    );
    const asked: number[] = [];
    const { app } = withSources({
      optionQuotes: {
        latest: async (codes) => {
          asked.push(codes.length);
          return new Map();
        },
      },
    });
    const { status } = await get(app, `/api/option-quotes?contracts=${contracts.join(",")}`);
    expect(status).toBe(200);
    expect(asked).toEqual([150]);
  });

  it("answers with no quotes without a key", async () => {
    expect((await get(testApp(), "/api/option-quotes?contracts=M261002C00022500")).body).toEqual({
      quotes: {},
    });
  });
});

describe("GET /api/company/:symbol", () => {
  it("answers with the company's name", async () => {
    const { app } = withSources({
      companies: { name: async (symbol) => (symbol === "M" ? "Macy's Inc." : null) },
    });
    expect((await get(app, "/api/company/m")).body).toEqual({ name: "Macy's Inc." });
  });

  it("answers null without a key", async () => {
    expect((await get(testApp(), "/api/company/M")).body).toEqual({ name: null });
  });

  it("answers null when Alpaca fails, and reports it", async () => {
    const { app, market } = withSources({
      companies: {
        name: async () => {
          throw new AlpacaError(403, "forbidden");
        },
      },
    });
    expect((await get(app, "/api/company/M")).body).toEqual({ name: null });
    expect(market.status().state).toBe("error");
  });
});
