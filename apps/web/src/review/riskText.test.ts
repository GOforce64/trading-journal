import { nyWallClock, type RiskTrade, scalpRisk } from "@tj/core";
import { describe, expect, it } from "vitest";
import { liveLine, modelNote, problemText, riskTileText } from "./riskText.js";

const OPENED = nyWallClock("2026-09-28", 571) + 5_000; // 09:31:05 ET
const CLOSED = nyWallClock("2026-09-28", 586) + 12_000;
const STOCK = 230.78 + (231.355 - 230.78) * (5 / 60);
const CALL = {
  right: "C",
  strike: 232.5,
  expiry: "2026-09-28",
  quantity: 2,
  multiplier: 100,
  openPrice: 1.06,
};
const PUT = { ...CALL, right: "P", strike: 229 };

type Levels = NonNullable<RiskTrade["scalp"]>;

/** The Sep 28 NVDA scalp (scalp-R spec §1) and its risk. */
function nvda(trade: Partial<RiskTrade> = {}, levels: Partial<Levels> = {}) {
  const input: RiskTrade = {
    strategy: "scalp",
    openedAt: OPENED,
    closedAt: CLOSED,
    netPnl: 44.74,
    legs: [CALL],
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
  const risk = scalpRisk(input);
  if (!risk) throw new Error("not a scalp");
  return { trade: input, risk };
}

const tiles = (trade: Partial<RiskTrade> = {}, levels: Partial<Levels> = {}) => {
  const { trade: input, risk } = nvda(trade, levels);
  return riskTileText(risk, input);
};

describe("riskTileText", () => {
  it("says what the spec's worked example shows", () => {
    expect(tiles()).toEqual({
      risk: { value: "$104.05", working: "option 1.06 → 0.54 at the stop" },
      r: { value: "+0.43R", working: "+$44.74 ÷ $104.05" },
      rewardRisk: { value: "2.8", working: "reward $288.61 over 2 targets" },
      mae: { value: "−0.12", working: "−0.06R · stock low 230.71" },
      mfe: { value: "+2.38", working: "+1.30R · stock high 233.21" },
      model: { value: "IV 70.4%", working: "stock 230.83 · 6 h 29 min left" },
    });
  });

  it("names a runner, and says open for an open scalp", () => {
    expect(tiles({ legs: [{ ...CALL, quantity: 3 }] }).rewardRisk).toEqual({
      value: "3.1",
      working: "reward $478.97 over 2 targets · 1 runner at T2",
    });
    const open = tiles({ closedAt: null, netPnl: null });
    expect(open.r).toEqual({ value: "open", working: "" });
    expect(open.mae).toEqual({ value: "—", working: "open" });
  });

  it("says what's typed, and what's estimated without IV", () => {
    expect(tiles({}, { riskOverride: 120 }).risk).toEqual({ value: "$120.00", working: "typed" });
    expect(tiles({}, { stockEntryOverride: 231 }).model.working).toBe("stock 231.00 typed · 6 h 29 min left");
    const estimated = tiles(
      {},
      { stockEntryOverride: 233.56, stopPrice: 233, targets: [{ price: 234, contracts: 2 }] },
    );
    expect(estimated.risk.working).toBe("option 1.06 → 0.50 at the stop · estimated without IV");
    expect(estimated.model.value).toBe("no IV");
  });

  it("measures a put against the stock's high, and reads — without a stock price", () => {
    const put = tiles({ legs: [PUT] }, { stopPrice: 232, targets: [] });
    expect(put.mae).toEqual({ value: "−2.38", working: "−2.03R · stock high 233.21" });
    expect(put.mfe).toEqual({ value: "+0.12", working: "+0.10R · stock low 230.71" });
    const none = tiles({ scalpPrices: null });
    expect(none.risk).toEqual({ value: "—", working: "" });
    expect(none.model).toEqual({ value: "—", working: "no stock price · 6 h 29 min left" });
    expect(tiles({}, { levelBasis: "premium", stopPrice: 0.6, targets: [] }).model.value).toBe("no IV");
  });
});

describe("modelNote", () => {
  it("explains the reprice on the stock basis, and says nothing for a typed risk or on premium", () => {
    expect(modelNote(nvda().risk)).toBe(
      "Black-Scholes, the stock jumping straight to the stop. For 0DTE, time decay makes the real loss at the stop somewhat larger.",
    );
    expect(modelNote(nvda({}, { stockEntryOverride: 233.56, stopPrice: 233, targets: [] }).risk)).toBe(
      "Estimated without IV: the option at the stop is its intrinsic value there plus the time value paid at entry.",
    );
    expect(modelNote(nvda({}, { riskOverride: 120 }).risk)).toBeNull();
    expect(modelNote(nvda({}, { levelBasis: "premium", stopPrice: 0.6, targets: [] }).risk)).toBeNull();
  });
});

describe("problemText", () => {
  const note = "Fetching the stock price…";
  const reason = (trade: Partial<RiskTrade> = {}, levels: Partial<Levels> = {}) =>
    problemText(nvda(trade, levels).risk, note);

  it("says why there's no planned risk", () => {
    expect(reason({}, { stopPrice: null })).toBe("Set a stop in the review strip to get R.");
    expect(reason({ scalpPrices: null })).toBe(note);
    expect(reason({}, { stopPrice: 231.5 })).toBe(
      "The stop is above the stock at entry (230.83), so this call can't lose there.",
    );
    expect(reason({}, { stockEntryOverride: 230, stopPrice: 230 })).toBe(
      "The stop is at the stock at entry (230.00), so this call can't lose there.",
    );
    expect(reason({ legs: [PUT] }, { stopPrice: 230, targets: [] })).toBe(
      "The stop is below the stock at entry (230.83), so this put can't lose there.",
    );
    expect(reason({}, { levelBasis: "premium", stopPrice: 1.06, targets: [] })).toBe(
      "The stop is at or above the entry premium (1.06), so it can't lose there.",
    );
    expect(reason({ openedAt: nyWallClock("2026-09-28", 16 * 60 + 5) })).toBe(
      "The model can't price this option: type the planned risk.",
    );
    expect(reason({ legs: [] })).toBe("R needs a single long option.");
  });
});

describe("liveLine", () => {
  it("reads risk, R and R:R, or null without a planned risk", () => {
    expect(liveLine(nvda().risk, false)).toBe("Risk $104.05 · R +0.43 · R:R 2.8");
    expect(liveLine(nvda({ closedAt: null, netPnl: null }).risk, true)).toBe(
      "Risk $104.05 · R open · R:R 2.8",
    );
    expect(liveLine(nvda({}, { targets: [] }).risk, false)).toBe("Risk $104.05 · R +0.43 · R:R —");
    expect(liveLine(nvda({}, { stopPrice: null }).risk, false)).toBeNull();
  });
});
