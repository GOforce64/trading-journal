import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMOTIONS, MISTAKES, SETUP_NAMES, scalp } from "./scalpStats.fixture.js";
import {
  BREAKDOWNS,
  bucketStats,
  type ClosedScalp,
  cumulativeR,
  mistakeCost,
  scalpBreakdown,
} from "./scalpStats.js";
import { ny } from "./stats.fixture.js";

const DAY = 86_400_000;
const MINUTE = 60_000;
const TAGS = ["chased", "moved", "calm", "late"];

/** Random closed scalps: any time of day, held up to 4 hours, some without R, tagged and set up at random. */
const scalpsArbitrary = fc
  .array(
    fc.record({
      day: fc.integer({ min: 0, max: 20 }),
      openMinute: fc.integer({ min: 4 * 60, max: 20 * 60 }),
      heldSeconds: fc.integer({ min: 0, max: 4 * 3600 }),
      netCents: fc.integer({ min: -100_000, max: 100_000 }),
      r: fc.option(fc.double({ min: -3, max: 3, noNaN: true }), { nil: null }),
      tagIds: fc.subarray(TAGS),
      setupId: fc.constantFrom(null, "orb", "vwap"),
      ticker: fc.constantFrom(
        "NVDA",
        "SPY",
        "QQQ",
        "AAPL",
        "TSLA",
        "AMD",
        "META",
        "MSFT",
        "AMZN",
        "GOOG",
        "NFLX",
        "IWM",
      ),
      right: fc.constantFrom("C", "P"),
      quantity: fc.integer({ min: 1, max: 8 }),
      book: fc.constantFrom("live", "paper"),
    }),
    { maxLength: 40 },
  )
  .map((rows) =>
    rows.map((row, index): ClosedScalp => {
      const openedAt = ny("2026-09-01 00:00") + row.day * DAY + row.openMinute * MINUTE;
      return scalp({
        id: `s${index}`,
        underlying: row.ticker,
        book: row.book,
        openedAt,
        closedAt: openedAt + row.heldSeconds * 1000,
        netPnl: row.netCents / 100,
        setupId: row.setupId,
        tagIds: row.tagIds,
        legs: [
          { right: row.right, expiry: "2026-09-30", quantity: row.quantity, multiplier: 100, openPrice: 1.5 },
        ],
        risk: { r: row.r, problem: row.r == null ? "no_stop" : null },
      });
    }),
  );

const CONTEXT = {
  setups: SETUP_NAMES,
  emotions: EMOTIONS,
  costEdges: [250, 500, 1000],
  contractEdges: [2, 4, 6],
};

describe("scalp stats properties", () => {
  it("splits the scalps between with and without for every mistake row", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const row of mistakeCost(trades, MISTAKES)) {
          expect((row.withTag?.trades ?? 0) + (row.withoutTag?.trades ?? 0)).toBe(trades.length);
        }
      }),
    );
  });

  it("puts every scalp in exactly one time bucket", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const by of ["open", "hold"] as const) {
          const counted = bucketStats(trades, by).reduce((sum, row) => sum + row.trades, 0);
          expect(counted).toBe(trades.length);
        }
      }),
    );
  });

  it("puts every scalp in exactly one row of each single-valued breakdown", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const by of BREAKDOWNS.filter((each) => each !== "emotion")) {
          const counted = scalpBreakdown(trades, by, CONTEXT).reduce((sum, row) => sum + row.trades, 0);
          expect(counted).toBe(trades.length);
        }
      }),
    );
  });

  it("ends cumulative R at the sum of R", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        const sum = trades.reduce((total, trade) => total + (trade.risk?.r ?? 0), 0);
        expect(cumulativeR(trades).at(-1)?.total ?? 0).toBeCloseTo(sum, 6);
      }),
    );
  });
});
