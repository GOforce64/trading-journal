import { describe, expect, it } from "vitest";
import { FLY_LEGS, fixturePayload, fixtureTrade, OQUANTS_HEADERS } from "./fixture.js";
import { type ParsedTrade, parseOquants, type SkippedRow } from "./parse.js";
import { OquantsFormatError } from "./payload.js";

const [shortCall, shortPut, longCall, longPut] = FLY_LEGS as [
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
  (typeof FLY_LEGS)[number],
];

function only(payload = fixturePayload()) {
  const { rows } = parseOquants(payload);
  expect(rows).toHaveLength(1);
  return rows[0] as ParsedTrade | SkippedRow;
}

function parsed(...args: Parameters<typeof fixtureTrade>): ParsedTrade {
  const row = only(fixturePayload([fixtureTrade(...args)]));
  if (row.kind !== "trade") throw new Error(`skipped: ${row.reason}`);
  return row;
}

function skipReason(...args: Parameters<typeof fixtureTrade>): string {
  const row = only(fixturePayload([fixtureTrade(...args)]));
  if (row.kind !== "skip") throw new Error("expected a skip");
  return row.reason;
}

describe("parseOquants", () => {
  it("parses a closed butterfly", () => {
    const { trade, flags } = parsed();
    expect(flags).toEqual([]);
    expect(trade).toMatchObject({
      strategy: "iron_fly",
      book: "paper",
      source: "oquants_extract",
      underlying: "XYZ",
      underlyingName: "Example Corp",
      structureLabel: "Short Iron Butterfly",
      openedAt: Date.UTC(2026, 8, 9, 17, 54),
      closedAt: Date.UTC(2026, 8, 10, 17, 44),
      netPnl: 512,
      fees: 8,
      feesOpen: null,
      feesClose: null,
      notes: null,
    });
    expect(trade.ironFly).toMatchObject({
      bodyPutStrike: 50,
      bodyCallStrike: 50,
      putWingStrike: 45,
      callWingStrike: 58,
      contracts: 4,
      creditPerShare: 3,
      netCost: -1192,
      sourceNotes: "filled at mid",
    });
    const call = trade.legs.find((leg) => leg.right === "C" && leg.quantity < 0);
    expect(call).toMatchObject({ strike: 50, expiry: "2026-09-11", openPrice: 2.1, closePrice: 1 });
    const put = trade.legs.find((leg) => leg.right === "P" && leg.quantity > 0);
    expect(put).toMatchObject({ strike: 45, openPrice: 0.35, closePrice: 0.05 });
  });

  it("parses a condor with separate body strikes", () => {
    const { trade } = parsed({
      structure: "Short Iron Condor",
      legs: [{ ...shortCall, strike: 52 }, { ...shortPut, strike: 48 }, longCall, longPut],
    });
    expect(trade.ironFly).toMatchObject({ bodyPutStrike: 48, bodyCallStrike: 52 });
  });

  it("imports a trade with no long put as 1 wing, put wing at 0", () => {
    const { trade, flags } = parsed({
      structure: "Short Straddle",
      legs: [shortCall, shortPut, longCall],
      cost: "-1,332.00",
      pnl: "+632.00",
    });
    expect(flags).toEqual(["1 wing"]);
    expect(trade.legs).toHaveLength(3);
    expect(trade.ironFly?.putWingStrike).toBe(0);
    expect(trade.fees).toBe(8);
    expect(trade.structureLabel).toBe("Short Straddle");
  });

  it("imports an open trade with no exit data, under the same id it has once closed", () => {
    const open = parsed({ close: "", pnl: "" });
    expect(open.trade.closedAt).toBeNull();
    expect(open.trade.netPnl).toBeNull();
    expect(open.trade.legs.every((leg) => leg.closePrice === null)).toBe(true);
    expect(open.id).toBe(parsed().id);
  });

  it("gives different trades different ids", () => {
    expect(parsed({ ticker: "ABC" }).id).not.toBe(parsed().id);
  });

  it("rolls the year back for a December open that expires in January", () => {
    const { trade } = parsed({
      open: "Dec 30, 9:00 PM",
      close: "Jan 2, 4:00 PM\n(3d)",
      expiry: "2027-01-02",
    });
    expect(trade.openedAt).toBe(Date.UTC(2026, 11, 30, 19, 0));
    expect(trade.closedAt).toBe(Date.UTC(2027, 0, 2, 14, 0));
    expect(trade.legs[0]?.expiry).toBe("2027-01-02");
  });

  it("flags a row whose leg P&L does not add up to the row's", () => {
    const { flags, trade } = parsed({ pnl: "+500.00" });
    expect(trade.netPnl).toBe(500);
    expect(flags).toEqual(["doesn't reconcile ($12.00)"]);
  });

  it("skips other strategies", () => {
    expect(skipReason({ strategy: "VRP" })).toBe("strategy VRP");
  });

  it("skips a trade with no call wing", () => {
    expect(skipReason({ legs: [shortCall, shortPut, longPut] })).toBe(
      "no call wing — unlimited risk, enter manually",
    );
  });

  it("skips legs of unequal size", () => {
    expect(skipReason({ legs: [shortCall, shortPut, longCall, { ...longPut, size: 2 }] })).toBe(
      "unrecognized structure",
    );
  });

  it("says when a row's legs were never collected", () => {
    expect(skipReason({ legs: [] })).toBe(
      "no legs collected — the row did not expand; run the snippet again",
    );
  });

  it("skips an unparseable date", () => {
    expect(skipReason({ open: "yesterday" })).toBe('unparseable date "yesterday"');
  });

  it("skips negative fees", () => {
    expect(skipReason({ cost: "-1,210.00" })).toBe("fees came out negative ($-10.00)");
  });

  it("skips the second copy of a trade collected twice", () => {
    const { rows } = parseOquants(fixturePayload([fixtureTrade(), fixtureTrade()]));
    expect(rows.map((row) => row.kind)).toEqual(["trade", "skip"]);
    expect((rows[1] as SkippedRow).reason).toBe("duplicate row");
  });

  it("warns when the page counter disagrees with what was collected", () => {
    const { warnings } = parseOquants(fixturePayload([fixtureTrade()], { pageCounter: "1–50 of 72" }));
    expect(warnings).toEqual(["Collected 1 trades, the page counter said 72. Some rows may be missing."]);
  });

  it("refuses a table that lost a column it needs", () => {
    const headers = OQUANTS_HEADERS.map((header) => (header === "Cost" ? "Price" : header));
    expect(() => parseOquants(fixturePayload([fixtureTrade()], { headers }))).toThrow(OquantsFormatError);
  });
});
