# Scalp Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analytics gets a **Scalps** tab that shows which scalps work: time after the open, hold time, one breakdown at a time in R and return on cost, and mistake cost with an avg-R dumbbell. A **Setup** filter narrows every tab. The Playbook gets a **stat card per setup**, and every scalp's missing stock prices are **backfilled**, so its R counts without opening its page.

**Architecture:**
- **`@tj/core`:**
  - `scalpStats.ts` holds pure functions over closed scalps: time buckets, `scalpSummary` (the KPIs and R coverage), `bucketStats`, `scalpBreakdown`, `mistakeCost`, `cumulativeR` and `setupCards`. The web's trade rows satisfy their input type as they are.
  - `splits.ts` exports its grouping (`groupTrades`, now multi-label) and its ticker folding (`foldMiddle`), so breakdown rows order the way Overview's splits do.
  - `risk.ts` gains `premiumPaid`, the option cost, which `returnOnCost` now uses.
- **The web app:**
  - The Analytics URL state gains `tab: "scalps"`, `setup`, `by`, `metric` and `costEdges`. The filter row gains a Setup dropdown, and editable edges are keyed by split.
  - `ScalpsTab` is built from `MetricBars` (Recharts), `BreakdownPanel` and `MistakeCost` (an HTML dumbbell).
  - `useBackfillPrices` posts to the existing scalp price filler.
  - The Playbook shows `SetupCards` with an SVG `Sparkline`.
- **Server and db:** no change.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 19, TanStack Query 5 and Router, Recharts 3, Tailwind 4, Vitest 5 (jsdom for web), fast-check, Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-30-scalp-analytics-design.md`

**Branch:** `feat/scalp-analytics`, from `main` (9cd2cd1), with the spec at e776f42. Work in place; no worktree.

**Checked while planning:** every task's code and tests were run against the tree, then reverted.
- The full suite had 1,039 tests (971 before). Lint and typecheck were clean.
- Task 1's halfway state, before Task 2, passes on its own: 241 core tests.

**Deviations from the spec, proposed while planning.** Task 8 folds them into the spec.
1. **§9, names:**
   - Mistake rows carry `withTag` and `withoutTag`, since `with` is a reserved word.
   - `groupStats`, `rCoverage` and `holdMinutes` are exported too.
   - `scalpBreakdown` takes a `BreakdownContext`: setup names, emotion names, cost edges and contract edges.
   - `setupCards` takes the setup names, for its tie order.
2. **§9, shared code:** `splits.ts` exports `groupTrades` and `foldMiddle`. `risk.ts` gains `premiumPaid`.
3. **§6.2 and §6.1:** with one scalp that has R, the line reads "R covers the scalp". With no scalps the line is left out, since the tab then says "No closed scalps in this range.". The Scalps tile then reads 0, as Overview's Trades tile does, rather than "—".
4. **§6.3:** a bar's axis label is cut to 12 characters ("Earnings IV… · 2"). The tooltip keeps the full name.
5. **§6.4:** Contracts gets the same **edit** link on the Scalps tab. It edits Overview's shared edges.
6. **§6.5 and §10:** until the tags load, Mistake cost reads "Loading…"; if they fail, "Couldn't load the tags.". Without tag kinds there's no telling which tags are mistakes, so "unknown tag" can't apply.
7. **§7:** the strategy chip's words move to `review/text.ts` (`strategyLabel`), shared with the Setups table. `SetupCards` takes a `today` prop for the year rule, defaulting to New York's date.
8. **§8:** the backfill reads every trade (`useAllTrades`), not just the filtered ones. It runs on each mount of the Scalps tab or the Playbook.
9. **§5.2:** the Setup dropdown sorts setups by name.

## Global Constraints

**Buckets and labels** (the dashes are en dashes, U+2013)
- Minutes after the open: `0–5`, `5–15`, `15–30`, `30–60`, `60+`, and `before open` first when it has scalps.
- Hold time: `< 1 min`, `1–3`, `3–10`, `10–30`, `30+`, and `unknown` last when it has scalps.
- Each bucket includes its lower edge. Minutes after the open go by New York's minute of the day: 09:34:59 is 4.
- Breakdown rows:
  - `no setup`, `unknown setup`, `none` (emotion) and `ungraded`;
  - DTE `0`, `1`, `2–7`, `8+`;
  - `Calls`, `Puts`, `Live`, `Paper`;
  - `unknown` last.

**Formats**
- R is `rText`: `+0.43R`, with a true minus (U+2212), `0.00R` for a scratch.
- Return is `returnText`, one decimal: `+8.4%`, `−3.0%`, `0.0%`.
- Win rate is `winRateText` (`66.7%`). Dollars are `dollars`, whole with a sign (`+$820`, `−$70`), or `Money` in the KPI strip (`+$10.00`).
- A hold is `holdText`: `45 s`, `6 min`, `1 h 12 min`. Kept is `shareText` (`13%`).

**UI copy (exact)**
- **Tabs:** `Overview`, `Scalps`, `Iron flies`. The filter is `Setup` with `All`.
- **KPIs** (ids in brackets):
  - `Net P&L` (net), `Win rate` (win-rate), `Avg R` (avg-r, small print `over 3 of 5`), `Avg return` (avg-return, `on premium paid`);
  - `Profit factor` (profit-factor), `Expectancy` (expectancy), `Avg hold` (avg-hold, `median 5 min`), `Scalps` (scalps).
- **Coverage:**
  - `R covers 31 of 38 scalps · 5 have no stop · 1 has no stock price · 1 can't be priced`, `R covers all 38 scalps`, `R covers the scalp`;
  - `Fetching stock prices for 7 scalps…`;
  - with a problem, the line plus `. ` plus the message.
- **Backfill messages:**
  - `Add an Alpaca key in Settings to fetch the missing stock prices.`
  - `Alpaca didn't answer: reload to try again.`
  - `Couldn't fetch stock prices: reload to try again.`
- **Sections:** `Minutes after the open`, `Hold time`, `Break down by`, `Mistake cost`, `Setup stats · all time`.
- **Groups:** `Bars` (buttons `Net`, `Avg R`, `Win %`) and `Dimension` (buttons `Setup`, `Ticker`, `DTE`, `Call/Put`, `Grade`, `Emotion`, `Weekday`, `Option cost`, `Contracts`, `Book`, `Month`). The table is named `By Setup`.
- **Empty states:**
  - `No closed scalps in this range.`
  - `No mistakes tagged in this range.`
  - `Tag trades with a setup to see its stats here.`
  - `Loading…`
  - `Couldn't load the tags.`
- **Mistake cost:**
  - headers `Mistake`, `With`, `Without`, `Net`, `Avg R`, `Win %`, and the legend `with` / `without`;
  - the last row is `no mistakes`;
  - the tooltip reads `Chased entry: −0.62R with, +0.52R without, 1.14R worse`, or `…, no different`, or `no R`;
  - the axis ends read `−2R` and `+2R`.
- **Cards:**
  - `Avg R` with `over 3 of 3`, or `Kept` with `of max profit`;
  - `Trades`, `Win %`, `Net`, `Avg return` or `PF`;
  - `last Sep 29`, or `last Sep 17, 2025` in another year;
  - `3 trades →` and `1 trade →`;
  - point tooltips `Sep 28 · NVDA · +1.00R · total +1.00R`.
- **Bar tooltips:** a heading (`0–5 min after the open`, `held 1–3 min`, `held < 1 min`, `before open`, `unknown hold`) over `12 scalps · +$820 · +0.62R over 10 · win 66.7%`, `no R`, or `no scalps`.

**URL and storage**
- **URL keys:** `tab=scalps`, `setup=<id>` (letters, digits, dashes, up to 64), `by=<dimension>` (`setup` is the default and left out), `metric=r|win` (net left out), `costEdges`.
- **Storage:** the option-cost edges are remembered in `localStorage` under `tj.edges.cost`.

**Colours:** the with dot and Win % bars are `#5b8cff`, and the without dot is `#6b7385`. Net and R bars use `UP` and `DOWN` from `Charts.tsx`. The sparkline uses `stroke-up` and `stroke-down`.

**Tests:** page tests mock the Recharts component (`MetricBars`) and the Overview's `EquityCurve`. The sparkline and the dumbbell are plain SVG and HTML, tested directly.

**No new dependencies. No server or db change.**

**CI and commits**
- CI runs on Ubuntu and Windows.
- Before every commit, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and check each exit code. Never pipe them through `tail`.
- When `pnpm lint` reports only formatting, run `pnpm format` (twice if needed) and check again.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each is a condition the spec implies but no obvious test would cover. The owning task carries a test for each:

1. **A winter scalp**, New York on EST (UTC−5): 09:35 must still be minute 5. *Task 1:* "reads New York's clock in winter too".
2. **A scalp that isn't a single long option** (a spread, a short): its option cost is unknown, so it sits in the `unknown` row last and adds no return. *Task 2:* "puts a scalp that isn't a single long option under unknown cost".
3. **Long setup names on the bars' axis:** unshortened, neighbours overlap. *Task 6:* `tickText` "cuts a long name".
4. **A setup whose only trade is still open:** it gets no card. *Task 7:* "says what to do without cards".
5. **Avg R where a row or side has no R:** no bar, "—" in the table, and no dumbbell dot. *Task 6:* `metricValue`'s test; *Task 4:* "draws no line and one dot when a side has no R".

---

### Task 1: Core — grouping, the option cost, time buckets and the Scalps summary

**Files:**
- Modify: `packages/core/src/splits.ts` (the `group` helper; `tickerSplit`)
- Modify: `packages/core/src/risk.ts` (`returnOnCost`, at the end)
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/scalpStats.ts`
- Create: `packages/core/src/scalpStats.fixture.ts`
- Test: `packages/core/src/scalpStats.test.ts`

**Interfaces:**
- Consumes: `summarize` and `Summary`, `Closed` and `StatTrade` (`stats.ts`); `returnOnCost` and `ReturnTrade` (`risk.ts`); `nyMinuteOfDay` (`calendar.ts`); `ny` (`stats.fixture.ts`).
- Produces:
  - `groupTrades<T>(trades, labelsOf: (t: T) => string | readonly string[], order?) => [string, T[]][]`;
  - `foldMiddle<R extends { label: string }>(rows, others: (labels: ReadonlySet<string>) => R) => R[]`;
  - `premiumPaid(trade) => number | null`;
  - `ScalpStatTrade`, `ScalpStatLeg`, `ClosedScalp`, `OPEN_BUCKETS`, `HOLD_TIME_BUCKETS`, `BEFORE_OPEN`;
  - `minutesAfterOpen(openedAt)`, `holdMinutes({ openedAt, closedAt })`, `openBucket(minutes)`, `holdTimeBucket(minutes)`;
  - `GroupStats` (`trades`, `winRate | null`, `net`, `profitFactor`, `avgR`, `rCount`, `avgReturn`, `returnCount`) and `groupStats(trades)`;
  - `Coverage` (`total`, `withR`, `noStop`, `noStockPrice`, `cannotPrice`) and `rCoverage(trades)`;
  - `ScalpSummary` (`Summary` plus `avgReturn`, `returnCount`, `avgHoldMinutes`, `medianHoldMinutes`, `coverage`) and `scalpSummary(trades)`;
  - `BucketRow` (`GroupStats` plus `label`) and `bucketStats(trades, "open" | "hold")`;
  - the fixture's `scalp(overrides)`, `SCALPS`, `SETUP_NAMES`, `EMOTIONS` and `MISTAKES`.

- [ ] **Step 1: Create the fixture, the core copy of the five scalps every later test uses**

Create `packages/core/src/scalpStats.fixture.ts`:

```ts
import type { ClosedScalp } from "./scalpStats.js";
import { ny } from "./stats.fixture.js";

/** One closed NVDA 0DTE call scalp, 2 contracts at 1.00 (premium $200), with whatever the test changes. */
export function scalp(overrides: Partial<ClosedScalp> & { id: string }): ClosedScalp {
  return {
    strategy: "scalp",
    underlying: "NVDA",
    book: "live",
    openedAt: ny("2026-09-28 09:31"),
    closedAt: ny("2026-09-28 09:46"),
    netPnl: 0,
    fees: 1.3,
    setupId: null,
    grade: null,
    tagIds: [],
    legs: [{ right: "C", expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1 }],
    ironFly: null,
    risk: { r: null, problem: "no_stop" },
    ...overrides,
  };
}

const leg = (right: "C" | "P", expiry: string, quantity: number, openPrice: number) => [
  { right, expiry, quantity, multiplier: 100, openPrice },
];

/*
 * Five closed scalps, worked by hand. Sep 28 is a Monday.
 *
 * id  setup ticker opened (NY)   held    net   R     grade tags          side  DTE  premium  return   book
 * S1  orb   NVDA   Mon 09:31     2 min   +100  1.00  A     calm          C     0    $200     +50%     live
 * S2  orb   NVDA   Mon 09:36     30 s    −50   −0.50 B     chased        P     0    $200     −25%     live
 * S3  vwap  SPY    Mon 09:50     15 min  +30   —     —     chased, calm  C     1    $300     +10%     paper
 *                                                  (no stop)
 * S4  —     QQQ    Tue 10:45     45 min  −70   —     A     moved         P     3    $600     −11.67%  live
 *                                                  (no stock price)
 * S5  orb   SPY    Tue 09:20     5 min   0     0.00  C     —             C     0    $50      0%       live
 *
 * Net +10: 2 wins, 2 losses, 1 scratch. PF 130 / 120. Avg R (1 − 0.5 + 0) ÷ 3 = 0.17 over 3.
 * Avg return (0.5 − 0.25 + 0.1 − 0.11667 + 0) ÷ 5 = 0.046667. Holds 0.5, 2, 5, 15, 45: mean 13.5, median 5.
 */
export const SCALPS: ClosedScalp[] = [
  scalp({
    id: "S1",
    setupId: "orb",
    openedAt: ny("2026-09-28 09:31"),
    closedAt: ny("2026-09-28 09:33"),
    netPnl: 100,
    grade: "A",
    tagIds: ["calm"],
    risk: { r: 1, problem: null },
  }),
  scalp({
    id: "S2",
    setupId: "orb",
    openedAt: ny("2026-09-28 09:36"),
    closedAt: ny("2026-09-28 09:36") + 30_000,
    netPnl: -50,
    grade: "B",
    tagIds: ["chased"],
    legs: leg("P", "2026-09-28", 2, 1),
    risk: { r: -0.5, problem: null },
  }),
  scalp({
    id: "S3",
    setupId: "vwap",
    underlying: "SPY",
    book: "paper",
    openedAt: ny("2026-09-28 09:50"),
    closedAt: ny("2026-09-28 10:05"),
    netPnl: 30,
    tagIds: ["chased", "calm"],
    legs: leg("C", "2026-09-29", 1, 3),
  }),
  scalp({
    id: "S4",
    underlying: "QQQ",
    openedAt: ny("2026-09-29 10:45"),
    closedAt: ny("2026-09-29 11:30"),
    netPnl: -70,
    grade: "A",
    tagIds: ["moved"],
    legs: leg("P", "2026-10-02", 3, 2),
    risk: { r: null, problem: "no_stock_price" },
  }),
  scalp({
    id: "S5",
    setupId: "orb",
    underlying: "SPY",
    openedAt: ny("2026-09-29 09:20"),
    closedAt: ny("2026-09-29 09:25"),
    netPnl: 0,
    grade: "C",
    legs: leg("C", "2026-09-29", 1, 0.5),
    risk: { r: 0, problem: null },
  }),
];

export const SETUP_NAMES = new Map([
  ["orb", "ORB breakout"],
  ["vwap", "VWAP reclaim"],
]);
export const EMOTIONS = new Map([["calm", "Calm"]]);
export const MISTAKES = new Map([
  ["chased", "Chased entry"],
  ["moved", "Moved stop"],
]);
```

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/scalpStats.test.ts`:

```ts
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
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/scalpStats.test.ts`
Expected: FAIL. The file can't import `./scalpStats.js`, and `groupTrades` and `premiumPaid` aren't exported.

- [ ] **Step 4: Export the grouping from `splits.ts`**

In `packages/core/src/splits.ts`, `group` becomes a wrapper over an exported, multi-label `groupTrades`. Replace:

```ts
/** Rows for the labels trades get: in `order` first, then others as met, "unknown" last; empty buckets left out. */
function group(
  trades: readonly ClosedTrade[],
  labelOf: (trade: ClosedTrade) => string,
  order: readonly string[] = [],
): SplitRow[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const trade of trades) {
    const label = labelOf(trade);
    groups.set(label, [...(groups.get(label) ?? []), trade]);
  }
  const labels = [
    ...order.filter((label) => label !== UNKNOWN && groups.has(label)),
    ...[...groups.keys()].filter((label) => !order.includes(label) && label !== UNKNOWN),
  ];
  if (groups.has(UNKNOWN)) labels.push(UNKNOWN);
  return labels.map((label) => row(label, groups.get(label) ?? []));
}
```

with:

```ts
/**
 * Trades by label: labels in `order` first, then others as met, "unknown" last; empty labels left out.
 * A trade with several labels counts under each of them once.
 */
export function groupTrades<T>(
  trades: readonly T[],
  labelsOf: (trade: T) => string | readonly string[],
  order: readonly string[] = [],
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const trade of trades) {
    const labels = labelsOf(trade);
    for (const label of new Set(typeof labels === "string" ? [labels] : labels)) {
      const members = groups.get(label);
      if (members) members.push(trade);
      else groups.set(label, [trade]);
    }
  }
  const labels = [
    ...order.filter((label) => label !== UNKNOWN && groups.has(label)),
    ...[...groups.keys()].filter((label) => !order.includes(label) && label !== UNKNOWN),
  ];
  if (groups.has(UNKNOWN)) labels.push(UNKNOWN);
  return labels.map((label) => [label, groups.get(label) ?? []]);
}

/** Rows for the labels trades get, in `groupTrades`' order. */
function group(
  trades: readonly ClosedTrade[],
  labelOf: (trade: ClosedTrade) => string,
  order: readonly string[] = [],
): SplitRow[] {
  return groupTrades(trades, labelOf, order).map(([label, members]) => row(label, members));
}
```

