import { nyWallClock } from "@tj/core";
import { describe, expect, it } from "vitest";
import { arriveBy, clockText, contractName, contractOf, viewOf } from "./option.js";

const SCALP = {
  underlying: "NVDA",
  legs: [{ right: "C", strike: 232.5, expiry: "2026-09-26" }],
};

describe("the option view's helpers", () => {
  it("names a scalp's contract as Alpaca does, and as a trader reads it", () => {
    expect(contractOf(SCALP)).toBe("NVDA260926C00232500");
    expect(contractName(SCALP)).toBe("NVDA 232.5C Sep 26");
    expect(contractOf({ underlying: "AA", legs: [...SCALP.legs, ...SCALP.legs] })).toBeNull();
    expect(contractOf({ underlying: "AA", legs: [] })).toBeNull();
  });

  it("opens on the basis's view, and says when today's bars arrive", () => {
    expect(viewOf("premium")).toBe("option");
    expect(viewOf("stock")).toBe("stock");
    const opened = nyWallClock("2026-10-07", 592) + 40_000; // 09:52:40
    expect(clockText(opened)).toBe("09:52");
    expect(arriveBy(opened, 16)).toBe("10:08");
    expect(arriveBy(opened, 80)).toBe("11:12");
  });
});
