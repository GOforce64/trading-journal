import { describe, expect, it } from "vitest";
import { premiumPaid, returnOnCost } from "./risk.js";
import { EMOTIONS, MISTAKES, SCALPS, SETUP_NAMES, scalp } from "./scalpStats.fixture.js";
import {
  type Breakdown,
  bucketStats,
  type ClosedScalp,
  cumulativeR,
  holdMinutes,
  holdTimeBucket,
  minutesAfterOpen,
  mistakeCost,
  openBucket,
  rCoverage,
  scalpBreakdown,
  scalpSummary,
  setupCards,
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

const CONTEXT = {
  setups: SETUP_NAMES,
  emotions: EMOTIONS,
  costEdges: [250, 500, 1000],
  contractEdges: [2, 4, 6],
};

describe("scalpBreakdown", () => {
  const cells = (by: Breakdown, trades = SCALPS) =>
    scalpBreakdown(trades, by, CONTEXT).map((row) => [row.label, row.trades, row.net]);

  it("by setup: net, best first, with no setup last", () => {
    expect(cells("setup")).toEqual([
      ["ORB breakout", 3, 50],
      ["VWAP reclaim", 1, 30],
      ["no setup", 1, -70],
    ]);
    const orb = scalpBreakdown(SCALPS, "setup", CONTEXT)[0];
    expect(orb).toMatchObject({ winRate: 1 / 3, avgR: 0.17, rCount: 3, returnCount: 3 });
    expect(orb?.avgReturn).toBeCloseTo((0.5 - 0.25 + 0) / 3, 10);
  });

  it("names a setup the context doesn't know as unknown setup", () => {
    expect(cells("setup", [scalp({ id: "x", setupId: "gone" })])).toEqual([["unknown setup", 1, 0]]);
  });

  it("by ticker, DTE, side, grade, weekday, book and month, in their own orders", () => {
    expect(cells("ticker")).toEqual([
      ["NVDA", 2, 50],
      ["SPY", 2, 30],
      ["QQQ", 1, -70],
    ]);
    expect(cells("dte")).toEqual([
      ["0", 3, 50],
      ["1", 1, 30],
      ["2–7", 1, -70],
    ]);
    expect(cells("side")).toEqual([
      ["Calls", 3, 130],
      ["Puts", 2, -120],
    ]);
    expect(cells("grade")).toEqual([
      ["A", 2, 30],
      ["B", 1, -50],
      ["C", 1, 0],
      ["ungraded", 1, 30],
    ]);
    expect(cells("weekday")).toEqual([
      ["Mon", 3, 80],
      ["Tue", 2, -70],
    ]);
    expect(cells("book")).toEqual([
      ["Live", 4, -20],
      ["Paper", 1, 30],
    ]);
    expect(cells("month")).toEqual([["Sep 2026", 5, 10]]);
  });

  it("by option cost and contracts, with the given edges", () => {
    expect(cells("cost")).toEqual([
      ["< $250", 3, 50],
      ["$250–500", 1, 30],
      ["$500–1,000", 1, -70],
    ]);
    expect(cells("contracts")).toEqual([
      ["1", 2, 30],
      ["2–3", 3, -20],
    ]);
  });

  it("puts a scalp that isn't a single long option under unknown cost, last, with no return", () => {
    const spread = scalp({
      id: "x",
      netPnl: 40,
      legs: [
        { right: "C", expiry: "2026-09-28", quantity: 1, multiplier: 100, openPrice: 2 },
        { right: "C", expiry: "2026-09-28", quantity: -1, multiplier: 100, openPrice: 1 },
      ],
    });
    const rows = scalpBreakdown([...SCALPS, spread], "cost", CONTEXT);
    expect(rows.at(-1)).toMatchObject({ label: "unknown", trades: 1, avgReturn: null, returnCount: 0 });
  });

  it("by emotion, counting a scalp with two emotions under both, and none last", () => {
    expect(cells("emotion")).toEqual([
      ["Calm", 2, 130],
      ["none", 3, -120],
    ]);
    const context = { ...CONTEXT, emotions: new Map([...EMOTIONS, ["bored", "Bored"]]) };
    const both = scalp({ id: "x", netPnl: 20, tagIds: ["calm", "bored", "chased"] });
    expect(scalpBreakdown([both], "emotion", context).map((row) => [row.label, row.trades])).toEqual([
      ["Calm", 1],
      ["Bored", 1],
    ]);
  });

  it("folds tickers past 10 into the best 5, the others, and the worst 5", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      scalp({ id: `t${index}`, underlying: `T${index}`, netPnl: 100 - index }),
    );
    const labels = scalpBreakdown(many, "ticker", CONTEXT).map((row) => row.label);
    expect(labels).toEqual(["T0", "T1", "T2", "T3", "T4", "2 others", "T7", "T8", "T9", "T10", "T11"]);
  });
});

