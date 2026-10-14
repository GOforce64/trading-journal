import { describe, expect, it } from "vitest";
import { nyWallClock } from "./calendar.js";
import {
  calendarDays,
  canSwitchStrategy,
  heldOvernight,
  showsSwingHint,
  swingMetrics,
  swingShape,
} from "./swing.js";

const leg = (
  right: "C" | "P",
  strike: number,
  quantity: number,
  openPrice: number,
  closePrice: number | null = null,
  expiry = "2026-11-06",
) => ({ right, strike, expiry, quantity, multiplier: 100, openPrice, closePrice });

/** The spec's NVDA 230/240 call debit spread (§1): 3.80 on 2 Oct 2026, closed for 7.85 on 9 Oct 2026, $2.90 fees. */
const spread = {
  legs: [leg("C", 230, 1, 5.1, 9), leg("C", 240, -1, 1.3, 1.15)],
  netPnl: 402.1,
  openedAt: nyWallClock("2026-10-02", 10 * 60 + 15),
  closedAt: nyWallClock("2026-10-09", 11 * 60),
};

describe("swingShape", () => {
  it("names the four swing shapes", () => {
    expect(swingShape([leg("C", 230, 1, 5)])).toBe("long_call");
    expect(swingShape([leg("P", 230, 2, 5)])).toBe("long_put");
    expect(swingShape([leg("C", 230, 1, 5.1), leg("C", 240, -1, 1.3)])).toBe("call_debit_spread");
    expect(swingShape([leg("P", 240, 3, 6), leg("P", 230, -3, 2)])).toBe("put_debit_spread");
    // The order of the legs doesn't matter.
    expect(swingShape([leg("C", 240, -1, 1.3), leg("C", 230, 1, 5.1)])).toBe("call_debit_spread");
  });

  it("refuses credit verticals, uneven sizes, mixed rights or expiries, shorts and three legs", () => {
    expect(swingShape([leg("C", 230, -1, 5.1), leg("C", 240, 1, 1.3)])).toBeNull();
    expect(swingShape([leg("P", 240, -1, 6), leg("P", 230, 1, 2)])).toBeNull();
    expect(swingShape([leg("C", 230, 2, 5.1), leg("C", 240, -1, 1.3)])).toBeNull();
    expect(swingShape([leg("C", 230, 1, 5.1), leg("P", 220, -1, 1.3)])).toBeNull();
    expect(swingShape([leg("C", 230, 1, 5.1), leg("C", 240, -1, 1.3, null, "2026-11-13")])).toBeNull();
    expect(swingShape([leg("C", 230, -1, 5)])).toBeNull();
    expect(swingShape([leg("C", 230, 1, 5), leg("C", 240, -1, 1), leg("C", 250, 1, 0.5)])).toBeNull();
    expect(swingShape([])).toBeNull();
  });
});

describe("swingMetrics", () => {
  it("works out the spec's NVDA call spread", () => {
    const metrics = swingMetrics(spread, "2026-10-13");
    expect(metrics).toMatchObject({
      shape: "call_debit_spread",
      contracts: 1,
      debitPerShare: 3.8,
      debit: 380,
      width: 10,
      maxProfit: 620,
      breakEven: 233.8,
      daysHeld: 7,
      sessionsHeld: 5,
      dteAtOpen: 35,
      expiry: "2026-11-06",
    });
    expect(metrics?.pctOfMax).toBeCloseTo(0.6485, 4);
    expect(metrics?.returnOnDebit).toBeCloseTo(1.0582, 4);
  });

  it("gives a long put its break-even below the strike and no max profit", () => {
    const metrics = swingMetrics(
      {
        legs: [leg("P", 50, 2, 1.25, 2)],
        netPnl: 147.3,
        openedAt: nyWallClock("2026-10-05", 10 * 60),
        closedAt: nyWallClock("2026-10-06", 11 * 60),
      },
      "2026-10-13",
    );
    expect(metrics).toMatchObject({
      shape: "long_put",
      debit: 250,
      width: null,
      maxProfit: null,
      pctOfMax: null,
      breakEven: 48.75,
    });
    expect(metrics?.returnOnDebit).toBeCloseTo(0.5892, 4);
  });

  it("counts an open swing's days to today, with no return yet", () => {
    const metrics = swingMetrics({ ...spread, closedAt: null, netPnl: null }, "2026-10-13");
    expect(metrics).toMatchObject({ daysHeld: 11, sessionsHeld: 7, pctOfMax: null, returnOnDebit: null });
  });

  it("counts sessions across Thanksgiving: the Friday half day counts, the Thursday doesn't", () => {
    const metrics = swingMetrics(
      {
        ...spread,
        openedAt: nyWallClock("2025-11-26", 10 * 60),
        closedAt: nyWallClock("2025-12-01", 10 * 60),
      },
      "2026-10-13",
    );
    expect(metrics).toMatchObject({ daysHeld: 5, sessionsHeld: 2 });
  });

  it("uses the leg's own multiplier", () => {
    const metrics = swingMetrics(
      { ...spread, legs: [{ ...leg("C", 20, 1, 2.5), multiplier: 10 }], netPnl: null, closedAt: null },
      "2026-10-13",
    );
    expect(metrics?.debit).toBe(25);
  });

  it("has nothing for a shape that isn't a swing", () => {
    expect(swingMetrics({ ...spread, legs: [leg("C", 230, -1, 5)] }, "2026-10-13")).toBeNull();
  });
});

