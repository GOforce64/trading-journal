# Analytics and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Dashboard that shows the current period and an Analytics page with Overview and Iron flies tabs, both computed in the browser by pure, tested statistics in `@tj/core`, with iron flies measured against max profit.

**Architecture:**
- `@tj/core` gains:
  - `flyMaxProfit` and `pctKept`;
  - a rule-based NYSE calendar (`calendar.ts`);
  - headline statistics and series (`stats.ts`);
  - splits with user-set edges (`splits.ts`);
  - credit-kept statistics (`kept.ts`).
- The web app fetches every trade once (`GET /api/trades?all=true&includeExcluded=true`) and filters in the browser. It hands closed trades to those functions and renders:
  - the equity curve with Lightweight Charts;
  - the month bars, rolling line and kept histogram with Recharts;
  - the KPI strip, P&L calendar and split tables with plain CSS.
- Page state lives in the URL through TanStack Router search params. Split edges are also remembered in `localStorage`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), zod 4, Hono, React 19, TanStack Query 5 and Router 1, Tailwind 4, Vitest 5 (jsdom for web), fast-check 4 (new), lightweight-charts 5.2 (new), recharts 3.10 with react-is 19 (new), Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-27-analytics-and-dashboard-design.md`

**Branch:** `feat/analytics`, stacked on `feat/option-chains` (PR #4). Work in place on the branch; no worktree.

**Deviations from the spec, agreed while planning.** The spec is updated in the same commit as this plan.

- §4: the list route gains `all=true`. The repository caps lists at 500 rows by default, which would silently drop trades from Analytics once the journal grows.
- §4: queries are fresh for 10 s app-wide (`staleTime: 10_000` in `main.tsx`), not 0. The trade page's grade and exclude changes now also invalidate `["trades"]`, so Analytics and the lists pick them up.
- §5.2 Ticker: past 10 tickers, the top 5 and bottom 5 are joined by one middle row, "N others". That keeps the rule that a split's rows add up to the total net.
- §5.2: a split leaves out buckets that have no trades.
- §9: the drawdown pane is a baseline series at $0, which fills between $0 and the line. An area series would fill to the bottom of the pane instead.
- §13, item 2 is resolved. Lightweight Charts has no timezone option. The documented way is `timeScale.tickMarkFormatter` plus `localization.timeFormatter`, formatting with `Intl` in `America/New_York`.

## Global Constraints

**Statistics**
- Every statistic comes from `@tj/core` and is computed on read, in the browser. Nothing computed is stored or sent to the server.
- Only closed trades count. A trade belongs to its New York close date and month. "Today" is `todayNy()` in the web app, or `nyDate(Date.now())`.

**Iron flies**
- Measure iron flies against **max profit**. Max profit = credit per share × contracts × 100 − fees (`flyMaxProfit`), and **% kept** = net P&L ÷ max profit. Never build a KPI on max loss. The trade page keeps max loss as reference only.

**Split edges**
- Each edge starts a bucket.
- Defaults: credit `250, 500, 1000`; contracts `2, 4, 6`.
- URL keys `creditEdges` and `contractEdges`. `localStorage` keys `tj.edges.credit` and `tj.edges.contracts`.
- The URL wins over `localStorage`.

**URL parameters (exact)**

| Page | Parameters |
|---|---|
| Analytics | `tab=flies` (absent = Overview); `from`, `to` (`YYYY-MM-DD`, New York close date, inclusive); `books=live` or `books=paper` (absent = both); `ticker`; `excluded=true`; `creditEdges`; `contractEdges` |
| Dashboard | `period=week`, `year` or `all` (absent = month); `at=YYYY-MM-DD` (absent = today) |

**UI copy (exact)**
- KPI labels: `Net P&L`, `Win rate`, `Profit factor`, `Expectancy`, `Avg win / loss`, `Trades`, `Max drawdown`, `Avg credit`, `Avg max profit`, `Winners keep`, `Losers lose`, `Kept overall`.
- List column and trade-page tile: `% kept`.
- Split titles: `Weekday opened`, `Days to expiry`, `Contracts`, `Hold time`, `Month`, `Ticker`, `Credit`, `Wings`, `Wider wing width`.
- Hold buckets: `same day`, `overnight`, `1 full day`, `weekend`, `longer`, `unknown`.
- Messages: `No closed trades in this range.` and `Needs 10 trades.`
- Existing, reused: `EXPIRED · add exits`.

**Palette:** up `#26a69a`, down `#ef5350`, accent `#2962ff`, panel `#131722`, line `#1f2430`, muted `#6b7385`.

**New dependencies (exact ranges)**
- `lightweight-charts@^5.2.1`: web, used on the Dashboard and Analytics.
- `recharts@^3.10.1` and `react-is@^19.3.0`: web, Analytics only, in its own lazy chunk.
- `fast-check@^4.10.2`: core, dev only.

**CI and commits**
- CI runs on Ubuntu and Windows.
- Before every commit, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and check each exit code. Never pipe them through `tail`, which hides a failure.
- When `pnpm lint` reports only formatting or import order, run `pnpm format`, then check again. The code blocks here are not guaranteed to be in Biome's layout.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these is a condition the spec implies but no obvious test covers. The owning task carries a test for each:

1. **More than 500 trades.** Analytics must count every one, despite the list route's default cap of 500. Test: Task 7 (501 trades at the repository).
2. **A close late in the New York evening.** At 23:30 ET it is already the next day in UTC. The trade still belongs to New York's date in the filter, the calendar and the month split. Tests: Tasks 3 and 7.
3. **A close dated on a weekend or holiday** (odd data). It still counts in the calendar's week total, so the weeks add up to the month. Test: Task 10.
4. **Bad edges** such as `1,000`, `250, 250` or `500, 250`. They are refused with the rule shown, and nothing is saved. Tests: Task 4 (`parseEdges`) and Task 10 (the editor).
5. **A hand-edited or stale URL** such as `books=missed`, `tab=scalps`, `from=2026-02-30` or `creditEdges=abc`. It falls back to defaults and nothing crashes. Test: Task 8.

---

### Task 1: Max profit for every fly, and the share of it kept

**Files:**
- Modify: `packages/core/src/ironFly.ts`
- Test: `packages/core/src/ironFly.test.ts`

**Interfaces:**
- Consumes: `round2` from `packages/core/src/money.ts`.
- Produces (exported from `@tj/core`):
  - `flyMaxProfit(creditPerShare: number, contracts: number, fees: number, multiplier?: number): number`
  - `interface KeptInput { netPnl: number | null; fees: number; ironFly: { creditPerShare: number | null; contracts: number | null } | null }`
  - `pctKept(trade: KeptInput): number | null`. It's a fraction: 0.5 means half the credit was kept.
  - `ironFlyMetrics` now takes its `maxProfit` from `flyMaxProfit`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/ironFly.test.ts`, change the import to:

```ts
import { derivedFees, flyMaxProfit, ironFlyMetrics, ironFlyOutcome, pctKept } from "./ironFly.js";
```

and append:

```ts
describe("flyMaxProfit", () => {
  it("is the credit on every contract, less all the fees", () => {
    expect(flyMaxProfit(3, 4, 8)).toBe(1192);
  });

  it("needs no wings, so a 1-wing fly has one too", () => {
    expect(flyMaxProfit(2.04, 1, 4)).toBe(200);
  });

  it("uses the multiplier it is given", () => {
    expect(flyMaxProfit(1, 2, 0, 10)).toBe(20);
  });
});

