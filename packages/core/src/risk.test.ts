import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expiryMoment, nyWallClock } from "./calendar.js";
import { round2 } from "./money.js";
import { bsPrice } from "./pricing.js";
import {
  contractsHeld,
  holdRange,
  type RiskTrade,
  returnOnCost,
  scalpRisk,
  sortTargets,
  stockAt,
  trimProblem,
} from "./risk.js";

/** A minute bar of Mon Sep 28, by its minute of the New York day. */
const bar = (minute: number, o: number, h: number, l: number, c: number) => ({
  t: nyWallClock("2026-09-28", minute),
  o,
  h,
  l,
  c,
  v: 100,
});
const OPENED = nyWallClock("2026-09-28", 571) + 5_000; // 09:31:05 ET
const CLOSED = nyWallClock("2026-09-28", 586) + 12_000; // 09:46:12 ET
const ENTRY_BAR = bar(571, 230.78, 232.11, 230.71, 231.355);
/** The 09:31 bar's open, moved 5 seconds' worth towards its close: 230.8279. */
const STOCK = 230.78 + (231.355 - 230.78) * (5 / 60);

type Levels = NonNullable<RiskTrade["scalp"]>;

/** The Sep 28 NVDA 232.5C scalp (spec §1): 2 contracts, 1.06 → 1.295, +$44.74, stop 229, T1 233 ×1, T2 234.50 ×1. */
function nvda(trade: Partial<RiskTrade> = {}, levels: Partial<Levels> = {}): RiskTrade {
  return {
    strategy: "scalp",
    openedAt: OPENED,
    closedAt: CLOSED,
    netPnl: 44.74,
    legs: [
      { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06 },
    ],
    scalp: {
      levelBasis: "stock",
      stopPrice: 229,
      stockEntryOverride: null,
      riskOverride: null,
      targets: [
        { price: 233, contracts: 1 },
        { price: 234.5, contracts: 1 },
      ],
      ...levels,
    },
    scalpPrices: { entryPrice: STOCK, holdHigh: 233.21, holdLow: 230.71 },
    ...trade,
  };
}

const leg = (overrides: Partial<RiskTrade["legs"][number]> = {}) => ({
  right: "C",
  strike: 232.5,
  expiry: "2026-09-28",
  quantity: 2,
  multiplier: 100,
  openPrice: 1.06,
  ...overrides,
});

describe("stockAt", () => {
  it("moves from the minute's open towards its close by the seconds gone", () => {
    expect(stockAt(ENTRY_BAR, OPENED)).toBeCloseTo(230.828, 3);
  });

  it("gives the open for a time on the minute, as a typed-in scalp has", () => {
    expect(stockAt(ENTRY_BAR, ENTRY_BAR.t)).toBe(230.78);
  });
});

describe("holdRange", () => {
  const BARS = [
    bar(570, 230, 240, 200, 230.5),
    ENTRY_BAR,
    bar(580, 232.5, 233.21, 232.4, 233),
    bar(586, 232.6, 232.9, 232.2, 232.3),
    bar(587, 232.3, 245, 210, 232),
  ];

  it("spans the entry minute through the exit minute, and nothing either side", () => {
    expect(holdRange(BARS, OPENED, CLOSED)).toEqual({ high: 233.21, low: 230.71 });
  });

  it("waits until the bars reach the exit minute", () => {
    expect(holdRange(BARS.slice(0, 3), OPENED, CLOSED)).toBeNull();
  });

  it("takes an exit minute without trades once a later bar shows it has passed", () => {
    expect(holdRange([ENTRY_BAR, bar(590, 232, 232.5, 231.9, 232)], OPENED, CLOSED)).toEqual({
      high: 232.11,
      low: 230.71,
    });
  });
});

