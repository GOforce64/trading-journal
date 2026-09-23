import { describe, expect, it } from "vitest";
import { ironFlyStructureFromLegs, positionCash } from "./position.js";

/** The sample fly, priced leg by leg: short 50 straddle, wings 45 / 58, 4 lots. */
const shortCall = {
  right: "C" as const,
  strike: 50,
  quantity: -4,
  multiplier: 100,
  openPrice: 2.1,
  closePrice: 1,
};
const shortPut = {
  right: "P" as const,
  strike: 50,
  quantity: -4,
  multiplier: 100,
  openPrice: 1.6,
  closePrice: 0.8,
};
const longCall = {
  right: "C" as const,
  strike: 58,
  quantity: 4,
  multiplier: 100,
  openPrice: 0.35,
  closePrice: 0.05,
};
const longPut = {
  right: "P" as const,
  strike: 45,
  quantity: 4,
  multiplier: 100,
  openPrice: 0.35,
  closePrice: 0.05,
};
const legs = [shortCall, shortPut, longCall, longPut];

describe("positionCash", () => {
  it("derives the credit, the P&L and the fees from the legs", () => {
    const cash = positionCash(legs, { open: 5, close: 3 });
    expect(cash.netCost).toBe(-1192); // $1,200 credit less $8 of fees
    expect(cash.creditPerShare).toBeCloseTo(2.98, 5);
    expect(cash.grossPnl).toBe(520);
    expect(cash.netPnl).toBe(512);
    expect(cash.fees).toBe(8);
    expect(cash.contracts).toBe(4);
  });

  it("treats fees as optional", () => {
    const cash = positionCash(legs);
    expect(cash.netCost).toBe(-1200);
    expect(cash.netPnl).toBe(520);
    expect(cash.fees).toBe(0);
  });

  it("reports no P&L while a leg is still open", () => {
    const open = [shortCall, { ...shortPut, closePrice: null }, longCall, longPut];
    const cash = positionCash(open, { open: 5, close: 0 });
    expect(cash.netPnl).toBeNull();
    expect(cash.grossPnl).toBeNull();
    // The cost is known even while the position is live.
    expect(cash.netCost).toBe(-1195);
  });

  it("handles a debit position", () => {
    const debit = [
      { right: "C" as const, strike: 50, quantity: 2, multiplier: 100, openPrice: 1.5, closePrice: 2 },
    ];
    const cash = positionCash(debit, { open: 2, close: 2 });
    expect(cash.netCost).toBe(304);
    expect(cash.creditPerShare).toBeCloseTo(-1.52, 5);
    expect(cash.netPnl).toBe(96);
  });

  it("sizes contracts from the largest leg", () => {
    const ratio = [shortCall, shortPut, { ...longCall, quantity: 8 }, longPut];
    expect(positionCash(ratio).contracts).toBe(8);
  });
});

describe("ironFlyStructureFromLegs", () => {
  it("reads the body and both wings off the legs", () => {
    expect(ironFlyStructureFromLegs(legs)).toEqual({
      bodyPutStrike: 50,
      bodyCallStrike: 50,
      putWingStrike: 45,
      callWingStrike: 58,
    });
  });

  it("treats a missing long put as a theoretical wing at strike 0", () => {
    expect(ironFlyStructureFromLegs([shortCall, shortPut, longCall])).toEqual({
      bodyPutStrike: 50,
      bodyCallStrike: 50,
      putWingStrike: 0,
      callWingStrike: 58,
    });
  });

  it("returns null without a long call, since that side's risk is unlimited", () => {
    expect(ironFlyStructureFromLegs([shortCall, shortPut, longPut])).toBeNull();
  });

  it("keeps an unequal body, as a broken fly can have", () => {
    const shifted = [{ ...shortCall, strike: 51 }, shortPut, longCall, longPut];
    expect(ironFlyStructureFromLegs(shifted)?.bodyCallStrike).toBe(51);
    expect(ironFlyStructureFromLegs(shifted)?.bodyPutStrike).toBe(50);
  });
});