describe("mistakeCost", () => {
  it("sets each mistake's scalps against the rest, worst net first, then no mistakes", () => {
    const rows = mistakeCost(SCALPS, MISTAKES);
    expect(rows.map((row) => [row.label, row.withTag?.net, row.withoutTag?.net])).toEqual([
      ["Moved stop", -70, 80],
      ["Chased entry", -20, 30],
      ["no mistakes", 100, -90],
    ]);
    expect(rows[1]?.withTag).toMatchObject({ trades: 2, avgR: -0.5, rCount: 1, winRate: 0.5 });
    expect(rows[1]?.withoutTag).toMatchObject({ trades: 3, avgR: 0.5, rCount: 2 });
    expect(rows[0]?.withTag?.avgR).toBeNull();
    expect(rows[2]).toMatchObject({ tagId: null, withTag: { trades: 2, avgR: 0.5 } });
  });

  it("leaves a side empty when every scalp carries the tag, and returns nothing without mistakes", () => {
    const tagged = [scalp({ id: "a", tagIds: ["chased"] }), scalp({ id: "b", tagIds: ["chased"] })];
    const [chased, clean] = mistakeCost(tagged, MISTAKES);
    expect(chased?.withoutTag).toBeNull();
    expect(clean?.withTag).toBeNull();
    expect(mistakeCost([scalp({ id: "a", tagIds: ["calm"] })], MISTAKES)).toEqual([]);
  });
});

describe("cumulativeR", () => {
  it("adds up R in close order over the scalps that have one", () => {
    expect(cumulativeR(SCALPS).map((point) => [point.id, point.value, point.total])).toEqual([
      ["S1", 1, 1],
      ["S2", -0.5, 0.5],
      ["S5", 0, 0.5],
    ]);
  });
});

describe("setupCards", () => {
  const fly = (id: string, netPnl: number, closed: string): ClosedScalp => ({
    ...scalp({ id, netPnl, setupId: "crush", closedAt: ny(closed), openedAt: ny(closed) - 86_400_000 }),
    strategy: "iron_fly",
    fees: 4,
    risk: null,
    ironFly: {
      contracts: 1,
      creditPerShare: 2.04,
      bodyPutStrike: 10,
      bodyCallStrike: 10,
      putWingStrike: 9,
      callWingStrike: 11,
    },
  });
  const names = new Map([...SETUP_NAMES, ["crush", "Earnings IV crush"]]);
  const flies = [fly("F1", 100, "2026-09-10 09:45"), fly("F2", -50, "2026-09-17 09:45")];

  it("makes a card per setup, most trades first: a scalp card with R, a fly card with % kept", () => {
    const cards = setupCards([...SCALPS, ...flies], names);
    expect(cards.map((card) => [card.setupId, card.kind, card.trades])).toEqual([
      ["orb", "scalp", 3],
      ["crush", "fly", 2],
      ["vwap", "scalp", 1],
    ]);
    const [orb, crush, vwap] = cards;
    expect(orb).toMatchObject({ avgR: 0.17, rCount: 3, kept: null, lastClosedAt: ny("2026-09-29 09:25") });
    expect(orb?.points.map((point) => point.total)).toEqual([1, 0.5, 0.5]);
    // Max profit 204 − 4 = 200 each: (100 − 50) ÷ 400.
    expect(crush).toMatchObject({ kept: 0.125, profitFactor: 2 });
    expect(crush?.points.map((point) => point.total)).toEqual([100, 50]);
    expect(vwap).toMatchObject({ avgR: null, rCount: 0, points: [] });
  });

  it("breaks a tie in trades by name, and gives a setup with a scalp the scalp card", () => {
    const cards = setupCards(
      [
        scalp({ id: "a", setupId: "vwap" }),
        scalp({ id: "b", setupId: "orb" }),
        { ...flies[0], setupId: "orb" } as ClosedScalp,
      ],
      names,
    );
    expect(cards.map((card) => [card.setupId, card.kind])).toEqual([
      ["orb", "scalp"],
      ["vwap", "scalp"],
    ]);
  });
});
