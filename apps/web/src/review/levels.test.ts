import { describe, expect, it } from "vitest";
import { parsePrice } from "./levels.js";

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
