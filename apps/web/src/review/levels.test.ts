import type { ScalpRisk } from "@tj/core";
import { describe, expect, it } from "vitest";
import { approxLines, parseAmount, parseContracts, parsePrice, targetId, targetIndex } from "./levels.js";

describe("parsePrice", () => {
  it("reads plain prices, to the cent", () => {
    expect(parsePrice("231.8", "stock")).toBe(231.8);
    expect(parsePrice("231.804", "stock")).toBe(231.8);
    expect(parsePrice(".5", "premium")).toBe(0.5);
    expect(parsePrice("1.", "premium")).toBe(1);
  });

  it("refuses what it can't read", () => {
    for (const typed of ["$231.80", "231,80", "-1", "1e3", "abc", ""]) {
      expect(parsePrice(typed, "stock")).toBe("Enter a price like 231.80");
    }
  });

  it("refuses 0 on stock, and takes it on premium", () => {
    expect(parsePrice("0", "stock")).toBe("A stock price must be above 0");
    expect(parsePrice("0.001", "stock")).toBe("A stock price must be above 0");
    expect(parsePrice("0", "premium")).toBe(0);
  });
});

describe("parseContracts", () => {
  it("takes a whole number of 1 or more", () => {
    expect(parseContracts("2")).toBe(2);
    for (const typed of ["0", "1.5", "-1", "", "two"]) {
      expect(parseContracts(typed)).toBe("Contracts are a whole number, 1 or more");
    }
  });
});

describe("targetId and targetIndex", () => {
  it("number targets from 1, and read the stop as no target", () => {
    expect(targetId(0)).toBe("t1");
    expect(targetIndex("t2")).toBe(1);
    expect(targetIndex("stop")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads dollars to the cent, above 0", () => {
    expect(parseAmount("120")).toBe(120);
    expect(parseAmount("104.054")).toBe(104.05);
    expect(parseAmount("0")).toBe("A planned risk must be above 0");
    for (const typed of ["$120", "-5", "abc", ""])
      expect(parseAmount(typed)).toBe("Enter an amount like 120");
  });
});

describe("approxLines", () => {
  it("draws a stock scalp's levels at the option prices R gives them, to the cent, without ids", () => {
    const risk = {
      optionAtStop: 0.5432,
      targets: [
        { optionAt: 1.2345, wrongSide: false },
        { optionAt: null, wrongSide: false },
        { optionAt: 2.5, wrongSide: false },
        { optionAt: 0.4, wrongSide: true },
      ],
    } as unknown as ScalpRisk;
    const lines = approxLines(risk);
    expect(lines.map((line) => [line.label, line.price, line.dashed])).toEqual([
      ["≈ STOP", 0.54, false],
      ["≈ T1", 1.23, false],
      ["≈ T3", 2.5, false],
    ]);
    expect(lines.every((line) => line.id === undefined)).toBe(true);
    expect(approxLines(null)).toEqual([]);
  });
});