describe("calendarDays", () => {
  it("counts calendar days between two New York dates", () => {
    expect(calendarDays("2026-10-02", "2026-11-06")).toBe(35);
    expect(calendarDays("2026-10-02", "2026-10-02")).toBe(0);
  });
});

describe("heldOvernight", () => {
  const at = (date: string, hour: number, minute = 0) => nyWallClock(date, hour * 60 + minute);

  it("is true for a trade closed on a later New York day", () => {
    expect(heldOvernight({ openedAt: at("2026-10-02", 10), closedAt: at("2026-10-05", 10) }, 0)).toBe(true);
  });

  it("is false for one opened and closed the same day, after-hours included", () => {
    expect(heldOvernight({ openedAt: at("2026-10-02", 10), closedAt: at("2026-10-02", 16, 30) }, 0)).toBe(
      false,
    );
  });

  it("is true for an open trade once its opening day's close has passed, a Saturday included", () => {
    const open = { openedAt: at("2026-10-02", 10), closedAt: null };
    expect(heldOvernight(open, at("2026-10-02", 15, 59))).toBe(false);
    expect(heldOvernight(open, at("2026-10-02", 16, 1))).toBe(true);
    expect(heldOvernight(open, at("2026-10-03", 12))).toBe(true);
  });

  it("uses a half day's 13:00 close", () => {
    const open = { openedAt: at("2025-11-28", 10), closedAt: null };
    expect(heldOvernight(open, at("2025-11-28", 13, 1))).toBe(true);
    expect(heldOvernight(open, at("2025-11-28", 12, 59))).toBe(false);
  });
});

describe("canSwitchStrategy and showsSwingHint", () => {
  const scalp = {
    strategy: "scalp",
    chosenStrategy: null,
    book: "paper",
    legs: [{ quantity: 2 }],
    openedAt: nyWallClock("2026-10-02", 10 * 60),
    closedAt: nyWallClock("2026-10-05", 10 * 60),
  };

  it("lets only a single bought option that isn't missed switch", () => {
    expect(canSwitchStrategy(scalp)).toBe(true);
    expect(canSwitchStrategy({ ...scalp, book: "missed" })).toBe(false);
    expect(canSwitchStrategy({ ...scalp, legs: [{ quantity: 1 }, { quantity: -1 }] })).toBe(false);
    expect(canSwitchStrategy({ ...scalp, legs: [{ quantity: -1 }] })).toBe(false);
  });

  it("asks about a scalp held overnight until the user has chosen", () => {
    expect(showsSwingHint(scalp, Date.now())).toBe(true);
    expect(showsSwingHint({ ...scalp, chosenStrategy: "scalp" }, Date.now())).toBe(false);
    expect(showsSwingHint({ ...scalp, strategy: "swing", chosenStrategy: "swing" }, Date.now())).toBe(false);
    expect(showsSwingHint({ ...scalp, closedAt: scalp.openedAt + 60_000 }, Date.now())).toBe(false);
  });
});
