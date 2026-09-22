import { describe, expect, it } from "vitest";
import { derivedFees, ironFlyMetrics, ironFlyOutcome } from "./ironFly.js";

/** Sample broken-wing fly: short 50 straddle, wings 45 / 58, 4 lots, $1,200 credit, $8.00 fees. */
const sampleFly = {
  bodyPutStrike: 50,
  bodyCallStrike: 50,
  putWingStrike: 45,
  callWingStrike: 58,
  contracts: 4,
  creditPerShare: 3,
  fees: 8,
};

describe("ironFlyMetrics", () => {
  it("measures each wing separately when they are not equal", () => {
    const metrics = ironFlyMetrics(sampleFly);
    expect(metrics.putWingWidth).toBe(5);
    expect(metrics.callWingWidth).toBe(8);
    expect(metrics.isBrokenWing).toBe(true);
  });

  it("nets fees out of the credit", () => {
    const metrics = ironFlyMetrics(sampleFly);
    expect(metrics.netCreditPerShare).toBeCloseTo(2.98, 5);
    expect(metrics.maxProfit).toBe(1192);
  });

  it("takes max loss from the wider wing and names that side", () => {
    const metrics = ironFlyMetrics(sampleFly);
    expect(metrics.putSideRisk).toBe(808);
    expect(metrics.callSideRisk).toBe(2008);
    expect(metrics.maxLoss).toBe(2008);
    expect(metrics.riskySide).toBe("call");
  });

  it("puts breakevens at the body plus and minus the net credit", () => {
    const metrics = ironFlyMetrics(sampleFly);
    expect(metrics.breakevenLow).toBe(47.02);
    expect(metrics.breakevenHigh).toBe(52.98);
  });

  it("treats equal wings as unbroken, with equal risk on both sides", () => {
    const metrics = ironFlyMetrics({ ...sampleFly, callWingStrike: 55 });
    expect(metrics.putWingWidth).toBe(5);
    expect(metrics.callWingWidth).toBe(5);
    expect(metrics.isBrokenWing).toBe(false);
    expect(metrics.putSideRisk).toBe(metrics.callSideRisk);
    expect(metrics.riskySide).toBe("even");
  });

  it("clamps risk at zero when the credit exceeds the wing", () => {
    const metrics = ironFlyMetrics({ ...sampleFly, creditPerShare: 9, fees: 0 });
    expect(metrics.putSideRisk).toBe(0);
    expect(metrics.maxLoss).toBe(0);
  });

  it("works without fees", () => {
    const metrics = ironFlyMetrics({ ...sampleFly, fees: undefined });
    expect(metrics.netCreditPerShare).toBe(3);
    expect(metrics.maxProfit).toBe(1200);
  });
});

describe("ironFlyOutcome", () => {
  it("reports return on risk, share of max profit, and P&L % of cost", () => {
    const outcome = ironFlyOutcome(ironFlyMetrics(sampleFly), 512);
    expect(outcome.returnOnRisk).toBeCloseTo(0.255, 4);
    expect(outcome.pctOfMaxProfit).toBeCloseTo(0.4295, 4);
    expect(outcome.pnlPctOfCost).toBeCloseTo(0.4295, 4);
  });

  it("returns null return-on-risk when there is no risk to divide by", () => {
    const metrics = ironFlyMetrics({ ...sampleFly, creditPerShare: 9, fees: 0 });
    expect(ironFlyOutcome(metrics, 100).returnOnRisk).toBeNull();
  });
});

describe("derivedFees", () => {
  it("recovers fees from the gap between leg cash and the reported cost", () => {
    const legs = [
      { quantity: -4, multiplier: 100, openPrice: 2.1 },
      { quantity: -4, multiplier: 100, openPrice: 1.6 },
      { quantity: 4, multiplier: 100, openPrice: 0.35 },
      { quantity: 4, multiplier: 100, openPrice: 0.35 },
    ];
    expect(derivedFees(legs, -1192)).toBe(8);
  });

  it("reports no fees when the legs already account for the whole cost", () => {
    expect(derivedFees([{ quantity: -1, multiplier: 100, openPrice: 1.5 }], -150)).toBe(0);
  });
});
