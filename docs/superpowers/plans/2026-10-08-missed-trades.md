# Missed Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Missed trades: marked on a day's chart (entry, stop, optional target, exit) and scored in stock R. They get their own page (layout B), a Missed list page, an Analytics Missed tab, Missed in the Book filter, a Missed row on Playbook cards, skip reasons, the day's trades on the chart, and **+ Missed** on a scalp's chart. They travel in the export bundle and appear in `pnpm demo`.

**Architecture:**
- **`packages/core`:**
  - `missed.ts`: `missedRisk`, `snapToBar`, worked out on read like `scalpRisk`;
  - `missedStats.ts`: the rollups, and the Book filter's opt-in merge into taken-trade stats;
  - `model.ts`: the trade schemas accept `missed`.
- **`packages/db`:** a `missed_details` table (migration 0010) hydrated onto `TradeRecord.missed`, the `skip` tag kind, and `missed_details` as a bundle child.
- **`apps/server`:** the trade routes validate missed trades and add `missedRisk` to the view, `taken=true` leaves them out, and the existing scalp price filler fills their hold range.
- **`apps/web`:**
  - `missed/` (the page, the new-trade flow, `MissedWorkspace`, data hooks);
  - the chart learns points and context markers;
  - the Analytics Missed tab and Book filter;
  - the Playbook changes.

**Tech Stack:** TypeScript, Drizzle and better-sqlite3, Hono, zod, React 19, TanStack Query and Router, Lightweight Charts 5, Recharts, Vitest and fast-check, Biome.

**Spec:** [docs/superpowers/specs/2026-10-08-missed-trades-design.md](../specs/2026-10-08-missed-trades-design.md)

## Global Constraints

- **Stock R:** (exit − entry) ÷ |entry − stop|, sign-flipped for a short, to 0.01. Missed trades never contribute dollars. Taken (option) R and missed (stock) R are never averaged together, except under the Book filter's Missed opt-in, which labels it.
- **A missed trade:**
  - it's `strategy` scalp, `book` missed, no account, no legs, `netPnl` null, `source` manual;
  - `openedAt` is the entry, and `closedAt` the exit;
  - `exitPrice` and `closedAt` are both set or both null;
  - the exit is after the entry, on the same New York date.
- **Skip reasons:** tag kind `skip`, at most one per trade. The seeds are Hesitated, Saw it late, Away from screen, Already in a trade, Hit daily loss limit, Didn't meet my rules. They're seeded once, when no `skip` tag exists, deleted ones included.
- **Copy, word for word:**
  - **Server refusals:** "A trade has at most one skip reason", "The exit must come after the entry", "The exit must be on the entry's day, Sep 30" (the date as `MMM D`).
  - **The R line:** "Place the stop to see R", "The stop is above the entry for a long" / "The stop is below the entry for a short", "The stop can't be at the entry", "Place the exit to see R".
  - **Placing hints:** "Click the chart to place the entry", "Click the chart to place the stop", "Click the chart to place the target", "Click the chart to place the exit".
  - **Empty and missing states:** "No bars for XYZ on Sep 30. Check the ticker.", "Not a trading day", "No missed trades in this period. + Missed trade marks one on a day's chart."
  - **Missed page:** the header line "Setups you saw and didn't take, scored in R on the stock".
  - **Analytics notes:**
    - "Took = taken ÷ (taken + missed)."
    - "Missed trades have no contract, so they aren't in this breakdown."
    - "includes N missed (stock R)"
  - **Warnings and chips:**
    - "Outside 09:41's range (178.10–178.55)"
    - **needs stop** / **needs exit**
    - "Add an Alpaca key in Settings to fetch the stock's range."
- **Chart toggle:** `day`, on by default, labelled "Day's trades". It shows on missed trades' charts only.
- **Analytics URL:**
  - `tab=missed`;
  - `books` is a comma list of `live`, `paper` and `missed`; absent means `live,paper`, and a single old value still parses;
  - `mby` is the Missed tab's breakdown (`skip` is the default and is left out of the URL).
- **Tests stay light for Windows CI:** close every database you open, and write no big files.
- **Before each commit:** `pnpm format`, then `pnpm lint`, `pnpm typecheck`, and the changed packages' tests. The full `pnpm test` runs before the PR.

## Review Focus

1. **Dragging a point past the session's edge or onto a gap minute** must snap to a real bar, never store a time with no bar. *(Task 8: a drag test past the last candle.)*
2. **Flipping the direction with the stop already placed** must not move the stop. It only shows the wrong-side problem. *(Task 9: a toggle test.)*
3. **A missed trade without an exit** must stay out of anything treating `closedAt == null` as "open": live quotes, `isOpen`, the review queue, the Dashboard. *(Task 7: a Journal test, no live quote request for a missed row; Task 13: the Dashboard unchanged.)*
4. **A merge where the other machine's version of a missed trade wins** must bring its `missed_details` along with its trade row, and never mix the two. *(Task 5: the property test with missed trades.)*
5. **The Analytics Book filter with only Missed** must not crash dollar KPIs or charts on an empty taken set. *(Task 14: a test with books=missed.)*

---

## Ledger and workflow

- **The ledger** is `.superpowers/sdd/missed-trades/progress.md` (git-ignored): one line per task, `DONE <sha>` and its test count, plus any ruling.
- **Running tools:**
  - tsx is `node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs`;
  - never `bash -c`, and never a `pkill -f` pattern;
  - stop servers with `lsof -ti:PORT -sTCP:LISTEN | xargs -r kill`.
- **Web tests:** chart components are mocked with `apps/web/src/chart/testing.ts`'s fake for Lightweight Charts. Use `waitFor` before reading a query's data.

---

### Task 1: core — `missedRisk` and `snapToBar`

