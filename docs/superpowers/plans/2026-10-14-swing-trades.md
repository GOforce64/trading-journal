# Swing Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `swing` as a third strategy: a bought call or put the user switches from Scalp, or a debit vertical the IBKR sync recognises. Each swing gets its own page with a daily/weekly chart and the spread maths. Swings get a list and an Analytics tab.

**Architecture:**
- `swing` joins `STRATEGIES`. A user-owned `trades.chosen_strategy` column holds the user's Scalp/Swing choice on a single bought option, and the sync applies it on every run.
- All swing maths is computed from the legs on read: core `swing.ts` (shape, metrics, the overnight rule) and `swingStats.ts` (the Swings tab, the Playbook cards).
- The chart is the existing `DailyChart`, fed by a swing model. That model adds weekly candles (`weeklyBars`), per-day fill markers and strike and break-even price lines.

**Tech Stack:**
- TypeScript, pnpm workspaces, Vitest, Biome;
- Hono + zod (server);
- Drizzle + better-sqlite3 (db, migrations by `drizzle-kit generate`);
- React 19 + TanStack Router/Query + Tailwind (web);
- Lightweight Charts 5 (charts), Recharts (analytics bars).

**Spec:** `docs/superpowers/specs/2026-10-14-swing-trades-design.md` (approved 14 Oct 2026). Read it with this plan; section numbers (§) below are the spec's.

## Global Constraints

- **Dates:** European everywhere the user reads them: "2 Oct 2026", "9 Oct 2026 → 13 Oct 2026". Use core's `dayText` / `dayTimeText` / `dayYearText`. Never call `toLocaleString` on a date: `dateText.guard.test.ts` fails the build.
- **SWING chip:** text `#f48fb1` on `#ec407a22` (Tailwind `bg-[#ec407a22] text-[#f48fb1]`). Its text is "SWING" in lists; the shape label is shown on the trade page.
- **Labels:** "Long call", "Long put", "Call debit spread", "Put debit spread".
- **Copy, verbatim:**
  - "Held overnight: a swing?"
  - "Switch to swing"
  - "Keep as scalp"
  - "Only a single bought call or put can be switched."
  - "Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."
  - "Needs more history than a weekly chart has"
  - "IBKR books the expiry overnight: the next sync closes this trade at its expiry values."
- **Price lines:** strikes titled `String(strike)` ("230", "232.5"), the break-even "BE " + `priceText(breakEven)` ("BE 233.80"). Drawn with `createPriceLine({ axisLabelVisible: true, title })`, never positioned by hand.
- **Candles keep their wicks:** the candle series sets `wickUpColor`/`wickDownColor` and never `wickVisible: false`.
- **History:** the daily view keeps 1,095 days; the weekly view asks for 1,826 days (`span=weekly`).
- **The sync never writes `chosen_strategy`. The switch never sets `facts_edited_at`.**
- **Trade ids** stay `tradeIdFor(account, first opening fill's key)`; nothing here changes them.
- **No new dependencies.** fast-check is already a devDependency of core, db and importers.
- **Before every commit:** `pnpm format` (twice if Biome changes something the first time), `pnpm lint`, `pnpm typecheck`, then the task's tests. Run the full `pnpm test` at the end of Tasks 3, 6 and 9.
- **Shell safety:** never `pkill -f`, which matches and kills your own shell. Stop a server by its PID from `ss -ltnp`. Never use `bash -c` with a pattern that matches itself.
- **Keep tests light for Windows CI:** close every database before deleting it; no large files.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five inputs most likely to bite the user, which no task's main tests cover on their own. Each has its pinning test in the task named.

1. **A switched trade re-synced unchanged:** the user switched a synced single option to Swing, and IBKR sends the same trade again. Expected: the sync answers "unchanged", the trade stays a swing, and nothing is rewritten. The stored `strategy` ("swing") must be compared against the candidate *after* the choice is applied, not against "scalp". *(Task 4, "keeps a switched single option a swing, and an unchanged re-sync is unchanged".)*
2. **A synced swing re-saved through the scalp form with nothing changed.** Expected: it stays a swing, and `facts_edited_at` stays null. The form must send `strategy: "swing"` (the trade's own), or `changesFacts` sees a new strategy. *(Task 7, "edits a single swing in the scalp form and keeps it a swing".)*
3. **Weekly candles in a week whose Monday is a holiday, and across a new year.** Mon 29 Dec 2025 to Fri 2 Jan 2026 has 1 Jan off. Expected: one candle per week, keyed by its Monday even when that Monday is in the previous year or is itself a holiday. Each candle is stamped at its first session. *(Task 6, `weeklyBars` tests.)*
4. **The overnight hint at the edges:**
   - an open scalp seen on a Saturday (past Friday's close): shown;
   - a scalp opened and closed the same day in after-hours (16:30): not shown;
   - a half day's 13:00 close: shown at 13:01.

   *(Task 1, `heldOvernight` tests.)*
5. **The weekly fetch failing while the daily one worked.** They're separate queries. Expected: the chart says it couldn't load and offers Retry, and Daily still works. *(Task 6, "shows the weekly fetch's failure and still draws Daily".)*

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/swing.ts` (new) | `swingShape`, labels, the chosen strategy, `canSwitchStrategy`, `heldOvernight`, `showsSwingHint`, `calendarDays`, `swingMetrics`. |
| `packages/core/src/swingStats.ts` (new) | Days-held and DTE buckets, `swingSummary`, `swingBreakdown`. |
| `packages/core/src/model.ts` | `swing` in `STRATEGIES`; `chosenStrategy` on new trades and patches; the swing refinements. |
| `packages/core/src/risk.ts` | `premiumPaid` (so `returnOnCost`) covers swings: return on debit. |
| `packages/core/src/scalpStats.ts` | Setup cards: kind `swing`, `avgDaysHeld`. |
| `packages/core/src/chart.ts` | `weeklyBars`. |
| `packages/db/src/schema.ts`, `migrations/0011_*.sql` | `trades.chosen_strategy`. |
| `packages/db/src/repositories/trades.ts` | Insert `chosenStrategy`; the switch in `update`; a swing's legs checked on update. |
| `packages/db/src/repositories/ibkr.ts` | Apply the user's choice in the sync's write; the duplicate guard matching typed swings. |
| `packages/importers/src/ibkr/group.ts` | The debit-vertical step. |
| `apps/server/src/routes/trades.ts`, `taxonomy.ts`, `bars.ts`; `apps/server/src/bars.ts` | Strategy enums from core; the queue guard; the `span=weekly` daily range. |
| `apps/web/src/components/ui.tsx` | The SWING chip tone and `strategyChipText`. |
| `apps/web/src/routes/Swings.tsx` (new), `router.tsx`, `components/Shell.tsx`, `palette/*` | The Swings page, its route, nav and palette entries. |
| `apps/web/src/review/StrategySwitch.tsx` (new) | The Scalp \| Swing switch and the overnight hint. |
| `apps/web/src/routes/SwingTiles.tsx` (new), `TradeDetail.tsx`, `EditTrade.tsx` | The swing page's tiles and layout; Edit. |
| `apps/web/src/chart/swing.ts` (new), `SwingChart.tsx` (new), `DailyChart.tsx`, `prefs.ts`, `bars.ts` | The swing chart's model, component and toolbar; price lines on the daily chart; the period preference; the weekly range. |
| `apps/web/src/routes/SwingsTab.tsx` (new), `analytics/Breakdown.tsx`, `analytics/search.ts`, `routes/Analytics.tsx`, `analytics/SetupCards.tsx` | The Analytics Swings tab and the swing setup card. |
| `packages/demo/src/swings.ts` (new), `index.ts`, `prices.ts`, `write.ts` | Demo swings and five years of daily bars. |

---

### Task 1: Core: the swing shape, its metrics, the model and return on debit

**Files:**
- Create: `packages/core/src/swing.ts`, `packages/core/src/swing.test.ts`
- Modify: `packages/core/src/model.ts`, `packages/core/src/model.test.ts`, `packages/core/src/risk.ts`, `packages/core/src/risk.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `nyDate` (marks.ts), `nyWallClock`, `regularClose`, `sessionsBetween` (calendar.ts).
- Produces (later tasks rely on these exact names):
  - `SWING_SHAPES`, `type SwingShape`, `SWING_LABELS: Record<SwingShape, string>`
  - `CHOSEN_STRATEGIES = ["scalp", "swing"]`, `type ChosenStrategy`
  - `swingShape(legs: readonly SwingShapeLeg[]): SwingShape | null`, where `SwingShapeLeg = { right: string; strike: number; expiry: string; quantity: number }`
  - `canSwitchStrategy(trade: { book: string; legs: readonly { quantity: number }[] }): boolean`
  - `heldOvernight(trade: { openedAt: number; closedAt: number | null }, now: number): boolean`
  - `showsSwingHint(trade: { strategy: string; chosenStrategy?: string | null; book: string; legs: readonly { quantity: number }[]; openedAt: number; closedAt: number | null }, now: number): boolean`
  - `calendarDays(from: string, to: string): number`
  - `swingMetrics(trade: SwingTrade, today: string): SwingMetrics | null`, with `SwingTrade = { legs: readonly SwingLeg[]; netPnl: number | null; openedAt: number; closedAt: number | null }`
  - `SwingMetrics = { shape; contracts; debitPerShare; debit; width: number | null; maxProfit: number | null; breakEven; pctOfMax: number | null; returnOnDebit: number | null; daysHeld; sessionsHeld; dteAtOpen; expiry }`
  - `STRATEGIES` gains `"swing"`; `NewTrade.chosenStrategy?: "scalp" | "swing" | null`; `TradePatch.chosenStrategy?: "scalp" | "swing"`
  - `premiumPaid` / `returnOnCost` answer for swings (the net debit).

- [ ] **Step 1: Write the failing tests for `swing.ts`**

Create `packages/core/src/swing.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/swing.test.ts`
Expected: FAIL, "Failed to resolve import ./swing.js".

- [ ] **Step 3: Write `swing.ts`**

Create `packages/core/src/swing.ts`:

```ts
import { nyWallClock, regularClose, sessionsBetween } from "./calendar.js";
import { nyDate } from "./marks.js";

/** A swing's shapes (swing spec §3.1): one bought call or put, or a debit vertical. */
export const SWING_SHAPES = ["long_call", "long_put", "call_debit_spread", "put_debit_spread"] as const;
export type SwingShape = (typeof SWING_SHAPES)[number];

export const SWING_LABELS: Record<SwingShape, string> = {
  long_call: "Long call",
  long_put: "Long put",
  call_debit_spread: "Call debit spread",
  put_debit_spread: "Put debit spread",
};

/** What the user can choose for a single bought option (swing spec §3.5). */
export const CHOSEN_STRATEGIES = ["scalp", "swing"] as const;
export type ChosenStrategy = (typeof CHOSEN_STRATEGIES)[number];

export interface SwingShapeLeg {
  right: string;
  strike: number;
  expiry: string;
  quantity: number;
}

/**
 * The one rule for what a swing is, used by the model, the sync and the maths (spec §3.1). A debit vertical is one
 * long and one short leg of the same right and expiry, the same size, with the long strike nearer the money.
 */
export function swingShape(legs: readonly SwingShapeLeg[]): SwingShape | null {
  const [first, second] = legs;
  if (!first) return null;
  if (legs.length === 1) {
    if (first.quantity <= 0) return null;
    if (first.right === "C") return "long_call";
    return first.right === "P" ? "long_put" : null;
  }
  if (legs.length !== 2 || !second) return null;
  if (first.right !== second.right || first.expiry !== second.expiry) return null;
  if (first.quantity === 0 || first.quantity + second.quantity !== 0) return null;
  const long = first.quantity > 0 ? first : second;
  const short = first.quantity > 0 ? second : first;
  if (long.right === "C") return long.strike < short.strike ? "call_debit_spread" : null;
  if (long.right === "P") return long.strike > short.strike ? "put_debit_spread" : null;
  return null;
}

/** Calendar days from one YYYY-MM-DD date to another. */
export const calendarDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Only a single bought call or put that isn't missed can be a scalp or a swing at the user's word (spec §3.5). */
export function canSwitchStrategy(trade: { book: string; legs: readonly { quantity: number }[] }): boolean {
  return trade.book !== "missed" && trade.legs.length === 1 && (trade.legs[0]?.quantity ?? 0) > 0;
}

/**
 * Whether a trade crossed a close (spec §5.3): it closed on a later New York day than it opened, or it's still open
 * after its opening day's regular close (13:00 on a half day).
 */
export function heldOvernight(trade: { openedAt: number; closedAt: number | null }, now: number): boolean {
  const openDay = nyDate(trade.openedAt);
  if (trade.closedAt != null) return nyDate(trade.closedAt) > openDay;
  return now >= nyWallClock(openDay, regularClose(openDay));
}

/** The "Held overnight: a swing?" hint: a switchable scalp the user hasn't decided on, held past a close. */
export function showsSwingHint(
  trade: {
    strategy: string;
    chosenStrategy?: string | null;
    book: string;
    legs: readonly { quantity: number }[];
    openedAt: number;
    closedAt: number | null;
  },
  now: number,
): boolean {
  return (
    trade.strategy === "scalp" &&
    trade.chosenStrategy == null &&
    canSwitchStrategy(trade) &&
    heldOvernight(trade, now)
  );
}

export interface SwingLeg extends SwingShapeLeg {
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}

export interface SwingTrade {
  legs: readonly SwingLeg[];
  netPnl: number | null;
  openedAt: number;
  closedAt: number | null;
}

export interface SwingMetrics {
  shape: SwingShape;
  /** The long leg's contracts. */
  contracts: number;
  /** The long open, less the short open on a spread. */
  debitPerShare: number;
  /** Gross, before fees, like the fly's credit. */
  debit: number;
  /** Spreads only: the distance between the strikes. */
  width: number | null;
  /** Spreads only: (width − debit per share) × multiplier × contracts. */
  maxProfit: number | null;
  breakEven: number;
  /** Closed spreads: net P&L over max profit. */
  pctOfMax: number | null;
  /** Closed swings: net P&L over the debit. */
  returnOnDebit: number | null;
  daysHeld: number;
  sessionsHeld: number;
  dteAtOpen: number;
  expiry: string;
}

const exact = (value: number) => Math.round(value * 1e6) / 1e6;
const cents = (value: number) => Math.round(value * 100) / 100;

/** A swing's numbers, from its legs and P&L (spec §4.1); null when its legs aren't a swing shape. */
export function swingMetrics(trade: SwingTrade, today: string): SwingMetrics | null {
  const shape = swingShape(trade.legs);
  const long = trade.legs.find((leg) => leg.quantity > 0);
  if (!shape || !long) return null;
  const short = trade.legs.find((leg) => leg.quantity < 0) ?? null;
  const contracts = long.quantity;
  const debitPerShare = exact(long.openPrice - (short?.openPrice ?? 0));
  const debit = cents(debitPerShare * long.multiplier * contracts);
  const width = short ? exact(Math.abs(short.strike - long.strike)) : null;
  const maxProfit = width == null ? null : cents((width - debitPerShare) * long.multiplier * contracts);
  const net = trade.closedAt != null ? trade.netPnl : null;
  const openDay = nyDate(trade.openedAt);
  const endDay = trade.closedAt != null ? nyDate(trade.closedAt) : today;
  return {
    shape,
    contracts,
    debitPerShare,
    debit,
    width,
    maxProfit,
    breakEven: exact(long.right === "C" ? long.strike + debitPerShare : long.strike - debitPerShare),
    pctOfMax: net != null && maxProfit != null && maxProfit > 0 ? net / maxProfit : null,
    returnOnDebit: net != null && debit > 0 ? net / debit : null,
    daysHeld: calendarDays(openDay, endDay),
    sessionsHeld: sessionsBetween(openDay, endDay),
    dteAtOpen: calendarDays(openDay, long.expiry),
    expiry: long.expiry,
  };
}
```

Add to `packages/core/src/index.ts`, in alphabetical order after `export * from "./stats.js";`:

```ts
export * from "./swing.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/core/src/swing.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Write the failing model and return-on-debit tests**

Append to `packages/core/src/model.test.ts` (it already imports `newTradeSchema` and `tradePatchSchema`; add any missing import):

```ts
describe("swings in the model (swing spec §3.1)", () => {
  const base = {
    book: "paper" as const,
    underlying: "NVDA",
    openedAt: 1_790_000_000_000,
    legs: [
      { right: "C" as const, strike: 230, expiry: "2026-11-06", quantity: 1, openPrice: 5.1 },
      { right: "C" as const, strike: 240, expiry: "2026-11-06", quantity: -1, openPrice: 1.3 },
    ],
  };

  it("takes a debit vertical as a swing", () => {
    expect(newTradeSchema.safeParse({ ...base, strategy: "swing" }).success).toBe(true);
  });

  it("refuses a swing whose legs aren't a swing shape", () => {
    const credit = base.legs.map((leg) => ({ ...leg, quantity: -leg.quantity }));
    expect(newTradeSchema.safeParse({ ...base, strategy: "swing", legs: credit }).success).toBe(false);
  });

  it("takes a chosen strategy only on one bought leg, equal to the strategy", () => {
    const single = { ...base, legs: [base.legs[0]] };
    expect(newTradeSchema.safeParse({ ...single, strategy: "swing", chosenStrategy: "swing" }).success).toBe(true);
    expect(newTradeSchema.safeParse({ ...single, strategy: "scalp", chosenStrategy: "swing" }).success).toBe(false);
    expect(newTradeSchema.safeParse({ ...base, strategy: "swing", chosenStrategy: "swing" }).success).toBe(false);
  });

  it("lets a patch carry the user's choice, and nothing else", () => {
    expect(tradePatchSchema.parse({ chosenStrategy: "swing" })).toEqual({ chosenStrategy: "swing" });
    expect(tradePatchSchema.safeParse({ chosenStrategy: "iron_fly" }).success).toBe(false);
  });
});
```

Append to `packages/core/src/risk.test.ts` (import `premiumPaid` and `returnOnCost` if they aren't imported):

```ts
describe("return on debit for swings (swing spec §4.1)", () => {
  const legs = [
    { quantity: 1, multiplier: 100, openPrice: 5.1 },
    { quantity: -1, multiplier: 100, openPrice: 1.3 },
  ];

  it("takes a swing's net debit as the premium paid", () => {
    expect(premiumPaid({ strategy: "swing", legs })).toBeCloseTo(380, 6);
    expect(returnOnCost({ strategy: "swing", netPnl: 402.1, legs })).toBeCloseTo(1.0582, 4);
  });

  it("still has none for a fly", () => {
    expect(premiumPaid({ strategy: "iron_fly", legs })).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/model.test.ts packages/core/src/risk.test.ts`
Expected: FAIL. "swing" isn't a strategy (zod enum), `chosenStrategy` is stripped or refused, and `premiumPaid` answers null for a swing.

- [ ] **Step 7: Change the model and `premiumPaid`**

In `packages/core/src/model.ts`:

```ts
// was: export const STRATEGIES = ["scalp", "iron_fly"] as const;
export const STRATEGIES = ["scalp", "iron_fly", "swing"] as const;
```

Add the import beside the others:

```ts
import { CHOSEN_STRATEGIES, swingShape } from "./swing.js";
```

In `newTradeShape`, after `missed: tradeFields.missed.default(null),`:

```ts
  /** The user's Scalp or Swing on a single bought option (swing spec §3.1); the sync never writes it. */
  chosenStrategy: z.enum(CHOSEN_STRATEGIES).nullish(),
```

Append these two refinements to `newTradeSchema`, after the last existing `.refine(...)`:

```ts
  .refine((trade) => trade.strategy !== "swing" || swingShape(trade.legs) != null, {
    message: "a swing is one bought call or put, or a debit vertical",
    path: ["legs"],
  })
  .refine(
    (trade) =>
      trade.chosenStrategy == null ||
      (trade.book !== "missed" &&
        trade.legs.length === 1 &&
        (trade.legs[0]?.quantity ?? 0) > 0 &&
        trade.strategy === trade.chosenStrategy),
    { message: "only a single bought call or put takes a chosen strategy", path: ["chosenStrategy"] },
  );
```

(Move the `;` that ended the old last refine to the end of the new one.)

In `tradePatchSchema`'s `.extend({ ... })`, add:

```ts
  /** The user's Scalp or Swing (swing spec §3.5); the repository sets `strategy` with it. */
  chosenStrategy: z.enum(CHOSEN_STRATEGIES).optional(),
```

In `packages/core/src/risk.ts`, replace `premiumPaid`:

```ts
/**
 * The premium paid: for a scalp, a single long option's contracts × multiplier × entry premium; for a swing, the net
 * debit, its legs' signed cost (swing spec §4.1). Null for anything else.
 */
export function premiumPaid(trade: Pick<ReturnTrade, "strategy" | "legs">): number | null {
  if (trade.strategy === "swing") {
    const debit = trade.legs.reduce((sum, leg) => sum + leg.quantity * leg.multiplier * leg.openPrice, 0);
    return debit > 0 ? debit : null;
  }
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (trade.strategy !== "scalp" || !leg || leg.quantity <= 0) return null;
  const cost = leg.quantity * leg.multiplier * leg.openPrice;
  return cost > 0 ? cost : null;
}
```

Update the doc comment of `returnOnCost` to say "A scalp's or a swing's net P&L over the premium paid".

- [ ] **Step 8: Run the core tests and the type check**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS, with no type errors. The web's own strategy unions are `"scalp" | "iron_fly"` literals, so nothing outside core breaks yet.

- [ ] **Step 9: Commit**

```bash
pnpm format && pnpm lint
git add packages/core/src
git commit -m "feat(core): swing shapes, swing metrics, the chosen strategy and return on debit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core: swing statistics and the swing setup card

**Files:**
- Create: `packages/core/src/swingStats.ts`, `packages/core/src/swingStats.test.ts`
- Modify: `packages/core/src/scalpStats.ts` (setup cards), `packages/core/src/scalpStats.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `swingShape`, `SWING_LABELS`, `SWING_SHAPES`, `swingMetrics`, `calendarDays` (Task 1); `groupStats`, `scalpBreakdown`, `BreakdownRow`, `BreakdownContext`, `ScalpStatTrade`, `ScalpStatLeg` (scalpStats.ts); `summarize`, `Closed`, `Summary` (stats.ts); `groupTrades`, `daysToExpiry` (splits.ts); `nyDate` (marks.ts).
- Produces:
  - `DAYS_HELD_BUCKETS`, `DTE_BUCKETS`, `SWING_BREAKDOWNS`, `type SwingBreakdown`
  - `daysHeldBucket(days: number): string`, `dteBucket(days: number | null): string`
  - `SwingStatTrade` (`ScalpStatTrade` with legs that also carry `strike` and `closePrice`), `type ClosedSwing = Closed<SwingStatTrade>`
  - `swingSummary(trades: readonly ClosedSwing[]): SwingSummary` (`Summary` + `avgReturn`, `returnCount`, `avgDaysHeld`, `avgPctOfMax`, `spreads`)
  - `swingBreakdown(trades, by: SwingBreakdown, context: BreakdownContext): BreakdownRow[]`
  - `SetupCard.kind` gains `"swing"`, and `SetupCard.avgDaysHeld: number | null`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/swingStats.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nyWallClock } from "./calendar.js";
import { setupCards } from "./scalpStats.js";
import {
  type ClosedSwing,
  DAYS_HELD_BUCKETS,
  DTE_BUCKETS,
  daysHeldBucket,
  dteBucket,
  swingBreakdown,
  swingSummary,
} from "./swingStats.js";

const CONTEXT = { setups: new Map([["s1", "Breakout"]]), emotions: new Map(), costEdges: [], contractEdges: [] };

let seq = 0;
function swing(overrides: Partial<ClosedSwing> & { open: string; close: string }): ClosedSwing {
  seq++;
  const { open, close, ...rest } = overrides;
  return {
    id: `s${seq}`,
    strategy: "swing",
    book: "paper",
    underlying: "NVDA",
    openedAt: nyWallClock(open, 10 * 60),
    closedAt: nyWallClock(close, 11 * 60),
    netPnl: 100,
    fees: 2,
    setupId: null,
    grade: null,
    tagIds: [],
    ironFly: null,
    legs: [
      { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, multiplier: 100, openPrice: 5.1, closePrice: 9 },
      { right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, multiplier: 100, openPrice: 1.3, closePrice: 1.15 },
    ],
    ...rest,
  };
}
const longCall = (open: string, close: string, netPnl: number): ClosedSwing =>
  swing({
    open,
    close,
    netPnl,
    legs: [{ right: "C", strike: 230, expiry: "2026-11-06", quantity: 2, multiplier: 100, openPrice: 4, closePrice: 5 }],
  });

describe("swing buckets", () => {
  it("puts days held and DTE at open in their buckets", () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 20, 21, 90].map(daysHeldBucket)).toEqual([
      "same day", "1–2", "1–2", "3–5", "3–5", "6–10", "6–10", "11–20", "11–20", "21+", "21+",
    ]);
    expect([0, 7, 8, 21, 22, 45, 46, 90, 91, null].map(dteBucket)).toEqual([
      "0–7", "0–7", "8–21", "8–21", "22–45", "22–45", "46–90", "46–90", "90+", "unknown",
    ]);
  });

  it("puts every number of days in exactly one bucket (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000 }), (days) => {
        expect(DAYS_HELD_BUCKETS.filter((label) => label === daysHeldBucket(days))).toHaveLength(1);
        expect(DTE_BUCKETS.filter((label) => label === dteBucket(days))).toHaveLength(1);
      }),
    );
  });
});

