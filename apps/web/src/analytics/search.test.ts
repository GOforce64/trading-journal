import { describe, expect, it } from "vitest";
import {
  type AnalyticsSearch,
  activePreset,
  applyPatch,
  calendarMonth,
  parseAnalyticsSearch,
  parseDashboardSearch,
  periodLabel,
  periodRange,
  presetRange,
  stepPeriod,
  toFilter,
} from "./search.js";

describe("parseAnalyticsSearch", () => {
  it("keeps valid values", () => {
    expect(
      parseAnalyticsSearch({
        tab: "flies",
        from: "2026-07-01",
        to: "2026-09-30",
        books: "paper",
        ticker: "m",
        excluded: true,
        creditEdges: "250,500,1000",
        contractEdges: "2,4,6",
      }),
    ).toEqual({
      tab: "flies",
      from: "2026-07-01",
      to: "2026-09-30",
      books: "paper",
      ticker: "M",
      excluded: true,
      creditEdges: "250,500,1000",
      contractEdges: "2,4,6",
    });
  });

  it("drops hand-edited or stale values instead of failing", () => {
    expect(
      parseAnalyticsSearch({
        tab: "scalps",
        from: "2026-02-30",
        to: "yesterday",
        books: "missed",
        ticker: "SPX INDEX",
        excluded: "no",
        creditEdges: "abc",
        contractEdges: "1, 3",
      }),
    ).toEqual({});
  });

  it("keeps tickers written with a dash or a slash", () => {
    expect(parseAnalyticsSearch({ ticker: "bf-b" })).toEqual({ ticker: "BF-B" });
    expect(parseAnalyticsSearch({ ticker: "BRK/B" })).toEqual({ ticker: "BRK/B" });
  });

  it("accepts the numbers the router's parser makes of plain values", () => {
    expect(parseAnalyticsSearch({ creditEdges: 250, excluded: "true" })).toEqual({
      creditEdges: "250",
      excluded: true,
    });
  });
});

describe("toFilter and applyPatch", () => {
  it("turns the search into a trade filter", () => {
    expect(toFilter({})).toEqual({ books: ["live", "paper"], includeExcluded: false });
    expect(toFilter({ books: "paper", ticker: "M", excluded: true, from: "2026-09-01" })).toEqual({
      books: ["paper"],
      ticker: "M",
      includeExcluded: true,
      from: "2026-09-01",
    });
  });

  it("merges a change and drops keys set to undefined", () => {
    expect(
      applyPatch<AnalyticsSearch>({ tab: "flies", books: "paper" }, { books: undefined, ticker: "M" }),
    ).toEqual({
      tab: "flies",
      ticker: "M",
    });
  });
});

describe("date presets", () => {
  it("works out each preset from today", () => {
    expect(presetRange("all", "2026-09-27")).toEqual({});
    expect(presetRange("this-month", "2026-09-27")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last-90", "2026-09-27")).toEqual({ from: "2026-06-30", to: "2026-09-27" });
    expect(presetRange("this-year", "2026-09-27")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("names the preset a range matches, or custom", () => {
    expect(activePreset({}, "2026-09-27")).toBe("all");
    expect(activePreset({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-27")).toBe("this-month");
    expect(activePreset({ from: "2026-09-02" }, "2026-09-27")).toBe("custom");
  });
});

describe("dashboard periods", () => {
  it("parses only valid periods and dates, leaving month out as the default", () => {
    expect(parseDashboardSearch({ period: "week", at: "2026-09-15" })).toEqual({
      period: "week",
      at: "2026-09-15",
    });
    expect(parseDashboardSearch({ period: "month", at: "2026-02-30" })).toEqual({});
  });

  it("finds each period's dates", () => {
    expect(periodRange("week", "2026-09-26")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(periodRange("month", "2026-09-26")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("year", "2026-09-26")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("all", "2026-09-26")).toEqual({});
  });

  it("steps a period back and forth", () => {
    expect(stepPeriod("week", "2026-09-26", -1)).toBe("2026-09-19");
    expect(stepPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(stepPeriod("year", "2026-09-26", -1)).toBe("2025-01-01");
  });

  it("names each period", () => {
    expect(periodLabel("week", "2026-09-26")).toBe("Sep 21 – Sep 27, 2026");
    expect(periodLabel("month", "2026-09-26")).toBe("September 2026");
    expect(periodLabel("year", "2026-09-26")).toBe("2026");
    expect(periodLabel("all", "2026-09-26")).toBe("All time");
  });

  it("opens the calendar on today's month when the period includes today, else on its last month", () => {
    expect(calendarMonth("month", "2026-09-15", "2026-09-27")).toBe("2026-09");
    expect(calendarMonth("month", "2026-08-10", "2026-09-27")).toBe("2026-08");
    expect(calendarMonth("year", "2025-03-01", "2026-09-27")).toBe("2025-12");
    expect(calendarMonth("all", "2026-09-27", "2026-09-27")).toBe("2026-09");
  });
});
