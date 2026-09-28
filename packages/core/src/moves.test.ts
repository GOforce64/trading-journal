import { describe, expect, it } from "vitest";
import { type MoveFly, type MoveTrade, tradeMoves } from "./moves.js";
import { impliedVol, yearsToExpiry } from "./pricing.js";

const NO_TYPED: MoveFly = {
  underlyingPriceEntry: null,
  underlyingPriceExit: null,
  impliedMovePct: null,
  actualMovePct: null,
  ivBefore: null,
  ivAfter: null,
};

/** The M fly from the real journal (spec §3): 5 lots, body 21.5, wings 18 / 27, stock $21.66 → $20.505. */
const M: MoveTrade = {
  openedAt: Date.UTC(2026, 8, 9, 19, 54), // Wed Sep 9, 15:54 ET
  closedAt: Date.UTC(2026, 8, 10, 19, 44), // Thu Sep 10, 15:44 ET
  legs: [
    { right: "C", strike: 21.5, expiry: "2026-09-11", quantity: -5, openPrice: 0.88, closePrice: 0.05 },
    { right: "P", strike: 21.5, expiry: "2026-09-11", quantity: -5, openPrice: 0.7, closePrice: 1.03 },
    { right: "C", strike: 27, expiry: "2026-09-11", quantity: 5, openPrice: 0.01, closePrice: 0 },
    { right: "P", strike: 18, expiry: "2026-09-11", quantity: 5, openPrice: 0.02, closePrice: 0 },
  ],
  ironFly: { ...NO_TYPED, underlyingPriceEntry: 21.66, underlyingPriceExit: 20.505 },
};

const withFly = (trade: MoveTrade, fly: Partial<MoveFly>): MoveTrade => ({
  ...trade,
  ironFly: { ...(trade.ironFly ?? NO_TYPED), ...fly },
});

