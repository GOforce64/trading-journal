import { describe, expect, it } from "vitest";
import { premiumPaid, returnOnCost } from "./risk.js";
import { SCALPS, scalp } from "./scalpStats.fixture.js";
import {
  bucketStats,
  holdMinutes,
  holdTimeBucket,
  minutesAfterOpen,
  openBucket,
  rCoverage,
  scalpSummary,
} from "./scalpStats.js";
import { groupTrades } from "./splits.js";
import { ny } from "./stats.fixture.js";

describe("time buckets", () => {
  it("counts minutes after the open by the New York minute, each bucket including its lower edge", () => {
    expect(minutesAfterOpen(ny("2026-09-28 09:30"))).toBe(0);
    expect(minutesAfterOpen(ny("2026-09-28 09:34") + 59_000)).toBe(4);
    expect(openBucket(minutesAfterOpen(ny("2026-09-28 09:34") + 59_000))).toBe("0–5");
    expect(openBucket(minutesAfterOpen(ny("2026-09-28 09:35")))).toBe("5–15");
    expect(openBucket(15)).toBe("15–30");
    expect(openBucket(30)).toBe("30–60");
    expect(openBucket(60)).toBe("60+");
    expect(openBucket(minutesAfterOpen(ny("2026-09-28 09:20")))).toBe("before open");
  });

  it("reads New York's clock in winter too, when it runs 5 hours behind UTC", () => {
    expect(minutesAfterOpen(Date.parse("2026-12-01T14:35:00Z"))).toBe(5);
  });

  it("buckets hold time: under a minute, then 1–3, 3–10, 10–30 and 30+ minutes", () => {
    const opened = ny("2026-09-28 09:31");
    expect(holdTimeBucket(holdMinutes({ openedAt: opened, closedAt: opened + 59_000 }))).toBe("< 1 min");
    expect(holdTimeBucket(holdMinutes({ openedAt: opened, closedAt: opened + 60_000 }))).toBe("1–3");
    expect(holdTimeBucket(3)).toBe("3–10");
    expect(holdTimeBucket(29.99)).toBe("10–30");
    expect(holdTimeBucket(30)).toBe("30+");
    expect(holdTimeBucket(-1)).toBe("unknown");
  });
});

describe("groupTrades", () => {
  it("counts a trade under each of its labels once, in the given order, with unknown last", () => {
    const groups = groupTrades(
      [
        { id: "a", labels: ["y", "x", "x"] },
        { id: "b", labels: ["unknown"] },
        { id: "c", labels: ["z"] },
      ],
      (item) => item.labels,
      ["x", "y"],
    );
    expect(groups.map(([label, items]) => [label, items.map((item) => item.id)])).toEqual([
      ["x", ["a"]],
      ["y", ["a"]],
      ["z", ["c"]],
      ["unknown", ["b"]],
    ]);
  });
});

describe("premiumPaid", () => {
  it("is contracts × multiplier × entry premium for a single long option, and null otherwise", () => {
    expect(premiumPaid(scalp({ id: "a" }))).toBe(200);
    expect(premiumPaid({ ...scalp({ id: "a" }), strategy: "iron_fly" })).toBeNull();
    expect(returnOnCost(scalp({ id: "a", netPnl: 50 }))).toBe(0.25);
  });
});

describe("scalpSummary", () => {
  it("adds avg return, the hold and R coverage to the headline numbers", () => {
    const summary = scalpSummary(SCALPS);
    expect(summary.net).toBe(10);
    expect(summary.winRate).toBe(0.4);
    expect(summary.profitFactor).toBeCloseTo(130 / 120, 10);
    expect(summary.avgR).toBe(0.17);
    expect(summary.rCount).toBe(3);
    expect(summary.avgReturn).toBeCloseTo((0.5 - 0.25 + 0.1 - 70 / 600 + 0) / 5, 10);
    expect(summary.returnCount).toBe(5);
    expect(summary.avgHoldMinutes).toBe(13.5);
    expect(summary.medianHoldMinutes).toBe(5);
    expect(summary.coverage).toEqual({ total: 5, withR: 3, noStop: 1, noStockPrice: 1, cannotPrice: 0 });
  });

  it("reads null for every average without scalps", () => {
    const summary = scalpSummary([]);
    expect([summary.avgReturn, summary.avgHoldMinutes, summary.medianHoldMinutes, summary.avgR]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("counts any other reason for no R as can't be priced, a missing risk included", () => {
    expect(
      rCoverage([
        scalp({ id: "a", risk: { r: null, problem: "wrong_side" } }),
        scalp({ id: "b", risk: { r: null, problem: "cannot_price" } }),
        scalp({ id: "c", risk: null }),
      ]),
    ).toEqual({ total: 3, withR: 0, noStop: 0, noStockPrice: 0, cannotPrice: 3 });
  });

  it("takes the median of an even count as the mean of the middle two", () => {
    expect(scalpSummary(SCALPS.slice(0, 4)).medianHoldMinutes).toBe((2 + 15) / 2);
  });
});

describe("bucketStats", () => {
  const cells = (by: "open" | "hold") =>
    bucketStats(SCALPS, by).map((row) => [row.label, row.trades, row.net, row.avgR]);

  it("keeps all five buckets after the open, with before open first when it has scalps", () => {
    expect(cells("open")).toEqual([
      ["before open", 1, 0, 0],
      ["0–5", 1, 100, 1],
      ["5–15", 1, -50, -0.5],
      ["15–30", 1, 30, null],
      ["30–60", 0, 0, null],
      ["60+", 1, -70, null],
    ]);
    const empty = bucketStats(SCALPS, "open")[4];
    expect(empty?.winRate).toBeNull();
  });

  it("buckets the hold, leaving out before open and unknown when nothing falls there", () => {
    expect(cells("hold")).toEqual([
      ["< 1 min", 1, -50, -0.5],
      ["1–3", 1, 100, 1],
      ["3–10", 1, 0, 0],
      ["10–30", 1, 30, null],
      ["30+", 1, -70, null],
    ]);
    expect(bucketStats([], "hold").map((row) => row.trades)).toEqual([0, 0, 0, 0, 0]);
  });

  it("shows unknown last for a close before the open", () => {
    const backwards = scalp({ id: "x", openedAt: ny("2026-09-28 10:00"), closedAt: ny("2026-09-28 09:59") });
    expect(bucketStats([backwards], "hold").at(-1)).toMatchObject({ label: "unknown", trades: 1 });
  });
});
