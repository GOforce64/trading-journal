# Trade Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every trade page shows two charts of the underlying, built from Alpaca's bars and cached locally: a 3-minute intraday chart with the trade's fills, EMAs, VWAP and the premarket and prior-day levels, and a daily chart beside it.

**Architecture:**
- **`@tj/core` (`chart.ts`):** pure functions that turn 1-minute bars into candles of any timeframe, EMAs, VWAP and session levels.
- **`@tj/market-data`:** a paged Alpaca client for whole days of minute and daily bars.
- **`@tj/db`:** migration 0004 adds a bar cache: `bars` and `bar_days`.
- **The server:** a bar service that serves cached days, fetches the missing ones and caches finished days, behind `/api/bars`.
- **The web:**
  - a pure chart model, built from the bars and the trade;
  - thin Lightweight Charts wrappers for the intraday and daily charts, and a toolbar;
  - `TradeCharts` on the trade page, and a Chart section in Settings.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), zod 4, Hono, Drizzle + better-sqlite3, React 19, TanStack Query 5, lightweight-charts 5.2, Tailwind 4, Vitest 5 (jsdom for web), fast-check 4, Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-trade-chart-design.md`

**Branch:** `feat/trade-chart`, from `main` (e609e50, with the spec at 1a9a73c). Work in place; no worktree.

**Deviations from the spec, agreed while planning.** The spec is updated in the same commit as this plan.
- **§4, `core/chart/`:** it's one file, `packages/core/src/chart.ts`, because `core` is a flat package.
- **§6, `no_symbol`:** it becomes `no_bars` ("No stock bars for SPX."). Alpaca answers a symbol it doesn't carry with no bars, the same as a symbol with no bars in the period, so the two can't be told apart.
- **§6, today's daily candle:**
  - Alpaca's daily bar for a day exists only once the day is over, and you usually review the same day. So the daily chart builds today's candle from today's regular-session minute bars, and the daily endpoint serves finished days only.
  - Today's intraday bars are fetched in a request of their own, never together with finished days. Otherwise a refusal of the recent minutes could be cached as empty days.
- **§4, the market source:** the chart uses a new `history` source (`BarHistory`) beside move data's `bars`, so the move-data code and its tests are untouched.

## Global Constraints

**Alpaca**
- Bars come from `https://data.alpaca.markets/v2/stocks/bars` with `feed=sip`, `adjustment=raw` and `limit=10000`, paging with `page_token` until `next_page_token` is empty.
- The free plan refuses the most recent 15 minutes: a 403 whose message matches `/recent SIP data/i`. Today's request ends at the earlier of **now − 16 minutes** and **20:00 ET**.
- The rate limit is 200 requests per minute. A trade costs about 2 requests the first time it's opened, and 0 after that for finished days.

**Ranges and caching**
- **Intraday:** from **7 calendar days before** the trade's first New York day, through its last day (today for an open trade).
- **Daily:** the 730 days before `to`, and never later than yesterday. Today's daily candle is built in the browser.
- **Only finished days are cached:** New York dates before today. Today is never stored. A finished day with no bars is stored with `count = 0` and never fetched again.

**The chart**
- The timeframes, in minutes, are `[1, 2, 3, 5, 10, 15, 30, 60]`, labelled `1m 2m 3m 5m 10m 15m 30m 1h`. The chart opens on **3**.
- The EMA lengths default to `[8, 20, 50, 167]`, with a warm-up of `3 × length`. Earlier values are `null` and not drawn.
- The session times are 04:00 premarket open, 09:30 regular open, 16:00 regular close and 20:00 end, all ET. Candles start on boundaries counted from 04:00.
- VWAP covers the regular session only and restarts each day.
- The opening view runs from **20 candles** before the first fill to 20 after the last.

**Colours**
- The palette: up `#26a69a`, down `#ef5350`, accent `#2962ff`, panel `#131722`, line `#1f2430`, muted `#6b7385`.
- Extended-hours candles: up `rgba(38, 166, 154, 0.45)` and down `rgba(239, 83, 80, 0.45)`.
- The EMAs: 8 `#f7c948`, 20 `#26c6da`, 50 `#ab47bc`, 167 `#ff7043`.
- VWAP `#e0e0e0`, the PM levels `#82a8ff` (dotted), and the PD levels `#ffb74d` (dotted).

**UI copy (exact)**
- `Add your Alpaca key in Settings to see the chart.`
- `No stock bars for {SYMBOL}.`
- `Alpaca didn't answer. Try again.`, with the button `Retry`.
- `Alpaca's free data runs 15 minutes behind.`
- The toolbar: `1m 2m 3m 5m 10m 15m 30m 1h`, `EMA 8`, `EMA 20`, `EMA 50`, `EMA 167`, `VWAP`, `PM levels`, `PD levels`, `Volume` and `Fit trade`. A hidden EMA's toggle has the title `needs more history`.
- The level labels: `PM H`, `PM L`, `PD H` and `PD L`.
- The markers read like `B 2 @ 1.06`, `S 1 @ 1.44` and `expired`.
- The Settings panel: `Chart`, with the fields `EMA 1` to `EMA 4`.

**Types across the RPC boundary (lesson TS2742):** a route's answer spells its unions inline. It never uses an alias from a package the web doesn't depend on.

**CI and commits**
- CI runs on Ubuntu and Windows.
- Before every commit, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and check each exit code. Never pipe them through `tail`.
- When `pnpm lint` reports only formatting, run `pnpm format` and check again.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these is a condition the spec implies but no obvious test covers. The owning task carries a test for each:

1. **Alpaca failing partway through a fetch.** No finished day may be stored as empty, or its bars would be missing forever. Test: Task 5.
2. **A scalp from today, reviewed after the close.** Its minute bars are clamped and never cached, and the daily chart's candle for today is built from the minute bars. Tests: Tasks 5 and 6.
3. **The November clock change inside a warm-up week.** Candles must land on the right New York minutes on both sides of it. Test: Task 1.
4. **A holiday or half day just before the trade.** The PD levels must come from the last day that actually traded. Test: Task 2.
5. **A fill outside the loaded bars**, such as one at 03:58 or 20:05, or in a minute with no bars. It goes on the nearest earlier candle, or is skipped if there's none, and the opening view stays valid. Test: Task 6.

---

### Task 1: Candles and EMAs in `core`

**Files:**
- Create: `packages/core/src/chart.ts`
- Create: `packages/core/src/chart.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `nyDate` (`marks.ts`), and `nyMinuteOfDay` and `nyWallClock` (`calendar.ts`).
- Produces (exported from `@tj/core`):

```ts
interface PriceBar { t: number /* start, epoch ms */; o: number; h: number; l: number; c: number; v: number }
interface Candle extends PriceBar { extended: boolean }
const PREMARKET_OPEN = 240; const REGULAR_OPEN = 570; const REGULAR_CLOSE = 960; const SESSION_END = 1200;
const EMA_WARMUP = 3;
function nyClock(t: number): { date: string; minute: number };
function aggregate(bars: readonly PriceBar[], minutes: number): Candle[];
function ema(values: readonly number[], length: number): (number | null)[];
```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/chart.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nyMinuteOfDay, nyWallClock } from "./calendar.js";
import { aggregate, ema, nyClock, PREMARKET_OPEN, type PriceBar } from "./chart.js";
import { nyDate } from "./marks.js";

const DAY = "2026-09-28";
/** A New York wall-clock time as epoch ms. */
const at = (date: string, hhmm: string) => {
  const [hours = 0, minutes = 0] = hhmm.split(":").map(Number);
  return nyWallClock(date, hours * 60 + minutes);
};
const bar = (date: string, hhmm: string, o: number, h: number, l: number, c: number, v = 100): PriceBar => ({
  t: at(date, hhmm),
  o,
  h,
  l,
  c,
  v,
});

describe("nyClock", () => {
  it("reads New York's date and minute in summer and in winter time", () => {
    expect(nyClock(Date.UTC(2026, 8, 28, 13, 31))).toEqual({ date: "2026-09-28", minute: 9 * 60 + 31 });
    expect(nyClock(Date.UTC(2026, 11, 1, 14, 30))).toEqual({ date: "2026-12-01", minute: 9 * 60 + 30 });
  });

  it("crosses the November clock change, when 01:30 happens twice", () => {
    // 2026-11-01: daylight time until 02:00, then standard time.
    expect(nyClock(Date.UTC(2026, 10, 1, 5, 30))).toEqual({ date: "2026-11-01", minute: 90 });
    expect(nyClock(Date.UTC(2026, 10, 1, 6, 30))).toEqual({ date: "2026-11-01", minute: 90 });
    expect(nyClock(Date.UTC(2026, 10, 2, 14, 30))).toEqual({ date: "2026-11-02", minute: 570 });
  });

  it("agrees with the Intl formatter at any instant (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }), (t) => {
        expect(nyClock(t)).toEqual({ date: nyDate(t), minute: nyMinuteOfDay(t) });
      }),
    );
  });
});

describe("aggregate", () => {
  it("builds 3-minute candles on boundaries counted from 04:00, so 09:30 starts one", () => {
    const candles = aggregate(
      [
        bar(DAY, "09:29", 1, 1.1, 0.9, 1, 100),
        bar(DAY, "09:30", 1, 1.2, 0.95, 1.1, 200),
        bar(DAY, "09:31", 1.1, 1.3, 1.05, 1.25, 300),
        bar(DAY, "09:32", 1.25, 1.26, 1, 1.02, 400),
        bar(DAY, "09:33", 1.02, 1.1, 1, 1.05, 500),
      ],
      3,
    );
    expect(candles).toEqual([
      { t: at(DAY, "09:27"), o: 1, h: 1.1, l: 0.9, c: 1, v: 100, extended: true },
      { t: at(DAY, "09:30"), o: 1, h: 1.3, l: 0.95, c: 1.02, v: 900, extended: false },
      { t: at(DAY, "09:33"), o: 1.02, h: 1.1, l: 1, c: 1.05, v: 500, extended: false },
    ]);
  });

  it("never lets a candle span two days", () => {
    const candles = aggregate([bar(DAY, "19:59", 1, 1, 1, 1), bar("2026-09-29", "04:00", 2, 2, 2, 2)], 60);
    expect(candles.map((candle) => candle.t)).toEqual([at(DAY, "19:00"), at("2026-09-29", "04:00")]);
  });

  it("starts hourly candles at 04:00, 05:00 and so on, marking those that start before 09:30 as extended", () => {
    const [candle] = aggregate([bar(DAY, "09:45", 1, 1, 1, 1)], 60);
    expect(candle).toMatchObject({ t: at(DAY, "09:00"), extended: true });
  });

  it("keeps 1-minute bars as they are, marking the regular session", () => {
    const candles = aggregate([bar(DAY, "15:59", 1, 1, 1, 1), bar(DAY, "16:00", 1, 1, 1, 1)], 1);
    expect(candles.map((candle) => candle.extended)).toEqual([false, true]);
  });

  it("keeps every share and the day's extremes, whatever the timeframe (property)", () => {
    const dayOfBars = fc
      .uniqueArray(
        fc.record({
          minute: fc.integer({ min: PREMARKET_OPEN, max: 20 * 60 - 1 }),
          low: fc.integer({ min: 100, max: 10_000 }),
          spread: fc.integer({ min: 0, max: 500 }),
          v: fc.integer({ min: 0, max: 100_000 }),
        }),
        { selector: (raw) => raw.minute, minLength: 1, maxLength: 300 },
      )
      .map((raws) =>
        [...raws]
          .sort((a, b) => a.minute - b.minute)
          .map(({ minute, low, spread, v }) => ({
            t: nyWallClock(DAY, minute),
            o: low / 100,
            h: (low + spread) / 100,
            l: low / 100,
            c: (low + spread) / 100,
            v,
          })),
      );
    fc.assert(
      fc.property(dayOfBars, fc.constantFrom(1, 2, 3, 5, 10, 15, 30, 60), (bars, minutes) => {
        const candles = aggregate(bars, minutes);
        const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
        expect(sum(candles.map((candle) => candle.v))).toBe(sum(bars.map((each) => each.v)));
        expect(Math.max(...candles.map((candle) => candle.h))).toBe(Math.max(...bars.map((each) => each.h)));
        expect(Math.min(...candles.map((candle) => candle.l))).toBe(Math.min(...bars.map((each) => each.l)));
        expect(candles.every((candle, index) => index === 0 || candle.t > (candles[index - 1]?.t ?? 0))).toBe(true);
      }),
    );
  });
});

describe("ema", () => {
  it("smooths with α = 2 ÷ (length + 1), seeded with the first value, as TradingView's ta.ema", () => {
    // By hand, length 2 (α = 2/3): 1, 1.6667, 2.5556, 3.5185, 4.5062, 5.5021. Drawn from index 3 × 2 − 1 = 5.
    const values = ema([1, 2, 3, 4, 5, 6], 2);
    expect(values.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(values[5]).toBeCloseTo(5.50206, 5);
  });

  it("has nothing to draw before three times its length", () => {
    const values = ema(Array.from({ length: 30 }, (_, index) => index), 8);
    expect(values.findIndex((value) => value !== null)).toBe(23);
  });

  it("follows the values exactly at length 1", () => {
    expect(ema([4, 5, 6], 1)).toEqual([null, null, 6]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/chart.test.ts`
Expected: FAIL, because `./chart.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/chart.ts`:

```ts
import { nyMinuteOfDay, nyWallClock } from "./calendar.js";
import { nyDate } from "./marks.js";

/** One bar of prices. `t` is its start, as epoch ms; `v` is shares. */
export interface PriceBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A candle on a chart's timeframe. `extended`: it starts outside the regular session, 09:30–16:00 ET. */
export interface Candle extends PriceBar {
  extended: boolean;
}

/** Minutes since midnight, New York. */
export const PREMARKET_OPEN = 4 * 60;
export const REGULAR_OPEN = 9 * 60 + 30;
export const REGULAR_CLOSE = 16 * 60;
export const SESSION_END = 20 * 60;
/** An EMA is drawn once it has this many times its length of values behind it (spec §7). */
export const EMA_WARMUP = 3;

const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const offsets = new Map<number, number>();

/**
 * The New York date and minute of an instant, fast enough for thousands of bars. New York's offset from UTC is
 * worked out once per hour, since it only changes on the hour (at 02:00), instead of formatting every instant.
 */
export function nyClock(t: number): { date: string; minute: number } {
  const hour = Math.floor(t / HOUR);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    const start = hour * HOUR;
    offset = Date.parse(`${nyDate(start)}T00:00:00Z`) + nyMinuteOfDay(start) * 60_000 - start;
    offsets.set(hour, offset);
  }
  const wall = t + offset;
  return {
    date: new Date(wall).toISOString().slice(0, 10),
    minute: Math.floor((((wall % DAY_MS) + DAY_MS) % DAY_MS) / 60_000),
  };
}

/**
 * Candles of `minutes` each from 1-minute bars, oldest first. Boundaries count from 04:00 ET, so a 3-minute
 * candle covers 09:30–09:33 as on TradingView, and 1-hour candles start at 04:00, 05:00 and so on. A candle
 * never spans two days; a minute without trades just leaves its candle with fewer bars.
 */
export function aggregate(bars: readonly PriceBar[], minutes: number): Candle[] {
  const candles: Candle[] = [];
  let current = "";
  for (const bar of bars) {
    const { date, minute } = nyClock(bar.t);
    const slot = PREMARKET_OPEN + Math.floor((minute - PREMARKET_OPEN) / minutes) * minutes;
    const key = `${date} ${slot}`;
    const last = candles.at(-1);
    if (last && key === current) {
      last.h = Math.max(last.h, bar.h);
      last.l = Math.min(last.l, bar.l);
      last.c = bar.c;
      last.v += bar.v;
      continue;
    }
    current = key;
    candles.push({
      t: bar.t - (minute - slot) * 60_000,
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
      extended: slot < REGULAR_OPEN || slot >= REGULAR_CLOSE,
    });
  }
  return candles;
}

/**
 * The exponential moving average: α = 2 ÷ (length + 1), seeded with the first value, as TradingView's `ta.ema`.
 * Values before index EMA_WARMUP × length − 1 are null: too little history for the seed to have faded.
 */
export function ema(values: readonly number[], length: number): (number | null)[] {
  const alpha = 2 / (length + 1);
  let current: number | null = null;
  return values.map((value, index) => {
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    return index >= EMA_WARMUP * length - 1 ? current : null;
  });
}

/** Midnight in New York on `date`, as Alpaca stamps a daily bar. */
export const nyMidnight = (date: string): number => nyWallClock(date, 0);
```