describe("sortTargets, contractsHeld and trimProblem", () => {
  const targets = [{ price: 234.5 }, { price: 233 }, { price: 236 }];

  it("orders a call's stock targets rising, a put's falling, and premiums rising", () => {
    const prices = (sorted: { price: number }[]) => sorted.map((target) => target.price);
    expect(prices(sortTargets(targets, "stock", "C"))).toEqual([233, 234.5, 236]);
    expect(prices(sortTargets(targets, "stock", "P"))).toEqual([236, 234.5, 233]);
    expect(prices(sortTargets(targets, "premium", "P"))).toEqual([233, 234.5, 236]);
    expect(prices(sortTargets(targets, "stock", null))).toEqual([233, 234.5, 236]);
  });

  it("counts the contracts held and refuses a list that trims more", () => {
    expect(contractsHeld([{ quantity: 2 }])).toBe(2);
    expect(contractsHeld([{ quantity: -1 }, { quantity: 1 }])).toBe(2);
    expect(trimProblem([{ contracts: 1 }, { contracts: 1 }], 2)).toBeNull();
    expect(trimProblem([{ contracts: 2 }, { contracts: 1 }], 2)).toBe(
      "The targets trim 3 contracts; the position has 2.",
    );
    expect(trimProblem([{ contracts: 1 }], 0)).toBe("The targets trim 1 contract; the position has 0.");
  });
});

