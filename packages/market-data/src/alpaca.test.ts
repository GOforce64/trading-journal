import { describe, expect, it } from "vitest";
import { alpacaQuotes } from "./alpaca.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };

/** A latest-trades reply for ENVX and M with every field Alpaca sends, as its API reference shows it. */
const latestTrades = {
  trades: {
    ENVX: {
      c: ["@"],
      i: 52983525029461,
      p: 9.87,
      s: 100,
      t: "2026-09-24T19:59:59.246196362Z",
      x: "V",
      z: "C",
    },
    M: {
      c: ["@", "I"],
      i: 52983525033113,
      p: 22.68,
      s: 12,
      t: "2026-09-24T19:58:31.052140833Z",
      x: "V",
      z: "A",
    },
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Alpaca's answer when one symbol in a batch is unknown: the whole request fails. */
const invalidSymbol = (symbol: string) =>
  json({ message: `code=400, message=invalid symbol: ${symbol}` }, 400);

/** Plays back one reply per call and records what each call asked for. */
function fakeFetch(...replies: Response[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ url: new URL(input), headers: new Headers(init?.headers) });
    const reply = replies.shift();
    if (!reply) throw new Error("Alpaca was called more often than expected");
    return reply;
  };
  return { fetch, calls };
}

describe("alpacaQuotes", () => {
  it("asks the IEX feed for every symbol's latest trade in one call, with the key", async () => {
    const { fetch, calls } = fakeFetch(json(latestTrades));
    await alpacaQuotes(KEYS, { fetch }).latest(["ENVX", "M"]);

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://data.alpaca.markets/v2/stocks/trades/latest");
    expect(url?.searchParams.get("symbols")).toBe("ENVX,M");
    expect(url?.searchParams.get("feed")).toBe("iex");
    expect(calls[0]?.headers.get("APCA-API-KEY-ID")).toBe("PKTESTKEYID");
    expect(calls[0]?.headers.get("APCA-API-SECRET-KEY")).toBe("test-secret-do-not-log");
  });

  it("returns each symbol's last price and when it printed, leaving out symbols with no trade", async () => {
    const { fetch } = fakeFetch(json(latestTrades));
    const quotes = await alpacaQuotes(KEYS, { fetch }).latest(["ENVX", "M", "ZZZZ"]);

    expect(quotes).toEqual(
      new Map([
        ["ENVX", { price: 9.87, at: Date.UTC(2026, 8, 24, 19, 59, 59, 246) }],
        ["M", { price: 22.68, at: Date.UTC(2026, 8, 24, 19, 58, 31, 52) }],
      ]),
    );
  });

  it("drops a symbol Alpaca rejects as invalid and asks again for the rest", async () => {
    const { fetch, calls } = fakeFetch(invalidSymbol("GME1"), json(latestTrades));
    const quotes = await alpacaQuotes(KEYS, { fetch }).latest(["ENVX", "GME1", "M"]);

    expect(calls.map((call) => call.url.searchParams.get("symbols"))).toEqual(["ENVX,GME1,M", "ENVX,M"]);
    expect([...quotes.keys()]).toEqual(["ENVX", "M"]);
  });

  it("stops asking once every symbol has been rejected", async () => {
    const { fetch, calls } = fakeFetch(invalidSymbol("GME1"));
    const quotes = await alpacaQuotes(KEYS, { fetch }).latest(["GME1"]);

    expect(calls).toHaveLength(1);
    expect(quotes.size).toBe(0);
  });

  it("does not call Alpaca for an empty list", async () => {
    const { fetch, calls } = fakeFetch();
    const quotes = await alpacaQuotes(KEYS, { fetch }).latest([]);

    expect(calls).toHaveLength(0);
    expect(quotes.size).toBe(0);
  });

  it("fails on a rejection that names a symbol it never sent, instead of asking again", async () => {
    const { fetch, calls } = fakeFetch(invalidSymbol("FOO"));
    const error = await alpacaQuotes(KEYS, { fetch })
      .latest(["M"])
      .catch((caught: unknown) => caught);

    expect(calls).toHaveLength(1);
    expect(String(error)).toContain("400");
  });

  it("fails with Alpaca's status and message on any other error, never echoing the key", async () => {
    const { fetch } = fakeFetch(json({ code: 40110000, message: "request is not authorized" }, 401));
    const error = await alpacaQuotes(KEYS, { fetch })
      .latest(["M"])
      .catch((caught: unknown) => caught);

    expect(String(error)).toContain("401");
    expect(String(error)).toContain("request is not authorized");
    expect(String(error)).not.toContain(KEYS.secretKey);
  });

  it("keeps an error page out of the message", async () => {
    // What Alpaca's front end sends for a wrong key, seen on a live call.
    const page =
      "<html>\r\n<head><title>401 Authorization Required</title></head>\r\n<body>…</body>\r\n</html>\r\n";
    const { fetch } = fakeFetch(
      new Response(page, { status: 401, headers: { "content-type": "text/html" } }),
    );
    const error = await alpacaQuotes(KEYS, { fetch })
      .latest(["M"])
      .catch((caught: unknown) => caught);

    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("<html>");
  });

  it("rejects a reply that is not in Alpaca's format rather than show a wrong price", async () => {
    const { fetch } = fakeFetch(json({ trades: { M: { p: "22.68", t: "2026-09-24T19:58:31Z" } } }));
    await expect(alpacaQuotes(KEYS, { fetch }).latest(["M"])).rejects.toThrow();
  });

  it("gives up on a reply that takes too long", async () => {
    // Like the real fetch, this one only ends when its signal aborts.
    const hang = (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await expect(alpacaQuotes(KEYS, { fetch: hang, timeoutMs: 20 }).latest(["M"])).rejects.toThrow();
  });
});
