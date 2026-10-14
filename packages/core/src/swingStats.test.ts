import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nyWallClock } from "./calendar.js";
import { setupCards } from "./scalpStats.js";
import {
  type ClosedSwing,
  DAYS_HELD_BUCKETS,
  DTE_BUCKETS,
  daysHeldBucket,
  dteBucket,
  swingBreakdown,
  swingSummary,
} from "./swingStats.js";

const CONTEXT = {
  setups: new Map([["s1", "Breakout"]]),
  emotions: new Map(),
  costEdges: [],
  contractEdges: [],
};

let seq = 0;
function swing(overrides: Partial<ClosedSwing> & { open: string; close: string }): ClosedSwing {
  seq++;
  const { open, close, ...rest } = overrides;
  return {
    id: `s${seq}`,
    strategy: "swing",
    book: "paper",
    underlying: "NVDA",
    openedAt: nyWallClock(open, 10 * 60),
    closedAt: nyWallClock(close, 11 * 60),
    netPnl: 100,
    fees: 2,
    setupId: null,
    grade: null,
    tagIds: [],
    ironFly: null,
    legs: [
      {
        right: "C",
        strike: 230,
        expiry: "2026-11-06",
        quantity: 1,
        multiplier: 100,
        openPrice: 5.1,
        closePrice: 9,
      },
      {
        right: "C",
        strike: 240,
        expiry: "2026-11-06",
        quantity: -1,
        multiplier: 100,
        openPrice: 1.3,
        closePrice: 1.15,
      },
    ],
    ...rest,
  };
}
const longCall = (open: string, close: string, netPnl: number): ClosedSwing =>
  swing({
    open,
    close,
    netPnl,
    legs: [
      {
        right: "C",
        strike: 230,
        expiry: "2026-11-06",
        quantity: 2,
        multiplier: 100,
        openPrice: 4,
        closePrice: 5,
      },
    ],
  });

describe("swing buckets", () => {
  it("puts days held and DTE at open in their buckets", () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 20, 21, 90].map(daysHeldBucket)).toEqual([
      "same day",
      "1–2",
      "1–2",
      "3–5",
      "3–5",
      "6–10",
      "6–10",
      "11–20",
      "11–20",
      "21+",
      "21+",
    ]);
    expect([0, 7, 8, 21, 22, 45, 46, 90, 91, null].map(dteBucket)).toEqual([
      "0–7",
      "0–7",
      "8–21",
      "8–21",
      "22–45",
      "22–45",
      "46–90",
      "46–90",
      "90+",
      "unknown",
    ]);
  });

  it("puts every number of days in exactly one bucket (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000 }), (days) => {
        expect(DAYS_HELD_BUCKETS.filter((label) => label === daysHeldBucket(days))).toHaveLength(1);
        expect(DTE_BUCKETS.filter((label) => label === dteBucket(days))).toHaveLength(1);
      }),
    );
  });
});

describe("swingSummary", () => {
  it("averages return on debit and days held, and % of max over the spreads only", () => {
    const trades = [
      swing({ open: "2026-10-02", close: "2026-10-09", netPnl: 402.1 }),
      longCall("2026-10-05", "2026-10-06", 200),
    ];
    const summary = swingSummary(trades);
    expect(summary).toMatchObject({ trades: 2, spreads: 1, returnCount: 2 });
    expect(summary.avgDaysHeld).toBe(4);
    expect(summary.avgPctOfMax).toBeCloseTo(402.1 / 620, 6);
    // 402.10 on a $380 debit and 200 on $800.
    expect(summary.avgReturn).toBeCloseTo((402.1 / 380 + 200 / 800) / 2, 6);
  });

  it("has no averages with no swings", () => {
    expect(swingSummary([])).toMatchObject({ trades: 0, avgDaysHeld: null, avgPctOfMax: null, spreads: 0 });
  });
});

describe("swingBreakdown", () => {
  const trades = [
    swing({ open: "2026-10-02", close: "2026-10-09", netPnl: 402.1, setupId: "s1" }),
    longCall("2026-10-05", "2026-10-05", -50),
    longCall("2026-10-06", "2026-10-08", 120),
  ];

  it("breaks down by structure, in the shapes' order", () => {
    expect(swingBreakdown(trades, "structure", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["Long call", 2],
      ["Call debit spread", 1],
    ]);
  });

  it("breaks down by days held and by DTE at open", () => {
    expect(swingBreakdown(trades, "held", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["same day", 1],
      ["1–2", 1],
      ["6–10", 1],
    ]);
    expect(swingBreakdown(trades, "dte", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["22–45", 3],
    ]);
  });

  it("shares the scalp breakdowns for setup and the rest", () => {
    expect(swingBreakdown(trades, "setup", CONTEXT).map((row) => row.label)).toEqual([
      "Breakout",
      "no setup",
    ]);
  });
});

describe("a swing setup's card", () => {
  it("is a swing card with its average days held", () => {
    const trades = [
      swing({ open: "2026-10-02", close: "2026-10-09", setupId: "s1" }),
      longCall("2026-10-05", "2026-10-06", 200),
    ].map((trade) => ({ ...trade, setupId: "s1" }));
    const [card] = setupCards(trades, new Map([["s1", "Breakout"]]));
    expect(card).toMatchObject({ kind: "swing", avgDaysHeld: 4, kept: null });
    expect(card?.points.at(-1)?.total).toBe(300);
  });
});
