import { describe, expect, it } from "vitest";
import { alpacaChains, type ChainSource, cachedChains, type ListedExpiration } from "./chains.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const today = () => "2026-09-26";

/** One contract as Alpaca's contracts endpoint lists it (every field, as seen on 2026-09-26). */
function contract(expiry: string, strike: string, type: "call" | "put", status = "active") {
  const [year, month, day] = expiry.split("-");
  const code = `M${year?.slice(2)}${month}${day}${type === "call" ? "C" : "P"}${String(Number(strike) * 1000).padStart(8, "0")}`;
  return {
    id: "1fb904df-961a-4a07-a924-53a437626db2",
    symbol: code,
    name: `M ${expiry} ${strike} ${type}`,
    status,
    tradable: status === "active",
    expiration_date: expiry,
    root_symbol: "M",
    underlying_symbol: "M",
    underlying_asset_id: "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
    type,
    style: "american",
    strike_price: strike,
    multiplier: "100",
    size: "100",
    open_interest: "3",
    open_interest_date: "2026-09-24",
    close_price: "0.42",
    close_price_date: "2026-09-24",
    ppind: true,
  };
}

const page = (contracts: unknown[], next: string | null = null) =>
  json({ option_contracts: contracts, next_page_token: next });

describe("alpacaChains", () => {
  it("asks for active contracts from today to three years out, with the key", async () => {
    const { fetch, calls } = fakeFetch(page([]));
    await alpacaChains(KEYS, { fetch, today }).listed("M");

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://paper-api.alpaca.markets/v2/options/contracts");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      underlying_symbols: "M",
      status: "active",
      expiration_date_gte: "2026-09-26",
      expiration_date_lte: "2029-12-31",
      limit: "10000",
    });
    expect(calls[0]?.headers.get("APCA-API-SECRET-KEY")).toBe(KEYS.secretKey);
  });

  it("groups strikes by expiration, calls and puts together, in order", async () => {
    const { fetch } = fakeFetch(
      page([
        contract("2026-10-09", "23", "call"),
        contract("2026-10-02", "22.5", "call"),
        contract("2026-10-02", "22.5", "put"),
        contract("2026-10-02", "22", "call"),
        contract("2026-10-02", "21", "put"),
      ]),
    );
    expect(await alpacaChains(KEYS, { fetch, today }).listed("M")).toEqual<ListedExpiration[]>([
      { date: "2026-10-02", expired: false, strikes: [21, 22, 22.5] },
      { date: "2026-10-09", expired: false, strikes: [23] },
    ]);
  });

  it("also asks for expired contracts back to `since`, and marks them expired", async () => {
    const { fetch, calls } = fakeFetch(
      page([contract("2026-10-02", "22.5", "call")]),
      page([contract("2026-09-25", "8.5", "call", "inactive")]),
    );
    const listed = await alpacaChains(KEYS, { fetch, today }).listed("M", "2026-09-01");

    expect(calls).toHaveLength(2);
    expect(Object.fromEntries(calls[1]?.url.searchParams ?? [])).toEqual({
      underlying_symbols: "M",
      status: "inactive",
      expiration_date_gte: "2026-09-01",
      expiration_date_lte: "2026-09-26",
      limit: "10000",
    });
    expect(listed).toEqual([
      { date: "2026-09-25", expired: true, strikes: [8.5] },
      { date: "2026-10-02", expired: false, strikes: [22.5] },
    ]);
  });

  it("asks for expired contracts only up to 90 days after `since`, so an old trade stays cheap", async () => {
    const { fetch, calls } = fakeFetch(page([]), page([]));
    await alpacaChains(KEYS, { fetch, today }).listed("NVDA", "2026-01-15");
    expect(calls[1]?.url.searchParams.get("expiration_date_gte")).toBe("2026-01-15");
    expect(calls[1]?.url.searchParams.get("expiration_date_lte")).toBe("2026-04-15");
  });

  it("does not ask for expired contracts when `since` is today or later", async () => {
    for (const since of ["2026-09-26", "2026-10-01"]) {
      const { fetch, calls } = fakeFetch(page([]));
      await alpacaChains(KEYS, { fetch, today }).listed("M", since);
      expect(calls).toHaveLength(1);
    }
  });

  it("follows the page token until it runs out", async () => {
    const { fetch, calls } = fakeFetch(
      page([contract("2026-10-02", "22", "call")], "MTAw"),
      page([contract("2026-10-02", "23", "call")]),
    );
    const listed = await alpacaChains(KEYS, { fetch, today }).listed("M");

    expect(calls[1]?.url.searchParams.get("page_token")).toBe("MTAw");
    expect(listed).toEqual([{ date: "2026-10-02", expired: false, strikes: [22, 23] }]);
  });

  it("returns nothing when nothing is listed", async () => {
    const { fetch } = fakeFetch(page([]));
    expect(await alpacaChains(KEYS, { fetch, today }).listed("ZZZZ")).toEqual([]);
  });

  it("gives up rather than follow page tokens forever", async () => {
    const replies = Array.from({ length: 20 }, () => page([], "again"));
    const { fetch } = fakeFetch(...replies);
    await expect(alpacaChains(KEYS, { fetch, today }).listed("M")).rejects.toThrow(/pages/);
  });

  it("fails with Alpaca's status, keeping its error page out of the message", async () => {
    const { fetch } = fakeFetch(new Response("<html>401</html>", { status: 401 }));
    const error = await alpacaChains(KEYS, { fetch, today })
      .listed("M")
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("<html>");
  });
});

describe("cachedChains", () => {
  const OCT = [{ date: "2026-10-02", expired: false, strikes: [22.5] }];

  function fakeSource() {
    const asked: [string, string | undefined][] = [];
    const state = { error: null as Error | null };
    const source: ChainSource = {
      async listed(symbol, since) {
        asked.push([symbol, since]);
        if (state.error) throw state.error;
        return OCT;
      },
    };
    return { source, asked, state };
  }

  it("reuses an answer for the same symbol and date within the TTL", async () => {
    const fake = fakeSource();
    let clock = 0;
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => clock });
    await chains.listed("M", "2026-09-01");
    clock = 999;
    expect(await chains.listed("M", "2026-09-01")).toEqual(OCT);
    expect(fake.asked).toHaveLength(1);
  });

  it("asks again for a different date, and once the TTL is up", async () => {
    const fake = fakeSource();
    let clock = 0;
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => clock });
    await chains.listed("M");
    await chains.listed("M", "2026-09-01");
    clock = 1000;
    await chains.listed("M");
    expect(fake.asked).toEqual([
      ["M", undefined],
      ["M", "2026-09-01"],
      ["M", undefined],
    ]);
  });

  it("does not remember a failure", async () => {
    const fake = fakeSource();
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => 0 });
    fake.state.error = new Error("Alpaca answered 500");
    await expect(chains.listed("M")).rejects.toThrow("500");
    fake.state.error = null;
    expect(await chains.listed("M")).toEqual(OCT);
  });
});
