import { describe, expect, it } from "vitest";
import { type MissedLevels, missedRisk, snapToBar } from "./missed.js";

const LONG: MissedLevels = {
  direction: "long",
  entryPrice: 178.42,
  stopPrice: 177.8,
  targetPrice: 181.2,
  exitPrice: 179.9,
};
const SHORT: MissedLevels = {
  direction: "short",
  entryPrice: 178.42,
  stopPrice: 179.04,
  targetPrice: 175.64,
  exitPrice: 176.94,
};

const missed = (
  levels: Partial<MissedLevels> = {},
  hold: { holdHigh: number; holdLow: number } | null = null,
) => ({
  book: "missed",
  missed: { ...LONG, ...levels },
  scalpPrices: hold,
});

describe("missedRisk", () => {
  it("scores a long in stock R, with its planned R:R and excursions", () => {
    const risk = missedRisk(missed({}, { holdHigh: 180.34, holdLow: 178.23 }));
    expect(risk?.problem).toBeNull();
    expect(risk?.risk).toBeCloseTo(0.62, 9);
    expect(risk?.r).toBeCloseTo(1.48 / 0.62, 9);
    expect(risk?.plannedRR).toBeCloseTo(2.78 / 0.62, 9);
    expect(risk?.mae).toBeCloseTo(-0.19 / 0.62, 9);
    expect(risk?.mfe).toBeCloseTo(1.92 / 0.62, 9);
  });

  it("scores the mirrored short the same", () => {
    const long = missedRisk(missed({}, { holdHigh: 180.34, holdLow: 178.23 }));
    const short = missedRisk({
      book: "missed",
      missed: SHORT,
      scalpPrices: { holdHigh: 178.61, holdLow: 176.5 },
    });
    for (const key of ["risk", "r", "plannedRR", "mae", "mfe"] as const) {
      expect(short?.[key]).toBeCloseTo(long?.[key] ?? Number.NaN, 9);
    }
  });

  it("needs a stop before anything", () => {
    expect(missedRisk(missed({ stopPrice: null }))).toEqual({
      risk: null,
      r: null,
      plannedRR: null,
      mae: null,
      mfe: null,
      problem: "no_stop",
    });
  });

  it("refuses a stop at the entry", () => {
    expect(missedRisk(missed({ stopPrice: 178.42 }))?.problem).toBe("stop_at_entry");
  });

  it("refuses a long's stop above the entry and a short's below it", () => {
    expect(missedRisk(missed({ stopPrice: 179 }))?.problem).toBe("wrong_side");
    expect(missedRisk(missed({ direction: "short", stopPrice: 178 }))?.r).toBeNull();
    expect(missedRisk(missed({ direction: "short", stopPrice: 178 }))?.problem).toBe("wrong_side");
  });

  it("keeps the risk and planned R:R while the exit is missing", () => {
    const risk = missedRisk(missed({ exitPrice: null }));
    expect(risk?.problem).toBe("no_exit");
    expect(risk?.r).toBeNull();
    expect(risk?.risk).toBeCloseTo(0.62, 9);
    expect(risk?.plannedRR).toBeCloseTo(2.78 / 0.62, 9);
  });

  it("leaves the planned R:R out for a target on the losing side, or none", () => {
    expect(missedRisk(missed({ targetPrice: 178 }))?.plannedRR).toBeNull();
    expect(missedRisk(missed({ targetPrice: null }))?.plannedRR).toBeNull();
    expect(missedRisk(missed({ targetPrice: 178 }))?.r).toBeCloseTo(1.48 / 0.62, 9);
  });

  it("leaves MAE and MFE out until the hold range is fetched", () => {
    const risk = missedRisk(missed());
    expect(risk?.mae).toBeNull();
    expect(risk?.mfe).toBeNull();
    expect(risk?.r).not.toBeNull();
  });

  it("never reports an excursion on the wrong side of zero", () => {
    // The stock never traded below the entry, and never above it, over these holds.
    const up = missedRisk(missed({}, { holdHigh: 180, holdLow: 178.5 }));
    expect(up?.mae).toBe(0);
    const down = missedRisk(missed({ exitPrice: 178 }, { holdHigh: 178.4, holdLow: 177.9 }));
    expect(down?.mfe).toBe(0);
    expect(Object.is(up?.mae, -0)).toBe(false);
  });

  it("prices live levels over the stored ones, as a drag moves them", () => {
    expect(missedRisk(missed(), { stopPrice: 177.42 })?.r).toBeCloseTo(1.48, 9);
    expect(missedRisk(missed(), { exitPrice: 179.04 })?.r).toBeCloseTo(1, 9);
    expect(missedRisk(missed(), { direction: "short" })?.problem).toBe("wrong_side");
  });

  it("is null for a trade that isn't missed, or has no details", () => {
    expect(missedRisk({ book: "live", missed: LONG })).toBeNull();
    expect(missedRisk({ book: "missed", missed: null })).toBeNull();
  });
});

describe("snapToBar", () => {
  it("keeps a price inside its bar", () => {
    expect(snapToBar(181, { high: 180.5, low: 179 })).toBe(180.5);
    expect(snapToBar(178, { high: 180.5, low: 179 })).toBe(179);
    expect(snapToBar(179.75, { high: 180.5, low: 179 })).toBe(179.75);
  });
});