describe("scalpRisk", () => {
  it("prices the Sep 28 NVDA scalp as the spec works it out", () => {
    const risk = scalpRisk(nvda());
    expect(risk).toMatchObject({
      basis: "stock",
      problem: null,
      right: "C",
      entryPremium: 1.06,
      stop: 229,
      stockAtEntry: { price: STOCK, typed: false },
      estimated: false,
      plannedRisk: 104.05,
      riskTyped: false,
      plannedReward: 288.61,
      runner: null,
    });
    expect(risk?.iv).toBeCloseTo(0.7038, 4);
    expect(risk?.minutesToExpiry).toBeCloseTo(388.92, 2);
    expect(risk?.optionAtStop).toBeCloseTo(0.54, 3);
    expect(risk?.targets).toEqual([
      { price: 233, contracts: 1, optionAt: expect.closeTo(2.04, 2), wrongSide: false },
      { price: 234.5, contracts: 1, optionAt: expect.closeTo(2.96, 2), wrongSide: false },
    ]);
    expect(risk?.r).toBeCloseTo(0.43, 3);
    expect(risk?.rewardRisk).toBeCloseTo(2.77, 2);
    expect(risk?.mae).toEqual({ stock: 0.12, r: expect.closeTo(0.0645, 4) });
    expect(risk?.mfe).toEqual({ stock: 2.38, r: expect.closeTo(1.3032, 4) });
  });

  it("counts contracts no target trims as a runner at the last target", () => {
    const risk = scalpRisk(nvda({ legs: [leg({ quantity: 3 })] }));
    expect(risk).toMatchObject({
      plannedRisk: 156.08,
      plannedReward: 478.97,
      runner: { contracts: 1, atTarget: 2 },
    });
    expect(risk?.rewardRisk).toBeCloseTo(3.07, 2);
  });

  it("puts the runner at the farthest target whatever the list's order, as while a line is dragged", () => {
    const risk = scalpRisk(
      nvda(
        { legs: [leg({ quantity: 3 })] },
        {
          targets: [
            { price: 234.5, contracts: 1 },
            { price: 233, contracts: 1 },
          ],
        },
      ),
    );
    expect(risk).toMatchObject({ plannedReward: 478.97, runner: { contracts: 1, atTarget: 1 } });
  });

  it("rewards only the contracts held, nearest target first, when a size edit left the targets trimming more", () => {
    // 2 held; T1 233 ×1 and T2 234.50 ×2 trim 3, so T2 gets the 1 left: the worked example's reward.
    const over = scalpRisk(
      nvda(
        {},
        {
          targets: [
            { price: 234.5, contracts: 2 },
            { price: 233, contracts: 1 },
          ],
        },
      ),
    );
    expect(over).toMatchObject({ plannedReward: 288.61, runner: null });
    // 1 held; T1 233 ×2 counts once.
    const one = scalpRisk(
      nvda({ legs: [leg({ quantity: 1 })] }, { targets: [{ price: 233, contracts: 2 }] }),
    );
    const atT1 = one?.targets[0]?.optionAt ?? Number.NaN;
    expect(one).toMatchObject({ plannedReward: round2((atT1 - 1.06) * 100), runner: null });
  });

  it("flags a target on the wrong side and leaves it out of the reward", () => {
    const risk = scalpRisk(
      nvda(
        {},
        {
          targets: [
            { price: 230, contracts: 1 },
            { price: 234.5, contracts: 1 },
          ],
        },
      ),
    );
    expect(risk?.targets.map((target) => target.wrongSide)).toEqual([true, false]);
    expect(risk?.plannedReward).toBe(190.36);
    // With a runner, it counts at the last target that isn't on the wrong side.
    const runner = scalpRisk(
      nvda(
        { legs: [leg({ quantity: 3 })] },
        {
          targets: [
            { price: 234.5, contracts: 1 },
            { price: 230, contracts: 1 },
          ],
        },
      ),
    );
    expect(runner).toMatchObject({ plannedReward: 380.71, runner: { contracts: 1, atTarget: 1 } });
  });

  it("prices levels on the premium basis as the option's own price, with no model", () => {
    const risk = scalpRisk(
      nvda({}, { levelBasis: "premium", stopPrice: 0.6, targets: [{ price: 1.6, contracts: 2 }] }),
    );
    expect(risk).toMatchObject({
      basis: "premium",
      problem: null,
      iv: null,
      estimated: false,
      optionAtStop: 0.6,
      plannedRisk: 92,
      plannedReward: 108,
      mae: { stock: 0.12, r: null },
      mfe: { stock: 2.38, r: null },
    });
    expect(risk?.rewardRisk).toBeCloseTo(1.174, 3);
    expect(scalpRisk(nvda({}, { levelBasis: "premium", stopPrice: 1.06 }))?.problem).toBe("wrong_side");
  });

  it("estimates without IV when the premium is at intrinsic value, labelled", () => {
    // A typed stock of 233.56 puts the 232.5 call 1.06 in the money: nothing is left to solve for.
    const risk = scalpRisk(
      nvda({}, { stockEntryOverride: 233.56, stopPrice: 233, targets: [{ price: 234, contracts: 2 }] }),
    );
    expect(risk).toMatchObject({
      problem: null,
      stockAtEntry: { price: 233.56, typed: true },
      iv: null,
      estimated: true,
      optionAtStop: 0.5,
      plannedRisk: 112,
      plannedReward: 88,
    });
  });

  it("can't price an out-of-the-money option with no time left, until a planned risk is typed", () => {
    const late = { openedAt: nyWallClock("2026-09-28", 16 * 60 + 5) };
    expect(scalpRisk(nvda(late))).toMatchObject({
      problem: "cannot_price",
      estimated: true,
      minutesToExpiry: 0,
      plannedRisk: null,
      r: null,
    });
    const typed = scalpRisk(nvda(late, { riskOverride: 120 }));
    expect(typed).toMatchObject({ problem: null, plannedRisk: 120, riskTyped: true });
    expect(typed?.r).toBeCloseTo(0.3728, 4);
  });

  it("finds a stop on the wrong side: above a call's entry, at it, or below a put's", () => {
    const above = scalpRisk(nvda({}, { stopPrice: 231.5 }));
    expect(above).toMatchObject({ problem: "wrong_side", plannedRisk: null, r: null, rewardRisk: null });
    expect(above?.mae).toEqual({ stock: 0.12, r: null });
    expect(scalpRisk(nvda({}, { stockEntryOverride: 230, stopPrice: 230 }))?.problem).toBe("wrong_side");
    const put = nvda({ legs: [leg({ right: "P", strike: 229 })] }, { stopPrice: 230, targets: [] });
    expect(scalpRisk(put)?.problem).toBe("wrong_side");
  });

  it("measures a put's MAE on the stock's high and its MFE on the low", () => {
    const risk = scalpRisk(
      nvda({ legs: [leg({ right: "P", strike: 229 })] }, { stopPrice: 232, targets: [] }),
    );
    expect(risk?.problem).toBeNull();
    expect(risk?.mae).toEqual({ stock: 2.38, r: expect.closeTo(2.032, 3) });
    expect(risk?.mfe).toEqual({ stock: 0.12, r: expect.closeTo(0.1006, 4) });
  });

  it("uses both typed overrides", () => {
    const risk = scalpRisk(nvda({}, { stockEntryOverride: 231, riskOverride: 150 }));
    expect(risk).toMatchObject({
      stockAtEntry: { price: 231, typed: true },
      plannedRisk: 150,
      riskTyped: true,
    });
    expect(risk?.iv).not.toBeCloseTo(0.7038, 3);
    expect(risk?.r).toBeCloseTo(0.2983, 4);
  });

  it("gives an open scalp its risk and R:R, but no R, MAE or MFE yet", () => {
    const risk = scalpRisk(nvda({ closedAt: null, netPnl: null }));
    expect(risk).toMatchObject({ plannedRisk: 104.05, r: null, mae: null, mfe: null });
    expect(risk?.rewardRisk).toBeCloseTo(2.77, 2);
  });

  it("says what's missing: a stop, or the stock price", () => {
    const noStop = scalpRisk(nvda({}, { stopPrice: null }));
    expect(noStop).toMatchObject({ problem: "no_stop", plannedRisk: null });
    expect(noStop?.iv).toBeCloseTo(0.7038, 4);
    expect(scalpRisk(nvda({}, { stopPrice: null, riskOverride: 120 }))).toMatchObject({
      problem: null,
      plannedRisk: 120,
    });
    expect(scalpRisk(nvda({ scalpPrices: null }))).toMatchObject({
      problem: "no_stock_price",
      stockAtEntry: null,
      iv: null,
      estimated: false,
      plannedReward: null,
      mae: null,
    });
    expect(scalpRisk(nvda({ scalp: null }))).toMatchObject({
      basis: "stock",
      problem: "no_stop",
      stop: null,
    });
  });

  it("needs a single long option", () => {
    for (const legs of [[], [leg(), leg()], [leg({ quantity: -2 })]]) {
      expect(scalpRisk(nvda({ legs }))).toMatchObject({
        problem: "not_single_long",
        plannedRisk: null,
        minutesToExpiry: null,
        r: null,
      });
    }
  });

  it("prices the levels where the page has them while a line is dragged", () => {
    const risk = scalpRisk(nvda(), { stop: 228, targets: [{ price: 234.5, contracts: 2 }] });
    expect(risk?.optionAtStop).toBeCloseTo(0.354, 3);
    expect(risk).toMatchObject({ plannedRisk: 141.22, plannedReward: 380.71 });
    expect(scalpRisk(nvda({ scalp: null }), { basis: "premium", stop: 0.5 })).toMatchObject({
      basis: "premium",
      plannedRisk: 112,
    });
  });

  it("is null for a trade that isn't a scalp", () => {
    expect(scalpRisk(nvda({ strategy: "iron_fly" }))).toBeNull();
  });

  it("never lowers the planned risk as a stock stop moves further from the entry (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("C", "P"),
        fc.double({ min: 20, max: 500, noNaN: true }),
        fc.double({ min: 0.9, max: 1.1, noNaN: true }),
        fc.integer({ min: 30, max: 60 * 24 * 30 }),
        fc.double({ min: 0.1, max: 2, noNaN: true }),
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),
        (right, S, moneyness, minutes, sigma, near, further) => {
          const expiry = "2026-10-30";
          const K = round2(S * moneyness);
          const premium = Math.max(0.01, round2(bsPrice(right, S, K, minutes / (365 * 1_440), sigma)));
          // A call loses as the stock falls, a put as it rises.
          const away = right === "C" ? -1 : 1;
          const riskAt = (distance: number) =>
            scalpRisk({
              strategy: "scalp",
              openedAt: expiryMoment(expiry) - minutes * 60_000,
              closedAt: null,
              netPnl: null,
              legs: [{ right, strike: K, expiry, quantity: 1, multiplier: 100, openPrice: premium }],
              scalp: {
                levelBasis: "stock",
                stopPrice: S + away * S * distance,
                stockEntryOverride: null,
                riskOverride: null,
                targets: [],
              },
              scalpPrices: { entryPrice: S, holdHigh: null, holdLow: null },
            })?.plannedRisk ?? null;
          const closer = riskAt(near);
          if (closer == null) return true;
          const farther = riskAt(near + further);
          return farther != null && farther >= closer;
        },
      ),
    );
  });
});

describe("returnOnCost", () => {
  it("is a scalp's net P&L over the premium paid", () => {
    // +$44.74 on 2 × 100 × 1.06 = $212 paid.
    expect(returnOnCost(nvda())).toBeCloseTo(0.211, 4);
    expect(returnOnCost(nvda({ netPnl: -212 }))).toBe(-1);
  });

  it("is null for an open trade, a fly, and anything but a single long option", () => {
    expect(returnOnCost(nvda({ closedAt: null, netPnl: null }))).toBeNull();
    expect(returnOnCost(nvda({ strategy: "iron_fly" }))).toBeNull();
    expect(returnOnCost(nvda({ legs: [leg(), leg({ right: "P" })] }))).toBeNull();
    expect(returnOnCost(nvda({ legs: [leg({ quantity: -2 })] }))).toBeNull();
    expect(returnOnCost(nvda({ legs: [leg({ openPrice: 0 })] }))).toBeNull();
  });
});