Then fold the tickers through an exported `foldMiddle`, which the scalp breakdown reuses in Task 2. Replace:

```ts
const TICKER_ROWS = 10;

/** Every ticker by net, best first. Past 10 tickers: the best 5, one row for the rest, and the worst 5. */
export function tickerSplit(trades: readonly ClosedTrade[]): SplitRow[] {
  const rows = group(trades, (trade) => trade.underlying).sort((a, b) => b.net - a.net);
  if (rows.length <= TICKER_ROWS) return rows;
  const middle = new Set(rows.slice(5, -5).map((split) => split.label));
  const others = row(
    `${middle.size} others`,
    trades.filter((trade) => middle.has(trade.underlying)),
  );
  return [...rows.slice(0, 5), others, ...rows.slice(-5)];
}
```

with:

```ts
const TICKER_ROWS = 10;

/** Past 10 rows sorted best first: the best 5, one row for the rest (`others` builds it), and the worst 5. */
export function foldMiddle<R extends { label: string }>(
  rows: readonly R[],
  others: (labels: ReadonlySet<string>) => R,
): R[] {
  if (rows.length <= TICKER_ROWS) return [...rows];
  const middle = new Set(rows.slice(5, -5).map((split) => split.label));
  return [...rows.slice(0, 5), others(middle), ...rows.slice(-5)];
}

/** Every ticker by net, best first. Past 10 tickers: the best 5, one row for the rest, and the worst 5. */
export function tickerSplit(trades: readonly ClosedTrade[]): SplitRow[] {
  const rows = group(trades, (trade) => trade.underlying).sort((a, b) => b.net - a.net);
  return foldMiddle(rows, (middle) =>
    row(
      `${middle.size} others`,
      trades.filter((trade) => middle.has(trade.underlying)),
    ),
  );
}
```

- [ ] **Step 5: Add `premiumPaid` to `risk.ts`**

In `packages/core/src/risk.ts`, at the end: Replace:

```ts
/**
 * A scalp's net P&L over the premium paid, contracts × multiplier × entry premium: 0.211 is +21.1%.
 * Null for an open trade, a fly, or anything but a single long option.
 */
export function returnOnCost(trade: ReturnTrade): number | null {
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (trade.strategy !== "scalp" || trade.netPnl == null || !leg || leg.quantity <= 0) return null;
  const cost = leg.quantity * leg.multiplier * leg.openPrice;
  return cost > 0 ? trade.netPnl / cost : null;
}
```

with:

```ts
/** The premium paid for a single long option: contracts × multiplier × entry premium. Null for anything else. */
export function premiumPaid(trade: Pick<ReturnTrade, "strategy" | "legs">): number | null {
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (trade.strategy !== "scalp" || !leg || leg.quantity <= 0) return null;
  const cost = leg.quantity * leg.multiplier * leg.openPrice;
  return cost > 0 ? cost : null;
}

/**
 * A scalp's net P&L over the premium paid, contracts × multiplier × entry premium: 0.211 is +21.1%.
 * Null for an open trade, a fly, or anything but a single long option.
 */
export function returnOnCost(trade: ReturnTrade): number | null {
  const cost = premiumPaid(trade);
  return trade.netPnl == null || cost == null ? null : trade.netPnl / cost;
}
```

- [ ] **Step 6: Create `scalpStats.ts`**

Create `packages/core/src/scalpStats.ts`. Task 2 appends the rest.

```ts
import { nyMinuteOfDay } from "./calendar.js";
import { type ReturnTrade, returnOnCost } from "./risk.js";
import { groupTrades } from "./splits.js";
import { type Closed, type StatTrade, type Summary, summarize } from "./stats.js";

/** The scalp analytics (scalp-analytics spec §6, §7, §9): time buckets, breakdowns, mistake cost and setup cards. */

export interface ScalpStatLeg {
  right: string;
  expiry: string;
  quantity: number;
  multiplier: number;
  openPrice: number;
}

/** What the scalp statistics read. The web app's trade rows satisfy it as they are. */
export interface ScalpStatTrade extends StatTrade, ReturnTrade {
  book: string;
  setupId: string | null;
  grade: string | null;
  tagIds: readonly string[];
  legs: readonly ScalpStatLeg[];
  risk?: { r: number | null; problem: string | null } | null;
}

export type ClosedScalp = Closed<ScalpStatTrade>;

const UNKNOWN = "unknown";
const MINUTE = 60_000;
/** 09:30 in minutes since midnight. */
const OPEN = 9 * 60 + 30;

export const OPEN_BUCKETS = ["0–5", "5–15", "15–30", "30–60", "60+"] as const;
export const HOLD_TIME_BUCKETS = ["< 1 min", "1–3", "3–10", "10–30", "30+"] as const;
export const BEFORE_OPEN = "before open";

/** Minutes from 09:30 New York to the first entry, by the minute: 09:34:59 is 4. */
export const minutesAfterOpen = (openedAt: number): number => nyMinuteOfDay(openedAt) - OPEN;

/** Minutes held: close − open. */
export const holdMinutes = (trade: { openedAt: number; closedAt: number }): number =>
  (trade.closedAt - trade.openedAt) / MINUTE;

/** The minutes-after-open bucket (spec §6.3); each includes its lower edge. */
export function openBucket(minutes: number): string {
  if (minutes < 0) return BEFORE_OPEN;
  if (minutes < 5) return "0–5";
  if (minutes < 15) return "5–15";
  if (minutes < 30) return "15–30";
  return minutes < 60 ? "30–60" : "60+";
}

/** The hold-time bucket (spec §6.3); each includes its lower edge. `calendar.ts`'s `holdBucket` is the flies'. */
export function holdTimeBucket(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return UNKNOWN;
  if (minutes < 1) return "< 1 min";
  if (minutes < 3) return "1–3";
  if (minutes < 10) return "3–10";
  return minutes < 30 ? "10–30" : "30+";
}

/** The numbers every row of the Scalps tab shows. */
export interface GroupStats {
  trades: number;
  /** Null with no trades. */
  winRate: number | null;
  net: number;
  profitFactor: number | null;
  /** The mean R of the trades that have one, to 0.01. */
  avgR: number | null;
  rCount: number;
  /** The mean return on cost of the trades that have one: 0.084 is +8.4%. */
  avgReturn: number | null;
  returnCount: number;
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const returnsOf = (trades: readonly ClosedScalp[]) =>
  trades.flatMap((trade) => {
    const value = returnOnCost(trade);
    return value == null ? [] : [value];
  });

export function groupStats(trades: readonly ClosedScalp[]): GroupStats {
  const summary = summarize(trades);
  const returns = returnsOf(trades);
  return {
    trades: summary.trades,
    winRate: summary.winRate,
    net: summary.net,
    profitFactor: summary.profitFactor,
    avgR: summary.avgR,
    rCount: summary.rCount,
    avgReturn: mean(returns),
    returnCount: returns.length,
  };
}

/** How many scalps have an R, and why the rest don't (spec §6.2). */
export interface Coverage {
  total: number;
  withR: number;
  noStop: number;
  noStockPrice: number;
  /** Any other reason: the stop on the wrong side, a model that can't price, not a single long option. */
  cannotPrice: number;
}

export function rCoverage(trades: readonly ClosedScalp[]): Coverage {
  const coverage: Coverage = { total: trades.length, withR: 0, noStop: 0, noStockPrice: 0, cannotPrice: 0 };
  for (const trade of trades) {
    if (trade.risk?.r != null) coverage.withR++;
    else if (trade.risk?.problem === "no_stop") coverage.noStop++;
    else if (trade.risk?.problem === "no_stock_price") coverage.noStockPrice++;
    else coverage.cannotPrice++;
  }
  return coverage;
}

export interface ScalpSummary extends Summary {
  avgReturn: number | null;
  returnCount: number;
  avgHoldMinutes: number | null;
  medianHoldMinutes: number | null;
  coverage: Coverage;
}

/** The Scalps tab's KPI strip (spec §6.1). Expects trades in close order, as `closedTrades` returns them. */
export function scalpSummary(trades: readonly ClosedScalp[]): ScalpSummary {
  const returns = returnsOf(trades);
  const holds = trades.map(holdMinutes).filter((minutes) => minutes >= 0);
  return {
    ...summarize(trades),
    avgReturn: mean(returns),
    returnCount: returns.length,
    avgHoldMinutes: mean(holds),
    medianHoldMinutes: median(holds),
    coverage: rCoverage(trades),
  };
}

export interface BucketRow extends GroupStats {
  label: string;
}

/**
 * One row per time bucket (spec §6.3). The five main buckets are always there, empty or not, so a chart's axis never
 * shifts; "before open" (first) and "unknown" (last) only when trades fall in them.
 */
export function bucketStats(trades: readonly ClosedScalp[], by: "open" | "hold"): BucketRow[] {
  const labelOf =
    by === "open"
      ? (trade: ClosedScalp) => openBucket(minutesAfterOpen(trade.openedAt))
      : (trade: ClosedScalp) => holdTimeBucket(holdMinutes(trade));
  const groups = new Map(groupTrades(trades, labelOf));
  const main: readonly string[] = by === "open" ? OPEN_BUCKETS : HOLD_TIME_BUCKETS;
  const labels = [
    ...(groups.has(BEFORE_OPEN) ? [BEFORE_OPEN] : []),
    ...main,
    ...(groups.has(UNKNOWN) ? [UNKNOWN] : []),
  ];
  return labels.map((label) => ({ label, ...groupStats(groups.get(label) ?? []) }));
}
```

In `packages/core/src/index.ts`, export it in alphabetical place: Replace:

```ts
export * from "./risk.js";
```

with:

```ts
export * from "./risk.js";
export * from "./scalpStats.js";
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/scalpStats.test.ts packages/core/src/splits.test.ts packages/core/src/risk.test.ts`
Expected: PASS: 12 in `scalpStats.test.ts`, 25 in `splits.test.ts`, 26 in `risk.test.ts`. The splits and risk tests were already there and prove the refactor changed nothing.

- [ ] **Step 8: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/splits.ts packages/core/src/risk.ts packages/core/src/index.ts packages/core/src/scalpStats.ts packages/core/src/scalpStats.fixture.ts packages/core/src/scalpStats.test.ts
git commit -m "feat: time buckets, R coverage and the Scalps summary in core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core — breakdowns, mistake cost, cumulative R and setup cards

**Files:**
- Modify: `packages/core/src/scalpStats.ts` (imports; append)
- Test: `packages/core/src/scalpStats.test.ts` (imports; append)
- Test: `packages/core/src/scalpStats.property.test.ts`

**Interfaces:**
- Consumes: Task 1's `groupTrades`, `foldMiddle`, `premiumPaid`, `groupStats`, `ClosedScalp` and the fixture. Also `keptStats` (`kept.ts`), `daysToExpiry`, `tradeSize`, `edgeBucket`, `edgeLabels` and `monthLabel` (`splits.ts`), `nyWeekday` and `WEEKDAYS` (`calendar.ts`), and `nyDate` (`marks.ts`).
- Produces:
  - `BREAKDOWNS` (`"setup" | "ticker" | "dte" | "side" | "grade" | "emotion" | "weekday" | "cost" | "contracts" | "book" | "month"`) and `Breakdown`;
  - `BreakdownContext` (`setups`, `emotions` as `ReadonlyMap<id, name>`; `costEdges`, `contractEdges`);
  - `BreakdownRow` (`GroupStats` plus `label`) and `scalpBreakdown(trades, by, context)`;
  - `NO_MISTAKES`, `MistakeRow` (`tagId | null`, `label`, `withTag`, `withoutTag`: `GroupStats | null`) and `mistakeCost(trades, mistakes)`;
  - `CumulativePoint` (`id`, `closedAt`, `underlying`, `value`, `total`) and `cumulativeR(trades)`;
  - `SetupCard` (`GroupStats` plus `setupId`, `kind: "scalp" | "fly"`, `kept`, `points`, `lastClosedAt`) and `setupCards(trades, names)`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/scalpStats.test.ts`, the imports grow: Replace:

```ts
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
```

with:

```ts
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
```

Then append to the end of the file:

```ts
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
```

Create `packages/core/src/scalpStats.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMOTIONS, MISTAKES, SETUP_NAMES, scalp } from "./scalpStats.fixture.js";
import {
  BREAKDOWNS,
  bucketStats,
  type ClosedScalp,
  cumulativeR,
  mistakeCost,
  scalpBreakdown,
} from "./scalpStats.js";
import { ny } from "./stats.fixture.js";

const DAY = 86_400_000;
const MINUTE = 60_000;
const TAGS = ["chased", "moved", "calm", "late"];

/** Random closed scalps: any time of day, held up to 4 hours, some without R, tagged and set up at random. */
const scalpsArbitrary = fc
  .array(
    fc.record({
      day: fc.integer({ min: 0, max: 20 }),
      openMinute: fc.integer({ min: 4 * 60, max: 20 * 60 }),
      heldSeconds: fc.integer({ min: 0, max: 4 * 3600 }),
      netCents: fc.integer({ min: -100_000, max: 100_000 }),
      r: fc.option(fc.double({ min: -3, max: 3, noNaN: true }), { nil: null }),
      tagIds: fc.subarray(TAGS),
      setupId: fc.constantFrom(null, "orb", "vwap"),
      ticker: fc.constantFrom(
        "NVDA",
        "SPY",
        "QQQ",
        "AAPL",
        "TSLA",
        "AMD",
        "META",
        "MSFT",
        "AMZN",
        "GOOG",
        "NFLX",
        "IWM",
      ),
      right: fc.constantFrom("C", "P"),
      quantity: fc.integer({ min: 1, max: 8 }),
      book: fc.constantFrom("live", "paper"),
    }),
    { maxLength: 40 },
  )
  .map((rows) =>
    rows.map((row, index): ClosedScalp => {
      const openedAt = ny("2026-09-01 00:00") + row.day * DAY + row.openMinute * MINUTE;
      return scalp({
        id: `s${index}`,
        underlying: row.ticker,
        book: row.book,
        openedAt,
        closedAt: openedAt + row.heldSeconds * 1000,
        netPnl: row.netCents / 100,
        setupId: row.setupId,
        tagIds: row.tagIds,
        legs: [
          { right: row.right, expiry: "2026-09-30", quantity: row.quantity, multiplier: 100, openPrice: 1.5 },
        ],
        risk: { r: row.r, problem: row.r == null ? "no_stop" : null },
      });
    }),
  );

const CONTEXT = {
  setups: SETUP_NAMES,
  emotions: EMOTIONS,
  costEdges: [250, 500, 1000],
  contractEdges: [2, 4, 6],
};

describe("scalp stats properties", () => {
  it("splits the scalps between with and without for every mistake row", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const row of mistakeCost(trades, MISTAKES)) {
          expect((row.withTag?.trades ?? 0) + (row.withoutTag?.trades ?? 0)).toBe(trades.length);
        }
      }),
    );
  });

  it("puts every scalp in exactly one time bucket", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const by of ["open", "hold"] as const) {
          const counted = bucketStats(trades, by).reduce((sum, row) => sum + row.trades, 0);
          expect(counted).toBe(trades.length);
        }
      }),
    );
  });

  it("puts every scalp in exactly one row of each single-valued breakdown", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        for (const by of BREAKDOWNS.filter((each) => each !== "emotion")) {
          const counted = scalpBreakdown(trades, by, CONTEXT).reduce((sum, row) => sum + row.trades, 0);
          expect(counted).toBe(trades.length);
        }
      }),
    );
  });

  it("ends cumulative R at the sum of R", () => {
    fc.assert(
      fc.property(scalpsArbitrary, (trades) => {
        const sum = trades.reduce((total, trade) => total + (trade.risk?.r ?? 0), 0);
        expect(cumulativeR(trades).at(-1)?.total ?? 0).toBeCloseTo(sum, 6);
      }),
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/scalpStats.test.ts packages/core/src/scalpStats.property.test.ts`
Expected: FAIL. `scalpBreakdown`, `mistakeCost`, `cumulativeR`, `setupCards` and `BREAKDOWNS` aren't exported.

- [ ] **Step 3: Add the breakdowns, mistake cost, cumulative R and the cards**

In `packages/core/src/scalpStats.ts`, the imports grow: Replace:

```ts
import { nyMinuteOfDay } from "./calendar.js";
import { type ReturnTrade, returnOnCost } from "./risk.js";
import { groupTrades } from "./splits.js";
import { type Closed, type StatTrade, type Summary, summarize } from "./stats.js";
```

with:

```ts
import { nyMinuteOfDay, nyWeekday, WEEKDAYS } from "./calendar.js";
import { keptStats } from "./kept.js";
import { nyDate } from "./marks.js";
import { premiumPaid, type ReturnTrade, returnOnCost } from "./risk.js";
import {
  daysToExpiry,
  edgeBucket,
  edgeLabels,
  foldMiddle,
  groupTrades,
  monthLabel,
  tradeSize,
} from "./splits.js";
import { type Closed, type StatTrade, type Summary, summarize } from "./stats.js";
```

Then append to the end of the file:

```ts
export const BREAKDOWNS = [
  "setup",
  "ticker",
  "dte",
  "side",
  "grade",
  "emotion",
  "weekday",
  "cost",
  "contracts",
  "book",
  "month",
] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/** What a breakdown needs besides the trades: names by id, and the edges of the bucketed dimensions. */
export interface BreakdownContext {
  setups: ReadonlyMap<string, string>;
  /** Emotion tags only, so a trade's other tags are ignored. */
  emotions: ReadonlyMap<string, string>;
  costEdges: readonly number[];
  contractEdges: readonly number[];
}

export interface BreakdownRow extends GroupStats {
  label: string;
}

const NO_SETUP = "no setup";
const NO_EMOTION = "none";
const DTE_ORDER = ["0", "1", "2–7", "8+"];
const GRADE_ORDER = ["A", "B", "C", "D", "F", "ungraded"];
const SIDES: Record<string, string> = { C: "Calls", P: "Puts" };
const bookLabel = (book: string) => book.charAt(0).toUpperCase() + book.slice(1);

function dteLabel(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 1) return String(days);
  return days <= 7 ? "2–7" : "8+";
}

const toRows = (groups: [string, ClosedScalp[]][]): BreakdownRow[] =>
  groups.map(([label, members]) => ({ label, ...groupStats(members) }));

/** Rows by net, best first, with the `last` row (such as "no setup") at the end. */
const byNet = (rows: readonly BreakdownRow[], last?: string): BreakdownRow[] => [
  ...rows.filter((row) => row.label !== last).sort((a, b) => b.net - a.net),
  ...rows.filter((row) => row.label === last),
];

/** One dimension's rows (spec §6.4). Empty rows are left out, and "unknown" comes last. */
export function scalpBreakdown(
  trades: readonly ClosedScalp[],
  by: Breakdown,
  context: BreakdownContext,
): BreakdownRow[] {
  switch (by) {
    case "setup":
      return byNet(
        toRows(
          groupTrades(trades, (trade) =>
            trade.setupId == null ? NO_SETUP : (context.setups.get(trade.setupId) ?? "unknown setup"),
          ),
        ),
        NO_SETUP,
      );
    case "ticker":
      return foldMiddle(byNet(toRows(groupTrades(trades, (trade) => trade.underlying))), (middle) => ({
        label: `${middle.size} others`,
        ...groupStats(trades.filter((trade) => middle.has(trade.underlying))),
      }));
    case "dte":
      return toRows(groupTrades(trades, (trade) => dteLabel(daysToExpiry(trade)), DTE_ORDER));
    case "side":
      return toRows(
        groupTrades(trades, (trade) => SIDES[trade.legs[0]?.right ?? ""] ?? UNKNOWN, ["Calls", "Puts"]),
      );
    case "grade":
      return toRows(groupTrades(trades, (trade) => trade.grade ?? "ungraded", GRADE_ORDER));
    case "emotion":
      return byNet(
        toRows(
          groupTrades(trades, (trade) => {
            const names = trade.tagIds.flatMap((id) => {
              const name = context.emotions.get(id);
              return name == null ? [] : [name];
            });
            return names.length > 0 ? names : NO_EMOTION;
          }),
        ),
        NO_EMOTION,
      );
    case "weekday":
      return toRows(groupTrades(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS));
    case "cost":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const cost = premiumPaid(trade);
            return cost == null ? UNKNOWN : edgeBucket(cost, context.costEdges, "usd");
          },
          edgeLabels(context.costEdges, "usd"),
        ),
      );
    case "contracts":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const size = tradeSize(trade);
            return size == null ? UNKNOWN : edgeBucket(size, context.contractEdges, "contracts");
          },
          edgeLabels(context.contractEdges, "contracts"),
        ),
      );
    case "book":
      return toRows(groupTrades(trades, (trade) => bookLabel(trade.book), ["Live", "Paper"]));
    case "month": {
      const monthOf = (trade: ClosedScalp) => nyDate(trade.closedAt).slice(0, 7);
      const months = [...new Set(trades.map(monthOf))].sort();
      return toRows(groupTrades(trades, (trade) => monthLabel(monthOf(trade)), months.map(monthLabel)));
    }
  }
}

