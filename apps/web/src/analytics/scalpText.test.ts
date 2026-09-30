import type { GroupStats } from "@tj/core";
import { describe, expect, it } from "vitest";
import {
  coverageText,
  holdText,
  metricValue,
  returnText,
  rowSummary,
  shortLabel,
  tickText,
} from "./scalpText.js";

const ROW: GroupStats = {
  trades: 12,
  winRate: 8 / 12,
  net: 820,
  profitFactor: 2,
  avgR: 0.62,
  rCount: 10,
  avgReturn: 0.084,
  returnCount: 12,
};
const EMPTY: GroupStats = {
  trades: 0,
  winRate: null,
  net: 0,
  profitFactor: null,
  avgR: null,
  rCount: 0,
  avgReturn: null,
  returnCount: 0,
};
const COVERAGE = { total: 38, withR: 31, noStop: 5, noStockPrice: 1, cannotPrice: 1 };

describe("metricValue", () => {
  it("picks net, avg R or win rate, and nothing for an empty row or a row without R", () => {
    expect(metricValue(ROW, "net")).toBe(820);
    expect(metricValue(ROW, "r")).toBe(0.62);
    expect(metricValue(ROW, "win")).toBeCloseTo(0.6667, 4);
    expect(metricValue(EMPTY, "net")).toBeNull();
    expect(metricValue({ ...ROW, avgR: null }, "r")).toBeNull();
  });
});

describe("tickText", () => {
  it("cuts a long name so bar labels don't overlap, keeping the count", () => {
    expect(tickText("0–5", 12)).toBe("0–5 · 12");
    expect(tickText("ORB breakout", 3)).toBe("ORB breakout · 3");
    expect(tickText("Earnings IV crush", 2)).toBe("Earnings IV… · 2");
    expect(shortLabel("Earnings IV crush")).toBe("Earnings IV…");
    expect(shortLabel("VWAP reclaim")).toBe("VWAP reclaim");
  });
});

describe("returnText and holdText", () => {
  it("signs a return to one decimal with a true minus", () => {
    expect(returnText(0.084)).toBe("+8.4%");
    expect(returnText(-0.03)).toBe("−3.0%");
    expect(returnText(0.0001)).toBe("0.0%");
    expect(returnText(null)).toBe("—");
  });

  it("reads a hold in seconds, minutes, or hours and minutes", () => {
    expect(holdText(0.75)).toBe("45 s");
    expect(holdText(0.999)).toBe("1 min");
    expect(holdText(6.2)).toBe("6 min");
    expect(holdText(59.6)).toBe("1 h 0 min");
    expect(holdText(72)).toBe("1 h 12 min");
    expect(holdText(null)).toBe("—");
  });
});

describe("rowSummary", () => {
  it("says everything a bar stands for", () => {
    expect(rowSummary(ROW)).toBe("12 scalps · +$820 · +0.62R over 10 · win 66.7%");
    expect(rowSummary({ ...ROW, trades: 1, avgR: null, rCount: 0, winRate: 1 })).toBe(
      "1 scalp · +$820 · no R · win 100.0%",
    );
    expect(rowSummary(EMPTY)).toBe("no scalps");
  });
});

describe("coverageText", () => {
  it("names why scalps lack R, leaving out reasons nobody has", () => {
    expect(coverageText(COVERAGE)).toBe(
      "R covers 31 of 38 scalps · 5 have no stop · 1 has no stock price · 1 can't be priced",
    );
    expect(coverageText({ ...COVERAGE, withR: 36, noStop: 2, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers 36 of 38 scalps · 2 have no stop",
    );
  });

  it("says when every scalp has R, and nothing without scalps", () => {
    expect(coverageText({ total: 38, withR: 38, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers all 38 scalps",
    );
    expect(coverageText({ total: 1, withR: 1, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers the scalp",
    );
    expect(coverageText({ total: 0, withR: 0, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe("");
  });

  it("says what the backfill is doing, or why it couldn't", () => {
    expect(coverageText(COVERAGE, { fetching: 7, problem: null })).toBe(
      "Fetching stock prices for 7 scalps…",
    );
    expect(coverageText(COVERAGE, { fetching: 1, problem: null })).toBe("Fetching stock prices for 1 scalp…");
    expect(
      coverageText(
        { total: 2, withR: 1, noStop: 0, noStockPrice: 1, cannotPrice: 0 },
        { fetching: 0, problem: "Alpaca didn't answer: reload to try again." },
      ),
    ).toBe("R covers 1 of 2 scalps · 1 has no stock price. Alpaca didn't answer: reload to try again.");
  });
});
