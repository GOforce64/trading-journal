import fc from "fast-check";
import { addDays } from "./calendar.js";
import { nyDate } from "./marks.js";
import type { StatTrade } from "./stats.js";

const HOUR = 3_600_000;
const TICKERS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ", "KK", "LL", "MM", "NN", "OO"];

/**
 * Random closed trades: whole-cent P&L and fees, closes in 2024–2027, held 1 hour to 10 days,
 * flies (some 1-winged, some with fees above their credit) mixed with scalps.
 */
export const tradesArbitrary = fc
  .array(
    fc.record({
      netCents: fc.integer({ min: -500_000, max: 500_000 }),
      feeCents: fc.integer({ min: 0, max: 5_000 }),
      closedAt: fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2027, 11, 31) }),
      heldHours: fc.integer({ min: 1, max: 240 }),
      dte: fc.integer({ min: 0, max: 30 }),
      ticker: fc.constantFrom(...TICKERS),
      contracts: fc.integer({ min: 1, max: 20 }),
      creditCents: fc.integer({ min: 1, max: 1_000 }),
      wings: fc.constantFrom<[number, number | null]>([9, 11], [8, 13], [5, null], [0, 12]),
      isFly: fc.boolean(),
    }),
    { maxLength: 60 },
  )
  .map((rows) =>
    rows.map((row, index): StatTrade => {
      const openedAt = row.closedAt - row.heldHours * HOUR;
      return {
        id: `t${index}`,
        strategy: row.isFly ? "iron_fly" : "scalp",
        underlying: row.ticker,
        openedAt,
        closedAt: row.closedAt,
        netPnl: row.netCents / 100,
        fees: row.feeCents / 100,
        legs: [
          {
            expiry: addDays(nyDate(openedAt), row.dte),
            quantity: row.isFly ? -row.contracts : row.contracts,
          },
        ],
        ironFly: row.isFly
          ? {
              putWingStrike: row.wings[0],
              bodyPutStrike: 10,
              bodyCallStrike: 10,
              callWingStrike: row.wings[1],
              contracts: row.contracts,
              creditPerShare: row.creditCents / 100,
            }
          : null,
      };
    }),
  );