describe("swingSummary", () => {
  it("averages return on debit and days held, and % of max over the spreads only", () => {
    const trades = [
      swing({ open: "2026-10-02", close: "2026-10-09", netPnl: 402.1 }),
      longCall("2026-10-05", "2026-10-06", 200),
    ];
    const summary = swingSummary(trades);
    expect(summary).toMatchObject({ trades: 2, spreads: 1, returnCount: 2 });
    expect(summary.avgDaysHeld).toBe(4);
    expect(summary.avgPctOfMax).toBeCloseTo(402.1 / 620, 6);
    // 402.10 on a $380 debit and 200 on $800.
    expect(summary.avgReturn).toBeCloseTo((402.1 / 380 + 200 / 800) / 2, 6);
  });

  it("has no averages with no swings", () => {
    expect(swingSummary([])).toMatchObject({ trades: 0, avgDaysHeld: null, avgPctOfMax: null, spreads: 0 });
  });
});

describe("swingBreakdown", () => {
  const trades = [
    swing({ open: "2026-10-02", close: "2026-10-09", netPnl: 402.1, setupId: "s1" }),
    longCall("2026-10-05", "2026-10-05", -50),
    longCall("2026-10-06", "2026-10-08", 120),
  ];

  it("breaks down by structure, in the shapes' order", () => {
    expect(swingBreakdown(trades, "structure", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["Long call", 2],
      ["Call debit spread", 1],
    ]);
  });

  it("breaks down by days held and by DTE at open", () => {
    expect(swingBreakdown(trades, "held", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["same day", 1],
      ["1–2", 1],
      ["6–10", 1],
    ]);
    expect(swingBreakdown(trades, "dte", CONTEXT).map((row) => [row.label, row.trades])).toEqual([
      ["22–45", 3],
    ]);
  });

  it("shares the scalp breakdowns for setup and the rest", () => {
    expect(swingBreakdown(trades, "setup", CONTEXT).map((row) => row.label)).toEqual(["Breakout", "no setup"]);
  });
});

describe("a swing setup's card", () => {
  it("is a swing card with its average days held", () => {
    const trades = [
      swing({ open: "2026-10-02", close: "2026-10-09", setupId: "s1" }),
      longCall("2026-10-05", "2026-10-06", 200),
    ].map((trade) => ({ ...trade, setupId: "s1" }));
    const [card] = setupCards(trades, new Map([["s1", "Breakout"]]));
    expect(card).toMatchObject({ kind: "swing", avgDaysHeld: 4, kept: null });
    expect(card?.points.at(-1)?.total).toBe(300);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/swingStats.test.ts`
Expected: FAIL, "Failed to resolve import ./swingStats.js".

- [ ] **Step 3: Write `swingStats.ts`**

Create `packages/core/src/swingStats.ts`:

```ts
import { nyDate } from "./marks.js";
import {
  type BreakdownContext,
  type BreakdownRow,
  groupStats,
  type ScalpStatLeg,
  type ScalpStatTrade,
  scalpBreakdown,
} from "./scalpStats.js";
import { daysToExpiry, groupTrades } from "./splits.js";
import { type Closed, type Summary, summarize } from "./stats.js";
import { calendarDays, SWING_LABELS, SWING_SHAPES, swingMetrics, swingShape } from "./swing.js";

/** The Swings tab (swing spec §4.5, §6.3): buckets, the KPI strip and the breakdowns. */

export const DAYS_HELD_BUCKETS = ["same day", "1–2", "3–5", "6–10", "11–20", "21+"] as const;
export const DTE_BUCKETS = ["0–7", "8–21", "22–45", "46–90", "90+"] as const;
export const SWING_BREAKDOWNS = [
  "structure",
  "held",
  "dte",
  "setup",
  "ticker",
  "weekday",
  "grade",
  "emotion",
  "book",
  "month",
] as const;
export type SwingBreakdown = (typeof SWING_BREAKDOWNS)[number];

export interface SwingStatLeg extends ScalpStatLeg {
  strike: number;
  closePrice: number | null;
}

/** What the swing statistics read. The web app's trade rows satisfy it as they are. */
export interface SwingStatTrade extends ScalpStatTrade {
  legs: readonly SwingStatLeg[];
}

export type ClosedSwing = Closed<SwingStatTrade>;

const UNKNOWN = "unknown";

export function daysHeldBucket(days: number): string {
  if (days <= 0) return "same day";
  if (days <= 2) return "1–2";
  if (days <= 5) return "3–5";
  if (days <= 10) return "6–10";
  return days <= 20 ? "11–20" : "21+";
}

export function dteBucket(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 7) return "0–7";
  if (days <= 21) return "8–21";
  if (days <= 45) return "22–45";
  return days <= 90 ? "46–90" : "90+";
}

/** Calendar days from a closed trade's New York open date to its close date. */
export const daysHeldOf = (trade: { openedAt: number; closedAt: number }): number =>
  calendarDays(nyDate(trade.openedAt), nyDate(trade.closedAt));

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export interface SwingSummary extends Summary {
  avgReturn: number | null;
  returnCount: number;
  avgDaysHeld: number | null;
  /** Over the spreads only, which have a max profit. */
  avgPctOfMax: number | null;
  spreads: number;
}

/** The Swings tab's KPI strip (spec §6.3). Expects trades in close order, as `closedTrades` returns them. */
export function swingSummary(trades: readonly ClosedSwing[]): SwingSummary {
  const metrics = trades.flatMap((trade) => {
    const each = swingMetrics(trade, nyDate(trade.closedAt));
    return each ? [each] : [];
  });
  const returns = metrics.flatMap((each) => (each.returnOnDebit == null ? [] : [each.returnOnDebit]));
  const ofMax = metrics.flatMap((each) => (each.pctOfMax == null ? [] : [each.pctOfMax]));
  return {
    ...summarize(trades),
    avgReturn: mean(returns),
    returnCount: returns.length,
    avgDaysHeld: mean(trades.map(daysHeldOf)),
    avgPctOfMax: mean(ofMax),
    spreads: metrics.filter((each) => each.width != null).length,
  };
}

const toRows = (groups: [string, ClosedSwing[]][]): BreakdownRow[] =>
  groups.map(([label, members]) => ({ label, ...groupStats(members) }));

/** One dimension's rows (spec §6.3). The dimensions swings share with scalps come from `scalpBreakdown`. */
export function swingBreakdown(
  trades: readonly ClosedSwing[],
  by: SwingBreakdown,
  context: BreakdownContext,
): BreakdownRow[] {
  switch (by) {
    case "structure":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const shape = swingShape(trade.legs);
            return shape ? SWING_LABELS[shape] : UNKNOWN;
          },
          SWING_SHAPES.map((shape) => SWING_LABELS[shape]),
        ),
      );
    case "held":
      return toRows(groupTrades(trades, (trade) => daysHeldBucket(daysHeldOf(trade)), DAYS_HELD_BUCKETS));
    case "dte":
      return toRows(groupTrades(trades, (trade) => dteBucket(daysToExpiry(trade)), DTE_BUCKETS));
    default:
      return scalpBreakdown(trades, by, context);
  }
}
```

Add `export * from "./swingStats.js";` to `packages/core/src/index.ts` after `./swing.js`.

- [ ] **Step 4: Give setup cards a swing kind**

In `packages/core/src/scalpStats.ts`:

1. Import `calendarDays` from `swing.ts`, not `daysHeldOf` from `swingStats.ts`: `swingStats` imports `scalpStats`, so that would be a cycle.

   ```ts
   import { calendarDays } from "./swing.js";
   ```

   and, near `mean`, a private helper:

   ```ts
   const heldDays = (trade: { openedAt: number; closedAt: number }) =>
     calendarDays(nyDate(trade.openedAt), nyDate(trade.closedAt));
   ```

2. In `interface SetupCard`:

   ```ts
     /** "fly" when every closed trade is an iron fly, "swing" when every one is a swing (swing spec §6.4). */
     kind: "scalp" | "fly" | "swing";
     /** A swing setup's mean calendar days held; null otherwise. */
     avgDaysHeld: number | null;
   ```

   (Replace the existing `kind` line and its comment.)

3. In `setupCards`, replace the body of the `taken` map:

   ```ts
     const taken = bySetup.map(([setupId, members]): SetupCard => {
       const fly = members.every((trade) => trade.strategy === "iron_fly");
       const swing = members.every((trade) => trade.strategy === "swing");
       return {
         setupId,
         kind: fly ? "fly" : swing ? "swing" : "scalp",
         ...groupStats(members),
         kept: fly ? keptStats(members).keptOverall : null,
         avgDaysHeld: swing ? mean(members.map(heldDays)) : null,
         points: fly || swing ? cumulative(members, (trade) => trade.netPnl) : cumulativeR(members),
         lastClosedAt: Math.max(...members.map((trade) => trade.closedAt), lastEntry(setupId)),
         missed: missedOnCard(missedBySetup.get(setupId) ?? []),
       };
     });
   ```

4. In the `missedOnly` map, add `avgDaysHeld: null,` after `kept: null,`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS. `typecheck` flags `apps/web/src/analytics/SetupCards.tsx` only if it switches exhaustively on `kind`. It doesn't (it tests `kind === "fly"`), so expect no errors.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add packages/core/src
git commit -m "feat(core): swing statistics, breakdowns and the swing setup card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: db: `chosen_strategy`, the switch, and the export file

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/repositories/trades.ts`, `packages/db/src/repositories/trades.test.ts`, `packages/db/src/migrate.test.ts`, `packages/db/src/bundle.test.ts`
- Create: `packages/db/migrations/0011_chosen_strategy.sql` and its snapshot, both generated by drizzle-kit

**Interfaces:**
- Consumes: `CHOSEN_STRATEGIES`, `canSwitchStrategy`, `swingShape` (Task 1).
- Produces:
  - `TradeRow.chosenStrategy: string | null`, so `TradeRecord` and the web's `TradeView` carry it;
  - `repo.update(id, { chosenStrategy })` sets `strategy` too, and throws `ReviewRuleError("Only a single bought call or put can be switched.")` when not allowed.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/migrate.test.ts`, after the last `it(...)` in its `describe`, add (copy the `columns` helper's use from the existing `facts_edited_at` test):

```ts
  it("adds trades.chosen_strategy (swing spec §3.2)", () => {
    expect(columns("trades")).toContain("chosen_strategy");
  });
