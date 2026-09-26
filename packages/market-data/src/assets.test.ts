import { describe, expect, it } from "vitest";
import { alpacaCompanyNames, checkAlpacaKeys } from "./assets.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };

/** Alpaca's asset record for M, as seen on 2026-09-26 (trimmed to the fields it always sends). */
const asset = (name: string) =>
  json({
    id: "b3001dcc-4903-413c-b91a-985feacf5284",
    class: "us_equity",
    exchange: "NYSE",
    symbol: "M",
    name,
    status: "active",
    tradable: true,
    marginable: true,
  });

describe("alpacaCompanyNames", () => {
  it("asks the trading API for the asset and answers with its name", async () => {
    const { fetch, calls } = fakeFetch(asset("Macy's Inc."));
    expect(await alpacaCompanyNames(KEYS, { fetch }).name("M")).toBe("Macy's Inc.");
    expect(calls[0]?.url.href).toBe("https://paper-api.alpaca.markets/v2/assets/M");
  });

  it("drops the trailing 'Common Stock'", async () => {
    const { fetch } = fakeFetch(asset("NVIDIA Corporation Common Stock"));
    expect(await alpacaCompanyNames(KEYS, { fetch }).name("NVDA")).toBe("NVIDIA Corporation");
  });

  it("asks only once per symbol", async () => {
    const { fetch, calls } = fakeFetch(asset("Macy's Inc."));
    const names = alpacaCompanyNames(KEYS, { fetch });
    await names.name("M");
    expect(await names.name("M")).toBe("Macy's Inc.");
    expect(calls).toHaveLength(1);
  });

  it("answers null for a symbol Alpaca does not know, and remembers that", async () => {
    const { fetch, calls } = fakeFetch(json({ message: "asset not found for ZZZZ" }, 404));
    const names = alpacaCompanyNames(KEYS, { fetch });
    expect(await names.name("ZZZZ")).toBeNull();
    expect(await names.name("ZZZZ")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("passes other failures on without remembering them", async () => {
    const { fetch } = fakeFetch(json({ message: "internal error" }, 500), asset("Macy's Inc."));
    const names = alpacaCompanyNames(KEYS, { fetch });
    await expect(names.name("M")).rejects.toThrow("500");
    expect(await names.name("M")).toBe("Macy's Inc.");
  });
});

describe("checkAlpacaKeys", () => {
  it("is ok when both the data and the trading API accept the key", async () => {
    const { fetch, calls } = fakeFetch(json({ trades: {} }), asset("SPDR S&P 500 ETF Trust"));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("ok");
    expect(calls.map((call) => `${call.url.origin}${call.url.pathname}`)).toEqual([
      "https://data.alpaca.markets/v2/stocks/trades/latest",
      "https://paper-api.alpaca.markets/v2/assets/SPY",
    ]);
  });

  it("is rejected when the data API refuses the key", async () => {
    const { fetch, calls } = fakeFetch(new Response("<html>401</html>", { status: 401 }));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("rejected");
    expect(calls).toHaveLength(1);
  });

  it("is not_paper when only the paper trading API refuses it", async () => {
    const { fetch } = fakeFetch(json({ trades: {} }), json({ message: "forbidden" }, 403));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("not_paper");
  });

  it("is unreachable when Alpaca fails or does not answer", async () => {
    const down = fakeFetch(json({ message: "internal error" }, 500));
    expect(await checkAlpacaKeys(KEYS, { fetch: down.fetch })).toBe("unreachable");
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await checkAlpacaKeys(KEYS, { fetch: offline })).toBe("unreachable");
  });
});