export const NO_MISTAKES = "no mistakes";

/** A mistake tag's scalps against the rest (spec §6.5). */
export interface MistakeRow {
  /** Null for the "no mistakes" row. */
  tagId: string | null;
  label: string;
  /** The scalps carrying the tag; for "no mistakes", those carrying none. Null when there are none. */
  withTag: GroupStats | null;
  /** The rest of the scalps; for "no mistakes", those carrying at least one. Null when there are none. */
  withoutTag: GroupStats | null;
}

const sideStats = (trades: readonly ClosedScalp[]) => (trades.length > 0 ? groupStats(trades) : null);

/**
 * One row per mistake tag the scalps carry, worst net first, then "no mistakes". Empty when no scalp carries a
 * mistake. `mistakes` holds the mistake tags' names by id, so emotion tags are ignored.
 */
export function mistakeCost(
  trades: readonly ClosedScalp[],
  mistakes: ReadonlyMap<string, string>,
): MistakeRow[] {
  const hasMistake = (trade: ClosedScalp) => trade.tagIds.some((id) => mistakes.has(id));
  const carried = new Set(trades.flatMap((trade) => trade.tagIds.filter((id) => mistakes.has(id))));
  if (carried.size === 0) return [];
  const rows = [...carried].map(
    (tagId): MistakeRow => ({
      tagId,
      label: mistakes.get(tagId) ?? "unknown tag",
      withTag: sideStats(trades.filter((trade) => trade.tagIds.includes(tagId))),
      withoutTag: sideStats(trades.filter((trade) => !trade.tagIds.includes(tagId))),
    }),
  );
  rows.sort((a, b) => (a.withTag?.net ?? 0) - (b.withTag?.net ?? 0) || a.label.localeCompare(b.label));
  return [
    ...rows,
    {
      tagId: null,
      label: NO_MISTAKES,
      withTag: sideStats(trades.filter((trade) => !hasMistake(trade))),
      withoutTag: sideStats(trades.filter(hasMistake)),
    },
  ];
}

export interface CumulativePoint {
  id: string;
  closedAt: number;
  underlying: string;
  /** This trade's R, or net $ for a fly setup. */
  value: number;
  /** The running total through this trade. */
  total: number;
}

function cumulative(
  trades: readonly ClosedScalp[],
  pick: (trade: ClosedScalp) => number | null | undefined,
): CumulativePoint[] {
  let total = 0;
  return [...trades]
    .sort((a, b) => a.closedAt - b.closedAt)
    .flatMap((trade) => {
      const value = pick(trade);
      if (value == null) return [];
      total += value;
      return [{ id: trade.id, closedAt: trade.closedAt, underlying: trade.underlying, value, total }];
    });
}

/** R added up trade by trade, in close order, over the trades that have one (spec §7.2). */
export const cumulativeR = (trades: readonly ClosedScalp[]): CumulativePoint[] =>
  cumulative(trades, (trade) => trade.risk?.r);

/** A Playbook card (spec §7.2). */
export interface SetupCard extends GroupStats {
  setupId: string;
  /** "fly" when every closed trade is an iron fly. */
  kind: "scalp" | "fly";
  /** A fly setup's Σ net ÷ Σ max profit; null for a scalp setup. */
  kept: number | null;
  /** Cumulative R for a scalp setup, cumulative net $ for a fly setup. */
  points: CumulativePoint[];
  lastClosedAt: number;
}

/**
 * One card per setup its closed trades name, most trades first, then by name. `names` holds setup names by id, for
 * the order only.
 */
export function setupCards(trades: readonly ClosedScalp[], names: ReadonlyMap<string, string>): SetupCard[] {
  const bySetup = groupTrades(
    trades.filter((trade) => trade.setupId != null),
    (trade) => trade.setupId ?? "",
  );
  const nameOf = (card: SetupCard) => names.get(card.setupId) ?? "";
  return bySetup
    .map(([setupId, members]): SetupCard => {
      const fly = members.every((trade) => trade.strategy === "iron_fly");
      return {
        setupId,
        kind: fly ? "fly" : "scalp",
        ...groupStats(members),
        kept: fly ? keptStats(members).keptOverall : null,
        points: fly ? cumulative(members, (trade) => trade.netPnl) : cumulativeR(members),
        lastClosedAt: Math.max(...members.map((trade) => trade.closedAt)),
      };
    })
    .sort((a, b) => b.trades - a.trades || nameOf(a).localeCompare(nameOf(b)));
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core`
Expected: PASS. `scalpStats.test.ts` now has 24 tests and `scalpStats.property.test.ts` 4. With every core test, that's 256.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/scalpStats.ts packages/core/src/scalpStats.test.ts packages/core/src/scalpStats.property.test.ts
git commit -m "feat: scalp breakdowns, mistake cost, cumulative R and setup cards in core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web — the URL keys, the Setup filter, and edges by split

**Files:**
- Modify: `apps/web/src/analytics/search.ts`
- Modify: `apps/web/src/analytics/data.ts`
- Modify: `apps/web/src/analytics/edges.ts` (whole file)
- Modify: `apps/web/src/analytics/SplitGrid.tsx` (export `EdgeEditor`)
- Modify: `apps/web/src/routes/FliesTab.tsx`
- Modify: `apps/web/src/routes/Analytics.tsx`
- Modify: `apps/web/src/analytics/testing.tsx`
- Test: `apps/web/src/analytics/search.test.ts`, `apps/web/src/analytics/data.test.tsx`, `apps/web/src/analytics/edges.test.ts`, `apps/web/src/routes/Analytics.test.tsx`

**Interfaces:**
- Consumes: `BREAKDOWNS` and `Breakdown` (Task 2); `useSetups` and `Setup` (`review/data.ts`).
- Produces:
  - `AnalyticsSearch` gains `tab?: "scalps" | "flies"`, `setup?: string`, `by?: Exclude<Breakdown, "setup">`, `metric?: "r" | "win"` and `costEdges?: string`;
  - `TradeFilter.setup` and `filterTrades` with a setup;
  - `EdgeSplit = "credit" | "contracts" | "cost"`, `EDGE_SPLITS`, `resolveEdges(split, fromUrl?)` and `rememberEdges(split, edges)`;
  - `EdgeEditor({ title, control })` exported from `SplitGrid.tsx`;
  - in `testing.tsx`: `tradeRow` gains `problem`, `setupId`, `grade`, `tagIds`, `right`, `openPrice` and `scalpPrices` (present by default for a scalp). `stubTrades(trades, pending?, taxonomy?: Taxonomy)` also answers `/api/setups`, `/api/tags` and `/api/risk/fill`.

- [ ] **Step 1: Extend the test helpers**

Every later web test needs these. In `apps/web/src/analytics/testing.tsx`: Replace:

```tsx
  /** A scalp's R, as the server works it out; absent means no R. */
  r?: number | null;
}
```

with:

```tsx
  /** A scalp's R, as the server works it out; absent means no R. */
  r?: number | null;
  /** Why a scalp has no R, as the server says. */
  problem?: string | null;
  setupId?: string | null;
  grade?: string | null;
  tagIds?: string[];
  right?: "C" | "P";
  /** The entry premium; 1 by default. */
  openPrice?: number;
  /** A scalp's fetched stock prices; present by default, so pages don't ask the filler. */
  scalpPrices?: unknown;
}
```

Replace:

```tsx
    grade: null,
    excluded: spec.excluded ?? false,
    excludeReason: null,
    tagIds: [],
```

with:

```tsx
    grade: spec.grade ?? null,
    setupId: spec.setupId ?? null,
    excluded: spec.excluded ?? false,
    excludeReason: null,
    tagIds: spec.tagIds ?? [],
```

Replace:

```tsx
        right: "C",
        strike: 10,
        expiry: spec.expiry ?? "2026-09-04",
        quantity: fly ? -contracts : contracts,
        multiplier: 100,
        openPrice: 1,
```

with:

```tsx
        right: spec.right ?? "C",
        strike: 10,
        expiry: spec.expiry ?? "2026-09-04",
        quantity: fly ? -contracts : contracts,
        multiplier: 100,
        openPrice: spec.openPrice ?? 1,
```

Replace:

```tsx
    risk: spec.r === undefined ? null : { r: spec.r },
  };
}

/** Answers the trade list with `trades`, the review queue with `pending`, and option quotes with none (a key is set up). */
export function stubTrades(trades: unknown[], pending: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/option-quotes")
      ? { quotes: {}, available: true }
      : url.includes("review=pending")
        ? pending
        : trades;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
```

with:

```tsx
    risk:
      spec.r === undefined && spec.problem === undefined
        ? null
        : { r: spec.r ?? null, problem: spec.problem ?? null },
    scalpPrices:
      spec.scalpPrices !== undefined
        ? spec.scalpPrices
        : fly
          ? null
          : { entryPrice: 10, holdHigh: 11, holdLow: 9 },
  };
}

export interface Taxonomy {
  setups?: unknown[];
  tags?: unknown[];
}

/**
 * Answers the trade list with `trades`, the review queue with `pending`, setups and tags with `taxonomy`'s, option
 * quotes with none (a key is set up), and the scalp price filler with nothing filled.
 */