```

In `packages/db/src/repositories/trades.test.ts`, add a `describe` at the end. It uses the file's own `openDatabase`, `runMigrations` and `MIGRATIONS`; check the `beforeEach` pattern of the `describe` around line 81 and copy it:

```ts
describe("the Scalp | Swing switch (swing spec §3.5)", () => {
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);
  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-switch-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  const single: NewTrade = {
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    underlyingName: null,
    structureLabel: "Long call",
    openedAt: 1_790_000_000_000,
    closedAt: 1_790_300_000_000,
    netPnl: 100,
    fees: 2,
    feesOpen: 1,
    feesClose: 1,
    notes: null,
    grade: null,
    excluded: false,
    excludeReason: null,
    source: "manual",
    setupId: null,
    tagIds: [],
    legs: [
      { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, multiplier: 100, openPrice: 5, closePrice: 6.02 },
    ],
    ironFly: null,
    missed: null,
  };

  it("switches a single bought option to a swing and back, without marking its facts edited", () => {
    const { id } = repo().create(single);
    clock = 2_000;
    expect(repo().update(id, { chosenStrategy: "swing" })).toMatchObject({
      strategy: "swing",
      chosenStrategy: "swing",
      updatedAt: 2_000,
      factsEditedAt: null,
    });
    expect(repo().update(id, { chosenStrategy: "scalp" })).toMatchObject({
      strategy: "scalp",
      chosenStrategy: "scalp",
    });
  });

  it("refuses the switch on anything but a single bought option", () => {
    const vertical = repo().create({
      ...single,
      strategy: "swing",
      structureLabel: "Call debit spread",
      legs: [
        { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, multiplier: 100, openPrice: 5.1, closePrice: 9 },
        { right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, multiplier: 100, openPrice: 1.3, closePrice: 1.15 },
      ],
    });
    expect(() => repo().update(vertical.id, { chosenStrategy: "scalp" })).toThrow(
      new ReviewRuleError("Only a single bought call or put can be switched."),
    );
  });

  it("refuses a swing whose new legs aren't a swing shape", () => {
    const { id } = repo().create({ ...single, strategy: "swing", chosenStrategy: "swing" });
    const short = [{ ...single.legs[0], quantity: -1 }] as NewTrade["legs"];
    expect(() => repo().update(id, { legs: short })).toThrow(ReviewRuleError);
  });
});
```

(Add `type Db` to the `../client.js` import if the file imports only `openDatabase`.)

In `packages/db/src/bundle.test.ts`, add at the end. It uses the fixture's `journal`, `scalp` and `bundleOf`, which the file already imports. A bundle from an older app that lacks the column is already covered by "merges a bundle from an older app, keeping local values of the columns it lacks".

```ts
describe("mergeBundle and the Scalp | Swing choice", () => {
  it("carries the user's choice to the other machine (swing spec §3.2)", () => {
    const a = journal();
    const b = journal();
    const { id } = a.trades.create(scalp);
    a.clock.now = 3_000;
    a.trades.update(id, { chosenStrategy: "swing" });
    mergeBundle(b.db, bundleOf(a.db));
    expect(b.trades.get(id)).toMatchObject({ strategy: "swing", chosenStrategy: "swing" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL. There's no `chosen_strategy` column, and `update` ignores `chosenStrategy` or fails on an unknown column.

- [ ] **Step 3: Add the column and generate the migration**

In `packages/db/src/schema.ts`, in `trades`, after `reviewedAt`:

```ts
    /** The user's Scalp or Swing on a single bought option (swing spec §3.1); the sync never writes it. */
    chosenStrategy: text("chosen_strategy"),
```

and update the `strategy` comment to `/** 'scalp' | 'iron_fly' | 'swing' */`.

Generate: `pnpm --filter @tj/db generate --name chosen_strategy`

Expected: `packages/db/migrations/0011_chosen_strategy.sql` containing exactly:

```sql
ALTER TABLE `trades` ADD `chosen_strategy` text;
```

plus `meta/0011_snapshot.json` and a new `_journal.json` entry. Adding a column asks no questions, so no TTY is needed. If drizzle-kit prompts anyway, stop and report it.

- [ ] **Step 4: Write the switch in the repository**

In `packages/db/src/repositories/trades.ts`:

1. Imports: add `canSwitchStrategy`, `swingShape` to the `@tj/core` import.
2. In `insertTrade`'s `.values({...})`, after `source: input.source,`:

   ```ts
           chosenStrategy: input.chosenStrategy ?? null,
   ```

3. In `update`, right after `checkBook(existing, patch);`:

   ```ts
         const record = hydrate(db, existing);
         // The user's Scalp | Swing (swing spec §3.5): only on a single bought option, and it sets the strategy too.
         if (patch.chosenStrategy !== undefined) {
           if (!canSwitchStrategy({ book: existing.book, legs: patch.legs ?? record.legs })) {
             throw new ReviewRuleError("Only a single bought call or put can be switched.");
           }
           columns.strategy = patch.chosenStrategy;
         }
         const strategy = (columns.strategy as string | undefined) ?? existing.strategy;
         if (strategy === "swing" && swingShape(patch.legs ?? record.legs) == null) {
           throw new ReviewRuleError("A swing is one bought call or put, or a debit vertical.");
         }
   ```

   Then delete the later `const record = hydrate(db, existing);`, since it moved up. Change the existing levels check from `if (scalp && (patch.strategy ?? existing.strategy) !== "scalp")` to `if (scalp && strategy !== "scalp")`, so a patch that switches to Swing and sends levels at once is refused like any other swing's levels.

`chosenStrategy` reaches `columns` through `...rest` (it isn't destructured out), so drizzle writes `chosen_strategy`. `changesFacts(record, patch)` reads `patch.strategy`, which the switch doesn't send, so `factsEditedAt` stays untouched.

- [ ] **Step 5: Run the db tests, then the full suite**

Run: `pnpm vitest run packages/db && pnpm typecheck && pnpm test`
Expected: PASS everywhere. This is the first full run of the plan, so note the test count here.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add packages/db
git commit -m "feat(db): trades.chosen_strategy and the Scalp | Swing switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The sync and the server: debit verticals, the user's choice, the duplicate guard, the routes

**Files:**
- Modify: `packages/importers/src/ibkr/group.ts`, `packages/importers/src/ibkr/group.test.ts`
- Modify: `packages/db/src/repositories/ibkr.ts`, `packages/db/src/repositories/ibkr.test.ts`
- Modify: `apps/server/src/routes/trades.ts`, `apps/server/src/routes/taxonomy.ts`
- Create: `apps/server/src/swing.test.ts`

**Interfaces:**
- Consumes: `swingShape`, `SWING_LABELS`, `canSwitchStrategy`, `STRATEGIES` (Task 1); `trades.chosenStrategy` and the repository switch (Task 3).
- Produces:
  - debit-vertical candidates `{ strategy: "swing", structureLabel: "Call debit spread" | "Put debit spread" }`;
  - `ibkr.apply` honouring `chosen_strategy`;
  - `GET /api/trades?strategy=swing`; the review queue answering `[]` for any strategy but scalp;
  - setups taking `strategy: "swing"`.

- [ ] **Step 1: Write the failing grouping tests**

Append to `packages/importers/src/ibkr/group.test.ts` (it has the `fill(...)` builder, `OPTIONS` and `groupFills`):

```ts
describe("groupFills: debit verticals (swing spec §3.3)", () => {
  const c230 = { conid: "c230", right: "C" as const, strike: 230, expiry: "2026-11-06" };
  const c240 = { conid: "c240", right: "C" as const, strike: 240, expiry: "2026-11-06" };
  const p250 = { conid: "p250", right: "P" as const, strike: 250, expiry: "2026-11-06" };
  const p240 = { conid: "p240", right: "P" as const, strike: 240, expiry: "2026-11-06" };

  it("makes a call debit spread, opened and closed, one swing", () => {
    const { candidates, skipped } = groupFills(
      [
        fill({ ...c230, quantity: 1, price: 5.1 }),
        fill({ ...c240, quantity: -1, price: 1.3 }),
        fill({ ...c230, quantity: -1, price: 9 }),
        fill({ ...c240, quantity: 1, price: 1.15 }),
      ],
      OPTIONS,
    );
    expect(skipped).toEqual([]);
    expect(candidates).toHaveLength(1);
    // (9 − 5.10) × 100 + (1.30 − 1.15) × 100, less four $1 commissions.
    expect(candidates[0]?.trade).toMatchObject({ strategy: "swing", structureLabel: "Call debit spread", netPnl: 401 });
  });

  it("names a put debit spread", () => {
    const { candidates } = groupFills(
      [fill({ ...p250, quantity: 2, price: 6 }), fill({ ...p240, quantity: -2, price: 2.5 })],
      OPTIONS,
    );
    expect(candidates[0]?.trade).toMatchObject({
      strategy: "swing",
      structureLabel: "Put debit spread",
      closedAt: null,
    });
  });

  it("skips a credit vertical and uneven sizes as unrecognised", () => {
    const credit = groupFills(
      [fill({ ...c230, quantity: -1, price: 5.1 }), fill({ ...c240, quantity: 1, price: 1.3 })],
      OPTIONS,
    );
    const uneven = groupFills(
      [fill({ ...c230, quantity: 2, price: 5.1 }), fill({ ...c240, quantity: -1, price: 1.3 })],
      OPTIONS,
    );
    for (const { candidates, skipped } of [credit, uneven]) {
      expect(candidates).toEqual([]);
      expect(skipped).toEqual([expect.objectContaining({ reason: "unrecognised" })]);
    }
  });

  it("keeps the single option's trade id when a call is legged into a spread", () => {
    const bought = fill({ ...c230, quantity: 1, price: 5.1 });
    const alone = groupFills([bought], OPTIONS).candidates[0];
    const legged = groupFills([bought, fill({ ...c240, quantity: -1, price: 1.3 })], OPTIONS).candidates[0];
    expect(alone?.trade.strategy).toBe("scalp");
    expect(legged?.trade).toMatchObject({ strategy: "swing", structureLabel: "Call debit spread" });
    expect(legged?.id).toBe(alone?.id);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/importers/src/ibkr/group.test.ts`
Expected: FAIL. The three swing cases come back skipped as "unrecognised", and the legged case's second answer is undefined.

- [ ] **Step 3: Recognise debit verticals in `group.ts`**

1. Add `SWING_LABELS` and `swingShape` to the `@tj/core` import.
2. In `settle`, replace the tail that starts at `const isFly =`:

```ts
  const isFly =
    !changesSide &&
    opened("C", true) === 1 &&
    opened("P", true) === 1 &&
    opened("C", false) <= 1 &&
    opened("P", false) <= 1 &&
    opened("C", false) + opened("P", false) >= 1;
  if (isFly) {
    addTrade(contracts, "iron_fly", out, options);
    return;
  }
  // A debit vertical (swing spec §3.3): two contracts, one bought and one sold, the same size, the long nearer.
  if (!changesSide && contracts.length === 2 && isDebitVertical(contracts)) {
    addTrade(contracts, "swing", out, options);
    return;
  }
  skip("unrecognised");
}

/** Whether two contracts' opening fills make a debit vertical, by the same rule as the model's. */
function isDebitVertical(contracts: FillForGrouping[][]): boolean {
  const legs = contracts.map((fills) => {
    const first = fills[0];
    const sign = Math.sign(first?.quantity ?? 0);
    return {
      right: first?.right ?? "",
      strike: first?.strike ?? 0,
      expiry: first?.expiry ?? "",
      quantity: sum(fills.filter((fill) => Math.sign(fill.quantity) === sign).map((fill) => fill.quantity)),
    };
  });
  const shape = swingShape(legs);
  return shape === "call_debit_spread" || shape === "put_debit_spread";
}
```

3. In `addTrade`, widen the parameter to `strategy: "scalp" | "iron_fly" | "swing",`. Then replace the `structureLabel` expression:

```ts
    structureLabel:
      strategy === "iron_fly"
        ? "Short Iron Butterfly"
        : SWING_LABELS[swingShape(legs) ?? (firstOpening.right === "C" ? "long_call" : "long_put")],
```

(`swingShape` of a scalp's one long leg is `long_call` or `long_put`, so scalps keep "Long call" and "Long put".)

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/importers`
Expected: PASS, including the existing property test ("puts every fill in exactly one trade…").

- [ ] **Step 5: Write the failing sync-write and duplicate tests**

Append to `packages/db/src/repositories/ibkr.test.ts` (it has `ibkr()`, `trades()`, `ACCOUNT` and the `scalp(overrides, id)` builder):

```ts
describe("the user's Scalp | Swing choice in the sync (swing spec §3.4)", () => {
  const vertical = (id = "trade-nvda"): SyncedTradeInput => {
    const base = scalp({}, id);
    return {
      ...base,
      trade: {
        ...base.trade,
        strategy: "swing",
        structureLabel: "Call debit spread",
        legs: [
          { right: "C", strike: 232.5, expiry: "2026-10-16", quantity: 2, multiplier: 100, openPrice: 3, closePrice: null },
          { right: "C", strike: 240, expiry: "2026-10-16", quantity: -2, multiplier: 100, openPrice: 1, closePrice: null },
        ],
        closedAt: null,
        netPnl: null,
      },
      legIds: [`${id}-long`, `${id}-short`],
    };
  };

  it("keeps a switched single option a swing, and an unchanged re-sync is unchanged", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().update("trade-nvda", { chosenStrategy: "swing" });
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("unchanged");
    expect(trades().get("trade-nvda")).toMatchObject({
      strategy: "swing",
      chosenStrategy: "swing",
      factsEditedAt: null,
    });
  });

  it("keeps the choice when IBKR's facts change", () => {
    const [leg] = scalp().trade.legs;
    ibkr().apply(
      scalp({ closedAt: null, netPnl: null, legs: leg ? [{ ...leg, closePrice: null }] : [] }),
      ACCOUNT.id,
    );
    trades().update("trade-nvda", { chosenStrategy: "swing" });
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("updated");
    expect(trades().get("trade-nvda")).toMatchObject({ strategy: "swing", closedAt: expect.any(Number) });
  });

  it("writes a single option that became a vertical as a swing, whatever the old choice said", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().update("trade-nvda", { chosenStrategy: "scalp" });
    ibkr().apply(vertical(), ACCOUNT.id);
    expect(trades().get("trade-nvda")).toMatchObject({ strategy: "swing", chosenStrategy: "scalp" });
  });

  it("takes a typed swing on the same contract and day as already in the journal", () => {
    trades().create({ ...scalp().trade, source: "manual", strategy: "swing", chosenStrategy: "swing" });
    expect(ibkr().isDuplicate(scalp())).toBe(true);
  });

  it("doesn't take a typed single option for a synced vertical on its long leg", () => {
    trades().create({ ...scalp().trade, source: "manual" });
    expect(ibkr().isDuplicate(vertical())).toBe(false);
  });
});
```

(Import `SyncedTradeInput` with the other types if the file doesn't already.)

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm vitest run packages/db/src/repositories/ibkr.test.ts`
Expected: FAIL. The re-sync answers "updated" and writes `strategy: "scalp"` back, and the typed swing isn't found as a duplicate.

- [ ] **Step 7: Apply the choice and widen the guard in `ibkr.ts`**

1. Add `canSwitchStrategy` to the `@tj/core` import, and `inArray` to the `drizzle-orm` import if it's missing.
2. Above `createIbkrRepo`:

```ts
/**
 * The user's Scalp | Swing on a single bought option (swing spec §3.4): the sync owns the strategy, except there. A
 * trade that is now a vertical is a swing whatever the stored choice says.
 */
function withChoice(candidate: SyncedTradeInput, chosen: string | null): SyncedTradeInput {
  if ((chosen !== "scalp" && chosen !== "swing") || !canSwitchStrategy(candidate.trade)) return candidate;
  return { ...candidate, trade: { ...candidate.trade, strategy: chosen } };
}
```

3. In `apply`, rename the parameter to `incoming` and start the body with:

```ts
    apply(incoming: SyncedTradeInput, accountId: string): ApplyResult {
      const existing = db.select().from(trades).where(eq(trades.id, incoming.id)).get();
      if (existing?.deletedAt != null) return "deleted";
      // Compared and written with the user's choice in: else a switched trade would differ on every run.
      const candidate = withChoice(incoming, existing?.chosenStrategy ?? null);
```

and leave the rest of the body unchanged: it already reads `candidate`. In its `db.insert(trades).values({...})`, add `chosenStrategy: null,` after `factsEditedAt: null,`.

4. In `matches`, replace the strategy condition `eq(trades.strategy, trade.strategy),` with:

```ts
          // A typed single option is the same trade whether the user called it a scalp or a swing.
          trade.strategy === "iron_fly"
            ? eq(trades.strategy, "iron_fly")
            : inArray(trades.strategy, ["scalp", "swing"]),
```

and replace the non-fly branch `} else if (first && otherLegs.some(...)) {` with:

```ts
      } else if (
        otherLegs.length === trade.legs.length &&
        trade.legs.every((mine) =>
          otherLegs.some(
            (leg) => leg.right === mine.right && leg.strike === mine.strike && leg.expiry === mine.expiry,
          ),
        )
      ) {
        return true;
      }
```

If `first` is now unused outside the fly branch, keep it: the fly branch still reads `first?.expiry`.

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm vitest run packages/db packages/importers`
Expected: PASS.

- [ ] **Step 9: Write the failing server tests**

Create `apps/server/src/swing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };

/** A long call held over a weekend: 2 Oct 2026 to 5 Oct 2026. */
const longCall = {
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 9, 2, 14, 15),
  closedAt: Date.UTC(2026, 9, 5, 15, 0),
  netPnl: 100,
  fees: 2,
  legs: [{ right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, openPrice: 5, closePrice: 6.02 }],
};
const vertical = {
  ...longCall,
  strategy: "swing",
  structureLabel: "Call debit spread",
  legs: [
    { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, openPrice: 5.1, closePrice: 9 },
    { right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, openPrice: 1.3, closePrice: 1.15 },
  ],
};

function setup() {
  const app = testApp();
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  const post = async (body: unknown) => (await (await send("POST", "/api/trades", body)).json()) as { id: string };
  const list = async (query: string) =>
    (await (await app.request(`/api/trades?${query}`, { headers: LOCAL })).json()) as { id: string }[];
  return { app, send, post, list };
}

describe("swings through the API (swing spec §3.5, §6.2)", () => {
  it("switches a scalp to a swing, lists it with the swings, and takes it out of the review queue", async () => {
    const { send, post, list } = setup();
    const { id } = await post(longCall);
    expect((await list("strategy=scalp&review=pending")).map((trade) => trade.id)).toEqual([id]);
    const res = await send("PATCH", `/api/trades/${id}`, { chosenStrategy: "swing" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ strategy: "swing", chosenStrategy: "swing" });
    expect((await list("strategy=swing")).map((trade) => trade.id)).toEqual([id]);
    expect(await list("strategy=swing&review=pending")).toEqual([]);
    expect(await list("strategy=scalp&review=pending")).toEqual([]);
  });

  it("refuses the switch on a vertical, saying why", async () => {
    const { send, post } = setup();
    const { id } = await post(vertical);
    const res = await send("PATCH", `/api/trades/${id}`, { chosenStrategy: "scalp" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "Only a single bought call or put can be switched." });
  });

  it("takes a setup for swings", async () => {
    const { send } = setup();
    const res = await send("POST", "/api/setups", { name: "Weekly breakout", strategy: "swing" });
    expect(res.ok).toBe(true);
    expect(await res.json()).toMatchObject({ strategy: "swing" });
  });
});
```

- [ ] **Step 10: Run them to see them fail**

Run: `pnpm vitest run apps/server/src/swing.test.ts`
Expected: FAIL. `strategy=swing` is a 400 from the list query's enum, and the setup's strategy enum refuses "swing".

- [ ] **Step 11: Use core's strategies in the routes**

In `apps/server/src/routes/trades.ts`, import `STRATEGIES` from `@tj/core`, then:

```ts
  // was: strategy: z.enum(["scalp", "iron_fly"]).optional(),
  strategy: z.enum(STRATEGIES).optional(),
```

and in the queue branch:

```ts
        // was: if (filter.strategy === "iron_fly") return c.json([]);
        if (filter.strategy && filter.strategy !== "scalp") return c.json([]);
```

In `apps/server/src/routes/taxonomy.ts`, import `STRATEGIES` from `@tj/core` and change both `z.enum(["scalp", "iron_fly"])` to `z.enum(STRATEGIES)`, keeping their `.nullish()` / `.nullable()`.

- [ ] **Step 12: Run them to see them pass, then the type check**

Run: `pnpm vitest run apps/server packages/db packages/importers && pnpm typecheck`
Expected: PASS. If the web's `useCreateSetup` type now complains, it's widened in Task 5; until then `typecheck` should still pass, because the web passes literals.

- [ ] **Step 13: Commit**

```bash
pnpm format && pnpm lint
git add packages/importers packages/db apps/server
git commit -m "feat(sync): debit verticals sync as swings, and the sync keeps the user's Scalp | Swing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web lists: the SWING chip, the Swings page, nav, palette and setups

**Files:**
- Modify: `apps/web/src/components/ui.tsx`, `apps/web/src/routes/Journal.tsx`, `apps/web/src/palette/Palette.tsx`, `apps/web/src/palette/query.ts`, `apps/web/src/palette/pages.ts`, `apps/web/src/components/Shell.tsx`, `apps/web/src/router.tsx`, `apps/web/src/review/Pickers.tsx`, `apps/web/src/review/data.ts`, `apps/web/src/review/text.ts`, `apps/web/src/routes/Playbook.tsx`
- Create: `apps/web/src/routes/Swings.tsx`, `apps/web/src/routes/Swings.test.tsx`
- Test: `apps/web/src/components/Shell.test.tsx`, `apps/web/src/palette/query.test.ts`, `apps/web/src/palette/pages.test.ts`, `apps/web/src/routes/Journal.test.tsx`, `apps/web/src/routes/Playbook.test.tsx`

**Interfaces:**
- Consumes: `type Strategy`, `returnOnCost` (now covering swings), `pctKept` (core).
- Produces: `strategyChipText(strategy: string): string` in `components/ui.tsx`; the `Swings` component; the `/swings` route; `JournalFilter.strategy?: Strategy`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/Swings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Swings } from "./Swings.js";

const swing = {
  id: "w1",
  strategy: "swing",
  chosenStrategy: null,
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Call debit spread",
  openedAt: Date.UTC(2026, 9, 2, 14, 15),
  closedAt: Date.UTC(2026, 9, 9, 15, 0),
  netPnl: 402.1,
  fees: 2.9,
  notes: null,
  grade: null,
  excluded: false,
  setupId: null,
  tagIds: [],
  risk: null,
  missedRisk: null,
  review: null,
  legs: [
    { id: "a", right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, multiplier: 100, openPrice: 5.1, closePrice: 9 },
    { id: "b", right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, multiplier: 100, openPrice: 1.3, closePrice: 1.15 },
  ],
};

function show(trades: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/api/trades") ? trades : [];
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Swings />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Swings", () => {
  it("lists the swings with their chip and return on debit", async () => {
    const fetchMock = show([swing]);
    expect(await screen.findByText("SWING")).toBeTruthy();
    expect(screen.getByText("Return")).toBeTruthy();
    expect(screen.getByTestId("pct-w1").textContent).toBe("+105.82%");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("strategy=swing"))).toBe(true);
  });

  it("says where swings come from when there are none", async () => {
    show([]);
    expect(
      await screen.findByText("Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."),
    ).toBeTruthy();
  });
});
```

Then the neighbouring tests:

`apps/web/src/components/Shell.test.tsx`: in `DESTINATIONS`, add `"Swings",` after `"Scalps",`.

`apps/web/src/palette/pages.test.ts`: `expect(PAGES).toHaveLength(14);` (was 13), and in "matches the start of each word, in order" add:

```ts
    expect(labels("sw")).toEqual(["Swings"]);
