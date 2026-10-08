import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type MissedLevels, missedRisk } from "./missed.js";

// Prices are whole cents, as real ones are: a stop a billionth of a dollar from the entry isn't a case.
const cents = (min: number, max: number) => fc.integer({ min, max }).map((value) => value / 100);
const price = cents(100, 100_000);
const offset = cents(-5_000, 5_000);
const maybe = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: null });

/** A long, its prices as offsets from the entry, and a hold range around it. */
const longArbitrary = fc.record({
  entry: price,
  stop: maybe(offset),
  target: maybe(offset),
  exit: maybe(offset),
  high: cents(0, 6_000),
  low: cents(0, 6_000),
});

describe("missedRisk properties", () => {
  it("scores a short the same as the long it mirrors", () => {
    fc.assert(
      fc.property(longArbitrary, ({ entry, stop, target, exit, high, low }) => {
        const at = (move: number | null) => (move == null ? null : entry + move);
        const mirror = (move: number | null) => (move == null ? null : entry - move);
        const long: MissedLevels = {
          direction: "long",
          entryPrice: entry,
          stopPrice: at(stop),
          targetPrice: at(target),
          exitPrice: at(exit),
        };
        const short: MissedLevels = {
          direction: "short",
          entryPrice: entry,
          stopPrice: mirror(stop),
          targetPrice: mirror(target),
          exitPrice: mirror(exit),
        };
        const a = missedRisk({
          book: "missed",
          missed: long,
          scalpPrices: { holdHigh: entry + high, holdLow: entry - low },
        });
        const b = missedRisk({
          book: "missed",
          missed: short,
          scalpPrices: { holdHigh: entry + low, holdLow: entry - high },
        });
        expect(b?.problem).toBe(a?.problem);
        for (const key of ["risk", "r", "plannedRR", "mae", "mfe"] as const) {
          const left = a?.[key] ?? null;
          const right = b?.[key] ?? null;
          if (left == null || right == null) expect(right).toBe(left);
          else expect(right).toBeCloseTo(left, 6);
        }
      }),
      { numRuns: 200 },
    );
  });
});
