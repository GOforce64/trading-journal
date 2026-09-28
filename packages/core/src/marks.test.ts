import { describe, expect, it } from "vitest";
import { closeEstimate, type MarkableLeg, nyDate, type OptionQuote, occSymbol } from "./marks.js";

describe("occSymbol", () => {
  it.each([
    [{ underlying: "M", expiry: "2026-10-02", right: "C", strike: 22.5 }, "M261002C00022500"],
    [{ underlying: "M", expiry: "2026-10-02", right: "P", strike: 21 }, "M261002P00021000"],
    [{ underlying: "BB", expiry: "2026-09-25", right: "C", strike: 8.5 }, "BB260925C00008500"],
    [{ underlying: "NVDA", expiry: "2026-10-02", right: "P", strike: 225 }, "NVDA261002P00225000"],
    [{ underlying: "M", expiry: "2026-10-02", right: "C", strike: 7.1 }, "M261002C00007100"],
    [{ underlying: "brk.b", expiry: "2027-01-15", right: "C", strike: 500 }, "BRKB270115C00500000"],
  ])("names %o as %s", (contract, code) => {
    expect(occSymbol(contract)).toBe(code);
  });
});

describe("nyDate", () => {
  it("gives New York's date, not UTC's, late in the evening", () => {
    expect(nyDate(Date.UTC(2026, 8, 26, 3, 30))).toBe("2026-09-25"); // 23:30 EDT
    expect(nyDate(Date.UTC(2026, 8, 26, 4, 30))).toBe("2026-09-26"); // 00:30 EDT
  });

  it("follows standard time in winter", () => {
    expect(nyDate(Date.UTC(2026, 0, 15, 4, 30))).toBe("2026-01-14"); // 23:30 EST
  });
});

const leg = (
  right: "C" | "P",
  strike: number,
  quantity: number,
  openPrice: number,
  closePrice: number | null = null,
): MarkableLeg => ({ right, strike, expiry: "2026-10-02", quantity, multiplier: 100, openPrice, closePrice });

/** The open M fly from the design mockup: 3 lots, body 22.5, wings 20 / 26, $7.80 entry fees. */
const fly = {
  underlying: "M",
  fees: 7.8,
  feesOpen: 7.8,
  feesClose: 0,
  legs: [leg("C", 22.5, -3, 0.52), leg("P", 22.5, -3, 0.41), leg("C", 26, 3, 0.05), leg("P", 20, 3, 0.03)],
};

const AT = Date.UTC(2026, 8, 25, 19, 59, 51);

/** Friday's closing quotes for the fly's contracts; `undefined` removes one. */
function quotes(overrides: Record<string, OptionQuote | undefined> = {}) {
  const all: Record<string, OptionQuote | undefined> = {
    M261002C00022500: { bid: 0.44, ask: 0.58, at: AT },
    M261002P00022500: { bid: 0.31, ask: 0.42, at: AT + 1000 },
    M261002C00026000: { bid: 0.01, ask: 0.06, at: AT - 5000 },
    M261002P00020000: { bid: 0.01, ask: 0.05, at: AT },
    ...overrides,
  };
  return new Map(
    Object.entries(all).filter((entry): entry is [string, OptionQuote] => entry[1] !== undefined),
  );
}

const TODAY = "2026-09-26";

describe("closeEstimate", () => {
  it("buys the shorts back at the ask and sells the longs at the bid", () => {
    expect(closeEstimate(fly, quotes(), TODAY)).toEqual({
      kind: "estimate",
      legs: [
        { index: 0, mark: 0.58, side: "ask", pnl: -18 },
        { index: 1, mark: 0.42, side: "ask", pnl: -3 },
        { index: 2, mark: 0.01, side: "bid", pnl: -12 },
        { index: 3, mark: 0.01, side: "bid", pnl: -6 },
      ],
      grossPnl: -39,
      fees: 7.8,
      netPnl: -46.8,
      quotedAt: AT - 5000,
    });
  });

  it("sells a long with no bid for nothing", () => {
    const estimate = closeEstimate(fly, quotes({ M261002P00020000: { bid: 0, ask: 0.05, at: AT } }), TODAY);
    expect(estimate.kind === "estimate" && estimate.legs[3]).toEqual({
      index: 3,
      mark: 0,
      side: "bid",
      pnl: -9,
    });
  });

  it("gives no estimate when a short leg has no ask", () => {
    const noAsk = quotes({ M261002C00022500: { bid: 0.44, ask: null, at: AT } });
    expect(closeEstimate(fly, noAsk, TODAY)).toEqual({
      kind: "unavailable",
      reason: "no ask for the short call",
    });
  });

  it("gives no estimate when a leg has no quote", () => {
    expect(closeEstimate(fly, quotes({ M261002P00020000: undefined }), TODAY)).toEqual({
      kind: "unavailable",
      reason: "no quote for the long put",
    });
  });

  it("uses the real exit price of a leg already closed, and needs no quote for it", () => {
    const partly = { ...fly, legs: [...fly.legs.slice(0, 3), leg("P", 20, 3, 0.03, 0.02)] };
    const estimate = closeEstimate(partly, quotes({ M261002P00020000: undefined }), TODAY);
    expect(estimate.kind === "estimate" && estimate.legs.map((marked) => marked.index)).toEqual([0, 1, 2]);
    // -18 - 3 - 12 marked, plus 3 x 100 x (0.02 - 0.03) = -3 realised
    expect(estimate.kind === "estimate" && estimate.grossPnl).toBe(-36);
  });

  it("has nothing to estimate once every leg is closed", () => {
    const closed = { ...fly, legs: fly.legs.map((open) => ({ ...open, closePrice: 0.1 })) };
    expect(closeEstimate(closed, quotes(), TODAY)).toEqual({ kind: "closed" });
  });

  it("still marks a trade on its expiry day", () => {
    expect(closeEstimate(fly, quotes(), "2026-10-02").kind).toBe("estimate");
  });

  it("calls a trade expired the day after its expiry, before looking at quotes", () => {
    expect(closeEstimate(fly, new Map(), "2026-10-03")).toEqual({ kind: "expired", expiry: "2026-10-02" });
  });

  it("falls back to the trade's total fees when the open/close split is unknown", () => {
    const imported = { ...fly, fees: 5, feesOpen: null, feesClose: null };
    const estimate = closeEstimate(imported, quotes(), TODAY);
    expect(estimate.kind === "estimate" && [estimate.fees, estimate.netPnl]).toEqual([5, -44]);
  });
});
