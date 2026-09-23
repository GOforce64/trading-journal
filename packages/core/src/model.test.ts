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

  it("rejects an unknown grade in a patch", () => {
    expect(tradePatchSchema.safeParse({ grade: "S" }).success).toBe(false);
  });
});
