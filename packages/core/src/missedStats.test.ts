import { describe, expect, it } from "vitest";
import {
  type MissedStatTrade,
  missedBreakdown,
  missedRows,
  missedSummary,
  takenVsMissed,
  withMissed,
  withMissedGroups,
} from "./missedStats.js";
import { SCALPS, scalp } from "./scalpStats.fixture.js";
import { type BreakdownRow, groupStats, scalpBreakdown } from "./scalpStats.js";
import { ny } from "./stats.fixture.js";
import { closedTrades, summarize } from "./stats.js";

const SKIPS = new Map([
  ["hes", "Hesitated"],
  ["late", "Saw it late"],
]);
const SETUPS = new Map([
  ["orb", "ORB breakout"],
  ["vwap", "VWAP reclaim"],
]);

function missed(overrides: Partial<MissedStatTrade> & { id: string; r: number | null; mfe?: number | null }) {
  const { r, mfe = null, ...rest } = overrides;
  return {
    underlying: "NVDA",
    openedAt: ny("2026-09-28 09:41"),
    closedAt: r == null ? null : ny("2026-09-28 09:58"),
    setupId: null,
    grade: null,
    tagIds: [],
    missedRisk: { r, mfe },
    ...rest,
  } satisfies MissedStatTrade;
}

/*
 * id  setup ticker opened (NY)  R      MFE   skip   grade
 * M1  orb   NVDA   Mon 09:41    +2.39  3.1   hes    B
 * M2  vwap  TSLA   Mon 10:22    +1.15  1.8   late   A
 * M3  orb   SPY    Tue 09:36    −1     0.4   hes    C
 * M4  —     QQQ    Tue 09:48    −0.84  0.22  late   C
 * M5  orb   NVDA   Wed 09:33    —      —     hes    —      (no exit)
 */
const MISSED: MissedStatTrade[] = [
  missed({ id: "M1", setupId: "orb", r: 2.39, mfe: 3.1, tagIds: ["hes"], grade: "B" }),
  missed({
    id: "M2",
    setupId: "vwap",
    underlying: "TSLA",
    openedAt: ny("2026-09-28 10:22"),
    r: 1.15,
    mfe: 1.8,
    tagIds: ["late"],
    grade: "A",
  }),
  missed({
    id: "M3",
    setupId: "orb",
    underlying: "SPY",
    openedAt: ny("2026-09-29 09:36"),
    r: -1,
    mfe: 0.4,
    tagIds: ["hes"],
    grade: "C",
  }),
  missed({
    id: "M4",
    underlying: "QQQ",
    openedAt: ny("2026-09-29 09:48"),
    r: -0.84,
    mfe: 0.22,
    tagIds: ["late"],
    grade: "C",
  }),
  missed({ id: "M5", setupId: "orb", openedAt: ny("2026-09-30 09:33"), r: null, tagIds: ["hes"] }),
];

describe("missedSummary", () => {
  it("adds up what hesitating cost, and the good skips", () => {
    const summary = missedSummary(MISSED, SKIPS);
    expect(summary).toMatchObject({
      trades: 5,
      rCount: 4,
      wins: 2,
      losses: 2,
      scratches: 0,
      winRate: 0.5,
      goodSkips: 2,
    });
    expect(summary.totalR).toBeCloseTo(1.7, 9);
    expect(summary.avgR).toBeCloseTo(0.425, 9);
    expect(summary.goodSkipsR).toBeCloseTo(-1.84, 9);
    expect(summary.avgMfe).toBeCloseTo((3.1 + 1.8 + 0.4 + 0.22) / 4, 9);
  });

  it("names the reason with the most trades, ties broken by name", () => {
    expect(missedSummary(MISSED, SKIPS).topReason).toMatchObject({ tagId: "hes", trades: 3 });
    expect(missedSummary(MISSED, SKIPS).topReason?.totalR).toBeCloseTo(1.39, 9);
    // One each: "Hesitated" sorts before "Saw it late".
    expect(missedSummary([MISSED[1], MISSED[0]] as MissedStatTrade[], SKIPS).topReason?.tagId).toBe("hes");
  });

  it("has nothing to average without trades", () => {
    expect(missedSummary([], SKIPS)).toMatchObject({
      trades: 0,
      rCount: 0,
      winRate: null,
      totalR: 0,
      avgR: null,
      avgMfe: null,
      topReason: null,
    });
  });
});

