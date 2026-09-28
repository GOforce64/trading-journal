import { describe, expect, it } from "vitest";
import { round2, sumMoney } from "./money.js";

describe("money", () => {
  it("rounds to cents, away from zero at the half", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(512.0649)).toBe(512.06);
  });

  it("sums without float drift", () => {
    expect(sumMoney([-840, -640, 140, 140])).toBe(-1200);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
});