describe("tradeMoves", () => {
  it("works out M's moves from its fills and the two stock prices", () => {
    const moves = tradeMoves(M);
    expect(moves.stockAtEntry).toBe(21.66);
    expect(moves.stockAtExit).toBe(20.505);
    expect(moves.impliedMove?.source).toBe("computed");
    expect(moves.impliedMove?.value).toBeCloseTo(0.0729455, 6); // straddle 1.58 ÷ 21.66
    expect(moves.actualMove?.value).toBeCloseTo(-0.0533241, 6);
    expect(moves.moveRatio).toBeCloseTo(0.7310127, 6);
    expect(moves.ivBefore?.value).toBeCloseTo(1.2346, 3); // 123%
    expect(moves.ivAfter?.value).toBeCloseTo(0.765, 3); // 77%
    expect(moves.ivBeforeBlank).toBeNull();
    expect(moves.ivAfterBlank).toBeNull();
  });

  it("solves IV after from the out-of-the-money short only", () => {
    // At $20.505 the 21.5 call is out of the money and the 21.5 put is in it.
    const callAlone = impliedVol({
      right: "C",
      price: 0.05,
      S: 20.505,
      K: 21.5,
      T: yearsToExpiry(M.closedAt ?? 0, "2026-09-11"),
    });
    expect(tradeMoves(M).ivAfter?.value).toBeCloseTo(callAlone ?? 0, 12);
  });

  it("averages both shorts when both are out of the money", () => {
    const strangle: MoveTrade = {
      ...withFly(M, { underlyingPriceExit: 21 }),
      legs: [
        { right: "C", strike: 22, expiry: "2026-09-11", quantity: -5, openPrice: 0.6, closePrice: 0.1 },
        { right: "P", strike: 20, expiry: "2026-09-11", quantity: -5, openPrice: 0.5, closePrice: 0.08 },
      ],
    };
    const T = yearsToExpiry(M.closedAt ?? 0, "2026-09-11");
    const call = impliedVol({ right: "C", price: 0.1, S: 21, K: 22, T }) ?? 0;
    const put = impliedVol({ right: "P", price: 0.08, S: 21, K: 20, T }) ?? 0;
    expect(tradeMoves(strangle).ivAfter?.value).toBeCloseTo((call + put) / 2, 12);
  });

  it("falls back to both shorts when neither is out of the money", () => {
    const inverted: MoveTrade = {
      ...withFly(M, { underlyingPriceExit: 21 }),
      legs: [
        { right: "C", strike: 20, expiry: "2026-09-11", quantity: -5, openPrice: 1.6, closePrice: 1.2 },
        { right: "P", strike: 22, expiry: "2026-09-11", quantity: -5, openPrice: 1.5, closePrice: 1.15 },
      ],
    };
    const T = yearsToExpiry(M.closedAt ?? 0, "2026-09-11");
    const call = impliedVol({ right: "C", price: 1.2, S: 21, K: 20, T }) ?? 0;
    const put = impliedVol({ right: "P", price: 1.15, S: 21, K: 22, T }) ?? 0;
    expect(tradeMoves(inverted).ivAfter?.value).toBeCloseTo((call + put) / 2, 12);
  });

  it("leaves IV after blank within 24 h of expiry", () => {
    const expiryMorning = { ...M, closedAt: Date.UTC(2026, 8, 11, 14, 0) }; // Sep 11, 10:00 ET
    const moves = tradeMoves(expiryMorning);
    expect(moves.ivAfter).toBeNull();
    expect(moves.ivAfterBlank).toBe("near_expiry");
    expect(moves.ivBefore).not.toBeNull();
  });

  it("says when IV can't be solved", () => {
    const cheap: MoveTrade = {
      ...M,
      legs: M.legs.map((leg) => (leg.quantity < 0 ? { ...leg, openPrice: 0.001 } : leg)),
    };
    const moves = tradeMoves(cheap);
    expect(moves.ivBefore).toBeNull();
    expect(moves.ivBeforeBlank).toBe("unsolvable");
  });

  it("lets a typed value win, and keeps the computed one beside it", () => {
    const moves = tradeMoves(withFly(M, { impliedMovePct: 7.1, ivBefore: 120 }));
    expect(moves.impliedMove?.value).toBeCloseTo(0.071, 12);
    expect(moves.impliedMove?.source).toBe("override");
    expect(moves.impliedMove?.computed).toBeCloseTo(0.0729455, 6);
    expect(moves.moveRatio).toBeCloseTo(0.0533241 / 0.071, 5);
    expect(moves.ivBefore).toEqual({ value: 1.2, source: "override", computed: expect.any(Number) });
    expect(moves.actualMove?.source).toBe("computed");
  });

  it("uses typed moves alone when there are no stock prices", () => {
    const typed = withFly(M, {
      underlyingPriceEntry: null,
      underlyingPriceExit: null,
      impliedMovePct: 8,
      actualMovePct: -4.2,
    });
    const moves = tradeMoves(typed);
    expect(moves.impliedMove).toEqual({ value: 0.08, source: "override", computed: null });
    expect(moves.actualMove?.value).toBeCloseTo(-0.042, 12);
    expect(moves.actualMove).toMatchObject({ source: "override", computed: null });
    expect(moves.moveRatio).toBeCloseTo(0.525, 12);
    expect(moves.ivBefore).toBeNull();
    expect(moves.ivBeforeBlank).toBeNull();
  });

  it("computes nothing without exactly one short call and one short put, but still shows typed moves", () => {
    const twoCalls: MoveTrade = {
      ...withFly(M, { impliedMovePct: 6 }),
      legs: M.legs.map((leg) => ({ ...leg, right: "C" })),
    };
    const moves = tradeMoves(twoCalls);
    expect(moves.impliedMove).toEqual({ value: 0.06, source: "override", computed: null });
    expect(moves.ivBefore).toBeNull();
    expect(moves.actualMove?.source).toBe("computed"); // the stock moved all the same
  });

  it("shows an open trade's entry side only", () => {
    const open: MoveTrade = {
      ...withFly(M, { underlyingPriceExit: null }),
      closedAt: null,
      legs: M.legs.map((leg) => ({ ...leg, closePrice: null })),
    };
    const moves = tradeMoves(open);
    expect(moves.impliedMove?.value).toBeCloseTo(0.0729455, 6);
    expect(moves.ivBefore?.value).toBeCloseTo(1.2346, 3);
    expect(moves.actualMove).toBeNull();
    expect(moves.ivAfter).toBeNull();
    expect(moves.ivAfterBlank).toBeNull();
  });

  it("has nothing for a trade without fly details", () => {
    expect(tradeMoves({ ...M, ironFly: null })).toEqual({
      stockAtEntry: null,
      stockAtExit: null,
      impliedMove: null,
      actualMove: null,
      moveRatio: null,
      ivBefore: null,
      ivAfter: null,
      ivBeforeBlank: null,
      ivAfterBlank: null,
    });
  });
});
