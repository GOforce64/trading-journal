import { describe, expect, it } from "vitest";
import {
  ivCrushHistogram,
  type MoveFly,
  type MoveRow,
  type MoveTrade,
  movePoints,
  moveRatioBuckets,
  tradeMoves,
} from "./moves.js";
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

/** A closed fly with typed moves only: no stock prices, as for a ticker Alpaca can't price. */
function typedRow(id: string, netPnl: number, typed: Partial<MoveFly>): MoveRow {
  return {
    id,
    underlying: id.toUpperCase(),
    netPnl,
    openedAt: Date.UTC(2026, 8, 1, 19, 50),
    closedAt: Date.UTC(2026, 8, 2, 19, 40),
    legs: [],
    ironFly: { ...NO_TYPED, ...typed },
  };
}

const mRow: MoveRow = { ...M, id: "m", underlying: "M", netPnl: 224.06 };

describe("movePoints", () => {
  it("has a point for each fly with both moves, whether computed or typed", () => {
    const points = movePoints([
      typedRow("a", 120, { impliedMovePct: 8, actualMovePct: -4 }),
      typedRow("b", -50, { impliedMovePct: 8 }),
      mRow,
    ]);
    expect(points.map((point) => point.id)).toEqual(["a", "m"]);
    expect(points[0]).toEqual({ id: "a", ticker: "A", implied: 0.08, absActual: 0.04, netPnl: 120 });
    expect(points[1]?.implied).toBeCloseTo(0.0729455, 6);
    expect(points[1]?.absActual).toBeCloseTo(0.0533241, 6);
  });
});

describe("moveRatioBuckets", () => {
  const flies = [
    typedRow("a", 100, { impliedMovePct: 10, actualMovePct: 4 }), // 0.4×
    typedRow("b", 50, { impliedMovePct: 10, actualMovePct: -5 }), // 0.5×, on the edge
    typedRow("c", -80, { impliedMovePct: 10, actualMovePct: 10 }), // 1×, on the edge
    typedRow("d", -200, { impliedMovePct: 10, actualMovePct: -15 }), // 1.5×, on the edge
    typedRow("e", 30, { impliedMovePct: 10 }), // no ratio
  ];

  it("puts each ratio in the bucket its lower edge starts", () => {
    const summary = moveRatioBuckets(flies);
    expect(summary.buckets.map((bucket) => [bucket.label, bucket.trades, bucket.won, bucket.net])).toEqual([
      ["< 0.5×", 1, 1, 100],
      ["0.5–1×", 1, 1, 50],
      ["1–1.5×", 1, 0, -80],
      ["1.5×+", 1, 0, -200],
    ]);
  });

  it("isn't fooled by float noise: 15% against 10% is 1.5×, not 1.4999999999999998", () => {
    const [bucket] = moveRatioBuckets([
      typedRow("d", -200, { impliedMovePct: 10, actualMovePct: 15 }),
    ]).buckets.filter((each) => each.trades > 0);
    expect(bucket?.label).toBe("1.5×+");
  });

  it("counts the flies with and without a ratio, and the ones that moved at least as much as priced", () => {
    const summary = moveRatioBuckets(flies);
    expect(summary.withRatio).toBe(4);
    expect(summary.without).toBe(1);
    expect(summary.beyondImplied).toEqual({ trades: 2, won: 0, net: -280 });
  });

  it("counts a fly Alpaca couldn't price, from its typed moves, next to computed ones", () => {
    const summary = moveRatioBuckets([mRow, typedRow("x", -90, { impliedMovePct: 6, actualMovePct: 12 })]);
    expect(summary.buckets.map((bucket) => bucket.trades)).toEqual([0, 1, 0, 1]);
  });
});

describe("ivCrushHistogram", () => {
  const flies = [
    typedRow("a", 1, { ivBefore: 120, ivAfter: 60 }), // 60 points
    typedRow("b", 1, { ivBefore: 100, ivAfter: 75 }), // 25, on the edge
    typedRow("c", 1, { ivBefore: 80, ivAfter: 70 }), // 10
    typedRow("d", 1, { ivBefore: 50, ivAfter: 100 }), // −50, on the edge: IV rose
    typedRow("e", 1, { ivBefore: 90 }), // no IV after
  ];

  it("bins IV before − after in points, each bin starting at its lower edge", () => {
    const { bins, count } = ivCrushHistogram(flies);
    expect(bins.map((bin) => [bin.label, bin.tradeIds])).toEqual([
      ["< −50", []],
      ["−50…−25", ["d"]],
      ["−25…0", []],
      ["0…25", ["c"]],
      ["25…50", ["b"]],
      ["50+", ["a"]],
    ]);
    expect(count).toBe(4);
  });

  it("gives the median crush for an even and an odd count, and none without data", () => {
    expect(ivCrushHistogram(flies).median).toBeCloseTo(17.5, 9); // (10 + 25) / 2
    expect(ivCrushHistogram(flies.slice(0, 3)).median).toBeCloseTo(25, 9);
    expect(ivCrushHistogram([typedRow("e", 1, { ivBefore: 90 })])).toMatchObject({ median: null, count: 0 });
  });

  it("isn't fooled by float noise: typed 57% → 32% is a crush of exactly 25, in 25…50", () => {
    const { bins } = ivCrushHistogram([typedRow("f", 1, { ivBefore: 57, ivAfter: 32 })]);
    expect(bins.find((bin) => bin.tradeIds.includes("f"))?.label).toBe("25…50");
  });

  it("takes M's crush from its own fills", () => {
    const { bins } = ivCrushHistogram([mRow]);
    expect(bins.find((bin) => bin.tradeIds.includes("m"))?.label).toBe("25…50"); // 123% → 77%
  });
});
