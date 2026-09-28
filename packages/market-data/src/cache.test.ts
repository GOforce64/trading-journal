import { beforeEach, describe, expect, it } from "vitest";
import { cachedQuotes } from "./cache.js";
import type { Quote, QuoteSource } from "./quotes.js";

const TTL = 30_000;
const M = { price: 22.68, at: 1_790_279_911_052 };
const ENVX = { price: 9.87, at: 1_790_279_999_246 };

/** A source with settable prices that records every list of symbols it is asked for. */
function fakeSource() {
  const asked: string[][] = [];
  const state = { prices: new Map<string, Quote>(), error: null as Error | null };
  const source: QuoteSource = {
    async latest(symbols) {
      asked.push([...symbols]);
      if (state.error) throw state.error;
      return new Map([...state.prices].filter(([symbol]) => symbols.includes(symbol)));
    },
  };
  return { source, asked, state };
}

describe("cachedQuotes", () => {
  let clock: number;
  let errors: unknown[];
  let fake: ReturnType<typeof fakeSource>;
  let quotes: QuoteSource;

  beforeEach(() => {
    clock = 0;
    errors = [];
    fake = fakeSource();
    fake.state.prices = new Map([
      ["M", M],
      ["ENVX", ENVX],
    ]);
    quotes = cachedQuotes(fake.source, {
      ttlMs: TTL,
      now: () => clock,
      onError: (error) => errors.push(error),
    });
  });

  it("reuses a price younger than the TTL instead of asking again", async () => {
    await quotes.latest(["M"]);
    clock = TTL - 1;
    expect(await quotes.latest(["M"])).toEqual(new Map([["M", M]]));
    expect(fake.asked).toEqual([["M"]]);
  });

  it("asks again once a price reaches the TTL", async () => {
    await quotes.latest(["M"]);
    const later = { price: 23.1, at: M.at + 60_000 };
    fake.state.prices.set("M", later);
    clock = TTL;
    expect(await quotes.latest(["M"])).toEqual(new Map([["M", later]]));
    expect(fake.asked).toEqual([["M"], ["M"]]);
  });

  it("asks only for the symbols it has no fresh price for", async () => {
    await quotes.latest(["M"]);
    clock = 1;
    expect(await quotes.latest(["M", "ENVX"])).toEqual(
      new Map([
        ["M", M],
        ["ENVX", ENVX],
      ]),
    );
    expect(fake.asked).toEqual([["M"], ["ENVX"]]);
  });

  it("remembers for the TTL that a symbol has no price", async () => {
    expect((await quotes.latest(["ZZZZ"])).size).toBe(0);
    clock = 1;
    expect((await quotes.latest(["ZZZZ"])).size).toBe(0);
    expect(fake.asked).toEqual([["ZZZZ"]]);
  });

  it("reports a failed refresh and still returns the prices that are fresh", async () => {
    await quotes.latest(["M"]);
    const outage = new Error("Alpaca answered 500: internal error");
    fake.state.error = outage;
    clock = 1;
    expect(await quotes.latest(["M", "ENVX"])).toEqual(new Map([["M", M]]));
    expect(errors).toEqual([outage]);
  });

  it("drops a price whose refresh failed rather than show it stale", async () => {
    await quotes.latest(["M"]);
    fake.state.error = new Error("Alpaca answered 500: internal error");
    clock = TTL;
    expect((await quotes.latest(["M"])).size).toBe(0);
  });
});