In `packages/core/src/index.ts`, add `export * from "./chart.js";` after `./calendar.js`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src
git commit -m "feat(core): candles of any timeframe and EMAs from 1-minute bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: VWAP, session levels and a daily candle from minutes

**Files:**
- Modify: `packages/core/src/chart.ts`
- Modify: `packages/core/src/chart.test.ts`

**Interfaces:**
- Consumes: `PriceBar`, `Candle`, `nyClock`, the session constants and `nyMidnight` (Task 1).
- Produces:

```ts
interface SessionLevels { pmHigh: number | null; pmLow: number | null; pdHigh: number | null; pdLow: number | null }
function vwap(bars: readonly PriceBar[], candles: readonly Candle[]): (number | null)[];
function sessionLevels(bars: readonly PriceBar[], date: string): SessionLevels;
function dailyFromMinutes(bars: readonly PriceBar[], date: string): PriceBar | null;
```

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/chart.test.ts`, extend the chart import to `import { aggregate, dailyFromMinutes, ema, nyClock, PREMARKET_OPEN, type PriceBar, sessionLevels, vwap } from "./chart.js";`, and append:

```ts
describe("vwap", () => {
  const bars = [
    bar(DAY, "09:29", 9, 9, 9, 9, 1_000),
    bar(DAY, "09:30", 10, 11, 9, 10, 100), // typical price 10
    bar(DAY, "09:31", 12, 13, 11, 12, 300), // typical price 12
    bar("2026-09-29", "09:30", 20, 21, 19, 20, 50),
  ];

  it("weights the regular session's typical prices by volume, and ignores premarket", () => {
    expect(vwap(bars, aggregate(bars, 1))).toEqual([null, 10, 11.5, 20]);
  });

  it("gives each candle the VWAP as of its last regular-session minute, restarting each day", () => {
    // 3m: the 09:27 candle holds only 09:29 (premarket); the 09:30 candle holds 09:30 and 09:31.
    expect(vwap(bars, aggregate(bars, 3))).toEqual([null, 11.5, 20]);
  });
});

describe("sessionLevels", () => {
  it("reads the premarket high and low of the day, and the prior session's regular high and low", () => {
    const bars = [
      bar("2026-09-25", "09:30", 100, 104, 99, 101),
      bar("2026-09-25", "15:59", 101, 102, 98, 100),
      bar("2026-09-25", "16:30", 100, 110, 90, 100), // after hours: not part of the prior day's range
      bar(DAY, "04:00", 101, 103, 100.5, 102),
      bar(DAY, "09:29", 102, 102.5, 99.5, 101),
      bar(DAY, "09:30", 101, 105, 101, 104), // the day itself: not a level
    ];
    expect(sessionLevels(bars, DAY)).toEqual({ pmHigh: 103, pmLow: 99.5, pdHigh: 104, pdLow: 98 });
  });

  it("skips a holiday: the Tuesday after Labor Day takes Friday's range", () => {
    const bars = [
      bar("2026-09-04", "10:00", 50, 52, 49, 51),
      bar("2026-09-08", "08:00", 51, 51.5, 50.5, 51),
    ];
    expect(sessionLevels(bars, "2026-09-08")).toMatchObject({ pdHigh: 52, pdLow: 49 });
  });

  it("takes a half day's range as it is", () => {
    const bars = [
      bar("2026-11-27", "09:30", 70, 71, 69, 70),
      bar("2026-11-27", "12:59", 70, 73, 70, 72),
      bar("2026-11-30", "09:00", 72, 72, 72, 72),
    ];
    expect(sessionLevels(bars, "2026-11-30")).toMatchObject({ pdHigh: 73, pdLow: 69 });
  });

  it("has no level without bars behind it", () => {
    expect(sessionLevels([bar(DAY, "09:30", 1, 1, 1, 1)], DAY)).toEqual({
      pmHigh: null,
      pmLow: null,
      pdHigh: null,
      pdLow: null,
    });
  });
});

