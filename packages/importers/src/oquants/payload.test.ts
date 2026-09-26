import { describe, expect, it } from "vitest";
import { oquantsPayloadSchema } from "./payload.js";

const minimal = {
  format: "oquants-cells/1",
  capturedAt: "2026-09-23T15:00:00.000Z",
  timeZone: "Europe/Athens",
  pageCounter: "1–1 of 1",
  headers: ["Instrument"],
  trades: [],
};

describe("oquantsPayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(oquantsPayloadSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects another format", () => {
    expect(oquantsPayloadSchema.safeParse({ ...minimal, format: "something-else" }).success).toBe(false);
  });

  it("rejects an unknown time zone", () => {
    expect(oquantsPayloadSchema.safeParse({ ...minimal, timeZone: "Mars/Olympus" }).success).toBe(false);
  });
});
