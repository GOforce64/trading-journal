import { describe, expect, it } from "vitest";
import { contractText, missingList, needsText } from "./text.js";

describe("the review's words", () => {
  it("says what a scalp still needs", () => {
    expect(needsText(["setup", "grade", "stop"])).toBe("needs a setup, a grade and a stop");
    expect(needsText(["setup", "stop"])).toBe("needs a setup and a stop");
    expect(needsText(["stop"])).toBe("needs a stop");
    expect(needsText([])).toBe("");
  });

  it("lists what's missing for the Dashboard", () => {
    expect(missingList(["setup", "stop"])).toBe("setup, stop");
  });

  it("names the contract", () => {
    expect(contractText({ underlying: "NVDA", legs: [{ strike: 232.5, right: "C" }] })).toBe("NVDA 232.5C");
    expect(contractText({ underlying: "NVDA", legs: [] })).toBe("NVDA");
  });
});