```

`apps/web/src/palette/query.test.ts`: in "reads strategies and books", add:

```ts
    expect(read("swing swings")).toEqual([
      { kind: "strategy", strategy: "swing" },
      { kind: "strategy", strategy: "swing" },
    ]);
```

`apps/web/src/routes/Playbook.test.tsx`: beside "adds a setup from + New setup" (it uses the file's `stubApi`, `renderPlaybook` and `sent`; add `within` to the testing-library import):

```tsx
  it("adds a setup for swings, and calls a setup for every strategy Any", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(await screen.findByRole("button", { name: "+ New setup" }));
    const strategy = screen.getByRole("combobox", { name: "Strategy" });
    expect(within(strategy).getByRole("option", { name: "Any" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Setup name" }), { target: { value: "Weekly breakout" } });
    fireEvent.change(strategy, { target: { value: "swing" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Setup name" }), { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/setups"), { name: "Weekly breakout", strategy: "swing", description: null }],
      ]),
    );
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Swings.test.tsx apps/web/src/components/Shell.test.tsx apps/web/src/palette apps/web/src/routes/Playbook.test.tsx`
Expected: FAIL. There's no `Swings.js`, no nav item, no palette words and no Swings option.

- [ ] **Step 3: Make the chip, the list and the page**

`apps/web/src/components/ui.tsx`: add the swing tone and the chip text.

```ts
const CHIP_TONES: Record<string, string> = {
  iron_fly: "bg-[#7e57c22a] text-[#b39ddb]",
  scalp: "bg-[#ff980022] text-[#ffb74d]",
  swing: "bg-[#ec407a22] text-[#f48fb1]",
  // ...the rest unchanged
};

const STRATEGY_CHIPS: Record<string, string> = { iron_fly: "IRON FLY", scalp: "SCALP", swing: "SWING" };

/** A strategy's chip text in lists: "IRON FLY", "SCALP", "SWING". */
export const strategyChipText = (strategy: string): string =>
  STRATEGY_CHIPS[strategy] ?? strategy.toUpperCase();
```

`apps/web/src/routes/Journal.tsx`:
- Import `type Strategy` from `@tj/core`, and `strategyChipText` from `../components/ui.js`.
- `JournalFilter.strategy?: Strategy;`
- `const PCT_HEADER: Record<Strategy, string> = { scalp: "Return", iron_fly: "% kept", swing: "Return" };`
- The chip: `<Chip tone={trade.strategy}>{strategyChipText(trade.strategy)}</Chip>`
- The % cell's value:

  ```tsx
  trade.book === "missed" ? null : trade.strategy === "iron_fly" ? pctKept(trade) : returnOnCost(trade)
  ```

`apps/web/src/palette/Palette.tsx`: the chip becomes `<Chip tone={trade.strategy}>{strategyChipText(trade.strategy)}</Chip>`.

`apps/web/src/palette/query.ts`: import `type Strategy` from `@tj/core`. Change the word kind to `{ kind: "strategy"; strategy: Strategy }` and the map to `Record<string, Strategy>`, adding `swing: "swing", swings: "swing",`.

`apps/web/src/palette/pages.ts`: after `{ label: "Iron Flies", href: "/iron-flies" },`, add `{ label: "Swings", href: "/swings" },`.

`apps/web/src/components/Shell.tsx`: after the Scalps entry in `NAV`, add `{ label: "Swings", path: "/swings" },`.

Create `apps/web/src/routes/Swings.tsx`:

```tsx
import type { OpenTrade } from "../nav/tradeList.js";
import { Journal } from "./Journal.js";

/** Every swing (swing spec §6.2): debit verticals from the sync, and single options the user switched. */
export function Swings({ onOpenTrade }: { onOpenTrade?: OpenTrade }) {
  return (
    <Journal
      title="Swings"
      lockedFilter={{ strategy: "swing", taken: true }}
      onOpenTrade={onOpenTrade}
      emptyText="Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."
    />
  );
}
```

`apps/web/src/router.tsx`: import `Swings`, and add a route after `scalpsRoute`. Then add `swingsRoute` to `rootRoute.addChildren([...])` after `newScalpRoute`.

```tsx
const swingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/swings",
  component: () => <Swings onOpenTrade={openTrade} />,
});
```

- [ ] **Step 4: Setups for swings**

- **`apps/web/src/review/text.ts`:**
  - `const STRATEGY_LABELS: Record<string, string> = { scalp: "Scalps", iron_fly: "Iron flies", swing: "Swings" };`
  - the fallback `?? "Both"` becomes `?? "Any"`;
  - the comment says "…or "Any" for a setup that takes every strategy".
- **`apps/web/src/routes/Playbook.tsx`:**
  - `type Strategy = "scalp" | "iron_fly" | "swing" | null;`
  - its options list gains `{ value: "swing", label: "Swings" }` before `{ value: null, label: "Any" }` (renamed from "Both").
- **`apps/web/src/review/data.ts`:**
  - `useCreateSetup`'s input type is `strategy: "scalp" | "iron_fly" | "swing" | null;`
  - in `shownAtOnce`, so a switch shows at once:

  ```ts
      ...(body.chosenStrategy === undefined
        ? {}
        : { chosenStrategy: body.chosenStrategy, strategy: body.chosenStrategy }),
  ```

- **`apps/web/src/review/Pickers.tsx`:** the setup's strategy is the trade's own:

  ```ts
    // was: const strategy = trade.strategy === "iron_fly" ? "iron_fly" : "scalp";
    const strategy = (["scalp", "iron_fly", "swing"] as const).find((each) => each === trade.strategy) ?? "scalp";
  ```

  The filter below it (`setup.strategy == null || setup.strategy === strategy`) then lists swing setups and setups for any strategy on a swing.

Update any test that expects "Both" (search `apps/web/src` for `"Both"`) to expect "Any".

- [ ] **Step 5: Run the web tests and the type check**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add apps/web/src
git commit -m "feat(web): the SWING chip, the Swings page, nav, palette and swing setups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The swing chart: weekly candles, the weekly range, markers, price lines

**Files:**
- Modify: `packages/core/src/chart.ts`, `packages/core/src/chart.test.ts`
- Modify: `apps/server/src/bars.ts`, `apps/server/src/routes/bars.ts`, `apps/server/src/bars.test.ts`
- Modify: `apps/web/src/chart/bars.ts`, `apps/web/src/chart/prefs.ts`, `apps/web/src/chart/model.ts`, `apps/web/src/chart/DailyChart.tsx`, `apps/web/src/chart/ChartToolbar.tsx`
- Create: `apps/web/src/chart/swing.ts`, `apps/web/src/chart/swing.test.ts`, `apps/web/src/chart/SwingChart.tsx`, `apps/web/src/chart/SwingChart.test.tsx`

**Interfaces:**
- Consumes: `swingMetrics`, `SwingMetrics` (Task 1); `dailyModel`, `priceText`, `Marker`, `DailyModel`, `ChartFill` (web chart model); `PriceLine` (IntradayChart).
- Produces:
  - `weeklyBars(daily: readonly PriceBar[]): PriceBar[]` and `mondayOf(date: string): string` in core;
  - `GET /api/bars/:symbol/daily?to=…&span=weekly`;
  - `useDailyBars(symbol, to, wanted?, span?: "daily" | "weekly")`, `useMinuteBars(symbol, from, to, live, wanted?)`;
  - `ChartPrefs.swingPeriod: "daily" | "weekly"`;
  - `DailyChart`'s new `lines?: readonly PriceLine[]` prop;
  - `swingMarks`, `swingChartModel`, `swingLines`, `SwingChartTrade` in `chart/swing.ts`;
  - `<SwingChart trade lines />`.

- [ ] **Step 1: Write the failing core and server tests**

Append to `packages/core/src/chart.test.ts` (add `weeklyBars`, `mondayOf` and `nyClock` to its import from `./chart.js`, and `nyWallClock` from `./calendar.js` if it isn't imported):

```ts
describe("weeklyBars (swing spec §4.2)", () => {
  const day = (date: string, o: number, h: number, l: number, c: number) => ({
    t: nyWallClock(date, 0),
    o,
    h,
    l,
    c,
    v: 100,
  });

  it("makes one candle a week, Monday to Friday, stamped at its first session", () => {
    expect(
      weeklyBars([
        day("2026-10-05", 10, 12, 9, 11),
        day("2026-10-06", 11, 13, 10, 12),
        day("2026-10-09", 12, 15, 11, 14),
        day("2026-10-12", 14, 14, 13, 13),
      ]),
    ).toEqual([
      { t: nyWallClock("2026-10-05", 0), o: 10, h: 15, l: 9, c: 14, v: 300 },
      { t: nyWallClock("2026-10-12", 0), o: 14, h: 14, l: 13, c: 13, v: 100 },
    ]);
  });

  it("keys a week by its Monday, across a new year and in a week whose Monday is a holiday", () => {
    // 29 Dec 2025 to 2 Jan 2026 has 1 Jan off; Monday 19 Jan 2026 is Martin Luther King Day.
    const weeks = weeklyBars([
      day("2025-12-29", 1, 2, 1, 2),
      day("2025-12-31", 2, 3, 2, 3),
      day("2026-01-02", 3, 4, 3, 4),
      day("2026-01-20", 5, 6, 5, 6),
      day("2026-01-23", 6, 7, 4, 5),
    ]);
    expect(weeks.map((week) => [nyClock(week.t).date, week.o, week.c])).toEqual([
      ["2025-12-29", 1, 4],
      ["2026-01-20", 5, 5],
    ]);
    expect(mondayOf("2026-01-23")).toBe("2026-01-19");
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  });
});
```

Append to `apps/server/src/bars.test.ts`, inside `describe("GET /api/bars/:symbol/daily", ...)`:

```ts
  it("asks for five years for the weekly view, fetching only what the three years lacked", async () => {
    const { dailyBars, get } = setup();
    await get("/api/bars/SPY/daily?to=2026-09-29");
    await get("/api/bars/SPY/daily?to=2026-09-29&span=weekly");
    expect(dailyBars.mock.calls).toEqual([
      ["SPY", "2023-09-29", "2026-09-28"],
      ["SPY", "2021-09-28", "2023-09-28"],
    ]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/src/chart.test.ts apps/server/src/bars.test.ts`
Expected: FAIL. `weeklyBars` and `mondayOf` don't exist, and the route ignores (or refuses) `span`.

- [ ] **Step 3: `weeklyBars`, `mondayOf`, and the span**

In `packages/core/src/chart.ts`, add `addDays`, `WEEKDAYS` and `weekdayOfDate` to the `./calendar.js` import, then:

```ts
/** The Monday of a YYYY-MM-DD date's week, Monday to Sunday. */
export const mondayOf = (date: string): string => addDays(date, -WEEKDAYS.indexOf(weekdayOfDate(date)));

/**
 * Daily bars grouped by their New York week (swing spec §4.2): the first open, the highest high, the lowest low, the
 * last close and the summed volume, stamped at the week's first session. A week is keyed by its Monday, holiday or
 * not.
 */
export function weeklyBars(daily: readonly PriceBar[]): PriceBar[] {
  const weeks: PriceBar[] = [];
  let week = "";
  for (const bar of daily) {
    const monday = mondayOf(nyClock(bar.t).date);
    const last = weeks.at(-1);
    if (!last || monday !== week) {
      weeks.push({ ...bar });
      week = monday;
      continue;
    }
    last.h = Math.max(last.h, bar.h);
    last.l = Math.min(last.l, bar.l);
    last.c = bar.c;
    last.v += bar.v;
  }
  return weeks;
}
```

In `apps/server/src/bars.ts`:

```ts
/** Five years for a swing's weekly view (swing spec §4.2): EMA 50 draws from its 150th week. */
const WEEKLY_DAYS = 1_826;
```

and change the service's signature and first lines:

```ts
    async daily(symbol: string, to: string, span: "daily" | "weekly" = "daily"): Promise<BarAnswer> {
      const today = nyDate(now());
      const last = to < today ? to : addDays(today, -1);
      const dates = datesBetween(addDays(last, span === "weekly" ? -WEEKLY_DAYS : -DAILY_DAYS), last);
```

In `apps/server/src/routes/bars.ts`:

```ts
    .get(
      "/:symbol/daily",
      zValidator("query", z.object({ to: isoDate, span: z.enum(["daily", "weekly"]).optional() })),
      async (c) => {
        const symbol = c.req.param("symbol").toUpperCase();
        if (!TICKER.test(symbol)) return c.json({ error: "bad request" }, 400);
        const { to, span } = c.req.valid("query");
        try {
          const answer = await service.daily(symbol, to, span);
          // ...the rest of the handler as before
```

Keep the rest of the handler's body as it was, re-indented by Biome.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/core/src/chart.test.ts apps/server/src/bars.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing chart-model tests**

Create `apps/web/src/chart/swing.test.ts`:

```ts
import { addDays, isTradingDay, nyWallClock, type PriceBar, swingMetrics } from "@tj/core";
import { describe, expect, it } from "vitest";
import { type SwingChartTrade, swingChartModel, swingLines, swingMarks } from "./swing.js";

/** Daily bars, stamped at New York midnight, for every session from `from` to `to`. */
function dailyBars(from: string, to: string): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isTradingDay(date)) bars.push({ t: nyWallClock(date, 0), o: 230, h: 236, l: 228, c: 233, v: 1_000 });
  }
  return bars;
}
const at = (date: string, minute = 10 * 60) => nyWallClock(date, minute);
const fill = (date: string, strike: number, quantity: number, price: number, kind = "trade") => ({
  executedAt: at(date),
  right: "C",
  strike,
  quantity,
  price,
  kind,
  canceled: false,
});
const legs = [
  { right: "C", strike: 230, expiry: "2026-11-06", quantity: 1, multiplier: 100, openPrice: 5.1, closePrice: 9 },
  { right: "C", strike: 240, expiry: "2026-11-06", quantity: -1, multiplier: 100, openPrice: 1.3, closePrice: 1.15 },
];
const spread: SwingChartTrade = {
  openedAt: at("2026-10-02"),
  closedAt: at("2026-10-09"),
  legs,
  fills: [
    fill("2026-10-02", 230, 1, 5.1),
    fill("2026-10-02", 240, -1, 1.3),
    fill("2026-10-09", 230, -1, 9),
    fill("2026-10-09", 240, 1, 1.15),
  ],
};
const texts = (trade: SwingChartTrade, period: "daily" | "weekly" = "daily") =>
  swingMarks(trade, period).map((mark) => [mark.key, mark.marker.text, mark.marker.side]);

describe("swingMarks (swing spec §4.3)", () => {
  it("makes one marker a day for opening and for closing, at the net price per spread", () => {
    expect(texts(spread)).toEqual([
      ["2026-10-02", "B 1 @ 3.80", "buy"],
      ["2026-10-09", "S 1 @ 7.85", "sell"],
    ]);
  });

  it("reads a legged-in short as the sale it was", () => {
    const legged = { ...spread, fills: [fill("2026-10-02", 230, 1, 5.1), fill("2026-10-05", 240, -1, 1.3)] };
    expect(texts(legged)).toEqual([
      ["2026-10-02", "B 1 @ 5.10", "buy"],
      ["2026-10-05", "S 1 @ 1.30", "sell"],
    ]);
  });

  it("sizes a partial close by its contracts", () => {
    const two = {
      ...spread,
      fills: [
        fill("2026-10-02", 230, 2, 5.1),
        fill("2026-10-02", 240, -2, 1.3),
        fill("2026-10-07", 230, -1, 8),
        fill("2026-10-07", 240, 1, 1.2),
      ],
    };
    expect(texts(two)).toEqual([
      ["2026-10-02", "B 2 @ 3.80", "buy"],
      ["2026-10-07", "S 1 @ 6.80", "sell"],
    ]);
  });

  it("marks an expiry on its day", () => {
    const expired = {
      ...spread,
      fills: [
        fill("2026-10-02", 230, 1, 5.1),
        fill("2026-10-02", 240, -1, 1.3),
        { ...fill("2026-11-06", 230, -1, 0, "expiration"), executedAt: at("2026-11-06", 16 * 60 + 20) },
        { ...fill("2026-11-06", 240, 1, 0, "expiration"), executedAt: at("2026-11-06", 16 * 60 + 20) },
      ],
    };
    expect(texts(expired).at(-1)).toEqual(["2026-11-06", "expired", "expired"]);
  });

  it("uses the legs of a trade typed in by hand", () => {
    expect(texts({ ...spread, fills: [] })).toEqual([
      ["2026-10-02", "B 1 @ 3.80", "buy"],
      ["2026-10-09", "S 1 @ 7.85", "sell"],
    ]);
  });

  it("merges a week's fills under its Monday", () => {
    expect(texts(spread, "weekly")).toEqual([
      ["2026-09-28", "B 1 @ 3.80", "buy"],
      ["2026-10-05", "S 1 @ 7.85", "sell"],
    ]);
  });
});

describe("swingChartModel", () => {
  const daily = dailyBars("2026-06-01", "2026-10-12");

  it("puts the markers on their days' candles and opens on the trade", () => {
    const model = swingChartModel(daily, [], spread, [8], "2026-10-09", "daily");
    expect(model.markers.map((marker) => marker.t)).toEqual([nyWallClock("2026-10-02", 0), nyWallClock("2026-10-09", 0)]);
    const first = model.candles.findIndex((candle) => candle.t === nyWallClock("2026-10-02", 0));
    expect(model.window?.from).toBe(first - 20);
  });

  it("draws weeks, with the markers on their weeks' first sessions", () => {
    const model = swingChartModel(daily, [], spread, [8, 167], "2026-10-09", "weekly");
    expect(model.markers.map((marker) => marker.t)).toEqual([nyWallClock("2026-09-28", 0), nyWallClock("2026-10-05", 0)]);
    expect(model.emas[1]?.points).toEqual([]);
  });
});

describe("swingLines", () => {
  it("draws both strikes and the break-even", () => {
    const metrics = swingMetrics({ legs, netPnl: 402.1, openedAt: spread.openedAt, closedAt: spread.closedAt }, "2026-10-13");
    expect(swingLines(metrics, legs).map((line) => [line.price, line.label])).toEqual([
      [230, "230"],
      [240, "240"],
      [233.8, "BE 233.80"],
    ]);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/chart/swing.test.ts`
Expected: FAIL, "Failed to resolve import ./swing.js".

- [ ] **Step 7: Write the chart model**

In `apps/web/src/chart/model.ts`, export the two helpers the swing model reuses: change `const drawable = …` to `export const drawable = …`, and `function openingWindow(` to `export function openingWindow(`.

Create `apps/web/src/chart/swing.ts`:

```ts
import { ema, mondayOf, nyClock, type PriceBar, type SwingMetrics, weeklyBars } from "@tj/core";
import type { PriceLine } from "./IntradayChart.js";
import {
  type ChartFill,
  type DailyModel,
  dailyModel,
  drawable,
  type Marker,
  openingWindow,
  priceText,
} from "./model.js";

export type SwingPeriod = "daily" | "weekly";

/** A fill with its contract, so a day's fills can be sized per leg. */
export interface SwingChartFill extends ChartFill {
  right: string;
  strike: number;
}
export interface SwingChartLeg {
  right: string;
  strike: number;
  quantity: number;
  openPrice: number;
  closePrice: number | null;
}
export interface SwingChartTrade {
  openedAt: number;
  closedAt: number | null;
  fills: readonly SwingChartFill[];
  legs: readonly SwingChartLeg[];
}

/** A marker before it's placed on a candle: `key` is its New York day, or its week's Monday. */
export interface SwingMark {
  key: string;
  marker: Omit<Marker, "t">;
}

const STRIKE_COLOR = "#f48fb1";
const BREAK_EVEN_COLOR = "#9aa3b5";
/** Without fills to frame, the chart opens on its last 60 candles. */
const FALLBACK_VISIBLE = 60;
const EVENTS: Record<string, string> = { expiration: "expired", exercise: "exercised", assignment: "assigned" };
const contractOf = (each: { right: string; strike: number }) => `${each.right}${each.strike}`;
const exact = (value: number) => Math.round(value * 1e6) / 1e6;

interface Group {
  key: string;
  cash: number;
  sizes: Map<string, number>;
}

/**
 * The swing's fills as markers (swing spec §4.3): per day (or week), the opening fills make one and the closing fills
 * another. Its size is the most contracts on any one leg, its price the net cash per spread: "B" when it paid, "S" when
 * it received. Expiries, exercises and assignments are markers of their own. A trade typed in by hand opens and closes
 * at its legs' prices.
 */
export function swingMarks(trade: SwingChartTrade, period: SwingPeriod): SwingMark[] {
  const keyOf = (t: number) => {
    const date = nyClock(t).date;
    return period === "weekly" ? mondayOf(date) : date;
  };
  const opensWith = new Map(trade.legs.map((leg) => [contractOf(leg), Math.sign(leg.quantity)]));
  let fills: readonly SwingChartFill[] = trade.fills.filter((fill) => !fill.canceled);
  if (fills.length === 0) {
    const closed = trade.closedAt;
    fills = [
      ...trade.legs.map((leg) => ({ ...leg, executedAt: trade.openedAt, price: leg.openPrice, kind: "trade", canceled: false })),
      ...(closed == null
        ? []
        : trade.legs.flatMap((leg) =>
            leg.closePrice == null
              ? []
              : [{ ...leg, quantity: -leg.quantity, executedAt: closed, price: leg.closePrice, kind: "trade", canceled: false }],
          )),
    ];
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  const marks = new Map<string, SwingMark>();
  for (const fill of [...fills].sort((a, b) => a.executedAt - b.executedAt)) {
    const key = keyOf(fill.executedAt);
    const event = EVENTS[fill.kind];
    if (event) {
      const id = `${key}|${event}`;
      if (!marks.has(id)) {
        marks.set(id, { key, marker: { side: event === "expired" ? "expired" : "sell", text: event } });
        order.push(id);
      }
      continue;
    }
    const opening = Math.sign(fill.quantity) === (opensWith.get(contractOf(fill)) ?? Math.sign(fill.quantity));
    const id = `${key}|${opening ? "open" : "close"}`;
    let group = groups.get(id);
    if (!group) {
      group = { key, cash: 0, sizes: new Map() };
      groups.set(id, group);
      order.push(id);
    }
    group.cash += fill.price * fill.quantity;
    group.sizes.set(contractOf(fill), (group.sizes.get(contractOf(fill)) ?? 0) + Math.abs(fill.quantity));
  }
  return order.flatMap((id) => {
    const mark = marks.get(id);
    if (mark) return [mark];
    const group = groups.get(id);
    if (!group) return [];
    const size = Math.max(...group.sizes.values());
    const net = exact(group.cash / size);
    const paid = net > 0;
    return [
      {
        key: group.key,
        marker: { side: paid ? "buy" : "sell", text: `${paid ? "B" : "S"} ${size} @ ${priceText(Math.abs(net))}`, price: Math.abs(net) },
      },
    ];
  });
}

/**
 * Everything the swing chart draws (swing spec §5.4): daily candles, today's built from minute bars, or weekly ones
 * made of them; EMAs on the shown candles' closes; the markers on their candles; the trade framed with 20 either side.
 */
export function swingChartModel(
  daily: readonly PriceBar[],
  minuteBars: readonly PriceBar[],
  trade: SwingChartTrade,
  emaLengths: readonly number[],
  lastDay: string,
  period: SwingPeriod,
): DailyModel {
  const days = dailyModel(daily, minuteBars, trade, [], lastDay).candles;
  const candles = period === "weekly" ? weeklyBars(days) : days;
  const keyOf = (t: number) => {
    const date = nyClock(t).date;
    return period === "weekly" ? mondayOf(date) : date;
  };
  const candleOf = new Map(candles.map((candle) => [keyOf(candle.t), candle.t]));
  const markers = swingMarks(trade, period)
    .flatMap((mark): Marker[] => {
      const t = candleOf.get(mark.key);
      return t === undefined ? [] : [{ ...mark.marker, t }];
    })
    .sort((a, b) => a.t - b.t);
  const closes = candles.map((candle) => candle.c);
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    markers,
    window:
      openingWindow(candles, markers) ??
      (candles.length === 0
        ? null
        : { from: Math.max(0, candles.length - FALLBACK_VISIBLE), to: candles.length - 1 }),
  };
}

/** Each strike and the break-even, titled on the price axis (swing spec §4.4). */
export function swingLines(metrics: SwingMetrics | null, legs: readonly { strike: number }[]): PriceLine[] {
  if (!metrics) return [];
  const strikes = [...new Set(legs.map((leg) => leg.strike))].sort((a, b) => a - b);
  return [
    ...strikes.map((strike) => ({ price: strike, color: STRIKE_COLOR, dashed: true, label: String(strike) })),
    {
      price: metrics.breakEven,
      color: BREAK_EVEN_COLOR,
      dashed: true,
      label: `BE ${priceText(metrics.breakEven)}`,
    },
  ];
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `pnpm vitest run apps/web/src/chart/swing.test.ts`
Expected: PASS (10 tests). If `openingWindow` frames from the first *marker's* candle index minus `WINDOW_PAD` (20), `window.from` equals `first − 20`. If the daily data starts fewer than 20 candles before the trade, it's clamped at 0. The test's data starts on 1 Jun 2026, months earlier.

- [ ] **Step 9: Write the failing component tests**

Create `apps/web/src/chart/SwingChart.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, isTradingDay, nyWallClock, type PriceBar } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwingChart } from "./SwingChart.js";
import { library, resetLibrary, seriesOf } from "./testing.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

function dailyBars(from: string, to: string): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isTradingDay(date)) bars.push({ t: nyWallClock(date, 0), o: 230, h: 236, l: 228, c: 233, v: 1_000 });
  }
  return bars;
}
const DAILY = dailyBars("2021-10-01", "2026-10-09");
const TRADE = {
  underlying: "NVDA",
  openedAt: nyWallClock("2026-10-02", 615),
  closedAt: nyWallClock("2026-10-09", 660),
  fills: [],
  legs: [
    { right: "C", strike: 230, quantity: 1, openPrice: 5.1, closePrice: 9 },
    { right: "C", strike: 240, quantity: -1, openPrice: 1.3, closePrice: 1.15 },
  ],
};
const LINES = [
  { price: 230, color: "#f48fb1", dashed: true, label: "230" },
  { price: 240, color: "#f48fb1", dashed: true, label: "240" },
  { price: 233.8, color: "#9aa3b5", dashed: true, label: "BE 233.80" },
];
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stub({ weeklyFails = false } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("span=weekly") && weeklyFails) return answer({ error: "unreachable" }, 502);
    return answer({ symbol: "NVDA", bars: DAILY, partial: false, unavailable: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SwingChart trade={TRADE} lines={LINES} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  resetLibrary();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SwingChart (swing spec §5.4)", () => {
  it("draws daily candles with wicks, the strike and break-even lines on the axis, and the fills", async () => {
    stub();
    show();
    await waitFor(() => expect(seriesOf("Candlestick")[0]?.data.length).toBeGreaterThan(0));
    const candles = seriesOf("Candlestick")[0];
    expect(candles?.options).toMatchObject({ wickUpColor: expect.any(String), wickDownColor: expect.any(String) });
    expect(candles?.options.wickVisible).not.toBe(false);
    expect(candles?.priceLines.map((line) => [line.price, line.title, line.axisLabelVisible])).toEqual([
      [230, "230", true],
      [240, "240", true],
      [233.8, "BE 233.80", true],
    ]);
    const markers = library.markers.at(-1) as { time: string; text: string }[];
    expect(markers.map((marker) => [marker.time, marker.text])).toEqual([
      ["2026-10-02", "B 1 @ 3.80"],
      ["2026-10-09", "S 1 @ 7.85"],
    ]);
  });

  it("switches to weekly candles from five years of bars, with EMA 167 greyed out", async () => {
    const fetchMock = stub();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Weekly" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("span=weekly"))).toBe(true),
    );
    const ema167 = screen.getByRole("button", { name: "EMA 167" }) as HTMLButtonElement;
    await waitFor(() => expect(ema167.disabled).toBe(true));
    expect(ema167.title).toBe("Needs more history than a weekly chart has");
    expect((screen.getByRole("button", { name: "EMA 50" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the weekly fetch's failure and still draws Daily", async () => {
    stub({ weeklyFails: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Weekly" }));
    expect(await screen.findByText("Couldn't load the chart: Alpaca didn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    await waitFor(() => expect(screen.getByTestId("daily-chart")).toBeTruthy());
  });
});
```

- [ ] **Step 10: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/chart/SwingChart.test.tsx`
Expected: FAIL, "Failed to resolve import ./SwingChart.js".

- [ ] **Step 11: Price lines on the daily chart, the period preference, the hooks, the component**

`apps/web/src/chart/DailyChart.tsx`:
- Add `type IPriceLine` and `LineStyle` to the `lightweight-charts` import, and `import type { PriceLine } from "./IntradayChart.js";`.
- `interface Parts` gains `priceLines: IPriceLine[];`, and the creation sets `priceLines: []`.
- The props gain `lines = NO_LINES,` (typed `lines?: readonly PriceLine[];`), with `const NO_LINES: readonly PriceLine[] = [];` at module level.
- After the `[show]` effect, add:

```tsx
  // A swing's strikes and break-even (swing spec §4.4): the library titles each on the price axis at its own price.
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
```

`apps/web/src/chart/ChartToolbar.tsx`: export the button styles, `export const BUTTON = …` and `export const on = …`.

`apps/web/src/chart/prefs.ts`:
- `ChartPrefs` gains `/** The swing chart's candles (swing spec §5.4). */ swingPeriod: "daily" | "weekly";`.
- `DEFAULT_PREFS` gains `swingPeriod: "daily",`.
- `loadPrefs` destructures `swingPeriod` from `saved` and returns `swingPeriod: swingPeriod === "weekly" ? "weekly" : "daily",`.

`apps/web/src/chart/bars.ts`:
- `useMinuteBars(symbol, from, to, live, wanted = true)`: `enabled: wanted && TICKER.test(symbol),`.
- `useDailyBars`:

```ts
/** Daily bars up to the trade's last day: three years, or five for a swing's weekly view (swing spec §4.2). */
export function useDailyBars(symbol: string, to: string, wanted = true, span: "daily" | "weekly" = "daily") {
  return useQuery({
    queryKey: ["daily-bars", symbol, to, span],
    enabled: wanted && TICKER.test(symbol),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars[":symbol"].daily.$get({
        param: { symbol },
        query: span === "weekly" ? { to, span } : { to },
      });
      if (!res.ok) throw new Error(`daily bars failed: ${res.status}`);
      return res.json();
    },
  });
}
```

Create `apps/web/src/chart/SwingChart.tsx`:

```tsx
import { isTradingDay, nyMinuteOfDay, PREMARKET_OPEN, type PriceBar, SESSION_END } from "@tj/core";
import { type ReactNode, useMemo, useState } from "react";
import { TICKER, todayNy } from "../market.js";
import { barRange, useDailyBars, useMinuteBars } from "./bars.js";
import { BUTTON, on } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import type { PriceLine } from "./IntradayChart.js";
import type { Toggle } from "./prefs.js";
import { useChartPrefs } from "./prefs.js";
import { type SwingChartTrade, type SwingPeriod, swingChartModel } from "./swing.js";

const NO_BARS: PriceBar[] = [];
const NO_LINES: readonly PriceLine[] = [];
/** Until 20:16 ET a trade from today can still gain bars (the free data's 15 minutes, and one to spare). */
const LIVE_UNTIL = SESSION_END + 16;
const HEIGHT = 420;
const PERIODS: readonly { id: SwingPeriod; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];
export const WEEKLY_EMA_TITLE = "Needs more history than a weekly chart has";

/** A swing's chart (swing spec §5.4): daily or weekly candles across the page, its fills, its strike lines. */
export function SwingChart({
  trade,
  lines = NO_LINES,
}: {
  trade: SwingChartTrade & { underlying: string };
  lines?: readonly PriceLine[];
}) {
  const [prefs, setPrefs] = useChartPrefs();
  const [fitKey, setFitKey] = useState(0);
  const period = prefs.swingPeriod;
  const symbol = trade.underlying;
  const { lastDay } = barRange(trade);
  const today = todayNy();
  const clock = nyMinuteOfDay(Date.now());
  // Today's candle is built from minute bars: only a swing still open, or closed today, needs them.
  const needsToday = lastDay === today;
  const live = needsToday && isTradingDay(today) && clock >= PREMARKET_OPEN && clock < LIVE_UNTIL;
  const minute = useMinuteBars(symbol, today, today, live, needsToday);
  const daily = useDailyBars(symbol, lastDay, true, period);
  const minuteBars = minute.data?.bars ?? NO_BARS;
  const dailyBars = daily.data?.bars ?? NO_BARS;
  const model = useMemo(
    () => swingChartModel(dailyBars, minuteBars, trade, prefs.emaLengths, lastDay, period),
    [dailyBars, minuteBars, trade, prefs.emaLengths, lastDay, period],
  );
  const starved = model.emas.flatMap((line, index) => (line.points.length === 0 ? [index] : []));

  const toggle = (name: Toggle) => setPrefs({ ...prefs, show: { ...prefs.show, [name]: !prefs.show[name] } });
  const toolbar = (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODS.map((each) => (
        <button
          key={each.id}
          type="button"
          aria-pressed={period === each.id}
          onClick={() => setPrefs({ ...prefs, swingPeriod: each.id })}
          className={`${BUTTON} ${on(period === each.id)}`}
        >
          {each.label}
        </button>
      ))}
      <span aria-hidden className="mx-1 h-3 w-px bg-line" />
      {prefs.emaLengths.map((length, index) => {
        const name = `ema${index}` as Toggle;
        const hungry = starved.includes(index);
        const disabled = period === "weekly" && hungry && daily.isSuccess;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={prefs.show[name] && !disabled}
            disabled={disabled}
            title={disabled ? WEEKLY_EMA_TITLE : hungry ? "needs more history" : undefined}
            onClick={() => toggle(name)}
            className={`${BUTTON} ${on(prefs.show[name] && !disabled)} disabled:opacity-40`}
          >
            EMA {length}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={prefs.show.volume}
        onClick={() => toggle("volume")}
        className={`${BUTTON} ${on(prefs.show.volume)}`}
      >
        Volume
      </button>
      <button
        type="button"
        onClick={() => setFitKey((key) => key + 1)}
        className={`${BUTTON} ml-auto border-line text-muted hover:text-fg`}
      >
        Fit trade
      </button>
    </div>
  );

  const message = (children: ReactNode) => (
    <div className="flex items-center justify-center gap-2 text-center" style={{ height: HEIGHT }}>
      {children}
    </div>
  );
  let body: ReactNode;
  if (!TICKER.test(symbol)) body = message(<p className="text-muted">No stock bars for {symbol}.</p>);
  else if (daily.isError) {
    body = message(
      <>
        <p className="text-down">Couldn't load the chart: Alpaca didn't answer.</p>
        <button
          type="button"
          aria-label="Retry the chart"
          onClick={() => daily.refetch()}
          className="rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
        >
          Retry
        </button>
      </>,
    );
  } else if (daily.isPending) body = message(<p className="text-muted">Loading the chart…</p>);
  else if (daily.data.unavailable || model.candles.length === 0) {
    body = message(<p className="text-muted">{daily.data.unavailable?.message ?? `No daily bars for ${symbol}.`}</p>);
  } else {
    body = <DailyChart model={model} show={prefs.show} fitKey={fitKey} height={HEIGHT} lines={lines} />;
  }

  return (
    <section className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-2" data-testid="swing-chart">
      {toolbar}
      {body}
    </section>
  );
}
```

The `trade` prop is the trade page's query data, so its identity is stable between renders, and the `useMemo` above recomputes only when the trade itself changes.

- [ ] **Step 12: Run them to see them pass, then the chart suite and the type check**

Run: `pnpm vitest run apps/web/src/chart packages/core apps/server && pnpm typecheck`
Expected: PASS. `TradeCharts.test.tsx` still passes: `useDailyBars` keeps its old behaviour for the daily span.

- [ ] **Step 13: Commit**

```bash
pnpm format && pnpm lint
git add packages/core apps/server apps/web/src/chart
git commit -m "feat(chart): the swing chart, daily or weekly, with its fills and strike lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The swing trade page: the switch and W, the hint, the tiles, the layout, Edit

**Files:**
- Create: `apps/web/src/review/StrategySwitch.tsx`, `apps/web/src/routes/SwingTiles.tsx`, `apps/web/src/routes/TradeDetail.swing.test.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/review/useTradeKeys.ts`, `apps/web/src/review/useTradeKeys.test.tsx`, `apps/web/src/routes/EditTrade.tsx`, `apps/web/src/routes/EditTrade.test.tsx`

**Interfaces:**
- Consumes:
  - core: `canSwitchStrategy`, `showsSwingHint`, `swingMetrics`, `ChosenStrategy`, `returnOnCost`, `dayYearText`;
  - `SwingChart`, `swingLines` (Task 6);
  - `useSaveTrade`, with its `shownAtOnce` already showing `chosenStrategy` (Task 5);
  - `TradeView.chosenStrategy` (Task 3).
- Produces: `<StrategySwitch trade />`, `<OvernightHint trade now? />`, `<SwingTiles trade today estimatedPnl />`; the W key.

- [ ] **Step 1: Write the failing page tests**

Create `apps/web/src/routes/TradeDetail.swing.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider } from "../keys/Shortcuts.js";
import { TradeDetail } from "./TradeDetail.js";

vi.mock("../chart/SwingChart.js", () => ({
  SwingChart: ({ lines }: { lines: { label: string }[] }) => (
    <div data-testid="swing-chart">{lines.map((line) => line.label).join(" ")}</div>
  ),
}));
vi.mock("../review/ReviewPanel.js", () => ({
  ReviewPanel: ({ layout }: { layout: string }) => <div data-testid="review-panel">{layout}</div>,
}));
vi.mock("../review/ScalpWorkspace.js", () => ({ ScalpWorkspace: () => <div data-testid="scalp-workspace" /> }));

const leg = (id: string, strike: number, quantity: number, openPrice: number, closePrice: number | null) => ({
  id,
  right: "C",
  strike,
  expiry: "2026-11-06",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice,
});
const spread = {
  id: "t1",
  strategy: "swing",
  chosenStrategy: null,
  book: "paper",
  source: "ibkr_flex",
  factsEditedAt: null,
  underlying: "NVDA",
  underlyingName: "NVIDIA",
  structureLabel: "Call debit spread",
  openedAt: nyWallClock("2026-10-02", 615),
  closedAt: nyWallClock("2026-10-09", 660),
  netPnl: 402.1,
  fees: 2.9,
  feesOpen: 1.45,
  feesClose: 1.45,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  setupId: null,
  tagIds: [],
  ironFly: null,
  metrics: null,
  review: null,
  risk: null,
  missedRisk: null,
  scalp: null,
  reviewedAt: null,
  fills: [],
  attachments: [],
  legs: [leg("a", 230, 1, 5.1, 9), leg("b", 240, -1, 1.3, 1.15)],
};
const single = {
  ...spread,
  chosenStrategy: "swing",
  structureLabel: "Long call",
  netPnl: 100,
  legs: [leg("a", 230, 1, 5, 6.02)],
};
const scalp = { ...single, strategy: "scalp", chosenStrategy: null };

function show(body: unknown, patchReply?: Response) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return patchReply ?? json(body);
      }
      const url = String(input);
      if (url.includes("/api/option-quotes")) return json({ quotes: {}, available: false });
      if (url.includes("/api/trades/t1")) return json(body);
      return json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <ShortcutsProvider>
        <TradeDetail tradeId="t1" />
      </ShortcutsProvider>
    </QueryClientProvider>,
  );
  return patches;
}
const press = (key: string) => fireEvent.keyDown(document.body, { key, code: `Key${key.toUpperCase()}` });

afterEach(() => vi.unstubAllGlobals());

describe("a swing's page (swing spec §5)", () => {
  it("shows a call spread's maths, its chart lines and the review panel, with no switch and no Edit", async () => {
    show(spread);
    expect((await screen.findByTestId("swing-chart")).textContent).toBe("230 240 BE 233.80");
    expect(screen.getByTestId("tile-debit").textContent).toContain("$380.00");
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("$620.00");
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("width 10");
    expect(screen.getByTestId("tile-break-even").textContent).toContain("233.80");
    expect(screen.getByTestId("tile-pct-max").textContent).toContain("+64.85%");
    expect(screen.getByTestId("tile-held").textContent).toContain("7 days");
    expect(screen.getByTestId("tile-held").textContent).toContain("5 sessions");
    expect(screen.getByTestId("tile-dte").textContent).toContain("6 Nov 2026");
    expect(screen.getByTestId("header-pct").textContent).toBe("+105.82%");
    expect(screen.getByTestId("review-panel").textContent).toBe("side");
    expect(screen.queryByRole("group", { name: "Scalp or swing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("gives a single swing the switch, with Swing pressed, and its return on debit", async () => {
    show(single);
    const swing = await screen.findByRole("button", { name: "Swing" });
    expect(swing.getAttribute("aria-pressed")).toBe("true");
    // $100 on a $500 debit.
    expect(screen.getByTestId("tile-return").textContent).toContain("+20.00%");
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("switches with a click and with W", async () => {
    const patches = show(single);
    fireEvent.click(await screen.findByRole("button", { name: "Scalp" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "scalp" }]));
    press("w");
    await waitFor(() => expect(patches).toHaveLength(2));
  });

  it("says why a switch was refused", async () => {
    show(
      single,
      new Response(JSON.stringify({ error: "invalid", message: "Only a single bought call or put can be switched." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Scalp" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only a single bought call or put can be switched.");
  });

  it("notes that IBKR settles a synced swing past its expiry", async () => {
    show({
      ...spread,
      openedAt: nyWallClock("2026-01-05", 615),
      closedAt: null,
      netPnl: null,
      legs: spread.legs.map((each) => ({ ...each, expiry: "2026-01-16", closePrice: null })),
    });
    expect(
      await screen.findByText(
        "IBKR books the expiry overnight: the next sync closes this trade at its expiry values.",
      ),
    ).toBeTruthy();
  });
});

describe("the overnight hint on a scalp (swing spec §5.3)", () => {
  it("asks about a scalp held overnight, and Keep as scalp answers it", async () => {
    const patches = show(scalp);
    expect(await screen.findByText("Held overnight: a swing?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep as scalp" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "scalp" }]));
  });

  it("switches from the hint", async () => {
    const patches = show(scalp);
    fireEvent.click(await screen.findByRole("button", { name: "Switch to swing" }));
    await waitFor(() => expect(patches).toEqual([{ chosenStrategy: "swing" }]));
  });

  it("doesn't ask about a same-day scalp", async () => {
    show({ ...scalp, closedAt: scalp.openedAt + 15 * 60_000 });
    await screen.findByTestId("scalp-workspace");
    expect(screen.queryByText("Held overnight: a swing?")).toBeNull();
  });

  it("doesn't ask again once the user kept it as a scalp", async () => {
    show({ ...scalp, chosenStrategy: "scalp" });
    await screen.findByTestId("scalp-workspace");
    expect(screen.queryByText("Held overnight: a swing?")).toBeNull();
  });
});
```

Append to `apps/web/src/routes/EditTrade.test.tsx`, beside "edits a scalp in the scalp form…" and using its `trade` and `setup()`:

```ts
  it("edits a single swing in the scalp form and keeps it a swing (swing spec §3.7)", async () => {
    const swing = {
      ...trade,
      strategy: "swing",
      chosenStrategy: "swing",
      underlying: "NVDA",
      structureLabel: "Long call",
      ironFly: null,
      legs: [{ ...trade.legs[0], right: "C", strike: 232.5, quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(swing), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1"));
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ strategy: "swing" });
  });
```

In `apps/web/src/review/useTradeKeys.test.tsx`, add (using its `setup`, `scalp` and `press`):

```ts
  it("W switches a single bought option between scalp and swing", async () => {
    const first = setup(scalp({ legs: [{ quantity: 1 }] }));
    press("w");
    await waitFor(() => expect(first.patches).toEqual([{ chosenStrategy: "swing" }]));
  });

  it("registers no W on a trade that can't switch", () => {
    const { patches } = setup(scalp({ legs: [{ quantity: 1 }, { quantity: -1 }] }));
    press("w");
    expect(patches).toEqual([]);
  });
```

(The file's `scalp()` builds a `TradeView` from overrides. If its default has no `legs`, these overrides give the switch rule what it reads.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/routes/TradeDetail.swing.test.tsx apps/web/src/routes/EditTrade.test.tsx apps/web/src/review/useTradeKeys.test.tsx`
Expected: FAIL. A swing renders as a fly (no chart lines, fly tiles), there's no switch or hint, W does nothing, and the form saves `strategy: "scalp"`.

- [ ] **Step 3: The switch and the hint**

Create `apps/web/src/review/StrategySwitch.tsx`:

```tsx
import { type ChosenStrategy, canSwitchStrategy, showsSwingHint } from "@tj/core";
import type { TradeView } from "../api.js";
import { useSaveTrade } from "./data.js";

const BUTTON = "rounded-[2px] border px-1.5 py-0.5 text-[10px]";
const on = (pressed: boolean) =>
  pressed ? "border-accent bg-[#2962ff22] text-fg" : "border-line text-muted hover:text-fg";
const CHOICES: readonly { id: ChosenStrategy; label: string }[] = [
  { id: "scalp", label: "Scalp" },
  { id: "swing", label: "Swing" },
];

/** The Scalp | Swing switch beside a single bought option's chip (swing spec §5.2); nothing on other trades. */
export function StrategySwitch({ trade }: { trade: TradeView }) {
  const save = useSaveTrade(trade.id);
  if (!canSwitchStrategy(trade)) return null;
  return (
    <>
      <fieldset aria-label="Scalp or swing" className="flex gap-1">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={trade.strategy === choice.id}
            onClick={() => {
              if (trade.strategy !== choice.id) save.mutate({ chosenStrategy: choice.id });
            }}
            className={`${BUTTON} ${on(trade.strategy === choice.id)}`}
          >
            {choice.label}
          </button>
        ))}
      </fieldset>
      {save.error && (
        <p role="alert" className="basis-full text-[11px] text-down">
          {save.error.message}
        </p>
      )}
    </>
  );
}

/** "Held overnight: a swing?" at the top of a scalp's page (swing spec §5.3), until the user answers it. */
export function OvernightHint({ trade, now = Date.now() }: { trade: TradeView; now?: number }) {
  const save = useSaveTrade(trade.id);
  if (!showsSwingHint(trade, now)) return null;
  return (
    <div
      data-testid="swing-hint"
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[#ec407a55] bg-[#ec407a14] px-3 py-1.5 text-[12px]"
    >
      <span className="text-fg">Held overnight: a swing?</span>
      <button
        type="button"
        onClick={() => save.mutate({ chosenStrategy: "swing" })}
        className="rounded-sm border border-[#f48fb1] px-2 py-0.5 text-[#f48fb1] hover:bg-[#ec407a22]"
      >
        Switch to swing
      </button>
      <button
        type="button"
        onClick={() => save.mutate({ chosenStrategy: "scalp" })}
        className="rounded-sm border border-line px-2 py-0.5 text-muted hover:text-fg"
      >
        Keep as scalp
      </button>
      {save.error && (
        <span role="alert" className="text-down">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
```

In `apps/web/src/review/useTradeKeys.ts`, import `canSwitchStrategy` from `@tj/core`. Then add, after the X shortcut:

```ts
  const switchable = trade != null && canSwitchStrategy(trade);
  useShortcut(switchable ? "w" : null, "Scalp or swing", "Review", () => {
    if (trade) void patch({ chosenStrategy: trade.strategy === "swing" ? "scalp" : "swing" });
  });
```

Also update the doc comment's key list to read "…P/T, X, W".

- [ ] **Step 4: The tiles**

Create `apps/web/src/routes/SwingTiles.tsx`:

```tsx
import { dayYearText, swingMetrics } from "@tj/core";
import type { TradeView } from "../api.js";
import { ESTIMATE_STYLE } from "../components/Estimate.js";
import { Pct, premiumText, Tile, usd } from "../components/ui.js";

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
const Sub = ({ children }: { children: React.ReactNode }) => (
  <small className="mt-1 block text-[10px] text-muted">{children}</small>
);

/**
 * A swing's tiles (swing spec §5.5): the debit, a spread's max profit, the break-even, % of max (a spread) or the
 * return on debit (a single option), and how long it's been held. While open, the % is the live estimate's.
 */
export function SwingTiles({
  trade,
  today,
  estimatedPnl,
}: {
  trade: TradeView;
  today: string;
  /** The open trade's estimated net P&L from live marks; null without one. */
  estimatedPnl: number | null;
}) {
  const metrics = swingMetrics(trade, today);
  if (!metrics) return null;
  const spread = metrics.maxProfit != null;
  const base = spread ? metrics.maxProfit : metrics.debit;
  const settled = spread ? metrics.pctOfMax : metrics.returnOnDebit;
  const estimated = settled == null && estimatedPnl != null && base ? estimatedPnl / base : null;
  return (
    <div className={`grid grid-cols-2 gap-2 ${spread ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
      <Tile label="Debit" testId="tile-debit">
        {usd(metrics.debit)}
        <Sub>
          {premiumText(metrics.debitPerShare)} × {metrics.contracts}
        </Sub>
      </Tile>
      {spread && (
        <Tile label="Max profit" testId="tile-max-profit">
          {usd(metrics.maxProfit ?? 0)}
          <Sub>width {metrics.width}</Sub>
        </Tile>
      )}
      <Tile label="Break-even" testId="tile-break-even">
        {metrics.breakEven.toFixed(2)}
      </Tile>
      <Tile label={spread ? "% of max" : "Return on debit"} testId={spread ? "tile-pct-max" : "tile-return"}>
        {estimated != null ? (
          <span className={ESTIMATE_STYLE}>
            <Pct value={estimated} />
          </span>
        ) : (
          <Pct value={settled} />
        )}
      </Tile>
      <Tile label="Held" testId="tile-held">
        {count(metrics.daysHeld, "day")}
        <Sub>{count(metrics.sessionsHeld, "session")}</Sub>
      </Tile>
      <Tile label="DTE at open" testId="tile-dte">
        {metrics.dteAtOpen}
        <Sub>{dayYearText(metrics.expiry)}</Sub>
      </Tile>
    </div>
  );
}
```

If the file has no `React` namespace in scope for `React.ReactNode`, import `type ReactNode` from `react` and use it.

- [ ] **Step 5: Lay out the page**

In `apps/web/src/routes/TradeDetail.tsx`:

1. Imports: add `premiumPaid` and `swingMetrics` to the `@tj/core` import, and add these lines:

   ```ts
   import { SwingChart } from "../chart/SwingChart.js";
   import { swingLines } from "../chart/swing.js";
   import { OvernightHint, StrategySwitch } from "../review/StrategySwitch.js";
   import { SwingTiles } from "./SwingTiles.js";
   ```
2. Right after the existing `const estimate = isOpen(trade) ? closeEstimate(…) : null;` line:

   ```ts
     const swing = trade.strategy === "swing";
     const estimatedPnl = estimate?.kind === "estimate" ? estimate.netPnl : null;
     // A swing's return on debit, or while it's open the live estimate's (swing spec §5.1).
     const debit = swing ? premiumPaid(trade) : null;
     const swingPct = swing
       ? (returnOnCost(trade) ?? (estimatedPnl != null && debit ? estimatedPnl / debit : null))
       : null;
   ```

   Also, with the other hooks and before the first early return (right after `const keys = useTradeKeys(…)`), memoise the chart's lines. A new array each render would make `DailyChart`'s `[lines]` effect redraw every time:

   ```ts
     const lines = useMemo(
       () => (trade?.strategy === "swing" ? swingLines(swingMetrics(trade, today), trade.legs) : []),
       [trade, today],
     );
   ```

   Add `useMemo` to the file's imports (`import { useMemo } from "react";`).
3. In the header, put `<StrategySwitch trade={trade} />` right after the strategy `<Chip>`. Replace the `header-pct` span's value, and wrap an estimated swing % in the estimate style:

   ```tsx
           <span data-testid="header-pct" className={`text-[18px] ${swing && trade.closedAt == null ? ESTIMATE_STYLE : ""}`}>
             <Pct
               value={
                 trade.strategy === "iron_fly"
                   ? (metrics?.pnlPctOfCost ?? pctKept(trade))
                   : swing
                     ? swingPct
                     : returnOnCost(trade)
               }
             />
           </span>
   ```

   Then show Edit except on a vertical:

   ```tsx
           {!(swing && trade.legs.length > 1) && (
             <button type="button" onClick={() => onEdit?.(trade.id)} className="…unchanged…">
               Edit
             </button>
           )}
   ```
4. After `<SyncedBanner trade={trade} />`:

   ```tsx
         {trade.strategy === "scalp" && <OvernightHint trade={trade} />}
   ```
5. The chart line becomes three-way:

   ```tsx
         {trade.strategy === "scalp" ? (
           <ScalpWorkspace trade={trade} onOpenTrade={onOpenTrade} onNewMissed={onNewMissed} />
         ) : swing ? (
           <SwingChart trade={trade} lines={lines} />
         ) : (
           <TradeCharts trade={trade} />
         )}
   ```
6. The tiles become three-way: the fly grid stays first; then `swing ? <SwingTiles trade={trade} today={today} estimatedPnl={estimatedPnl} /> : (<><ScalpTiles … /><RiskTiles … /></>)`.
7. Beside the fly's expiry block, add the swing's note:

   ```tsx
         {swing && estimate?.kind === "expired" && trade.source === "ibkr_flex" && trade.factsEditedAt == null && (
           <p className="text-[11px] text-muted">
             IBKR books the expiry overnight: the next sync closes this trade at its expiry values.
           </p>
         )}
   ```
8. The Legs grid and the review panel: change both `trade.strategy === "iron_fly"` tests (the grid's `lg:grid-cols-[1.35fr_1fr]` class and the `<ReviewPanel … layout="side" />` condition) to `trade.strategy !== "scalp"`.

In `apps/web/src/routes/EditTrade.tsx`, a single-leg swing uses the scalp form and keeps its strategy:

```tsx
  if (trade.strategy === "scalp" || (trade.strategy === "swing" && trade.legs.length === 1)) {
    return (
      <ScalpForm
        initial={toScalpFormValues(trade)}
        submitLabel="Save changes"
        busy={save.isPending}
        error={save.error ? String(save.error) : null}
        notice={notice}
        // The form writes a scalp; a swing stays a swing, and an unchanged strategy is no edited fact.
        onSubmit={(payload) => save.mutate({ ...payload, strategy: trade.strategy })}
      />
    );
  }
```

- [ ] **Step 6: Run them to see them pass, then the web suite**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS. The existing `TradeDetail.test.tsx` cases still pass. A fly keeps its layout, because every new branch is keyed on `swing` or on `!== "scalp"` (flies included, as before).

- [ ] **Step 7: Full suite, then commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): the swing trade page, the Scalp | Swing switch, W and the overnight hint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Analytics: the Swings tab and the swing setup card

**Files:**
- Create: `apps/web/src/routes/SwingsTab.tsx`, `apps/web/src/routes/SwingsTab.test.tsx`
- Modify: `apps/web/src/analytics/Breakdown.tsx`, `apps/web/src/routes/ScalpsTab.tsx`, `apps/web/src/analytics/search.ts`, `apps/web/src/analytics/search.test.ts`, `apps/web/src/routes/Analytics.tsx`, `apps/web/src/palette/pages.ts`, `apps/web/src/analytics/SetupCards.tsx`, `apps/web/src/analytics/SetupCards.test.tsx`, `apps/web/src/routes/Playbook.tsx`

**Interfaces:**
- Consumes: `swingSummary`, `swingBreakdown`, `SWING_BREAKDOWNS`, `SwingBreakdown`, `SetupCard.kind === "swing"`, `SetupCard.avgDaysHeld` (Task 2).
- Produces:
  - `AnalyticsSearch.tab` gains `"swings"`; `AnalyticsSearch.sby?: Exclude<SwingBreakdown, "structure">`;
  - `BreakdownPanel<D>` takes `dimensions` and `withR`;
  - `SWING_DIMENSIONS`;
  - `onOpenSetup`'s tab gains `"swings"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/SwingsTab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { SwingsTab } from "./SwingsTab.js";

const leg = (strike: number, quantity: number, openPrice: number, closePrice: number) => ({
  id: `${strike}`,
  right: "C",
  strike,
  expiry: "2026-11-06",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice,
});
const trade = (id: string, open: string, close: string, netPnl: number, legs: unknown[]) =>
  ({
    id,
    strategy: "swing",
    book: "paper",
    underlying: "NVDA",
    openedAt: nyWallClock(open, 615),
    closedAt: nyWallClock(close, 660),
    netPnl,
    fees: 2,
    setupId: null,
    grade: null,
    tagIds: [],
    ironFly: null,
    risk: null,
    excluded: false,
    legs,
  }) as unknown as TradeView;
const TRADES = [
  trade("w1", "2026-10-02", "2026-10-09", 402.1, [leg(230, 1, 5.1, 9), leg(240, -1, 1.3, 1.15)]),
  trade("w2", "2026-10-05", "2026-10-06", 200, [leg(230, 2, 4, 5)]),
  // A scalp in the same list is left out.
  { ...trade("s1", "2026-10-05", "2026-10-05", 50, [leg(230, 1, 1, 1.5)]), strategy: "scalp" } as TradeView,
];

function show(onSearch = vi.fn(), search = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SwingsTab trades={TRADES} search={{ tab: "swings", ...search }} onSearch={onSearch} />
    </QueryClientProvider>,
  );
  return onSearch;
}

afterEach(() => vi.unstubAllGlobals());

describe("SwingsTab (swing spec §6.3)", () => {
  it("sums up the closed swings only", () => {
    show();
    expect(screen.getByTestId("kpi-swings").textContent).toContain("2");
    expect(screen.getByTestId("kpi-avg-held").textContent).toContain("4.0 days");
    expect(screen.getByTestId("kpi-avg-of-max").textContent).toContain("65%");
    expect(screen.getByTestId("kpi-avg-of-max").textContent).toContain("1 of 2 are spreads");
  });

  it("breaks down by structure first, without an R column, and asks for another dimension", () => {
    const onSearch = show();
    const table = screen.getByRole("table", { name: "By Structure" });
    expect(within(table).getByText("Long call")).toBeTruthy();
    expect(within(table).getByText("Call debit spread")).toBeTruthy();
    expect(within(table).queryByText("Avg R")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Days held" }));
    expect(onSearch).toHaveBeenCalledWith({ sby: "held" });
  });

  it("opens on the dimension in the URL", () => {
    show(vi.fn(), { sby: "dte" });
    expect(screen.getByRole("table", { name: "By DTE at open" })).toBeTruthy();
  });
});
```

In `apps/web/src/analytics/search.test.ts`, add:

```ts
  it("keeps the Swings tab and its breakdown, and drops a breakdown that isn't a swing's", () => {
    expect(parseAnalyticsSearch({ tab: "swings", sby: "held" })).toEqual({ tab: "swings", sby: "held" });
    expect(parseAnalyticsSearch({ tab: "swings", sby: "structure" })).toEqual({ tab: "swings" });
    expect(parseAnalyticsSearch({ tab: "swings", sby: "cost" })).toEqual({ tab: "swings" });
  });
```

In `apps/web/src/analytics/SetupCards.test.tsx` (it has `tradeRow`, `renderCards` and `card`), add:

```tsx
describe("a swing setup's card (swing spec §6.4)", () => {
  it("leads with the average return on the debit, shows the average days held, and opens the Swings tab", () => {
    const leg = (strike: number, quantity: number, openPrice: number, closePrice: number) => ({
      id: `w-${strike}-${quantity}`,
      right: "C",
      strike,
      expiry: "2026-11-06",
      quantity,
      multiplier: 100,
      openPrice,
      closePrice,
    });
    const swingRow = (id: string, opened: string, closed: string, netPnl: number, legs: unknown[]) => ({
      ...tradeRow({ id, strategy: "scalp", underlying: "NVDA", opened, closed, netPnl, setupId: "weekly" }),
      strategy: "swing",
      ironFly: null,
      legs,
    });
    const onOpenSetup = renderCards({
      trades: [
        swingRow("w1", "2026-10-02 10:15", "2026-10-09 11:00", 402.1, [leg(230, 1, 5.1, 9), leg(240, -1, 1.3, 1.15)]),
        swingRow("w2", "2026-10-05 10:15", "2026-10-06 11:00", 200, [leg(230, 2, 4, 5)]),
      ] as unknown as TradeView[],
      setups: [
        { id: "weekly", name: "Weekly breakout", strategy: "swing", description: null, archived: false, tradeCount: 2 },
      ] as Setup[],
      today: "2026-10-13",
    });
    const weekly = card("Weekly breakout");
    expect(weekly.getByText("Avg return")).toBeTruthy();
    // 402.10 on $380 and 200 on $800: (1.0582 + 0.25) ÷ 2.
    expect(weekly.getByTestId("card-hero").textContent).toBe("+65.4%");
    expect(weekly.getByText("Avg held").nextSibling?.textContent).toBe("4.0 days");
    fireEvent.click(weekly.getByRole("button", { name: "2 trades →" }));
    expect(onOpenSetup).toHaveBeenCalledWith("weekly", "swings");
  });
});
```

In `apps/web/src/palette/pages.test.ts`, `PAGES` grows to 15 (Task 5 made it 14). Add `expect(labels("an sw")).toEqual(["Analytics › Swings"]);`, and change Task 5's `labels("sw")` expectation to `["Swings", "Analytics › Swings"]`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/web/src/routes/SwingsTab.test.tsx apps/web/src/analytics`
Expected: FAIL. There's no `SwingsTab.js`, the parser drops `swings`, and the card shows Avg R.

- [ ] **Step 3: A breakdown panel for any dimensions**

In `apps/web/src/analytics/Breakdown.tsx`, make the panel generic over its dimensions and let it leave out Avg R:

```tsx
const HEADERS = ["n", "Win %", "Net", "Avg R", "Avg return", "PF"];

/** One dimension at a time: the picker, a table, and its bars (scalp-analytics spec §6.4, swing spec §6.3). */
export function BreakdownPanel<D extends string>({
  by,
  onBy,
  rows,
  metric,
  edges,
  note,
  dimensions,
  withR = true,
}: {
  by: D;
  onBy: (by: D) => void;
  /** A row only missed trades have carries blank dollars (missed-trades spec §6.8). */
  rows: readonly (BreakdownRow | MissedOnlyRow)[];
  metric: Metric;
  /** The edit link for a bucketed dimension's edges. */
  edges?: EdgeControl;
  /** A line under the picker, such as why missed trades aren't in a contract's breakdown. */
  note?: string;
  /** The dimensions to pick from: the Scalps tab's `DIMENSIONS`, or the Swings tab's. */
  dimensions: readonly { id: D; label: string }[];
  /** False leaves out Avg R, for swings, which have none. */
  withR?: boolean;
}) {
  const label = dimensions.find((dimension) => dimension.id === by)?.label ?? by;
  const headers = withR ? HEADERS : HEADERS.filter((header) => header !== "Avg R");
```

In the body:
- iterate `dimensions` instead of `DIMENSIONS`;
- render `headers` instead of `HEADERS`;
- wrap the Avg R `<td>` in `{withR && ( … )}`.

`DIMENSIONS` stays exported. Its type becomes `readonly { id: Breakdown; label: string }[]`, as now.

In `apps/web/src/routes/ScalpsTab.tsx`, pass `dimensions={DIMENSIONS}` to its `<BreakdownPanel …>` and import `DIMENSIONS` beside `BreakdownPanel`.

- [ ] **Step 4: The Swings tab**

Create `apps/web/src/routes/SwingsTab.tsx`:

```tsx
import { type BreakdownContext, closedTrades, type SwingBreakdown, swingBreakdown, swingSummary } from "@tj/core";
import { useMemo } from "react";
import { BreakdownPanel } from "../analytics/Breakdown.js";
import { profitFactorText, shareText, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { returnText } from "../analytics/scalpText.js";
import { Money } from "../components/ui.js";
import { type Setup, useSetups, useTags } from "../review/data.js";
import type { TabProps } from "./OverviewTab.js";

export const SWING_DIMENSIONS: readonly { id: SwingBreakdown; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "held", label: "Days held" },
  { id: "dte", label: "DTE at open" },
  { id: "setup", label: "Setup" },
  { id: "ticker", label: "Ticker" },
  { id: "weekday", label: "Weekday" },
  { id: "grade", label: "Grade" },
  { id: "emotion", label: "Emotion" },
  { id: "book", label: "Book" },
  { id: "month", label: "Month" },
];

const NO_SETUPS: readonly Setup[] = [];
const daysText = (days: number | null) => (days == null ? "—" : `${days.toFixed(1)} days`);

/** Which swings work (swing spec §6.3): the KPI strip, then one breakdown at a time. */
export function SwingsTab({ trades, search, onSearch }: TabProps) {
  const swings = useMemo(() => closedTrades(trades.filter((trade) => trade.strategy === "swing")), [trades]);
  const { data: setups = NO_SETUPS } = useSetups();
  const { data: tags } = useTags();
  const context = useMemo<BreakdownContext>(
    () => ({
      setups: new Map(setups.map((setup) => [setup.id, setup.name])),
      emotions: new Map((tags ?? []).filter((tag) => tag.kind === "emotion").map((tag) => [tag.id, tag.name])),
      costEdges: [],
      contractEdges: [],
    }),
    [setups, tags],
  );
  const by: SwingBreakdown = search.sby ?? "structure";
  const summary = useMemo(() => swingSummary(swings), [swings]);
  const rows = useMemo(() => swingBreakdown(swings, by, context), [swings, by, context]);
  const none = summary.trades === 0;
  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "swings", label: "Swings", value: summary.trades },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          { id: "avg-return", label: "Avg return", value: returnText(summary.avgReturn), sub: "on the debit" },
          { id: "avg-held", label: "Avg held", value: daysText(summary.avgDaysHeld) },
          {
            id: "avg-of-max",
            label: "Avg % of max",
            value: shareText(summary.avgPctOfMax),
            sub: none ? undefined : `${summary.spreads} of ${summary.trades} are spreads`,
          },
        ]}
      />
      {none ? (
        <p className="text-muted">No closed swings in this range.</p>
      ) : (
        <BreakdownPanel
          by={by}
          onBy={(next) => onSearch({ sby: next === "structure" ? undefined : next })}
          rows={rows}
          metric="net"
          dimensions={SWING_DIMENSIONS}
          withR={false}
        />
      )}
    </div>
  );
}
```

In `apps/web/src/analytics/search.ts`:
- Import `SWING_BREAKDOWNS` and `type SwingBreakdown` from `@tj/core`.
- `tab?: "scalps" | "swings" | "flies" | "missed";`
- Add the field `/** The Swings tab's breakdown (swing spec §6.3); absent means by structure. */ sby?: Exclude<SwingBreakdown, "structure">;`
- In `parseAnalyticsSearch`: accept `raw.tab === "swings"` alongside the others, and

  ```ts
    const sby = SWING_BREAKDOWNS.find((each) => each === raw.sby);
    if (sby && sby !== "structure") search.sby = sby;
  ```

In `apps/web/src/routes/Analytics.tsx`:
- add a `TabButton` "Swings" (`search.tab === "swings"`, `onSearch({ tab: "swings" })`) between Scalps and Iron flies;
- add `{search.tab === "swings" && <SwingsTab trades={trades} search={search} onSearch={onSearch} onOpenTrade={onOpenTrade} />}` and import it.

In `apps/web/src/palette/pages.ts`, after "Analytics › Scalps", add `{ label: "Analytics › Swings", href: "/analytics?tab=swings" },`.

- [ ] **Step 5: The swing setup card**

In `apps/web/src/analytics/SetupCards.tsx`, import `returnText` from `./scalpText.js` if it isn't already. Then in `Card`:

```tsx
  const fly = card.kind === "fly";
  const swing = card.kind === "swing";
  const hero = fly ? card.kept : swing ? card.avgReturn : card.avgR;
```

- **The hero's label:** `{fly ? "Kept" : swing ? "Avg return" : "Avg R"}`
- **Its value:** `{fly ? shareText(card.kept) : swing ? returnText(card.avgReturn) : card.avgR == null ? "—" : rText(card.avgR)}`
- **The line under it:** `{fly ? "of max profit" : swing ? "on the debit" : \`over ${card.rCount} of ${card.trades}\`}`
- **The sparkline:** `format={fly || swing ? dollars : rText}` and `label={fly || swing ? "Cumulative net P&L" : "Cumulative R"}`
- **The fourth stat:** `fly ? <Stat label="PF">…</Stat> : swing ? <Stat label="Avg held">{card.avgDaysHeld == null ? "—" : \`${card.avgDaysHeld.toFixed(1)} days\`}</Stat> : <Stat label="Avg return">…</Stat>`
- **The open link:** `onOpen?.(card.setupId, fly ? "flies" : swing ? "swings" : "scalps")`

Widen every `tab: "scalps" | "flies" | "missed"` in `SetupCards.tsx` (two places) and `Playbook.tsx` (one) to `tab: "scalps" | "swings" | "flies" | "missed"`.

- [ ] **Step 6: Run them to see them pass**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS. `kpi-avg-of-max` reads "65%", since `shareText` rounds 0.6485 to 65%.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add apps/web/src
git commit -m "feat(analytics): the Swings tab and the swing setup card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Demo swings, docs, and the live check

**Files:**
- Create: `packages/demo/src/swings.ts`, `packages/demo/src/swings.test.ts`
- Modify: `packages/demo/src/prices.ts`, `packages/demo/src/index.ts`, `packages/demo/src/write.ts`, `packages/demo/src/generate.test.ts`, `apps/server/src/demo.ts`
- Modify (docs):
  - `README.md`, `docs/images/swing.png` (new);
  - `docs/superpowers/specs/2026-09-22-trading-journal-design.md`, `2026-09-29-ibkr-flex-sync-design.md`, `2026-10-12-launcher-keyboard-palette-design.md`, `2026-10-14-swing-trades-design.md`

**Interfaces:**
- Consumes: `bsPrice`, `SWING_LABELS`, `swingShape`, `weekdayOfDate`, `isTradingDay`, `addDays`, `nyWallClock`, `newTradeSchema` (core); `FEE_PER_CONTRACT_SIDE` (demo scalps); `Rng`, `stream`, `int`, `pick`, `chance`, `uniform` (demo random).
- Produces: `planSwings(rng, sessions, walks, symbols): SwingPlan[]`, `walkBack(...)`; `DemoSummary.swings`.

- [ ] **Step 1: Write the failing demo tests**

Create `packages/demo/src/swings.test.ts`:

```ts
import { newTradeSchema, swingShape } from "@tj/core";
import { describe, expect, it } from "vitest";
import { dailyWalk, tradingDays } from "./prices.js";
import { stream } from "./random.js";
import { planSwings } from "./swings.js";

const sessions = tradingDays("2026-04-01", "2026-09-30");
const walks = new Map(
  ["NVDA", "TSLA"].map((symbol) => [symbol, dailyWalk(stream(1, symbol), symbol, sessions, new Map())] as const),
);

describe("planSwings (swing spec §8)", () => {
  const plans = planSwings(stream(1, "swings"), sessions, walks, ["NVDA", "TSLA"]);

  it("makes eight closed swings, each a swing shape the model accepts", () => {
    expect(plans).toHaveLength(8);
    for (const plan of plans) {
      expect(swingShape(plan.legs)).not.toBeNull();
      expect(plan.closedAt).toBeGreaterThan(plan.openedAt);
      expect(
        newTradeSchema.safeParse({
          strategy: "swing",
          book: plan.book,
          underlying: plan.symbol,
          openedAt: plan.openedAt,
          closedAt: plan.closedAt,
          netPnl: plan.netPnl,
          fees: plan.fees,
          legs: plan.legs,
        }).success,
      ).toBe(true);
    }
  });

  it("makes every shape twice, each P&L its legs' less its fees", () => {
    const shapes = plans.map((plan) => swingShape(plan.legs));
    for (const shape of ["long_call", "long_put", "call_debit_spread", "put_debit_spread"]) {
      expect(shapes.filter((each) => each === shape)).toHaveLength(2);
    }
    for (const plan of plans) {
      const gross = plan.legs.reduce((sum, leg) => sum + leg.quantity * 100 * (leg.closePrice - leg.openPrice), 0);
      expect(plan.netPnl).toBeCloseTo(gross - plan.fees, 2);
    }
  });

  it("makes the same swings from the same seed", () => {
    expect(planSwings(stream(1, "swings"), sessions, walks, ["NVDA", "TSLA"])).toEqual(plans);
  });
});
```

In `packages/demo/src/generate.test.ts`:

1. In "makes a month of closed scalps and flies…", count the swings too:

   ```ts
       expect(summary.swings).toBe(8);
       const trades = createTradesRepo(db).list({ taken: true });
       expect(trades).toHaveLength(summary.scalps + summary.flies + summary.swings);
   ```

2. Replace the body of "knows every day each trade's charts ask for, so they draw without a key". A swing's chart reads daily bars only, five years of them:

   ```ts
       const bars = createBarsRepo(db);
       for (const trade of createTradesRepo(db).list({ taken: true })) {
         const lastDay = nyDate(trade.closedAt ?? trade.openedAt);
         if (trade.strategy !== "swing") {
           const minuteDays = datesFrom(addDays(nyDate(trade.openedAt), -7), lastDay);
           expect(bars.knownDays(trade.underlying, "1m", minuteDays).size).toBe(minuteDays.length);
         }
         const reach = trade.strategy === "swing" ? 1_826 : 1_095;
         const dailyDays = datesFrom(addDays(lastDay, -reach), lastDay);
         expect(bars.knownDays(trade.underlying, "1d", dailyDays).size).toBe(dailyDays.length);
       }
   ```

The other cases (P&L from legs, inside sessions, same seed) cover swings as they stand.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/demo`
Expected: FAIL. There's no `swings.js`, and there are no swings or five-year daily bars in the generated journal.

- [ ] **Step 3: Plan the swings**

Create `packages/demo/src/swings.ts`:

```ts
import {
  addDays,
  bsPrice,
  type Grade,
  isTradingDay,
  nyWallClock,
  type OptionRight,
  regularClose,
  SWING_SHAPES,
  weekdayOfDate,
} from "@tj/core";
import { cents } from "./prices.js";
import { chance, int, pick, type Rng, uniform } from "./random.js";
import { FEE_PER_CONTRACT_SIDE } from "./scalps.js";
import { strikeStep, symbolInfo } from "./symbols.js";

export interface SwingLegPlan {
  right: OptionRight;
  strike: number;
  expiry: string;
  quantity: number;
  openPrice: number;
  closePrice: number;
}

/** A swing as the demo plans it (swing spec §8): a bought option or a debit vertical, held for days. */
export interface SwingPlan {
  symbol: string;
  book: "live" | "paper";
  legs: SwingLegPlan[];
  openedAt: number;
  closedAt: number;
  fees: number;
  netPnl: number;
  grade: Grade | null;
  notes: string | null;
}

const COUNT = 8;
const NOTES = {
  won: ["Held through the pullback; the trend did the work.", "Took it at the target the week before expiry."],
  lost: ["Thesis broke on the gap down; cut it.", "Theta ate it while the stock went nowhere."],
};

/** The Friday expiry about `days` after `date`, a Thursday when that Friday is a holiday. */
function expiryAfter(date: string, days: number): string {
  let expiry = addDays(date, days);
  while (weekdayOfDate(expiry) !== "Fri") expiry = addDays(expiry, 1);
  while (!isTradingDay(expiry)) expiry = addDays(expiry, -1);
  return expiry;
}

const yearsBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365 * 86_400_000);

/**
 * Eight swings spread over the sessions, each shape twice, priced by Black-Scholes at the symbol's own volatility from
 * the walk's open (entry, 10:15) and close (exit, 15:30, or half an hour before a half day's close). Every one is
 * closed: an open one would ask the chart for bars up to the real today, which the demo doesn't have.
 */
export function planSwings(
  rng: Rng,
  sessions: readonly string[],
  walks: ReadonlyMap<string, ReadonlyMap<string, { open: number; close: number }>>,
  symbols: readonly string[],
): SwingPlan[] {
  const plans: SwingPlan[] = [];
  const stride = Math.max(1, Math.floor(sessions.length / COUNT));
  // A draw can fail (a short leg priced at or above its long one); the next attempt redraws the same slot.
  for (let attempt = 0; plans.length < COUNT && attempt < COUNT * 5; attempt++) {
    const slot = plans.length;
    const shape = SWING_SHAPES[slot % SWING_SHAPES.length] ?? "long_call";
    const entryAt = Math.min(sessions.length - 2, slot * stride + int(rng, 0, Math.max(0, stride - 1)));
    const exitAt = Math.min(sessions.length - 1, entryAt + int(rng, 1, 15));
    const entry = sessions[entryAt];
    const exit = sessions[exitAt];
    const symbol = pick(rng, symbols);
    const walk = walks.get(symbol);
    const atEntry = entry ? walk?.get(entry) : undefined;
    const atExit = exit ? walk?.get(exit) : undefined;
    if (!entry || !exit || !atEntry || !atExit) continue;
    const { vol } = symbolInfo(symbol);
    const right: OptionRight = shape === "long_call" || shape === "call_debit_spread" ? "C" : "P";
    const spread = shape === "call_debit_spread" || shape === "put_debit_spread";
    const step = strikeStep(atEntry.open);
    const atm = Math.round(atEntry.open / step) * step;
    const long = right === "C" ? atm - step * int(rng, 0, 1) : atm + step * int(rng, 0, 1);
    const short = right === "C" ? long + step * int(rng, 2, 4) : long - step * int(rng, 2, 4);
    const expiry = expiryAfter(entry, int(rng, 28, 42));
    const contracts = int(rng, 1, 3);
    const price = (strike: number, spot: number, date: string) =>
      Math.max(0.05, cents(bsPrice(right, spot, strike, yearsBetween(date, expiry), vol * uniform(rng, 0.9, 1.1))));
    const legs: SwingLegPlan[] = [
      {
        right,
        strike: long,
        expiry,
        quantity: contracts,
        openPrice: price(long, atEntry.open, entry),
        closePrice: price(long, atExit.close, exit),
      },
      ...(spread
        ? [
            {
              right,
              strike: short,
              expiry,
              quantity: -contracts,
              openPrice: price(short, atEntry.open, entry),
              closePrice: price(short, atExit.close, exit),
            },
          ]
        : []),
    ];
    // A spread's short leg must cost less than its long leg, or it's no debit.
    if (spread && (legs[1]?.openPrice ?? 0) >= (legs[0]?.openPrice ?? 0)) continue;
    const fees = cents(FEE_PER_CONTRACT_SIDE * contracts * legs.length * 2);
    const gross = legs.reduce((sum, leg) => sum + leg.quantity * 100 * (leg.closePrice - leg.openPrice), 0);
    const netPnl = cents(gross - fees);
    plans.push({
      symbol,
      book: chance(rng, 0.5) ? "live" : "paper",
      legs,
      openedAt: nyWallClock(entry, 10 * 60 + 15),
      closedAt: nyWallClock(exit, Math.min(15 * 60 + 30, regularClose(exit) - 30)),
      fees,
      netPnl,
      grade: pick(rng, ["A", "B", "C", null] as const),
      notes: chance(rng, 0.6) ? pick(rng, netPnl > 0 ? NOTES.won : NOTES.lost) : null,
    });
  }
  return plans;
}
```

The shapes cycle by slot, so all four appear twice and the tests don't hinge on a random draw. `chance` still picks the book and whether there's a note.

- [ ] **Step 4: Five years of daily bars without moving a price, and writing the swings**

In `packages/demo/src/prices.ts`, add:

```ts
/**
 * Sessions before a walk's first, walked backwards from its first open (swing spec §8): the weekly chart's five years,
 * without changing any price the forward walk already made.
 */
export function walkBack(
  rng: Rng,
  symbol: string,
  sessions: readonly string[],
  firstOpen: number,
): Map<string, { open: number; close: number }> {
  const { vol } = symbolInfo(symbol);
  const dt = 1 / TRADING_DAYS_A_YEAR;
  const walk = new Map<string, { open: number; close: number }>();
  let next = firstOpen;
  for (const date of [...sessions].reverse()) {
    const close = cents(Math.max(0.5, next / (1 + uniform(rng, -0.004, 0.004))));
    const open = cents(
      Math.max(0.5, close / Math.exp((DRIFT - (vol * vol) / 2) * dt + vol * Math.sqrt(dt) * normal(rng))),
    );
    walk.set(date, { open, close });
    next = open;
  }
  return walk;
}
```

In `packages/demo/src/index.ts`:
- `/** How far back a swing's weekly chart reaches (the server's WEEKLY_DAYS). */ const WEEKLY_REACH = 1_826;`
- After `walks` is built:

```ts
  // The weekly chart's older years (swing spec §8), walked back from each walk's first open.
  const backFrom = addDays(first, -WEEKLY_REACH);
  const backSessions = tradingDays(backFrom, addDays(walkFrom, -1));
  const backs = new Map(
    Object.keys(SYMBOLS).map((symbol) => {
      const firstOpen = walks.get(symbol)?.get(walkSessions[0] ?? "")?.open ?? symbolInfo(symbol).start;
      return [symbol, walkBack(stream(seed, `${symbol}:back`), symbol, backSessions, firstOpen)] as const;
    }),
  );
  const swings = planSwings(stream(seed, "swings"), sessions, walks, SCALP_SYMBOLS);
```

- In the daily-bars loop, start at `backFrom` and read `walk?.get(date) ?? backs.get(symbol)?.get(date)` as `day`. The synthetic-bar branch already handles a day with no minutes.
- Pass `swings` to `writeDemo` and return `swings: swings.length` in the summary (add `swings: number` to `DemoSummary`).

In `packages/demo/src/write.ts`:
- `input` gains `swings: readonly SwingPlan[]`.
- Inside the transaction, after the existing `for (const { kind, plan } of plans)` loop, write each swing:

```ts
    for (const plan of input.swings) {
      clock = plan.closedAt + input.jitter(`${plan.symbol}:${plan.openedAt}:written`) * MINUTE_MS;
      const shape = swingShape(plan.legs);
      const feesOpen = cents(plan.fees / 2);
      trades.create(
        newTradeSchema.parse({
          strategy: "swing",
          book: plan.book,
          underlying: plan.symbol,
          underlyingName: symbolInfo(plan.symbol).name,
          structureLabel: shape ? SWING_LABELS[shape] : null,
          openedAt: plan.openedAt,
          closedAt: plan.closedAt,
          netPnl: plan.netPnl,
          fees: plan.fees,
          feesOpen,
          feesClose: cents(plan.fees - feesOpen),
          notes: plan.notes,
          grade: plan.grade,
          source: "manual",
          legs: plan.legs,
        }),
      );
    }
```

(Add `SWING_LABELS` and `swingShape` to the `@tj/core` import, and `type SwingPlan` from `./swings.js`.)

In `apps/server/src/demo.ts`, the printed line reads "…${summary.scalps} scalps, ${summary.swings} swings, ${summary.flies} iron flies and…".

- [ ] **Step 5: Run the demo tests and the full suite**

Run: `pnpm vitest run packages/demo && pnpm typecheck && pnpm test`
Expected: PASS. The existing "makes the same trades again from the same seed" still passes, because the swings and the back-walk draw from their own streams.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add packages/demo apps/server/src/demo.ts
git commit -m "feat(demo): eight swings and five years of daily bars for the weekly chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: The live check (spec §10). It must pass before the docs are written.**

Follow the visual-check recipe: headless Firefox via puppeteer-core in the scratchpad, `await document.fonts.ready` before every screenshot, and a stand-in server named `serve.mts`. Use a read-only copy of the real journal made with better-sqlite3 `.backup()`, the real Alpaca key from `secrets.json` (never printed, never saved through the stand-in), and port 4199. Stop the server by its PID from `ss -ltnp`.

1. **Two swings on real bars:** `POST /api/trades` (header `host: localhost`) adds to the copy:
   - an NVDA call debit spread, opened 2 Oct 2026 10:15 at 230/240 (5.10 / 1.30) and closed 9 Oct 2026 at 9.00 / 1.15, expiring 6 Nov 2026;
   - an SPY long put, opened and closed on two real past dates of your choice with plausible prices.
2. **Screenshots** of each at 1280 and 1024 px, in Daily and in Weekly (click Weekly). That's eight images; stack them with ImageMagick and look.
3. **The labels sit on their lines.** The chart's coordinates aren't reachable from the page, so check the pixels. Crop the price axis (the rightmost ~70 px) around each label at 3× zoom, and check that each label ("230", "240", "BE 233.80") is centred on its dashed line's y, within 2 px. Record the crops in the spec.
4. **The candles have wicks:** zoom one crop to 4× on a day whose high and low differ from its open and close.
5. **The markers** sit on 2 Oct and 9 Oct in Daily, and on the weeks of 28 Sep and 5 Oct in Weekly (hover each candle; the legend shows its date).
6. **The sync:** run `/api/ibkr/sync` on a second copy with the real paper token. Expect no scalp to change strategy. Switch one synced single option to Swing, sync again, and expect "unchanged" and still a swing.
7. **Keys on a swing page:** W switches a single swing back to Scalp and again to Swing; J/K follow the Swings list; 1–5 set the grade; ? lists W.
8. **The demo:** `TJ_DEMO_DIR=<scratchpad>/demo TJ_PORT=4179 pnpm demo`, then screenshot the Swings page, a spread's page (Daily) and the Analytics Swings tab at 1280 px. Save the spread page as `docs/images/swing.png`.

If anything is off (a label away from its line, a missing wick, a marker on the wrong day), stop and fix it test-first in the task that owns it, then repeat this step.

- [ ] **Step 8: Docs**

- **`README.md`:** a "Swings" bullet in the features list (debit verticals from IBKR, a Scalp | Swing switch and the overnight hint, the daily/weekly chart with strike and break-even lines, the Swings tab), and the `docs/images/swing.png` screenshot beside the scalp one.
- **Parent spec** (`2026-09-22-trading-journal-design.md`):
  - glossary line 42: "`scalp`, `iron_fly` or `swing`";
  - the data model's `strategy` (`scalp` | `iron_fly` | `swing`) and `chosen_strategy`;
  - the chips line: SWING pink;
  - the nav line: Swings after Scalps.
- **IBKR spec** (`2026-09-29-ibkr-flex-sync-design.md`):
  - §1 out of scope: debit verticals are now swings (swing spec);
  - §5.5: on a single bought option the sync writes `chosen_strategy ?? scalp`;
  - §7: the debit-vertical step and the duplicate guard matching typed swings.
- **Launcher spec** (`2026-10-12-launcher-keyboard-palette-design.md`) §6.1: a W row ("Scalp or swing", on a single bought option).
- **Swing spec** (`2026-10-14-swing-trades-design.md`): add "§14. Plan deviations" with:
  1. there is no strategy filter UI; "the strategy filter gains Swing" (§6.2) is the list API's `strategy` and the palette's strategy words;
  2. the Swings tab's breakdown lives in `sby` (like Missed's `mby`), so the Scalps tab's `by` is untouched; an unknown `sby` is dropped rather than "falling back";
  3. every demo swing is closed: an open one would ask the chart for bars up to the real today, which the demo can't have without a key;
  4. the demo writes five years of daily bars for every symbol, the older two walked backwards from the existing walk so no existing price moves, rather than for swings alone;
  5. strike lines are titled `String(strike)` ("230", "232.5"), and the break-even `BE` + `priceText`;
  6. the swing chart's load failure reads "Couldn't load the chart: Alpaca didn't answer." with Retry;
  7. the live check's label alignment is checked on axis crops, because the chart's coordinates aren't reachable from the page.

  Add "§15. Live check (date)" with what Step 7 found, and set the Status line to "Implemented on feat/swing-trades".

- [ ] **Step 9: Commit**

```bash
pnpm format && pnpm lint
git add README.md docs
git commit -m "docs: swings in the README, the specs, and the live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks

1. **Final review:** a whole-branch review on the most capable model (`superpowers:requesting-code-review`), with this plan's Review Focus pasted verbatim. Fix its Critical and Important findings test-first, and record its Minors in the swing spec's §14.
2. **Finish:** `superpowers:finishing-a-development-branch`, push, then `gh pr create` into `main` and watch CI (Ubuntu and Windows).
3. **Ask the user before merging.**