describe("pctKept", () => {
  const fly = { creditPerShare: 2.04, contracts: 1 };

  it("is net P&L over max profit", () => {
    expect(pctKept({ netPnl: 100, fees: 4, ironFly: fly })).toBe(0.5);
    expect(pctKept({ netPnl: -300, fees: 4, ironFly: fly })).toBe(-1.5);
  });

  it("is null for an open trade, a trade that isn't a fly, and a fly without its credit", () => {
    expect(pctKept({ netPnl: null, fees: 4, ironFly: fly })).toBeNull();
    expect(pctKept({ netPnl: 100, fees: 4, ironFly: null })).toBeNull();
    expect(pctKept({ netPnl: 100, fees: 4, ironFly: { creditPerShare: null, contracts: 1 } })).toBeNull();
  });

  it("is null when fees eat the whole credit", () => {
    expect(pctKept({ netPnl: -10, fees: 204, ironFly: fly })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/ironFly.test.ts`
Expected: FAIL, because `flyMaxProfit` and `pctKept` are not exported.

- [ ] **Step 3: Implement**

In `packages/core/src/ironFly.ts`, add below the `IronFlyMetrics` interface:

```ts
/**
 * What a fly keeps if every leg expires worthless: the credit on every contract, less all fees.
 * It needs no wings, so a 1-wing fly has one too.
 */
export function flyMaxProfit(creditPerShare: number, contracts: number, fees: number, multiplier = 100): number {
  return round2(creditPerShare * contracts * multiplier - fees);
}

export interface KeptInput {
  netPnl: number | null;
  fees: number;
  ironFly: { creditPerShare: number | null; contracts: number | null } | null;
}

/**
 * Net P&L as a share of max profit: 0.5 means half the credit was kept, -1 a loss equal to it.
 * Null with nothing to measure against: an open trade, a trade that isn't a fly, or fees at or above the credit.
 */
export function pctKept(trade: KeptInput): number | null {
  const credit = trade.ironFly?.creditPerShare;
  const contracts = trade.ironFly?.contracts;
  if (trade.netPnl == null || credit == null || contracts == null) return null;
  const maxProfit = flyMaxProfit(credit, contracts, trade.fees);
  return maxProfit > 0 ? trade.netPnl / maxProfit : null;
}
```

In `ironFlyMetrics`'s returned object, replace

```ts
    maxProfit: round2(netCreditPerShare * shares),
```

with

```ts
    maxProfit: flyMaxProfit(input.creditPerShare, input.contracts, fees, multiplier),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/ironFly.test.ts`
Expected: PASS, including the existing `nets fees out of the credit` test (1192).

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/ironFly.ts packages/core/src/ironFly.test.ts
git commit -m "feat(core): max profit for every fly, and the share of it kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: NYSE trading days and hold time

**Files:**
- Create: `packages/core/src/calendar.ts`
- Create: `packages/core/src/calendar.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `nyDate(epochMs): string` from `packages/core/src/marks.ts`.
- Produces (exported from `@tj/core`):
  - `WEEKDAYS` (`["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]`) and `type Weekday`
  - `nyWeekday(epochMs: number): Weekday`
  - `nyMinuteOfDay(epochMs: number): number`
  - `weekdayOfDate(date: string): Weekday`
  - `addDays(date: string, days: number): string`
  - `easterSunday(year: number): string`
  - `nyseHolidays(year: number): Map<string, string>`, mapping date to name
  - `holidayName(date: string): string | null`
  - `isTradingDay(date: string): boolean`
  - `sessionsBetween(openDate: string, closeDate: string): number`
  - `HOLD_BUCKETS` (`["same day", "overnight", "1 full day", "weekend", "longer", "unknown"]`) and `type HoldBucket`
  - `holdBucket(openedAt: number, closedAt: number): HoldBucket`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/calendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  easterSunday,
  holdBucket,
  holidayName,
  isTradingDay,
  nyMinuteOfDay,
  nyseHolidays,
  nyWeekday,
  sessionsBetween,
  weekdayOfDate,
} from "./calendar.js";

/** Epoch ms for a New York wall-clock time; daylight time (UTC−4) unless another offset is given. */
const ny = (stamp: string, offset = "-04:00") => Date.parse(`${stamp.replace(" ", "T")}:00${offset}`);

describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
  ])("puts Easter %i on %s", (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe("nyseHolidays", () => {
  it.each([
    [
      2024,
      [
        "2024-01-01",
        "2024-01-15",
        "2024-02-19",
        "2024-03-29",
        "2024-05-27",
        "2024-06-19",
        "2024-07-04",
        "2024-09-02",
        "2024-11-28",
        "2024-12-25",
      ],
    ],
    [
      2025,
      [
        "2025-01-01",
        "2025-01-09",
        "2025-01-20",
        "2025-02-17",
        "2025-04-18",
        "2025-05-26",
        "2025-06-19",
        "2025-07-04",
        "2025-09-01",
        "2025-11-27",
        "2025-12-25",
      ],
    ],
    [
      2026,
      [
        "2026-01-01",
        "2026-01-19",
        "2026-02-16",
        "2026-04-03",
        "2026-05-25",
        "2026-06-19",
        "2026-07-03",
        "2026-09-07",
        "2026-11-26",
        "2026-12-25",
      ],
    ],
  ])("matches the NYSE's published %i dates", (year, dates) => {
    expect([...nyseHolidays(year).keys()].sort()).toEqual(dates);
  });

  it("names Good Friday and the 2025 day of mourning", () => {
    expect(holidayName("2026-04-03")).toBe("Good Friday");
    expect(holidayName("2025-01-09")).toBe("National Day of Mourning");
  });

  it("moves a Saturday holiday to Friday and a Sunday one to Monday", () => {
    expect(holidayName("2027-12-24")).toBe("Christmas Day");
    expect(holidayName("2027-07-05")).toBe("Independence Day");
    expect(holidayName("2027-06-18")).toBe("Juneteenth");
  });

  it("does not move a Saturday New Year's Day back into December", () => {
    expect(isTradingDay("2027-12-31")).toBe(true);
  });
});

describe("isTradingDay", () => {
  it("is false on weekends and holidays, true on other weekdays", () => {
    expect(isTradingDay("2026-09-05")).toBe(false);
    expect(isTradingDay("2026-09-07")).toBe(false);
    expect(isTradingDay("2025-01-09")).toBe(false);
    expect(isTradingDay("2026-09-08")).toBe(true);
  });
});

describe("dates and the New York clock", () => {
  it("reads the weekday and minute in New York, not UTC", () => {
    const lateFriday = ny("2026-09-04 23:30");
    expect(nyWeekday(lateFriday)).toBe("Fri");
    expect(nyMinuteOfDay(lateFriday)).toBe(23 * 60 + 30);
  });

  it("moves dates by days across months, and names their weekday", () => {
    expect(addDays("2026-09-27", -89)).toBe("2026-06-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOfDate("2026-09-21")).toBe("Mon");
    expect(weekdayOfDate("2026-09-27")).toBe("Sun");
  });
});

describe("sessionsBetween", () => {
  it("counts trading days after the open date, up to and including the close date", () => {
    expect(sessionsBetween("2026-09-02", "2026-09-02")).toBe(0);
    expect(sessionsBetween("2026-09-02", "2026-09-03")).toBe(1);
    expect(sessionsBetween("2026-09-04", "2026-09-08")).toBe(1);
    expect(sessionsBetween("2026-09-14", "2026-09-16")).toBe(2);
  });
});

describe("holdBucket", () => {
  it.each([
    ["same day", ny("2026-09-08 07:45"), ny("2026-09-08 09:45")],
    ["overnight", ny("2026-09-02 15:45"), ny("2026-09-03 09:50")],
    ["overnight", ny("2026-09-02 15:45"), ny("2026-09-03 11:59")],
    ["1 full day", ny("2026-09-09 15:50"), ny("2026-09-10 12:00")],
    ["1 full day", ny("2026-09-09 15:54"), ny("2026-09-10 15:44")],
    ["weekend", ny("2026-09-11 15:50"), ny("2026-09-14 09:45")],
    ["weekend", ny("2026-09-04 15:30"), ny("2026-09-08 09:45")],
    ["overnight", ny("2026-11-25 15:50", "-05:00"), ny("2026-11-27 09:45", "-05:00")],
    ["longer", ny("2026-09-14 15:40"), ny("2026-09-16 10:00")],
  ])("calls %s a hold from %i to %i", (bucket, openedAt, closedAt) => {
    expect(holdBucket(openedAt, closedAt)).toBe(bucket);
  });

  it("is unknown when the close is before the open", () => {
    expect(holdBucket(ny("2026-09-03 09:50"), ny("2026-09-02 15:45"))).toBe("unknown");
  });
});
```

The Friday → Tuesday case spans Labor Day, and the Wednesday → Friday case spans Thanksgiving. Each counts as one session.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/calendar.test.ts`
Expected: FAIL, because `./calendar.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/calendar.ts`:

```ts
import { nyDate } from "./marks.js";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const NY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function clock(epochMs: number) {
  const parts = NY_CLOCK.formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((found) => found.type === type)?.value ?? "";
  return { weekday: part("weekday") as Weekday, hour: Number(part("hour")), minute: Number(part("minute")) };
}

/** The weekday in New York at an instant. */
export const nyWeekday = (epochMs: number): Weekday => clock(epochMs).weekday;

/** Minutes since midnight in New York at an instant. */
export function nyMinuteOfDay(epochMs: number): number {
  const { hour, minute } = clock(epochMs);
  return hour * 60 + minute;
}

const DAY = 86_400_000;
const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** A YYYY-MM-DD date moved by whole days. */
export const addDays = (date: string, days: number): string =>
  new Date(utcMidnight(date) + days * DAY).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
const dayOfWeek = (date: string) => new Date(utcMidnight(date)).getUTCDay();

/** The weekday of a YYYY-MM-DD date. */
export const weekdayOfDate = (date: string): Weekday => WEEKDAYS[(dayOfWeek(date) + 6) % 7] ?? "Mon";

const pad = (value: number) => String(value).padStart(2, "0");
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Easter Sunday in the Gregorian calendar (the anonymous Meeus/Jones/Butcher algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** The nth given weekday (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = ymd(year, month, 1);
    return addDays(first, ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(ymd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

/** A fixed-date holiday on a weekend is observed on the Friday before or the Monday after. */
function observed(date: string): string {
  const weekday = dayOfWeek(date);
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, 1);
  return date;
}

/** One-off closures that no rule predicts. */
const CLOSURES: Record<string, string> = {
  "2025-01-09": "National Day of Mourning",
};

/** The NYSE's full-day holidays in a year, by date, with their names. */
export function nyseHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const newYear = ymd(year, 1, 1);
  // A Saturday New Year's Day is not observed on the last trading day of the year before.
  if (dayOfWeek(newYear) !== 6) holidays.set(observed(newYear), "New Year's Day");
  holidays.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  holidays.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  holidays.set(addDays(easterSunday(year), -2), "Good Friday");
  holidays.set(nthWeekday(year, 5, 1, -1), "Memorial Day");
  if (year >= 2022) holidays.set(observed(ymd(year, 6, 19)), "Juneteenth");
  holidays.set(observed(ymd(year, 7, 4)), "Independence Day");
  holidays.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  holidays.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  holidays.set(observed(ymd(year, 12, 25)), "Christmas Day");
  for (const [date, name] of Object.entries(CLOSURES)) {
    if (date.startsWith(`${year}-`)) holidays.set(date, name);
  }
  return holidays;
}

const byYear = new Map<number, Map<string, string>>();

/** The holiday's name when the NYSE is closed for one on this date, else null. */
export function holidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));
  let holidays = byYear.get(year);
  if (!holidays) {
    holidays = nyseHolidays(year);
    byYear.set(year, holidays);
  }
  return holidays.get(date) ?? null;
}

/** A weekday that is not an NYSE holiday. */
export function isTradingDay(date: string): boolean {
  const weekday = dayOfWeek(date);
  return weekday !== 0 && weekday !== 6 && holidayName(date) === null;
}

/** Trading days after the open date, up to and including the close date. */
export function sessionsBetween(openDate: string, closeDate: string): number {
  let sessions = 0;
  for (let date = addDays(openDate, 1); date <= closeDate; date = addDays(date, 1)) {
    if (isTradingDay(date)) sessions++;
  }
  return sessions;
}

export const HOLD_BUCKETS = ["same day", "overnight", "1 full day", "weekend", "longer", "unknown"] as const;
export type HoldBucket = (typeof HOLD_BUCKETS)[number];

const NOON = 12 * 60;

/** How long a trade was held, in the terms of the earnings-fly strategy (spec §5.4). */
export function holdBucket(openedAt: number, closedAt: number): HoldBucket {
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt) || closedAt < openedAt) return "unknown";
  const openDate = nyDate(openedAt);
  const closeDate = nyDate(closedAt);
  const sessions = sessionsBetween(openDate, closeDate);
  if (sessions === 0) return "same day";
  if (sessions > 1) return "longer";
  for (let date = addDays(openDate, 1); date < closeDate; date = addDays(date, 1)) {
    if (dayOfWeek(date) === 6) return "weekend";
  }
  return nyMinuteOfDay(closedAt) < NOON ? "overnight" : "1 full day";
}
```

Add to `packages/core/src/index.ts`, keeping the exports sorted:

```ts
export * from "./calendar.js";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/calendar.ts packages/core/src/calendar.test.ts packages/core/src/index.ts
git commit -m "feat(core): NYSE trading days by rule, and how long a trade was held

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Headline statistics and series

**Files:**
- Create: `packages/core/src/stats.ts`
- Create: `packages/core/src/stats.fixture.ts` (used by tests only)
- Create: `packages/core/src/stats.arbitrary.ts` (used by tests only)
- Create: `packages/core/src/stats.test.ts`
- Create: `packages/core/src/stats.property.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (fast-check)

**Interfaces:**
- Consumes: `nyDate` (marks), `round2` (money), `addDays` (calendar).
- Produces (exported from `@tj/core`):
  - `interface StatLeg { expiry: string; quantity: number }`
  - `interface StatFly { contracts: number | null; creditPerShare: number | null; bodyPutStrike: number | null; bodyCallStrike: number | null; putWingStrike: number | null; callWingStrike: number | null }`
  - `interface StatTrade { id: string; strategy: string; underlying: string; openedAt: number; closedAt: number | null; netPnl: number | null; fees: number; legs: readonly StatLeg[]; ironFly: StatFly | null }`
  - `type Closed<T extends StatTrade> = T & { closedAt: number; netPnl: number }`, and `type ClosedTrade = Closed<StatTrade>`
  - `closedTrades<T extends StatTrade>(trades: readonly T[]): Closed<T>[]`, oldest close first, ties kept in order
  - `interface Summary { trades; wins; losses; scratches; net; grossWins; grossLosses; fees; beforeFees; winRate: number | null; profitFactor: number | null; expectancy: number | null; avgWin: number | null; avgLoss: number | null; maxDrawdown: number }`
  - `summarize(trades: readonly ClosedTrade[]): Summary`, which expects close order
  - `interface EquityPoint { id: string; closedAt: number; equity: number; drawdown: number }`
  - `equityCurve(trades: readonly ClosedTrade[]): EquityPoint[]`
  - `maxDrawdown(trades: readonly ClosedTrade[]): number`
  - `interface PeriodResult<T> { net: number; trades: T[] }`
  - `dailyPnl<T extends ClosedTrade>(trades: readonly T[]): Map<string, PeriodResult<T>>`
  - `interface MonthResult { month: string; net: number; trades: number }`
  - `monthlyPnl(trades: readonly ClosedTrade[]): MonthResult[]`
  - `interface RollingPoint { closedAt: number; value: number }`
  - `rollingExpectancy(trades: readonly ClosedTrade[], window?: number): RollingPoint[]`, with a default window of 10
  - `largestLosses<T extends ClosedTrade>(trades: readonly T[], count?: number): T[]`, with a default count of 3
- Test helpers (not exported from the index):
  - `stats.fixture.ts`: `FIXTURE: StatTrade[]`, `ny(stamp)` and `makeTrade(overrides)`.
  - `stats.arbitrary.ts`: `tradesArbitrary`, which Tasks 4 and 5 reuse.

- [ ] **Step 1: Add fast-check**

```bash
pnpm --filter @tj/core add -D fast-check@^4.10.2
```

- [ ] **Step 2: Write the fixture, worked by hand**

Create `packages/core/src/stats.fixture.ts`:

```ts
import type { StatTrade } from "./stats.js";

/** Epoch ms for a New York wall-clock time. Every fixture date is in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);

/*
 * Eight closed trades, worked by hand. H is a 3-lot scalp; the rest are flies (body 10).
 *
 * id ticker opened (NY)        closed (NY)       net   fees expiry  wings P/C  lots credit/sh  max profit  kept
 * A  AA     Wed 09-02 15:45    Thu 09-03 09:50   +100  4    09-04   9 / 11     1    2.04        200         +50%
 * B  BB     Thu 09-03 15:50    Fri 09-04 15:40   -300  6    09-04   8 / 13     2    1.53        300        -100%
 * C  CC     Fri 09-04 15:30    Tue 09-08 09:45   +200  2    09-11   9 / 11     3    1.34        400         +50%
 * D  DD     Tue 09-08 07:45    Tue 09-08 09:45      0  2    09-08   5 / none   4    1.505       600           0%
 * E  AA     Wed 09-09 15:50    Thu 09-10 12:00    +50  4    09-18   4 / 16     5    2.008      1000          +5%
 * F  FF     Mon 09-14 15:40    Wed 09-16 10:00   -150  6    10-16   7 / 14     6    1.01        600         -25%
 * G  GG     Wed 09-30 15:50    Thu 10-01 09:55   +400  8    10-02   8 / 12    10    0.808       800         +50%
 * H  HH     Thu 10-01 15:50    Fri 10-02 09:40   -100  4    10-02   scalp      3    —           —           —
 *
 * C and D close at the same instant. Net +200, fees 36, before fees 236. Equity by close:
 * 100, -200, 0, 0, 50, -100, 300, 200. Running peak from $0: 100 ×6, then 300 ×2, so max drawdown is -300.
 */
interface Row {
  id: string;
  underlying: string;
  opened: string;
  closed: string;
  netPnl: number;
  fees: number;
  expiry: string;
  /** Put wing, body, call wing (null for a 1-wing fly), contracts, credit per share. Absent for a scalp. */
  fly?: [number, number, number | null, number, number];
}

const ROWS: Row[] = [
  { id: "A", underlying: "AA", opened: "2026-09-02 15:45", closed: "2026-09-03 09:50", netPnl: 100, fees: 4, expiry: "2026-09-04", fly: [9, 10, 11, 1, 2.04] },
  { id: "B", underlying: "BB", opened: "2026-09-03 15:50", closed: "2026-09-04 15:40", netPnl: -300, fees: 6, expiry: "2026-09-04", fly: [8, 10, 13, 2, 1.53] },
  { id: "C", underlying: "CC", opened: "2026-09-04 15:30", closed: "2026-09-08 09:45", netPnl: 200, fees: 2, expiry: "2026-09-11", fly: [9, 10, 11, 3, 1.34] },
  { id: "D", underlying: "DD", opened: "2026-09-08 07:45", closed: "2026-09-08 09:45", netPnl: 0, fees: 2, expiry: "2026-09-08", fly: [5, 10, null, 4, 1.505] },
  { id: "E", underlying: "AA", opened: "2026-09-09 15:50", closed: "2026-09-10 12:00", netPnl: 50, fees: 4, expiry: "2026-09-18", fly: [4, 10, 16, 5, 2.008] },
  { id: "F", underlying: "FF", opened: "2026-09-14 15:40", closed: "2026-09-16 10:00", netPnl: -150, fees: 6, expiry: "2026-10-16", fly: [7, 10, 14, 6, 1.01] },
  { id: "G", underlying: "GG", opened: "2026-09-30 15:50", closed: "2026-10-01 09:55", netPnl: 400, fees: 8, expiry: "2026-10-02", fly: [8, 10, 12, 10, 0.808] },
  { id: "H", underlying: "HH", opened: "2026-10-01 15:50", closed: "2026-10-02 09:40", netPnl: -100, fees: 4, expiry: "2026-10-02" },
];

export const FIXTURE: StatTrade[] = ROWS.map((row) => ({
  id: row.id,
  strategy: row.fly ? "iron_fly" : "scalp",
  underlying: row.underlying,
  openedAt: ny(row.opened),
  closedAt: ny(row.closed),
  netPnl: row.netPnl,
  fees: row.fees,
  legs: [{ expiry: row.expiry, quantity: row.fly ? -row.fly[3] : 3 }],
  ironFly: row.fly
    ? {
        putWingStrike: row.fly[0],
        bodyPutStrike: row.fly[1],
        bodyCallStrike: row.fly[1],
        callWingStrike: row.fly[2],
        contracts: row.fly[3],
        creditPerShare: row.fly[4],
      }
    : null,
}));

/** One closed 1-lot fly, with whatever the test changes. */
export function makeTrade(overrides: Partial<StatTrade> = {}): StatTrade {
  return {
    id: "T",
    strategy: "iron_fly",
    underlying: "TT",
    openedAt: ny("2026-09-01 15:45"),
    closedAt: ny("2026-09-02 09:50"),
    netPnl: 100,
    fees: 4,
    legs: [{ expiry: "2026-09-04", quantity: -1 }],
    ironFly: {
      putWingStrike: 9,
      bodyPutStrike: 10,
      bodyCallStrike: 10,
      callWingStrike: 11,
      contracts: 1,
      creditPerShare: 2.04,
    },
    ...overrides,
  };
}
```

If `pnpm lint` reflows the `ROWS` table, accept the formatter's layout.

- [ ] **Step 3: Write the random-trade generator for property tests**

Create `packages/core/src/stats.arbitrary.ts`:

```ts
import fc from "fast-check";
import { addDays } from "./calendar.js";
import { nyDate } from "./marks.js";
import type { StatTrade } from "./stats.js";

const HOUR = 3_600_000;
const TICKERS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ", "KK", "LL", "MM", "NN", "OO"];

/**
 * Random closed trades: whole-cent P&L and fees, closes in 2024–2027, held 1 hour to 10 days,
 * flies (some 1-winged, some with fees above their credit) mixed with scalps.
 */
export const tradesArbitrary = fc
  .array(
    fc.record({
      netCents: fc.integer({ min: -500_000, max: 500_000 }),
      feeCents: fc.integer({ min: 0, max: 5_000 }),
      closedAt: fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2027, 11, 31) }),
      heldHours: fc.integer({ min: 1, max: 240 }),
      dte: fc.integer({ min: 0, max: 30 }),
      ticker: fc.constantFrom(...TICKERS),
      contracts: fc.integer({ min: 1, max: 20 }),
      creditCents: fc.integer({ min: 1, max: 1_000 }),
      wings: fc.constantFrom<[number, number | null]>([9, 11], [8, 13], [5, null], [0, 12]),
      isFly: fc.boolean(),
    }),
    { maxLength: 60 },
  )
  .map((rows) =>
    rows.map((row, index): StatTrade => {
      const openedAt = row.closedAt - row.heldHours * HOUR;
      return {
        id: `t${index}`,
        strategy: row.isFly ? "iron_fly" : "scalp",
        underlying: row.ticker,
        openedAt,
        closedAt: row.closedAt,
        netPnl: row.netCents / 100,
        fees: row.feeCents / 100,
        legs: [{ expiry: addDays(nyDate(openedAt), row.dte), quantity: row.isFly ? -row.contracts : row.contracts }],
        ironFly: row.isFly
          ? {
              putWingStrike: row.wings[0],
              bodyPutStrike: 10,
              bodyCallStrike: 10,
              callWingStrike: row.wings[1],
              contracts: row.contracts,
              creditPerShare: row.creditCents / 100,
            }
          : null,
      };
    }),
  );
```

- [ ] **Step 4: Write the failing tests**

Create `packages/core/src/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIXTURE, makeTrade, ny } from "./stats.fixture.js";
import {
  closedTrades,
  dailyPnl,
  equityCurve,
  largestLosses,
  maxDrawdown,
  monthlyPnl,
  rollingExpectancy,
  summarize,
} from "./stats.js";

const closed = closedTrades(FIXTURE);

describe("closedTrades", () => {
  it("drops open trades and orders the rest by close, keeping trades that close together in their order", () => {
    const open = makeTrade({ id: "open", closedAt: null, netPnl: null });
    const ids = closedTrades([open, ...[...FIXTURE].reverse()]).map((trade) => trade.id);
    expect(ids).toEqual(["A", "B", "D", "C", "E", "F", "G", "H"]);
  });
});

describe("summarize", () => {
  it("works out the headline numbers", () => {
    expect(summarize(closed)).toEqual({
      trades: 8,
      wins: 4,
      losses: 3,
      scratches: 1,
      net: 200,
      grossWins: 750,
      grossLosses: -550,
      fees: 36,
      beforeFees: 236,
      winRate: 0.5,
      profitFactor: 750 / 550,
      expectancy: 25,
      avgWin: 187.5,
      avgLoss: -183.33,
      maxDrawdown: -300,
    });
  });

  it("has no ratios without trades, and an infinite profit factor without losses", () => {
    expect(summarize([])).toMatchObject({
      trades: 0,
      net: 0,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      avgWin: null,
      avgLoss: null,
      maxDrawdown: 0,
    });
    const winners = closedTrades(FIXTURE.filter((trade) => (trade.netPnl ?? 0) > 0));
    expect(summarize(winners).profitFactor).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("equityCurve", () => {
  it("runs cumulative net P&L from $0, with the drop from the running peak", () => {
    expect(equityCurve(closed).map((point) => [point.id, point.equity, point.drawdown])).toEqual([
      ["A", 100, 0],
      ["B", -200, -300],
      ["C", 0, -100],
      ["D", 0, -100],
      ["E", 50, -50],
      ["F", -100, -200],
      ["G", 300, 0],
      ["H", 200, -100],
    ]);
    expect(maxDrawdown(closed)).toBe(-300);
  });

  it("counts a first loss as drawdown from the $0 start", () => {
    expect(maxDrawdown(closedTrades([makeTrade({ netPnl: -50 })]))).toBe(-50);
  });
});

describe("dailyPnl and monthlyPnl", () => {
  it("adds up each New York close date", () => {
    const days = [...dailyPnl(closed)].map(([date, day]) => [date, day.net, day.trades.map((trade) => trade.id)]);
    expect(days).toEqual([
      ["2026-09-03", 100, ["A"]],
      ["2026-09-04", -300, ["B"]],
      ["2026-09-08", 200, ["C", "D"]],
      ["2026-09-10", 50, ["E"]],
      ["2026-09-16", -150, ["F"]],
      ["2026-10-01", 400, ["G"]],
      ["2026-10-02", -100, ["H"]],
    ]);
  });

  it("puts a late-evening close on New York's date, not UTC's", () => {
    const late = makeTrade({ closedAt: ny("2026-09-30 23:30"), netPnl: 10 });
    expect([...dailyPnl(closedTrades([late])).keys()]).toEqual(["2026-09-30"]);
    expect(monthlyPnl(closedTrades([late]))).toEqual([{ month: "2026-09", net: 10, trades: 1 }]);
  });

  it("adds up each New York close month", () => {
    expect(monthlyPnl(closed)).toEqual([
      { month: "2026-09", net: -100, trades: 6 },
      { month: "2026-10", net: 300, trades: 2 },
    ]);
  });
});

describe("rollingExpectancy", () => {
  it("averages the last N trades at each trade from the Nth on", () => {
    const points = rollingExpectancy(closed, 3);
    expect(points.map((point) => point.value)).toEqual([0, -33.33, 83.33, -33.33, 100, 50]);
    expect(points[0]?.closedAt).toBe(ny("2026-09-08 09:45"));
  });

  it("is empty until there are enough trades", () => {
    expect(rollingExpectancy(closed)).toEqual([]);
  });
});

describe("largestLosses", () => {
  it("lists the worst losses first", () => {
    expect(largestLosses(closed).map((trade) => [trade.id, trade.netPnl])).toEqual([
      ["B", -300],
      ["F", -150],
      ["H", -100],
    ]);
  });
});
```

Create `packages/core/src/stats.property.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { closedTrades, equityCurve, maxDrawdown, summarize } from "./stats.js";

describe("stats properties", () => {
  it("counts every trade as a win, a loss or a scratch", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const summary = summarize(closedTrades(trades));
        expect(summary.wins + summary.losses + summary.scratches).toBe(summary.trades);
      }),
    );
  });

  it("ends the equity curve at the total net", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const closed = closedTrades(trades);
        // toBeCloseTo, not toBe: round2 can return -0 where the other side is 0.
        expect(equityCurve(closed).at(-1)?.equity ?? 0).toBeCloseTo(summarize(closed).net, 6);
      }),
    );
  });

  it("keeps max drawdown at or below $0, and no deeper than all the losses together", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const closed = closedTrades(trades);
        const drawdown = maxDrawdown(closed);
        expect(drawdown).toBeLessThanOrEqual(0);
        expect(drawdown).toBeGreaterThanOrEqual(summarize(closed).grossLosses);
      }),
    );
  });
});
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/stats.test.ts packages/core/src/stats.property.test.ts`
Expected: FAIL, because `./stats.js` does not exist.

- [ ] **Step 6: Implement**

Create `packages/core/src/stats.ts`:

```ts
import { nyDate } from "./marks.js";
import { round2 } from "./money.js";

export interface StatLeg {
  expiry: string;
  quantity: number;
}

export interface StatFly {
  contracts: number | null;
  creditPerShare: number | null;
  bodyPutStrike: number | null;
  bodyCallStrike: number | null;
  putWingStrike: number | null;
  callWingStrike: number | null;
}

/** The fields statistics read. The web app's trade rows satisfy it as they are. */
export interface StatTrade {
  id: string;
  strategy: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
  netPnl: number | null;
  fees: number;
  legs: readonly StatLeg[];
  ironFly: StatFly | null;
}

export type Closed<T extends StatTrade> = T & { closedAt: number; netPnl: number };
export type ClosedTrade = Closed<StatTrade>;

/** Closed trades only, oldest close first. Trades that close at the same instant keep their order. */
export function closedTrades<T extends StatTrade>(trades: readonly T[]): Closed<T>[] {
  return trades
    .filter((trade): trade is Closed<T> => trade.closedAt != null && trade.netPnl != null)
    .sort((a, b) => a.closedAt - b.closedAt);
}

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  net: number;
  grossWins: number;
  grossLosses: number;
  fees: number;
  beforeFees: number;
  /** Wins over all closed trades, scratches included. */
  winRate: number | null;
  /** Gross wins over gross losses; Infinity with wins and no losses. */
  profitFactor: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
}

const total = (trades: readonly ClosedTrade[], pick: (trade: ClosedTrade) => number) =>
  round2(trades.reduce((sum, trade) => sum + pick(trade), 0));

/** The headline numbers (spec §5.1). Expects trades in close order, as `closedTrades` returns them. */
export function summarize(trades: readonly ClosedTrade[]): Summary {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = total(wins, (trade) => trade.netPnl);
  const grossLosses = total(losses, (trade) => trade.netPnl);
  const net = total(trades, (trade) => trade.netPnl);
  const fees = total(trades, (trade) => trade.fees);
  const count = trades.length;
  let profitFactor: number | null = null;
  if (losses.length > 0) profitFactor = grossWins / -grossLosses;
  else if (wins.length > 0) profitFactor = Number.POSITIVE_INFINITY;
  return {
    trades: count,
    wins: wins.length,
    losses: losses.length,
    scratches: count - wins.length - losses.length,
    net,
    grossWins,
    grossLosses,
    fees,
    beforeFees: round2(net + fees),
    winRate: count ? wins.length / count : null,
    profitFactor,
    expectancy: count ? round2(net / count) : null,
    avgWin: wins.length ? round2(grossWins / wins.length) : null,
    avgLoss: losses.length ? round2(grossLosses / losses.length) : null,
    maxDrawdown: maxDrawdown(trades),
  };
}

export interface EquityPoint {
  id: string;
  closedAt: number;
  equity: number;
  /** Equity minus its running peak, which starts at $0; always ≤ 0. */
  drawdown: number;
}

/** Cumulative net P&L after each trade, in close order. */
export function equityCurve(trades: readonly ClosedTrade[]): EquityPoint[] {
  let equity = 0;
  let peak = 0;
  return trades.map((trade) => {
    equity = round2(equity + trade.netPnl);
    peak = Math.max(peak, equity);
    return { id: trade.id, closedAt: trade.closedAt, equity, drawdown: round2(equity - peak) };
  });
}

/** The largest drop from a running peak of cumulative net P&L; 0 with no drop. */
export function maxDrawdown(trades: readonly ClosedTrade[]): number {
  return equityCurve(trades).reduce((lowest, point) => Math.min(lowest, point.drawdown), 0);
}

export interface PeriodResult<T> {
  net: number;
  trades: T[];
}

/** Net P&L and trades per New York close date. */
export function dailyPnl<T extends ClosedTrade>(trades: readonly T[]): Map<string, PeriodResult<T>> {
  const days = new Map<string, PeriodResult<T>>();
  for (const trade of trades) {
    const date = nyDate(trade.closedAt);
    const day = days.get(date) ?? { net: 0, trades: [] };
    day.net = round2(day.net + trade.netPnl);
    day.trades.push(trade);
    days.set(date, day);
  }
  return days;
}

export interface MonthResult {
  /** YYYY-MM */
  month: string;
  net: number;
  trades: number;
}

/** Net P&L and trade count per New York close month, oldest first. */
export function monthlyPnl(trades: readonly ClosedTrade[]): MonthResult[] {
  const months = new Map<string, MonthResult>();
  for (const trade of trades) {
    const month = nyDate(trade.closedAt).slice(0, 7);
    const result = months.get(month) ?? { month, net: 0, trades: 0 };
    result.net = round2(result.net + trade.netPnl);
    result.trades++;
    months.set(month, result);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface RollingPoint {
  closedAt: number;
  value: number;
}

/** The mean net P&L of the last `window` trades, at each trade from the `window`th on. */
export function rollingExpectancy(trades: readonly ClosedTrade[], window = 10): RollingPoint[] {
  const points: RollingPoint[] = [];
  let sum = 0;
  trades.forEach((trade, index) => {
    sum += trade.netPnl;
    const leaving = trades[index - window];
    if (leaving) sum -= leaving.netPnl;
    if (index >= window - 1) points.push({ closedAt: trade.closedAt, value: round2(sum / window) });
  });
  return points;
}

/** The worst losses, worst first. */
export function largestLosses<T extends ClosedTrade>(trades: readonly T[], count = 3): T[] {
  return trades
    .filter((trade) => trade.netPnl < 0)
    .sort((a, b) => a.netPnl - b.netPnl)
    .slice(0, count);
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./stats.js";
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/stats.test.ts packages/core/src/stats.property.test.ts`
Expected: PASS.

- [ ] **Step 8: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/package.json pnpm-lock.yaml packages/core/src/stats.ts packages/core/src/stats.fixture.ts packages/core/src/stats.arbitrary.ts packages/core/src/stats.test.ts packages/core/src/stats.property.test.ts packages/core/src/index.ts
git commit -m "feat(core): headline stats, equity and drawdown, and P&L by day and month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Splits, with edges the user sets

**Files:**
- Create: `packages/core/src/splits.ts`
- Create: `packages/core/src/splits.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes:
  - `WEEKDAYS`, `HOLD_BUCKETS`, `holdBucket` and `nyWeekday` (calendar);
  - `nyDate` (marks);
  - `round2` (money);
  - `ClosedTrade`, `StatTrade`, `StatFly`, `summarize` and `closedTrades` (stats);
  - the test helpers `FIXTURE`, `makeTrade`, `ny` and `tradesArbitrary`.
- Produces (exported from `@tj/core`):
  - `interface SplitRow { label: string; trades: number; winRate: number; net: number; profitFactor: number | null }`
  - `type EdgeKind = "usd" | "contracts"`
  - `DEFAULT_EDGES: Record<EdgeKind, readonly number[]>`, which is `usd: [250, 500, 1000]` and `contracts: [2, 4, 6]`
  - `parseEdges(text: string, kind: EdgeKind): number[] | null`
  - `edgeLabels(edges: readonly number[], kind: EdgeKind): string[]`
  - `edgeBucket(value: number, edges: readonly number[], kind: EdgeKind): string`
  - `daysToExpiry(trade: StatTrade): number | null`
  - `tradeSize(trade: StatTrade): number | null`
  - `flyCredit(trade: StatTrade): number | null`
  - `monthLabel(month: string): string`, e.g. `"2026-09"` → `"Sep 2026"`
  - `weekdaySplit(trades)`, `dteSplit(trades)`, `contractsSplit(trades, edges)`, `holdSplit(trades)`, `monthSplit(trades)` and `tickerSplit(trades)`, each taking `readonly ClosedTrade[]` and returning `SplitRow[]`
  - `creditSplit(flies, edges)`, `wingsSplit(flies)` and `wingWidthSplit(flies)`, each also returning `SplitRow[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/splits.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { round2 } from "./money.js";
import {
  contractsSplit,
  creditSplit,
  DEFAULT_EDGES,
  dteSplit,
  type EdgeKind,
  edgeLabels,
  holdSplit,
  monthSplit,
  parseEdges,
  type SplitRow,
  tickerSplit,
  weekdaySplit,
  wingsSplit,
  wingWidthSplit,
} from "./splits.js";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { FIXTURE, makeTrade, ny } from "./stats.fixture.js";
import { closedTrades, summarize } from "./stats.js";

const closed = closedTrades(FIXTURE);
const flies = closed.filter((trade) => trade.strategy === "iron_fly");
const rows = (split: SplitRow[]) => split.map((row) => [row.label, row.trades, row.net]);

describe("splits of the fixture", () => {
  it("by weekday opened", () => {
    expect(rows(weekdaySplit(closed))).toEqual([
      ["Mon", 1, -150],
      ["Tue", 1, 0],
      ["Wed", 3, 550],
      ["Thu", 2, -400],
      ["Fri", 1, 200],
    ]);
  });

  it("by days to expiry", () => {
    expect(rows(dteSplit(closed))).toEqual([
      ["0–1", 3, -400],
      ["2–7", 3, 700],
      ["8–14", 1, 50],
      ["15+", 1, -150],
    ]);
  });

  it("by contracts, with the default edges and with others", () => {
    expect(rows(contractsSplit(closed, DEFAULT_EDGES.contracts))).toEqual([
      ["1", 1, 100],
      ["2–3", 3, -200],
      ["4–5", 2, 50],
      ["6+", 2, 250],
    ]);
    expect(rows(contractsSplit(closed, [5, 10]))).toEqual([
      ["1–4", 5, -100],
      ["5–9", 2, -100],
      ["10+", 1, 400],
    ]);
  });

  it("by hold time", () => {
    expect(rows(holdSplit(closed))).toEqual([
      ["same day", 1, 0],
      ["overnight", 3, 400],
      ["1 full day", 2, -250],
      ["weekend", 1, 200],
      ["longer", 1, -150],
    ]);
  });

  it("by close month", () => {
    expect(rows(monthSplit(closed))).toEqual([
      ["Sep 2026", 6, -100],
      ["Oct 2026", 2, 300],
    ]);
  });

  it("by ticker, best first", () => {
    expect(rows(tickerSplit(closed))).toEqual([
      ["GG", 1, 400],
      ["CC", 1, 200],
      ["AA", 2, 150],
      ["DD", 1, 0],
      ["HH", 1, -100],
      ["FF", 1, -150],
      ["BB", 1, -300],
    ]);
  });

  it("by credit, wings and wider wing width, flies only", () => {
    expect(rows(creditSplit(flies, DEFAULT_EDGES.usd))).toEqual([
      ["< $250", 1, 100],
      ["$250–500", 2, -100],
      ["$500–1,000", 3, 250],
      ["$1,000+", 1, 50],
    ]);
    expect(rows(wingsSplit(flies))).toEqual([
      ["balanced", 4, 750],
      ["broken", 2, -450],
      ["1-wing", 1, 0],
    ]);
    expect(rows(wingWidthSplit(flies))).toEqual([
      ["≤ 2.5", 3, 700],
      ["2.5–5", 2, -450],
      ["5–10", 1, 50],
      ["1-wing", 1, 0],
    ]);
  });

  it("gives each row its win rate and profit factor", () => {
    const [mon, , wed, thu] = weekdaySplit(closed);
    expect(wed).toMatchObject({ winRate: 1, profitFactor: Number.POSITIVE_INFINITY });
    expect(thu).toMatchObject({ winRate: 0, profitFactor: 0 });
    expect(mon).toMatchObject({ winRate: 0, profitFactor: 0 });
  });
});

describe("ticker split past ten tickers", () => {
  it("keeps the best 5 and worst 5, with one row for the rest", () => {
    const trades = closedTrades(
      Array.from({ length: 12 }, (_, index) =>
        makeTrade({ id: `t${index}`, underlying: `T${String(index + 1).padStart(2, "0")}`, netPnl: 1200 - index * 100 }),
      ),
    );
    expect(rows(tickerSplit(trades))).toEqual([
      ["T01", 1, 1200],
      ["T02", 1, 1100],
      ["T03", 1, 1000],
      ["T04", 1, 900],
      ["T05", 1, 800],
      ["2 others", 2, 1300],
      ["T08", 1, 500],
      ["T09", 1, 400],
      ["T10", 1, 300],
      ["T11", 1, 200],
      ["T12", 1, 100],
    ]);
  });
});

describe("trades a split can't place", () => {
  it("go under unknown, last", () => {
    const noExpiry = makeTrade({ id: "n", legs: [], closedAt: ny("2026-09-02 09:50") });
    const backwards = makeTrade({ id: "b", openedAt: ny("2026-09-03 10:00"), closedAt: ny("2026-09-02 09:50") });
    expect(dteSplit(closedTrades([noExpiry])).map((row) => row.label)).toEqual(["unknown"]);
    expect(holdSplit(closedTrades([backwards])).map((row) => row.label)).toEqual(["unknown"]);
  });
});

describe("parseEdges", () => {
  it.each<[string, EdgeKind, number[]]>([
    ["250, 500, 1000", "usd", [250, 500, 1000]],
    ["$250 $500", "usd", [250, 500]],
    ["0.5, 1.5", "usd", [0.5, 1.5]],
    ["2,4,6", "contracts", [2, 4, 6]],
    ["3", "contracts", [3]],
  ])("reads %s", (text, kind, edges) => {
    expect(parseEdges(text, kind)).toEqual(edges);
  });

  it.each<[string, EdgeKind]>([
    ["", "usd"],
    ["abc", "usd"],
    ["500, 250", "usd"],
    ["250, 250", "usd"],
    ["1,000", "usd"],
    ["0, 5", "usd"],
    ["1, 3", "contracts"],
    ["2.5, 4", "contracts"],
  ])("refuses %s", (text, kind) => {
    expect(parseEdges(text, kind)).toBeNull();
  });
});

describe("edgeLabels", () => {
  it("names dollar and contract buckets", () => {
    expect(edgeLabels([250, 500, 1000], "usd")).toEqual(["< $250", "$250–500", "$500–1,000", "$1,000+"]);
    expect(edgeLabels([2, 4, 6], "contracts")).toEqual(["1", "2–3", "4–5", "6+"]);
    expect(edgeLabels([3], "contracts")).toEqual(["1–2", "3+"]);
  });
});

describe("split properties", () => {
  it("adds each split's rows up to the total net", () => {
    const sum = (split: SplitRow[]) => round2(split.reduce((total, row) => total + row.net, 0));
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const all = closedTrades(trades);
        const onlyFlies = all.filter((trade) => trade.strategy === "iron_fly");
        const net = summarize(all).net;
        const flyNet = summarize(onlyFlies).net;
        for (const split of [
          weekdaySplit(all),
          dteSplit(all),
          contractsSplit(all, DEFAULT_EDGES.contracts),
          holdSplit(all),
          monthSplit(all),
          tickerSplit(all),
        ]) {
          expect(sum(split)).toBeCloseTo(net, 6);
        }
        for (const split of [creditSplit(onlyFlies, DEFAULT_EDGES.usd), wingsSplit(onlyFlies), wingWidthSplit(onlyFlies)]) {
          expect(sum(split)).toBeCloseTo(flyNet, 6);
        }
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/splits.test.ts`
Expected: FAIL, because `./splits.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/splits.ts`:

```ts
import { HOLD_BUCKETS, holdBucket, nyWeekday, WEEKDAYS } from "./calendar.js";
import { nyDate } from "./marks.js";
import { round2 } from "./money.js";
import { type ClosedTrade, type StatFly, type StatTrade, summarize } from "./stats.js";

export interface SplitRow {
  label: string;
  trades: number;
  winRate: number;
  net: number;
  profitFactor: number | null;
}

const UNKNOWN = "unknown";

function row(label: string, trades: readonly ClosedTrade[]): SplitRow {
  const summary = summarize(trades);
  return {
    label,
    trades: summary.trades,
    winRate: summary.winRate ?? 0,
    net: summary.net,
    profitFactor: summary.profitFactor,
  };
}

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

export type EdgeKind = "usd" | "contracts";

export const DEFAULT_EDGES: Record<EdgeKind, readonly number[]> = {
  usd: [250, 500, 1000],
  contracts: [2, 4, 6],
};

/**
 * Reads edges typed like "250, 500, 1000". Null unless they are increasing and above 0,
 * and for contracts whole numbers from 2. Commas separate edges, so "1,000" is refused.
 */
export function parseEdges(text: string, kind: EdgeKind): number[] | null {
  const edges = text
    .replaceAll("$", "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (edges.length === 0) return null;
  const valid = edges.every(
    (edge, index) =>
      Number.isFinite(edge) &&
      edge > 0 &&
      (kind === "usd" || (Number.isInteger(edge) && edge >= 2)) &&
      (index === 0 || edge > (edges[index - 1] ?? 0)),
  );
  return valid ? edges : null;
}

const plain = (value: number) => value.toLocaleString("en-US");

/** Bucket names for edges, where each edge starts a bucket. */
export function edgeLabels(edges: readonly number[], kind: EdgeKind): string[] {
  const first = edges[0] ?? 0;
  const last = edges[edges.length - 1] ?? 0;
  const inner = edges.slice(1).map((edge, index) => [edges[index] ?? 0, edge] as const);
  if (kind === "usd") {
    return [`< $${plain(first)}`, ...inner.map(([from, to]) => `$${plain(from)}–${plain(to)}`), `$${plain(last)}+`];
  }
  const span = (from: number, to: number) => (from === to ? `${from}` : `${from}–${to}`);
  return [span(1, first - 1), ...inner.map(([from, to]) => span(from, to - 1)), `${last}+`];
}

/** The bucket a value falls in. */
export function edgeBucket(value: number, edges: readonly number[], kind: EdgeKind): string {
  return edgeLabels(edges, kind)[edges.filter((edge) => value >= edge).length] ?? UNKNOWN;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

/** Calendar days from the New York open date to the earliest leg expiry; null without one. */
export function daysToExpiry(trade: StatTrade): number | null {
  const expiry = trade.legs
    .map((leg) => leg.expiry)
    .filter((date) => ISO_DATE.test(date))
    .sort()[0];
  if (!expiry) return null;
  const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${nyDate(trade.openedAt)}T00:00:00Z`)) / DAY);
  return days >= 0 ? days : null;
}

/** Fly contracts, or for other trades the largest leg quantity. */
export function tradeSize(trade: StatTrade): number | null {
  const size = trade.ironFly?.contracts ?? Math.max(0, ...trade.legs.map((leg) => Math.abs(leg.quantity)));
  return size > 0 ? size : null;
}

/** Gross credit taken in: credit per share × contracts × 100. */
export function flyCredit(trade: StatTrade): number | null {
  const credit = trade.ironFly?.creditPerShare;
  const contracts = trade.ironFly?.contracts;
  return credit != null && contracts != null ? round2(credit * contracts * 100) : null;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-09" → "Sep 2026". */
export const monthLabel = (month: string) => MONTH.format(new Date(`${month}-01T00:00:00Z`));

const DTE_BUCKETS = ["0–1", "2–7", "8–14", "15+"];

function dteLabel(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 1) return "0–1";
  if (days <= 7) return "2–7";
  return days <= 14 ? "8–14" : "15+";
}

export const weekdaySplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS);

export const dteSplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => dteLabel(daysToExpiry(trade)), DTE_BUCKETS);

export function contractsSplit(trades: readonly ClosedTrade[], edges: readonly number[]): SplitRow[] {
  return group(
    trades,
    (trade) => {
      const size = tradeSize(trade);
      return size == null ? UNKNOWN : edgeBucket(size, edges, "contracts");
    },
    edgeLabels(edges, "contracts"),
  );
}

export const holdSplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => holdBucket(trade.openedAt, trade.closedAt), HOLD_BUCKETS);

export function monthSplit(trades: readonly ClosedTrade[]): SplitRow[] {
  const monthOf = (trade: ClosedTrade) => nyDate(trade.closedAt).slice(0, 7);
  const months = [...new Set(trades.map(monthOf))].sort();
  return group(trades, (trade) => monthLabel(monthOf(trade)), months.map(monthLabel));
}

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

export function creditSplit(flies: readonly ClosedTrade[], edges: readonly number[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const credit = flyCredit(trade);
      return credit == null ? UNKNOWN : edgeBucket(credit, edges, "usd");
    },
    edgeLabels(edges, "usd"),
  );
}

/** Put and call wing widths in points; null for a missing wing. A put wing at strike 0 is a missing wing. */
function wingWidths(fly: StatFly): { put: number | null; call: number | null } | null {
  if (fly.bodyPutStrike == null || fly.bodyCallStrike == null) return null;
  return {
    put: fly.putWingStrike != null && fly.putWingStrike > 0 ? round2(fly.bodyPutStrike - fly.putWingStrike) : null,
    call: fly.callWingStrike != null ? round2(fly.callWingStrike - fly.bodyCallStrike) : null,
  };
}

export function wingsSplit(flies: readonly ClosedTrade[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const widths = trade.ironFly && wingWidths(trade.ironFly);
      if (!widths) return UNKNOWN;
      if (widths.put == null || widths.call == null) return "1-wing";
      return widths.put === widths.call ? "balanced" : "broken";
    },
    ["balanced", "broken", "1-wing"],
  );
}

const WIDTH_BUCKETS = ["≤ 2.5", "2.5–5", "5–10", "10+", "1-wing"];

export function wingWidthSplit(flies: readonly ClosedTrade[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const widths = trade.ironFly && wingWidths(trade.ironFly);
      if (!widths) return UNKNOWN;
      if (widths.put == null || widths.call == null) return "1-wing";
      const wider = Math.max(widths.put, widths.call);
      if (wider <= 2.5) return "≤ 2.5";
      if (wider <= 5) return "2.5–5";
      return wider <= 10 ? "5–10" : "10+";
    },
    WIDTH_BUCKETS,
  );
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./splits.js";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/splits.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/splits.ts packages/core/src/splits.test.ts packages/core/src/index.ts
git commit -m "feat(core): results split by weekday, expiry, size, hold, month, ticker and fly shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Credit kept

**Files:**
- Create: `packages/core/src/kept.ts`
- Create: `packages/core/src/kept.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `flyMaxProfit` and `pctKept` (Task 1); `flyCredit` (Task 4); `ClosedTrade` and `closedTrades` (Task 3); `round2`; the test helpers.
- Produces (exported from `@tj/core`):
  - `interface KeptSide { mean: number; median: number }`
  - `interface KeptStats { counted: number; skipped: number; avgCredit: number | null; avgMaxProfit: number | null; winnersKeep: KeptSide | null; losersLose: KeptSide | null; keptOverall: number | null }`
  - `keptStats(flies: readonly ClosedTrade[]): KeptStats`
  - `interface KeptBin { label: string; from: number; to: number; tradeIds: string[] }`
  - `keptHistogram(flies: readonly ClosedTrade[]): KeptBin[]`, which always returns 11 bins

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/kept.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flyMaxProfit, pctKept } from "./ironFly.js";
import { keptHistogram, keptStats } from "./kept.js";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { FIXTURE, makeTrade } from "./stats.fixture.js";
import { closedTrades } from "./stats.js";

const flies = closedTrades(FIXTURE).filter((trade) => trade.strategy === "iron_fly");

describe("keptStats", () => {
  it("measures winners and losers against max profit", () => {
    const stats = keptStats(flies);
    expect(stats).toMatchObject({ counted: 7, skipped: 0, avgCredit: 561.71, avgMaxProfit: 557.14 });
    expect(stats.winnersKeep?.mean).toBeCloseTo(0.3875, 10);
    expect(stats.winnersKeep?.median).toBe(0.5);
    expect(stats.losersLose?.mean).toBeCloseTo(0.625, 10);
    expect(stats.losersLose?.median).toBeCloseTo(0.625, 10);
    expect(stats.keptOverall).toBeCloseTo(300 / 3900, 10);
  });

  it("leaves out a fly whose fees ate the credit, and counts it", () => {
    const eaten = makeTrade({ id: "X", netPnl: -5, fees: 300 });
    expect(keptStats([...flies, ...closedTrades([eaten])])).toMatchObject({ counted: 7, skipped: 1 });
  });

  it("has nothing to say without flies", () => {
    expect(keptStats([])).toEqual({
      counted: 0,
      skipped: 0,
      avgCredit: null,
      avgMaxProfit: null,
      winnersKeep: null,
      losersLose: null,
      keptOverall: null,
    });
  });
});

describe("keptHistogram", () => {
  it("bins % kept in 25-point steps from −150%", () => {
    const bins = keptHistogram(flies);
    expect(bins.map((bin) => bin.label)).toEqual([
      "< −150%",
      "−150% to −125%",
      "−125% to −100%",
      "−100% to −75%",
      "−75% to −50%",
      "−50% to −25%",
      "−25% to 0%",
      "0% to 25%",
      "25% to 50%",
      "50% to 75%",
      "75% to 100%",
    ]);
    expect(bins.filter((bin) => bin.tradeIds.length > 0).map((bin) => [bin.label, bin.tradeIds])).toEqual([
      ["−100% to −75%", ["B"]],
      ["−25% to 0%", ["F"]],
      ["0% to 25%", ["D", "E"]],
      ["50% to 75%", ["A", "C", "G"]],
    ]);
  });

  it("puts a loss past −150% in the first bin and a full keep in the last", () => {
    // Max profit 200: −334 keeps −167%, +200 keeps 100%.
    const deep = makeTrade({ id: "deep", netPnl: -334 });
    const full = makeTrade({ id: "full", netPnl: 200 });
    const bins = keptHistogram(closedTrades([deep, full]));
    expect(bins[0]?.tradeIds).toEqual(["deep"]);
    expect(bins.at(-1)?.tradeIds).toEqual(["full"]);
  });
});

describe("kept properties", () => {
  it("has no % kept exactly when there is no max profit", () => {
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        for (const trade of closedTrades(trades)) {
          const fly = trade.ironFly;
          if (!fly || fly.creditPerShare == null || fly.contracts == null) continue;
          const maxProfit = flyMaxProfit(fly.creditPerShare, fly.contracts, trade.fees);
          expect(pctKept(trade) === null).toBe(maxProfit <= 0);
        }
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/kept.test.ts`
Expected: FAIL, because `./kept.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/kept.ts`:

```ts
import { flyMaxProfit, pctKept } from "./ironFly.js";
import { round2 } from "./money.js";
import { flyCredit } from "./splits.js";
import type { ClosedTrade } from "./stats.js";

export interface KeptSide {
  mean: number;
  median: number;
}

export interface KeptStats {
  /** Flies with a max profit above 0. Every figure below uses only these. */
  counted: number;
  /** Flies left out: fees at or above the credit, or no credit recorded. */
  skipped: number;
  avgCredit: number | null;
  avgMaxProfit: number | null;
  /** The share of max profit winners keep. */
  winnersKeep: KeptSide | null;
  /** The share of max profit losers lose, as a positive number. */
  losersLose: KeptSide | null;
  /** Σ net ÷ Σ max profit. */
  keptOverall: number | null;
}

function side(values: readonly number[]): KeptSide | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, median };
}

const mean = (values: readonly number[]) =>
  values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

/** How much of max profit the flies keep (spec §5.3). */
export function keptStats(flies: readonly ClosedTrade[]): KeptStats {
  const measured = flies.flatMap((trade) => {
    const kept = pctKept(trade);
    const credit = flyCredit(trade);
    const fly = trade.ironFly;
    if (kept == null || credit == null || fly?.creditPerShare == null || fly.contracts == null) return [];
    return [{ trade, kept, credit, maxProfit: flyMaxProfit(fly.creditPerShare, fly.contracts, trade.fees) }];
  });
  const totalMaxProfit = measured.reduce((sum, item) => sum + item.maxProfit, 0);
  return {
    counted: measured.length,
    skipped: flies.length - measured.length,
    avgCredit: mean(measured.map((item) => item.credit)),
    avgMaxProfit: mean(measured.map((item) => item.maxProfit)),
    winnersKeep: side(measured.filter((item) => item.trade.netPnl > 0).map((item) => item.kept)),
    losersLose: side(measured.filter((item) => item.trade.netPnl < 0).map((item) => -item.kept)),
    keptOverall: measured.length
      ? measured.reduce((sum, item) => sum + item.trade.netPnl, 0) / totalMaxProfit
      : null,
  };
}

export interface KeptBin {
  label: string;
  from: number;
  to: number;
  tradeIds: string[];
}

const FLOOR = -1.5;
const STEP = 0.25;
const percent = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100))}%`;

/** % kept per trade in 25-point bins from −150% to 100%, plus one bin below −150%. 100% goes in the last bin. */
export function keptHistogram(flies: readonly ClosedTrade[]): KeptBin[] {
  const bins: KeptBin[] = [
    { label: `< ${percent(FLOOR)}`, from: Number.NEGATIVE_INFINITY, to: FLOOR, tradeIds: [] },
  ];
  for (let from = FLOOR; from < 1; from = round2(from + STEP)) {
    const to = round2(from + STEP);
    bins.push({ label: `${percent(from)} to ${percent(to)}`, from, to, tradeIds: [] });
  }
  for (const trade of flies) {
    const kept = pctKept(trade);
    if (kept == null) continue;
    const index = kept < FLOOR ? 0 : Math.min(bins.length - 1, 1 + Math.floor((kept - FLOOR) / STEP));
    bins[index]?.tradeIds.push(trade.id);
  }
  return bins;
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./kept.js";
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/src/kept.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src/kept.ts packages/core/src/kept.test.ts packages/core/src/index.ts
git commit -m "feat(core): how much of max profit winners keep and losers lose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "% kept" in the lists and on the trade page

**Files:**
- Modify: `apps/web/src/routes/Journal.tsx` (the Return on risk column, lines 113 and 168)
- Modify: `apps/web/src/routes/TradeDetail.tsx` (the Return on risk tile, line 124; the `patch` mutation's `onSuccess`, line 53)
- Test: `apps/web/src/routes/Journal.test.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`

**Interfaces:**
- Consumes: `pctKept` (Task 1); `Pct` from `apps/web/src/components/ui.tsx`.
- Produces: the lists and trade page show `% kept`. A trade-page change invalidates `["trades"]`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/routes/Journal.test.tsx`:

1. In the `trade` fixture, replace `ironFly: null,` with:

```ts
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
  },
```

2. Replace the test `lists trades with P&L and return on risk` with:

```ts
  it("lists trades with P&L and the share of max profit kept", async () => {
    stubApi();
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    expect(screen.getByText("+$512.00")).toBeTruthy();
    // 512 of a 1,192 max profit (3.00 × 4 × 100 − 8).
    expect(screen.getByText("+42.95%")).toBeTruthy();
    expect(screen.getByText("% kept")).toBeTruthy();
    expect(screen.queryByText("Return on risk")).toBeNull();
    expect(screen.getByText("IRON FLY")).toBeTruthy();
  });

  it("shows % kept for a 1-wing fly, which has no metrics", async () => {
    stubApi({
      trades: [
        {
          ...trade,
          netPnl: 100,
          fees: 4,
          metrics: null,
          ironFly: { ...trade.ironFly, callWingStrike: null, contracts: 1, creditPerShare: 2.04 },
        },
      ],
    });
    renderJournal();
    await waitFor(() => expect(screen.getByText("+50.00%")).toBeTruthy());
  });
```

In `apps/web/src/routes/TradeDetail.test.tsx`, add inside `describe("TradeDetail", …)`:

```ts
  it("shows the share of max profit kept, with max loss only for reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-kept")).toBeTruthy());
    expect(screen.getByTestId("tile-kept").textContent).toContain("+42.95%");
    expect(screen.queryByText("Return on risk")).toBeNull();
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("2,008.00");
  });

  it("marks the trade lists stale after a change, so Analytics and the lists refetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse()),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(["trades", { all: true }], []);
    render(
      <QueryClientProvider client={client}>
        <TradeDetail tradeId="t1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "B" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    await waitFor(() => expect(client.getQueryState(["trades", { all: true }])?.isInvalidated).toBe(true));
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Journal.test.tsx apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. `+42.95%`, `% kept` and `tile-kept` are not found, and the trades query is never invalidated.

- [ ] **Step 3: Implement**

In `apps/web/src/routes/Journal.tsx`:
- change the `@tj/core` import to `import { closeEstimate, type OptionQuote, pctKept } from "@tj/core";`;
- replace the header cell `<th className="w-28 text-right font-medium">Return on risk</th>` with `<th className="w-28 text-right font-medium">% kept</th>`;
- replace `<Pct value={trade.metrics?.returnOnRisk ?? null} />` with `<Pct value={pctKept(trade)} />`.

In `apps/web/src/routes/TradeDetail.tsx`:
- change the `@tj/core` import to `import { closeEstimate, type OptionQuote, pctKept, round2 } from "@tj/core";`;
- replace the tile `<Tile label="Return on risk">{metrics ? <Pct value={metrics.returnOnRisk} /> : "—"}</Tile>` with:

```tsx
        <Tile label="% kept" testId="tile-kept">
          <Pct value={pctKept(trade)} />
        </Tile>
```

- replace the mutation's `onSuccess` with:

```ts
    // The lists and Analytics read every trade; a new grade or exclusion must reach them too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade", tradeId] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/routes/Journal.test.tsx apps/web/src/routes/TradeDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/routes/Journal.tsx apps/web/src/routes/Journal.test.tsx apps/web/src/routes/TradeDetail.tsx apps/web/src/routes/TradeDetail.test.tsx
git commit -m "feat(web): show the share of max profit kept instead of return on risk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Every trade for Analytics, filtered in the browser

**Files:**
- Modify: `packages/db/src/repositories/trades.ts` (`TradeFilter.limit`, and `list`)
- Modify: `apps/server/src/routes/trades.ts` (`listQuerySchema`, and the list handler)
- Create: `apps/web/src/analytics/data.ts`
- Create: `apps/web/src/analytics/testing.tsx` (test helpers, extended in later tasks)
- Test: `packages/db/src/repositories/trades.test.ts`, `apps/server/src/app.test.ts`, `apps/web/src/analytics/data.test.tsx`

**Interfaces:**
- Consumes: `nyDate` from `@tj/core`; `api` and `TradeView` from `apps/web/src/api.ts`.
- Produces:
  - `TradeFilter.limit?: number | null`, where `null` means every trade;
  - `GET /api/trades?all=true`, which returns every trade (`all` accepts only `true`);
  - `useAllTrades()`, a TanStack Query result of `TradeView[]` with query key `["trades", { all: true }]`;
  - `type Book = "live" | "paper"`;
  - `interface TradeFilter { books: readonly Book[]; ticker?: string; from?: string; to?: string; includeExcluded: boolean }`;
  - `filterTrades<T extends { book: string; underlying: string; closedAt: number | null; excluded: boolean }>(trades: readonly T[], filter: TradeFilter): T[]`;
  - in `testing.tsx`: `ny(stamp: string): number`.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/repositories/trades.test.ts`, add inside `describe("trades repository", …)`:

```ts
  it("lists 500 trades by default, and every trade when the limit is null", () => {
    const trades = repo();
    for (let index = 0; index < 501; index++) trades.create({ ...sampleFly, openedAt: 1000 + index });
    expect(trades.list()).toHaveLength(500);
    expect(trades.list({ limit: null })).toHaveLength(501);
  });
```

In `apps/server/src/app.test.ts`, add inside `describe("createApp", …)`:

```ts
  it("lists every trade when asked for all of them, and refuses other values", async () => {
    await post(sampleFly);
    await post(sampleFly);
    const all = await app.request("/api/trades?all=true", { headers: LOCAL });
    expect(all.status).toBe(200);
    expect(await readJson<TradeBody[]>(all)).toHaveLength(2);
    expect((await app.request("/api/trades?all=yes", { headers: LOCAL })).status).toBe(400);
  });
```

Create `apps/web/src/analytics/testing.tsx`:

```tsx
/** Epoch ms for a New York wall-clock time in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);
```

Create `apps/web/src/analytics/data.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterTrades, type TradeFilter, useAllTrades } from "./data.js";
import { ny } from "./testing.js";

const trade = (overrides: Partial<{ book: string; underlying: string; closedAt: number | null; excluded: boolean }>) => ({
  book: "paper",
  underlying: "AA",
  closedAt: ny("2026-09-10 10:00"),
  excluded: false,
  ...overrides,
});
const ALL: TradeFilter = { books: ["live", "paper"], includeExcluded: false };

afterEach(() => vi.unstubAllGlobals());

describe("filterTrades", () => {
  it("keeps the chosen books and ticker", () => {
    const trades = [trade({ book: "live" }), trade({ book: "paper", underlying: "BB" }), trade({ book: "missed" })];
    expect(filterTrades(trades, ALL)).toHaveLength(2);
    expect(filterTrades(trades, { ...ALL, books: ["paper"] }).map((t) => t.underlying)).toEqual(["BB"]);
    expect(filterTrades(trades, { ...ALL, ticker: "BB" })).toHaveLength(1);
  });

  it("drops excluded trades unless asked for them", () => {
    const trades = [trade({}), trade({ excluded: true })];
    expect(filterTrades(trades, ALL)).toHaveLength(1);
    expect(filterTrades(trades, { ...ALL, includeExcluded: true })).toHaveLength(2);
  });

  it("uses the New York close date, inclusive at both ends", () => {
    const late = trade({ closedAt: ny("2026-09-30 23:30") }); // Oct 1 in UTC
    expect(filterTrades([late], { ...ALL, from: "2026-09-01", to: "2026-09-30" })).toHaveLength(1);
    expect(filterTrades([late], { ...ALL, from: "2026-10-01" })).toHaveLength(0);
  });

  it("drops open trades only when a date range is set", () => {
    const open = trade({ closedAt: null });
    expect(filterTrades([open], ALL)).toHaveLength(1);
    expect(filterTrades([open], { ...ALL, to: "2026-12-31" })).toHaveLength(0);
  });
});

describe("useAllTrades", () => {
  it("asks the server for every trade, excluded ones too", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAllTrades(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("all")).toBe("true");
    expect(url.searchParams.get("includeExcluded")).toBe("true");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db/src/repositories/trades.test.ts apps/server/src/app.test.ts apps/web/src/analytics/data.test.tsx`
Expected: FAIL. The repository returns 500 with `limit: null`, `all=yes` answers 200, and `./data.js` does not exist.

- [ ] **Step 3: Implement**

In `packages/db/src/repositories/trades.ts`:

```ts
export interface TradeFilter {
  strategy?: string;
  book?: string;
  underlying?: string;
  includeExcluded?: boolean;
  /** At most this many trades, newest first; 500 when left out, every trade when null. */
  limit?: number | null;
}
```

In `list`, replace `.limit(filter.limit ?? 500)` with:

```ts
        // SQLite reads a negative LIMIT as no limit.
        .limit(filter.limit === null ? -1 : (filter.limit ?? 500))
```

In `apps/server/src/routes/trades.ts`, add to `listQuerySchema`:

```ts
  /** Every trade rather than the newest 500, for pages that aggregate. */
  all: z.enum(["true"]).optional(),
```

and add to the `repo.list({ … })` call in the list handler:

```ts
            limit: query.all === "true" ? null : undefined,
```

Create `apps/web/src/analytics/data.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { nyDate } from "@tj/core";
import { api, type TradeView } from "../api.js";

/** Every trade, excluded ones too, for pages that filter in the browser. The key's "trades" prefix means edits refresh it. */
export function useAllTrades() {
  return useQuery({
    queryKey: ["trades", { all: true }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({ query: { all: "true", includeExcluded: "true" } });
      if (!res.ok) throw new Error(`list trades failed: ${res.status}`);
      return res.json();
    },
  });
}

export type Book = "live" | "paper";

export interface TradeFilter {
  books: readonly Book[];
  ticker?: string;
  /** YYYY-MM-DD, New York close date, inclusive. */
  from?: string;
  to?: string;
  includeExcluded: boolean;
}

/** The trades a filter keeps. A date range applies to the New York close date, so it drops open trades. */
export function filterTrades<T extends { book: string; underlying: string; closedAt: number | null; excluded: boolean }>(
  trades: readonly T[],
  filter: TradeFilter,
): T[] {
  const books: readonly string[] = filter.books;
  return trades.filter((trade) => {
    if (!books.includes(trade.book)) return false;
    if (filter.ticker && trade.underlying !== filter.ticker) return false;
    if (trade.excluded && !filter.includeExcluded) return false;
    if (!filter.from && !filter.to) return true;
    if (trade.closedAt == null) return false;
    const date = nyDate(trade.closedAt);
    return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
  });
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/db/src/repositories/trades.test.ts apps/server/src/app.test.ts apps/web/src/analytics/data.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db/src/repositories/trades.ts packages/db/src/repositories/trades.test.ts apps/server/src/routes/trades.ts apps/server/src/app.test.ts apps/web/src/analytics/data.ts apps/web/src/analytics/data.test.tsx apps/web/src/analytics/testing.tsx
git commit -m "feat: every trade for Analytics, filtered in the browser

The list route returns the newest 500 trades by default; all=true
returns every one, so the numbers never quietly leave trades out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The URL state, date presets and remembered edges

**Files:**
- Create: `apps/web/src/analytics/dates.ts`, `apps/web/src/analytics/search.ts`, `apps/web/src/analytics/edges.ts`
- Test: `apps/web/src/analytics/dates.test.ts`, `apps/web/src/analytics/search.test.ts`, `apps/web/src/analytics/edges.test.ts`

**Interfaces:**
- Consumes: `addDays`, `weekdayOfDate`, `WEEKDAYS` (Task 2); `parseEdges`, `DEFAULT_EDGES`, `EdgeKind` (Task 4); `Book`, `TradeFilter` (Task 7).
- Produces:
  - `dates.ts`: `monthOf(date): string`, `shiftMonth(month, by): string`, `firstDay(month): string`, `lastDay(month): string`, and `monthWeeks(month): string[][]` (the Monday-to-Sunday weeks that touch a month).
  - `search.ts`, Analytics:
    - `interface AnalyticsSearch { tab?: "flies"; from?: string; to?: string; books?: Book; ticker?: string; excluded?: true; creditEdges?: string; contractEdges?: string }`
    - `parseAnalyticsSearch(raw: Record<string, unknown>): AnalyticsSearch`
    - `toFilter(search: AnalyticsSearch): TradeFilter`
    - `applyPatch<S extends object>(prev: S, patch: Partial<S>): S`
    - `DATE_PRESETS` (ids `all`, `this-month`, `last-month`, `last-90`, `this-year`, each with a label) and `type PresetId`
    - `presetRange(preset: PresetId, today: string): { from?: string; to?: string }`
    - `activePreset(range: { from?: string; to?: string }, today: string): PresetId | "custom"`
  - `search.ts`, Dashboard:
    - `type Period = "week" | "month" | "year" | "all"`
    - `interface DashboardSearch { period?: "week" | "year" | "all"; at?: string }`
    - `parseDashboardSearch(raw): DashboardSearch`
    - `periodRange(period, at): { from?: string; to?: string }`
    - `stepPeriod(period, at, step: 1 | -1): string`
    - `periodLabel(period, at): string`
    - `calendarMonth(period, at, today): string`
  - `edges.ts`:
    - `resolveEdges(kind: EdgeKind, fromUrl?: string): number[]`, which takes the URL first, then `localStorage`, then the defaults;
    - `rememberEdges(kind: EdgeKind, edges: readonly number[] | null): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/analytics/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstDay, lastDay, monthOf, monthWeeks, shiftMonth } from "./dates.js";

describe("month helpers", () => {
  it("moves months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-09-27")).toBe("2026-09");
  });

  it("finds the first and last day, leap years included", () => {
    expect(firstDay("2026-09")).toBe("2026-09-01");
    expect(lastDay("2026-02")).toBe("2026-02-28");
    expect(lastDay("2028-02")).toBe("2028-02-29");
  });

  it("lists the Monday-to-Sunday weeks that touch a month", () => {
    const weeks = monthWeeks("2026-09");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toBe("2026-08-31");
    expect(weeks[4]?.[6]).toBe("2026-10-04");
    expect(monthWeeks("2026-02")[0]?.[0]).toBe("2026-01-26");
  });
});
```

Create `apps/web/src/analytics/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type AnalyticsSearch,
  activePreset,
  applyPatch,
  calendarMonth,
  parseAnalyticsSearch,
  parseDashboardSearch,
  periodLabel,
  periodRange,
  presetRange,
  stepPeriod,
  toFilter,
} from "./search.js";

describe("parseAnalyticsSearch", () => {
  it("keeps valid values", () => {
    expect(
      parseAnalyticsSearch({
        tab: "flies",
        from: "2026-07-01",
        to: "2026-09-30",
        books: "paper",
        ticker: "m",
        excluded: true,
        creditEdges: "250,500,1000",
        contractEdges: "2,4,6",
      }),
    ).toEqual({
      tab: "flies",
      from: "2026-07-01",
      to: "2026-09-30",
      books: "paper",
      ticker: "M",
      excluded: true,
      creditEdges: "250,500,1000",
      contractEdges: "2,4,6",
    });
  });

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

  it("accepts the numbers the router's parser makes of plain values", () => {
    expect(parseAnalyticsSearch({ creditEdges: 250, excluded: "true" })).toEqual({ creditEdges: "250", excluded: true });
  });
});

describe("toFilter and applyPatch", () => {
  it("turns the search into a trade filter", () => {
    expect(toFilter({})).toEqual({ books: ["live", "paper"], includeExcluded: false });
    expect(toFilter({ books: "paper", ticker: "M", excluded: true, from: "2026-09-01" })).toEqual({
      books: ["paper"],
      ticker: "M",
      includeExcluded: true,
      from: "2026-09-01",
    });
  });

  it("merges a change and drops keys set to undefined", () => {
    expect(applyPatch<AnalyticsSearch>({ tab: "flies", books: "paper" }, { books: undefined, ticker: "M" })).toEqual({
      tab: "flies",
      ticker: "M",
    });
  });
});

describe("date presets", () => {
  it("works out each preset from today", () => {
    expect(presetRange("all", "2026-09-27")).toEqual({});
    expect(presetRange("this-month", "2026-09-27")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last-90", "2026-09-27")).toEqual({ from: "2026-06-30", to: "2026-09-27" });
    expect(presetRange("this-year", "2026-09-27")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("names the preset a range matches, or custom", () => {
    expect(activePreset({}, "2026-09-27")).toBe("all");
    expect(activePreset({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-27")).toBe("this-month");
    expect(activePreset({ from: "2026-09-02" }, "2026-09-27")).toBe("custom");
  });
});

describe("dashboard periods", () => {
  it("parses only valid periods and dates, leaving month out as the default", () => {
    expect(parseDashboardSearch({ period: "week", at: "2026-09-15" })).toEqual({ period: "week", at: "2026-09-15" });
    expect(parseDashboardSearch({ period: "month", at: "2026-02-30" })).toEqual({});
  });

  it("finds each period's dates", () => {
    expect(periodRange("week", "2026-09-26")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(periodRange("month", "2026-09-26")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("year", "2026-09-26")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("all", "2026-09-26")).toEqual({});
  });

  it("steps a period back and forth", () => {
    expect(stepPeriod("week", "2026-09-26", -1)).toBe("2026-09-19");
    expect(stepPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(stepPeriod("year", "2026-09-26", -1)).toBe("2025-01-01");
  });

  it("names each period", () => {
    expect(periodLabel("week", "2026-09-26")).toBe("Sep 21 – Sep 27, 2026");
    expect(periodLabel("month", "2026-09-26")).toBe("September 2026");
    expect(periodLabel("year", "2026-09-26")).toBe("2026");
    expect(periodLabel("all", "2026-09-26")).toBe("All time");
  });

  it("opens the calendar on today's month when the period includes today, else on its last month", () => {
    expect(calendarMonth("month", "2026-09-15", "2026-09-27")).toBe("2026-09");
    expect(calendarMonth("month", "2026-08-10", "2026-09-27")).toBe("2026-08");
    expect(calendarMonth("year", "2025-03-01", "2026-09-27")).toBe("2025-12");
    expect(calendarMonth("all", "2026-09-27", "2026-09-27")).toBe("2026-09");
  });
});
```

Create `apps/web/src/analytics/edges.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberEdges, resolveEdges } from "./edges.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveEdges", () => {
  it("prefers the URL, then what was remembered, then the defaults", () => {
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
    rememberEdges("usd", [300, 600]);
    expect(resolveEdges("usd")).toEqual([300, 600]);
    expect(resolveEdges("usd", "400,800")).toEqual([400, 800]);
    expect(resolveEdges("usd", "abc")).toEqual([300, 600]);
  });

  it("keeps credit and contract edges apart", () => {
    rememberEdges("contracts", [3, 6]);
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3,6");
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
  });

  it("forgets on reset", () => {
    rememberEdges("usd", [300]);
    rememberEdges("usd", null);
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(resolveEdges("usd")).toEqual([250, 500, 1000]);
    expect(rememberEdges("usd", [300])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/dates.test.ts apps/web/src/analytics/search.test.ts apps/web/src/analytics/edges.test.ts`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/analytics/dates.ts`:

```ts
import { addDays, WEEKDAYS, weekdayOfDate } from "@tj/core";

/** "2026-09-27" → "2026-09". */
export const monthOf = (date: string) => date.slice(0, 7);

/** A YYYY-MM month moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const firstDay = (month: string) => `${month}-01`;
export const lastDay = (month: string) => addDays(firstDay(shiftMonth(month, 1)), -1);

/** The Monday-to-Sunday weeks that touch a month, as YYYY-MM-DD dates. */
export function monthWeeks(month: string): string[][] {
  const first = firstDay(month);
  const end = lastDay(month);
  const weeks: string[][] = [];
  for (let monday = addDays(first, -WEEKDAYS.indexOf(weekdayOfDate(first))); monday <= end; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, day) => addDays(monday, day)));
  }
  return weeks;
}
```

Create `apps/web/src/analytics/search.ts`:

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
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/** The router parses plain values as JSON, so "250" may arrive as a number. */
const text = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

/** A real calendar date: Date.parse would roll 2026-02-30 over to March 2. */
function isDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
}

/** Keeps what's valid and drops the rest, so an old or hand-edited link still opens. */
export function parseAnalyticsSearch(raw: Record<string, unknown>): AnalyticsSearch {
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

export function toFilter(search: AnalyticsSearch): TradeFilter {
  const filter: TradeFilter = {
    books: search.books ? [search.books] : ["live", "paper"],
    includeExcluded: search.excluded === true,
  };
  if (search.ticker) filter.ticker = search.ticker;
  if (search.from) filter.from = search.from;
  if (search.to) filter.to = search.to;
  return filter;
}

/** The search after a change. A key set to undefined is removed, so defaults stay out of the URL. */
export function applyPatch<S extends object>(prev: S, patch: Partial<S>): S {
  return Object.fromEntries(Object.entries({ ...prev, ...patch }).filter(([, value]) => value !== undefined)) as S;
}

export const DATE_PRESETS = [
  { id: "all", label: "All time" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-90", label: "Last 90 days" },
  { id: "this-year", label: "This year" },
] as const;

export type PresetId = (typeof DATE_PRESETS)[number]["id"];

export function presetRange(preset: PresetId, today: string): { from?: string; to?: string } {
  const month = monthOf(today);
  const year = today.slice(0, 4);
  switch (preset) {
    case "this-month":
      return { from: firstDay(month), to: lastDay(month) };
    case "last-month": {
      const previous = shiftMonth(month, -1);
      return { from: firstDay(previous), to: lastDay(previous) };
    }
    case "last-90":
      return { from: addDays(today, -89), to: today };
    case "this-year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    default:
      return {};
  }
}

/** The preset a range matches, or "custom". */
export function activePreset(range: { from?: string; to?: string }, today: string): PresetId | "custom" {
  const match = DATE_PRESETS.find(({ id }) => {
    const preset = presetRange(id, today);
    return preset.from === range.from && preset.to === range.to;
  });
  return match?.id ?? "custom";
}

export type Period = "week" | "month" | "year" | "all";

/** The Dashboard's URL state: month and today are the defaults, left out. */
export interface DashboardSearch {
  period?: "week" | "year" | "all";
  at?: string;
}

export function parseDashboardSearch(raw: Record<string, unknown>): DashboardSearch {
  const search: DashboardSearch = {};
  if (raw.period === "week" || raw.period === "year" || raw.period === "all") search.period = raw.period;
  const at = text(raw.at);
  if (isDate(at)) search.at = at;
  return search;
}

/** The dates a period covers; a week runs Monday to Sunday. */
export function periodRange(period: Period, at: string): { from?: string; to?: string } {
  switch (period) {
    case "week": {
      const monday = addDays(at, -WEEKDAYS.indexOf(weekdayOfDate(at)));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month":
      return { from: firstDay(monthOf(at)), to: lastDay(monthOf(at)) };
    case "year":
      return { from: `${at.slice(0, 4)}-01-01`, to: `${at.slice(0, 4)}-12-31` };
    default:
      return {};
  }
}

/** A date inside the period before or after. */
export function stepPeriod(period: Period, at: string, step: 1 | -1): string {
  switch (period) {
    case "week":
      return addDays(at, 7 * step);
    case "month":
      return firstDay(shiftMonth(monthOf(at), step));
    case "year":
      return `${Number(at.slice(0, 4)) + step}-01-01`;
    default:
      return at;
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function periodLabel(period: Period, at: string): string {
  const { from = at, to = at } = periodRange(period, at);
  switch (period) {
    case "week":
      return `${MONTH_DAY.format(utc(from))} – ${MONTH_DAY.format(utc(to))}, ${to.slice(0, 4)}`;
    case "month":
      return MONTH_YEAR.format(utc(at));
    case "year":
      return at.slice(0, 4);
    default:
      return "All time";
  }
}

/** The month the calendar opens on: today's when the period includes today, else the period's last month. */
export function calendarMonth(period: Period, at: string, today: string): string {
  const { from, to } = periodRange(period, at);
  if (!to || ((!from || from <= today) && today <= to)) return monthOf(today);
  return monthOf(to);
}
```

Create `apps/web/src/analytics/edges.ts`:

```ts
import { DEFAULT_EDGES, type EdgeKind, parseEdges } from "@tj/core";

const KEYS: Record<EdgeKind, string> = { usd: "tj.edges.credit", contracts: "tj.edges.contracts" };

function remembered(kind: EdgeKind): number[] | null {
  try {
    const saved = localStorage.getItem(KEYS[kind]);
    return saved ? parseEdges(saved, kind) : null;
  } catch {
    return null;
  }
}

/** The edges a split uses: the URL's, else the ones remembered in this browser, else the defaults. */
export function resolveEdges(kind: EdgeKind, fromUrl?: string): number[] {
  return (fromUrl ? parseEdges(fromUrl, kind) : null) ?? remembered(kind) ?? [...DEFAULT_EDGES[kind]];
}

/** Remembers edges for this browser, or forgets them with null. False when storage is blocked; the URL still carries them. */
export function rememberEdges(kind: EdgeKind, edges: readonly number[] | null): boolean {
  try {
    if (edges) localStorage.setItem(KEYS[kind], edges.join(","));
    else localStorage.removeItem(KEYS[kind]);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/dates.test.ts apps/web/src/analytics/search.test.ts apps/web/src/analytics/edges.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/dates.ts apps/web/src/analytics/dates.test.ts apps/web/src/analytics/search.ts apps/web/src/analytics/search.test.ts apps/web/src/analytics/edges.ts apps/web/src/analytics/edges.test.ts
git commit -m "feat(web): the Analytics and Dashboard views as URL state, with remembered edges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The equity curve

**Files:**
- Create: `apps/web/src/analytics/equityData.ts`, `apps/web/src/analytics/EquityCurve.tsx`
- Test: `apps/web/src/analytics/equityData.test.ts`, `apps/web/src/analytics/EquityCurve.test.tsx`
- Modify: `apps/web/package.json` (lightweight-charts)

**Interfaces:**
- Consumes: `EquityPoint` (Task 3).
- Produces:
  - `interface ChartPoint { time: number; value: number }`, with `time` in UTC seconds;
  - `equityChartData(points: readonly EquityPoint[]): { equity: ChartPoint[]; drawdown: ChartPoint[] }`;
  - `EquityCurve({ points, height? }: { points: readonly EquityPoint[]; height?: number })`, a React component with `data-testid="equity-curve"`.

- [ ] **Step 1: Add Lightweight Charts**

```bash
pnpm --filter @tj/web add lightweight-charts@^5.2.1
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/analytics/equityData.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { equityChartData } from "./equityData.js";

describe("equityChartData", () => {
  it("starts at $0 one second before the first close", () => {
    const data = equityChartData([{ id: "a", closedAt: 1_000_000, equity: 100, drawdown: 0 }]);
    expect(data.equity).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 100 },
    ]);
    expect(data.drawdown).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 0 },
    ]);
  });

  it("merges closes in the same second into the last one, so times only increase", () => {
    const data = equityChartData([
      { id: "a", closedAt: 1_000_000, equity: 100, drawdown: 0 },
      { id: "b", closedAt: 1_000_400, equity: 60, drawdown: -40 },
      { id: "c", closedAt: 1_002_000, equity: 90, drawdown: -10 },
    ]);
    expect(data.equity).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 60 },
      { time: 1002, value: 90 },
    ]);
    expect(data.drawdown.map((point) => point.value)).toEqual([0, -40, -10]);
  });

  it("is empty without points", () => {
    expect(equityChartData([])).toEqual({ equity: [], drawdown: [] });
  });
});
```

Create `apps/web/src/analytics/EquityCurve.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EquityCurve } from "./EquityCurve.js";