export function stubTrades(trades: unknown[], pending: unknown[] = [], taxonomy: Taxonomy = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    let body: unknown = trades;
    if (url.includes("/api/option-quotes")) body = { quotes: {}, available: true };
    else if (url.includes("review=pending")) body = pending;
    else if (url.includes("/api/setups")) body = taxonomy.setups ?? [];
    else if (url.includes("/api/tags")) body = taxonomy.tags ?? [];
    else if (url.includes("/api/risk/fill")) body = { filled: 0, missing: [], unavailable: null };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
```

- [ ] **Step 2: Write the failing tests**

In `apps/web/src/analytics/search.test.ts`, the stale-values test tries the new keys with bad values ("scalps" is now a valid tab, so it tries "missed"): Replace:

```ts
  it("drops hand-edited or stale values instead of failing", () => {
    expect(
      parseAnalyticsSearch({
        tab: "scalps",
        from: "2026-02-30",
        to: "yesterday",
        books: "missed",
        ticker: "SPX INDEX",
        excluded: "no",
        creditEdges: "abc",
        contractEdges: "1, 3",
      }),
    ).toEqual({});
  });
```

with:

```ts
  it("drops hand-edited or stale values instead of failing", () => {
    expect(
      parseAnalyticsSearch({
        tab: "missed",
        from: "2026-02-30",
        to: "yesterday",
        books: "missed",
        ticker: "SPX INDEX",
        excluded: "no",
        creditEdges: "abc",
        contractEdges: "1, 3",
        setup: "orb breakout!",
        by: "mistake",
        metric: "avgR",
        costEdges: "0",
      }),
    ).toEqual({});
  });

  it("keeps the Scalps tab's keys, leaving the defaults out", () => {
    expect(
      parseAnalyticsSearch({
        tab: "scalps",
        setup: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        by: "emotion",
        metric: "r",
        costEdges: "100,300",
      }),
    ).toEqual({
      tab: "scalps",
      setup: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      by: "emotion",
      metric: "r",
      costEdges: "100,300",
    });
    // By setup and by net P&L are the defaults, so they never reach the URL.
    expect(parseAnalyticsSearch({ by: "setup", metric: "net" })).toEqual({});
  });
```

The trade filter carries the setup: Replace:

```ts
    expect(toFilter({ books: "paper", ticker: "M", excluded: true, from: "2026-09-01" })).toEqual({
      books: ["paper"],
      ticker: "M",
      includeExcluded: true,
      from: "2026-09-01",
    });
```

with:

```ts
    expect(
      toFilter({ books: "paper", ticker: "M", setup: "orb", excluded: true, from: "2026-09-01" }),
    ).toEqual({
      books: ["paper"],
      ticker: "M",
      setup: "orb",
      includeExcluded: true,
      from: "2026-09-01",
    });
```

In `apps/web/src/analytics/data.test.tsx`: Replace:

```tsx
const trade = (
  overrides: Partial<{ book: string; underlying: string; closedAt: number | null; excluded: boolean }>,
) => ({
  book: "paper",
  underlying: "AA",
  closedAt: ny("2026-09-10 10:00"),
  excluded: false,
  ...overrides,
});
```

with:

```tsx
const trade = (
  overrides: Partial<{
    book: string;
    underlying: string;
    setupId: string | null;
    closedAt: number | null;
    excluded: boolean;
  }>,
) => ({
  book: "paper",
  underlying: "AA",
  setupId: null,
  closedAt: ny("2026-09-10 10:00"),
  excluded: false,
  ...overrides,
});
```

Replace:

```tsx
  it("drops excluded trades unless asked for them", () => {
```

with:

```tsx
  it("keeps one setup's trades", () => {
    const trades = [trade({ setupId: "orb" }), trade({ setupId: "vwap" }), trade({})];
    expect(filterTrades(trades, { ...ALL, setup: "orb" })).toEqual([trades[0]]);
  });

  it("drops excluded trades unless asked for them", () => {
```

Replace the whole of `apps/web/src/analytics/edges.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberEdges, resolveEdges } from "./edges.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveEdges", () => {
  it("prefers the URL, then what was remembered, then the defaults", () => {
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    rememberEdges("credit", [300, 600]);
    expect(resolveEdges("credit")).toEqual([300, 600]);
    expect(resolveEdges("credit", "400,800")).toEqual([400, 800]);
    expect(resolveEdges("credit", "abc")).toEqual([300, 600]);
  });

  it("keeps credit, contract and option-cost edges apart", () => {
    rememberEdges("contracts", [3, 6]);
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3,6");
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    rememberEdges("cost", [100, 200]);
    expect(localStorage.getItem("tj.edges.cost")).toBe("100,200");
    expect(resolveEdges("cost")).toEqual([100, 200]);
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
  });

  it("forgets on reset", () => {
    rememberEdges("credit", [300]);
    rememberEdges("credit", null);
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(resolveEdges("credit")).toEqual([250, 500, 1000]);
    expect(rememberEdges("credit", [300])).toBe(false);
  });
});
```

In `apps/web/src/routes/Analytics.test.tsx`, add a describe before `describe("Analytics with an old link"`: Replace:

```tsx
describe("Analytics with an old link", () => {
```

with:

```tsx
describe("Analytics' Setup filter", () => {
  const SETUPS = [
    { id: "orb", name: "ORB breakout", strategy: "scalp", description: null, archived: false, tradeCount: 1 },
    { id: "old", name: "Old setup", strategy: null, description: null, archived: true, tradeCount: 1 },
  ];
  /* AA +100 under ORB, BB −300 under the archived Old setup, CC +280 with none: +$80 in all. */
  const TAGGED = [
    tradeRow({
      id: "a",
      underlying: "AA",
      opened: "2026-09-02 15:45",
      closed: "2026-09-03 09:50",
      netPnl: 100,
      setupId: "orb",
    }),
    tradeRow({
      id: "b",
      underlying: "BB",
      opened: "2026-09-03 15:50",
      closed: "2026-09-04 15:40",
      netPnl: -300,
      setupId: "old",
    }),
    tradeRow({
      id: "c",
      underlying: "CC",
      opened: "2026-09-04 15:30",
      closed: "2026-09-08 09:45",
      netPnl: 280,
    }),
  ];

  it("lists the setups that aren't archived, and narrows every tab to the chosen one", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect([...(select as HTMLSelectElement).options].map((option) => option.text)).toEqual([
        "All",
        "ORB breakout",
      ]),
    );
    fireEvent.change(select, { target: { value: "orb" } });
    expect(onSearch).toHaveBeenCalledWith({ setup: "orb" });
    rerender(<Analytics search={{ setup: "orb" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("+$100.00"));
  });

  it("lists an archived setup the link names", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    renderWithClient(<Analytics search={{ setup: "old" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("-$300.00"));
    const select = screen.getByRole("combobox", { name: "Setup" }) as HTMLSelectElement;
    expect(select.value).toBe("old");
    expect([...select.options].map((option) => option.text)).toEqual(["All", "Old setup", "ORB breakout"]);
  });

  it("counts a setup the journal doesn't have as All", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    renderWithClient(<Analytics search={{ setup: "gone" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$80.00"));
    expect((screen.getByRole("combobox", { name: "Setup" }) as HTMLSelectElement).value).toBe("");
  });
});

describe("Analytics with an old link", () => {
```

The fill test there has its own fetch stub, which must now answer the setups and tags too: Replace:

```tsx
            : path === "/api/option-quotes"
              ? { quotes: {}, available: true }
              : MOVED;
```

with:

```tsx
            : path === "/api/option-quotes"
              ? { quotes: {}, available: true }
              : path === "/api/setups" || path === "/api/tags"
                ? []
                : MOVED;
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/search.test.ts apps/web/src/analytics/data.test.tsx apps/web/src/analytics/edges.test.ts apps/web/src/routes/Analytics.test.tsx`
Expected: FAIL:
- the new search keys are dropped;
- `filterTrades` ignores `setup`;
- `resolveEdges("credit")` finds no split;
- there's no Setup combobox.

- [ ] **Step 4: Parse the new keys**

In `apps/web/src/analytics/search.ts`: Replace:

```ts
import { addDays, parseEdges, WEEKDAYS, weekdayOfDate } from "@tj/core";
import type { Book, TradeFilter } from "./data.js";
import { firstDay, lastDay, monthOf, shiftMonth } from "./dates.js";

/** The Analytics page's URL state. Defaults are left out, so the URL stays short (spec §7.1). */
export interface AnalyticsSearch {
  tab?: "flies";
  from?: string;
  to?: string;
  /** One book; absent means both. */
  books?: Book;
  ticker?: string;
  excluded?: true;
  creditEdges?: string;
  contractEdges?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A ticker such as M, BRK.B, BF-B or BRK/B. */
const TICKER = /^[A-Z][A-Z0-9./-]{0,9}$/;
```

with:

```ts
import { addDays, BREAKDOWNS, type Breakdown, parseEdges, WEEKDAYS, weekdayOfDate } from "@tj/core";
import type { Book, TradeFilter } from "./data.js";
import { firstDay, lastDay, monthOf, shiftMonth } from "./dates.js";

/** The Analytics page's URL state. Defaults are left out, so the URL stays short (spec §7.1). */
export interface AnalyticsSearch {
  tab?: "scalps" | "flies";
  from?: string;
  to?: string;
  /** One book; absent means both. */
  books?: Book;
  ticker?: string;
  /** A setup's id (scalp-analytics spec §5.2). */
  setup?: string;
  excluded?: true;
  /** The Scalps tab's breakdown; absent means by setup. */
  by?: Exclude<Breakdown, "setup">;
  /** What the Scalps tab's bars show; absent means net P&L. */
  metric?: "r" | "win";
  creditEdges?: string;
  contractEdges?: string;
  /** The Scalps tab's option-cost edges. */
  costEdges?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A ticker such as M, BRK.B, BF-B or BRK/B. */
const TICKER = /^[A-Z][A-Z0-9./-]{0,9}$/;
/** A setup id: a UUID, or a seeded id like "orb". */
const SETUP_ID = /^[A-Za-z0-9-]{1,64}$/;
```

Replace:

```ts
  const search: AnalyticsSearch = {};
  if (raw.tab === "flies") search.tab = "flies";
  const from = text(raw.from);
  if (isDate(from)) search.from = from;
  const to = text(raw.to);
  if (isDate(to)) search.to = to;
  if (raw.books === "live" || raw.books === "paper") search.books = raw.books;
  const ticker = text(raw.ticker)?.toUpperCase();
  if (ticker && TICKER.test(ticker)) search.ticker = ticker;
  if (raw.excluded === true || raw.excluded === "true") search.excluded = true;
  const creditEdges = text(raw.creditEdges);
  if (creditEdges && parseEdges(creditEdges, "usd")) search.creditEdges = creditEdges;
  const contractEdges = text(raw.contractEdges);
  if (contractEdges && parseEdges(contractEdges, "contracts")) search.contractEdges = contractEdges;
  return search;
}
```

with:

```ts
  const search: AnalyticsSearch = {};
  if (raw.tab === "scalps" || raw.tab === "flies") search.tab = raw.tab;
  const from = text(raw.from);
  if (isDate(from)) search.from = from;
  const to = text(raw.to);
  if (isDate(to)) search.to = to;
  if (raw.books === "live" || raw.books === "paper") search.books = raw.books;
  const ticker = text(raw.ticker)?.toUpperCase();
  if (ticker && TICKER.test(ticker)) search.ticker = ticker;
  const setup = text(raw.setup);
  if (setup && SETUP_ID.test(setup)) search.setup = setup;
  if (raw.excluded === true || raw.excluded === "true") search.excluded = true;
  const by = BREAKDOWNS.find((each) => each === raw.by);
  if (by && by !== "setup") search.by = by;
  if (raw.metric === "r" || raw.metric === "win") search.metric = raw.metric;
  const creditEdges = text(raw.creditEdges);
  if (creditEdges && parseEdges(creditEdges, "usd")) search.creditEdges = creditEdges;
  const contractEdges = text(raw.contractEdges);
  if (contractEdges && parseEdges(contractEdges, "contracts")) search.contractEdges = contractEdges;
  const costEdges = text(raw.costEdges);
  if (costEdges && parseEdges(costEdges, "usd")) search.costEdges = costEdges;
  return search;
}
```

Replace:

```ts
  if (search.ticker) filter.ticker = search.ticker;
```

with:

```ts
  if (search.ticker) filter.ticker = search.ticker;
  if (search.setup) filter.setup = search.setup;
```

- [ ] **Step 5: Filter by setup**

In `apps/web/src/analytics/data.ts`: Replace:

```ts
  ticker?: string;
  /** YYYY-MM-DD, New York close date, inclusive. */
  from?: string;
```

with:

```ts
  ticker?: string;
  /** A setup's id. */
  setup?: string;
  /** YYYY-MM-DD, New York close date, inclusive. */
  from?: string;
```

Replace:

```ts
export function filterTrades<
  T extends { book: string; underlying: string; closedAt: number | null; excluded: boolean },
>(trades: readonly T[], filter: TradeFilter): T[] {
  const books: readonly string[] = filter.books;
  return trades.filter((trade) => {
    if (!books.includes(trade.book)) return false;
    if (filter.ticker && trade.underlying !== filter.ticker) return false;
```

with:

```ts
export function filterTrades<
  T extends {
    book: string;
    underlying: string;
    setupId?: string | null;
    closedAt: number | null;
    excluded: boolean;
  },
>(trades: readonly T[], filter: TradeFilter): T[] {
  const books: readonly string[] = filter.books;
  return trades.filter((trade) => {
    if (!books.includes(trade.book)) return false;
    if (filter.ticker && trade.underlying !== filter.ticker) return false;
    if (filter.setup && trade.setupId !== filter.setup) return false;
```

- [ ] **Step 6: Key the edges by split**

Replace the whole of `apps/web/src/analytics/edges.ts` with:

```ts
import { DEFAULT_EDGES, type EdgeKind, parseEdges } from "@tj/core";

/** The splits whose edges can be edited: the flies' credit, contracts, and the scalps' option cost. */
export type EdgeSplit = "credit" | "contracts" | "cost";

/** Each split's rules for parsing, and where this browser remembers its edges. */
export const EDGE_SPLITS: Record<EdgeSplit, { kind: EdgeKind; key: string }> = {
  credit: { kind: "usd", key: "tj.edges.credit" },
  contracts: { kind: "contracts", key: "tj.edges.contracts" },
  cost: { kind: "usd", key: "tj.edges.cost" },
};

function remembered(split: EdgeSplit): number[] | null {
  const { kind, key } = EDGE_SPLITS[split];
  try {
    const saved = localStorage.getItem(key);
    return saved ? parseEdges(saved, kind) : null;
  } catch {
    return null;
  }
}

/** The edges a split uses: the URL's, else the ones remembered in this browser, else the defaults. */
export function resolveEdges(split: EdgeSplit, fromUrl?: string): number[] {
  const { kind } = EDGE_SPLITS[split];
  return (fromUrl ? parseEdges(fromUrl, kind) : null) ?? remembered(split) ?? [...DEFAULT_EDGES[kind]];
}

/** Remembers edges for this browser, or forgets them with null. False when storage is blocked; the URL still carries them. */
export function rememberEdges(split: EdgeSplit, edges: readonly number[] | null): boolean {
  const { key } = EDGE_SPLITS[split];
  try {
    if (edges) localStorage.setItem(key, edges.join(","));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
```

In `apps/web/src/routes/FliesTab.tsx`, the credit edges are now the `credit` split: Replace:

```tsx
resolveEdges("usd", search.creditEdges)
```

with:

```tsx
resolveEdges("credit", search.creditEdges)
```

Replace:

```tsx
rememberEdges("usd", edges);
```

with:

```tsx
rememberEdges("credit", edges);
```

In `apps/web/src/analytics/SplitGrid.tsx`, export the edge editor for the Scalps tab's breakdown: Replace:

```tsx
function EdgeEditor({ title, control }: { title: string; control: EdgeControl }) {
```

with:

```tsx
/** An "edit" link that opens a field for a split's edges, with Save and Reset. */
export function EdgeEditor({ title, control }: { title: string; control: EdgeControl }) {
```

- [ ] **Step 7: The Setup dropdown**

In `apps/web/src/routes/Analytics.tsx`: Replace:

```tsx
import { todayNy } from "../market.js";
```

with:

```tsx
import { todayNy } from "../market.js";
import { type Setup, useSetups } from "../review/data.js";
```

Replace:

```tsx
  const { data, isLoading, error } = useAllTrades();
  const tickers = useMemo(() => [...new Set((data ?? []).map((trade) => trade.underlying))].sort(), [data]);
  // A ticker the journal doesn't have (an old or hand-edited link) counts as All, which is what the dropdown shows.
  const view = useMemo(
    () => (search.ticker && !tickers.includes(search.ticker) ? { ...search, ticker: undefined } : search),
    [search, tickers],
  );
```

with:

```tsx
  const { data, isLoading, error } = useAllTrades();
  const { data: setups } = useSetups();
  const tickers = useMemo(() => [...new Set((data ?? []).map((trade) => trade.underlying))].sort(), [data]);
  // A ticker or setup the journal doesn't have (an old or hand-edited link) counts as All, which is what the
  // dropdown shows. A setup is only judged once the setups have loaded.
  const view = useMemo(() => {
    let next = search;
    if (next.ticker && !tickers.includes(next.ticker)) next = { ...next, ticker: undefined };
    if (next.setup && setups && !setups.some((setup) => setup.id === next.setup))
      next = { ...next, setup: undefined };
    return next;
  }, [search, tickers, setups]);
```

Replace:

```tsx
      <FilterRow search={view} onSearch={onSearch} tickers={tickers} />
```

with:

```tsx
      <FilterRow search={view} onSearch={onSearch} tickers={tickers} setups={setups ?? []} />
```

Replace:

```tsx
function FilterRow({
  search,
  onSearch,
  tickers,
}: {
  search: AnalyticsSearch;
  onSearch: AnalyticsProps["onSearch"];
  tickers: readonly string[];
}) {
  const today = todayNy();
  const preset = activePreset(search, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || preset === "custom";
  const books = search.books ? [search.books] : ["live", "paper"];
```

with:

```tsx
function FilterRow({
  search,
  onSearch,
  tickers,
  setups,
}: {
  search: AnalyticsSearch;
  onSearch: AnalyticsProps["onSearch"];
  tickers: readonly string[];
  setups: readonly Setup[];
}) {
  const today = todayNy();
  const preset = activePreset(search, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || preset === "custom";
  const books = search.books ? [search.books] : ["live", "paper"];
  // Archived setups stay out of the list unless the link names one.
  const setupOptions = setups
    .filter((setup) => !setup.archived || setup.id === search.setup)
    .sort((a, b) => a.name.localeCompare(b.name));
```

Replace:

```tsx
          {tickers.map((ticker) => (
            <option key={ticker} value={ticker}>
              {ticker}
            </option>
          ))}
        </select>
      </label>
```

with:

```tsx
          {tickers.map((ticker) => (
            <option key={ticker} value={ticker}>
              {ticker}
            </option>
          ))}
        </select>
      </label>
      <label className="ml-2 flex items-center gap-1 text-muted uppercase tracking-wider">
        Setup
        <select
          aria-label="Setup"
          value={search.setup ?? ""}
          onChange={(event) => onSearch({ setup: event.target.value || undefined })}
          className={INPUT}
        >
          <option value="">All</option>
          {setupOptions.map((setup) => (
            <option key={setup.id} value={setup.id}>
              {setup.name}
            </option>
          ))}
        </select>
      </label>
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/search.test.ts apps/web/src/analytics/data.test.tsx apps/web/src/analytics/edges.test.ts apps/web/src/routes/Analytics.test.tsx`
Expected: PASS: 14, 6, 4 and 20 tests.

- [ ] **Step 9: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/search.ts apps/web/src/analytics/data.ts apps/web/src/analytics/edges.ts apps/web/src/analytics/SplitGrid.tsx apps/web/src/routes/FliesTab.tsx apps/web/src/routes/Analytics.tsx apps/web/src/analytics/testing.tsx apps/web/src/analytics/search.test.ts apps/web/src/analytics/data.test.tsx apps/web/src/analytics/edges.test.ts apps/web/src/routes/Analytics.test.tsx
git commit -m "feat: a Setup filter on Analytics, the Scalps tab's URL keys, and edges by split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web — mistake cost with the avg-R dumbbell

**Files:**
- Create: `apps/web/src/analytics/MistakeCost.tsx`
- Test: `apps/web/src/analytics/MistakeCost.test.tsx`

**Interfaces:**
- Consumes: `GroupStats` and `MistakeRow` (Task 2); `dollars`, `rText` and `winRateText` (`format.ts`); `Section`.
- Produces: `MistakeCost({ rows })`, `dumbbellExtent(rows) => number` (2, or the next whole R past the largest average) and `dumbbellTitle(row) => string`. Task 6 renders `MistakeCost`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/analytics/MistakeCost.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import type { GroupStats, MistakeRow } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dumbbellExtent, dumbbellTitle, MistakeCost } from "./MistakeCost.js";

const side = (trades: number, net: number, avgR: number | null, winRate: number): GroupStats => ({
  trades,
  net,
  avgR,
  rCount: avgR == null ? 0 : trades,
  winRate,
  profitFactor: null,
  avgReturn: null,
  returnCount: 0,
});

const CHASED: MistakeRow = {
  tagId: "chased",
  label: "Chased entry",
  withTag: side(7, -310, -0.62, 2 / 7),
  withoutTag: side(31, 1594, 0.52, 19 / 31),
};
const CLEAN: MistakeRow = {
  tagId: null,
  label: "no mistakes",
  withTag: side(21, 1684, 0.71, 14 / 21),
  withoutTag: side(17, -400, -0.28, 7 / 17),
};

describe("MistakeCost", () => {
  it("shows each mistake's scalps against the rest, then no mistakes", () => {
    render(<MistakeCost rows={[CHASED, CLEAN]} />);
    const cells = (label: string) =>
      [...(screen.getByText(label).closest("tr")?.querySelectorAll("td") ?? [])]
        .slice(0, 9)
        .map((cell) => cell.textContent);
    expect(cells("Chased entry")).toEqual([
      "Chased entry",
      "7",
      "−$310",
      "−0.62R",
      "28.6%",
      "31",
      "+$1,594",
      "+0.52R",
      "61.3%",
    ]);
    expect(cells("no mistakes")[0]).toBe("no mistakes");
  });

  it("draws the with dot blue and the without dot gray, joined red when the tag does worse", () => {
    render(<MistakeCost rows={[CHASED, CLEAN]} />);
    const chased = within(screen.getByText("Chased entry").closest("tr") as HTMLElement);
    expect(chased.getByTestId("dot-with").style.left).toBe("calc(34.5% - 5px)");
    expect(chased.getByTestId("dot-without").style.left).toBe("calc(63% - 5px)");
    expect(chased.getByTestId("link").className).toContain("bg-down/60");
    expect(chased.getByTitle("Chased entry: −0.62R with, +0.52R without, 1.14R worse")).toBeTruthy();
    const clean = within(screen.getByText("no mistakes").closest("tr") as HTMLElement);
    expect(clean.getByTestId("link").className).toContain("bg-up/60");
  });

  it("draws no line and one dot when a side has no R, and dashes out an empty side", () => {
    const noR: MistakeRow = { ...CHASED, withTag: side(2, -70, null, 0), withoutTag: null };
    render(<MistakeCost rows={[noR]} />);
    const row = within(screen.getByText("Chased entry").closest("tr") as HTMLElement);
    expect(row.queryByTestId("link")).toBeNull();
    expect(row.queryByTestId("dot-with")).toBeNull();
    expect(row.getAllByText("—")).toHaveLength(5);
    expect(dumbbellTitle(noR)).toBe("Chased entry: no R with, no R without");
  });

  it("widens the axis past ±2R to the next whole R, and labels its ends", () => {
    const wide: MistakeRow = { ...CHASED, withTag: side(3, -300, -2.4, 0) };
    expect(dumbbellExtent([CHASED])).toBe(2);
    expect(dumbbellExtent([wide])).toBe(3);
    render(<MistakeCost rows={[wide]} />);
    for (const tick of ["−3R", "−1.5", "0", "+1.5", "+3R"]) expect(screen.getByText(tick)).toBeTruthy();
  });

  it("says so when no scalp carries a mistake", () => {
    render(<MistakeCost rows={[]} />);
    expect(screen.getByText("No mistakes tagged in this range.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/MistakeCost.test.tsx`
Expected: FAIL: `./MistakeCost.js` doesn't exist.

- [ ] **Step 3: Write the component**

Create `apps/web/src/analytics/MistakeCost.tsx`. The dumbbell is positioned HTML, so it's testable in jsdom:

```tsx
import type { GroupStats, MistakeRow } from "@tj/core";
import { dollars, rText, winRateText } from "./format.js";
import { Section } from "./Section.js";

const WITH = "#5b8cff";
const WITHOUT = "#6b7385";

const tone = (value: number | null) => {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
};

/** The dumbbell's half-width in R: 2, or the next whole R past the largest average (spec §6.5). */
export function dumbbellExtent(rows: readonly MistakeRow[]): number {
  const largest = Math.max(
    0,
    ...rows.flatMap((row) => [row.withTag?.avgR, row.withoutTag?.avgR].map((r) => Math.abs(r ?? 0))),
  );
  return Math.max(2, Math.ceil(largest));
}

/** Where an R sits across the axis, in percent. */
const at = (r: number, extent: number) => 50 + (r / extent) * 50;

/** What hovering a dumbbell says: "Chased entry: −0.62R with, +0.52R without, 1.14R worse". */
export function dumbbellTitle(row: MistakeRow): string {
  const withR = row.withTag?.avgR ?? null;
  const withoutR = row.withoutTag?.avgR ?? null;
  const side = (r: number | null) => (r == null ? "no R" : rText(r));
  let gap = "";
  if (withR != null && withoutR != null) {
    const difference = withR - withoutR;
    gap =
      Math.abs(difference) < 0.005
        ? ", no different"
        : `, ${Math.abs(difference).toFixed(2)}R ${difference < 0 ? "worse" : "better"}`;
  }
  return `${row.label}: ${side(withR)} with, ${side(withoutR)} without${gap}`;
}

function Dumbbell({ row, extent }: { row: MistakeRow; extent: number }) {
  const withR = row.withTag?.avgR ?? null;
  const withoutR = row.withoutTag?.avgR ?? null;
  let link = "";
  if (withR != null && withoutR != null) {
    if (withR < withoutR) link = "bg-down/60";
    else if (withR > withoutR) link = "bg-up/60";
    else link = "bg-muted/60";
  }
  const dot = (r: number, color: string, testId: string) => (
    <span
      data-testid={testId}
      className="absolute top-[2px] size-2.5 rounded-full shadow-[0_0_0_2px_var(--color-panel)]"
      style={{ left: `calc(${at(r, extent)}% - 5px)`, background: color }}
    />
  );
  return (
    <div title={dumbbellTitle(row)} className="relative h-3.5 min-w-32">
      <span className="absolute inset-y-0 left-1/2 w-px bg-[#2a2e39]" />
      {withR != null && withoutR != null && (
        <span
          data-testid="link"
          className={`absolute top-[6px] h-0.5 rounded-[1px] ${link}`}
          style={{
            left: `${Math.min(at(withR, extent), at(withoutR, extent))}%`,
            width: `${Math.abs(at(withR, extent) - at(withoutR, extent))}%`,
          }}
        />
      )}
      {withoutR != null && dot(withoutR, WITHOUT, "dot-without")}
      {withR != null && dot(withR, WITH, "dot-with")}
    </div>
  );
}

function SideCells({ side }: { side: GroupStats | null }) {
  if (!side) {
    return (
      <>
        {["n", "net", "r", "win"].map((cell, index) => (
          <td key={cell} className={`num text-right text-muted ${index === 0 ? "border-line border-l" : ""}`}>
            —
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      <td className="num border-line border-l text-right text-muted">{side.trades}</td>
      <td className={`num text-right ${tone(side.net)}`}>{dollars(side.net)}</td>
      <td className={`num text-right ${tone(side.avgR)}`}>{side.avgR == null ? "—" : rText(side.avgR)}</td>
      <td className="num text-right">{winRateText(side.winRate)}</td>
    </>
  );
}

const SIDE_HEADERS = ["Net", "Avg R", "Win %"];

/** Each mistake's scalps against the rest, with an avg-R dumbbell (scalp-analytics spec §6.5). */
export function MistakeCost({ rows }: { rows: readonly MistakeRow[] }) {
  const extent = dumbbellExtent(rows);
  const legend = (
    <span className="flex items-center gap-2 normal-case tracking-normal">
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full" style={{ background: WITH }} />
        with
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full" style={{ background: WITHOUT }} />
        without
      </span>
    </span>
  );
  return (
    <Section title="Mistake cost" right={rows.length > 0 ? legend : undefined}>
      {rows.length === 0 ? (
        <p className="text-muted">No mistakes tagged in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">Mistake</th>
              <th className="border-line border-l text-right font-medium">With</th>
              {SIDE_HEADERS.map((header) => (
                <th key={`with-${header}`} className="text-right font-medium">
                  {header}
                </th>
              ))}
              <th className="border-line border-l text-right font-medium">Without</th>
              {SIDE_HEADERS.map((header) => (
                <th key={`without-${header}`} className="text-right font-medium">
                  {header}
                </th>
              ))}
              <th className="border-line border-l text-center font-medium">Avg R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tagId ?? "none"} className="border-line border-t">
                <td className={`py-0.5 ${row.tagId == null ? "text-muted" : ""}`}>{row.label}</td>
                <SideCells side={row.withTag} />
                <SideCells side={row.withoutTag} />
                <td className="border-line border-l px-2">
                  <Dumbbell row={row} extent={extent} />
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={9} />
              <td className="border-line border-l px-2">
                <div className="relative h-3 text-[8px] text-muted">
                  {[-1, -0.5, 0, 0.5, 1].map((share, index) => {
                    const value = share * extent;
                    let label = `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
                    if (index === 0 || index === 4) label += "R";
                    return (
                      <span
                        key={share}
                        className="absolute -translate-x-1/2"
                        style={{ left: `${50 + share * 50}%` }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/MistakeCost.test.tsx`
Expected: PASS: 5 tests.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/MistakeCost.tsx apps/web/src/analytics/MistakeCost.test.tsx
git commit -m "feat: mistake cost with an avg-R dumbbell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web — the backfill

**Files:**
- Modify: `apps/web/src/review/prices.ts` (imports; append)
- Test: `apps/web/src/review/prices.test.tsx` (imports; append)

**Interfaces:**
- Consumes: `useFillScalpPrices`, `needsPrices` and `RETRY_MS` (same file).
- Produces:
  - `BACKFILL_COPY` (`no_key`, `unreachable`, `failed`);
  - `BackfillState` (`fetching: number`, `problem: string | null`);
  - `useBackfillPrices(trades: readonly TradeView[] | undefined) => BackfillState`.
  - Task 6 passes its state to `coverageText`; Tasks 6 and 7 call it with `useAllTrades().data`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/review/prices.test.tsx`: Replace:

```tsx
import { needsPrices, useAutoFillPrices, usePriceNote } from "./prices.js";
```

with:

```tsx
import { needsPrices, useAutoFillPrices, useBackfillPrices, usePriceNote } from "./prices.js";
```

Then append to the end of the file:

```tsx
function Backfill({ trades }: { trades: TradeView[] | undefined }) {
  const state = useBackfillPrices(trades);
  return <p data-testid="backfill">{`${state.fetching}|${state.problem ?? ""}`}</p>;
}

/** Renders the backfill under StrictMode, as the app does. */
function renderBackfill(trades: TradeView[] | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (next: TradeView[] | undefined) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Backfill trades={next} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(ui(trades));
  return { rerender: (next: TradeView[] | undefined) => view.rerender(ui(next)) };
}

const backfill = () => screen.getByTestId("backfill").textContent;

describe("useBackfillPrices", () => {
  it("asks once, for every scalp still missing a price, and says how many while it runs", async () => {
    let answer: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fly = { ...scalp("f"), strategy: "iron_fly" } as TradeView;
    const page = renderBackfill(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    page.rerender([scalp("a"), scalp("b", FULL), fly, scalp("c", { ...FULL, holdHigh: null }, 2)]);
    await waitFor(() => expect(backfill()).toBe("2|"));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["a", "c"] }]);
    answer(new Response(JSON.stringify(filledAll()), { headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(backfill()).toBe("0|"));
    page.rerender([scalp("a"), scalp("d")]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks nothing when every scalp has its prices", async () => {
    const fetchMock = stubFill(filledAll);
    renderBackfill([scalp("a", FULL)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(backfill()).toBe("0|");
  });

  it("sends at most 1,000 ids a request", async () => {
    const fetchMock = stubFill(filledAll);
    renderBackfill(Array.from({ length: 1001 }, (_, index) => scalp(`t${index}`)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies(fetchMock).map((body) => body.tradeIds.length)).toEqual([1000, 1]);
  });

  it("says why when there's no key, or the request fails", async () => {
    stubFill(() => ({
      filled: 0,
      missing: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to fetch the stock price." },
    }));
    renderBackfill([scalp("a")]);
    await waitFor(() =>
      expect(backfill()).toBe("0|Add an Alpaca key in Settings to fetch the missing stock prices."),
    );
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderBackfill([scalp("b")]);
    await waitFor(() =>
      expect(screen.getAllByTestId("backfill").at(-1)?.textContent).toBe(
        "0|Couldn't fetch stock prices: reload to try again.",
      ),
    );
  });

  it("asks again a minute later for the scalps Alpaca's delay held back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFill((tradeIds) => ({
      filled: 0,
      missing: tradeIds.filter((id) => id === "late").map((tradeId) => ({ tradeId, reason: "too_recent" })),
      unavailable: null,
    }));
    renderBackfill([scalp("early"), scalp("late")]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodies(fetchMock)).toEqual([{ tradeIds: ["early", "late"] }, { tradeIds: ["late"] }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/review/prices.test.tsx`
Expected: FAIL: `useBackfillPrices` isn't exported.

- [ ] **Step 3: Write the hook**

In `apps/web/src/review/prices.ts`: Replace:

```ts
import { useEffect, useRef } from "react";
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
```

Then append to the end of the file:

```ts
/** The backfill's words when the filler can't run (scalp-analytics spec §6.2). */
export const BACKFILL_COPY = {
  no_key: "Add an Alpaca key in Settings to fetch the missing stock prices.",
  unreachable: "Alpaca didn't answer: reload to try again.",
  failed: "Couldn't fetch stock prices: reload to try again.",
} as const;

/** The filler takes at most this many ids a request. */
const BATCH = 1000;

export interface BackfillState {
  /** How many scalps a fill is running for; 0 when none is. */
  fetching: number;
  /** Why the last fill couldn't run, in the page's words. */
  problem: string | null;
}

/**
 * Fetches every scalp's missing stock prices once per visit (scalp-analytics spec §8), so scalps reviewed before R
 * existed get their R without opening each page. Scalps Alpaca's delay held back are asked about again a minute later.
 */
export function useBackfillPrices(trades: readonly TradeView[] | undefined): BackfillState {
  const { mutateAsync } = useFillScalpPrices();
  const [state, setState] = useState<BackfillState>({ fetching: 0, problem: null });
  const [recent, setRecent] = useState<string[]>([]);
  // Whether this visit has asked, so StrictMode's second run and later refetches ask nothing.
  const asked = useRef(false);

  const run = useCallback(
    async (ids: string[]) => {
      setState({ fetching: ids.length, problem: null });
      let problem: string | null = null;
      const later: string[] = [];
      for (let start = 0; start < ids.length && problem == null; start += BATCH) {
        try {
          const result = await mutateAsync(ids.slice(start, start + BATCH));
          if (result.unavailable) problem = BACKFILL_COPY[result.unavailable.reason];
          for (const gap of result.missing) if (gap.reason === "too_recent") later.push(gap.tradeId);
        } catch {
          problem = BACKFILL_COPY.failed;
        }
      }
      setState({ fetching: 0, problem });
      setRecent(later);
    },
    [mutateAsync],
  );

  useEffect(() => {
    if (!trades || asked.current) return;
    asked.current = true;
    const ids = trades.filter(needsPrices).map((trade) => trade.id);
    if (ids.length > 0) void run(ids);
  }, [trades, run]);

  useEffect(() => {
    if (recent.length === 0) return;
    const timer = setTimeout(() => void run(recent), RETRY_MS);
    return () => clearTimeout(timer);
  }, [recent, run]);

  return state;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/review/prices.test.tsx`
Expected: PASS: 11 tests, 5 of them new.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/review/prices.ts apps/web/src/review/prices.test.tsx
git commit -m "feat: backfill every scalp's missing stock prices once a visit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web — the Scalps tab

**Files:**
- Create: `apps/web/src/analytics/scalpText.ts`
- Create: `apps/web/src/analytics/ScalpCharts.tsx`
- Create: `apps/web/src/analytics/Breakdown.tsx`
- Create: `apps/web/src/routes/ScalpsTab.tsx`
- Create: `apps/web/src/analytics/scalps.fixture.ts` (test rows, shared with Task 7)
- Modify: `apps/web/src/routes/Analytics.tsx` (the tab)
- Test: `apps/web/src/analytics/scalpText.test.ts`, `apps/web/src/routes/ScalpsTab.test.tsx`

**Interfaces:**
- Consumes:
  - Task 2's `scalpSummary`, `bucketStats`, `scalpBreakdown`, `mistakeCost`, `BreakdownContext`, `Breakdown`, `BreakdownRow`, `GroupStats` and `Coverage`;
  - Task 3's `AnalyticsSearch` keys, `resolveEdges` and `rememberEdges` (`"cost"`, `"contracts"`), `EdgeEditor`, `EdgeControl`, and `stubTrades` with its taxonomy;
  - Task 4's `MistakeCost`;
  - Task 5's `useBackfillPrices`;
  - `useSetups`, `useTags` and `Tag` (`review/data.ts`), `useAllTrades`, `KpiStrip`, `Section`, `Money`, `segmentClass`, `TabProps`, and `UP`, `DOWN`, `TICK` and `TOOLTIP` (`Charts.tsx`).
- Produces:
  - in `scalpText.ts`: `Metric` (`"net" | "r" | "win"`), `METRICS`, `metricValue`, `tickText`, `returnText` (Task 7 uses it), `holdText`, `rowSummary`, `FillState` and `coverageText`;
  - `MetricBars({ rows, metric, title?, height? })`;
  - `DIMENSIONS` and `BreakdownPanel({ by, onBy, rows, metric, edges? })`;
  - `ScalpsTab(props: TabProps)`;
  - in `scalps.fixture.ts`: `SCALP_ROWS`, `SCALP_SETUPS` and `SCALP_TAGS`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/analytics/scalpText.test.ts`:

```ts
import type { GroupStats } from "@tj/core";
import { describe, expect, it } from "vitest";
import { coverageText, holdText, metricValue, returnText, rowSummary, tickText } from "./scalpText.js";

const ROW: GroupStats = {
  trades: 12,
  winRate: 8 / 12,
  net: 820,
  profitFactor: 2,
  avgR: 0.62,
  rCount: 10,
  avgReturn: 0.084,
  returnCount: 12,
};
const EMPTY: GroupStats = {
  trades: 0,
  winRate: null,
  net: 0,
  profitFactor: null,
  avgR: null,
  rCount: 0,
  avgReturn: null,
  returnCount: 0,
};
const COVERAGE = { total: 38, withR: 31, noStop: 5, noStockPrice: 1, cannotPrice: 1 };

describe("metricValue", () => {
  it("picks net, avg R or win rate, and nothing for an empty row or a row without R", () => {
    expect(metricValue(ROW, "net")).toBe(820);
    expect(metricValue(ROW, "r")).toBe(0.62);
    expect(metricValue(ROW, "win")).toBeCloseTo(0.6667, 4);
    expect(metricValue(EMPTY, "net")).toBeNull();
    expect(metricValue({ ...ROW, avgR: null }, "r")).toBeNull();
  });
});

describe("tickText", () => {
  it("cuts a long name so bar labels don't overlap, keeping the count", () => {
    expect(tickText("0–5", 12)).toBe("0–5 · 12");
    expect(tickText("ORB breakout", 3)).toBe("ORB breakout · 3");
    expect(tickText("Earnings IV crush", 2)).toBe("Earnings IV… · 2");
  });
});

describe("returnText and holdText", () => {
  it("signs a return to one decimal with a true minus", () => {
    expect(returnText(0.084)).toBe("+8.4%");
    expect(returnText(-0.03)).toBe("−3.0%");
    expect(returnText(0.0001)).toBe("0.0%");
    expect(returnText(null)).toBe("—");
  });

  it("reads a hold in seconds, minutes, or hours and minutes", () => {
    expect(holdText(0.75)).toBe("45 s");
    expect(holdText(0.999)).toBe("1 min");
    expect(holdText(6.2)).toBe("6 min");
    expect(holdText(59.6)).toBe("1 h 0 min");
    expect(holdText(72)).toBe("1 h 12 min");
    expect(holdText(null)).toBe("—");
  });
});

describe("rowSummary", () => {
  it("says everything a bar stands for", () => {
    expect(rowSummary(ROW)).toBe("12 scalps · +$820 · +0.62R over 10 · win 66.7%");
    expect(rowSummary({ ...ROW, trades: 1, avgR: null, rCount: 0, winRate: 1 })).toBe(
      "1 scalp · +$820 · no R · win 100.0%",
    );
    expect(rowSummary(EMPTY)).toBe("no scalps");
  });
});

describe("coverageText", () => {
  it("names why scalps lack R, leaving out reasons nobody has", () => {
    expect(coverageText(COVERAGE)).toBe(
      "R covers 31 of 38 scalps · 5 have no stop · 1 has no stock price · 1 can't be priced",
    );
    expect(coverageText({ ...COVERAGE, withR: 36, noStop: 2, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers 36 of 38 scalps · 2 have no stop",
    );
  });

  it("says when every scalp has R, and nothing without scalps", () => {
    expect(coverageText({ total: 38, withR: 38, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers all 38 scalps",
    );
    expect(coverageText({ total: 1, withR: 1, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe(
      "R covers the scalp",
    );
    expect(coverageText({ total: 0, withR: 0, noStop: 0, noStockPrice: 0, cannotPrice: 0 })).toBe("");
  });

  it("says what the backfill is doing, or why it couldn't", () => {
    expect(coverageText(COVERAGE, { fetching: 7, problem: null })).toBe(
      "Fetching stock prices for 7 scalps…",
    );
    expect(coverageText(COVERAGE, { fetching: 1, problem: null })).toBe("Fetching stock prices for 1 scalp…");
    expect(
      coverageText(
        { total: 2, withR: 1, noStop: 0, noStockPrice: 1, cannotPrice: 0 },
        { fetching: 0, problem: "Alpaca didn't answer: reload to try again." },
      ),
    ).toBe("R covers 1 of 2 scalps · 1 has no stock price. Alpaca didn't answer: reload to try again.");
  });
});
```

Create `apps/web/src/analytics/scalps.fixture.ts`. It holds the core fixture's five scalps as the server lists them, plus a fly:

```ts
import { tradeRow } from "./testing.js";

export const SCALP_SETUPS = [
  { id: "orb", name: "ORB breakout", strategy: "scalp", description: null, archived: false, tradeCount: 3 },
  { id: "vwap", name: "VWAP reclaim", strategy: "scalp", description: null, archived: false, tradeCount: 1 },
];
export const SCALP_TAGS = [
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 2 },
  { id: "chased", name: "Chased entry", kind: "mistake", archived: false, tradeCount: 2 },
  { id: "moved", name: "Moved stop", kind: "mistake", archived: false, tradeCount: 1 },
];

/*
 * The core fixture's five scalps (packages/core/src/scalpStats.fixture.ts) as the server lists them, plus a fly.
 * Net +10, win 40%, Avg R +0.17R over 3 of 5, avg return +4.7%, PF 1.08, holds 2, 1, 15, 45 and 5 minutes.
 */
export const SCALP_ROWS = [
  tradeRow({
    id: "s1",
    strategy: "scalp",
    underlying: "NVDA",
    opened: "2026-09-28 09:31",
    closed: "2026-09-28 09:33",
    netPnl: 100,
    r: 1,
    setupId: "orb",
    grade: "A",
    tagIds: ["calm"],
    contracts: 2,
    expiry: "2026-09-28",
    book: "live",
  }),
  tradeRow({
    id: "s2",
    strategy: "scalp",
    underlying: "NVDA",
    opened: "2026-09-28 09:36",
    closed: "2026-09-28 09:37",
    netPnl: -50,
    r: -0.5,
    setupId: "orb",
    grade: "B",
    tagIds: ["chased"],
    right: "P",
    contracts: 2,
    expiry: "2026-09-28",
    book: "live",
  }),
  tradeRow({
    id: "s3",
    strategy: "scalp",
    underlying: "SPY",
    opened: "2026-09-28 09:50",
    closed: "2026-09-28 10:05",
    netPnl: 30,
    problem: "no_stop",
    setupId: "vwap",
    tagIds: ["chased", "calm"],
    openPrice: 3,
    expiry: "2026-09-29",
  }),
  tradeRow({
    id: "s4",
    strategy: "scalp",
    underlying: "QQQ",
    opened: "2026-09-29 10:45",
    closed: "2026-09-29 11:30",
    netPnl: -70,
    problem: "no_stock_price",
    grade: "A",
    tagIds: ["moved"],
    right: "P",
    contracts: 3,
    openPrice: 2,
    expiry: "2026-10-02",
    book: "live",
  }),
  tradeRow({
    id: "s5",
    strategy: "scalp",
    underlying: "SPY",
    opened: "2026-09-29 09:20",
    closed: "2026-09-29 09:25",
    netPnl: 0,
    r: 0,
    setupId: "orb",
    grade: "C",
    openPrice: 0.5,
    expiry: "2026-09-29",
    book: "live",
  }),
  tradeRow({
    id: "f1",
    underlying: "AA",
    opened: "2026-09-02 15:45",
    closed: "2026-09-03 09:50",
    netPnl: 999,
  }),
];
```

Create `apps/web/src/routes/ScalpsTab.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALP_ROWS, SCALP_SETUPS, SCALP_TAGS } from "../analytics/scalps.fixture.js";
import { renderWithClient, stubTrades } from "../analytics/testing.js";
import { Analytics } from "./Analytics.js";

// Neither chart library can draw in jsdom. The Overview's equity curve is left blank; the bars show the rows and
// the metric the page hands them.
vi.mock("../analytics/EquityCurve.js", () => ({ EquityCurve: () => <div data-testid="equity-curve" /> }));
vi.mock("../analytics/ScalpCharts.js", () => ({
  MetricBars: ({ rows, metric }: { rows: { label: string; trades: number }[]; metric: string }) => (
    <div data-testid="bars">
      {metric}: {rows.map((row) => `${row.label} ${row.trades}`).join("; ")}
    </div>
  ),
}));

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

function renderTab(search = {}, onSearch = vi.fn()) {
  stubTrades(SCALP_ROWS, [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
  const view = renderWithClient(<Analytics search={{ tab: "scalps", ...search }} onSearch={onSearch} />);
  return { ...view, onSearch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Analytics Scalps tab", () => {
  it("opens from the tab row", async () => {
    stubTrades(SCALP_ROWS);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Scalps" }));
    expect(onSearch).toHaveBeenCalledWith({ tab: "scalps" });
  });

  it("shows the scalps' KPIs, leaving the fly out", async () => {
    renderTab();
    await waitFor(() => expect(kpi("net")).toContain("+$10.00"));
    expect(kpi("win-rate")).toContain("40.0%");
    expect(kpi("avg-r")).toBe("Avg R+0.17Rover 3 of 5");
    expect(kpi("avg-return")).toBe("Avg return+4.7%on premium paid");
    expect(kpi("profit-factor")).toContain("1.08");
    expect(kpi("expectancy")).toContain("+$2.00");
    expect(kpi("avg-hold")).toBe("Avg hold14 minmedian 5 min");
    expect(kpi("scalps")).toContain("5");
  });

  it("says which scalps lack R, and why", async () => {
    renderTab();
    expect((await screen.findByTestId("r-coverage")).textContent).toBe(
      "R covers 3 of 5 scalps · 1 has no stop · 1 has no stock price",
    );
  });

  it("hands the time charts every bucket, and switches every bar's metric through the URL", async () => {
    const { onSearch, rerender } = renderTab();
    const open = within(await screen.findByRole("region", { name: "Minutes after the open" }));
    expect(open.getByTestId("bars").textContent).toBe(
      "net: before open 1; 0–5 1; 5–15 1; 15–30 1; 30–60 0; 60+ 1",
    );
    const hold = within(screen.getByRole("region", { name: "Hold time" }));
    expect(hold.getByTestId("bars").textContent).toBe("net: < 1 min 0; 1–3 2; 3–10 1; 10–30 1; 30+ 1");
    fireEvent.click(screen.getByRole("button", { name: "Avg R" }));
    expect(onSearch).toHaveBeenCalledWith({ metric: "r" });
    rerender(<Analytics search={{ tab: "scalps", metric: "r" }} onSearch={onSearch} />);
    await waitFor(() =>
      expect(screen.getAllByTestId("bars").every((bars) => bars.textContent?.startsWith("r:"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Net" }));
    expect(onSearch).toHaveBeenLastCalledWith({ metric: undefined });
  });

  it("breaks down by setup first, then by the dimension picked", async () => {
    const { onSearch, rerender } = renderTab();
    const table = await screen.findByRole("table", { name: "By Setup" });
    await waitFor(() => expect(within(table).getByText("ORB breakout")).toBeTruthy());
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["ORB breakout", "3", "33.3%", "+$50", "+0.17R", "+8.3%", "2.00"],
      ["VWAP reclaim", "1", "100.0%", "+$30", "—", "+10.0%", "∞"],
      ["no setup", "1", "0.0%", "−$70", "—", "−11.7%", "0.00"],
    ]);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Dimension" })).getByRole("button", { name: "Emotion" }),
    );
    expect(onSearch).toHaveBeenCalledWith({ by: "emotion" });
    rerender(<Analytics search={{ tab: "scalps", by: "emotion" }} onSearch={onSearch} />);
    const emotion = await screen.findByRole("table", { name: "By Emotion" });
    expect(within(emotion).getByText("Calm").closest("tr")?.textContent).toContain("+$130");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Dimension" })).getByRole("button", { name: "Setup" }),
    );
    expect(onSearch).toHaveBeenLastCalledWith({ by: undefined });
  });

  it("edits the option-cost edges, saving them to the URL and this browser", async () => {
    const { onSearch } = renderTab({ by: "cost" });
    const table = await screen.findByRole("table", { name: "By Option cost" });
    expect(within(table).getByText("< $250").closest("tr")?.textContent).toContain("+$50");
    const panel = within(screen.getByRole("region", { name: "Break down by" }));
    fireEvent.click(panel.getByRole("button", { name: "edit" }));
    fireEvent.change(panel.getByLabelText("Option cost edges"), { target: { value: "100" } });
    fireEvent.click(panel.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ costEdges: "100" });
    expect(localStorage.getItem("tj.edges.cost")).toBe("100");
  });

  it("fetches the stock prices scalps lack, saying so, then why it couldn't", async () => {
    let answer: (value: Response) => void = () => {};
    const rows = [...SCALP_ROWS.slice(0, 3), { ...SCALP_ROWS[3], scalpPrices: null }, ...SCALP_ROWS.slice(4)];
    const fetchMock = stubTrades(rows, [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
    const answered = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).includes("/api/risk/fill")) return answered?.(input, init) as Promise<Response>;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    });
    renderWithClient(<Analytics search={{ tab: "scalps" }} onSearch={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("r-coverage").textContent).toBe("Fetching stock prices for 1 scalp…"),
    );
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/risk/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["s4"] });
    const noKey = { reason: "no_key", message: "Add an Alpaca key in Settings to fetch the stock price." };
    answer(
      new Response(JSON.stringify({ filled: 0, missing: [], unavailable: noKey }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("r-coverage").textContent).toBe(
        "R covers 3 of 5 scalps · 1 has no stop · 1 has no stock price. Add an Alpaca key in Settings to fetch the missing stock prices.",
      ),
    );
  });

  it("sets each mistake against the rest, worst first, with no mistakes last", async () => {
    renderTab();
    // The section shows "Loading…" until the tags arrive, so it's looked up again once they have.
    const region = () => within(screen.getByRole("region", { name: "Mistake cost" }));
    await waitFor(() => expect(region().getByText("Moved stop")).toBeTruthy());
    const section = region();
    const labels = section
      .getAllByRole("row")
      .slice(1, -1)
      .map((row) => row.querySelector("td")?.textContent);
    expect(labels).toEqual(["Moved stop", "Chased entry", "no mistakes"]);
  });

  it("says so when the range has no closed scalps", async () => {
    renderTab({ ticker: "AA" });
    expect(await screen.findByText("No closed scalps in this range.")).toBeTruthy();
    expect(kpi("net")).toContain("—");
    expect(kpi("avg-r")).toBe("Avg R—");
    expect(screen.queryByTestId("r-coverage")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/scalpText.test.ts apps/web/src/routes/ScalpsTab.test.tsx`
Expected: FAIL: `./scalpText.js` doesn't exist, and the tab row has no Scalps button.

- [ ] **Step 3: The tab's words**

Create `apps/web/src/analytics/scalpText.ts`:

```ts
import type { Coverage, GroupStats } from "@tj/core";
import { dollars, rText, winRateText } from "./format.js";

/** What the Scalps tab's bars show (scalp-analytics spec §6.3). */
export type Metric = "net" | "r" | "win";

export const METRICS: readonly { id: Metric; label: string }[] = [
  { id: "net", label: "Net" },
  { id: "r", label: "Avg R" },
  { id: "win", label: "Win %" },
];

/** A row's bar under a metric; null draws no bar (no scalps, or no R). */
export function metricValue(row: GroupStats, metric: Metric): number | null {
  if (row.trades === 0) return null;
  if (metric === "r") return row.avgR;
  return metric === "win" ? row.winRate : row.net;
}

const TICK_CHARS = 12;

/** A bar's axis label, the name cut to 12 characters so neighbours don't overlap: "Earnings IV… · 12". */
export function tickText(label: string, trades: number): string {
  const short = label.length > TICK_CHARS ? `${label.slice(0, TICK_CHARS - 1)}…` : label;
  return `${short} · ${trades}`;
}

/** A return on cost with its sign: 0.084 → "+8.4%", −0.03 → "−3.0%"; "—" without one. */
export function returnText(value: number | null): string {
  if (value == null) return "—";
  const text = `${Math.abs(value * 100).toFixed(1)}%`;
  if (text === "0.0%") return text;
  return `${value > 0 ? "+" : "−"}${text}`;
}

/** A hold: "45 s" under a minute, "6 min" under an hour, "1 h 12 min" from an hour; "—" without one. */
export function holdText(minutes: number | null): string {
  if (minutes == null) return "—";
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} s`;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${whole % 60} min`;
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** Everything a row says at once, for a bar's tooltip: "12 scalps · +$820 · +0.62R over 10 · win 66.7%". */
export function rowSummary(row: GroupStats): string {
  if (row.trades === 0) return "no scalps";
  const r = row.avgR == null ? "no R" : `${rText(row.avgR)} over ${row.rCount}`;
  return `${count(row.trades, "scalp", "scalps")} · ${dollars(row.net)} · ${r} · win ${winRateText(row.winRate)}`;
}

/** The backfill's state (spec §8): how many scalps it's fetching prices for, and why it couldn't. */
export interface FillState {
  fetching: number;
  problem: string | null;
}

/** The line under the KPI strip saying which scalps lack R, and why (spec §6.2). Empty without scalps. */
export function coverageText(coverage: Coverage, fill: FillState = { fetching: 0, problem: null }): string {
  if (coverage.total === 0) return "";
  if (fill.fetching > 0) return `Fetching stock prices for ${count(fill.fetching, "scalp", "scalps")}…`;
  const { total, withR } = coverage;
  let text =
    withR === total
      ? `R covers ${total === 1 ? "the scalp" : `all ${total} scalps`}`
      : `R covers ${withR} of ${count(total, "scalp", "scalps")}`;
  const parts = [
    [coverage.noStop, "no stop"],
    [coverage.noStockPrice, "no stock price"],
  ] as const;
  for (const [value, what] of parts) {
    if (value > 0) text += ` · ${value} ${value === 1 ? "has" : "have"} ${what}`;
  }
  if (coverage.cannotPrice > 0) text += ` · ${coverage.cannotPrice} can't be priced`;
  return fill.problem ? `${text}. ${fill.problem}` : text;
}
```

- [ ] **Step 4: The bars**

Create `apps/web/src/analytics/ScalpCharts.tsx`. It's the one Recharts component, mocked in page tests as `Charts.tsx` is:

```tsx
import type { GroupStats } from "@tj/core";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOWN, TICK, TOOLTIP, UP } from "./Charts.js";
import { type Metric, metricValue, rowSummary, tickText } from "./scalpText.js";

const ACCENT = "#5b8cff";
const LINE = "#2a2e39";

export interface MetricRow extends GroupStats {
  label: string;
}

/**
 * One bar per row under the chosen metric (scalp-analytics spec §6.3): net and avg R coloured by sign from a zero line,
 * win % in the accent colour against a 50% line. The tooltip says everything the row stands for.
 */
export function MetricBars({
  rows,
  metric,
  title = (label) => label,
  height = 140,
}: {
  rows: readonly MetricRow[];
  metric: Metric;
  /** The tooltip's heading for a row, such as "0–5 min". */
  title?: (label: string) => string;
  height?: number;
}) {
  const data = rows.map((row) => ({
    tick: tickText(row.label, row.trades),
    value: metricValue(row, metric),
    heading: title(row.label),
    summary: rowSummary(row),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="tick" tick={TICK} interval={0} axisLine={false} tickLine={false} />
        <YAxis hide domain={metric === "win" ? [0, 1] : ["auto", "auto"]} />
        {metric === "win" ? (
          <ReferenceLine y={0.5} stroke={LINE} strokeDasharray="3 3" />
        ) : (
          <ReferenceLine y={0} stroke={LINE} />
        )}
        <Tooltip
          {...TOOLTIP}
          content={({ active, payload }) => {
            const point = active ? payload?.[0]?.payload : undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="px-2 py-1">
                <div>{point.heading}</div>
                <div className="text-muted">{point.summary}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.tick} fill={metric === "win" ? ACCENT : (point.value ?? 0) >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: The breakdown panel**

Create `apps/web/src/analytics/Breakdown.tsx`:

```tsx
import type { Breakdown, BreakdownRow } from "@tj/core";
import { dollars, profitFactorText, rText, segmentClass, winRateText } from "./format.js";
import { MetricBars } from "./ScalpCharts.js";
import { Section } from "./Section.js";
import { type EdgeControl, EdgeEditor } from "./SplitGrid.js";
import { type Metric, returnText } from "./scalpText.js";

export const DIMENSIONS: readonly { id: Breakdown; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "ticker", label: "Ticker" },
  { id: "dte", label: "DTE" },
  { id: "side", label: "Call/Put" },
  { id: "grade", label: "Grade" },
  { id: "emotion", label: "Emotion" },
  { id: "weekday", label: "Weekday" },
  { id: "cost", label: "Option cost" },
  { id: "contracts", label: "Contracts" },
  { id: "book", label: "Book" },
  { id: "month", label: "Month" },
];

const tone = (value: number | null) => {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
};

const HEADERS = ["n", "Win %", "Net", "Avg R", "Avg return", "PF"];

/** One dimension at a time: the picker, a table, and its bars (scalp-analytics spec §6.4). */
export function BreakdownPanel({
  by,
  onBy,
  rows,
  metric,
  edges,
}: {
  by: Breakdown;
  onBy: (by: Breakdown) => void;
  rows: readonly BreakdownRow[];
  metric: Metric;
  /** The edit link for a bucketed dimension's edges. */
  edges?: EdgeControl;
}) {
  const label = DIMENSIONS.find((dimension) => dimension.id === by)?.label ?? by;
  return (
    <Section title="Break down by" right={edges && <EdgeEditor title={label} control={edges} />}>
      <fieldset aria-label="Dimension" className="mb-2 flex flex-wrap gap-1 text-[11px]">
        {DIMENSIONS.map((dimension) => (
          <button
            key={dimension.id}
            type="button"
            aria-pressed={dimension.id === by}
            onClick={() => onBy(dimension.id)}
            className={segmentClass(dimension.id === by)}
          >
            {dimension.label}
          </button>
        ))}
      </fieldset>
      <div className="grid items-start gap-3 lg:grid-cols-[3fr_2fr]">
        <table aria-label={`By ${label}`} className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">{label}</th>
              {HEADERS.map((header) => (
                <th key={header} className="text-right font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-line border-t">
                <td className="py-0.5">{row.label}</td>
                <td className="num text-right text-muted">{row.trades}</td>
                <td className="num text-right">{winRateText(row.winRate)}</td>
                <td className={`num text-right ${tone(row.net)}`}>{dollars(row.net)}</td>
                <td
                  className={`num text-right ${tone(row.avgR)}`}
                  title={`over ${row.rCount} of ${row.trades}`}
                >
                  {row.avgR == null ? "—" : rText(row.avgR)}
                </td>
                <td className={`num text-right ${tone(row.avgReturn)}`}>{returnText(row.avgReturn)}</td>
                <td className="num text-right">{profitFactorText(row.profitFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <MetricBars rows={rows} metric={metric} />
      </div>
    </Section>
  );
}
```

- [ ] **Step 6: The tab**

Create `apps/web/src/routes/ScalpsTab.tsx`:

```tsx
import {
  type BreakdownContext,
  bucketStats,
  closedTrades,
  mistakeCost,
  scalpBreakdown,
  scalpSummary,
} from "@tj/core";
import { useMemo } from "react";
import { BreakdownPanel } from "../analytics/Breakdown.js";
import { useAllTrades } from "../analytics/data.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { profitFactorText, rText, segmentClass, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { MistakeCost } from "../analytics/MistakeCost.js";
import { MetricBars } from "../analytics/ScalpCharts.js";
import { Section } from "../analytics/Section.js";
import type { EdgeControl } from "../analytics/SplitGrid.js";
import { coverageText, holdText, METRICS, type Metric, returnText } from "../analytics/scalpText.js";
import { Money } from "../components/ui.js";
import { type Tag, useSetups, useTags } from "../review/data.js";
import { useBackfillPrices } from "../review/prices.js";
import type { TabProps } from "./OverviewTab.js";

const tagNames = (tags: readonly Tag[] | undefined, kind: "mistake" | "emotion") =>
  new Map((tags ?? []).filter((tag) => tag.kind === kind).map((tag) => [tag.id, tag.name]));

const openTitle = (label: string) => (label === "before open" ? label : `${label} min after the open`);
const holdTitle = (label: string) => {
  if (label === "unknown") return "unknown hold";
  return `held ${label.endsWith("min") ? label : `${label} min`}`;
};

/** Which scalps work: by time of day, hold, setup and the rest (scalp-analytics spec §6). */
export function ScalpsTab({ trades, search, onSearch }: TabProps) {
  const scalps = useMemo(() => closedTrades(trades.filter((trade) => trade.strategy === "scalp")), [trades]);
  const { data: setups = [] } = useSetups();
  const { data: tags, isError: tagsFailed } = useTags();
  // Every scalp, not just the filtered ones: the backfill runs once a visit (spec §8).
  const fill = useBackfillPrices(useAllTrades().data);
  const summary = scalpSummary(scalps);
  const none = summary.trades === 0;
  const metric: Metric = search.metric ?? "net";
  const by = search.by ?? "setup";
  const costEdges = resolveEdges("cost", search.costEdges);
  const contractEdges = resolveEdges("contracts", search.contractEdges);
  const context: BreakdownContext = {
    setups: new Map(setups.map((setup) => [setup.id, setup.name])),
    emotions: tagNames(tags, "emotion"),
    costEdges,
    contractEdges,
  };

  let edges: EdgeControl | undefined;
  if (by === "cost") {
    edges = {
      kind: "usd",
      edges: costEdges,
      onChange: (next) => {
        rememberEdges("cost", next);
        onSearch({ costEdges: next ? next.join(",") : undefined });
      },
    };
  } else if (by === "contracts") {
    edges = {
      kind: "contracts",
      edges: contractEdges,
      onChange: (next) => {
        rememberEdges("contracts", next);
        onSearch({ contractEdges: next ? next.join(",") : undefined });
      },
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          {
            id: "avg-r",
            label: "Avg R",
            value: summary.avgR == null ? "—" : rText(summary.avgR),
            sub: none ? undefined : `over ${summary.rCount} of ${summary.trades}`,
          },
          {
            id: "avg-return",
            label: "Avg return",
            value: returnText(summary.avgReturn),
            sub: "on premium paid",
          },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          {
            id: "expectancy",
            label: "Expectancy",
            value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} />,
          },
          {
            id: "avg-hold",
            label: "Avg hold",
            value: holdText(summary.avgHoldMinutes),
            sub:
              summary.medianHoldMinutes == null ? undefined : `median ${holdText(summary.medianHoldMinutes)}`,
          },
          { id: "scalps", label: "Scalps", value: summary.trades },
        ]}
      />
      {none ? (
        <p className="text-muted">No closed scalps in this range.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="r-coverage" className="text-[10px] text-muted">
              {coverageText(summary.coverage, fill)}
            </p>
            <fieldset aria-label="Bars" className="flex items-center gap-1 text-[11px]">
              <span className="mr-1 text-[9px] text-muted uppercase tracking-wider">Bars</span>
              {METRICS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  aria-pressed={each.id === metric}
                  onClick={() => onSearch({ metric: each.id === "net" ? undefined : each.id })}
                  className={segmentClass(each.id === metric)}
                >
                  {each.label}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Minutes after the open">
              <MetricBars rows={bucketStats(scalps, "open")} metric={metric} title={openTitle} />
            </Section>
            <Section title="Hold time">
              <MetricBars rows={bucketStats(scalps, "hold")} metric={metric} title={holdTitle} />
            </Section>
          </div>
          <BreakdownPanel
            by={by}
            onBy={(next) => onSearch({ by: next === "setup" ? undefined : next })}
            rows={scalpBreakdown(scalps, by, context)}
            metric={metric}
            edges={edges}
          />
          {tags ? (
            <MistakeCost rows={mistakeCost(scalps, tagNames(tags, "mistake"))} />
          ) : (
            <Section title="Mistake cost">
              <p className="text-muted">{tagsFailed ? "Couldn't load the tags." : "Loading…"}</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
```

In `apps/web/src/routes/Analytics.tsx`: Replace:

```tsx
import { OverviewTab } from "./OverviewTab.js";
```

with:

```tsx
import { OverviewTab } from "./OverviewTab.js";
import { ScalpsTab } from "./ScalpsTab.js";
```

Replace:

```tsx
        <TabButton active={search.tab !== "flies"} onClick={() => onSearch({ tab: undefined })}>
          Overview
        </TabButton>
        <TabButton active={search.tab === "flies"} onClick={() => onSearch({ tab: "flies" })}>
          Iron flies
        </TabButton>
      </nav>
      {search.tab === "flies" ? (
        <FliesTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      ) : (
        <OverviewTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
```

with:

```tsx
        <TabButton active={search.tab === undefined} onClick={() => onSearch({ tab: undefined })}>
          Overview
        </TabButton>
        <TabButton active={search.tab === "scalps"} onClick={() => onSearch({ tab: "scalps" })}>
          Scalps
        </TabButton>
        <TabButton active={search.tab === "flies"} onClick={() => onSearch({ tab: "flies" })}>
          Iron flies
        </TabButton>
      </nav>
      {search.tab === "scalps" && (
        <ScalpsTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
      {search.tab === "flies" && (
        <FliesTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
      {search.tab === undefined && (
        <OverviewTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
      )}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/scalpText.test.ts apps/web/src/routes/ScalpsTab.test.tsx apps/web/src/routes/Analytics.test.tsx`
Expected: PASS: 8, 9 and 20 tests.

- [ ] **Step 8: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/scalpText.ts apps/web/src/analytics/scalpText.test.ts apps/web/src/analytics/ScalpCharts.tsx apps/web/src/analytics/Breakdown.tsx apps/web/src/analytics/scalps.fixture.ts apps/web/src/routes/ScalpsTab.tsx apps/web/src/routes/ScalpsTab.test.tsx apps/web/src/routes/Analytics.tsx
git commit -m "feat: the Scalps tab: KPIs, R coverage, time of day, hold time, breakdowns and mistake cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web — the Playbook's setup cards

**Files:**
- Create: `apps/web/src/analytics/Sparkline.tsx`
- Create: `apps/web/src/analytics/SetupCards.tsx`
- Modify: `apps/web/src/review/text.ts` (append `strategyLabel`)
- Modify: `apps/web/src/routes/Playbook.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/analytics/SetupCards.test.tsx`, `apps/web/src/routes/Playbook.test.tsx`

**Interfaces:**
- Consumes: Task 2's `setupCards`, `SetupCard` and `CumulativePoint`; Task 5's `useBackfillPrices`; Task 6's `returnText` and `SCALP_ROWS` / `SCALP_SETUPS`; `closedTrades`, `nyDate`, `useAllTrades`, `Chip`, `todayNy`, `Setup`, `dollars`, `profitFactorText`, `rText`, `shareText` and `winRateText`.
- Produces:
  - `Sparkline({ points, format, label })`;
  - `SetupCards({ trades, setups, showArchived, onOpenSetup?, today? })`;
  - `strategyLabel(strategy) => "Scalps" | "Iron flies" | "Both"`;
  - `PlaybookProps` (`onOpenSetup?: (setupId, tab: "scalps" | "flies") => void`) and `Playbook(props)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/analytics/SetupCards.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import type { Setup } from "../review/data.js";
import { SetupCards } from "./SetupCards.js";
import { SCALP_ROWS, SCALP_SETUPS } from "./scalps.fixture.js";
import { tradeRow } from "./testing.js";

const SETUPS = [
  ...SCALP_SETUPS,
  {
    id: "crush",
    name: "Earnings IV crush",
    strategy: "iron_fly",
    description: "Sell the ATM fly into earnings",
    archived: false,
    tradeCount: 2,
  },
  { id: "old", name: "Old setup", strategy: null, description: null, archived: true, tradeCount: 1 },
] as Setup[];

/* Two 1-lot flies of last year, each with a max profit of 204 − 4 = $200: +100 and −50 keep 50 ÷ 400 = 12.5%. */
const FLIES = [
  tradeRow({
    id: "f2",
    underlying: "BB",
    opened: "2025-09-09 15:50",
    closed: "2025-09-10 09:45",
    netPnl: 100,
    setupId: "crush",
  }),
  tradeRow({
    id: "f3",
    underlying: "CC",
    opened: "2025-09-16 15:50",
    closed: "2025-09-17 09:45",
    netPnl: -50,
    setupId: "crush",
  }),
];
const OLD = tradeRow({
  id: "o1",
  strategy: "scalp",
  underlying: "AMD",
  opened: "2026-09-21 09:40",
  closed: "2026-09-21 09:45",
  netPnl: 20,
  setupId: "old",
});
const EXCLUDED = tradeRow({
  id: "x1",
  strategy: "scalp",
  underlying: "NVDA",
  opened: "2026-09-22 09:40",
  closed: "2026-09-22 09:45",
  netPnl: 999,
  setupId: "orb",
  excluded: true,
});
const TRADES = [...SCALP_ROWS, ...FLIES, OLD, EXCLUDED] as unknown as TradeView[];

function renderCards(props: Partial<Parameters<typeof SetupCards>[0]> = {}) {
  const onOpenSetup = vi.fn();
  render(
    <SetupCards
      trades={TRADES}
      setups={SETUPS}
      showArchived={false}
      onOpenSetup={onOpenSetup}
      today="2026-09-30"
      {...props}
    />,
  );
  return onOpenSetup;
}

const card = (name: string) => within(screen.getByRole("article", { name }));
const titles = (name: string) =>
  [...(screen.getByRole("article", { name }).querySelectorAll("circle title") ?? [])].map(
    (title) => title.textContent,
  );

describe("SetupCards", () => {
  it("makes a card per setup with closed trades, most trades first, leaving excluded trades out", () => {
    renderCards();
    expect(screen.getAllByRole("article").map((each) => each.getAttribute("aria-label"))).toEqual([
      "ORB breakout",
      "Earnings IV crush",
      "VWAP reclaim",
    ]);
  });

  it("leads a scalp setup's card with Avg R and its cumulative R, and opens its Scalps tab", () => {
    const onOpenSetup = renderCards();
    const orb = card("ORB breakout");
    expect(orb.getByTestId("card-hero").textContent).toBe("+0.17R");
    expect(orb.getByText("over 3 of 3")).toBeTruthy();
    expect(orb.getByText("Win %").nextSibling?.textContent).toBe("33.3%");
    expect(orb.getByText("Net").nextSibling?.textContent).toBe("+$50");
    expect(orb.getByText("Avg return").nextSibling?.textContent).toBe("+8.3%");
    expect(orb.getByText("last Sep 29")).toBeTruthy();
    expect(titles("ORB breakout")).toEqual([
      "Sep 28 · NVDA · +1.00R · total +1.00R",
      "Sep 28 · NVDA · −0.50R · total +0.50R",
      "Sep 29 · SPY · 0.00R · total +0.50R",
    ]);
    expect(orb.getByTestId("sparkline").getAttribute("class")).toBe("stroke-up");
    fireEvent.click(orb.getByRole("button", { name: "3 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("orb", "scalps");
  });

  it("leaves the sparkline out with fewer than 2 points", () => {
    renderCards();
    const vwap = card("VWAP reclaim");
    expect(vwap.getByTestId("card-hero").textContent).toBe("—");
    expect(vwap.getByText("over 0 of 1")).toBeTruthy();
    expect(vwap.queryByTestId("sparkline")).toBeNull();
    expect(vwap.getByRole("button", { name: "1 trade →" })).toBeTruthy();
  });

  it("leads a fly setup's card with % kept and its cumulative net, and opens its Iron flies tab", () => {
    const onOpenSetup = renderCards();
    const crush = card("Earnings IV crush");
    expect(crush.getByTestId("card-hero").textContent).toBe("13%");
    expect(crush.getByText("of max profit")).toBeTruthy();
    expect(crush.getByText("PF").nextSibling?.textContent).toBe("2.00");
    expect(crush.getByText("last Sep 17, 2025")).toBeTruthy();
    expect(titles("Earnings IV crush")).toEqual([
      "Sep 10 · BB · +$100 · total +$100",
      "Sep 17 · CC · −$50 · total +$50",
    ]);
    fireEvent.click(crush.getByRole("button", { name: "2 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("crush", "flies");
  });

  it("shows archived setups' cards only on request", () => {
    renderCards({ showArchived: true });
    expect(card("Old setup").getByText("Both")).toBeTruthy();
  });

  it("says what to do without cards, and waits for the trades", () => {
    const open = tradeRow({
      id: "open",
      strategy: "scalp",
      underlying: "NVDA",
      opened: "2026-09-29 09:40",
      closed: null,
      netPnl: null,
      setupId: "orb",
    });
    // A setup whose only trade is still open gets no card.
    const { rerender } = render(
      <SetupCards trades={[open] as unknown as TradeView[]} setups={SETUPS} showArchived={false} />,
    );
    expect(screen.getByText("Tag trades with a setup to see its stats here.")).toBeTruthy();
    rerender(<SetupCards trades={undefined} setups={SETUPS} showArchived={false} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});
```

In `apps/web/src/routes/Playbook.test.tsx`: Replace:

```tsx
import { Playbook } from "./Playbook.js";
```

with:

```tsx
import { SCALP_ROWS } from "../analytics/scalps.fixture.js";
import { tradeRow } from "../analytics/testing.js";
import { Playbook, type PlaybookProps } from "./Playbook.js";
```

The page now loads every trade, so the stub answers `/api/trades` and the filler (before this, `/api/trades` got the setups list, whose scalp-strategy row looked like a scalp missing prices): Replace:

```tsx
/** Answers the lists; creations and changes succeed, or are refused with `refusal` (409). */
function stubApi(refusal?: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
```

with:

```tsx
/** Answers the lists and `trades`; creations and changes succeed, or are refused with `refusal` (409). */
function stubApi(refusal?: string, trades: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/trades")) return json(trades);
    if (url.includes("/api/risk/fill")) return json({ filled: 0, missing: [], unavailable: null });
    if (method !== "GET") {
```

Replace:

```tsx
function renderPlaybook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Playbook />
    </QueryClientProvider>,
  );
}
```

with:

```tsx
function renderPlaybook(onOpenSetup?: PlaybookProps["onOpenSetup"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Playbook onOpenSetup={onOpenSetup} />
    </QueryClientProvider>,
  );
}
```

Then add two tests at the end of `describe("Playbook", …)`, before its closing `});`:

```tsx
  it("shows a card per setup with trades above the table, archived ones on request", async () => {
    const old = tradeRow({
      id: "o1",
      strategy: "scalp",
      underlying: "AMD",
      opened: "2026-09-21 09:40",
      closed: "2026-09-21 09:45",
      netPnl: 20,
      setupId: "old",
    });
    stubApi(undefined, [...SCALP_ROWS, old]);
    const onOpenSetup = vi.fn();
    renderPlaybook(onOpenSetup);
    const cards = await screen.findByRole("region", { name: "Setup stats · all time" });
    await waitFor(() => expect(within(cards).getByRole("article", { name: "ORB breakout" })).toBeTruthy());
    // VWAP reclaim isn't one of this page's setups, and Old setup is archived.
    expect(within(cards).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(within(cards).getByRole("button", { name: "3 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("orb", "scalps");
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    expect(within(cards).getByRole("article", { name: "Old setup" })).toBeTruthy();
  });

  it("fetches the stock prices the scalps lack, once", async () => {
    const missing = tradeRow({
      id: "m1",
      strategy: "scalp",
      underlying: "NVDA",
      opened: "2026-09-21 09:40",
      closed: "2026-09-21 09:45",
      netPnl: 20,
      scalpPrices: null,
    });
    const fetchMock = stubApi(undefined, [missing]);
    renderPlaybook();
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/risk/fill"), { tradeIds: ["m1"] }],
      ]),
    );
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/SetupCards.test.tsx apps/web/src/routes/Playbook.test.tsx`
Expected: FAIL: `./SetupCards.js` doesn't exist, and the Playbook has no card region and no `onOpenSetup`.

- [ ] **Step 3: The sparkline**

Create `apps/web/src/analytics/Sparkline.tsx`. It's plain SVG; each point's `<title>` is its tooltip:

```tsx
import type { CumulativePoint } from "@tj/core";

const WIDTH = 130;
const HEIGHT = 40;
const PAD = 4;
const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

/**
 * A running total, trade by trade, on a zero line (scalp-analytics spec §7.2): green when it ends at or above 0, red
 * below. Hovering a point names the trade. Nothing with fewer than 2 points.
 */
export function Sparkline({
  points,
  format,
  label,
}: {
  points: readonly CumulativePoint[];
  format: (value: number) => string;
  label: string;
}) {
  if (points.length < 2) return null;
  const values = [0, ...points.map((point) => point.total)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const x = (index: number) => PAD + (index * (WIDTH - 2 * PAD)) / (points.length - 1);
  const y = (value: number) => PAD + ((high - value) * (HEIGHT - 2 * PAD)) / span;
  const up = (points.at(-1)?.total ?? 0) >= 0;
  return (
    <svg
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="shrink-0"
    >
      <line x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} stroke="#2a2e39" />
      <polyline
        data-testid="sparkline"
        points={points.map((point, index) => `${x(index)},${y(point.total)}`).join(" ")}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        className={up ? "stroke-up" : "stroke-down"}
      />
      {points.map((point, index) => (
        <circle key={point.id} cx={x(index)} cy={y(point.total)} r={6} fill="transparent">
          <title>
            {`${ET_DAY.format(new Date(point.closedAt))} · ${point.underlying} · ${format(point.value)} · total ${format(point.total)}`}
          </title>
        </circle>
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: The strategy's words, shared**

Append to `apps/web/src/review/text.ts`:

```ts
const STRATEGY_LABELS: Record<string, string> = { scalp: "Scalps", iron_fly: "Iron flies" };

/** A setup's strategy in words: "Scalps", "Iron flies", or "Both" for a setup that takes either. */
export const strategyLabel = (strategy: string | null) =>
  (strategy == null ? undefined : STRATEGY_LABELS[strategy]) ?? "Both";
```

- [ ] **Step 5: The cards**

Create `apps/web/src/analytics/SetupCards.tsx`:

```tsx
import { closedTrades, nyDate, type SetupCard, setupCards } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Chip } from "../components/ui.js";
import { todayNy } from "../market.js";
import type { Setup } from "../review/data.js";
import { strategyLabel } from "../review/text.js";
import { dollars, profitFactorText, rText, shareText, winRateText } from "./format.js";
import { Section } from "./Section.js";
import { Sparkline } from "./Sparkline.js";
import { returnText } from "./scalpText.js";

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});
const ET_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const tone = (value: number | null) => {
  if (value == null || value === 0) return "";
  return value > 0 ? "text-up" : "text-down";
};

/** "Sep 28", with the year when it isn't this one: "Sep 17, 2025". */
function lastText(closedAt: number, today: string): string {
  const format = nyDate(closedAt).slice(0, 4) === today.slice(0, 4) ? ET_DAY : ET_DAY_YEAR;
  return format.format(new Date(closedAt));
}

function Stat({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[9px] text-muted uppercase tracking-wider">{label}</div>
      <div className={`num text-[12px] ${className}`}>{children}</div>
    </div>
  );
}

function Card({
  card,
  setup,
  today,
  onOpen,
}: {
  card: SetupCard;
  setup: Setup;
  today: string;
  onOpen?: (setupId: string, tab: "scalps" | "flies") => void;
}) {
  const fly = card.kind === "fly";
  const hero = fly ? card.kept : card.avgR;
  return (
    <article aria-label={setup.name} className="flex flex-col rounded-sm border border-line bg-panel p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] text-fg">{setup.name}</span>
        <Chip tone={setup.strategy ?? "default"}>{strategyLabel(setup.strategy)}</Chip>
      </div>
      <p className="mt-0.5 h-4 truncate text-[10px] text-muted">{setup.description ?? ""}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <div className="text-[9px] text-muted uppercase tracking-wider">{fly ? "Kept" : "Avg R"}</div>
          <div data-testid="card-hero" className={`num text-[20px] ${tone(hero)}`}>
            {fly ? shareText(card.kept) : card.avgR == null ? "—" : rText(card.avgR)}
          </div>
          <div className="text-[9px] text-muted">
            {fly ? "of max profit" : `over ${card.rCount} of ${card.trades}`}
          </div>
        </div>
        <Sparkline
          points={card.points}
          format={fly ? dollars : rText}
          label={fly ? "Cumulative net P&L" : "Cumulative R"}
        />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Stat label="Trades">{card.trades}</Stat>
        <Stat label="Win %">{winRateText(card.winRate)}</Stat>
        <Stat label="Net" className={tone(card.net)}>
          {dollars(card.net)}
        </Stat>
        {fly ? (
          <Stat label="PF">{profitFactorText(card.profitFactor)}</Stat>
        ) : (
          <Stat label="Avg return" className={tone(card.avgReturn)}>
            {returnText(card.avgReturn)}
          </Stat>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between border-line border-t pt-1.5 text-[10px] text-muted">
        <span>last {lastText(card.lastClosedAt, today)}</span>
        <button
          type="button"
          onClick={() => onOpen?.(card.setupId, fly ? "flies" : "scalps")}
          className="text-accent hover:underline"
        >
          {card.trades} {card.trades === 1 ? "trade" : "trades"} →
        </button>
      </div>
    </article>
  );
}

/** A card per setup with closed trades, all time, both books, excluded trades left out (scalp-analytics spec §7). */
export function SetupCards({
  trades,
  setups,
  showArchived,
  onOpenSetup,
  today = todayNy(),
}: {
  /** Every trade; undefined while they load. */
  trades: readonly TradeView[] | undefined;
  setups: readonly Setup[];
  showArchived: boolean;
  onOpenSetup?: (setupId: string, tab: "scalps" | "flies") => void;
  /** New York's date, YYYY-MM-DD; the year decides whether a date shows its own. */
  today?: string;
}) {
  const shown = new Map(
    setups.filter((setup) => showArchived || !setup.archived).map((setup) => [setup.id, setup]),
  );
  const names = new Map(setups.map((setup) => [setup.id, setup.name]));
  const cards = trades
    ? setupCards(closedTrades(trades.filter((trade) => !trade.excluded)), names).filter((card) =>
        shown.has(card.setupId),
      )
    : [];
  let body: ReactNode;
  if (!trades) body = <p className="text-muted">Loading…</p>;
  else if (cards.length === 0)
    body = <p className="text-muted">Tag trades with a setup to see its stats here.</p>;
  else {
    body = (
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const setup = shown.get(card.setupId);
          return (
            setup && <Card key={card.setupId} card={card} setup={setup} today={today} onOpen={onOpenSetup} />
          );
        })}
      </div>
    );
  }
  return <Section title="Setup stats · all time">{body}</Section>;
}
```

- [ ] **Step 6: Put them on the Playbook**

In `apps/web/src/routes/Playbook.tsx`: Replace:

```tsx
import { Fragment, type KeyboardEvent, useState } from "react";
import { Section } from "../analytics/Section.js";
```

with:

```tsx
import { Fragment, type KeyboardEvent, useState } from "react";
import { useAllTrades } from "../analytics/data.js";
import { Section } from "../analytics/Section.js";
import { SetupCards } from "../analytics/SetupCards.js";
```

Replace:

```tsx
import { INPUT, NameField } from "../review/Pickers.js";
```

with:

```tsx
import { INPUT, NameField } from "../review/Pickers.js";
import { useBackfillPrices } from "../review/prices.js";
import { strategyLabel } from "../review/text.js";
```

Remove the local `strategyLabel`, since `review/text.ts` has it now: Replace:

```tsx
];
const strategyLabel = (value: string | null) =>
  STRATEGIES.find((each) => each.value === value)?.label ?? "Both";
const BUTTON
```

with:

```tsx
];
const BUTTON
```

The page owns Show archived now, so the cards and the table agree: Replace:

```tsx
/** Setups and tags (scalp-review spec §10). The per-setup stat cards come with R. */
export function Playbook() {
  return (
    <div className="flex flex-col gap-3">
      <SetupsPanel />
      <TagsPanel />
    </div>
  );
}
```

with:

```tsx
export interface PlaybookProps {
  /** Opens Analytics filtered to a setup, on its tab. */
  onOpenSetup?: (setupId: string, tab: "scalps" | "flies") => void;
}

/** Each setup's stats (scalp-analytics spec §7), then setups and tags to manage (scalp-review spec §10). */
export function Playbook({ onOpenSetup }: PlaybookProps) {
  // Shared by the cards and the Setups table.
  const [showArchived, setShowArchived] = useState(false);
  const { data: trades } = useAllTrades();
  const { data: setups = [] } = useSetups();
  useBackfillPrices(trades);
  return (
    <div className="flex flex-col gap-3">
      <SetupCards trades={trades} setups={setups} showArchived={showArchived} onOpenSetup={onOpenSetup} />
      <SetupsPanel showArchived={showArchived} onShowArchived={setShowArchived} />
      <TagsPanel />
    </div>
  );
}
```

Replace:

```tsx
function SetupsPanel() {
  const { data: setups = [], isLoading } = useSetups();
  const create = useCreateSetup();
  const update = useUpdateSetup();
  const [showArchived, setShowArchived] = useState(false);
```

with:

```tsx
function SetupsPanel({
  showArchived,
  onShowArchived,
}: {
  showArchived: boolean;
  onShowArchived: (checked: boolean) => void;
}) {
  const { data: setups = [], isLoading } = useSetups();
  const create = useCreateSetup();
  const update = useUpdateSetup();
```

Replace:

```tsx
          <ShowArchived checked={showArchived} onChange={setShowArchived} />
          <button
```

with:

```tsx
          <ShowArchived checked={showArchived} onChange={onShowArchived} />
          <button
```

In `apps/web/src/router.tsx`, a card opens Analytics filtered to its setup: Replace:

```tsx
  component: () => <Playbook />,
```

with:

```tsx
  component: () => (
    <Playbook onOpenSetup={(setup, tab) => router.navigate({ to: "/analytics", search: { tab, setup } })} />
  ),
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/SetupCards.test.tsx apps/web/src/routes/Playbook.test.tsx`
Expected: PASS: 6 and 8 tests.

- [ ] **Step 8: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/Sparkline.tsx apps/web/src/analytics/SetupCards.tsx apps/web/src/analytics/SetupCards.test.tsx apps/web/src/review/text.ts apps/web/src/routes/Playbook.tsx apps/web/src/routes/Playbook.test.tsx apps/web/src/router.tsx
git commit -m "feat: a stat card per setup on the Playbook, linking to its analytics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the full suite has 1,039 tests.

---

### Task 8: Docs, and a live and visual check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-scalp-analytics-design.md` (status, deviations, live check)
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§8.3, §9)
- Modify: `docs/superpowers/specs/2026-09-29-scalp-r-design.md` (§14)
- Modify: `docs/superpowers/specs/2026-09-29-scalp-review-design.md` (§10)
- Modify: `docs/superpowers/plans/2026-09-30-scalp-r.md` (deferred minor #9)
- Modify: `README.md`

- [ ] **Step 1: The live check over a scratch journal**

Follow the visual-check recipe. Work in the session's scratchpad, never the repo or the real data directory.

1. **Build the web app:** `pnpm build`.
2. **Copy the real journal read-only** with better-sqlite3's `.backup()` into the scratchpad. The stand-in server migrates the copy to 0006 when it opens it.
3. **Start a stand-in server** (`serve.mts`, run with `apps/server/node_modules/.bin/tsx`) on port 4199:
   - `createApp` over the copy, with `webDir: apps/web/dist`;
   - the real Alpaca key through `createMarketData`, reading `secrets.json` without writing it.
4. **Seed about 30 closed scalps** on 2026-09-21 through 2026-09-29 with `POST /api/trades` (header `host: localhost`). Mix NVDA, SPY, QQQ and AMD, calls and puts, 0 and 1 DTE, 1–3 contracts, and entries from 09:31 to 11:00. Then give them their review with `PATCH /api/trades/:id`:
   - setups ORB breakout and VWAP reclaim, and a few with none;
   - grades A–F, and a few ungraded;
   - the emotion tag Calm on some;
   - the mistake tags on about a third;
   - stops on about 25, leaving 5 without.

   The seeded scalps have no stock prices, so **opening Analytics → Scalps backfills them.**
5. **Check the coverage line:** it first reads "Fetching stock prices for N scalps…", then "R covers … · 5 have no stop".
6. **Time the backfill:** it should take a few seconds for about 30 scalps over 7 days. Note how long.
7. **Screenshot with headless Firefox** at 1280 px and at 1024 px, waiting for `document.fonts.ready`:
   - the Scalps tab for each metric (Net, Avg R, Win %);
   - the breakdown by Setup, Emotion and Option cost;
   - Mistake cost;
   - the Playbook's cards.

   Stack them with ImageMagick and look for overlap, cut-off labels, and the dumbbell's dots against its axis.
8. **Click through:** a card's "N trades →" opens `/analytics?tab=scalps&setup=<id>` with the Setup dropdown set.
9. **Stop the stand-in** with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`.

Fix what the check finds, with a test, in its own `fix:` commit, before the docs.

- [ ] **Step 2: Update the scalp-analytics spec**

- **Status:** "Approved; implemented on feat/scalp-analytics. Plan: [2026-09-30-scalp-analytics.md](../plans/2026-09-30-scalp-analytics.md), whose deviations are folded in."
- **Fold in the plan's nine deviations:**
  - §9 names and shared helpers (1, 2);
  - §6.2 "R covers the scalp" and the line left out without scalps (3);
  - §6.3 labels cut to 12 characters (4);
  - §6.4 Contracts' edit link (5);
  - §6.5 and §10, Loading and Couldn't load the tags (6);
  - §7 `strategyLabel` and `today` (7);
  - §8, every trade and each mount (8);
  - §5.2, sorted by name (9).
- **Add a `### Live check` heading, with the day's date,** under §12 with what Step 1 found: the counts, the coverage line, the backfill's time, and the screenshots' findings.

- [ ] **Step 3: Point the other docs here**

**Parent spec** (`docs/superpowers/specs/2026-09-22-trading-journal-design.md`):
- **§8.3:** the line "With the scalp analytics: **minutes after open** …" becomes "Built in the scalp analytics ([2026-09-30-scalp-analytics-design.md](2026-09-30-scalp-analytics-design.md)): **minutes after open** (first entry − 09:30 ET), **hold time**, and **option cost** (entry premium × contracts × multiplier)."
- **§9:**
  - Add a line under the refinements list: "Scalps are detailed in [2026-09-30-scalp-analytics-design.md](2026-09-30-scalp-analytics-design.md): the Scalps tab shows one breakdown at a time, mistake cost adds an avg-R dumbbell, and the Setups tab is dropped in favour of the Playbook's stat cards."
  - In **Tagging**, "its stat cards come with R" becomes "its stat cards are built in the scalp-analytics spec".
  - In **Two separate surfaces**, the tabs become "**Overview, Scalps and Iron flies** (Missed to come)".

**Scalp-R spec** (`docs/superpowers/specs/2026-09-29-scalp-r-design.md`):
- **§14:** item 1 becomes "**The second part:** built in [2026-09-30-scalp-analytics-design.md](2026-09-30-scalp-analytics-design.md), with the backfill (the plan's deferred minor #9)."

**Scalp-review spec** (`docs/superpowers/specs/2026-09-29-scalp-review-design.md`):
- **§10:** "Per-setup stat cards come with R." becomes "Per-setup stat cards sit above the Setups table, built in [2026-09-30-scalp-analytics-design.md](2026-09-30-scalp-analytics-design.md)."

**Scalp-R plan** (`docs/superpowers/plans/2026-09-30-scalp-r.md`):
- Deferred minor 9 gains "**Done** in the scalp-analytics plan: the Scalps tab and the Playbook backfill once a visit."

**README.md:**
- In **Review**, "and an Iron flies tab measured against max profit." becomes "a Scalps tab (time of day, hold time, breakdowns in R and return on cost, and what each mistake costs), and an Iron flies tab measured against max profit."
- In **Scalps**, after "setups and tags live on the Playbook page", add ", with a stat card per setup".
- The closing line "Scalp analytics, missed trades and an option-premium chart arrive in later steps" becomes "Missed trades and an option-premium chart arrive in later steps".

- [ ] **Step 4: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/superpowers/specs/2026-09-30-scalp-analytics-design.md docs/superpowers/specs/2026-09-22-trading-journal-design.md docs/superpowers/specs/2026-09-29-scalp-r-design.md docs/superpowers/specs/2026-09-29-scalp-review-design.md docs/superpowers/plans/2026-09-30-scalp-r.md README.md
git commit -m "docs: point the specs and README at the scalp analytics, with its live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
