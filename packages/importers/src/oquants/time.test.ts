import { describe, expect, it } from "vitest";
import { parseOquantsDate, zonedTimeToEpoch } from "./time.js";

describe("parseOquantsDate", () => {
  it("reads oQuants' date text, ignoring the holding-days suffix", () => {
    expect(parseOquantsDate("Sep 10, 8:44 PM\n(1d)")).toEqual({ month: 9, day: 10, hour: 20, minute: 44 });
  });

  it("handles midnight and noon", () => {
    expect(parseOquantsDate("Sep 9, 12:05 AM")).toEqual({ month: 9, day: 9, hour: 0, minute: 5 });
    expect(parseOquantsDate("Sep 9, 12:30 PM")).toEqual({ month: 9, day: 9, hour: 12, minute: 30 });
  });

  it("returns null for anything else", () => {
    expect(parseOquantsDate("yesterday")).toBeNull();
    expect(parseOquantsDate("")).toBeNull();
  });
});

describe("zonedTimeToEpoch", () => {
  it("converts summer time in Athens (UTC+3)", () => {
    expect(zonedTimeToEpoch(2026, { month: 9, day: 9, hour: 20, minute: 54 }, "Europe/Athens")).toBe(
      Date.UTC(2026, 8, 9, 17, 54),
    );
  });

  it("converts winter time in New York (UTC-5)", () => {
    expect(zonedTimeToEpoch(2026, { month: 1, day: 5, hour: 9, minute: 30 }, "America/New_York")).toBe(
      Date.UTC(2026, 0, 5, 14, 30),
    );
  });
});
