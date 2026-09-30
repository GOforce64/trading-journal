import { describe, expect, it } from "vitest";
import { parseAmount, parseContracts, parsePrice, targetId, targetIndex } from "./levels.js";

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