describe("EquityCurve", () => {
  it("says there is nothing to draw without closed trades", () => {
    render(<EquityCurve points={[]} />);
    expect(screen.getByText("No closed trades in this range.")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/equityData.test.ts apps/web/src/analytics/EquityCurve.test.tsx`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 4: Implement**

Create `apps/web/src/analytics/equityData.ts`:

```ts
import type { EquityPoint } from "@tj/core";

export interface ChartPoint {
  /** UTC seconds. */
  time: number;
  value: number;
}

/**
 * Lightweight Charts needs strictly increasing times. Closes in the same second become one point (the last),
 * and a $0 point one second before the first close starts the line.
 */
export function equityChartData(points: readonly EquityPoint[]): { equity: ChartPoint[]; drawdown: ChartPoint[] } {
  const equity: ChartPoint[] = [];
  const drawdown: ChartPoint[] = [];
  const first = points[0];
  if (first) {
    const start = Math.floor(first.closedAt / 1000) - 1;
    equity.push({ time: start, value: 0 });
    drawdown.push({ time: start, value: 0 });
  }
  for (const point of points) {
    const time = Math.floor(point.closedAt / 1000);
    if (equity.at(-1)?.time === time) {
      equity.pop();
      drawdown.pop();
    }
    equity.push({ time, value: point.equity });
    drawdown.push({ time, value: point.drawdown });
  }
  return { equity, drawdown };
}
```

Create `apps/web/src/analytics/EquityCurve.tsx`:

```tsx
import type { EquityPoint } from "@tj/core";
import { BaselineSeries, ColorType, createChart, LineSeries, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { type ChartPoint, equityChartData } from "./equityData.js";

const NY_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const NY_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Lightweight Charts has no timezone option; formatting each time in New York is the documented way. */
const nyText = (format: Intl.DateTimeFormat) => (time: Time) =>
  typeof time === "number" ? format.format(new Date(time * 1000)) : String(time);
const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const series = (points: ChartPoint[]) => points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
const CLEAR = "rgba(0, 0, 0, 0)";

/** Cumulative net P&L with its drawdown in a pane below (spec §9). The canvas can't draw in tests; `equityChartData` is tested instead. */
export function EquityCurve({ points, height = 220 }: { points: readonly EquityPoint[]; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const data = useMemo(() => equityChartData(points), [points]);

  useEffect(() => {
    const element = container.current;
    if (!element || data.equity.length < 2) return;
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#6b7385",
        fontSize: 10,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        panes: { separatorColor: "#1f2430" },
      },
      grid: { vertLines: { color: "#1a1e29" }, horzLines: { color: "#1a1e29" } },
      rightPriceScale: { borderColor: "#1f2430" },
      timeScale: { borderColor: "#1f2430", tickMarkFormatter: nyText(NY_DAY) },
      localization: { timeFormatter: nyText(NY_TIME), priceFormatter: usd },
    });
    chart.addSeries(LineSeries, { color: "#2962ff", lineWidth: 2, priceLineVisible: false }).setData(series(data.equity));
    chart
      .addSeries(
        BaselineSeries,
        {
          baseValue: { type: "price", price: 0 },
          topLineColor: CLEAR,
          topFillColor1: CLEAR,
          topFillColor2: CLEAR,
          bottomLineColor: "#ef5350",
          bottomFillColor1: "rgba(239, 83, 80, 0.05)",
          bottomFillColor2: "rgba(239, 83, 80, 0.4)",
          lineWidth: 1,
          priceLineVisible: false,
        },
        1,
      )
      .setData(series(data.drawdown));
    chart.panes()[1]?.setHeight(Math.round(height * 0.28));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height]);

  if (data.equity.length < 2) return <p className="text-muted">No closed trades in this range.</p>;
  return <div ref={container} style={{ height }} data-testid="equity-curve" />;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/equityData.test.ts apps/web/src/analytics/EquityCurve.test.tsx`
Expected: PASS. If importing `lightweight-charts` itself fails under jsdom, the problem is the library, not this code. In that case delete `EquityCurve.test.tsx`, record that in the execution record, and let the page tests, which mock this module, and the visual check in Task 14 cover the empty state.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/package.json pnpm-lock.yaml apps/web/src/analytics/equityData.ts apps/web/src/analytics/equityData.test.ts apps/web/src/analytics/EquityCurve.tsx apps/web/src/analytics/EquityCurve.test.tsx
git commit -m "feat(web): an equity curve with its drawdown, in New York time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: KPI strip, P&L calendar and split tables

**Files:**
- Create: `apps/web/src/analytics/format.ts`, `apps/web/src/analytics/KpiStrip.tsx`, `apps/web/src/analytics/Section.tsx`, `apps/web/src/analytics/PnlCalendar.tsx`, `apps/web/src/analytics/SplitGrid.tsx`
- Test: `apps/web/src/analytics/format.test.ts`, `apps/web/src/analytics/PnlCalendar.test.tsx`, `apps/web/src/analytics/SplitGrid.test.tsx`

**Interfaces:**
- Consumes: `holidayName`, `WEEKDAYS`, `round2` (core); `SplitRow`, `EdgeKind`, `parseEdges` (Task 4); `monthWeeks`, `monthOf` (Task 8).
- Produces:
  - `format.ts`:
    - `winRateText(value: number | null): string`, e.g. `"66.7%"`
    - `profitFactorText(value: number | null): string`, e.g. `"1.36"`, `"∞"` or `"—"`
    - `shareText(value: number | null): string`, e.g. `"32%"` or `"−10%"`
    - `dollars(value: number): string`, e.g. `"+$410"`, `"−$300"` or `"$0"`
    - `segmentClass(active: boolean): string`
  - `interface Kpi { id: string; label: string; value: ReactNode; sub?: string }` and `KpiStrip({ kpis })`, where each tile has `data-testid="kpi-{id}"`.
  - `Section({ title, right?, children })`: a panel that is also a region named by its title, so tests and screen readers can find each part of a page.
  - `interface CalendarDay { net: number; trades: readonly unknown[] }` and `PnlCalendar({ month, days, selected, onSelect })`:
    - Day buttons are named `"{YYYY-MM-DD}: {dollars}, {n} trades"`.
    - Week totals have `data-testid="week-{monday}"`.
  - `interface EdgeControl { kind: EdgeKind; edges: readonly number[]; onChange: (edges: number[] | null) => void }`
  - `interface SplitPanel { title: string; rows: readonly SplitRow[]; edges?: EdgeControl }`
  - `SplitGrid({ panels, columns? })`:
    - Each panel is a `<section aria-label={title}>`.
    - The edge editor's input is labelled `"{title} edges"`, next to `Save` and `Reset` buttons.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/analytics/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dollars, profitFactorText, shareText, winRateText } from "./format.js";

describe("formatters", () => {
  it("write rates, factors, shares and dollars", () => {
    expect(winRateText(2 / 3)).toBe("66.7%");
    expect(winRateText(null)).toBe("—");
    expect(profitFactorText(750 / 550)).toBe("1.36");
    expect(profitFactorText(Number.POSITIVE_INFINITY)).toBe("∞");
    expect(profitFactorText(null)).toBe("—");
    expect(shareText(0.3875)).toBe("39%");
    expect(shareText(-0.1)).toBe("−10%");
    expect(shareText(null)).toBe("—");
    expect(dollars(410.1)).toBe("+$410");
    expect(dollars(-2324)).toBe("−$2,324");
    expect(dollars(0)).toBe("$0");
  });
});
```

Create `apps/web/src/analytics/PnlCalendar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CalendarDay, PnlCalendar } from "./PnlCalendar.js";

const days = new Map<string, CalendarDay>([
  ["2026-09-01", { net: 410.1, trades: [1] }],
  ["2026-09-04", { net: 269.15, trades: [1, 2] }],
  ["2026-09-10", { net: 42, trades: [1, 2] }],
]);

describe("PnlCalendar", () => {
  it("shows each trading day's net and trade count, with a total per week", () => {
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "2026-09-04: +$269, 2 trades" })).toBeTruthy();
    expect(screen.getByTestId("week-2026-08-31").textContent).toContain("+$679");
    expect(screen.getByTestId("week-2026-09-07").textContent).toContain("+$42");
    expect(screen.getByTestId("week-2026-09-14").textContent).toContain("—");
  });

  it("dims a holiday and names it on hover", () => {
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={() => {}} />);
    expect(screen.getByTitle("Labor Day")).toBeTruthy();
  });

  it("hands back the day that was clicked", () => {
    const onSelect = vi.fn();
    render(<PnlCalendar month="2026-09" days={days} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /^2026-09-10:/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-09-10");
  });

  it("counts a close dated on a weekend in its week's total, so the weeks add up to the month", () => {
    const weekend = new Map<string, CalendarDay>([["2026-09-05", { net: 100, trades: [1] }]]);
    render(<PnlCalendar month="2026-09" days={weekend} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId("week-2026-08-31").textContent).toContain("+$100");
  });
});
```

Create `apps/web/src/analytics/SplitGrid.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitGrid } from "./SplitGrid.js";

const rows = [
  { label: "Wed", trades: 3, winRate: 1, net: 550, profitFactor: Number.POSITIVE_INFINITY },
  { label: "Thu", trades: 2, winRate: 0, net: -400, profitFactor: 0 },
];

describe("SplitGrid", () => {
  it("shows each row's trades and net, with win rate and profit factor on hover", () => {
    render(<SplitGrid panels={[{ title: "Weekday opened", rows }]} />);
    const panel = within(screen.getByRole("region", { name: "Weekday opened" }));
    expect(panel.getByText("+$550")).toBeTruthy();
    expect(panel.getByTitle("Win rate 100.0% · PF ∞")).toBeTruthy();
    expect(panel.getByTitle("Win rate 0.0% · PF 0.00")).toBeTruthy();
  });

  it("says so when a split has no trades", () => {
    render(<SplitGrid panels={[{ title: "Hold time", rows: [] }]} />);
    expect(screen.getByText("No closed trades in this range.")).toBeTruthy();
  });

  it("saves edited edges, refuses bad ones with the rule, and resets", () => {
    const onChange = vi.fn();
    render(
      <SplitGrid panels={[{ title: "Credit", rows, edges: { kind: "usd", edges: [250, 500, 1000], onChange } }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const input = screen.getByLabelText("Credit edges") as HTMLInputElement;
    expect(input.value).toBe("250, 500, 1000");

    fireEvent.change(input, { target: { value: "1,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Use increasing amounts above 0, like 250, 500, 1000.");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "300, 600" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith([300, 600]);

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/analytics/format.test.ts apps/web/src/analytics/PnlCalendar.test.tsx apps/web/src/analytics/SplitGrid.test.tsx`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/analytics/format.ts`:

```ts
export const winRateText = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

export function profitFactorText(value: number | null): string {
  if (value == null) return "—";
  return value === Number.POSITIVE_INFINITY ? "∞" : value.toFixed(2);
}

/** A share such as % kept: 0.32 → "32%", -0.1 → "−10%". */
export const shareText = (value: number | null) =>
  value == null ? "—" : `${value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100))}%`;

/** Whole dollars with the sign spelled out: "+$410", "−$2,324", "$0". */
export function dollars(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** A toggle in a row of toggles, like the Journal's book buttons. */
export const segmentClass = (active: boolean) =>
  `rounded-[2px] border px-2 py-0.5 ${active ? "border-accent bg-[#2962ff1a] text-fg" : "border-line text-muted"}`;
```

Create `apps/web/src/analytics/KpiStrip.tsx`:

```tsx
import type { ReactNode } from "react";

export interface Kpi {
  id: string;
  label: string;
  value: ReactNode;
  sub?: string;
}

export function KpiStrip({ kpis }: { kpis: readonly Kpi[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))` }}>
      {kpis.map((kpi) => (
        <div key={kpi.id} data-testid={`kpi-${kpi.id}`} className="min-w-0 rounded-sm border border-line bg-panel px-2.5 py-1.5">
          <div className="truncate text-[9px] text-muted uppercase tracking-wider">{kpi.label}</div>
          <div className="num mt-0.5 text-[14px]">{kpi.value}</div>
          {kpi.sub && <div className="mt-0.5 truncate text-[9px] text-muted">{kpi.sub}</div>}
        </div>
      ))}
    </div>
  );
}
```

Create `apps/web/src/analytics/Section.tsx`:

```tsx
import type { ReactNode } from "react";

/** A panel that is also a region named by its title, so tests and screen readers can find each part of a page. */
export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-sm border border-line bg-panel p-2.5">
      <header className="mb-1.5 flex items-center justify-between text-[10px] text-muted uppercase tracking-wider">
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}
```

Create `apps/web/src/analytics/PnlCalendar.tsx`:

```tsx
import { holidayName, round2, WEEKDAYS } from "@tj/core";
import { monthOf, monthWeeks } from "./dates.js";
import { dollars } from "./format.js";

export interface CalendarDay {
  net: number;
  trades: readonly unknown[];
}

const tone = (net: number) => (net > 0 ? "text-up" : net < 0 ? "text-down" : "text-muted");

/**
 * One month, Monday to Friday, with a week-total column (spec §6). A week's total covers all seven of its days
 * inside the month, so a close dated on a weekend still counts and the weeks add up to the month.
 */
export function PnlCalendar({
  month,
  days,
  selected,
  onSelect,
}: {
  month: string;
  days: ReadonlyMap<string, CalendarDay>;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.1fr)] gap-1">
      {[...WEEKDAYS.slice(0, 5), "Week"].map((head) => (
        <div key={head} className="text-center text-[9px] text-muted uppercase">
          {head}
        </div>
      ))}
      {monthWeeks(month).flatMap((week) => {
        const inMonth = week.filter((date) => monthOf(date) === month);
        const traded = inMonth.some((date) => days.has(date));
        const total = round2(inMonth.reduce((sum, date) => sum + (days.get(date)?.net ?? 0), 0));
        return [
          ...week.slice(0, 5).map((date) => (
            <DayCell
              key={date}
              date={date}
              inMonth={monthOf(date) === month}
              day={days.get(date)}
              selected={selected === date}
              onSelect={onSelect}
            />
          )),
          <div
            key={`total-${week[0]}`}
            data-testid={`week-${week[0]}`}
            className="rounded-[2px] border border-line bg-panel p-1 text-[10px]"
          >
            <div className="text-[8px] text-muted">total</div>
            <div className={`num ${tone(total)}`}>{traded ? dollars(total) : "—"}</div>
          </div>,
        ];
      })}
    </div>
  );
}

function DayCell({
  date,
  inMonth,
  day,
  selected,
  onSelect,
}: {
  date: string;
  inMonth: boolean;
  day: CalendarDay | undefined;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  if (!inMonth) return <div className="min-h-9 rounded-[2px] border border-line opacity-30" />;
  const holiday = holidayName(date);
  const number = <div className="text-[8px] text-muted">{Number(date.slice(8))}</div>;
  if (!day) {
    return (
      <div
        title={holiday ?? undefined}
        className={`min-h-9 rounded-[2px] border border-line bg-[#0e1118] p-1 text-[10px] ${holiday ? "opacity-40" : ""}`}
      >
        {number}
      </div>
    );
  }
  const fill =
    day.net > 0 ? "border-[#26a69a55] bg-[#26a69a1f]" : day.net < 0 ? "border-[#ef535055] bg-[#ef53501f]" : "border-line";
  return (
    <button
      type="button"
      aria-label={`${date}: ${dollars(day.net)}, ${day.trades.length} trades`}
      aria-pressed={selected}
      onClick={() => onSelect(date)}
      className={`min-h-9 rounded-[2px] border p-1 text-left text-[10px] ${fill} ${selected ? "outline outline-accent" : ""}`}
    >
      {number}
      <div className={`num ${tone(day.net)}`}>{dollars(day.net)}</div>
      <div className="text-[8px] text-muted">{day.trades.length} tr</div>
    </button>
  );
}
```

Create `apps/web/src/analytics/SplitGrid.tsx`:

```tsx
import { type EdgeKind, parseEdges, type SplitRow } from "@tj/core";
import { useState } from "react";
import { dollars, profitFactorText, winRateText } from "./format.js";

export interface EdgeControl {
  kind: EdgeKind;
  edges: readonly number[];
  onChange: (edges: number[] | null) => void;
}

export interface SplitPanel {
  title: string;
  rows: readonly SplitRow[];
  edges?: EdgeControl;
}

/** Every split at once, each a small table with net bars (spec §7.2). */
export function SplitGrid({ panels, columns = 3 }: { panels: readonly SplitPanel[]; columns?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {panels.map((panel) => (
        <SplitTable key={panel.title} panel={panel} />
      ))}
    </div>
  );
}

function SplitTable({ panel }: { panel: SplitPanel }) {
  const widest = Math.max(1, ...panel.rows.map((row) => Math.abs(row.net)));
  return (
    <section aria-label={panel.title} className="min-w-0 rounded-sm border border-line bg-panel p-2">
      <header className="mb-1 flex items-center justify-between gap-2 text-[9px] text-muted uppercase tracking-wider">
        <span>{panel.title}</span>
        {panel.edges && <EdgeEditor title={panel.title} control={panel.edges} />}
      </header>
      {panel.rows.length === 0 ? (
        <p className="text-[10px] text-muted">No closed trades in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {panel.rows.map((row) => (
              <tr
                key={row.label}
                title={`Win rate ${winRateText(row.winRate)} · PF ${profitFactorText(row.profitFactor)}`}
                className="border-line border-t"
              >
                <td className="py-0.5">{row.label}</td>
                <td className="num text-right text-muted">{row.trades}</td>
                <td className="w-36">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className={`num ${row.net > 0 ? "text-up" : row.net < 0 ? "text-down" : "text-muted"}`}>
                      {dollars(row.net)}
                    </span>
                    <span className="flex w-12">
                      <span
                        className={`h-[7px] rounded-[1px] ${row.net >= 0 ? "bg-up" : "bg-down"}`}
                        style={{ width: `${(Math.abs(row.net) / widest) * 100}%` }}
                      />
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const RULES: Record<EdgeKind, string> = {
  usd: "Use increasing amounts above 0, like 250, 500, 1000.",
  contracts: "Use increasing whole numbers from 2, like 2, 4, 6.",
};

function EdgeEditor({ title, control }: { title: string; control: EdgeControl }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setDraft(null);
    setProblem(null);
  };
  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(control.edges.join(", "))} className="text-accent normal-case tracking-normal">
        edit
      </button>
    );
  }
  const save = () => {
    const edges = parseEdges(draft, control.kind);
    if (!edges) {
      setProblem(RULES[control.kind]);
      return;
    }
    control.onChange(edges);
    close();
  };
  return (
    <span className="flex flex-wrap items-center justify-end gap-1 normal-case tracking-normal">
      <input
        aria-label={`${title} edges`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="num w-28 rounded-sm border border-line bg-[#0e1118] px-1 text-[10px] text-fg outline-none focus:border-accent"
      />
      <button type="button" onClick={save} className="text-accent">
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          control.onChange(null);
          close();
        }}
        className="text-muted"
      >
        Reset
      </button>
      {problem && (
        <span role="alert" className="basis-full text-right text-down">
          {problem}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/analytics/format.test.ts apps/web/src/analytics/PnlCalendar.test.tsx apps/web/src/analytics/SplitGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/format.ts apps/web/src/analytics/format.test.ts apps/web/src/analytics/KpiStrip.tsx apps/web/src/analytics/Section.tsx apps/web/src/analytics/PnlCalendar.tsx apps/web/src/analytics/PnlCalendar.test.tsx apps/web/src/analytics/SplitGrid.tsx apps/web/src/analytics/SplitGrid.test.tsx
git commit -m "feat(web): a KPI strip, a P&L calendar and split tables with editable edges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Dashboard

**Files:**
- Create: `apps/web/src/routes/Dashboard.tsx`
- Modify: `apps/web/src/router.tsx` (`dashboardRoute`)
- Modify: `apps/web/src/analytics/testing.tsx` (row builder, fetch stub, render helper)
- Test: `apps/web/src/routes/Dashboard.test.tsx`

**Interfaces:**
- Consumes:
  - `closedTrades`, `summarize`, `equityCurve`, `dailyPnl`, `closeEstimate`, `OptionQuote` (core);
  - `useAllTrades`, `filterTrades` (Task 7);
  - `DashboardSearch`, `Period`, `periodRange`, `stepPeriod`, `periodLabel`, `calendarMonth`, `shiftMonth` (Task 8);
  - `EquityCurve` (Task 9);
  - `KpiStrip`, `Section`, `PnlCalendar`, `winRateText`, `profitFactorText`, `segmentClass` (Task 10);
  - `EstimatedPnl` (`components/Estimate.tsx`), `Money` (`components/ui.tsx`);
  - `isOpen`, `openContracts`, `todayNy`, `useOptionQuotes` (`market.ts`).
- Produces:
  - `Dashboard({ search, onSearch, onOpenTrade }: { search: DashboardSearch; onSearch: (next: DashboardSearch) => void; onOpenTrade?: (id: string) => void })`
  - in `testing.tsx`:
    - `tradeRow(spec: RowSpec)`: an object shaped like a `GET /api/trades` row;
    - `stubTrades(trades: unknown[])`, which returns the fetch mock;
    - `renderWithClient(ui: ReactNode)`.

- [ ] **Step 1: Extend the test helpers**

Replace `apps/web/src/analytics/testing.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

/** Epoch ms for a New York wall-clock time in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);

interface RowSpec {
  id: string;
  underlying: string;
  opened: string;
  /** Null for an open trade. */
  closed: string | null;
  netPnl: number | null;
  fees?: number;
  book?: "live" | "paper";
  excluded?: boolean;
  expiry?: string;
  contracts?: number;
  creditPerShare?: number;
  strategy?: "iron_fly" | "scalp";
}

/** A trade as GET /api/trades returns it: a balanced 9 / 10 / 11 fly unless the strategy says scalp. */
export function tradeRow(spec: RowSpec) {
  const fly = spec.strategy !== "scalp";
  const contracts = spec.contracts ?? 1;
  return {
    id: spec.id,
    strategy: fly ? "iron_fly" : "scalp",
    book: spec.book ?? "paper",
    underlying: spec.underlying,
    underlyingName: null,
    structureLabel: fly ? "Short Iron Butterfly" : null,
    openedAt: ny(spec.opened),
    closedAt: spec.closed ? ny(spec.closed) : null,
    netPnl: spec.netPnl,
    fees: spec.fees ?? 4,
    feesOpen: null,
    feesClose: null,
    notes: null,
    grade: null,
    excluded: spec.excluded ?? false,
    excludeReason: null,
    tagIds: [],
    legs: [
      {
        id: `${spec.id}-l1`,
        right: "C",
        strike: 10,
        expiry: spec.expiry ?? "2026-09-04",
        quantity: fly ? -contracts : contracts,
        multiplier: 100,
        openPrice: 1,
        closePrice: spec.closed ? 0.5 : null,
      },
    ],
    ironFly: fly
      ? {
          bodyPutStrike: 10,
          bodyCallStrike: 10,
          putWingStrike: 9,
          callWingStrike: 11,
          contracts,
          creditPerShare: spec.creditPerShare ?? 2.04,
          netCost: null,
          earningsDate: null,
          earningsTiming: null,
          impliedMovePct: null,
          actualMovePct: null,
          ivBefore: null,
          ivAfter: null,
          sourceNotes: null,
        }
      : null,
    metrics: null,
  };
}

/** Answers the trade list with `trades`, and option quotes with none (a key is set up). */
export function stubTrades(trades: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const body = String(input).includes("/api/option-quotes") ? { quotes: {}, available: true } : trades;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/routes/Dashboard.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { Dashboard } from "./Dashboard.js";

// The canvas chart can't draw in jsdom; this stand-in shows the data the page hands it.
vi.mock("../analytics/EquityCurve.js", () => ({
  EquityCurve: ({ points }: { points: { equity: number }[] }) => (
    <div data-testid="equity-curve">
      {points.length} points, ends {points.at(-1)?.equity ?? "—"}
    </div>
  ),
}));

/*
 * September 2026: AA +100 (Sep 3), BB −40 (Sep 4), CC +200 (Sep 8) → net +260, 2 of 3 won, PF 300 / 40 = 7.50,
 * expectancy +86.67, equity 100, 60, 260, so max drawdown −40. DD +50 closed in August. XX is excluded.
 * EE is open, and its legs expired on Sep 25.
 */
const TRADES = [
  tradeRow({ id: "a", underlying: "AA", opened: "2026-09-02 15:45", closed: "2026-09-03 09:50", netPnl: 100 }),
  tradeRow({ id: "b", underlying: "BB", opened: "2026-09-03 15:50", closed: "2026-09-04 15:40", netPnl: -40 }),
  tradeRow({ id: "c", underlying: "CC", opened: "2026-09-04 15:30", closed: "2026-09-08 09:45", netPnl: 200 }),
  tradeRow({ id: "d", underlying: "DD", opened: "2026-08-19 15:50", closed: "2026-08-20 09:50", netPnl: 50 }),
  tradeRow({ id: "x", underlying: "XX", opened: "2026-09-09 15:50", closed: "2026-09-10 09:50", netPnl: 999, excluded: true }),
  tradeRow({ id: "e", underlying: "EE", opened: "2026-09-23 15:50", closed: null, netPnl: null, expiry: "2026-09-25" }),
];

afterEach(() => vi.unstubAllGlobals());

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

describe("Dashboard", () => {
  it("shows the month's numbers from the trades closed in it, excluded ones left out", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(kpi("win-rate")).toContain("66.7%");
    expect(kpi("profit-factor")).toContain("7.50");
    expect(kpi("expectancy")).toContain("+$86.67");
    expect(kpi("trades")).toContain("3");
    expect(kpi("max-drawdown")).toContain("-$40.00");
    expect(screen.getByTestId("equity-curve").textContent).toBe("3 points, ends 260");
  });

  it("switches and steps the period", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={onSearch} />);
    await waitFor(() => expect(screen.getByText("September 2026")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(onSearch).toHaveBeenLastCalledWith({ period: "year", at: "2026-09-15" });
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
    expect(onSearch).toHaveBeenLastCalledWith({ at: "2026-08-01" });
    rerender(<Dashboard search={{ at: "2026-08-01" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("+$50.00"));
  });

  it("lists a calendar day's trades, each opening its trade page", async () => {
    stubTrades(TRADES);
    const onOpenTrade = vi.fn();
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} onOpenTrade={onOpenTrade} />);
    fireEvent.click(await screen.findByRole("button", { name: /^2026-09-03:/ }));
    const list = within(screen.getByRole("list", { name: "Trades closed 2026-09-03" }));
    fireEvent.click(list.getByRole("button", { name: "AA" }));
    expect(onOpenTrade).toHaveBeenCalledWith("a");
  });

  it("shows every open trade, flagging one past its expiry", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    const open = within(await screen.findByRole("region", { name: "Open" }));
    await waitFor(() => expect(open.getByText("EXPIRED · add exits")).toBeTruthy());
    expect(open.getByText("EE")).toBeTruthy();
  });

  it("says when the period has nothing closed", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-06-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("trades")).toContain("0"));
    expect(kpi("net")).toContain("—");
    expect(within(screen.getByRole("region", { name: "Recent" })).getByText("No closed trades in this range.")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Dashboard.test.tsx`
Expected: FAIL, because `./Dashboard.js` does not exist.

- [ ] **Step 4: Implement**

Create `apps/web/src/routes/Dashboard.tsx`:

```tsx
import { type ClosedTrade, closedTrades, closeEstimate, dailyPnl, equityCurve, type OptionQuote, summarize } from "@tj/core";
import { useState } from "react";
import { filterTrades, useAllTrades } from "../analytics/data.js";
import { shiftMonth } from "../analytics/dates.js";
import { EquityCurve } from "../analytics/EquityCurve.js";
import { profitFactorText, segmentClass, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { PnlCalendar } from "../analytics/PnlCalendar.js";
import {
  calendarMonth,
  type DashboardSearch,
  type Period,
  periodLabel,
  periodRange,
  stepPeriod,
} from "../analytics/search.js";
import { Section } from "../analytics/Section.js";
import { EstimatedPnl } from "../components/Estimate.js";
import { Money } from "../components/ui.js";
import { isOpen, openContracts, todayNy, useOptionQuotes } from "../market.js";

const PERIODS: { id: Period; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "all", label: "All" },
];
const BOTH_BOOKS = ["live", "paper"] as const;
const NO_QUOTES = new Map<string, OptionQuote>();
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const MONTH_TITLE = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export interface DashboardProps {
  search: DashboardSearch;
  onSearch: (next: DashboardSearch) => void;
  onOpenTrade?: (id: string) => void;
}

/** The current period at a glance (spec §6). Excluded trades never count here. */
export function Dashboard({ search, onSearch, onOpenTrade }: DashboardProps) {
  const today = todayNy();
  const period: Period = search.period ?? "month";
  const at = search.at ?? today;
  const { data, isLoading, error } = useAllTrades();
  const counted = filterTrades(data ?? [], { books: BOTH_BOOKS, includeExcluded: false });
  const inPeriod = closedTrades(
    filterTrades(counted, { books: BOTH_BOOKS, includeExcluded: false, ...periodRange(period, at) }),
  );
  const summary = summarize(inPeriod);
  const days = dailyPnl(closedTrades(counted));
  const open = counted.filter(isOpen);
  const { data: optionQuotes } = useOptionQuotes(open.flatMap((trade) => openContracts(trade, today)));

  // The calendar steps on its own, and starts over whenever the period changes.
  const key = `${period}|${at}`;
  const [calendar, setCalendar] = useState({ key, month: calendarMonth(period, at, today) });
  const month = calendar.key === key ? calendar.month : calendarMonth(period, at, today);
  const [selected, setSelected] = useState<string | null>(null);

  // Month and today are defaults, so they stay out of the URL.
  const go = (next: { period?: Period; at?: string }) => {
    const nextPeriod = next.period ?? period;
    const nextAt = next.at ?? at;
    onSearch({
      ...(nextPeriod === "month" ? {} : { period: nextPeriod }),
      ...(nextAt === today ? {} : { at: nextAt }),
    });
  };

  if (isLoading) return <p className="text-muted">Loading…</p>;
  if (error) return <p className="text-down">Could not load trades: {String(error)}</p>;
  const none = summary.trades === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 text-[11px]">
        {PERIODS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={period === option.id}
            onClick={() => go({ period: option.id })}
            className={segmentClass(period === option.id)}
          >
            {option.label}
          </button>
        ))}
        {period !== "all" && (
          <>
            <button type="button" aria-label="Previous period" onClick={() => go({ at: stepPeriod(period, at, -1) })} className="ml-3 px-1 text-muted hover:text-fg">
              ‹
            </button>
            <span className="num text-fg">{periodLabel(period, at)}</span>
            <button type="button" aria-label="Next period" onClick={() => go({ at: stepPeriod(period, at, 1) })} className="px-1 text-muted hover:text-fg">
              ›
            </button>
          </>
        )}
      </div>

      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          { id: "expectancy", label: "Expectancy", value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} /> },
          { id: "trades", label: "Trades", value: summary.trades },
          { id: "max-drawdown", label: "Max drawdown", value: none ? "—" : <Money value={summary.maxDrawdown} /> },
        ]}
      />

      <Section title={`Equity · ${periodLabel(period, at)}`}>
        <EquityCurve points={equityCurve(inPeriod)} />
      </Section>

      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Section
          title={`Calendar · ${MONTH_TITLE.format(new Date(`${month}-01T00:00:00Z`))}`}
          right={
            <span className="flex gap-2">
              <button type="button" aria-label="Previous month" onClick={() => setCalendar({ key, month: shiftMonth(month, -1) })}>
                ‹
              </button>
              <button type="button" aria-label="Next month" onClick={() => setCalendar({ key, month: shiftMonth(month, 1) })}>
                ›
              </button>
            </span>
          }
        >
          <PnlCalendar
            month={month}
            days={days}
            selected={selected}
            onSelect={(date) => setSelected((current) => (current === date ? null : date))}
          />
          {selected && <DayTrades date={selected} trades={days.get(selected)?.trades ?? []} onOpenTrade={onOpenTrade} />}
        </Section>

        <div className="flex flex-col gap-3">
          <Section title="Open">
            {open.length === 0 ? (
              <p className="text-muted">No open trades.</p>
            ) : (
              <ul className="flex flex-col">
                {open.map((trade) => (
                  <li key={trade.id} className="flex items-center justify-between border-line border-t py-1">
                    <button type="button" onClick={() => onOpenTrade?.(trade.id)} className="text-fg hover:text-accent">
                      {trade.underlying}
                    </button>
                    <span className="text-muted">opened {ET_DAY.format(new Date(trade.openedAt))}</span>
                    <EstimatedPnl
                      estimate={closeEstimate(trade, optionQuotes?.quotes ?? NO_QUOTES, today)}
                      explain={optionQuotes?.available === true}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Recent">
            {none ? (
              <p className="text-muted">No closed trades in this range.</p>
            ) : (
              <TradeList trades={inPeriod.slice(-5).reverse()} onOpenTrade={onOpenTrade} />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function TradeList({
  trades,
  label,
  onOpenTrade,
}: {
  trades: readonly ClosedTrade[];
  label?: string;
  onOpenTrade?: (id: string) => void;
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {trades.map((trade) => (
        <li key={trade.id} className="flex items-center justify-between border-line border-t py-1">
          <span className="num text-muted">{ET_DAY.format(new Date(trade.closedAt))}</span>
          <button type="button" onClick={() => onOpenTrade?.(trade.id)} className="text-fg hover:text-accent">
            {trade.underlying}
          </button>
          <Money value={trade.netPnl} />
        </li>
      ))}
    </ul>
  );
}

function DayTrades({
  date,
  trades,
  onOpenTrade,
}: {
  date: string;
  trades: readonly ClosedTrade[];
  onOpenTrade?: (id: string) => void;
}) {
  return (
    <div className="mt-2">
      <TradeList trades={trades} label={`Trades closed ${date}`} onOpenTrade={onOpenTrade} />
    </div>
  );
}
```

In `apps/web/src/router.tsx`, add `import { Dashboard } from "./routes/Dashboard.js";` and `import { parseDashboardSearch } from "./analytics/search.js";`, then replace `dashboardRoute` with:

```tsx
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: parseDashboardSearch,
  component: function DashboardRoute() {
    const search = dashboardRoute.useSearch();
    return (
      <Dashboard
        search={search}
        onSearch={(next) => router.navigate({ to: "/", search: next })}
        onOpenTrade={openTrade}
      />
    );
  },
});
```

If `Panel` is no longer used in `router.tsx` after this change, leave its import: the `notFoundComponent` still uses it.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/routes/Dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/routes/Dashboard.tsx apps/web/src/routes/Dashboard.test.tsx apps/web/src/analytics/testing.tsx apps/web/src/router.tsx
git commit -m "feat(web): a Dashboard for the current period

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Analytics page and its Overview tab

**Files:**
- Create: `apps/web/src/analytics/Charts.tsx`, `apps/web/src/routes/Analytics.tsx`, `apps/web/src/routes/OverviewTab.tsx`, `apps/web/src/routes/AnalyticsRoute.tsx`
- Modify: `apps/web/src/router.tsx` (drop the Analytics placeholder, add a lazy route), `apps/web/package.json` (recharts, react-is)
- Test: `apps/web/src/routes/Analytics.test.tsx`

**Interfaces:**
- Consumes:
  - `closedTrades`, `summarize`, `equityCurve`, `monthlyPnl`, `rollingExpectancy`, `largestLosses`, `pctKept`, `round2`, `monthLabel`, `MonthResult`, `RollingPoint`, and the six general splits (core);
  - `useAllTrades`, `filterTrades` (Task 7);
  - `AnalyticsSearch`, `toFilter`, `applyPatch`, `DATE_PRESETS`, `PresetId`, `presetRange`, `activePreset`, `resolveEdges`, `rememberEdges` (Task 8);
  - `EquityCurve` (Task 9);
  - `KpiStrip`, `Section`, `SplitGrid`, formatters, `segmentClass` (Task 10);
  - `tradeRow`, `stubTrades`, `renderWithClient` (Task 11).
- Produces:
  - `Analytics({ search, onSearch, onOpenTrade }: { search: AnalyticsSearch; onSearch: (patch: Partial<AnalyticsSearch>) => void; onOpenTrade?: (id: string) => void })`
  - `interface TabProps { trades: readonly TradeView[]; search: AnalyticsSearch; onSearch: (patch: Partial<AnalyticsSearch>) => void; onOpenTrade?: (id: string) => void }`
  - `OverviewTab(props: TabProps)`
  - `MonthBars({ months })` and `RollingLine({ points })` (Recharts)
  - `AnalyticsRoute()`, the lazy route component
  - Filter controls:
    - `Dates` select, plus `From` and `To` date inputs for a custom range;
    - `Live` and `Paper` toggle buttons;
    - `Ticker` select;
    - `Include excluded` checkbox.
  - Tabs: an `Overview` button (the `Iron flies` button arrives in Task 13).

- [ ] **Step 1: Add Recharts**

```bash
pnpm --filter @tj/web add recharts@^3.10.1 react-is@^19.3.0
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/routes/Analytics.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presetRange } from "../analytics/search.js";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { todayNy } from "../market.js";
import { Analytics } from "./Analytics.js";

// Charts can't draw in jsdom; these stand-ins show the data the page hands them.
vi.mock("../analytics/EquityCurve.js", () => ({
  EquityCurve: ({ points }: { points: { equity: number }[] }) => (
    <div data-testid="equity-curve">
      {points.length} points, ends {points.at(-1)?.equity ?? "—"}
    </div>
  ),
}));
vi.mock("../analytics/Charts.js", () => ({
  MonthBars: ({ months }: { months: { month: string; net: number }[] }) => (
    <div data-testid="month-bars">{months.map((month) => `${month.month} ${month.net}`).join("; ")}</div>
  ),
  RollingLine: ({ points }: { points: unknown[] }) => <div data-testid="rolling-line">{points.length}</div>,
}));

/*
 * AA +100 (paper, fees 4), BB −300 (paper, fees 6), CC +280 (live, fees 2): net +80, 2 of 3 won, PF 380 / 300 = 1.27.
 * XX +999 is excluded.
 */
const TRADES = [
  tradeRow({ id: "a", underlying: "AA", opened: "2026-09-02 15:45", closed: "2026-09-03 09:50", netPnl: 100, fees: 4 }),
  tradeRow({ id: "b", underlying: "BB", opened: "2026-09-03 15:50", closed: "2026-09-04 15:40", netPnl: -300, fees: 6, contracts: 2, creditPerShare: 1.53 }),
  tradeRow({ id: "c", underlying: "CC", opened: "2026-09-04 15:30", closed: "2026-09-08 09:45", netPnl: 280, fees: 2, contracts: 3, creditPerShare: 1.34, book: "live" }),
  tradeRow({ id: "x", underlying: "XX", opened: "2026-09-09 15:50", closed: "2026-09-10 09:50", netPnl: 999, excluded: true }),
];

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Analytics filters", () => {
  it("shows the headline numbers for the trades the filter keeps", async () => {
    stubTrades(TRADES);
    renderWithClient(<Analytics search={{}} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$80.00"));
    expect(kpi("win-rate")).toContain("66.7%");
    expect(kpi("profit-factor")).toContain("1.27");
    expect(kpi("trades")).toContain("3");
  });

  it("narrows to one book when the other is switched off", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Live" }));
    expect(onSearch).toHaveBeenCalledWith({ books: "paper" });
    rerender(<Analytics search={{ books: "paper" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("-$200.00"));
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("includes excluded trades when asked", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByLabelText("Include excluded"));
    expect(onSearch).toHaveBeenCalledWith({ excluded: true });
    rerender(<Analytics search={{ excluded: true }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("trades")).toContain("4"));
  });

  it("picks a date preset, and shows a custom range in date fields", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.change(await screen.findByLabelText("Dates"), { target: { value: "last-month" } });
    expect(onSearch).toHaveBeenCalledWith(presetRange("last-month", todayNy()));
    rerender(<Analytics search={{ from: "2026-09-04", to: "2026-09-08" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("-$20.00"));
    expect((screen.getByLabelText("Dates") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-09-04");
  });

  it("filters to one ticker", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.change(await screen.findByLabelText("Ticker"), { target: { value: "CC" } });
    expect(onSearch).toHaveBeenCalledWith({ ticker: "CC" });
  });
});

describe("Analytics Overview", () => {
  it("shows where the money goes, with the largest losses", async () => {
    stubTrades(TRADES);
    const onOpenTrade = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={() => {}} onOpenTrade={onOpenTrade} />);
    const money = within(await screen.findByRole("region", { name: "Where the money goes" }));
    expect(money.getByText("Before fees").nextSibling?.nextSibling?.textContent).toBe("+$92.00");
    expect(money.getByText("Fees").nextSibling?.nextSibling?.textContent).toBe("-$12.00");
    fireEvent.click(money.getByRole("button", { name: "BB" }));
    expect(onOpenTrade).toHaveBeenCalledWith("b");
    expect(money.getByText("kept −100%")).toBeTruthy();
  });

  it("hands the charts their data", async () => {
    stubTrades(TRADES);
    renderWithClient(<Analytics search={{}} onSearch={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("equity-curve").textContent).toBe("3 points, ends 80"));
    expect(screen.getByTestId("month-bars").textContent).toBe("2026-09 80");
    expect(screen.getByText("Needs 10 trades.")).toBeTruthy();
  });

  it("shows every split, and saves new contract edges to the URL and this browser", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    for (const title of ["Weekday opened", "Days to expiry", "Contracts", "Hold time", "Month", "Ticker"]) {
      expect(await screen.findByRole("region", { name: title })).toBeTruthy();
    }
    const contracts = within(screen.getByRole("region", { name: "Contracts" }));
    fireEvent.click(contracts.getByRole("button", { name: "edit" }));
    fireEvent.change(contracts.getByLabelText("Contracts edges"), { target: { value: "3" } });
    fireEvent.click(contracts.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ contractEdges: "3" });
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3");
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Analytics.test.tsx`
Expected: FAIL, because `./Analytics.js` does not exist.

- [ ] **Step 4: Implement the charts**

Create `apps/web/src/analytics/Charts.tsx`:

```tsx
import { type MonthResult, monthLabel, type RollingPoint } from "@tj/core";
import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dollars } from "./format.js";

export const UP = "#26a69a";
export const DOWN = "#ef5350";
const LINE = "#2a2e39";
export const TICK = { fill: "#6b7385", fontSize: 9, fontFamily: "JetBrains Mono, ui-monospace, monospace" };
export const TOOLTIP = {
  contentStyle: { background: "#1c2030", border: `1px solid ${LINE}`, borderRadius: 3, fontSize: 10, color: "#d1d4dc" },
  cursor: { fill: "#ffffff08" },
};
const NY_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Net P&L per close month, labelled with the trade count. */
export function MonthBars({ months }: { months: readonly MonthResult[] }) {
  if (months.length === 0) return <p className="text-muted">No closed trades in this range.</p>;
  const data = months.map((month) => ({ label: `${monthLabel(month.month)} · ${month.trades}`, net: month.net }));
  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis hide />
        <ReferenceLine y={0} stroke={LINE} />
        <Tooltip {...TOOLTIP} formatter={(value) => dollars(Number(value))} />
        <Bar dataKey="net" isAnimationActive={false}>
          {data.map((month) => (
            <Cell key={month.label} fill={month.net >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Expectancy over the last 10 trades, with its current value. */
export function RollingLine({ points }: { points: readonly RollingPoint[] }) {
  const data = points.map((point) => ({ label: NY_DAY.format(new Date(point.closedAt)), value: point.value }));
  const last = data.at(-1);
  return (
    <div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <ReferenceLine y={0} stroke={LINE} strokeDasharray="3 3" />
          <Tooltip {...TOOLTIP} formatter={(value) => `${dollars(Number(value))} per trade`} />
          <Line dataKey="value" stroke="#8a91a3" strokeWidth={1.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {last && (
        <p className={`num text-right text-[10px] ${last.value >= 0 ? "text-up" : "text-down"}`}>
          {dollars(last.value)} per trade now
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement the page and the Overview tab**

Create `apps/web/src/routes/OverviewTab.tsx`:

```tsx
import {
  type ClosedTrade,
  closedTrades,
  contractsSplit,
  dteSplit,
  equityCurve,
  holdSplit,
  largestLosses,
  monthlyPnl,
  monthSplit,
  pctKept,
  rollingExpectancy,
  round2,
  type Summary,
  summarize,
  tickerSplit,
  weekdaySplit,
} from "@tj/core";
import type { TradeView } from "../api.js";
import { MonthBars, RollingLine } from "../analytics/Charts.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { EquityCurve } from "../analytics/EquityCurve.js";
import { profitFactorText, shareText, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import type { AnalyticsSearch } from "../analytics/search.js";
import { Section } from "../analytics/Section.js";
import { SplitGrid } from "../analytics/SplitGrid.js";
import { Money } from "../components/ui.js";

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

export interface TabProps {
  trades: readonly TradeView[];
  search: AnalyticsSearch;
  onSearch: (patch: Partial<AnalyticsSearch>) => void;
  onOpenTrade?: (id: string) => void;
}

/** Where the money goes, how it's trending, and what works (spec §7.2). */
export function OverviewTab({ trades, search, onSearch, onOpenTrade }: TabProps) {
  const closed = closedTrades(trades);
  const summary = summarize(closed);
  const none = summary.trades === 0;
  const rolling = rollingExpectancy(closed);
  const contractEdges = resolveEdges("contracts", search.contractEdges);

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          { id: "expectancy", label: "Expectancy", value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} /> },
          {
            id: "avg-win-loss",
            label: "Avg win / loss",
            value: (
              <>
                <Money value={summary.avgWin} /> <span className="text-muted">/</span> <Money value={summary.avgLoss} />
              </>
            ),
          },
          { id: "trades", label: "Trades", value: summary.trades },
          { id: "max-drawdown", label: "Max drawdown", value: none ? "—" : <Money value={summary.maxDrawdown} /> },
        ]}
      />
      <Section title="Equity">
        <EquityCurve points={equityCurve(closed)} />
      </Section>
      <div className="grid gap-3 lg:grid-cols-2">
        <MoneyPanel summary={summary} closed={closed} onOpenTrade={onOpenTrade} />
        <Section title="Trend">
          <MonthBars months={monthlyPnl(closed)} />
          <div className="mt-2 text-[9px] text-muted uppercase tracking-wider">Expectancy, rolling 10 trades</div>
          {rolling.length > 0 ? <RollingLine points={rolling} /> : <p className="text-muted">Needs 10 trades.</p>}
        </Section>
      </div>
      <SplitGrid
        panels={[
          { title: "Weekday opened", rows: weekdaySplit(closed) },
          { title: "Days to expiry", rows: dteSplit(closed) },
          {
            title: "Contracts",
            rows: contractsSplit(closed, contractEdges),
            edges: {
              kind: "contracts",
              edges: contractEdges,
              onChange: (edges) => {
                rememberEdges("contracts", edges);
                onSearch({ contractEdges: edges ? edges.join(",") : undefined });
              },
            },
          },
          { title: "Hold time", rows: holdSplit(closed) },
          { title: "Month", rows: monthSplit(closed) },
          { title: "Ticker", rows: tickerSplit(closed) },
        ]}
      />
    </div>
  );
}

function MoneyRow({ label, value, scale, count }: { label: string; value: number; scale: number; count?: number }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="flex">
        <span
          className={`h-[7px] rounded-[1px] ${value >= 0 ? "bg-up" : "bg-down"}`}
          style={{ width: `${(Math.abs(value) / scale) * 100}%` }}
        />
      </span>
      <span className="text-right">
        <Money value={value} />
        {count != null && <span className="ml-1 text-muted">{count} tr</span>}
      </span>
    </>
  );
}

function MoneyPanel({
  summary,
  closed,
  onOpenTrade,
}: {
  summary: Summary;
  closed: readonly ClosedTrade[];
  onOpenTrade?: (id: string) => void;
}) {
  const losers = largestLosses(closed);
  const lost = round2(losers.reduce((sum, trade) => sum + trade.netPnl, 0));
  const scale = Math.max(1, Math.abs(summary.beforeFees), summary.fees, Math.abs(summary.net), summary.grossWins, Math.abs(summary.grossLosses));
  return (
    <Section title="Where the money goes">
      <div className="num grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-[11px]">
        <MoneyRow label="Before fees" value={summary.beforeFees} scale={scale} />
        <MoneyRow label="Fees" value={-summary.fees} scale={scale} />
        <MoneyRow label="Net" value={summary.net} scale={scale} />
        <MoneyRow label="Won" value={summary.grossWins} scale={scale} count={summary.wins} />
        <MoneyRow label="Lost" value={summary.grossLosses} scale={scale} count={summary.losses} />
      </div>
      {losers.length > 0 && (
        <>
          <div className="mt-3 mb-1 text-[9px] text-muted uppercase tracking-wider">Largest losses</div>
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {losers.map((trade) => {
                const kept = pctKept(trade);
                return (
                  <tr key={trade.id} className="border-line border-t">
                    <td className="num py-0.5 text-muted">{ET_DAY.format(new Date(trade.closedAt))}</td>
                    <td>
                      <button type="button" onClick={() => onOpenTrade?.(trade.id)} className="text-fg hover:text-accent">
                        {trade.underlying}
                      </button>
                    </td>
                    <td className="text-right">
                      <Money value={trade.netPnl} />
                    </td>
                    <td className="num text-right text-muted">{kept == null ? "" : `kept ${shareText(kept)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {summary.net < 0 && (
            <p className="mt-1 text-[10px] text-muted">
              The {losers.length} largest losses are {(lost / summary.net).toFixed(1)}× the whole net loss.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
```

Create `apps/web/src/routes/Analytics.tsx`:

```tsx
import { useMemo, useState } from "react";
import { filterTrades, useAllTrades } from "../analytics/data.js";
import { segmentClass } from "../analytics/format.js";
import {
  type AnalyticsSearch,
  activePreset,
  DATE_PRESETS,
  presetRange,
  toFilter,
} from "../analytics/search.js";
import { todayNy } from "../market.js";
import { OverviewTab } from "./OverviewTab.js";

export interface AnalyticsProps {
  search: AnalyticsSearch;
  onSearch: (patch: Partial<AnalyticsSearch>) => void;
  onOpenTrade?: (id: string) => void;
}

const INPUT = "num rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-[11px] text-fg outline-none focus:border-accent";

/** Aggregated statistics over the filtered trades (spec §7). */
export function Analytics({ search, onSearch, onOpenTrade }: AnalyticsProps) {
  const { data, isLoading, error } = useAllTrades();
  const trades = useMemo(() => filterTrades(data ?? [], toFilter(search)), [data, search]);
  const tickers = useMemo(() => [...new Set((data ?? []).map((trade) => trade.underlying))].sort(), [data]);

  if (isLoading) return <p className="text-muted">Loading…</p>;
  if (error) return <p className="text-down">Could not load trades: {String(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      <FilterRow search={search} onSearch={onSearch} tickers={tickers} />
      <nav aria-label="Analytics tabs" className="flex gap-4 border-line border-b text-[12px]">
        <TabButton active onClick={() => onSearch({ tab: undefined })}>
          Overview
        </TabButton>
      </nav>
      <OverviewTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />
    </div>
  );
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-0.5 py-1 ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

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

  // One book must stay on: switching off the other leaves just this one, and the last one can't be switched off.
  const toggleBook = (book: "live" | "paper") => {
    if (books.length === 1) {
      if (books[0] !== book) onSearch({ books: undefined });
      return;
    }
    onSearch({ books: book === "live" ? "paper" : "live" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <label className="flex items-center gap-1 text-muted uppercase tracking-wider">
        Dates
        <select
          aria-label="Dates"
          value={showCustom ? "custom" : preset}
          onChange={(event) => {
            const chosen = DATE_PRESETS.find((option) => option.id === event.target.value);
            setCustomOpen(!chosen);
            if (chosen) {
              const range = presetRange(chosen.id, today);
              onSearch({ from: range.from, to: range.to });
            }
          }}
          className={INPUT}
        >
          {DATE_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {showCustom && (
        <>
          <input
            type="date"
            aria-label="From"
            value={search.from ?? ""}
            onChange={(event) => onSearch({ from: event.target.value || undefined })}
            className={INPUT}
          />
          <input
            type="date"
            aria-label="To"
            value={search.to ?? ""}
            onChange={(event) => onSearch({ to: event.target.value || undefined })}
            className={INPUT}
          />
        </>
      )}
      <span className="ml-2 text-muted uppercase tracking-wider">Book</span>
      {(["live", "paper"] as const).map((book) => (
        <button
          key={book}
          type="button"
          aria-pressed={books.includes(book)}
          onClick={() => toggleBook(book)}
          className={segmentClass(books.includes(book))}
        >
          {book === "live" ? "Live" : "Paper"}
        </button>
      ))}
      <label className="ml-2 flex items-center gap-1 text-muted uppercase tracking-wider">
        Ticker
        <select
          aria-label="Ticker"
          value={search.ticker ?? ""}
          onChange={(event) => onSearch({ ticker: event.target.value || undefined })}
          className={INPUT}
        >
          <option value="">All</option>
          {tickers.map((ticker) => (
            <option key={ticker} value={ticker}>
              {ticker}
            </option>
          ))}
        </select>
      </label>
      <label className="ml-2 flex items-center gap-1 text-muted">
        <input
          type="checkbox"
          checked={search.excluded === true}
          onChange={(event) => onSearch({ excluded: event.target.checked ? true : undefined })}
        />
        Include excluded
      </label>
    </div>
  );
}
```

Create `apps/web/src/routes/AnalyticsRoute.tsx`:

```tsx
import { getRouteApi } from "@tanstack/react-router";
import { applyPatch } from "../analytics/search.js";
import { Analytics } from "./Analytics.js";

const route = getRouteApi("/analytics");

/** The Analytics page wired to its URL. It loads in its own chunk, with the charts. */
export function AnalyticsRoute() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <Analytics
      search={search}
      onSearch={(patch) => navigate({ search: (prev) => applyPatch(prev, patch) })}
      onOpenTrade={(id) => navigate({ to: "/trades/$id", params: { id } })}
    />
  );
}
```

In `apps/web/src/router.tsx`:
- add `lazyRouteComponent` to the `@tanstack/react-router` import, and import `parseAnalyticsSearch` alongside `parseDashboardSearch` from `./analytics/search.js`;
- remove the `/analytics` entry from `PLACEHOLDERS`;
- add the route:

```tsx
const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  validateSearch: parseAnalyticsSearch,
  component: lazyRouteComponent(() => import("./routes/AnalyticsRoute.js"), "AnalyticsRoute"),
});
```

- add `analyticsRoute` to `rootRoute.addChildren([…])` after `journalRoute`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/routes/Analytics.test.tsx`
Expected: PASS. In "shows where the money goes", before fees is net 80 + fees 12 = 92, and BB kept −300 / 300 = −100%.

- [ ] **Step 7: Check that Analytics loads in its own chunk**

Run: `pnpm build`
Expected: the output lists a separate `AnalyticsRoute-*.js` chunk, which carries Recharts. Note the gzipped size of the main `index-*.js` for Task 14.

- [ ] **Step 8: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/package.json pnpm-lock.yaml apps/web/src/analytics/Charts.tsx apps/web/src/routes/Analytics.tsx apps/web/src/routes/Analytics.test.tsx apps/web/src/routes/OverviewTab.tsx apps/web/src/routes/AnalyticsRoute.tsx apps/web/src/router.tsx
git commit -m "feat(web): the Analytics page, with filters in the URL and the Overview tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The Iron flies tab

**Files:**
- Create: `apps/web/src/routes/FliesTab.tsx`
- Modify: `apps/web/src/analytics/Charts.tsx` (add `KeptHistogram`), `apps/web/src/routes/Analytics.tsx` (add the tab)
- Test: `apps/web/src/routes/Analytics.test.tsx`

**Interfaces:**
- Consumes: `closedTrades`, `keptStats`, `keptHistogram`, `KeptBin`, `creditSplit`, `wingsSplit`, `wingWidthSplit` (core); `TabProps` (Task 12); `resolveEdges`, `rememberEdges` (Task 8); `KpiStrip`, `Section`, `SplitGrid`, `shareText` (Task 10).
- Produces:
  - `FliesTab(props: TabProps)`
  - `KeptHistogram({ bins, tickers }: { bins: readonly KeptBin[]; tickers: ReadonlyMap<string, string> })`
  - an `Iron flies` tab button that calls `onSearch({ tab: "flies" })`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/routes/Analytics.test.tsx`, add `KeptHistogram` to the `../analytics/Charts.js` mock:

```tsx
  KeptHistogram: ({ bins }: { bins: { label: string; tradeIds: string[] }[] }) => (
    <div data-testid="kept-histogram">
      {bins
        .filter((bin) => bin.tradeIds.length > 0)
        .map((bin) => `${bin.label}: ${bin.tradeIds.length}`)
        .join("; ")}
    </div>
  ),
```

and append:

```tsx
describe("Analytics Iron flies", () => {
  /*
   * Flies AA, BB, CC: credits 204, 306, 402 (avg $304); max profits 200, 300, 400 (avg $300).
   * AA keeps 50%, CC keeps 280 / 400 = 70%: winners keep a mean and median of 60%.
   * BB loses all of its 300 max profit: 100%. Kept overall: 80 / 900 = 9%. The scalp SS is left out.
   */
  const FLIES = [
    ...TRADES,
    tradeRow({ id: "s", underlying: "SS", opened: "2026-09-09 09:35", closed: "2026-09-09 10:05", netPnl: 50, strategy: "scalp" }),
  ];

  it("switches tabs through the URL", async () => {
    stubTrades(FLIES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iron flies" }));
    expect(onSearch).toHaveBeenCalledWith({ tab: "flies" });
  });

  it("measures the flies against max profit", async () => {
    stubTrades(FLIES);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("avg-credit")).toContain("$304"));
    expect(kpi("avg-max-profit")).toContain("$300");
    expect(kpi("winners-keep")).toContain("60%");
    expect(kpi("winners-keep")).toContain("median 60%");
    expect(kpi("losers-lose")).toContain("100%");
    expect(kpi("kept-overall")).toContain("9%");
    expect(screen.getByTestId("kept-histogram").textContent).toBe("−100% to −75%: 1; 50% to 75%: 2");
  });

  it("shows the fly splits, and saves new credit edges", async () => {
    stubTrades(FLIES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={onSearch} />);
    for (const title of ["Credit", "Wings", "Wider wing width"]) {
      expect(await screen.findByRole("region", { name: title })).toBeTruthy();
    }
    const credit = within(screen.getByRole("region", { name: "Credit" }));
    fireEvent.click(credit.getByRole("button", { name: "edit" }));
    fireEvent.change(credit.getByLabelText("Credit edges"), { target: { value: "300" } });
    fireEvent.click(credit.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ creditEdges: "300" });
    expect(localStorage.getItem("tj.edges.credit")).toBe("300");
  });

  it("holds a place for the move charts, counting the flies that have the data", async () => {
    stubTrades(FLIES);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    expect(await screen.findByText(/0 of 3 closed flies have them/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Analytics.test.tsx`
Expected: FAIL: there is no `Iron flies` button, and no `kpi-avg-credit`.

- [ ] **Step 3: Implement**

In `apps/web/src/analytics/Charts.tsx`, add `type KeptBin` to the `@tj/core` import and append:

```tsx
/** How many trades kept each share of max profit; hovering a bar names them. */
export function KeptHistogram({ bins, tickers }: { bins: readonly KeptBin[]; tickers: ReadonlyMap<string, string> }) {
  const data = bins.map((bin) => ({
    label: bin.label,
    count: bin.tradeIds.length,
    kept: bin.from >= 0,
    names: bin.tradeIds.map((id) => tickers.get(id) ?? id).join(", "),
  }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="label" tick={TICK} interval={0} axisLine={false} tickLine={false} />
        <YAxis hide allowDecimals={false} />
        <Tooltip
          {...TOOLTIP}
          formatter={(value, _name, item) => [`${value} · ${item.payload?.names ?? ""}`, "trades"]}
        />
        <Bar dataKey="count" isAnimationActive={false} label={{ position: "top", fill: "#8a91a3", fontSize: 9 }}>
          {data.map((bin) => (
            <Cell key={bin.label} fill={bin.kept ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

Create `apps/web/src/routes/FliesTab.tsx`:

```tsx
import { closedTrades, creditSplit, keptHistogram, keptStats, wingsSplit, wingWidthSplit } from "@tj/core";
import { KeptHistogram } from "../analytics/Charts.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { shareText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { Section } from "../analytics/Section.js";
import { SplitGrid } from "../analytics/SplitGrid.js";
import type { TabProps } from "./OverviewTab.js";

const wholeDollars = (value: number | null) =>
  value == null ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** How much credit the flies keep, and the splits only flies have (spec §7.3). */
export function FliesTab({ trades, search, onSearch }: TabProps) {
  const flies = closedTrades(trades.filter((trade) => trade.strategy === "iron_fly"));
  const kept = keptStats(flies);
  const creditEdges = resolveEdges("usd", search.creditEdges);
  const tickers = new Map(flies.map((trade) => [trade.id, trade.underlying]));
  const withMoves = flies.filter(
    (trade) => trade.ironFly?.impliedMovePct != null && trade.ironFly.actualMovePct != null,
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "avg-credit", label: "Avg credit", value: wholeDollars(kept.avgCredit), sub: "per trade" },
          { id: "avg-max-profit", label: "Avg max profit", value: wholeDollars(kept.avgMaxProfit), sub: "credit after fees" },
          {
            id: "winners-keep",
            label: "Winners keep",
            value: <span className="text-up">{shareText(kept.winnersKeep?.mean ?? null)}</span>,
            sub: `of max profit · median ${shareText(kept.winnersKeep?.median ?? null)}`,
          },
          {
            id: "losers-lose",
            label: "Losers lose",
            value: <span className="text-down">{shareText(kept.losersLose?.mean ?? null)}</span>,
            sub: `of max profit · median ${shareText(kept.losersLose?.median ?? null)}`,
          },
          {
            id: "kept-overall",
            label: "Kept overall",
            value: shareText(kept.keptOverall),
            sub: "of all max profit on offer",
          },
        ]}
      />
      {kept.skipped > 0 && (
        <p className="text-[10px] text-muted">
          {kept.skipped} {kept.skipped === 1 ? "fly is" : "flies are"} left out: fees at or above the credit, or no
          credit recorded.
        </p>
      )}
      <Section title="% of max profit kept, per trade">
        {flies.length === 0 ? (
          <p className="text-muted">No closed trades in this range.</p>
        ) : (
          <KeptHistogram bins={keptHistogram(flies)} tickers={tickers} />
        )}
      </Section>
      <SplitGrid
        panels={[
          {
            title: "Credit",
            rows: creditSplit(flies, creditEdges),
            edges: {
              kind: "usd",
              edges: creditEdges,
              onChange: (edges) => {
                rememberEdges("usd", edges);
                onSearch({ creditEdges: edges ? edges.join(",") : undefined });
              },
            },
          },
          { title: "Wings", rows: wingsSplit(flies) },
          { title: "Wider wing width", rows: wingWidthSplit(flies) },
        ]}
      />
      <Section title="Implied vs actual move · IV crush · P&L by move ratio">
        <p className="rounded-sm border border-line border-dashed p-3 text-center text-[11px] text-muted">
          These charts fill in once each trade has its implied and actual move. {withMoves} of {flies.length} closed
          flies have them.
        </p>
      </Section>
    </div>
  );
}
```

In `apps/web/src/routes/Analytics.tsx`, import `FliesTab` from `./FliesTab.js`, then replace the `<nav>` and the tab content with:

```tsx
      <nav aria-label="Analytics tabs" className="flex gap-4 border-line border-b text-[12px]">
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

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/routes/Analytics.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/analytics/Charts.tsx apps/web/src/routes/FliesTab.tsx apps/web/src/routes/Analytics.tsx apps/web/src/routes/Analytics.test.tsx
git commit -m "feat(web): the Iron flies tab, measured against max profit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Docs, the bundle, and a visual check against the real journal

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§9, §10, §13, §16)
- Modify: `docs/superpowers/specs/2026-09-27-analytics-and-dashboard-design.md` (§13, and the status line)
- Modify: `README.md` ("What it tracks")
- Scratchpad only (not committed): `serve.mts` and `shots.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: the parent spec and README point at the new pages. The bundle numbers are recorded. There are screenshots at 1280 and 1024 px.

- [ ] **Step 1: Update the parent spec** (as this spec's §11 lists)

In `docs/superpowers/specs/2026-09-22-trading-journal-design.md`:
- **§9:** below the heading, add a pointer and the refining decisions:

```markdown
Detailed for iron flies in [2026-09-27-analytics-and-dashboard-design.md](2026-09-27-analytics-and-dashboard-design.md), which refines this section:

- iron flies are measured against max profit (% kept), not max loss;
- breakdowns show all splits at once;
- Analytics filters live on the page for now, not in a global bar;
- CSV export is deferred.
```

- **§9 Definitions:** add three bullets:

```markdown
  - win rate = wins ÷ all closed trades (scratches count in the denominator);
  - max drawdown = the largest drop from a running peak of cumulative net P&L, the peak starting at $0;
  - % kept (iron flies) = net P&L ÷ max profit, where max profit = credit per share × contracts × 100 − fees.
```

- **§10:** add the Dashboard layout: "The Dashboard: KPIs, then a full-width equity curve with a drawdown pane, then the P&L calendar beside the open and recent trades."
- **§13, Phase 1 item 7:** add "(dashboard, calendar, equity curve, breakdowns and the credit-kept view done; the move charts wait for move data)".
- **§16, item 5:** mark it resolved: "the TradingView attribution logo stays on (the library's default)."

- [ ] **Step 2: Update this spec and the README**

In `docs/superpowers/specs/2026-09-27-analytics-and-dashboard-design.md`:
- set **Status** to `Approved; implemented on feat/analytics`;
- rewrite §13 as resolved:
  - **Item 1:** the gzipped main bundle and Analytics chunk sizes from Task 12, Step 7.
  - **Item 2:** Lightweight Charts has no timezone option, so each time is formatted with `Intl` in New York through `tickMarkFormatter` and `timeFormatter`.

In `README.md`, "What it tracks":
- in the Iron flies bullet, replace "credit, max loss, return on risk, breakevens" with "credit and how much of it you keep, max loss, breakevens";
- add a bullet: "**Review** — a Dashboard for the current period (KPIs, equity curve with drawdown, P&L calendar, open and recent trades) and an Analytics page with every split at once and an Iron flies tab measured against max profit."
- change "Scalps, charts, imports and analytics arrive in later phases" to "Scalps, trade charts and IBKR sync arrive in later phases".

- [ ] **Step 3: Visual check over a copy of the real journal**

Follow the saved recipe: headless Firefox through `puppeteer-core` in the scratchpad, waiting for `document.fonts.ready`.

Build: `pnpm build`.

Create `serve.mts` in the scratchpad. The name must end in `.mts`, so that top-level `await` works. It copies the journal read-only and serves the built app over the copy:

```ts
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "/home/kiryu/Projects/TradingJournal/apps/server/node_modules/@hono/node-server/dist/index.mjs";
import { createApp } from "/home/kiryu/Projects/TradingJournal/apps/server/src/app.ts";
import { openDatabase } from "/home/kiryu/Projects/TradingJournal/packages/db/src/index.ts";

const require = createRequire("/home/kiryu/Projects/TradingJournal/packages/db/package.json");
const Database = require("better-sqlite3");
// On Windows the journal is under %APPDATA%\trading-journal\journal.db.
const source = join(homedir(), ".local/share/trading-journal/journal.db");
const copy = join(mkdtempSync(join(tmpdir(), "tj-visual-")), "journal.db");
await new Database(source, { readonly: true }).backup(copy);
serve({
  fetch: createApp({ db: openDatabase(copy), webDir: "/home/kiryu/Projects/TradingJournal/apps/web/dist" }).fetch,
  port: 4199,
  hostname: "127.0.0.1",
});
console.log("stand-in on http://localhost:4199");
```

Run it in the background with `apps/server/node_modules/.bin/tsx serve.mts`. Then screenshot these pages at 1280 × 900 and at 1024 × 900:
- `/?at=2026-09-15`
- `/?period=all`
- `/analytics`
- `/analytics?tab=flies`

Wait for `document.fonts.ready` and 1 s more before each screenshot. Look at every screenshot.

Expected (spec §3, all time):
- Net P&L −$2,273.24; 41 trades; win rate 53.7%; profit factor 0.63.
- Max drawdown −$4,867.40; before fees −$1,855.00; fees −$418.24.
- Largest losses CRM, CRWD, BULL.
- The Iron flies tab: winners keep 32%, losers lose 35%, kept overall −10%.
- BB is listed under Open with `EXPIRED · add exits`.
- On both screens, nothing overlaps or is cut off.

Stop the server with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`.

- [ ] **Step 4: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/superpowers/specs/2026-09-22-trading-journal-design.md docs/superpowers/specs/2026-09-27-analytics-and-dashboard-design.md README.md
git commit -m "docs: point the main spec and README at the Dashboard and Analytics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
