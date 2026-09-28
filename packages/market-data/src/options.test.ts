import { describe, expect, it } from "vitest";
import { alpacaOptionQuotes } from "./options.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const CALL = "M261002C00022500";
const PUT = "M261002P00021000";

/** Alpaca's latest-quotes answer for two M contracts on 2026-09-26 (indicative feed), every field kept. */
const latestQuotes = {
  quotes: {
    [CALL]: {
      ap: 0.58,
      as: 101,
      ax: "A",
      bp: 0.44,
      bs: 150,
      bx: "A",
      c: "A",
      t: "2026-09-25T19:59:51.022502126Z",
    },
    [PUT]: {
      ap: 0.25,
      as: 1208,
      ax: "E",
      bp: 0,
      bs: 0,
      bx: "?",
      c: "A",
      t: "2026-09-25T19:59:49.671074315Z",
    },
  },
};

describe("alpacaOptionQuotes", () => {
  it("asks the indicative feed for every contract in one call, with the key", async () => {
    const { fetch, calls } = fakeFetch(json(latestQuotes));
    await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, PUT]);

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe(
      "https://data.alpaca.markets/v1beta1/options/quotes/latest",
    );
    expect(url?.searchParams.get("symbols")).toBe(`${CALL},${PUT}`);
    expect(url?.searchParams.get("feed")).toBe("indicative");
    expect(calls[0]?.headers.get("APCA-API-KEY-ID")).toBe("PKTESTKEYID");
  });

  it("returns bid, ask and quote time, leaving out contracts Alpaca does not know", async () => {
    const { fetch } = fakeFetch(json(latestQuotes));
    const quotes = await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, PUT, "M261002C00022300"]);

    expect(quotes).toEqual(
      new Map([
        [CALL, { bid: 0.44, ask: 0.58, at: Date.UTC(2026, 8, 25, 19, 59, 51, 22) }],
        [PUT, { bid: 0, ask: 0.25, at: Date.UTC(2026, 8, 25, 19, 59, 49, 671) }],
      ]),
    );
  });

  it("treats an ask of 0 as no ask at all", async () => {
    const { fetch } = fakeFetch(
      json({ quotes: { [CALL]: { ap: 0, as: 0, bp: 0, bs: 0, t: "2026-09-25T19:59:51Z" } } }),
    );
    const quotes = await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL]);
    expect(quotes.get(CALL)).toEqual({ bid: 0, ask: null, at: Date.UTC(2026, 8, 25, 19, 59, 51) });
  });

  it("never sends a malformed code, and asks for each contract once", async () => {
    // One malformed code would fail Alpaca's whole batch with a 400.
    const { fetch, calls } = fakeFetch(json({ quotes: {} }));
    await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, "NOTASYMBOL", "M261002C0002250", CALL]);
    expect(calls[0]?.url.searchParams.get("symbols")).toBe(CALL);
  });

  it("asks in batches of at most 100", async () => {
    const contracts = Array.from(
      { length: 150 },
      (_, i) => `M261002C${String(10_000 + i * 500).padStart(8, "0")}`,
    );
    const { fetch, calls } = fakeFetch(json({ quotes: {} }), json({ quotes: {} }));
    await alpacaOptionQuotes(KEYS, { fetch }).latest(contracts);
    expect(calls.map((call) => call.url.searchParams.get("symbols")?.split(",").length)).toEqual([100, 50]);
  });

  it("does not call Alpaca when nothing valid is asked for", async () => {
    const { fetch, calls } = fakeFetch();
    expect((await alpacaOptionQuotes(KEYS, { fetch }).latest(["NOTASYMBOL"])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("fails with Alpaca's status, never echoing the key", async () => {
    const { fetch } = fakeFetch(json({ message: "forbidden" }, 403));
    const error = await alpacaOptionQuotes(KEYS, { fetch })
      .latest([CALL])
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("403");
    expect(String(error)).not.toContain(KEYS.secretKey);
  });
});
