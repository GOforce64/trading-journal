import { nyWallClock } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dayText, excursionLine, missedLine, parseClock, rangeWarning } from "./text.js";

const risk = (overrides: Record<string, unknown> = {}) => ({
  risk: 0.62,
  r: 2.387,
  plannedRR: 4.484,
  mae: -0.306,
  mfe: 3.097,
  problem: null,
  ...overrides,
});

describe("missedLine", () => {
  it("reads R and the planned R:R", () => {
    expect(missedLine(risk(), "long")).toBe("R +2.39 · R:R 4.48");
    expect(missedLine(risk({ plannedRR: null }), "long")).toBe("R +2.39");
    expect(missedLine(risk({ r: -1 }), "short")).toBe("R −1.00 · R:R 4.48");
  });

  it("says what's missing or wrong instead", () => {
    const problem = (name: string, direction: "long" | "short" = "long") =>
      missedLine(risk({ r: null, problem: name }), direction);
    expect(problem("no_stop")).toBe("Place the stop to see R");
    expect(problem("stop_at_entry")).toBe("The stop can't be at the entry");
    expect(problem("wrong_side")).toBe("The stop is above the entry for a long");
    expect(problem("wrong_side", "short")).toBe("The stop is below the entry for a short");
    expect(problem("no_exit")).toBe("Place the exit to see R");
  });
});

describe("excursionLine", () => {
  it("reads MAE and MFE in R, or nothing without them", () => {
    expect(excursionLine(risk())).toBe("MAE −0.31R · MFE +3.10R");
    expect(excursionLine(risk({ mae: null, mfe: null }))).toBeNull();
    expect(excursionLine(null)).toBeNull();
  });
});

describe("rangeWarning", () => {
  const bar = { t: nyWallClock("2026-09-30", 9 * 60 + 41), h: 178.55, l: 178.1 };

  it("warns about a price outside its minute's range", () => {
    expect(rangeWarning(179, bar)).toBe("Outside 09:41's range (178.10–178.55)");
    expect(rangeWarning(178, bar)).toBe("Outside 09:41's range (178.10–178.55)");
  });

  it("stays quiet inside the range, or without the minute's bar", () => {
    expect(rangeWarning(178.3, bar)).toBeNull();
    expect(rangeWarning(178.55, bar)).toBeNull();
    expect(rangeWarning(179, null)).toBeNull();
  });

  it("judges by the range in cents, as it shows it, so a click on a sub-cent high or low isn't outside", () => {
    // Alpaca's IEX bars carry prices like 237.2505; a point placed on that low is stored at 237.25.
    const subCent = { t: bar.t, h: 237.3249, l: 237.2505 };
    expect(rangeWarning(237.25, subCent)).toBeNull();
    expect(rangeWarning(237.32, subCent)).toBeNull();
    expect(rangeWarning(237.24, subCent)).toBe("Outside 09:41's range (237.25–237.32)");
    expect(rangeWarning(237.33, subCent)).toBe("Outside 09:41's range (237.25–237.32)");
  });
});

describe("parseClock", () => {
  it("reads a time on the trade's New York date", () => {
    expect(parseClock("09:41", "2026-09-30")).toBe(nyWallClock("2026-09-30", 9 * 60 + 41));
    expect(parseClock(" 9:41 ", "2026-09-30")).toBe(nyWallClock("2026-09-30", 9 * 60 + 41));
  });

  it("refuses a time that isn't on the clock", () => {
    expect(parseClock("25:00", "2026-09-30")).toBe("Type a time like 09:41");
    expect(parseClock("09:60", "2026-09-30")).toBe("Type a time like 09:41");
    expect(parseClock("0941", "2026-09-30")).toBe("Type a time like 09:41");
  });
});

describe("dayText", () => {
  it("names a New York date the way the pages do", () => {
    expect(dayText("2026-09-30")).toBe("Sep 30");
  });
});
