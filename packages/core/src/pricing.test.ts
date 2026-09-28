import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bsPrice, impliedVol, intrinsic, normCdf, yearsToExpiry } from "./pricing.js";

describe("normCdf", () => {
  it("matches the standard normal table", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  });
});

describe("bsPrice", () => {
  it("gives the textbook values for S = K = 100, one year, 5% and 20% volatility", () => {
    expect(bsPrice("C", 100, 100, 1, 0.2, 0.05)).toBeCloseTo(10.4506, 4);
    expect(bsPrice("P", 100, 100, 1, 0.2, 0.05)).toBeCloseTo(5.5735, 4);
  });

  it("is intrinsic value with no time or no volatility left", () => {
    expect(bsPrice("P", 8.21, 8.5, 0, 0.5)).toBeCloseTo(0.29, 10);
    expect(bsPrice("C", 8.21, 8.5, 0.1, 0)).toBe(0);
  });
});

describe("impliedVol", () => {
  it("solves back the volatility a price was made with", () => {
    const price = bsPrice("C", 50, 55, 30 / 365, 0.8);
    expect(impliedVol({ right: "C", price, S: 50, K: 55, T: 30 / 365 })).toBeCloseTo(0.8, 6);
  });

  it("round-trips any option with time value left (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"C" | "P">("C", "P"),
        fc.double({ min: 5, max: 500, noNaN: true }),
        fc.double({ min: 0.9, max: 1.1, noNaN: true }),
        fc.double({ min: 7 / 365, max: 1, noNaN: true }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        (right, S, moneyness, T, sigma) => {
          const K = S * moneyness;
          const price = bsPrice(right, S, K, T, sigma);
          fc.pre(price > intrinsic(right, S, K) + 0.01);
          const solved = impliedVol({ right, price, S, K, T });
          expect(solved).not.toBeNull();
          expect(Math.abs((solved ?? 0) - sigma)).toBeLessThan(1e-4);
        },
      ),
    );
  });

  it("is null with no time left", () => {
    expect(impliedVol({ right: "C", price: 1, S: 20, K: 20, T: 0 })).toBeNull();
  });

  it("is null at or within half a cent of intrinsic value", () => {
    expect(impliedVol({ right: "P", price: 0.29, S: 8.21, K: 8.5, T: 0.01 })).toBeNull();
    expect(impliedVol({ right: "P", price: 0.294, S: 8.21, K: 8.5, T: 0.01 })).toBeNull();
  });

  it("is null when only a volatility above 1000% would explain the price", () => {
    expect(impliedVol({ right: "C", price: 19, S: 20, K: 20, T: 1 / 365 })).toBeNull();
  });
});

describe("yearsToExpiry", () => {
  it("counts 365-day years to 16:00 New York on the expiry date", () => {
    expect(yearsToExpiry(Date.UTC(2026, 8, 10, 20, 0), "2026-09-11")).toBeCloseTo(1 / 365, 12);
  });
});