describe("dailyFromMinutes", () => {
  it("builds a day's candle from its regular session, stamped at midnight as Alpaca stamps daily bars", () => {
    const bars = [
      bar(DAY, "08:00", 5, 9, 1, 5, 10),
      bar(DAY, "09:30", 10, 11, 9.5, 10.5, 100),
      bar(DAY, "15:59", 10.5, 12, 10, 11, 200),
      bar(DAY, "16:01", 11, 13, 8, 12, 50),
    ];
    expect(dailyFromMinutes(bars, DAY)).toEqual({ t: at(DAY, "00:00"), o: 10, h: 12, l: 9.5, c: 11, v: 300 });
    expect(dailyFromMinutes(bars, "2026-09-29")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/src/chart.test.ts`
Expected: FAIL, because `vwap`, `sessionLevels` and `dailyFromMinutes` aren't exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/chart.ts`:

```ts
/**
 * Session VWAP (spec §7): the regular session only, 09:30–16:00 ET, restarting each day. Each 1-minute bar's
 * typical price, (h + l + c) ÷ 3, is weighted by its volume. Each candle gets the VWAP as of its last
 * regular-session minute, and null with none. `candles` must be built from the same bars.
 */
export function vwap(bars: readonly PriceBar[], candles: readonly Candle[]): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  let date = "";
  let weighted = 0;
  let volume = 0;
  let index = 0;
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date !== date) {
      date = clock.date;
      weighted = 0;
      volume = 0;
    }
    if (clock.minute < REGULAR_OPEN || clock.minute >= REGULAR_CLOSE) continue;
    weighted += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    volume += bar.v;
    while (index + 1 < candles.length && (candles[index + 1]?.t ?? Number.POSITIVE_INFINITY) <= bar.t) index++;
    const candle = candles[index];
    if (candle && candle.t <= bar.t && volume > 0) out[index] = weighted / volume;
  }
  return out;
}

export interface SessionLevels {
  pmHigh: number | null;
  pmLow: number | null;
  pdHigh: number | null;
  pdLow: number | null;
}

/**
 * The day's premarket high and low (04:00–09:29 ET), and the regular-session high and low of the last earlier
 * day that traded (spec §7): a holiday is skipped, and a half day's range is taken as it is.
 */
export function sessionLevels(bars: readonly PriceBar[], date: string): SessionLevels {
  let pmHigh: number | null = null;
  let pmLow: number | null = null;
  const regular = new Map<string, { h: number; l: number }>();
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date === date && clock.minute >= PREMARKET_OPEN && clock.minute < REGULAR_OPEN) {
      pmHigh = pmHigh === null ? bar.h : Math.max(pmHigh, bar.h);
      pmLow = pmLow === null ? bar.l : Math.min(pmLow, bar.l);
    } else if (clock.date < date && clock.minute >= REGULAR_OPEN && clock.minute < REGULAR_CLOSE) {
      const day = regular.get(clock.date);
      regular.set(clock.date, day ? { h: Math.max(day.h, bar.h), l: Math.min(day.l, bar.l) } : { h: bar.h, l: bar.l });
    }
  }
  const prior = [...regular.keys()].sort().at(-1);
  const range = prior ? regular.get(prior) : undefined;
  return { pmHigh, pmLow, pdHigh: range?.h ?? null, pdLow: range?.l ?? null };
}

/**
 * A day's daily candle from its regular-session minute bars, stamped at New York midnight as Alpaca stamps daily
 * bars. The daily chart uses it for today, which Alpaca only has once the day is over. Null without bars.
 */
export function dailyFromMinutes(bars: readonly PriceBar[], date: string): PriceBar | null {
  let day: PriceBar | null = null;
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date !== date || clock.minute < REGULAR_OPEN || clock.minute >= REGULAR_CLOSE) continue;
    if (!day) {
      day = { t: nyMidnight(date), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v };
      continue;
    }
    day.h = Math.max(day.h, bar.h);
    day.l = Math.min(day.l, bar.l);
    day.c = bar.c;
    day.v += bar.v;
  }
  return day;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core/src
git commit -m "feat(core): session VWAP, premarket and prior-day levels, and a daily candle from minutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Whole days of bars from Alpaca

**Files:**
- Create: `packages/market-data/src/history.ts`
- Create: `packages/market-data/src/history.test.ts`
- Modify: `packages/market-data/src/index.ts`

**Interfaces:**
- Consumes: `PriceBar` (`@tj/core`, Task 1); `alpacaGet`, `AlpacaError` and `AlpacaKeys` (`http.ts`); `STOCK_BARS` (`bars.ts`); `INVALID_SYMBOL` (`alpaca.ts`).
- Produces (exported from `@tj/market-data`):

```ts
interface BarHistory {
  minuteBars(symbol: string, start: number, end: number): Promise<PriceBar[]>;   // [] for a symbol Alpaca rejects
  dailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
}
function alpacaHistory(keys: AlpacaKeys, options?: AlpacaOptions): BarHistory;
function tooRecent(error: unknown): boolean;   // the free plan's 403 for the last 15 minutes
```

- [ ] **Step 1: Write the failing tests**

Create `packages/market-data/src/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alpacaHistory, tooRecent } from "./history.js";
import { AlpacaError } from "./http.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const START = Date.UTC(2026, 8, 21, 8, 0); // Mon Sep 21, 04:00 ET
const END = Date.UTC(2026, 8, 29, 0, 0); // Sep 28, 20:00 ET

/** A bar as Alpaca sends it, with the fields the chart ignores. */
const raw = (t: string, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 1200, n: 30, vw: c });

describe("alpacaHistory.minuteBars", () => {
  it("asks for SIP 1-minute bars, raw, 10,000 at a time, and follows next_page_token", async () => {
    const { fetch, calls } = fakeFetch(
      json({ bars: { NVDA: [raw("2026-09-28T13:30:00Z", 229.5, 229.6, 229.4, 229.5)] }, next_page_token: "abc" }),
      json({ bars: { NVDA: [raw("2026-09-28T13:31:00Z", 229.8, 229.9, 229.7, 229.8)] }, next_page_token: null }),
    );
    const bars = await alpacaHistory(KEYS, { fetch }).minuteBars("NVDA", START, END);

    expect(bars).toEqual([
      { t: Date.UTC(2026, 8, 28, 13, 30), o: 229.5, h: 229.6, l: 229.4, c: 229.5, v: 1200 },
      { t: Date.UTC(2026, 8, 28, 13, 31), o: 229.8, h: 229.9, l: 229.7, c: 229.8, v: 1200 },
    ]);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      symbols: "NVDA",
      timeframe: "1Min",
      start: "2026-09-21T08:00:00.000Z",
      end: "2026-09-29T00:00:00.000Z",
      feed: "sip",
      adjustment: "raw",
      limit: "10000",
    });
    expect(calls[1]?.url.searchParams.get("page_token")).toBe("abc");
  });

  it("answers no bars for a symbol Alpaca doesn't carry", async () => {
    const { fetch } = fakeFetch(json({ message: "code=400, message=invalid symbol: SPX" }, 400));
    expect(await alpacaHistory(KEYS, { fetch }).minuteBars("SPX", START, END)).toEqual([]);
  });

  it("throws the free plan's refusal of the last 15 minutes, for the caller to decide", async () => {
    const { fetch } = fakeFetch(json({ message: "subscription does not permit querying recent SIP data" }, 403));
    const error = await alpacaHistory(KEYS, { fetch })
      .minuteBars("NVDA", START, END)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AlpacaError);
    expect(tooRecent(error)).toBe(true);
    expect(tooRecent(new AlpacaError(403, "forbidden."))).toBe(false);
  });

  it("throws any other refusal", async () => {
    const { fetch } = fakeFetch(new Response("upstream down", { status: 502 }));
    await expect(alpacaHistory(KEYS, { fetch }).minuteBars("NVDA", START, END)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("alpacaHistory.dailyBars", () => {
  it("asks for daily bars between two dates", async () => {
    const { fetch, calls } = fakeFetch(json({ bars: { SPY: [raw("2026-09-25T04:00:00Z", 766.1, 772.4, 765.2, 771.35)] } }));
    const bars = await alpacaHistory(KEYS, { fetch }).dailyBars("SPY", "2024-09-29", "2026-09-28");
    expect(bars.map((bar) => bar.c)).toEqual([771.35]);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toMatchObject({
      timeframe: "1Day",
      start: "2024-09-29",
      end: "2026-09-28",
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/market-data/src/history.test.ts`
Expected: FAIL, because `./history.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/market-data/src/history.ts`:

```ts
import type { PriceBar } from "@tj/core";
import { z } from "zod";
import { INVALID_SYMBOL } from "./alpaca.js";
import { STOCK_BARS } from "./bars.js";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet } from "./http.js";

/** The chart's history (trade-chart spec §6): whole days of bars, where move data needs single prices. */
export interface BarHistory {
  /** 1-minute bars from `start` to `end` (epoch ms), extended hours included, oldest first. [] for an unknown symbol. */
  minuteBars(symbol: string, start: number, end: number): Promise<PriceBar[]>;
  /** Daily bars for the New York dates `from` to `to`, inclusive. */
  dailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
}

const pageSchema = z.object({
  bars: z
    .record(
      z.string(),
      z
        .array(
          z.object({
            t: z.iso.datetime({ offset: true }),
            o: z.number(),
            h: z.number(),
            l: z.number(),
            c: z.number(),
            v: z.number(),
          }),
        )
        .nullable(),
    )
    .nullish(),
  next_page_token: z.string().nullish(),
});

/** The free plan's refusal of the last 15 minutes of SIP data: the caller asks again later. */
export const tooRecent = (error: unknown): boolean =>
  error instanceof AlpacaError && error.status === 403 && /recent SIP data/i.test(error.detail);

/** SIP bars from the free plan, raw so they match the strikes, 10,000 a page. */
export function alpacaHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): BarHistory {
  async function all(symbol: string, query: Record<string, string>): Promise<PriceBar[]> {
    const bars: PriceBar[] = [];
    let token: string | null | undefined;
    do {
      const params = new URLSearchParams({
        symbols: symbol,
        ...query,
        feed: "sip",
        adjustment: "raw",
        limit: "10000",
        ...(token ? { page_token: token } : {}),
      });
      let page: z.infer<typeof pageSchema>;
      try {
        page = pageSchema.parse(await alpacaGet(`${STOCK_BARS}?${params}`, keys, options));
      } catch (error) {
        if (error instanceof AlpacaError && error.status === 400 && INVALID_SYMBOL.test(error.detail)) return [];
        throw error;
      }
      for (const bar of page.bars?.[symbol] ?? []) {
        bars.push({ t: Date.parse(bar.t), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      }
      token = page.next_page_token;
    } while (token);
    return bars;
  }

  return {
    minuteBars: (symbol, start, end) =>
      all(symbol, { timeframe: "1Min", start: new Date(start).toISOString(), end: new Date(end).toISOString() }),
    dailyBars: (symbol, from, to) => all(symbol, { timeframe: "1Day", start: from, end: to }),
  };
}
```

In `packages/market-data/src/index.ts`, add `export * from "./history.js";` after `./http.js`.

If `pnpm typecheck` reports that `@tj/market-data` can't find `@tj/core`, check its `package.json`: `bars.ts` already imports `@tj/core`, so the dependency is there.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/market-data`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/market-data/src
git commit -m "feat(market-data): whole days of minute and daily bars from Alpaca, paged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The bar cache (migration 0004)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create (generated): `packages/db/migrations/0004_bar_cache.sql`, its snapshot, and a `_journal.json` entry
- Create: `packages/db/src/repositories/bars.ts`
- Create: `packages/db/src/repositories/bars.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**
- Consumes: `PriceBar` (`@tj/core`, Task 1).
- Produces (exported from `@tj/db`):

```ts
type BarTimeframe = "1m" | "1d";
function createBarsRepo(db: Db): {
  knownDays(symbol: string, timeframe: BarTimeframe, dates: readonly string[]): Set<string>;
  read(symbol: string, timeframe: BarTimeframe, from: number, to: number): PriceBar[];   // t in [from, to], oldest first
  store(symbol: string, timeframe: BarTimeframe, days: readonly { date: string; bars: readonly PriceBar[] }[], fetchedAt: number): void;
};
```

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/repositories/bars.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceBar } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createBarsRepo } from "./bars.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const bar = (t: number, c: number): PriceBar => ({ t, o: c, h: c, l: c, c, v: 100 });
const FRI = Date.UTC(2026, 8, 25, 13, 30); // Fri Sep 25, 09:30 ET
const MON = Date.UTC(2026, 8, 28, 13, 30); // Mon Sep 28, 09:30 ET

let db: Db;
beforeEach(() => {
  const file = join(mkdtempSync(join(tmpdir(), "tj-bars-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  db = openDatabase(file);
});

describe("the bar cache", () => {
  it("stores finished days with their bars, remembers empty ones, and reads a range oldest first", () => {
    const repo = createBarsRepo(db);
    repo.store(
      "NVDA",
      "1m",
      [
        { date: "2026-09-28", bars: [bar(MON + 60_000, 229.8), bar(MON, 229.5)] },
        { date: "2026-09-26", bars: [] },
        { date: "2026-09-25", bars: [bar(FRI, 228)] },
      ],
      1_000,
    );
    expect(repo.knownDays("NVDA", "1m", ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"])).toEqual(
      new Set(["2026-09-25", "2026-09-26", "2026-09-28"]),
    );
    expect(repo.read("NVDA", "1m", FRI, MON + 60_000).map((each) => each.c)).toEqual([228, 229.5, 229.8]);
    expect(repo.read("NVDA", "1m", MON, MON)).toEqual([bar(MON, 229.5)]);
  });

  it("keeps a day as first stored, and keeps symbols and timeframes apart", () => {
    const repo = createBarsRepo(db);
    repo.store("NVDA", "1m", [{ date: "2026-09-28", bars: [bar(MON, 229.5)] }], 1_000);
    repo.store("NVDA", "1m", [{ date: "2026-09-28", bars: [bar(MON, 1)] }], 2_000);
    expect(repo.read("NVDA", "1m", MON, MON).map((each) => each.c)).toEqual([229.5]);
    expect(repo.knownDays("TSLA", "1m", ["2026-09-28"]).size).toBe(0);
    expect(repo.knownDays("NVDA", "1d", ["2026-09-28"]).size).toBe(0);
    expect(repo.knownDays("NVDA", "1m", []).size).toBe(0);
  });
});
```

In `packages/db/src/migrate.test.ts`, add inside `describe("runMigrations", …)`:

```ts
  it("adds the bar cache tables", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("bars")).toEqual(["symbol", "timeframe", "t", "o", "h", "l", "c", "v"]);
    expect(columns("bar_days")).toEqual(["symbol", "timeframe", "date", "count", "fetched_at"]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL: there's no `./bars.js`, and no `bars` table.

- [ ] **Step 3: Add the schema and generate the migration**

In `packages/db/src/schema.ts`, add `primaryKey` to the `drizzle-orm/sqlite-core` import, and append:

```ts
/** Cached bars (trade-chart spec §5): finished days only, never exported. `t` is the bar's start. */
export const bars = sqliteTable(
  "bars",
  {
    symbol: text("symbol").notNull(),
    /** '1m' | '1d' */
    timeframe: text("timeframe").notNull(),
    t: integer("t").notNull(),
    o: real("o").notNull(),
    h: real("h").notNull(),
    l: real("l").notNull(),
    c: real("c").notNull(),
    v: real("v").notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.timeframe, table.t] })],
);

/** The finished days a symbol's bars were fetched for, empty ones (weekends, holidays) included. */
export const barDays = sqliteTable(
  "bar_days",
  {
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    /** YYYY-MM-DD, New York */
    date: text("date").notNull(),
    count: integer("count").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.symbol, table.timeframe, table.date] })],
);
```

Generate the migration and read it:

```bash
pnpm --filter @tj/db exec drizzle-kit generate --name bar_cache
cat packages/db/migrations/0004_bar_cache.sql
```

Expected: two `CREATE TABLE` statements with composite primary keys, and nothing touching the other tables.

- [ ] **Step 4: Implement the repository**

Create `packages/db/src/repositories/bars.ts`:

```ts
import type { PriceBar } from "@tj/core";
import { and, asc, between, eq, inArray } from "drizzle-orm";
import type { Db } from "../client.js";
import { barDays, bars } from "../schema.js";

export type BarTimeframe = "1m" | "1d";

/** The chart's bar cache (trade-chart spec §5). Only finished days are stored, so nothing here goes stale. */
export function createBarsRepo(db: Db) {
  return {
    /** Which of `dates` are cached, empty days included. */
    knownDays(symbol: string, timeframe: BarTimeframe, dates: readonly string[]): Set<string> {
      if (dates.length === 0) return new Set();
      const rows = db
        .select({ date: barDays.date })
        .from(barDays)
        .where(and(eq(barDays.symbol, symbol), eq(barDays.timeframe, timeframe), inArray(barDays.date, [...dates])))
        .all();
      return new Set(rows.map((row) => row.date));
    },

    /** Cached bars that start between `from` and `to` (epoch ms, inclusive), oldest first. */
    read(symbol: string, timeframe: BarTimeframe, from: number, to: number): PriceBar[] {
      return db
        .select({ t: bars.t, o: bars.o, h: bars.h, l: bars.l, c: bars.c, v: bars.v })
        .from(bars)
        .where(and(eq(bars.symbol, symbol), eq(bars.timeframe, timeframe), between(bars.t, from, to)))
        .orderBy(asc(bars.t))
        .all();
    },

    /** Stores finished days, each with its bars (possibly none), in one transaction. A stored day is kept as it was. */
    store(
      symbol: string,
      timeframe: BarTimeframe,
      days: readonly { date: string; bars: readonly PriceBar[] }[],
      fetchedAt: number,
    ): void {
      db.transaction((tx) => {
        for (const day of days) {
          for (const bar of day.bars) {
            tx.insert(bars)
              .values({ symbol, timeframe, t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })
              .onConflictDoNothing()
              .run();
          }
          tx.insert(barDays)
            .values({ symbol, timeframe, date: day.date, count: day.bars.length, fetchedAt })
            .onConflictDoNothing()
            .run();
        }
      });
    },
  };
}
```

In `packages/db/src/index.ts`, add `export * from "./repositories/bars.js";` before `./repositories/ibkr.js`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/db`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db
git commit -m "feat(db): a cache of finished days of bars, remembering empty days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The bar service and `/api/bars`

**Files:**
- Create: `apps/server/src/bars.ts`
- Create: `apps/server/src/routes/bars.ts`
- Create: `apps/server/src/bars.test.ts`
- Modify: `apps/server/src/marketData.ts`, `apps/server/src/testing.ts`, `apps/server/src/app.ts`, `apps/server/src/routes/market.ts` (export `isoDate`)

**Interfaces:**
- Consumes:
  - `addDays`, `nyClock`, `nyDate`, `nyWallClock`, `PriceBar` and `SESSION_END` (`@tj/core`);
  - `createBarsRepo` and `BarTimeframe` (Task 4);
  - `BarHistory`, `alpacaHistory` and `tooRecent` (Task 3).
- Produces:

```ts
// marketData.ts: MarketSources gains `history: BarHistory`; fakeSources gains a history that knows nothing.
interface BarAnswer { bars: PriceBar[]; partial: boolean; unavailable: { reason: "no_key" | "no_bars"; message: string } | null }
function createBarService(deps: { db: Db; market?: MarketData; now?: () => number }): {
  minute(symbol: string, from: string, to: string): Promise<BarAnswer>;   // throws BarsUnreachable
  daily(symbol: string, to: string): Promise<BarAnswer>;
};
class BarsUnreachable extends Error {}
```

- **Endpoints**, called from the web as `api.api.bars[":symbol"].$get({ param, query: { from, to } })` and `api.api.bars[":symbol"].daily.$get({ param, query: { to } })`:
  - `GET /api/bars/:symbol?from=YYYY-MM-DD&to=YYYY-MM-DD` answers `{ symbol, bars, partial, unavailable }`;
  - `GET /api/bars/:symbol/daily?to=YYYY-MM-DD` answers the same;
  - a failure is 502 `{ error: "unreachable", message: "Alpaca didn't answer. Try again." }`;
  - a bad request is 400.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/bars.test.ts`:

```ts
import { nyWallClock, type PriceBar } from "@tj/core";
import { AlpacaError, type BarHistory } from "@tj/market-data";
import { describe, expect, it, vi } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const NOW = Date.UTC(2026, 8, 29, 18, 0); // Tue Sep 29, 14:00 ET
const bar = (date: string, minute: number, c: number): PriceBar => ({
  t: nyWallClock(date, minute),
  o: c,
  h: c,
  l: c,
  c,
  v: 100,
});
const FRIDAY = bar("2026-09-25", 570, 228);
const MONDAY = bar("2026-09-28", 571, 229.5);
const TODAY = bar("2026-09-29", 600, 231);

interface Answer {
  symbol: string;
  bars: PriceBar[];
  partial: boolean;
  unavailable: { reason: string; message: string } | null;
}

function setup(history: Partial<BarHistory> = {}, withKey = true) {
  const minuteBars = vi.fn(history.minuteBars ?? (async () => [FRIDAY, MONDAY, TODAY]));
  const dailyBars = vi.fn(history.dailyBars ?? (async () => []));
  const market = createMarketData(withKey ? { keyId: "PKTEST", secretKey: "s" } : null, {
    build: () => fakeSources({ history: { minuteBars, dailyBars } }),
    log: () => {},
  });
  const app = testApp({ market, now: () => NOW });
  const get = async (path: string) => {
    const res = await app.request(path, { headers: LOCAL });
    return { status: res.status, body: (await res.json()) as Answer };
  };
  return { market, minuteBars, dailyBars, get };
}

describe("GET /api/bars/:symbol", () => {
  it("fetches the finished days of a past range once, then serves them from the cache", async () => {
    const { minuteBars, get } = setup({ minuteBars: async () => [FRIDAY, MONDAY] });
    const first = await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28");
    expect(first).toMatchObject({ status: 200, body: { symbol: "NVDA", bars: [FRIDAY, MONDAY], partial: false, unavailable: null } });
    expect(minuteBars).toHaveBeenCalledWith("NVDA", nyWallClock("2026-09-21", 0), nyWallClock("2026-09-29", 0));

    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28")).body.bars).toEqual([FRIDAY, MONDAY]);
    expect(minuteBars).toHaveBeenCalledTimes(1);
  });

  it("asks for today on its own, up to 16 minutes ago, and never caches it", async () => {
    const { minuteBars, get } = setup({
      minuteBars: async (_symbol, start) => (start === nyWallClock("2026-09-29", 0) ? [TODAY] : [FRIDAY, MONDAY]),
    });
    const answer = await get("/api/bars/NVDA?from=2026-09-22&to=2026-09-29");
    expect(answer.body).toMatchObject({ bars: [FRIDAY, MONDAY, TODAY], partial: true });
    expect(minuteBars).toHaveBeenCalledWith("NVDA", nyWallClock("2026-09-22", 0), nyWallClock("2026-09-29", 0));
    expect(minuteBars).toHaveBeenCalledWith("NVDA", nyWallClock("2026-09-29", 0), NOW - 16 * 60_000);

    await get("/api/bars/NVDA?from=2026-09-22&to=2026-09-29");
    // The finished days came from the cache; today was asked for again.
    expect(minuteBars).toHaveBeenCalledTimes(3);
    expect(minuteBars).toHaveBeenLastCalledWith("NVDA", nyWallClock("2026-09-29", 0), NOW - 16 * 60_000);
  });

  it("stores nothing when Alpaca fails, so the days are asked for again", async () => {
    let fail = true;
    const { minuteBars, get } = setup({
      minuteBars: async () => {
        if (fail) throw new AlpacaError(502, "");
        return [FRIDAY, MONDAY];
      },
    });
    const failed = await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28");
    expect(failed).toEqual({ status: 502, body: { error: "unreachable", message: "Alpaca didn't answer. Try again." } });

    fail = false;
    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-28")).body.bars).toEqual([FRIDAY, MONDAY]);
    expect(minuteBars).toHaveBeenCalledTimes(2);
  });

  it("treats the free plan's refusal of today's last minutes as no bars yet", async () => {
    const { get } = setup({
      minuteBars: async (_symbol, start) => {
        if (start === nyWallClock("2026-09-29", 0)) {
          throw new AlpacaError(403, "subscription does not permit querying recent SIP data");
        }
        return [MONDAY];
      },
    });
    expect((await get("/api/bars/NVDA?from=2026-09-28&to=2026-09-29")).body).toMatchObject({
      bars: [MONDAY],
      unavailable: null,
    });
  });

  it("says there are no bars for a symbol Alpaca doesn't carry, and remembers the empty days", async () => {
    const { minuteBars, get } = setup({ minuteBars: async () => [] });
    const answer = await get("/api/bars/SPX?from=2026-09-21&to=2026-09-28");
    expect(answer.body).toMatchObject({ bars: [], unavailable: { reason: "no_bars", message: "No stock bars for SPX." } });
    await get("/api/bars/SPX?from=2026-09-21&to=2026-09-28");
    expect(minuteBars).toHaveBeenCalledTimes(1);
  });

  it("asks for a key when it has to fetch, but serves days already cached without one", async () => {
    const { market, get } = setup({ minuteBars: async () => [FRIDAY] });
    await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-25");
    market.configure(null);
    expect((await get("/api/bars/NVDA?from=2026-09-21&to=2026-09-25")).body).toMatchObject({
      bars: [FRIDAY],
      unavailable: null,
    });
    expect((await get("/api/bars/NVDA?from=2026-09-14&to=2026-09-18")).body).toMatchObject({
      bars: [],
      unavailable: { reason: "no_key", message: "Add your Alpaca key in Settings to see the chart." },
    });
  });

  it("refuses a range that runs backwards or spans more than 45 days, or a bad symbol", async () => {
    const { get } = setup();
    expect((await get("/api/bars/NVDA?from=2026-09-28&to=2026-09-21")).status).toBe(400);
    expect((await get("/api/bars/NVDA?from=2026-06-01&to=2026-09-28")).status).toBe(400);
    expect((await get("/api/bars/nv%20da?from=2026-09-21&to=2026-09-28")).status).toBe(400);
  });
});

describe("GET /api/bars/:symbol/daily", () => {
  it("fetches two years of daily bars up to yesterday once, never today", async () => {
    const daily = bar("2026-09-25", 0, 771.35);
    const { dailyBars, get } = setup({ dailyBars: async () => [daily] });
    expect((await get("/api/bars/SPY/daily?to=2026-09-29")).body).toMatchObject({ bars: [daily], unavailable: null });
    expect(dailyBars).toHaveBeenCalledWith("SPY", "2024-09-28", "2026-09-28");

    await get("/api/bars/SPY/daily?to=2026-09-29");
    expect(dailyBars).toHaveBeenCalledTimes(1);
  });

  it("ends at the trade's last day when that's in the past", async () => {
    const { dailyBars, get } = setup();
    await get("/api/bars/SPY/daily?to=2026-07-17");
    expect(dailyBars).toHaveBeenCalledWith("SPY", "2024-07-17", "2026-07-17");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/server/src/bars.test.ts`
Expected: FAIL. `/api/bars` answers 404, and `fakeSources` has no `history`.

- [ ] **Step 3: Implement the service**

In `apps/server/src/marketData.ts`:
- import `alpacaHistory` and `type BarHistory` from `@tj/market-data`;
- add `history: BarHistory;` to `MarketSources`;
- in `alpacaSources`, add:

```ts
    // The chart's bars; finished days are cached in the database, so no cache here.
    history: alpacaHistory(keys),
```

In `apps/server/src/testing.ts`, add to `fakeSources`'s object: `history: { minuteBars: async () => [], dailyBars: async () => [] },`.

In `apps/server/src/routes/market.ts`, export `isoDate` (`export const isoDate = …`).

Create `apps/server/src/bars.ts`:

```ts
import { addDays, nyClock, nyDate, nyWallClock, type PriceBar, SESSION_END } from "@tj/core";
import { type BarTimeframe, createBarsRepo, type Db } from "@tj/db";
import { tooRecent } from "@tj/market-data";
import type { MarketData } from "./marketData.js";

/** Alpaca's free plan withholds the last 15 minutes; a minute more keeps clear of the edge. */
const RECENT_MS = 16 * 60_000;
/** Enough daily bars for a 167 EMA (spec §6). */
const DAILY_DAYS = 730;

export interface BarAnswer {
  bars: PriceBar[];
  /** Today's bars stop short of now: Alpaca's free data runs 15 minutes behind. */
  partial: boolean;
  unavailable: { reason: "no_key" | "no_bars"; message: string } | null;
}

/** Alpaca failed, and the cache didn't cover the range. */
export class BarsUnreachable extends Error {
  constructor() {
    super("Alpaca didn't answer. Try again.");
    this.name = "BarsUnreachable";
  }
}

const NO_KEY = { reason: "no_key" as const, message: "Add your Alpaca key in Settings to see the chart." };
const noBars = (symbol: string) => ({ reason: "no_bars" as const, message: `No stock bars for ${symbol}.` });

/** Every New York date from `from` to `to`, inclusive. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * The chart's bars (trade-chart spec §6): cached finished days, the missing ones fetched in one request and stored,
 * and today fetched on its own and never stored. Nothing is stored unless the fetch succeeded.
 */
export function createBarService({ db, market, now = Date.now }: { db: Db; market?: MarketData; now?: () => number }) {
  const repo = createBarsRepo(db);

  async function fill(
    symbol: string,
    timeframe: BarTimeframe,
    missing: readonly string[],
    fetch: (first: string, last: string) => Promise<PriceBar[]>,
  ): Promise<void> {
    const first = missing[0];
    const last = missing.at(-1);
    if (!first || !last) return;
    const byDay = new Map<string, PriceBar[]>();
    for (const bar of await fetch(first, last)) {
      const date = nyClock(bar.t).date;
      const day = byDay.get(date);
      if (day) day.push(bar);
      else byDay.set(date, [bar]);
    }
    repo.store(
      symbol,
      timeframe,
      missing.map((date) => ({ date, bars: byDay.get(date) ?? [] })),
      now(),
    );
  }

  return {
    async minute(symbol: string, from: string, to: string): Promise<BarAnswer> {
      const today = nyDate(now());
      const last = to < today ? to : today;
      const finished = datesBetween(from, last).filter((date) => date < today);
      const known = repo.knownDays(symbol, "1m", finished);
      const missing = finished.filter((date) => !known.has(date));
      const wantsToday = last === today && from <= today;
      const sources = market?.sources() ?? null;
      if ((missing.length > 0 || wantsToday) && !sources) return { bars: [], partial: false, unavailable: NO_KEY };

      let todays: PriceBar[] = [];
      let partial = false;
      try {
        if (sources && missing.length > 0) {
          await fill(symbol, "1m", missing, (first, lastDay) =>
            sources.history.minuteBars(symbol, nyWallClock(first, 0), nyWallClock(addDays(lastDay, 1), 0)),
          );
        }
        if (sources && wantsToday) {
          const start = nyWallClock(today, 0);
          const close = nyWallClock(today, SESSION_END);
          const end = Math.min(close, now() - RECENT_MS);
          partial = end < close;
          if (end > start) {
            todays = await sources.history.minuteBars(symbol, start, end).catch((error: unknown) => {
              if (tooRecent(error)) return [];
              throw error;
            });
          }
        }
      } catch (error) {
        sources?.report(error);
        throw new BarsUnreachable();
      }

      const lastFinished = finished.at(-1);
      const cached = lastFinished
        ? repo.read(symbol, "1m", nyWallClock(from, 0), nyWallClock(addDays(lastFinished, 1), 0) - 1)
        : [];
      const all = [...cached, ...todays];
      return { bars: all, partial, unavailable: all.length === 0 ? noBars(symbol) : null };
    },

    async daily(symbol: string, to: string): Promise<BarAnswer> {
      const today = nyDate(now());
      const last = to < today ? to : addDays(today, -1);
      const dates = datesBetween(addDays(last, -DAILY_DAYS), last);
      const known = repo.knownDays(symbol, "1d", dates);
      const missing = dates.filter((date) => !known.has(date));
      const sources = market?.sources() ?? null;
      if (missing.length > 0 && !sources) return { bars: [], partial: false, unavailable: NO_KEY };
      try {
        if (sources && missing.length > 0) {
          await fill(symbol, "1d", missing, (first, lastDay) => sources.history.dailyBars(symbol, first, lastDay));
        }
      } catch (error) {
        sources?.report(error);
        throw new BarsUnreachable();
      }
      const first = dates[0] ?? last;
      const all = repo.read(symbol, "1d", nyWallClock(first, 0), nyWallClock(last, 0));
      return { bars: all, partial: false, unavailable: all.length === 0 ? noBars(symbol) : null };
    },
  };
}

export type BarService = ReturnType<typeof createBarService>;
```

- [ ] **Step 4: Implement the routes and wire them in**

Create `apps/server/src/routes/bars.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { addDays } from "@tj/core";
import { Hono } from "hono";
import { z } from "zod";
import { type BarService, BarsUnreachable } from "../bars.js";
import { isoDate } from "./market.js";
import { TICKER } from "./quotes.js";

/** The longest intraday range: a trade held a few weeks, plus its warm-up week. */
const MAX_DAYS = 45;
const UNREACHABLE = { error: "unreachable", message: "Alpaca didn't answer. Try again." };

/** The chart's bars (trade-chart spec §6). */
export function barRoutes(service: BarService) {
  return new Hono()
    .get("/:symbol", zValidator("query", z.object({ from: isoDate, to: isoDate })), async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      const { from, to } = c.req.valid("query");
      if (!TICKER.test(symbol) || from > to || addDays(from, MAX_DAYS) < to) {
        return c.json({ error: "bad request" }, 400);
      }
      try {
        const answer = await service.minute(symbol, from, to);
        return c.json({ symbol, bars: answer.bars, partial: answer.partial, unavailable: answer.unavailable }, 200);
      } catch (error) {
        if (error instanceof BarsUnreachable) return c.json(UNREACHABLE, 502);
        throw error;
      }
    })
    .get("/:symbol/daily", zValidator("query", z.object({ to: isoDate })), async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      if (!TICKER.test(symbol)) return c.json({ error: "bad request" }, 400);
      try {
        const answer = await service.daily(symbol, c.req.valid("query").to);
        return c.json({ symbol, bars: answer.bars, partial: answer.partial, unavailable: answer.unavailable }, 200);
      } catch (error) {
        if (error instanceof BarsUnreachable) return c.json(UNREACHABLE, 502);
        throw error;
      }
    });
}
```

In `apps/server/src/app.ts`:
- import `createBarService` from `./bars.js` and `barRoutes` from `./routes/bars.js`;
- add `.route("/api/bars", barRoutes(createBarService({ db: deps.db, market: deps.market, now: deps.now })))` to the chain before `.route("/api", marketRoutes(deps.market))`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/server`
Expected: PASS, including the existing move-data tests, whose `fakeSources` now also has a `history`.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server/src
git commit -m "feat(server): serve the chart's bars, caching finished days and fetching today on its own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If `pnpm typecheck` reports TS2742 in `apps/web/src/api.ts`, spell the offending type out inline in the route's answer.

---

### Task 6: Chart preferences and the chart model (web, pure)

**Files:**
- Create: `apps/web/src/chart/prefs.ts`, `apps/web/src/chart/prefs.test.ts`
- Create: `apps/web/src/chart/model.ts`, `apps/web/src/chart/model.test.ts`

**Interfaces:**
- Consumes: `aggregate`, `addDays`, `Candle`, `dailyFromMinutes`, `ema`, `nyClock`, `PriceBar`, `sessionLevels` and `vwap` (`@tj/core`, Tasks 1–2).
- Produces:

```ts
// prefs.ts
const TIMEFRAMES: readonly [1, 2, 3, 5, 10, 15, 30, 60];
function timeframeLabel(minutes: number): string;          // "3m", "1h"
const TOGGLES: readonly ["ema0", "ema1", "ema2", "ema3", "vwap", "pm", "pd", "volume"];
type Toggle = (typeof TOGGLES)[number];
interface ChartPrefs { minutes: number; show: Record<Toggle, boolean>; emaLengths: number[] }
const DEFAULT_PREFS: ChartPrefs;
function loadPrefs(): ChartPrefs; function savePrefs(prefs: ChartPrefs): void;
function useChartPrefs(): [ChartPrefs, (next: ChartPrefs) => void];
// model.ts
interface ChartFill { executedAt: number; quantity: number; price: number; kind: string; canceled: boolean }
interface ChartTrade { openedAt: number; closedAt: number | null; fills: readonly ChartFill[]; legs: readonly { quantity: number; openPrice: number; closePrice: number | null }[] }
interface Point { t: number; value: number }
interface Marker { t: number; side: "buy" | "sell" | "expired" | "held"; text: string }
interface LevelLine { label: "PM H" | "PM L" | "PD H" | "PD L"; kind: "pm" | "pd"; price: number }
interface EmaLine { length: number; points: Point[] }
interface ViewWindow { from: number; to: number }   // candle indexes
interface IntradayModel { candles: Candle[]; emas: EmaLine[]; vwap: Point[]; levels: LevelLine[]; levelTimes: number[]; markers: Marker[]; window: ViewWindow | null }
interface DailyModel { candles: PriceBar[]; emas: EmaLine[]; markers: Marker[]; window: ViewWindow | null }
const WINDOW_PAD = 20;
function priceText(value: number): string;
function tradeMarks(trade: ChartTrade): Marker[];
function intradayModel(bars: readonly PriceBar[], trade: ChartTrade, minutes: number, emaLengths: readonly number[]): IntradayModel;
function dailyModel(daily: readonly PriceBar[], minuteBars: readonly PriceBar[], trade: ChartTrade, emaLengths: readonly number[], lastDay: string): DailyModel;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/chart/prefs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.js";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("chart preferences", () => {
  it("starts on 3m with every indicator on and EMAs 8, 20, 50 and 167", () => {
    expect(loadPrefs()).toEqual({
      minutes: 3,
      show: { ema0: true, ema1: true, ema2: true, ema3: true, vwap: true, pm: true, pd: true, volume: true },
      emaLengths: [8, 20, 50, 167],
    });
  });

  it("remembers the last choices in this browser", () => {
    savePrefs({ ...DEFAULT_PREFS, minutes: 5, show: { ...DEFAULT_PREFS.show, vwap: false }, emaLengths: [9, 21, 50, 200] });
    expect(loadPrefs()).toMatchObject({ minutes: 5, show: { vwap: false, pd: true }, emaLengths: [9, 21, 50, 200] });
  });

  it("falls back to the defaults for anything it doesn't recognise", () => {
    localStorage.setItem("tj.chart", "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("tj.chart", JSON.stringify({ minutes: 4, show: { vwap: false, bogus: false } }));
    expect(loadPrefs()).toMatchObject({ minutes: 3, show: { vwap: false } });
    expect(loadPrefs().show).not.toHaveProperty("bogus");
  });

  it("works when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(DEFAULT_PREFS)).not.toThrow();
  });
});
```

Create `apps/web/src/chart/model.test.ts`:

```ts
import { nyWallClock, type PriceBar } from "@tj/core";
import { describe, expect, it } from "vitest";
import { type ChartTrade, dailyModel, intradayModel, priceText, tradeMarks } from "./model.js";

/** One-minute bars on `date` from minute `from` to `to` (exclusive), rising a cent a minute. */
const minutesOf = (date: string, from: number, to: number, price: number): PriceBar[] =>
  Array.from({ length: to - from }, (_, index) => {
    const c = price + index * 0.01;
    return { t: nyWallClock(date, from + index), o: c, h: c + 0.05, l: c - 0.05, c, v: 1_000 };
  });
const DAY = "2026-09-28";
const SEP_28 = minutesOf(DAY, 240, 1200, 229); // 04:00–20:00

/** This morning's NVDA 232.5C scalp, as synced from IBKR. */
const fill = (at: number, quantity: number, price: number, extra: Partial<ChartTrade["fills"][number]> = {}) => ({
  executedAt: at,
  quantity,
  price,
  kind: "trade",
  canceled: false,
  ...extra,
});
const NVDA: ChartTrade = {
  openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
  closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
  fills: [
    fill(Date.UTC(2026, 8, 28, 13, 31, 5), 1, 1.06),
    fill(Date.UTC(2026, 8, 28, 13, 31, 5), 1, 1.06),
    fill(Date.UTC(2026, 8, 28, 13, 31, 49), -1, 1.44),
    fill(Date.UTC(2026, 8, 28, 13, 46, 12), -1, 1.15),
  ],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};

describe("priceText", () => {
  it("shows two decimals, or more when the price has them", () => {
    expect([priceText(1.06), priceText(1.295), priceText(4.2)]).toEqual(["1.06", "1.295", "4.20"]);
  });
});

describe("tradeMarks", () => {
  it("marks each fill with its side, size and price", () => {
    expect(tradeMarks(NVDA).map((mark) => [mark.side, mark.text])).toEqual([
      ["buy", "B 1 @ 1.06"],
      ["buy", "B 1 @ 1.06"],
      ["sell", "S 1 @ 1.44"],
      ["sell", "S 1 @ 1.15"],
    ]);
  });

  it("leaves canceled fills out and labels expiries", () => {
    const marks = tradeMarks({
      ...NVDA,
      fills: [fill(1, 1, 1, { canceled: true }), fill(2, -1, 0, { kind: "expiration" })],
    });
    expect(marks).toEqual([{ t: 2, side: "expired", text: "expired" }]);
  });

  it("marks a trade typed in by hand at its open and close", () => {
    expect(tradeMarks({ ...NVDA, fills: [] }).map((mark) => mark.text)).toEqual(["B 2 @ 1.06", "S 2 @ 1.295"]);
    const fly = tradeMarks({
      ...NVDA,
      fills: [],
      legs: [
        { quantity: -2, openPrice: 1.37, closePrice: 0.325 },
        { quantity: 2, openPrice: 0.13, closePrice: 0 },
      ],
    });
    expect(fly.map((mark) => mark.text)).toEqual(["Open", "Close"]);
  });
});

describe("intradayModel", () => {
  const model = intradayModel(SEP_28, NVDA, 3, [8, 20, 50, 167]);

  it("puts each fill on the 3-minute candle it happened in", () => {
    expect(model.markers.map((marker) => [marker.t, marker.text])).toEqual([
      [nyWallClock(DAY, 570), "B 1 @ 1.06"],
      [nyWallClock(DAY, 570), "B 1 @ 1.06"],
      [nyWallClock(DAY, 570), "S 1 @ 1.44"],
      [nyWallClock(DAY, 585), "S 1 @ 1.15"],
    ]);
  });

  it("opens 20 candles before the first fill to 20 after the last", () => {
    // 3m candles from 04:00: 09:30 is candle 110 and 09:45 is candle 115.
    expect(model.candles).toHaveLength(320);
    expect(model.window).toEqual({ from: 90, to: 135 });
  });

  it("keeps a fill outside the bars off the chart, or on the last candle, and keeps the window valid", () => {
    const early = intradayModel(SEP_28, { ...NVDA, fills: [fill(nyWallClock(DAY, 238), 1, 1)] }, 3, [8]);
    expect(early.markers).toEqual([]);
    expect(early.window).toEqual({ from: 0, to: 20 });
    const late = intradayModel(SEP_28, { ...NVDA, fills: [fill(nyWallClock("2026-09-29", 5), -1, 1)] }, 3, [8]);
    expect(late.markers.map((marker) => marker.t)).toEqual([nyWallClock(DAY, 1197)]);
    expect(late.window).toEqual({ from: 299, to: 319 });
  });

  it("draws an EMA only where it has enough history", () => {
    // 320 candles: EMA 8 starts at candle 23; EMA 167 needs 501 and has none.
    expect(model.emas.map((line) => line.length)).toEqual([8, 20, 50, 167]);
    expect(model.emas[0]?.points[0]?.t).toBe(model.candles[23]?.t);
    expect(model.emas[3]?.points).toEqual([]);
  });

  it("draws the premarket and prior-day levels across the trade's first day only", () => {
    const withPriorDay = [...minutesOf("2026-09-25", 570, 960, 200), ...SEP_28];
    const levels = intradayModel(withPriorDay, NVDA, 3, [8]);
    expect(levels.levels.map((level) => level.label)).toEqual(["PM H", "PM L", "PD H", "PD L"]);
    expect(levels.levels[0]?.price).toBeCloseTo(232.34, 6); // 229 + 329 minutes × 0.01 + 0.05
    expect(levels.levels[1]?.price).toBeCloseTo(228.95, 6);
    expect(levels.levels[2]?.price).toBeCloseTo(203.94, 6); // 200 + 389 × 0.01 + 0.05
    expect(levels.levels[3]?.price).toBeCloseTo(199.95, 6);
    expect(levels.levelTimes[0]).toBe(nyWallClock(DAY, 240));
    expect(levels.levelTimes).toHaveLength(320);
  });

  it("has no VWAP before 09:30", () => {
    expect(model.vwap[0]?.t).toBe(nyWallClock(DAY, 570));
  });
});

describe("dailyModel", () => {
  it("adds today's candle from its minute bars, since Alpaca's daily bar comes only once the day is over", () => {
    const daily = [
      { t: nyWallClock("2026-09-24", 0), o: 1, h: 1, l: 1, c: 1, v: 1 },
      { t: nyWallClock("2026-09-25", 0), o: 2, h: 2, l: 2, c: 2, v: 2 },
    ];
    const today = { ...NVDA, openedAt: nyWallClock("2026-09-29", 571), closedAt: nyWallClock("2026-09-29", 590) };
    const model = dailyModel(daily, minutesOf("2026-09-29", 570, 960, 230), today, [8], "2026-09-29");
    expect(model.candles.map((candle) => candle.t)).toEqual([
      nyWallClock("2026-09-24", 0),
      nyWallClock("2026-09-25", 0),
      nyWallClock("2026-09-29", 0),
    ]);
    expect(model.candles[2]).toMatchObject({ o: 230, c: 233.89 });
    expect(model.markers).toEqual([{ t: nyWallClock("2026-09-29", 0), side: "held", text: "" }]);
    expect(model.window).toEqual({ from: 0, to: 2 });
  });

  it("shows about six months, ending on the trade's last day", () => {
    const daily = Array.from({ length: 300 }, (_, index) => ({ t: index * 86_400_000, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    expect(dailyModel(daily, [], NVDA, [8], DAY).window).toEqual({ from: 174, to: 299 });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/chart`
Expected: FAIL, because `./prefs.js` and `./model.js` don't exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/chart/prefs.ts`:

```ts
import { useState } from "react";
import { z } from "zod";

export const TIMEFRAMES = [1, 2, 3, 5, 10, 15, 30, 60] as const;
export const timeframeLabel = (minutes: number): string => (minutes === 60 ? "1h" : `${minutes}m`);
export const TOGGLES = ["ema0", "ema1", "ema2", "ema3", "vwap", "pm", "pd", "volume"] as const;
export type Toggle = (typeof TOGGLES)[number];

export interface ChartPrefs {
  minutes: number;
  show: Record<Toggle, boolean>;
  emaLengths: number[];
}

export const DEFAULT_PREFS: ChartPrefs = {
  minutes: 3,
  show: { ema0: true, ema1: true, ema2: true, ema3: true, vwap: true, pm: true, pd: true, volume: true },
  emaLengths: [8, 20, 50, 167],
};

const KEY = "tj.chart";
const savedSchema = z.object({
  minutes: z
    .number()
    .refine((minutes) => (TIMEFRAMES as readonly number[]).includes(minutes))
    .optional()
    .catch(undefined),
  show: z.record(z.string(), z.boolean()).optional().catch(undefined),
  emaLengths: z.array(z.number().int().min(1).max(500)).length(4).optional().catch(undefined),
});

/** This browser's chart choices (spec §8). Storage can be missing or refuse, so anything odd falls back to the defaults. */
export function loadPrefs(): ChartPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = savedSchema.parse(JSON.parse(raw));
    const show = { ...DEFAULT_PREFS.show };
    for (const toggle of TOGGLES) {
      const value = saved.show?.[toggle];
      if (typeof value === "boolean") show[toggle] = value;
    }
    return {
      minutes: saved.minutes ?? DEFAULT_PREFS.minutes,
      show,
      emaLengths: saved.emaLengths ?? DEFAULT_PREFS.emaLengths,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: ChartPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

/** The prefs, and a setter that remembers them. */
export function useChartPrefs(): [ChartPrefs, (next: ChartPrefs) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  return [
    prefs,
    (next) => {
      savePrefs(next);
      setPrefs(next);
    },
  ];
}
```

Create `apps/web/src/chart/model.ts`:

```ts
import {
  addDays,
  aggregate,
  type Candle,
  dailyFromMinutes,
  ema,
  nyClock,
  type PriceBar,
  sessionLevels,
  vwap,
} from "@tj/core";

/** What the chart needs of a trade: its fills, or, for one typed in, its times and legs. */
export interface ChartFill {
  executedAt: number;
  quantity: number;
  price: number;
  kind: string;
  canceled: boolean;
}
export interface ChartTrade {
  openedAt: number;
  closedAt: number | null;
  fills: readonly ChartFill[];
  legs: readonly { quantity: number; openPrice: number; closePrice: number | null }[];
}

export interface Point {
  t: number;
  value: number;
}
export interface Marker {
  t: number;
  side: "buy" | "sell" | "expired" | "held";
  text: string;
}
export interface LevelLine {
  label: "PM H" | "PM L" | "PD H" | "PD L";
  kind: "pm" | "pd";
  price: number;
}
export interface EmaLine {
  length: number;
  points: Point[];
}
/** Candle indexes, as the chart's logical range. */
export interface ViewWindow {
  from: number;
  to: number;
}
export interface IntradayModel {
  candles: Candle[];
  emas: EmaLine[];
  vwap: Point[];
  levels: LevelLine[];
  /** The candles of the trade's first day, which the levels span. */
  levelTimes: number[];
  markers: Marker[];
  window: ViewWindow | null;
}
export interface DailyModel {
  candles: PriceBar[];
  emas: EmaLine[];
  markers: Marker[];
  window: ViewWindow | null;
}

/** Candles shown either side of the trade when the chart opens (spec §8). */
export const WINDOW_PAD = 20;
/** About six months of trading days. */
const DAILY_VISIBLE = 126;

/** A price as the trader reads it: two decimals, or more when it has them (1.295). */
export function priceText(value: number): string {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6 ? value.toFixed(2) : String(Number(value.toFixed(4)));
}

/** The trade's fills at their own times (spec §8), or, for a trade typed in by hand, its open and close. */
export function tradeMarks(trade: ChartTrade): Marker[] {
  const fills = trade.fills.filter((fill) => !fill.canceled);
  if (fills.length > 0) {
    return fills.map((fill): Marker => {
      if (fill.kind === "expiration") return { t: fill.executedAt, side: "expired", text: "expired" };
      const bought = fill.quantity > 0;
      return {
        t: fill.executedAt,
        side: bought ? "buy" : "sell",
        text: `${bought ? "B" : "S"} ${Math.abs(fill.quantity)} @ ${priceText(fill.price)}`,
      };
    });
  }
  const [leg] = trade.legs;
  if (trade.legs.length === 1 && leg) {
    const long = leg.quantity > 0;
    const size = Math.abs(leg.quantity);
    const marks: Marker[] = [
      { t: trade.openedAt, side: long ? "buy" : "sell", text: `${long ? "B" : "S"} ${size} @ ${priceText(leg.openPrice)}` },
    ];
    if (trade.closedAt != null && leg.closePrice != null) {
      marks.push({
        t: trade.closedAt,
        side: long ? "sell" : "buy",
        text: `${long ? "S" : "B"} ${size} @ ${priceText(leg.closePrice)}`,
      });
    }
    return marks;
  }
  const marks: Marker[] = [{ t: trade.openedAt, side: "buy", text: "Open" }];
  if (trade.closedAt != null) marks.push({ t: trade.closedAt, side: "sell", text: "Close" });
  return marks;
}

/** The index of the candle holding `t`: the last one that starts at or before it, or −1 before the first. */
function candleAt(candles: readonly { t: number }[], t: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((candles[middle]?.t ?? Number.POSITIVE_INFINITY) <= t) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

const drawable = (candles: readonly { t: number }[], values: readonly (number | null)[]): Point[] =>
  values.flatMap((value, index) => {
    const candle = candles[index];
    return value === null || !candle ? [] : [{ t: candle.t, value }];
  });

/** The opening view (spec §8): WINDOW_PAD candles before the first mark to as many after the last. */
function openingWindow(candles: readonly { t: number }[], marks: readonly Marker[]): ViewWindow | null {
  if (candles.length === 0 || marks.length === 0) return null;
  const times = marks.map((mark) => mark.t);
  const first = Math.max(0, candleAt(candles, Math.min(...times)));
  const last = Math.max(first, candleAt(candles, Math.max(...times)));
  return { from: Math.max(0, first - WINDOW_PAD), to: Math.min(candles.length - 1, last + WINDOW_PAD) };
}

/** Everything the intraday chart draws, from 1-minute bars (spec §7–8). */
export function intradayModel(
  bars: readonly PriceBar[],
  trade: ChartTrade,
  minutes: number,
  emaLengths: readonly number[],
): IntradayModel {
  const candles = aggregate(bars, minutes);
  const closes = candles.map((candle) => candle.c);
  const firstDay = nyClock(trade.openedAt).date;
  const found = sessionLevels(bars, firstDay);
  const levels = (
    [
      ["PM H", "pm", found.pmHigh],
      ["PM L", "pm", found.pmLow],
      ["PD H", "pd", found.pdHigh],
      ["PD L", "pd", found.pdLow],
    ] as const
  ).flatMap(([label, kind, price]): LevelLine[] => (price === null ? [] : [{ label, kind, price }]));
  const marks = tradeMarks(trade);
  const markers = marks
    .flatMap((mark) => {
      const candle = candles[candleAt(candles, mark.t)];
      return candle ? [{ ...mark, t: candle.t }] : [];
    })
    .sort((a, b) => a.t - b.t);
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    vwap: drawable(candles, vwap(bars, candles)),
    levels,
    levelTimes: candles.filter((candle) => nyClock(candle.t).date === firstDay).map((candle) => candle.t),
    markers,
    window: openingWindow(candles, marks),
  };
}

/**
 * The daily chart beside it (spec §8). Alpaca's daily bars end the day before; the trade's own later days, such as
 * today, are built from their regular-session minute bars.
 */
export function dailyModel(
  daily: readonly PriceBar[],
  minuteBars: readonly PriceBar[],
  trade: ChartTrade,
  emaLengths: readonly number[],
  lastDay: string,
): DailyModel {
  const candles = [...daily];
  const firstDay = nyClock(trade.openedAt).date;
  const newest = candles.at(-1);
  const covered = newest ? nyClock(newest.t).date : "";
  for (let date = firstDay; date <= lastDay; date = addDays(date, 1)) {
    if (date <= covered) continue;
    const day = dailyFromMinutes(minuteBars, date);
    if (day) candles.push(day);
  }
  const closes = candles.map((candle) => candle.c);
  const markers = candles
    .filter((candle) => {
      const date = nyClock(candle.t).date;
      return date >= firstDay && date <= lastDay;
    })
    .map((candle): Marker => ({ t: candle.t, side: "held", text: "" }));
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    markers,
    window: candles.length === 0 ? null : { from: Math.max(0, candles.length - DAILY_VISIBLE), to: candles.length - 1 },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/chart`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/chart
git commit -m "feat(web): chart preferences, and a pure model of what the trade charts draw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The intraday and daily charts, and the toolbar

**Files:**
- Create: `apps/web/src/chart/testing.ts` (a stand-in for Lightweight Charts, for tests)
- Create: `apps/web/src/chart/style.ts`
- Create: `apps/web/src/chart/IntradayChart.tsx`, `apps/web/src/chart/DailyChart.tsx`, `apps/web/src/chart/ChartToolbar.tsx`
- Create: `apps/web/src/chart/charts.test.tsx`

**Interfaces:**
- Consumes: the Task 6 model and prefs, and `nyTickLabel` (`apps/web/src/analytics/equityData.ts`).
- Produces:

```ts
interface PriceLine { price: number; color: string; dashed: boolean; label: string }   // for the scalp review's stop and target
function IntradayChart(props: { model: IntradayModel; show: Record<Toggle, boolean>; fitKey: number; lines?: readonly PriceLine[]; height?: number }): JSX.Element;
function DailyChart(props: { model: DailyModel; show: Record<Toggle, boolean>; fitKey: number; height?: number }): JSX.Element;
function ChartToolbar(props: { prefs: ChartPrefs; onChange: (next: ChartPrefs) => void; hiddenEmas: readonly number[]; onFit: () => void }): JSX.Element;
// testing.ts
const library: { charts: number; removed: number; series: FakeSeries[]; ranges: unknown[]; markers: unknown[][]; crosshair: ((param: { time?: unknown }) => void) | null };
function resetLibrary(): void;
function fakeLibrary(real: typeof import("lightweight-charts")): typeof import("lightweight-charts");
```

- [ ] **Step 1: Write the test stand-in and the failing tests**

Create `apps/web/src/chart/testing.ts`:

```ts
import type * as Charts from "lightweight-charts";

/** What a chart asked of one series. */
export interface FakeSeries {
  type: string;
  options: Record<string, unknown>;
  data: unknown[];
  applied: Record<string, unknown>[];
  priceLines: Record<string, unknown>[];
}

/** The canvas can't draw in jsdom. This records what the components ask of Lightweight Charts instead. */
export const library = {
  charts: 0,
  removed: 0,
  series: [] as FakeSeries[],
  ranges: [] as unknown[],
  markers: [] as unknown[][],
  crosshair: null as ((param: { time?: unknown }) => void) | null,
};

export function resetLibrary(): void {
  library.charts = 0;
  library.removed = 0;
  library.series = [];
  library.ranges = [];
  library.markers = [];
  library.crosshair = null;
}

/** The real module with `createChart` and `createSeriesMarkers` replaced by recorders. */
export function fakeLibrary(real: typeof Charts): typeof Charts {
  const createChart = () => {
    library.charts++;
    return {
      addSeries: (definition: { type?: string }, options: Record<string, unknown> = {}) => {
        const series: FakeSeries = { type: definition.type ?? "?", options, data: [], applied: [], priceLines: [] };
        library.series.push(series);
        return {
          setData: (data: unknown[]) => {
            series.data = data;
          },
          applyOptions: (applied: Record<string, unknown>) => {
            series.applied.push(applied);
          },
          createPriceLine: (line: Record<string, unknown>) => {
            series.priceLines.push(line);
            return line;
          },
          removePriceLine: (line: Record<string, unknown>) => {
            series.priceLines = series.priceLines.filter((each) => each !== line);
          },
        };
      },
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({
        setVisibleLogicalRange: (range: unknown) => {
          library.ranges.push(range);
        },
      }),
      subscribeCrosshairMove: (handler: (param: { time?: unknown }) => void) => {
        library.crosshair = handler;
      },
      unsubscribeCrosshairMove: () => {},
      remove: () => {
        library.removed++;
      },
    };
  };
  const createSeriesMarkers = () => ({
    setMarkers: (markers: unknown[]) => {
      library.markers.push(markers);
    },
  });
  return {
    ...real,
    createChart: createChart as unknown as typeof real.createChart,
    createSeriesMarkers: createSeriesMarkers as unknown as typeof real.createSeriesMarkers,
  };
}

/** The series of one kind, in the order the chart added them. */
export const seriesOf = (type: string): FakeSeries[] => library.series.filter((series) => series.type === type);
```

Create `apps/web/src/chart/charts.test.tsx`:

```tsx
import { nyWallClock, type PriceBar } from "@tj/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import { IntradayChart } from "./IntradayChart.js";
import { type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { DEFAULT_PREFS } from "./prefs.js";
import { library, resetLibrary, seriesOf } from "./testing.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

const DAY = "2026-09-28";
const minutesOf = (date: string, from: number, to: number, price: number): PriceBar[] =>
  Array.from({ length: to - from }, (_, index) => {
    const c = price + index * 0.01;
    return { t: nyWallClock(date, from + index), o: c, h: c + 0.05, l: c - 0.05, c, v: 1_000 };
  });
const BARS = [...minutesOf("2026-09-25", 570, 960, 200), ...minutesOf(DAY, 240, 1200, 229)];
const TRADE: ChartTrade = {
  openedAt: nyWallClock(DAY, 571),
  closedAt: nyWallClock(DAY, 586),
  fills: [
    { executedAt: nyWallClock(DAY, 571), quantity: 2, price: 1.06, kind: "trade", canceled: false },
    { executedAt: nyWallClock(DAY, 586), quantity: -2, price: 1.295, kind: "trade", canceled: false },
  ],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};
const MODEL = intradayModel(BARS, TRADE, 3, DEFAULT_PREFS.emaLengths);

beforeEach(() => resetLibrary());

describe("IntradayChart", () => {
  it("draws candles, lighter outside 09:30–16:00, with volume, EMAs, VWAP and the four levels", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    expect(library.charts).toBe(1);
    const [candles] = seriesOf("Candlestick");
    const drawn = candles?.data as { time: number; color?: string }[];
    expect(drawn).toHaveLength(MODEL.candles.length);
    expect(drawn[0]?.time).toBe(nyWallClock("2026-09-25", 570) / 1000);
    const premarket = drawn.find((candle) => candle.time === nyWallClock(DAY, 240) / 1000);
    expect(premarket?.color).toBe("rgba(38, 166, 154, 0.45)");
    const open = drawn.find((candle) => candle.time === nyWallClock(DAY, 570) / 1000);
    expect(open?.color).toBeUndefined();
    expect(seriesOf("Histogram")[0]?.data).toHaveLength(MODEL.candles.length);
    const lines = seriesOf("Line");
    expect(lines.map((line) => line.options.title ?? null)).toEqual([null, null, null, null, null, "PM H", "PM L", "PD H", "PD L"]);
    expect(lines[5]?.data).toHaveLength(MODEL.levelTimes.length);
  });

  it("marks the fills and opens on the trade", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const markers = library.markers.at(-1) as { text: string; position: string }[];
    expect(markers.map((marker) => [marker.text, marker.position])).toEqual([
      ["B 2 @ 1.06", "belowBar"],
      ["S 2 @ 1.295", "aboveBar"],
    ]);
    expect(library.ranges.at(-1)).toEqual(MODEL.window);
  });

  it("goes back to the trade on Fit trade, and builds the chart only once", () => {
    const { rerender } = render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const opened = library.ranges.length;
    rerender(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={1} />);
    expect(library.ranges.length).toBe(opened + 1);
    expect(library.charts).toBe(1);
  });

  it("hides what's toggled off", () => {
    render(<IntradayChart model={MODEL} show={{ ...DEFAULT_PREFS.show, vwap: false, pd: false }} fitKey={0} />);
    const lines = seriesOf("Line");
    expect(lines[4]?.applied.at(-1)).toEqual({ visible: false });
    expect(lines[7]?.applied.at(-1)).toEqual({ visible: false });
    expect(lines[5]?.applied.at(-1)).toEqual({ visible: true });
  });

  it("draws extra lines, such as the review's stop and target, on the price axis", () => {
    const lines = [{ price: 228.4, color: "#ef5350", dashed: true, label: "Stop" }];
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={lines} />);
    expect(seriesOf("Candlestick")[0]?.priceLines).toEqual([
      expect.objectContaining({ price: 228.4, color: "#ef5350", title: "Stop" }),
    ]);
  });

  it("shows the hovered candle's prices and indicators in the legend", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const candle = MODEL.candles.find((each) => each.t === nyWallClock(DAY, 570));
    act(() => library.crosshair?.({ time: nyWallClock(DAY, 570) / 1000 }));
    const legend = screen.getByTestId("chart-legend").textContent ?? "";
    expect(legend).toContain("09:30");
    expect(legend).toContain(`O ${candle?.o.toFixed(2)}`);
    expect(legend).toContain("VWAP");
  });
});

describe("DailyChart", () => {
  it("draws daily candles by date, with the trade's days marked, opening on the last six months", () => {
    const daily = [
      { t: nyWallClock("2026-09-24", 0), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: nyWallClock("2026-09-25", 0), o: 1.5, h: 2, l: 1, c: 1.8, v: 10 },
      { t: nyWallClock(DAY, 0), o: 1.8, h: 2.2, l: 1.7, c: 2, v: 10 },
    ];
    const model = dailyModel(daily, [], TRADE, DEFAULT_PREFS.emaLengths, DAY);
    render(<DailyChart model={model} show={DEFAULT_PREFS.show} fitKey={0} />);
    const drawn = seriesOf("Candlestick")[0]?.data as { time: string }[];
    expect(drawn.map((candle) => candle.time)).toEqual(["2026-09-24", "2026-09-25", DAY]);
    expect((library.markers.at(-1) as { time: string }[]).map((marker) => marker.time)).toEqual([DAY]);
    expect(library.ranges.at(-1)).toEqual({ from: 0, to: 2 });
  });
});

describe("ChartToolbar", () => {
  it("switches timeframes, toggles indicators, and fits the trade", () => {
    const onChange = vi.fn();
    const onFit = vi.fn();
    render(<ChartToolbar prefs={DEFAULT_PREFS} onChange={onChange} hiddenEmas={[3]} onFit={onFit} />);
    expect(screen.getByRole("button", { name: "3m" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "5m" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREFS, minutes: 5 });
    fireEvent.click(screen.getByRole("button", { name: "VWAP" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREFS, show: { ...DEFAULT_PREFS.show, vwap: false } });
    expect(screen.getByRole("button", { name: "EMA 167" }).getAttribute("title")).toBe("needs more history");
    expect(screen.getByRole("button", { name: "EMA 8" }).getAttribute("title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fit trade" }));
    expect(onFit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/chart/charts.test.tsx`
Expected: FAIL, because the components don't exist.

- [ ] **Step 3: Implement the shared style**

Create `apps/web/src/chart/style.ts`:

```ts
import { ColorType, type DeepPartial, type ChartOptions, type Time, type TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { nyTickLabel } from "../analytics/equityData.js";

export const COLORS = {
  up: "#26a69a",
  down: "#ef5350",
  upExtended: "rgba(38, 166, 154, 0.45)",
  downExtended: "rgba(239, 83, 80, 0.45)",
  volumeUp: "rgba(38, 166, 154, 0.35)",
  volumeDown: "rgba(239, 83, 80, 0.35)",
  vwap: "#e0e0e0",
  pm: "#82a8ff",
  pd: "#ffb74d",
  held: "#2962ff",
};
/** EMA 1–4 (8, 20, 50, 167 by default). */
export const EMA_COLORS = ["#f7c948", "#26c6da", "#ab47bc", "#ff7043"] as const;

/** Epoch ms as the chart's UTC seconds. */
export const seconds = (t: number) => Math.floor(t / 1000) as UTCTimestamp;

const NY_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** A candle's time in New York, e.g. "Sep 28, 09:30". */
export const nyTimeText = (t: number) => NY_TIME.format(new Date(t));

/** The app's chart look (the Terminal theme). Lightweight Charts has no timezone option, so times are formatted in New York. */
export function chartOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#131722" },
      textColor: "#6b7385",
      fontSize: 10,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
    },
    grid: { vertLines: { color: "#1a1e29" }, horzLines: { color: "#1a1e29" } },
    rightPriceScale: { borderColor: "#1f2430" },
    timeScale: {
      borderColor: "#1f2430",
      timeVisible: intraday,
      tickMarkFormatter: (time: Time, type: TickMarkType) =>
        typeof time === "number" ? nyTickLabel(time, type) : String(time),
    },
    localization: {
      timeFormatter: (time: Time) => (typeof time === "number" ? nyTimeText(time * 1000) : String(time)),
    },
  };
}
```

- [ ] **Step 4: Implement the charts and the toolbar**

Create `apps/web/src/chart/IntradayChart.tsx`:

```tsx
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IntradayModel, LevelLine, Marker, Point } from "./model.js";
import type { Toggle } from "./prefs.js";
import { chartOptions, COLORS, EMA_COLORS, nyTimeText, seconds } from "./style.js";

/** An extra horizontal line, such as the scalp review's stop or target. */
export interface PriceLine {
  price: number;
  color: string;
  dashed: boolean;
  label: string;
}

const LEVELS: LevelLine["label"][] = ["PM H", "PM L", "PD H", "PD L"];
const NO_LINES: readonly PriceLine[] = [];

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  emas: ISeriesApi<"Line">[];
  vwap: ISeriesApi<"Line">;
  levels: Map<LevelLine["label"], ISeriesApi<"Line">>;
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
}

const line = (point: Point) => ({ time: seconds(point.t), value: point.value });

/** How a fill's arrow looks: buys below the candle pointing up, sells above pointing down (spec §8). */
export function markerLook(marker: Marker) {
  if (marker.side === "buy") return { position: "belowBar" as const, shape: "arrowUp" as const, color: COLORS.up };
  if (marker.side === "sell") return { position: "aboveBar" as const, shape: "arrowDown" as const, color: COLORS.down };
  if (marker.side === "held") return { position: "aboveBar" as const, shape: "circle" as const, color: COLORS.held };
  return { position: "aboveBar" as const, shape: "square" as const, color: "#6b7385" };
}

/** The 3-minute (or chosen) chart of the trade's day (spec §8). Built once; data and options update in place. */
export function IntradayChart({
  model,
  show,
  fitKey,
  lines = NO_LINES,
  height = 420,
}: {
  model: IntradayModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  lines?: readonly PriceLine[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const times = useRef<number[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, chartOptions(true));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const quiet = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const emas = EMA_COLORS.map((color) => chart.addSeries(LineSeries, { color, ...quiet }));
    const vwap = chart.addSeries(LineSeries, { color: COLORS.vwap, ...quiet });
    const levels = new Map(
      LEVELS.map((label) => [
        label,
        chart.addSeries(LineSeries, {
          color: label.startsWith("PM") ? COLORS.pm : COLORS.pd,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: label,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        }),
      ]),
    );
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((param) => {
      if (typeof param.time !== "number") {
        setHovered(null);
        return;
      }
      setHovered(times.current.indexOf(param.time * 1000));
    });
    parts.current = { chart, candles, volume, emas, vwap, levels, markers, priceLines: [] };
    return () => {
      chart.remove();
      parts.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    times.current = model.candles.map((candle) => candle.t);
    chart.candles.setData(
      model.candles.map((candle) => {
        const bar = { time: seconds(candle.t), open: candle.o, high: candle.h, low: candle.l, close: candle.c };
        if (!candle.extended) return bar;
        const color = candle.c >= candle.o ? COLORS.upExtended : COLORS.downExtended;
        return { ...bar, color, wickColor: color, borderColor: color };
      }),
    );
    chart.volume.setData(
      model.candles.map((candle) => ({
        time: seconds(candle.t),
        value: candle.v,
        color: candle.c >= candle.o ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );
    chart.emas.forEach((series, index) => series.setData((model.emas[index]?.points ?? []).map(line)));
    chart.vwap.setData(model.vwap.map(line));
    for (const [label, series] of chart.levels) {
      const level = model.levels.find((each) => each.label === label);
      series.setData(level ? model.levelTimes.map((t) => ({ time: seconds(t), value: level.price })) : []);
    }
    chart.markers.setMarkers(
      model.markers.map((marker) => ({ time: seconds(marker.t), text: marker.text, ...markerLook(marker) })),
    );
  }, [model]);

  // The opening view: on first data, on a new timeframe, and on Fit trade.
  const from = model.window?.from;
  const to = model.window?.to;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the Fit trade button's request to re-apply
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    parts.current?.chart.timeScale().setVisibleLogicalRange({ from, to });
  }, [from, to, fitKey]);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    chart.emas.forEach((series, index) => series.applyOptions({ visible: show[`ema${index}` as Toggle] }));
    chart.vwap.applyOptions({ visible: show.vwap });
    for (const [label, series] of chart.levels) {
      series.applyOptions({ visible: label.startsWith("PM") ? show.pm : show.pd });
    }
    chart.volume.applyOptions({ visible: show.volume });
  }, [show]);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    for (const priceLine of chart.priceLines) chart.candles.removePriceLine(priceLine);
    chart.priceLines = lines.map((each) =>
      chart.candles.createPriceLine({
        price: each.price,
        color: each.color,
        lineWidth: 1,
        lineStyle: each.dashed ? LineStyle.Dashed : LineStyle.Solid,
        title: each.label,
        axisLabelVisible: true,
      }),
    );
  }, [lines]);

  const values = useMemo(
    () => ({
      emas: model.emas.map((each) => new Map(each.points.map((point) => [point.t, point.value]))),
      vwap: new Map(model.vwap.map((point) => [point.t, point.value])),
    }),
    [model],
  );
  const candle = model.candles[hovered ?? model.candles.length - 1];

  return (
    <div className="relative" style={{ height }}>
      <div ref={container} className="absolute inset-0" data-testid="intraday-chart" />
      {candle && (
        <div
          data-testid="chart-legend"
          className="num pointer-events-none absolute top-1 left-2 z-10 flex flex-wrap gap-x-2 text-[10px] text-muted"
        >
          <span className="text-fg">{nyTimeText(candle.t)}</span>
          <span>
            O {candle.o.toFixed(2)} H {candle.h.toFixed(2)} L {candle.l.toFixed(2)} C {candle.c.toFixed(2)}
          </span>
          <span>V {candle.v.toLocaleString("en-US")}</span>
          {model.emas.map((each, index) => {
            const value = values.emas[index]?.get(candle.t);
            return show[`ema${index}` as Toggle] && value !== undefined ? (
              <span key={each.length} style={{ color: EMA_COLORS[index] }}>
                EMA {each.length} {value.toFixed(2)}
              </span>
            ) : null;
          })}
          {show.vwap && values.vwap.has(candle.t) && (
            <span style={{ color: COLORS.vwap }}>VWAP {values.vwap.get(candle.t)?.toFixed(2)}</span>
          )}
        </div>
      )}
    </div>
  );
}
```

Create `apps/web/src/chart/DailyChart.tsx`:

```tsx
import { nyClock } from "@tj/core";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { markerLook } from "./IntradayChart.js";
import type { DailyModel } from "./model.js";
import type { Toggle } from "./prefs.js";
import { chartOptions, COLORS, EMA_COLORS } from "./style.js";

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  emas: ISeriesApi<"Line">[];
  markers: ISeriesMarkersPluginApi<Time>;
}

/** A daily bar's date, which the chart takes as a business day. */
const day = (t: number) => nyClock(t).date;

/** The daily chart beside the intraday one (spec §8): about six months up to the trade, with its days marked. */
export function DailyChart({
  model,
  show,
  fitKey,
  height = 420,
}: {
  model: DailyModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, chartOptions(false));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const emas = EMA_COLORS.map((color) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );
    parts.current = { chart, candles, volume, emas, markers: createSeriesMarkers(candles, []) };
    return () => {
      chart.remove();
      parts.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    chart.candles.setData(
      model.candles.map((candle) => ({ time: day(candle.t), open: candle.o, high: candle.h, low: candle.l, close: candle.c })),
    );
    chart.volume.setData(
      model.candles.map((candle) => ({
        time: day(candle.t),
        value: candle.v,
        color: candle.c >= candle.o ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );
    chart.emas.forEach((series, index) =>
      series.setData((model.emas[index]?.points ?? []).map((point) => ({ time: day(point.t), value: point.value }))),
    );
    chart.markers.setMarkers(
      model.markers.map((marker) => ({ time: day(marker.t), text: marker.text, ...markerLook(marker) })),
    );
  }, [model]);

  const from = model.window?.from;
  const to = model.window?.to;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the Fit trade button's request to re-apply
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    parts.current?.chart.timeScale().setVisibleLogicalRange({ from, to });
  }, [from, to, fitKey]);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    chart.emas.forEach((series, index) => series.applyOptions({ visible: show[`ema${index}` as Toggle] }));
    chart.volume.applyOptions({ visible: show.volume });
  }, [show]);

  return <div ref={container} style={{ height }} data-testid="daily-chart" />;
}
```

Create `apps/web/src/chart/ChartToolbar.tsx`:

```tsx
import { type ChartPrefs, TIMEFRAMES, type Toggle, timeframeLabel } from "./prefs.js";

const BUTTON = "rounded-[2px] border px-1.5 py-0.5 text-[10px]";
const on = (pressed: boolean) => (pressed ? "border-accent bg-[#2962ff22] text-fg" : "border-line text-muted hover:text-fg");

/** Timeframes, indicator toggles and Fit trade, above the charts (spec §8). */
export function ChartToolbar({
  prefs,
  onChange,
  hiddenEmas,
  onFit,
}: {
  prefs: ChartPrefs;
  onChange: (next: ChartPrefs) => void;
  /** EMAs (by index) with too little history to draw. */
  hiddenEmas: readonly number[];
  onFit: () => void;
}) {
  const toggles: { toggle: Toggle; label: string; title?: string }[] = [
    ...prefs.emaLengths.map((length, index) => ({
      toggle: `ema${index}` as Toggle,
      label: `EMA ${length}`,
      title: hiddenEmas.includes(index) ? "needs more history" : undefined,
    })),
    { toggle: "vwap", label: "VWAP" },
    { toggle: "pm", label: "PM levels" },
    { toggle: "pd", label: "PD levels" },
    { toggle: "volume", label: "Volume" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TIMEFRAMES.map((minutes) => (
        <button
          key={minutes}
          type="button"
          aria-pressed={prefs.minutes === minutes}
          onClick={() => onChange({ ...prefs, minutes })}
          className={`${BUTTON} num ${on(prefs.minutes === minutes)}`}
        >
          {timeframeLabel(minutes)}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-line" />
      {toggles.map(({ toggle, label, title }) => (
        <button
          key={toggle}
          type="button"
          title={title}
          aria-pressed={prefs.show[toggle]}
          onClick={() => onChange({ ...prefs, show: { ...prefs.show, [toggle]: !prefs.show[toggle] } })}
          className={`${BUTTON} ${on(prefs.show[toggle])}`}
        >
          {label}
        </button>
      ))}
      <button type="button" onClick={onFit} className={`${BUTTON} ml-auto border-line text-fg hover:border-accent`}>
        Fit trade
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/chart`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/chart
git commit -m "feat(web): the intraday and daily charts and their toolbar, on Lightweight Charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The charts on the trade page, and the Chart section in Settings

**Files:**
- Create: `apps/web/src/chart/bars.ts`
- Create: `apps/web/src/chart/TradeCharts.tsx`, `apps/web/src/chart/TradeCharts.test.tsx`
- Create: `apps/web/src/chart/ChartSettings.tsx`, `apps/web/src/chart/ChartSettings.test.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`
- Modify: `apps/web/src/routes/Settings.tsx`

**Interfaces:**
- Consumes: `/api/bars` (Task 5); the model, prefs and charts (Tasks 6–7); `addDays`, `nyDate`, `nyMinuteOfDay` and `SESSION_END` (`@tj/core`); `todayNy` and `TICKER` (`market.ts`); `Panel` (`components/ui.tsx`).
- Produces:

```ts
function useMinuteBars(symbol: string, from: string, to: string, live: boolean): UseQueryResult<{ symbol; bars: PriceBar[]; partial: boolean; unavailable: { reason; message } | null }>;
function useDailyBars(symbol: string, to: string): UseQueryResult<…same…>;
function TradeCharts(props: { trade: { underlying: string; openedAt: number; closedAt: number | null; fills?: readonly ChartFill[]; legs: ChartTrade["legs"] } }): JSX.Element;
function ChartSettings(): JSX.Element;   // the Chart panel in Settings
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/chart/TradeCharts.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nyWallClock, type PriceBar } from "@tj/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLibrary } from "./testing.js";
import { TradeCharts } from "./TradeCharts.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

const DAY = "2026-09-28";
const BARS: PriceBar[] = Array.from({ length: 60 }, (_, index) => ({
  t: nyWallClock(DAY, 570 + index),
  o: 229,
  h: 229.2,
  l: 228.8,
  c: 229.1,
  v: 1_000,
}));
const TRADE = {
  underlying: "NVDA",
  openedAt: nyWallClock(DAY, 571),
  closedAt: nyWallClock(DAY, 586),
  fills: [],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};
const answer = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK = { symbol: "NVDA", bars: BARS, partial: false, unavailable: null };

/** Answers the minute bars with `minute` (one per call, the last repeating) and the daily bars with `daily`. */
function stub(minute: Response[], daily = answer({ ...OK, bars: [] })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/daily")) return daily.clone();
    const next = minute.length > 1 ? minute.shift() : minute[0];
    if (!next) throw new Error("no reply");
    return next.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCharts(trade = TRADE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TradeCharts trade={trade} />
    </QueryClientProvider>,
  );
}

beforeEach(() => resetLibrary());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("TradeCharts", () => {
  it("asks for the week before the trade through its last day, and the daily bars up to that day", async () => {
    const fetchMock = stub([answer(OK)]);
    renderCharts();
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA?from=2026-09-21&to=2026-09-28"));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA/daily?to=2026-09-28"));
    expect(screen.getByRole("button", { name: "3m" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says why there's no chart without a key, or for a symbol Alpaca doesn't carry", async () => {
    stub([
      answer({
        ...OK,
        bars: [],
        unavailable: { reason: "no_key", message: "Add your Alpaca key in Settings to see the chart." },
      }),
    ]);
    renderCharts();
    expect(await screen.findByText("Add your Alpaca key in Settings to see the chart.")).toBeTruthy();
    expect(screen.queryByTestId("intraday-chart")).toBeNull();
  });

  it("offers Retry when Alpaca didn't answer, and draws once it does", async () => {
    stub([answer({ error: "unreachable", message: "Alpaca didn't answer. Try again." }, 502), answer(OK)]);
    renderCharts();
    expect(await screen.findByText("Alpaca didn't answer. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
  });

  it("notes that today's bars run 15 minutes behind", async () => {
    stub([answer({ ...OK, partial: true })]);
    renderCharts();
    expect(await screen.findByText("Alpaca's free data runs 15 minutes behind.")).toBeTruthy();
  });

  it("remembers a switch to 5m", async () => {
    stub([answer(OK)]);
    renderCharts();
    fireEvent.click(await screen.findByRole("button", { name: "5m" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("tj.chart") ?? "{}").minutes).toBe(5));
    expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("true");
  });
});
```

Create `apps/web/src/chart/ChartSettings.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChartSettings } from "./ChartSettings.js";

afterEach(() => localStorage.clear());

describe("ChartSettings", () => {
  it("edits the four EMA lengths, kept in this browser", () => {
    render(<ChartSettings />);
    expect((screen.getByLabelText("EMA 4") as HTMLInputElement).value).toBe("167");
    fireEvent.change(screen.getByLabelText("EMA 4"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chart" }));
    expect(JSON.parse(localStorage.getItem("tj.chart") ?? "{}").emaLengths).toEqual([8, 20, 50, 200]);
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("refuses a length that isn't a whole number from 1 to 500", () => {
    render(<ChartSettings />);
    fireEvent.change(screen.getByLabelText("EMA 1"), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Save chart" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("EMA 1"), { target: { value: "9x" } });
    expect((screen.getByRole("button", { name: "Save chart" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

In `apps/web/src/routes/TradeDetail.test.tsx`, add below the imports:

```tsx
// The charts have their own tests; here they're a placeholder that shows where they go.
vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: ({ trade }: { trade: { underlying: string } }) => <div data-testid="trade-charts">{trade.underlying}</div>,
}));
```

and append inside `describe("TradeDetail", …)`:

```tsx
  it("shows the charts under the header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse()));
    renderDetail();
    expect((await screen.findByTestId("trade-charts")).textContent).toBe("XYZ");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/chart apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. There's no `TradeCharts` or `ChartSettings`, and no charts on the trade page.

- [ ] **Step 3: Implement the data hooks and the charts on the page**

Create `apps/web/src/chart/bars.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { TICKER } from "../market.js";

/** The trade's 1-minute bars (spec §6). A live trade refreshes each minute; past days never change. */
export function useMinuteBars(symbol: string, from: string, to: string, live: boolean) {
  return useQuery({
    queryKey: ["bars", symbol, from, to],
    enabled: TICKER.test(symbol),
    staleTime: live ? 30_000 : Number.POSITIVE_INFINITY,
    refetchInterval: live ? 60_000 : false,
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars[":symbol"].$get({ param: { symbol }, query: { from, to } });
      if (!res.ok) throw new Error(`bars failed: ${res.status}`);
      return res.json();
    },
  });
}

/** Two years of daily bars up to the trade's last day. */
export function useDailyBars(symbol: string, to: string) {
  return useQuery({
    queryKey: ["daily-bars", symbol, to],
    enabled: TICKER.test(symbol),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars[":symbol"].daily.$get({ param: { symbol }, query: { to } });
      if (!res.ok) throw new Error(`daily bars failed: ${res.status}`);
      return res.json();
    },
  });
}
```

Create `apps/web/src/chart/TradeCharts.tsx`:

```tsx
import { addDays, nyDate, nyMinuteOfDay, type PriceBar, SESSION_END } from "@tj/core";
import { useMemo, useState } from "react";
import { Panel } from "../components/ui.js";
import { TICKER, todayNy } from "../market.js";
import { useDailyBars, useMinuteBars } from "./bars.js";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import { IntradayChart } from "./IntradayChart.js";
import { type ChartFill, type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { useChartPrefs } from "./prefs.js";

const NO_BARS: PriceBar[] = [];
const NO_FILLS: ChartFill[] = [];
/** Until 20:16 ET a trade from today can still gain bars (the free data's 15 minutes, and one to spare). */
const LIVE_UNTIL = SESSION_END + 16;

/** The trade page's charts (trade-chart spec §8): the intraday chart, with the daily chart beside it. */
export function TradeCharts({
  trade,
}: {
  trade: {
    underlying: string;
    openedAt: number;
    closedAt: number | null;
    fills?: readonly ChartFill[];
    legs: ChartTrade["legs"];
  };
}) {
  const [prefs, setPrefs] = useChartPrefs();
  const [fitKey, setFitKey] = useState(0);
  const symbol = trade.underlying;
  const firstDay = nyDate(trade.openedAt);
  const lastDay = trade.closedAt != null ? nyDate(trade.closedAt) : todayNy();
  const live = lastDay === todayNy() && nyMinuteOfDay(Date.now()) < LIVE_UNTIL;
  const minute = useMinuteBars(symbol, addDays(firstDay, -7), lastDay, live);
  const daily = useDailyBars(symbol, lastDay);

  const fills = trade.fills ?? NO_FILLS;
  const chartTrade = useMemo<ChartTrade>(
    () => ({ openedAt: trade.openedAt, closedAt: trade.closedAt, fills, legs: trade.legs }),
    [trade.openedAt, trade.closedAt, fills, trade.legs],
  );
  const bars = minute.data?.bars ?? NO_BARS;
  const dailyBars = daily.data?.bars ?? NO_BARS;
  const intraday = useMemo(
    () => intradayModel(bars, chartTrade, prefs.minutes, prefs.emaLengths),
    [bars, chartTrade, prefs.minutes, prefs.emaLengths],
  );
  const dayChart = useMemo(
    () => dailyModel(dailyBars, bars, chartTrade, prefs.emaLengths, lastDay),
    [dailyBars, bars, chartTrade, prefs.emaLengths, lastDay],
  );

  const message = (text: string) => (
    <Panel title="Chart">
      <p className="text-muted">{text}</p>
    </Panel>
  );
  if (!TICKER.test(symbol)) return message(`No stock bars for ${symbol}.`);
  if (minute.isError) {
    return (
      <Panel title="Chart">
        <div className="flex items-center gap-2">
          <p className="text-down">Alpaca didn't answer. Try again.</p>
          <button
            type="button"
            onClick={() => {
              minute.refetch();
              daily.refetch();
            }}
            className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
          >
            Retry
          </button>
        </div>
      </Panel>
    );
  }
  if (minute.isPending) return message("Loading the chart…");
  if (bars.length === 0) return message(minute.data?.unavailable?.message ?? `No stock bars for ${symbol}.`);

  const hiddenEmas = intraday.emas.flatMap((line, index) => (line.points.length === 0 ? [index] : []));
  return (
    <section className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-2" data-testid="trade-charts">
      <ChartToolbar prefs={prefs} onChange={setPrefs} hiddenEmas={hiddenEmas} onFit={() => setFitKey((key) => key + 1)} />
      {minute.data?.partial && <p className="text-[10px] text-muted">Alpaca's free data runs 15 minutes behind.</p>}
      <div className="grid gap-2 min-[1100px]:grid-cols-[2fr_1fr]">
        <IntradayChart model={intraday} show={prefs.show} fitKey={fitKey} />
        {dayChart.candles.length > 0 ? (
          <DailyChart model={dayChart} show={prefs.show} fitKey={fitKey} />
        ) : (
          <p className="self-center text-center text-muted">
            {daily.isPending
              ? "Loading the daily chart…"
              : daily.isError
                ? "Alpaca didn't answer. Try again."
                : (daily.data?.unavailable?.message ?? `No daily bars for ${symbol}.`)}
          </p>
        )}
      </div>
    </section>
  );
}
```

In `apps/web/src/routes/TradeDetail.tsx`:
- import `TradeCharts` from `../chart/TradeCharts.js`;
- right after `      <SyncedBanner trade={trade} />`, add `      <TradeCharts trade={trade} />`.

- [ ] **Step 4: Implement the Chart section in Settings**

Create `apps/web/src/chart/ChartSettings.tsx`:

```tsx
import { useState } from "react";
import { Panel } from "../components/ui.js";
import { useChartPrefs } from "./prefs.js";

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none focus:border-accent";
const valid = (text: string) => /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= 500;

/** The trade charts' EMA lengths (spec §8), kept in this browser with the other chart choices. */
export function ChartSettings() {
  const [prefs, setPrefs] = useChartPrefs();
  const [lengths, setLengths] = useState(prefs.emaLengths.map(String));
  const [saved, setSaved] = useState(false);
  const ready = lengths.every(valid);
  return (
    <Panel title="Chart">
      <div className="grid grid-cols-4 gap-2">
        {lengths.map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the four EMA slots are fixed
          <label key={index} className={FIELD}>
            EMA {index + 1}
            <input
              aria-label={`EMA ${index + 1}`}
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                setSaved(false);
                setLengths(lengths.map((each, at) => (at === index ? event.target.value : each)));
              }}
              className={INPUT}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">
        Moving-average lengths for the trade charts, kept in this browser. Whole numbers from 1 to 500.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-label="Save chart"
          disabled={!ready}
          onClick={() => {
            setPrefs({ ...prefs, emaLengths: lengths.map(Number) });
            setSaved(true);
          }}
          className="rounded-sm bg-accent px-3 py-1 text-white disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-muted">Saved</span>}
      </div>
    </Panel>
  );
}
```

In `apps/web/src/routes/Settings.tsx`, import `ChartSettings` from `../chart/ChartSettings.js` and render `<ChartSettings />` just before `<Panel title="Data">`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, including the existing Settings and TradeDetail tests.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): the trade page's intraday and daily charts, and chart settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, and a live and visual check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§6, §8.2, §16)
- Modify: `docs/superpowers/specs/2026-09-29-trade-chart-design.md` (status, §13)
- Modify: `README.md`
- Scratchpad only, not committed: `serve-chart.mts`, `shots-chart.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: the parent spec and README describe the chart, the live results are recorded, and there are screenshots at 1280 and 1024 px.

- [ ] **Step 1: Update the parent spec** (as the chart spec's §11 lists)

In `docs/superpowers/specs/2026-09-22-trading-journal-design.md`:
- **§6:** replace the `bars` bullet with "**bars** (cache, *not* exported): `symbol`, `timeframe` (`1m` | `1d`), `t`, `o`, `h`, `l`, `c`, `v`, keyed by (`symbol`, `timeframe`, `t`). **bar_days** records each finished day fetched, empty ones included. See [2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md)."
- **§8.2**, at the top, add: "**Built as designed in [2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md), which changes this section.** Alpaca's free plan supplies the bars, not Massive. The timeframes are 1m, 2m, 3m, 5m, 10m, 15m, 30m and 1h, with a **daily chart beside** the intraday one. The chart shows extended hours, opens on 3m zoomed on the trade, and warms up on the week before. Index underlyings get an empty state."
- **§16, item 4 (Massive):** "No longer needed: the trade chart uses Alpaca (see its spec)."

- [ ] **Step 2: Update the chart spec and the README**

In `docs/superpowers/specs/2026-09-29-trade-chart-design.md`, set the **Status** to `Approved; implemented on feat/trade-chart. Plan: [2026-09-29-trade-chart.md](../plans/2026-09-29-trade-chart.md)`. Record the results of Step 3 in §13.

In `README.md`, under "What it tracks", in the Scalps bullet, replace "and a generated chart of the session" with "and a chart of the session on the trade page: 3-minute candles (1m to 1h), with a daily chart beside it, your fills marked, EMAs, VWAP, and premarket and prior-day levels, from Alpaca's free data".

- [ ] **Step 3: Live check over a copy of the real journal**

Build first with `pnpm build`. Then create `serve-chart.mts` in the scratchpad. It copies the journal read-only, migrates the copy, and serves it with the real Alpaca key:

```ts
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { serve } from "/home/kiryu/Projects/TradingJournal/apps/server/node_modules/@hono/node-server/dist/index.mjs";
import { createApp } from "/home/kiryu/Projects/TradingJournal/apps/server/src/app.ts";
import { readSecrets } from "/home/kiryu/Projects/TradingJournal/apps/server/src/config.ts";
import { createMarketData } from "/home/kiryu/Projects/TradingJournal/apps/server/src/marketData.ts";
import { openDatabase, runMigrations } from "/home/kiryu/Projects/TradingJournal/packages/db/src/index.ts";

const require = createRequire("/home/kiryu/Projects/TradingJournal/packages/db/package.json");
const Database = require("better-sqlite3");
const dataDir = join(homedir(), ".local/share/trading-journal");
const copy = join(mkdtempSync(join(process.cwd(), "tj-chart-")), "journal.db");
await new Database(join(dataDir, "journal.db"), { readonly: true }).backup(copy);
runMigrations(copy, { migrationsFolder: "/home/kiryu/Projects/TradingJournal/packages/db/migrations" });
serve({
  fetch: createApp({
    db: openDatabase(copy),
    webDir: "/home/kiryu/Projects/TradingJournal/apps/web/dist",
    market: createMarketData(readSecrets(join(dataDir, "secrets.json")).alpaca ?? null),
    settings: { dataDir, secretsFile: join(dataDir, "secrets.json"), checkKeys: async () => "ok" },
  }).fetch,
  port: 4199,
  hostname: "127.0.0.1",
});
console.log(`stand-in on http://localhost:4199 over ${copy}`);
```

Run it in the background from the scratchpad with `/home/kiryu/Projects/TradingJournal/apps/server/node_modules/.bin/tsx serve-chart.mts`. Add this morning's NVDA scalp to the copy:

```bash
curl -s -X POST -H 'content-type: application/json' -H 'host: localhost' http://localhost:4199/api/trades -d '{"strategy":"scalp","book":"paper","underlying":"NVDA","structureLabel":"Long call","openedAt":1790602265000,"closedAt":1790603172000,"netPnl":44.74,"fees":2.26,"feesOpen":0.93,"feesClose":1.33,"legs":[{"right":"C","strike":232.5,"expiry":"2026-09-28","quantity":2,"multiplier":100,"openPrice":1.06,"closePrice":1.295}]}'
```

Note the returned `id`. Then time the bars twice:

```bash
time curl -s -H 'host: localhost' 'http://localhost:4199/api/bars/NVDA?from=2026-09-21&to=2026-09-28' | head -c 200
time curl -s -H 'host: localhost' 'http://localhost:4199/api/bars/NVDA?from=2026-09-21&to=2026-09-28' | head -c 200
curl -s -H 'host: localhost' 'http://localhost:4199/api/bars/NVDA/daily?to=2026-09-28' | head -c 200
curl -s -H 'host: localhost' 'http://localhost:4199/api/bars/SPX?from=2026-09-21&to=2026-09-28'
```

Expected:
- The first minute-bars request takes about a second, and the second takes a few milliseconds (from the cache).
- Both return the same bars, several thousand of them, with `partial: false`.
- The daily request returns about 500 bars.
- SPX answers `"No stock bars for SPX."`

- [ ] **Step 4: Visual check**

Use the saved recipe: headless Firefox through `puppeteer-core`, awaiting `document.fonts.ready`. Screenshot `/trades/<the NVDA id>` at 1280 × 900 and 1024 × 900:
- as it opens;
- after clicking `5m`;
- after scrolling the mouse wheel over the intraday chart to zoom out;
- after hovering a candle.

Also screenshot an iron fly's page (any AA or oQuants fly) and `/settings`.

Look at every screenshot. Expected:
- 3m candles zoomed on 09:31–09:46, with "B 2 @ 1.06" and "S 2 @ 1.295";
- EMAs, VWAP, and the dotted PM and PD lines, labelled;
- the lighter premarket candles;
- the daily chart beside it at 1280, and below it at 1024;
- the legend reading the hovered candle;
- nothing overlapping or cut off.

Stop the server with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/superpowers/specs/2026-09-22-trading-journal-design.md docs/superpowers/specs/2026-09-29-trade-chart-design.md README.md
git commit -m "docs: point the parent spec and README at the trade chart, with its live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After execution: deferred minors (final review, 2026-09-29)

The final review found no Critical issues. Its two Important findings were fixed in f7eebea, along with one Minor finding upgraded because it hit same-day reviews: the daily EMA 167, trades held over 38 days, and a live chart's zoom. These Minor findings are left for later:

1. **The daily chart hides its own states.** While daily bars load, or after a daily 502 or `no_key`, it shows a one-candle chart built from minute bars, with no message and no Retry.
2. **A failed live refetch blanks the chart.** It replaces a drawn chart with the error panel, and the chart remounts with its view reset. Show the error only when there's no data.
3. **Half days** (Black Friday, Dec 24, Jul 3). After-hours bars from 13:00 to 16:00 count as regular session for the PD levels, VWAP, today's daily candle and the extended-hours tint.
4. **Open trades refetch outside market hours.** On weekends, holidays and before 04:00 they refetch every minute and show "Alpaca's free data runs 15 minutes behind". Base `live` on `isTradingDay`. A partial answer can also be kept for up to 5 minutes after 20:16 (`staleTime: Infinity`).
5. **00:00–00:16 ET.** The finished-days request ends within 15 minutes of now, and Alpaca's 403 becomes a 502. It heals itself; clamp that request's end too.
6. **Daily axis ticks read full dates.** `tickMarkFormatter` should return `null` for business-day times.
7. **Duplicate EMA lengths** give duplicate React keys in the legend. Key by index.
8. **Backups include the bar cache.** `VACUUM INTO`, with 10 kept, copies about 0.5 MB per symbol-week. Consider a separate cache database.
9. **Splits.** Three years of raw daily bars put splits inside the daily EMAs' window. Record this as a known limitation.
10. **Test gaps:**
    - chart cleanup on unmount;
    - a page-2 failure in `history.test.ts`;
    - `aggregate` across the November clock change;
    - a live refetch in TradeCharts.
11. **README:** the Scalps bullet has one line far longer than its neighbours.
