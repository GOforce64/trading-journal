import { describe, expect, it } from "vitest";
import type { TradeView } from "./api.js";
import { netWorking, settleProposal } from "./settle.js";

const leg = (id: string, right: string, strike: number, quantity: number, openPrice: number) => ({
  id,
  tradeId: "bb",
  right,
  strike,
  expiry: "2026-09-25",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice: null as number | null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

/** BB from the real journal (spec §3): open, expired 2026-09-25, $5 entry fees. */
const BB = {
  id: "bb",
  underlying: "BB",
  fees: 5,
  feesOpen: 5,
  feesClose: 0,
  legs: [
    leg("b1", "C", 8.5, -6, 0.48),
    leg("b2", "P", 8.5, -6, 0.6),
    leg("b3", "C", 12, 6, 0.04),
    leg("b4", "P", 6, 6, 0.02),
  ],
} as unknown as TradeView;

describe("settleProposal", () => {
  it("proposes BB's exits from its $8.21 close, and nets +$433.00", () => {
    const proposal = settleProposal(BB, 8.21);
    expect(proposal?.legs.map((each) => each.closePrice)).toEqual([0, 0.29, 0, 0]);
    expect(proposal).toMatchObject({
      expiry: "2026-09-25",
      closedAt: Date.UTC(2026, 8, 25, 20, 0),
      netPnl: 433,
      credit: 612,
      toClose: 174,
      fees: 5,
      feesClose: 0,
    });
    expect(proposal && netWorking(proposal)).toBe("612 credit − 174 to close − 5 fees");
  });

  it("takes the total fees as entry fees when the split is unknown, as on an imported trade", () => {
    const imported = { ...BB, feesOpen: null, feesClose: null } as unknown as TradeView;
    expect(settleProposal(imported, 8.21)).toMatchObject({ netPnl: 433, fees: 5, feesClose: 0 });
  });

  it("says cash that came in from closing, rather than subtracting a negative", () => {
    const proposal = settleProposal(BB, 8.21);
    expect(proposal && netWorking({ ...proposal, toClose: -50 })).toBe(
      "612 credit + 50 from closing − 5 fees",
    );
  });

  it("is null when the open legs can't be settled together", () => {
    const mixed = {
      ...BB,
      legs: BB.legs.map((each, index) => (index === 0 ? { ...each, expiry: "2026-10-02" } : each)),
    };
    expect(settleProposal(mixed as TradeView, 8.21)).toBeNull();
  });
});
