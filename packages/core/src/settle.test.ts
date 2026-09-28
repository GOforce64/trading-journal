import { describe, expect, it } from "vitest";
import { type PricedLeg, positionCash } from "./position.js";
import { type SettleLeg, settleAtExpiry, settleExpiry } from "./settle.js";

/** BB from the real journal (spec §3): open, expired 2026-09-25, 6 lots, $5 entry fees. */
const BB: (SettleLeg & PricedLeg)[] = [
  {
    right: "C",
    strike: 8.5,
    expiry: "2026-09-25",
    quantity: -6,
    multiplier: 100,
    openPrice: 0.48,
    closePrice: null,
  },
  {
    right: "P",
    strike: 8.5,
    expiry: "2026-09-25",
    quantity: -6,
    multiplier: 100,
    openPrice: 0.6,
    closePrice: null,
  },
  {
    right: "C",
    strike: 12,
    expiry: "2026-09-25",
    quantity: 6,
    multiplier: 100,
    openPrice: 0.04,
    closePrice: null,
  },
  {
    right: "P",
    strike: 6,
    expiry: "2026-09-25",
    quantity: 6,
    multiplier: 100,
    openPrice: 0.02,
    closePrice: null,
  },
];

/** The legs with the proposed exits written in, as the settle panel saves them. */
function settled(legs: (SettleLeg & PricedLeg)[], close: number) {
  const exits = settleAtExpiry(legs, close) ?? [];
  return legs.map((leg, index) => ({
    ...leg,
    closePrice: leg.closePrice ?? exits.find((exit) => exit.index === index)?.exit ?? null,
  }));
}

describe("settleAtExpiry", () => {
  it("settles BB at its $8.21 close: only the short put is in the money", () => {
    expect(settleAtExpiry(BB, 8.21)).toEqual([
      { index: 0, exit: 0, flag: null },
      { index: 1, exit: 0.29, flag: "assigned" },
      { index: 2, exit: 0, flag: null },
      { index: 3, exit: 0, flag: null },
    ]);
  });

  it("nets BB +$433.00 through positionCash, as the settle panel shows it", () => {
    expect(positionCash(settled(BB, 8.21), { open: 5, close: 0 }).netPnl).toBe(433);
  });

  it("flags an in-the-money long as exercised", () => {
    expect(settleAtExpiry(BB, 13)).toEqual([
      { index: 0, exit: 4.5, flag: "assigned" },
      { index: 1, exit: 0, flag: null },
      { index: 2, exit: 1, flag: "exercised" },
      { index: 3, exit: 0, flag: null },
    ]);
  });

  it("puts nothing in the money at a close exactly on the strike", () => {
    expect(settleAtExpiry(BB, 8.5)?.every((leg) => leg.exit === 0 && leg.flag === null)).toBe(true);
  });

  it("keeps a wing sold before expiry, and its exit counts in the net", () => {
    const wingSold = BB.map((leg, index) => (index === 3 ? { ...leg, closePrice: 0.01 } : leg));
    expect(settleAtExpiry(wingSold, 8.21)?.map((leg) => leg.index)).toEqual([0, 1, 2]);
    // The long put brought back $6 more than expiring worthless would have.
    expect(positionCash(settled(wingSold, 8.21), { open: 5, close: 0 }).netPnl).toBe(439);
  });

  it("won't settle open legs on different expiries", () => {
    const mixed = BB.map((leg, index) => (index === 0 ? { ...leg, expiry: "2026-10-02" } : leg));
    expect(settleExpiry(mixed)).toBeNull();
    expect(settleAtExpiry(mixed, 8.21)).toBeNull();
  });

  it("has nothing to settle once every leg has an exit", () => {
    const closed = BB.map((leg) => ({ ...leg, closePrice: 0 }));
    expect(settleExpiry(closed)).toBeNull();
    expect(settleAtExpiry(closed, 8.21)).toBeNull();
  });
});

describe("settleExpiry", () => {
  it("is the expiry the open legs share", () => {
    expect(settleExpiry(BB)).toBe("2026-09-25");
  });
});