**Files:**
- Create: `packages/core/src/missed.ts`, `packages/core/src/missed.test.ts`, `packages/core/src/missed.property.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Interfaces (produces):**
```ts
export const DIRECTIONS = ["long", "short"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export interface MissedLevels {
  direction: Direction;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
}
export type MissedProblem = "no_stop" | "stop_at_entry" | "wrong_side" | "no_exit";
export interface MissedRisk {
  risk: number | null;
  r: number | null;
  plannedRR: number | null;
  mae: number | null;
  mfe: number | null;
  problem: MissedProblem | null;
}
export interface MissedRiskTrade {
  book: string;
  missed: MissedLevels | null;
  scalpPrices?: { holdHigh: number | null; holdLow: number | null } | null;
}
export function missedRisk(trade: MissedRiskTrade, live?: Partial<MissedLevels>): MissedRisk | null;
export function snapToBar(price: number, bar: { high: number; low: number }): number;
```

- [ ] **Step 1: Write the tests** (`missed.test.ts`):
  - A long with entry 178.42, stop 177.80, target 181.20, exit 179.90, hold 180.34 / 178.23 gives risk 0.62, r 2.39, plannedRR 4.48, mae −0.31, mfe 3.1.
  - The same trade as a short, mirrored (entry 178.42, stop 179.04, target 175.64, exit 176.94, hold 178.61 / 176.50), gives the same numbers.
  - The problems in order:
    - no stop → `no_stop` (and r, mae, mfe null);
    - stop = entry → `stop_at_entry`;
    - a long's stop above the entry → `wrong_side`;
    - a short's stop below the entry → `wrong_side`;
    - a valid stop with no exit → `no_exit`, but `risk` and `plannedRR` still set.
  - A target on the wrong side → plannedRR null, r still set.
  - No hold range → mae and mfe null, r set.
  - A hold that never went against the trade → mae 0, not positive.
  - `live` overrides each field: a dragged stop changes r.
  - A trade whose book isn't missed, or with `missed` null → null.
  - The 0.5 edge: entry 10, stop 9, exit 10.005 → r 0.01. Rounding uses `round2` from `money.ts` with the 1e-9 guard that `scalpRisk` uses (read `risk.ts` for the helper it calls and reuse it).
  - `snapToBar(181, { high: 180.5, low: 179 })` → 180.5; `snapToBar(178, …)` → 179; in range → unchanged.
- [ ] **Step 2: Run them; they fail:** `pnpm --filter @tj/core exec vitest run src/missed.test.ts`.
- [ ] **Step 3: Implement `missed.ts`:**

```ts
import { round2 } from "./money.js";

/** A missed trade's direction (missed-trades spec §3). */
export const DIRECTIONS = ["long", "short"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What a missed trade stores (missed-trades spec §3). */
export interface MissedLevels {
  direction: Direction;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
}

export type MissedProblem = "no_stop" | "stop_at_entry" | "wrong_side" | "no_exit";

/** A missed trade's stock R, worked out on read (missed-trades spec §4.1). */
export interface MissedRisk {
  /** |entry − stop| per share; null without a stop, or with one on the wrong side. */
  risk: number | null;
  r: number | null;
  plannedRR: number | null;
  /** The hold's worst and best price against the entry, in R: mae ≤ 0 ≤ mfe. */
  mae: number | null;
  mfe: number | null;
  problem: MissedProblem | null;
}

export interface MissedRiskTrade {
  book: string;
  missed: MissedLevels | null;
  scalpPrices?: { holdHigh: number | null; holdLow: number | null } | null;
}

const EPSILON = 1e-9;

export function missedRisk(trade: MissedRiskTrade, live: Partial<MissedLevels> = {}): MissedRisk | null {
  if (trade.book !== "missed" || !trade.missed) return null;
  const levels = { ...trade.missed, ...live };
  const sign = levels.direction === "long" ? 1 : -1;
  const entry = levels.entryPrice;
  const empty: MissedRisk = { risk: null, r: null, plannedRR: null, mae: null, mfe: null, problem: null };
  if (levels.stopPrice == null) return { ...empty, problem: "no_stop" };
  const toStop = (entry - levels.stopPrice) * sign;
  if (Math.abs(toStop) < EPSILON) return { ...empty, problem: "stop_at_entry" };
  if (toStop < 0) return { ...empty, problem: "wrong_side" };
  const risk = toStop;
  const inR = (price: number) => ((price - entry) * sign) / risk;
  const toTarget = levels.targetPrice == null ? null : inR(levels.targetPrice);
  const plannedRR = toTarget != null && toTarget > EPSILON ? round2(toTarget + EPSILON) : null;
  if (levels.exitPrice == null) return { ...empty, risk: round2(risk), plannedRR, problem: "no_exit" };
  const r = round2(inR(levels.exitPrice) + EPSILON * Math.sign(inR(levels.exitPrice)));
  const high = trade.scalpPrices?.holdHigh ?? null;
  const low = trade.scalpPrices?.holdLow ?? null;
  let mae: number | null = null;
  let mfe: number | null = null;
  if (high != null && low != null) {
    const [adverse, favourable] = sign > 0 ? [low, high] : [high, low];
    mae = Math.min(0, round2(inR(adverse)));
    mfe = Math.max(0, round2(inR(favourable)));
  }
  return { risk: round2(risk), r, plannedRR, mae, mfe, problem: null };
}

/** A clicked price kept inside its bar, so a missed trade can't be marked where nothing traded (spec §4.1). */
export function snapToBar(price: number, bar: { high: number; low: number }): number {
  return Math.min(bar.high, Math.max(bar.low, price));
}
```

  First check how `risk.ts` rounds R (`round2` plus a guard), and match it exactly if it differs from the above, so stock R and option R round the same way. Note it in the ledger. `-0` must never come out: normalise with `|| 0`.
- [ ] **Step 4: The property test** (`missed.property.test.ts`, fast-check, `numRuns` 200). For arbitrary entry (1–1000), positive risk, exit, target and hold offsets, a long and its mirror (every price p → 2·entry − p, direction short, high and low swapped) give equal `r`, `plannedRR`, `mae`, `mfe` and `problem`.
- [ ] **Step 5: Run the core tests, then commit:** "feat(core): missed trades' stock R, MAE/MFE and snapping".

### Task 2: core — `missedStats.ts`

**Files:**
- Create: `packages/core/src/missedStats.ts`, `packages/core/src/missedStats.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `MissedRisk` (Task 1); `Summary`, `summarize`, `ClosedTrade` (`stats.ts`); `GroupStats`, `ClosedScalp`, `openBucket`, `minutesAfterOpen`, `OPEN_BUCKETS` (`scalpStats.ts`); `WEEKDAYS`, `weekdayOfDate`, `nyDate`.
- Produces:
```ts
export interface MissedStatTrade {
  id: string;
  underlying: string;
  openedAt: number;
  setupId: string | null;
  grade: string | null;
  tagIds: readonly string[];
  missedRisk: { r: number | null; mfe: number | null } | null;
}
export interface MissedSummary {
  count: number; rCount: number; wins: number; losses: number; scratches: number;
  winRate: number | null; totalR: number; avgR: number | null;
  goodSkips: number; goodSkipsR: number; avgMfe: number | null;
  topReason: { tagId: string; count: number; totalR: number } | null;
}
export function missedSummary(trades: readonly MissedStatTrade[], skipIds: ReadonlySet<string>): MissedSummary;
export const MISSED_BREAKDOWNS = ["skip", "setup", "ticker", "open", "weekday", "grade"] as const;
export type MissedBreakdown = (typeof MISSED_BREAKDOWNS)[number];
export interface MissedRow { key: string; label: string; count: number; rCount: number; winRate: number | null; totalR: number; avgR: number | null; avgMfe: number | null }
export function missedBreakdown(trades: readonly MissedStatTrade[], by: MissedBreakdown,
  names: { setups: ReadonlyMap<string, string>; skips: ReadonlyMap<string, string> }): MissedRow[];
export interface TakenVsMissedRow { setupId: string | null; label: string;
  taken: { count: number; winRate: number | null; avgR: number | null };
  missed: { count: number; winRate: number | null; avgR: number | null };
  took: number | null }
export function takenVsMissed(taken: readonly ClosedScalp[], missed: readonly MissedStatTrade[], names: ReadonlyMap<string, string>): TakenVsMissedRow[];
export function withMissed(taken: readonly ClosedTrade[], missed: readonly MissedStatTrade[]): Summary;
export function withMissedGroups<R extends GroupStats & { key: string }>(rows: readonly R[], missed: readonly MissedRow[]): (R | (GroupStats & { key: string; label: string; missedOnly: true }))[];
```
  Before writing, read `GroupStats` and `BreakdownRow` in `scalpStats.ts`. If rows are keyed by `label` rather than `key`, key the merge by whatever field `scalpBreakdown` and `bucketStats` already use, and record that in the ledger.

- [ ] **Step 1: Tests:**
  - **`missedSummary`:** 5 trades with R +2.39, +1.15, −1, −0.84 and null (no exit) give count 5, rCount 4, wins 2, losses 2, winRate 0.5, totalR 1.7, avgR 0.43 (round2 of 1.7/4 = 0.425 → 0.43), goodSkips 2, goodSkipsR −1.84, and avgMfe over those with an mfe. `topReason` is the skip tag with the most trades, ties broken by its name (pass the names via `skipIds` plus a names map, or sort by id when names aren't given; pick one and test it).
  - **`missedBreakdown`:**
    - by `skip`: a trade with no skip tag goes in "no reason";
    - by `open`: uses `openBucket(minutesAfterOpen(openedAt))`, in `OPEN_BUCKETS` order;
    - by `weekday`: in `WEEKDAYS` order;
    - by `grade`: A–F, then "no grade";
    - by `setup`: "no setup" last;
    - the rows are sorted the way the scalps' breakdown sorts the same dimension; check `scalpBreakdown` and match it.
  - **`takenVsMissed`:** taken 75/65/3 and missed 9/8/11 per setup give took 75/84, 65/73 and 3/14. A setup with only missed trades gets took 0, a setup with only taken trades took 1, and "no setup" comes last.
  - **`withMissed`:**
    - net, grossWins, profitFactor, expectancy and maxDrawdown equal `summarize(taken)` exactly;
    - trades, wins, losses, scratches, winRate, avgR and rCount include the missed trades with an R;
    - avgR is from the raw values: taken R [1.005, 0.0] and missed [0.333] give round2(1.338/3) = 0.45, not an average of averages;
    - with taken empty, the dollar fields are 0 or null (whatever `summarize([])` gives) and nothing throws.
  - **`withMissedGroups`:** a key present in both adds count, recomputes winRate and avgR, and keeps net and profitFactor; a missed-only key appends with `missedOnly: true` and null dollar fields.
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(core): missed trades' rollups, and their opt-in into taken stats".

### Task 3: core — the schemas accept missed trades

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/model.test.ts`.

**Produces:**
- `missedLevelsSchema`: `{ direction: z.enum(DIRECTIONS), entryPrice: z.number().positive(), stopPrice, targetPrice, exitPrice: z.number().positive().nullable() }`.
- `newTradeSchema` gains `missed: missedLevelsSchema.nullish()` (default null), with these refinements, each with a `path`:
  - `book === "missed"` ⇔ `missed != null`, with message "missed trades need missed details";
  - a missed trade has `strategy` scalp, no legs, `netPnl` null and no `ironFly`;
  - `(missed.exitPrice == null) === (closedAt == null)`, with message "an exit needs both a time and a price".
- `tradePatchSchema` gains `missed: missedLevelsSchema.partial().optional()`.
- The New York date rule and the "after the entry" rule live in the repository (Task 4), because a patch must be checked against the stored row.

- [ ] **Steps:**
  1. Tests for each refinement, and that a plain live scalp still parses unchanged.
  2. Run them; they fail.
  3. Implement.
  4. Run them; they pass.
  5. Commit: "feat(core): trade schemas take a missed trade's levels".

### Task 4: db — `missed_details`, hydration, writes, skip tags, the filler's gap

**Files:**
- Modify:
  - `packages/db/src/schema.ts`;
  - `packages/db/src/repositories/trades.ts`;
  - `packages/db/src/repositories/taxonomy.ts`;
  - `packages/db/src/index.ts`;
  - the tests next to each.
- Create: migration `packages/db/migrations/0010_missed_trades.sql`, via `pnpm --filter @tj/db generate --name missed_trades`. Adding a table doesn't prompt; if it does, use the pty helper approach from the scalp-R plan.

**Produces:**
- **`missedDetails` table:**
  - `tradeId` text, primary key, references `trades`;
  - `direction` text, not null;
  - `entryPrice` real, not null;
  - `stopPrice`, `targetPrice` and `exitPrice` real, nullable.
- `TradeRecord.missed: MissedLevels | null` (hydrated in `hydrateMany`, one more query).
- `TradeFilter.taken?: boolean` (true → `book <> 'missed'`).
- `MissedRuleError` reuses `ReviewRuleError`, so the route's 400 path is unchanged.

- [ ] **Step 1: Tests** (`trades.test.ts`, `taxonomy.test.ts`, `migrate.test.ts`):
  - **Creating:** a missed trade with entry only round-trips `missed`, with `closedAt` null.
  - **Patching:**
    - setting `stopPrice`, then `targetPrice`, then `exitPrice` + `closedAt` together;
    - clearing exit (`exitPrice: null, closedAt: null`) works;
    - an exit price without `closedAt` (or the reverse), against the stored row, → `ReviewRuleError` "an exit needs both a time and a price";
    - `closedAt` ≤ `openedAt` → "The exit must come after the entry";
    - `closedAt` on another New York date → "The exit must be on the entry's day, Sep 30". Format the date with an `Intl.DateTimeFormat` for New York, month short and day numeric; the scalp review has one to reuse (`grep -rn "month: \"short\"" packages apps/server`).
  - **Moving the entry:** moving `openedAt` to another minute clears `scalp_prices` through the existing staleness rule; assert that the hold range is gone.
  - **Skip tags:**
    - two `skip` tags on one trade → `ReviewRuleError("A trade has at most one skip reason")`;
    - one skip and one emotion together → fine.
  - **Seeding:**
    - `seedDefaults` on a fresh db seeds the six skip reasons with the other tags;
    - on a db with tags but no skip tags, it seeds only the skip reasons;
    - after deleting all skip tags, it seeds nothing.
  - **`list({ taken: true })`** leaves missed trades out; `list({ book: "missed" })` lists only them.
  - **`missingScalpPrices`:** a closed missed trade with a stored hold range isn't returned (no option condition for book missed); a closed taken scalp without an option range still is.
  - **The migration** creates `missed_details` with those columns (extend `migrate.test.ts` the way the attachments migration was).
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement:**
  - **The schema.**
  - **Migration:** generate it, and read the SQL.
  - **`hydrateMany`:** read `missedDetails`.
  - **`writeChildren`:** `input.missed` null deletes the row; an object upserts it.
  - **Patch:**
    - merge `patch.missed` over the stored row;
    - check the pair, order and date rules against the merged values and `patch.openedAt ?? existing.openedAt` and `patch.closedAt ?? existing.closedAt` (undefined vs null matters: `"closedAt" in patch`);
    - write it.
  - **Skip tags:** add `checkOneSkip` beside `checkOneEmotion`, called on the same paths.
  - **Taxonomy:**
    - `kind: "mistake" | "emotion" | "skip"`;
    - `DEFAULT_SKIPS`;
    - `seedDefaults` per kind;
    - the `tagTaken` message for skip is "A skip reason with that name exists".
  - **`missingScalpPrices`:** the option-range `and(...)` gains `ne(trades.book, "missed")`.
  - **`list`:** `taken`.
- [ ] **Step 4: Run the db tests; they pass.**
- [ ] **Step 5: Commit:** "feat(db): missed trades' details, skip reasons, and taken-only lists".

### Task 5: db — missed trades in the bundle

**Files:** Modify `packages/db/src/bundle.ts`, `bundle.fixture.ts`, `bundle.test.ts`, `bundle.property.test.ts`.

- [ ] **Step 1: Tests:**
  - `BUNDLE_TABLES` includes `missed_details` after `scalp_targets`;
  - an export of a journal with a missed trade carries its row;
  - **a merge where the bundle's trade is newer** replaces the local `missed_details` (a stop changed on the other machine arrives);
  - **a merge where the local trade is newer** keeps its local `missed_details`;
  - **a bundle without the table** (delete it from the parsed bundle) keeps the local rows;
  - **the property test's generator** makes some missed trades (book missed, `missed` details, a skip tag), and the existing properties (convergence both ways, nothing lost) hold with them. Run it at `numRuns` 1,500 once locally, then put it back to 100.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement:**
  - `BUNDLE_TABLES`, the `BUNDLE_KEYS.missed_details = ["trade_id"]` entry, and `CHILDREN`;
  - the child maps in the aggregate code (search `scalp_details` in `bundle.ts`, and add `missed_details` beside each);
  - the fixture;
  - the generator.
- [ ] **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(db): missed trades travel in the bundle with their trade".

### Task 6: server — routes, view, taxonomy, filler

**Files:**
- Modify: `apps/server/src/routes/trades.ts`, `apps/server/src/routes/taxonomy.ts`
- Tests: `apps/server/src/app.test.ts` (or wherever the trade routes are tested; `grep -ln "POST /api/trades\|api/trades\"" apps/server/src/*.test.ts`), `taxonomy.test.ts`, `risk.test.ts` (the filler)

**Produces:**
- `TradeView.missedRisk: MissedRisk | null`;
- `GET /api/trades?taken=true`;
- `POST /api/tags` takes `kind: "skip"`.

- [ ] **Step 1: Tests:**
  - **POST:**
    - a missed trade → 201, with `missed` and `missedRisk` (problem `no_stop`);
    - each schema refusal → 400: an account id, legs, netPnl, ironFly, `missed` on a live trade, a live trade with book missed and no `missed`, price ≤ 0, an exit pair half set.
  - **PATCH:**
    - the order rule → 400 "The exit must come after the entry";
    - the date rule → 400 "The exit must be on the entry's day, Sep 30";
    - two skip tags → 400 "A trade has at most one skip reason".
  - **GET:**
    - `?taken=true` leaves missed trades out;
    - the list's rows carry `missedRisk`.
  - **Tags:** `POST /api/tags {kind:"skip"}` → 201.
  - **The filler:** with fake bars, filling a closed missed trade stores `holdHigh`/`holdLow`, and asks for no option bars. Use the existing scalp filler test's fakes.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement:**
  - `listQuerySchema.taken`;
  - `withMetrics` adds `missedRisk: missedRisk(trade)`;
  - the tag kind enum gains `skip`.
- [ ] **Step 4: Run the server tests; they pass.**
- [ ] **Step 5: Commit:** "feat(server): missed trades through the trade routes, with their R on read".

### Task 7: web — data hooks, routes, Shell, Journal and Scalps lists

**Files:**
- Create: `apps/web/src/missed/data.ts`, `apps/web/src/missed/data.test.tsx`
- Modify:
  - `apps/web/src/router.tsx` (drop the placeholder; add `/missed` and `/missed/new` with a validated `symbol` + `date` search);
  - `apps/web/src/routes/Journal.tsx` (missed rows; a `taken` locked filter);
  - `apps/web/src/routes/Scalps.tsx` (`taken: true`);
  - `Journal.test.tsx`, `Scalps.test.tsx`

**Produces** (`missed/data.ts`):
```ts
export function useMissedTrades(): UseQueryResult<TradeView[]>;          // GET /api/trades?book=missed&all=true&includeExcluded=true
export function useCreateMissed(): UseMutationResult<TradeView, Error, { underlying: string; openedAt: number; entryPrice: number }>;
export function useDayTrades(symbol: string, date: string, exceptId?: string): TradeView[]; // ?underlying=X&all=true, kept to nyDate(openedAt) === date
export function lastSession(now: number): string; // today after 16:00 NY on a trading day, else the previous trading day
```
- `useCreateMissed` posts `{ strategy: "scalp", book: "missed", underlying, openedAt, missed: { direction: "long", entryPrice, stopPrice: null, targetPrice: null, exitPrice: null } }` and invalidates `["trades"]`.
- Patches go through the existing `useSaveTrade(tradeId)`, whose body type now includes `missed`.

- [ ] **Step 1: Tests:**
  - `lastSession`: 2026-09-30 17:00 NY → "2026-09-30"; 2026-09-30 10:00 NY → "2026-09-29"; Saturday 2026-10-03 → "2026-10-02"; the Monday after a holiday morning → the Friday before the holiday. Use `isTradingDay` from core.
  - `useDayTrades` keeps the date and leaves the trade itself out (mock fetch).
  - **Journal:**
    - a missed row shows MISSED, "—" for Net and Return, and the stock R;
    - **Review Focus 3:** no quote request is made for a missed row without an exit. Assert that the quotes mock isn't called with its symbol.
  - **Scalps:** the page requests `taken=true`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.** The Journal's R cell reads `trade.risk?.r ?? trade.missedRisk?.r ?? null`, and Return is "—" for missed. **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(web): missed trades' data hooks and routes; lists tell taken from missed".

### Task 8: web — the chart learns points and context markers

**Files:**
- Modify:
  - `apps/web/src/chart/drag.ts` (`ChartEditing` gains point placing and dragging);
  - `apps/web/src/chart/IntradayChart.tsx`, `apps/web/src/chart/TradeCharts.tsx`, `apps/web/src/chart/ChartToolbar.tsx`;
  - `apps/web/src/chart/prefs.ts` (`day` toggle);
  - `apps/web/src/chart/testing.ts` (if the fake needs `timeToCoordinate` or `coordinateToTime`);
  - tests: `drag.test.ts`, `charts.test.tsx`, `prefs.test.ts`
- Create: `apps/web/src/chart/context.ts`, `context.test.ts` (the pure parts: marker building, hit-testing, tooltip text)

**Produces:**
```ts
// drag.ts
export type PointId = "entry" | "exit";
export interface PointMark { id: PointId; t: number; price: number; label: string }
export interface ChartEditing {        // existing fields, plus:
  placing: LineId | PointId | null;
  onPlacePoint?(id: PointId, t: number, price: number): void;   // t snapped to the bar's start, price via snapToBar
  onDropPoint?(id: PointId, t: number, price: number): void;
}
export function nearestPoint(x: number, y: number, points: readonly { id: PointId; x: number; y: number }[]): PointId | null; // within GRAB_PX
// context.ts
export interface ContextMark { tradeId: string; t: number; price: number | null; kind: "buy" | "sell" | "missed"; label: string; tip: string[] }
export function contextMarks(trades: readonly TradeView[], symbol: string): ContextMark[];
export function hitContext(t: number | null, x: number, marks: readonly ContextMark[], toX: (t: number) => number | null): ContextMark | null;
```
- **`IntradayChart` props gain:**
  - `points?: readonly PointMark[]` (drawn as hollow circles, `#8fb3ff`, at their price with their label, joined by a dotted line, with the hold between them shaded);
  - `context?: readonly ContextMark[]` (faint: arrows at 45% opacity; missed trades as hollow grey circles with a dotted line);
  - `onOpenTrade?(id: string)`.
  - **Hover:** a tooltip (an absolutely positioned div over the chart) shows `tip` lines for the context mark within `GRAB_PX` of the cursor's time.
  - **Click** on a context mark → `onOpenTrade`. Placing and dragging ignore context marks.
- **`TradeCharts` props gain:**
  - `points`;
  - `context`;
  - `daily?: boolean` (default true; false hides the daily chart and gives the intraday chart the full width);
  - `toolbarExtra?: ReactNode` (rendered at the toolbar's right, before Fit trade);
  - `showDay?: boolean` (renders the Day's trades toggle).
- **Snapping:** the bar a time snaps to is the displayed timeframe's candle under the pointer, its time that candle's start. The price snaps into that candle's high and low.
- **Dragging a point** past the last candle or into a gap snaps to the nearest candle (**Review Focus 1**).

- [ ] **Step 1: Tests:**
  - **The pure helpers:**
    - `nearestPoint` within and beyond `GRAB_PX`;
    - `contextMarks`:
      - a taken one-leg scalp gives a buy at `openedAt` and a sell at `closedAt`, with the tooltip lines from the spec;
      - a missed trade gives two `missed` marks, labelled "Missed short −0.62R";
      - a missed trade without an exit gives one mark;
    - `hitContext`.
  - **`charts.test.tsx`, with the fake:**
    - placing `entry` calls `onPlacePoint` with the candle's start time and the snapped price;
    - dragging a point past the last candle drops it on the last candle;
    - Esc during a drag calls `onCancel`;
    - a click on a context mark calls `onOpenTrade`;
    - with `daily={false}`, the daily chart isn't rendered;
    - the Day's trades toggle flips `prefs.show.day`.
  - **`prefs.test.ts`:** an old stored prefs object without `day` loads with `day: true`.
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement.**
  - Lightweight Charts 5 series markers support `position: "atPriceMiddle"` with a `price`. Check the installed version's `SeriesMarkerPosition` type; if it's missing, draw points as a line series of single points with circle markers.
  - Keep the chart built once, as now, with points and context updated in place.
- [ ] **Step 4: Run the web chart tests and the existing chart tests; they pass. No regressions in `LevelsOnChart.test.tsx` or `ScalpWorkspace.test.tsx`.**
- [ ] **Step 5: Commit:** "feat(web): the chart places and drags points, and shows the day's trades faintly".

### Task 9: web — `MissedWorkspace` (layout B), the new-trade page, `TradeDetail`

**Files:**
- Create:
  - `apps/web/src/missed/MissedWorkspace.tsx`;
  - `apps/web/src/missed/useMissedLevels.ts` (live levels, placing state, saving);
  - `apps/web/src/missed/MissedPanel.tsx`;
  - `apps/web/src/missed/NewMissed.tsx` (`/missed/new`);
  - `apps/web/src/missed/text.ts` (the R line, problem texts, the range warning);
  - tests: `MissedWorkspace.test.tsx`, `NewMissed.test.tsx`, `text.test.ts`
- Modify: `apps/web/src/routes/TradeDetail.tsx` (book missed → `MissedWorkspace`; the header shows R; no Edit button), `apps/web/src/router.tsx`

**Interfaces:**
- Consumes:
  - `missedRisk`, `snapToBar`, `Direction`, `MissedLevels` (Task 1);
  - `useSaveTrade` (review/data);
  - `SetupPicker`, `TagChips`, `NameField` (review/Pickers);
  - `useAutoFillPrices` (review/prices);
  - `TradeCharts` props (Task 8);
  - `useCreateMissed`, `useDayTrades` (Task 7);
  - `contextMarks` (Task 8).
- Produces: `missedLine(risk: MissedRisk | null, direction: Direction): string`, `rangeWarning(price: number, bar: { t: number; high: number; low: number } | null): string | null`.

**Behaviour:**
- **The layout:** `grid-template-columns: 2fr 1fr` from `lg` up, stacked below it. The chart is `TradeCharts` with `daily={false}`, `points`, `context` (when `prefs.show.day`), `showDay` and `onOpenTrade`.
- **The panel**, top to bottom:
  - Direction (Long | Short);
  - Entry (time `HH:MM`, price), Stop, Target, Exit (time, price), each with + to place and × to clear (not the entry);
  - the R line;
  - then Setup, Grade (A–F), Skip reason (`TagChips` for kind `skip`, single-select, swapping), Emotion, Notes and Exclude from stats.
- **Placing:**
  - an `entry` click on the new-trade page creates the trade;
  - after a stop is placed, placing moves on to `exit` if no exit is set;
  - Esc ends placing.
  - On a trade with no stop, the page opens with `placing = "stop"` if the trade was created within the last minute (the page just came from `/missed/new`); otherwise nothing is placing.
- **Direction rule:** a stop placed by **click** sets the direction from its side when the stop was unset before. The toggle flips the direction only (**Review Focus 2**). Typed and dragged stops never change it.
- **Typed times:** `HH:MM` in New York on the trade's date. The exit's date is the entry's. A typed time with no bar on the chart still saves.
- **Saving:** levels save through `useSaveTrade` as `{ missed: {...} }`, with `openedAt`/`closedAt` when times change. A 400's message shows under the field.
- **The hold range:** without it, the MAE/MFE half of the R line reads "Add an Alpaca key in Settings to fetch the stock's range." when the price fill answered `no_key` (`useAutoFillPrices` exposes the result; check `review/prices.ts`), and is left out otherwise until it arrives.

- [ ] **Step 1: Tests:**
  - **`text.test.ts`:** each problem's sentence (long and short wrong side); "R +2.39 · R:R 4.48"; "MAE −0.31R · MFE +3.10R"; and the `rangeWarning` format "Outside 09:41's range (178.10–178.55)".
  - **`MissedWorkspace.test.tsx`** (fake chart, fetch mocked):
    - the panel shows the stored levels;
    - typing a stop below the entry saves `{ missed: { stopPrice } }`;
    - **flipping to Short with a stop set** saves only the direction and shows "The stop is below the entry for a short" (**Review Focus 2**);
    - a click-placed stop above the entry, on a trade with no stop, saves `direction: "short"`;
    - × on Exit saves `exitPrice: null, closedAt: null`;
    - the skip picker swaps one reason for another;
    - the header shows the R;
    - there's no Edit button.
  - **`NewMissed.test.tsx`:**
    - the hint "Click the chart to place the entry" shows;
    - placing the entry posts the create body and navigates to `/trades/<id>`;
    - with no bars, "No bars for XYZ on Sep 30. Check the ticker." shows, and typing an entry time and price enables Create.
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass**, and so do `TradeDetail.test.tsx` and its neighbours.
- [ ] **Step 5: Commit:** "feat(web): a missed trade's page, marked on the chart with the levels beside it".

### Task 10: web — + Missed on a scalp's chart

**Files:** Modify `apps/web/src/review/ScalpWorkspace.tsx` (passes `toolbarExtra`) and `ScalpWorkspace.test.tsx`.

- [ ] **Steps:**
  1. Write the test: the button reads "+ Missed" and navigates to `/missed/new?symbol=TSLA&date=2026-07-13` for a scalp opened on that New York date. Use the router mock `ScalpWorkspace.test.tsx` already has, or pass a callback prop `onNewMissed(symbol, date)` from `TradeDetail`, whichever the existing `onOpenTrade` pattern uses.
  2. Run it; it fails.
  3. Implement.
  4. Run it; it passes.
  5. Commit: "feat(web): + Missed on a scalp's chart starts one on its ticker and day".

### Task 11: web — the Missed page

**Files:**
- Create: `apps/web/src/missed/MissedPage.tsx`, `apps/web/src/missed/NewMissedPopover.tsx`, `MissedPage.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Behaviour:**
- **The header and KPIs:** as in spec §6.1. Use `KpiStrip` if its props fit; otherwise a matching local strip, and note it in the ledger.
- **Date presets:** reuse `DATE_PRESETS` and the range helpers from `analytics/search.ts` and `analytics/dates.ts`, filtering on `nyDate(openedAt)`. The default is the last 30 days.
- **The list:**
  - **needs stop** and **needs exit** chips from `missedRisk.problem` (`no_stop` → needs stop; `no_exit` → needs exit; `wrong_side` and `stop_at_entry` → "check stop");
  - a row click calls `onOpenTrade`.
- **The popover:**
  - ticker (upper-cased, the Analytics `TICKER` pattern), and date (`<input type="date">`, defaulting to `lastSession(Date.now())`);
  - **Open chart →** is disabled with "Not a trading day" for non-trading dates;
  - Esc or Cancel closes it.

- [ ] **Step 1: Tests:**
  - **The KPIs** for 4 fixture trades: missed opportunity, would have won "2 of 3", Avg R, taken Avg R beside it, good skips, top reason.
  - **The list:** the chips, and the empty state.
  - **The popover:**
    - its default date (mock `Date.now`);
    - a Saturday shows "Not a trading day";
    - Open chart navigates with the symbol upper-cased.
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(web): the Missed page, with what hesitating cost and a quick way to mark one".

### Task 12: web — the Playbook: skip reasons and the cards' Missed row

**Files:**
- Modify:
  - `apps/web/src/routes/Playbook.tsx` (a third `TagList` "Skip reasons", kind `skip`);
  - `apps/web/src/analytics/SetupCards.tsx`;
  - `packages/core/src/scalpStats.ts` (`setupCards` gains an optional `missed` input, giving `missed: { count, winRate, avgR } | null` per card, and cards for missed-only setups);
  - the tests: `Playbook.test.tsx`, `SetupCards.test.tsx`, `scalpStats.test.ts`.
- [ ] **Step 1: Tests:**
  - **The Skip reasons list** shows the seeded reasons, and adding one posts kind `skip`.
  - **A card** with taken and missed trades shows the dashed Missed row (Missed 11, Would win % 72.7%, Missed avg R +1.04R). A card without missed trades has no row.
  - **A missed-only setup's card** reads "No taken trades yet" and shows the Missed row; its "last" date is the latest missed entry.
  - **`setupCards` without `missed`** is unchanged (the existing tests pass untouched).
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(web): skip reasons on the Playbook, and each setup's missed trades on its card".

### Task 13: web — the Analytics Missed tab

**Files:**
- Create: `apps/web/src/routes/MissedTab.tsx`, `MissedTab.test.tsx`
- Modify: `apps/web/src/routes/Analytics.tsx` (the tab button and body), `apps/web/src/analytics/search.ts` (`tab: "missed"`, `mby`, the `books` list), `search.test.ts`

**Behaviour:**
- The tab follows spec §6.6. The breakdown's bar chart reuses the Breakdown component's bar styling. Load the `dataviz` skill before writing it, and follow the existing `Breakdown.tsx` look.
- Missed trades come from the same `useAllTrades()` data: `book === "missed"`, then the ticker, setup, excluded and date filters, with dates on `nyDate(openedAt)` (add an `on: "open"` option to `filterTrades`, or filter locally).
- Taken trades are the scalps the Book filter's live/paper part keeps, or both when neither is selected.
- The Dashboard is untouched. Add a test asserting that its KPIs are unchanged by a missed trade in the data (**Review Focus 3**), in `Dashboard.test.tsx`.

- [ ] **Step 1: Tests:**
  - **The KPIs.**
  - **By skip reason** (the default): the rows, and the bars mock receiving Total R.
  - **Switching to Setup** writes `mby=setup`.
  - **Taken and missed** with Took %, and the note "Took = taken ÷ (taken + missed)."
  - **"R covers 2 of 3".**
  - **`search.ts`:** `books=live,missed` parses; `books=live` still parses; junk is dropped; `tab=missed` and `mby`. `toFilter` gives the books array.
  - **Dashboard:** a missed trade doesn't change its numbers.
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(web): the Analytics Missed tab: why trades were skipped, and taken against missed by setup".

### Task 14: web — Missed in the Analytics Book filter

**Files:**
- Modify:
  - `apps/web/src/routes/Analytics.tsx` (the filter's Book buttons become three toggles);
  - `apps/web/src/analytics/data.ts` (`Book` gains missed);
  - `apps/web/src/routes/OverviewTab.tsx`, `apps/web/src/routes/ScalpsTab.tsx`;
  - `apps/web/src/analytics/KpiStrip.tsx` (the Avg R note);
  - `Breakdown.tsx` (the contract note; blank dollar cells for missed-only rows);
  - tests: `Analytics.test.tsx`, `ScalpsTab.test.tsx`, `data.test.tsx`

**Behaviour** (spec §6.8):
- **With `missed` in books**, Overview and Scalps split the filtered trades into taken and missed.
  - **KPIs:** use `withMissed(taken, missed)` for count, win rate and Avg R, and the taken-only summary for every dollar figure. The Avg R tile gains "includes N missed (stock R)".
  - **Breakdowns and the time-of-day buckets:** use `withMissedGroups(rows, missedBreakdownLike)`, with missed rows built per dimension: book → "Missed"; setup, ticker, weekday, grade and minutes after open as in `missedBreakdown`.
  - **DTE, Call/put, Option cost, Contracts** show "Missed trades have no contract, so they aren't in this breakdown." and leave them out.
  - **Mistake cost** stays taken-only.
  - **The equity curve and the calendar** stay taken-only.
- **Missed alone:** the dollar tiles read "—", and the charts with no taken trades show their usual empty states.

- [ ] **Step 1: Tests:**
  - **The three Book toggles** write `books=live,paper,missed`, and toggling Missed off returns to no `books` param.
  - **Overview with Missed on:** the trade count and win rate include the missed trades; net P&L is unchanged; the Avg R tile has its note.
  - **Scalps tab with Missed on:** the By Book breakdown has a Missed row with blank dollar cells; the DTE breakdown shows the note; mistake cost is unchanged.
  - **Review Focus 5:** `books=missed` alone renders Overview and Scalps without throwing, with "—" dollar tiles.
- [ ] **Step 2: Run them; they fail.** **Step 3: Implement.** **Step 4: Run them; they pass.**
- [ ] **Step 5: Commit:** "feat(web): Missed in the Analytics Book filter adds them to counts, win rate and R, never dollars".

### Task 15: demo data, README, docs

**Files:**
- Create: `packages/demo/src/missed.ts`, `packages/demo/src/missed.test.ts`
- Modify:
  - `packages/demo/src/index.ts` (call it, and `DemoSummary.missed`);
  - `packages/demo/src/write.ts` (if writes go through it);
  - `README.md`;
  - `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§6, §8.4 and §9, as the missed-trades spec's §11 says);
  - the missed-trades spec's Status line ("implemented on feat/missed-trades").
- [ ] **Step 1: Tests** (`missed.test.ts`):
  - **The volume:** with `--end` fixed and seed 42, the generator makes 15–25 missed trades;
  - **the shape of each trade:**
    - every one has an entry in the first 90 minutes, a stop on the right side, an exit after the entry on the same day, and a skip tag;
    - its R is between −1.2 and +4;
  - **the mix:**
    - 50–70% are winners;
    - the generator is deterministic for a seed (the same R list twice).
- [ ] **Step 2: Run them; they fail.**
- [ ] **Step 3: Implement:**
  - **Where:** missed trades go on scalp sessions, in their own PRNG stream (seeded from the seed and `"missed"`, so the scalps don't change).
  - **The levels and the exit:** the stop and target levels match the scalps'. The exit is the first of the target, the stop, or a 5–40 minute time stop, read off the generated minute bars.
  - **The skip reasons**, weighted: Hesitated 35%, Saw it late 25%, Already in a trade 15%, Didn't meet my rules 10%, Away from screen 10%, Hit daily loss limit 5%.
  - **The rest:** setups, grades and notes come from the scalps' pools, and the hold range is written into `scalp_prices` like the scalps'.
  - **The demo's tests:** `demo.test.ts` and `generate.test.ts` keep passing; update their counts if they assert totals.
- [ ] **Step 4: README and screenshot:**
  - start `pnpm demo --end <the README's end date>`, open `/missed` in headless Firefox (the visual-check recipe), and save `docs/images/missed.png` at 1440×900;
  - add it to the README's images, with a feature line: "Missed trades: setups you skipped, marked on the chart and scored in R, with what hesitating cost and which skips were good calls."
- [ ] **Step 5: The docs:** update the parent spec's §6, §8.4 and §9 and the missed-trades spec's Status line.
- [ ] **Step 6: Run `pnpm test` (all packages), then commit:** "feat(demo): missed trades in the demo, and the README shows them".

### Task 16: live check, final review, PR

- [ ] **Step 1: The live check.** Run a stand-in server on port 4199 over a `.backup()` copy of the real journal (the visual-check recipe, with `settings` pointed at the real secrets, read-only use). Then:
  - mark a missed trade on a real recent session's chart (entry, stop, target, exit) by clicking;
  - check its R by hand against the bars;
  - toggle Day's trades on a day with taken scalps;
  - use + Missed from a scalp;
  - open the Missed page, the Analytics Missed tab, the Book filter with Missed on, and a Playbook card.

  Screenshot each into the scratchpad and look at them. Stack them with ImageMagick to look once. Fix what's wrong, test-first.
- [ ] **Step 2: Record the check** in a "Live check (2026-10-08)" section at the end of the spec.
- [ ] **Step 3: The final review.** Run a whole-branch Opus review (`superpowers:requesting-code-review`, base main). Fix its Critical and Important findings test-first, and record the Minors in the spec's "Final review" section.
- [ ] **Step 4: Run the full checks:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5: Push, `gh pr create`,** watch `gh pr checks <n> --watch` (Ubuntu and Windows). Merge with `gh pr merge <n> --merge --match-head-commit <full sha>` once green (autopilot grant), then pull main.
