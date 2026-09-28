import { describe, expect, it } from "vitest";
import type { FillResult } from "./api.js";
import { etMinute, fillSummary, ivPct, lastReason, MOVE_COPY, movePct, priceNote } from "./moves.js";

const THURSDAY_CLOSE = Date.UTC(2026, 8, 10, 19, 44); // Thu Sep 10, 15:44 ET
const LATER = Date.UTC(2026, 8, 28, 16, 0);
const note = (overrides: Partial<Parameters<typeof priceNote>[0]> = {}) =>
  priceNote({
    at: THURSDAY_CLOSE,
    fetching: false,
    marketOn: true,
    lastReason: null,
    now: LATER,
    ...overrides,
  });

describe("priceNote", () => {
  it("says a fill is running before anything else", () => {
    expect(note({ fetching: true })).toBe(MOVE_COPY.fetching);
  });

  it("knows a weekend by itself", () => {
    expect(note({ at: Date.UTC(2026, 8, 12, 15, 0) })).toBe("Not a trading day; type the moves in Edit.");
  });

  it("knows a price from the last 16 minutes isn't out yet", () => {
    expect(note({ now: THURSDAY_CLOSE + 10 * 60_000 })).toBe(
      "Alpaca shares prices 15 min after the fact; try Fill in missing later.",
    );
  });

  it("asks for a key when none is set up", () => {
    expect(note({ marketOn: false })).toBe("Add an Alpaca key in Settings to fetch stock prices.");
  });

  it("passes on the last fill's reason, or says the price hasn't been fetched", () => {
    expect(note({ lastReason: "no_bars" })).toBe(
      "Alpaca has no price for this time; type the moves in Edit.",
    );
    expect(note()).toBe("Not fetched yet.");
  });
});

describe("lastReason", () => {
  const result = (reason: "no_bars" | "too_recent"): FillResult => ({
    filled: 0,
    missing: [{ tradeId: "t1", underlying: "M", side: "exit", reason }],
    unavailable: null,
  });

  it("takes the newest fill that tried that trade's side", () => {
    expect(lastReason([result("too_recent"), result("no_bars")], "t1", "exit")).toBe("no_bars");
    expect(lastReason([result("no_bars")], "t1", "entry")).toBeNull();
    expect(lastReason([result("no_bars")], "t2", "exit")).toBeNull();
  });
});

describe("fillSummary", () => {
  const gap = { tradeId: "t1", underlying: "M", side: "exit", reason: "no_bars" } as const;

  it("counts what was filled out of what was tried", () => {
    expect(
      fillSummary({ filled: 80, missing: [gap, gap], unavailable: null }, ", see the Iron flies tab"),
    ).toBe("Filled 80 of 82 stock prices. 2 missing, see the Iron flies tab.");
    expect(fillSummary({ filled: 1, missing: [], unavailable: null })).toBe("Filled 1 of 1 stock price.");
  });

  it("says when there was nothing to fill", () => {
    expect(fillSummary({ filled: 0, missing: [], unavailable: null })).toBe(
      "Nothing to fill: every fly has its stock prices.",
    );
  });

  it("passes on why Alpaca couldn't help", () => {
    const noKey = { reason: "no_key", message: MOVE_COPY.noKey } as const;
    expect(fillSummary({ filled: 0, missing: [], unavailable: noKey })).toBe(MOVE_COPY.noKey);
    const down = {
      reason: "unreachable",
      message: "Alpaca didn't answer. Try Fill in missing again in a moment.",
    } as const;
    expect(fillSummary({ filled: 3, missing: [], unavailable: down })).toBe(
      "Filled 3 stock prices. Alpaca didn't answer. Try Fill in missing again in a moment.",
    );
  });
});

describe("formatting", () => {
  it("shows moves to one decimal, spelling out the sign when asked", () => {
    expect(movePct(0.0729455)).toBe("7.3%");
    expect(movePct(-0.0533241, true)).toBe("−5.3%");
    expect(movePct(0.18, true)).toBe("+18.0%");
    expect(ivPct(1.2346)).toBe("123%");
  });

  it("names the minute a price was read, in New York time", () => {
    expect(etMinute(Date.UTC(2026, 8, 9, 19, 54))).toBe("Sep 9 15:54");
  });
});