describe("missedBreakdown", () => {
  it("groups by skip reason, the trades without one last", () => {
    const rows = missedBreakdown([...MISSED, missed({ id: "M6", r: 0.5 })], "skip", {
      setups: SETUPS,
      skips: SKIPS,
    });
    expect(rows.map((row) => [row.label, row.trades, row.rCount])).toEqual([
      ["Hesitated", 3, 2],
      ["Saw it late", 2, 2],
      ["no reason", 1, 1],
    ]);
    expect(rows[0]?.winRate).toBe(0.5);
    expect(rows[0]?.totalR).toBeCloseTo(1.39, 9);
  });

  it("groups by setup, by total R, with no setup last", () => {
    const rows = missedBreakdown(MISSED, "setup", { setups: SETUPS, skips: SKIPS });
    expect(rows.map((row) => row.label)).toEqual(["ORB breakout", "VWAP reclaim", "no setup"]);
  });

  it("keeps the time buckets and weekdays in their own order", () => {
    const names = { setups: SETUPS, skips: SKIPS };
    expect(missedBreakdown(MISSED, "open", names).map((row) => row.label)).toEqual([
      "0–5",
      "5–15",
      "15–30",
      "30–60",
    ]);
    expect(missedBreakdown(MISSED, "weekday", names).map((row) => row.label)).toEqual(["Mon", "Tue", "Wed"]);
    expect(missedBreakdown(MISSED, "grade", names).map((row) => row.label)).toEqual([
      "A",
      "B",
      "C",
      "ungraded",
    ]);
  });
});

describe("takenVsMissed", () => {
  it("sets each setup's taken trades beside its missed ones, with how many were taken", () => {
    const rows = takenVsMissed(SCALPS, MISSED, SETUPS);
    const orb = rows.find((row) => row.setupId === "orb");
    // Taken: S1, S2, S5. Missed: M1, M3, M5.
    expect(orb?.taken).toEqual({ trades: 3, winRate: 1 / 3, avgR: 0.17 });
    expect(orb?.missed.trades).toBe(3);
    expect(orb?.missed.winRate).toBe(0.5);
    expect(orb?.took).toBe(0.5);
    const vwap = rows.find((row) => row.setupId === "vwap");
    expect(vwap?.took).toBe(0.5);
    expect(rows.at(-1)?.setupId).toBeNull();
  });

  it("gives a setup with only missed trades a took of 0", () => {
    const rows = takenVsMissed([], [missed({ id: "M", setupId: "orb", r: 1 })], SETUPS);
    expect(rows).toEqual([
      {
        setupId: "orb",
        label: "ORB breakout",
        taken: { trades: 0, winRate: null, avgR: null },
        missed: { trades: 1, winRate: 1, avgR: 1 },
        took: 0,
      },
    ]);
  });
});

describe("withMissed", () => {
  const taken = closedTrades([
    scalp({ id: "T1", netPnl: 40, risk: { r: 1.005, problem: null } }),
    scalp({ id: "T2", netPnl: 0, risk: { r: 0, problem: null } }),
  ]);
  const extra = [missed({ id: "M", r: 0.333 }), missed({ id: "N", r: null })];

  it("never moves a dollar figure", () => {
    const alone = summarize(taken);
    const mixed = withMissed(taken, extra);
    for (const key of [
      "net",
      "grossWins",
      "grossLosses",
      "fees",
      "beforeFees",
      "profitFactor",
      "expectancy",
      "avgWin",
      "avgLoss",
      "maxDrawdown",
    ] as const) {
      expect(mixed[key]).toEqual(alone[key]);
    }
  });

  it("counts the missed trades with an R, and averages R from the raw values", () => {
    const mixed = withMissed(taken, extra);
    expect(mixed).toMatchObject({ trades: 3, wins: 2, losses: 0, scratches: 1, rCount: 3 });
    expect(mixed.winRate).toBeCloseTo(2 / 3, 9);
    // (1.005 + 0 + 0.333) ÷ 3 = 0.446 → 0.45, where reusing the taken trades' rounded 0.5 would give 0.44.
    expect(mixed.avgR).toBe(0.45);
  });

  it("works with no taken trades at all", () => {
    const mixed = withMissed([], extra);
    expect(mixed.net).toBe(0);
    expect(mixed.trades).toBe(1);
    expect(mixed.avgR).toBe(0.33);
  });
});

