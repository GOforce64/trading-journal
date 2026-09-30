import { describe, expect, it } from "vitest";
import { newTradeSchema, tradePatchSchema } from "./model.js";

/** Sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots. */
const sampleFly = {
  strategy: "iron_fly" as const,
  book: "live" as const,
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  source: "manual" as const,
  legs: [
    { right: "C" as const, strike: 50, expiry: "2026-10-16", quantity: -4, openPrice: 2.1, closePrice: 1 },
    { right: "P" as const, strike: 50, expiry: "2026-10-16", quantity: -4, openPrice: 1.6, closePrice: 0.8 },
    { right: "C" as const, strike: 58, expiry: "2026-10-16", quantity: 4, openPrice: 0.35, closePrice: 0.05 },
    { right: "P" as const, strike: 45, expiry: "2026-10-16", quantity: 4, openPrice: 0.35, closePrice: 0.05 },
  ],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    netCost: -1192,
  },
};

describe("newTradeSchema", () => {
  it("accepts a theoretical put wing at strike 0 for a 1-wing trade", () => {
    const oneWing = { ...sampleFly, ironFly: { ...sampleFly.ironFly, putWingStrike: 0 } };
    expect(newTradeSchema.parse(oneWing).ironFly?.putWingStrike).toBe(0);
  });

  it("accepts a missing call wing, for a trade with only a put wing", () => {
    const putWingOnly = { ...sampleFly, ironFly: { ...sampleFly.ironFly, callWingStrike: null } };
    expect(newTradeSchema.parse(putWingOnly).ironFly?.callWingStrike).toBeNull();
  });

  it("rejects a negative put wing", () => {
    const broken = { ...sampleFly, ironFly: { ...sampleFly.ironFly, putWingStrike: -1 } };
    expect(newTradeSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a complete iron fly", () => {
    const parsed = newTradeSchema.parse(sampleFly);
    expect(parsed.underlying).toBe("XYZ");
    expect(parsed.legs).toHaveLength(4);
    expect(parsed.ironFly?.contracts).toBe(4);
  });

  it("upper-cases the underlying and trims it", () => {
    expect(newTradeSchema.parse({ ...sampleFly, underlying: " xyz " }).underlying).toBe("XYZ");
  });

  it("defaults the optional review fields", () => {
    const parsed = newTradeSchema.parse(sampleFly);
    expect(parsed.grade).toBeNull();
    expect(parsed.excluded).toBe(false);
    expect(parsed.tagIds).toEqual([]);
    expect(parsed.legs[0]?.multiplier).toBe(100);
  });

  it("rejects an iron fly whose close precedes its open", () => {
    const result = newTradeSchema.safeParse({ ...sampleFly, closedAt: sampleFly.openedAt - 1 });
    expect(result.success).toBe(false);
  });

  it("rejects a leg with zero quantity", () => {
    const legs = [{ ...sampleFly.legs[0], quantity: 0 }, ...sampleFly.legs.slice(1)];
    expect(newTradeSchema.safeParse({ ...sampleFly, legs }).success).toBe(false);
  });

  it("requires iron fly details for an iron_fly trade", () => {
    const { ironFly, ...withoutDetails } = sampleFly;
    expect(newTradeSchema.safeParse(withoutDetails).success).toBe(false);
  });

  it("allows a scalp without iron fly details", () => {
    const { ironFly, ...rest } = sampleFly;
    expect(newTradeSchema.safeParse({ ...rest, strategy: "scalp" }).success).toBe(true);
  });

  it("allows a patch that only sets the grade", () => {
    expect(tradePatchSchema.parse({ grade: "B" })).toEqual({ grade: "B" });
  });

  it("accepts negative fees in a patch: an IBKR commission rebate, as the sync stores it", () => {
    // IBKR pays some exchanges' rebates, so one side's net commission can be a credit.
    expect(tradePatchSchema.safeParse({ fees: 1.61, feesOpen: -0.2027, feesClose: 1.81 }).success).toBe(true);
    expect(tradePatchSchema.safeParse({ fees: -0.2, feesOpen: -0.2, feesClose: 0 }).success).toBe(true);
  });

  it("rejects an unknown grade in a patch", () => {
    expect(tradePatchSchema.safeParse({ grade: "S" }).success).toBe(false);
  });
});

describe("tradePatchSchema for the scalp review", () => {
  it("takes part of a scalp's levels, and the Done reviewing flag", () => {
    expect(tradePatchSchema.parse({ scalp: { stopPrice: 231.8 }, reviewed: true })).toEqual({
      scalp: { stopPrice: 231.8 },
      reviewed: true,
    });
    expect(
      tradePatchSchema.parse({ scalp: { levelBasis: "premium", stopPrice: 0, targets: [] } }).scalp,
    ).toEqual({ levelBasis: "premium", stopPrice: 0, targets: [] });
  });

  it("refuses a negative price and an unknown basis", () => {
    expect(tradePatchSchema.safeParse({ scalp: { stopPrice: -1 } }).success).toBe(false);
    expect(tradePatchSchema.safeParse({ scalp: { levelBasis: "delta" } }).success).toBe(false);
  });

  it("takes targets of whole contracts, and the two typed overrides", () => {
    const scalp = { targets: [{ price: 233, contracts: 1 }], stockEntryOverride: 230.83, riskOverride: null };
    expect(tradePatchSchema.parse({ scalp }).scalp).toEqual(scalp);
    for (const target of [
      { price: 233, contracts: 0 },
      { price: 233, contracts: 1.5 },
      { price: -1, contracts: 1 },
    ]) {
      expect(tradePatchSchema.safeParse({ scalp: { targets: [target] } }).success).toBe(false);
    }
    const eleven = Array.from({ length: 11 }, (_, index) => ({ price: 233 + index, contracts: 1 }));
    expect(tradePatchSchema.safeParse({ scalp: { targets: eleven } }).success).toBe(false);
  });

  it("no longer takes a single target price", () => {
    expect(tradePatchSchema.parse({ scalp: { targetPrice: 234.5 } }).scalp).toEqual({});
  });
});