describe("missedRows and withMissedGroups", () => {
  const context = {
    setups: SETUPS,
    emotions: new Map([["calm", "Calm"]]),
    costEdges: [100, 250],
    contractEdges: [2, 5],
  };

  it("labels missed trades the way the scalps' breakdown does", () => {
    expect(missedRows(MISSED, "setup", context)?.map((row) => row.label)).toEqual([
      "ORB breakout",
      "VWAP reclaim",
      "no setup",
    ]);
    expect(missedRows(MISSED, "book", context)?.map((row) => [row.label, row.trades])).toEqual([
      ["Missed", 5],
    ]);
    expect(missedRows(MISSED, "open", context)?.map((row) => row.label)).toEqual([
      "0–5",
      "5–15",
      "15–30",
      "30–60",
    ]);
  });

  it("has no rows for the dimensions only a contract has", () => {
    for (const by of ["dte", "side", "cost", "contracts"] as const)
      expect(missedRows(MISSED, by, context)).toBeNull();
  });

  it("adds missed trades to N, win % and avg R, and leaves the dollars alone", () => {
    const rows = scalpBreakdown(SCALPS, "setup", context);
    const merged = withMissedGroups(rows, missedRows(MISSED, "setup", context) ?? []);
    const orb = merged.find((row) => row.label === "ORB breakout");
    const before = rows.find((row) => row.label === "ORB breakout") as BreakdownRow;
    // Taken ORB: 3 trades, 1 win, avg R 0.17 over 3. Missed ORB with an R: M1 (+2.39) and M3 (−1).
    // (0.17 × 3 + 1.39) ÷ 5 = 0.38.
    expect(orb?.trades).toBe(5);
    expect(orb?.winRate).toBeCloseTo(2 / 5, 9);
    expect(orb?.avgR).toBe(0.38);
    expect(orb?.rCount).toBe(5);
    expect(orb?.net).toBe(before.net);
    expect(orb?.profitFactor).toBe(before.profitFactor);
    expect(orb?.avgReturn).toBe(before.avgReturn);
  });

  it("appends a group only missed trades have, with blank dollars", () => {
    const merged = withMissedGroups(
      scalpBreakdown(SCALPS, "book", context),
      missedRows(MISSED, "book", context) ?? [],
    );
    expect(merged.at(-1)).toMatchObject({
      label: "Missed",
      trades: 4,
      rCount: 4,
      winRate: 0.5,
      avgR: 0.43,
      net: null,
      profitFactor: null,
      avgReturn: null,
      missedOnly: true,
    });
  });

  const takenRow = (label: string) => ({
    label,
    ...groupStats([]),
    trades: 1,
    rCount: 1,
    avgR: 1,
    winRate: 1,
  });
  const missedRow = (label: string) => ({
    label,
    trades: 1,
    rCount: 1,
    wins: 1,
    losses: 0,
    winRate: 1,
    totalR: 1,
    avgR: 1,
    avgMfe: null,
  });
  const labels = (by: Parameters<typeof missedRows>[1], taken: string[], missed: string[]) =>
    withMissedGroups(taken.map(takenRow), missed.map(missedRow), by).map((row) => row.label);

  it("puts a group only missed trades have in its dimension's order", () => {
    expect(labels("weekday", ["Mon", "Wed"], ["Tue", "Fri"])).toEqual(["Mon", "Tue", "Wed", "Fri"]);
    expect(labels("open", ["0–5", "60+"], ["before open", "5–15"])).toEqual([
      "before open",
      "0–5",
      "5–15",
      "60+",
    ]);
    expect(labels("grade", ["A", "C"], ["B", "ungraded"])).toEqual(["A", "B", "C", "ungraded"]);
    // "no setup" stays last, and a setup only missed trades have comes before it.
    expect(labels("setup", ["ORB breakout", "no setup"], ["Gap fill", "no setup"])).toEqual([
      "ORB breakout",
      "Gap fill",
      "no setup",
    ]);
    expect(labels("setup", ["ORB breakout"], ["no setup", "Gap fill"])).toEqual([
      "ORB breakout",
      "Gap fill",
      "no setup",
    ]);
  });

  it("orders missed trades' months by date, as the scalps' are", () => {
    const sep = scalp({ id: "s1", openedAt: ny("2026-09-14T10:00"), closedAt: ny("2026-09-14T10:10") });
    const months = missedRows(
      [
        { ...MISSED[0], openedAt: ny("2026-10-05T10:00"), closedAt: ny("2026-10-05T10:20") },
        { ...MISSED[0], openedAt: ny("2026-08-04T10:00"), closedAt: ny("2026-08-04T10:20") },
      ] as typeof MISSED,
      "month",
      context,
    );
    expect(months?.map((row) => row.label)).toEqual(["Aug 2026", "Oct 2026"]);
    expect(
      withMissedGroups(scalpBreakdown([sep], "month", context), months ?? [], "month").map(
        (row) => row.label,
      ),
    ).toEqual(["Aug 2026", "Sep 2026", "Oct 2026"]);
  });

  it("leaves rows without missed trades as they were", () => {
    const rows = scalpBreakdown(SCALPS, "grade", context);
    expect(withMissedGroups(rows, [])).toEqual(rows);
    expect(groupStats([])).toMatchObject({ trades: 0 });
  });
});
