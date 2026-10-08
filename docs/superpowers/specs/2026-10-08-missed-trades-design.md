# Missed Trades — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved 2026-10-08. The user made the decisions in §2 in the brainstorm, over four mockups, and approved the three design sections. They then said "proceed, you don't need me for anything, go on autopilot for now", so the written spec and the plan go ahead without a review stop.
- **Scope:** parent spec §8.4 (Phase 2, item 5): missed trades marked on the chart, scored in R, with their own page, an Analytics tab, and a place on the Playbook.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §2 (Book, Missed trade, R), §6, §8.4 and §9.

---

## 1. Purpose and success criteria

A missed trade is a scalp setup the user saw and didn't take. Logging them answers two questions, which the user weighs equally:

- **What hesitating costs:** how much R is left on the table, why the trades were skipped, and which skips were good calls because the trade would have lost.
- **Whether a setup works:** a setup judged on every time it appeared, not only on the times the user took it.

The user logs them **after the session**, from the finished chart.

**Success:**
- **Creating:** on the Missed page, **+ Missed trade** takes a ticker and a date, opens that day's chart, and a click places the entry. The stop, an optional target and the exit are then placed or dragged on the chart, or typed. R appears as soon as the stop and exit are in.
- **Reviewing:** the missed trade's page (layout B) holds the chart, the levels, and the setup, grade, skip reason, emotion, notes and screenshots.
  - The same ticker's other trades that day show as faint markers.
  - A taken scalp's chart has **+ Missed**, for a missed trade on its ticker and day.
- **The Missed page:** KPIs (missed opportunity, would have won, Avg R, good skips, top reason) over a list of missed trades.
- **Analytics:**
  - A **Missed** tab: KPIs, a breakdown (skip reason, setup, ticker, minutes after open, weekday, grade), and taken against missed by setup, with Took %.
  - **Missed** in the Book filter, off by default. Turned on, missed trades join the counts, win rate and Avg R, never the dollars.
- **The Playbook:**
  - Setup cards get a Missed row.
  - Skip reasons are managed next to mistakes and emotions.
- **Export/merge** carries missed trades, and **`pnpm demo`** generates some.

### Out of scope
- **An option-price estimate** for a missed trade ("would have made $X"); its R is on the stock (§2).
- **Missed iron flies.** Missed trades are always scalps, as the parent spec says.
- **Quick capture during the session.**
- **A rule-based exit** (stop, target or time stop, whichever comes first). The user marks the exit.
- **Dashboard changes:** it stays on taken trades.
- **Changing a missed trade's ticker or date.** Delete it and mark it again.

---

## 2. Decisions

All of these were made by the user in the brainstorm, except the last two rows, which follow from them.

| Question | Decision |
|---|---|
| What it's for | **Both equally:** the cost of hesitating, and setups judged on every appearance. |
| When it's logged | **After the session.** No quick-capture form or "to finish" list. |
| Scoring | **Stock R:** (exit − entry) ÷ \|entry − stop\|, flipped for a short. Taken scalps keep their option R. Where both appear (setup stats), they sit in **separate columns, never averaged**. The one exception is the Book filter's opt-in (below). |
| The exit | **The user marks it**, by clicking or typing. The target is an optional planned level, giving the planned R:R. A rule-based exit was offered and declined. |
| Skip reasons | **An editable list:** a third tag kind, `skip`, one per trade, managed on the Playbook and merged like the other tags. Seeded with Hesitated, Saw it late, Away from screen, Already in a trade, Hit daily loss limit and Didn't meet my rules. |
| The page | **Layout B:** the chart on two thirds of the width, and one column on the right with Direction, Entry, Stop, Target, Exit, the R line, Setup, Grade, Skip reason, Emotion, Notes and Exclude. Screenshots go under it. |
| The Missed page | KPIs, then the list. **+ Missed trade** opens a popover (ticker, and a date that defaults to the last session), then a draft chart. **The first entry click creates the trade.** |
| The day's trades | **On the chart, faint.** The same ticker's taken scalps that day show as dimmed arrows, and its other missed trades as hollow circles with a dotted line. Hovering one gives a tooltip, and clicking it opens that trade. A **Day's trades** toggle in the toolbar turns them off. |
| + Missed on a scalp | **Yes:** a toolbar button on a taken scalp's chart starts a missed trade on its ticker and day. |
| Analytics | **A Missed tab:** the KPIs, a breakdown, and "Taken and missed, by setup" with Took %. **The Book filter gets Missed** (the user's addition), off by default. With it on, missed trades count in trades, win rate, Avg R and the R and win % views. They add nothing to dollars, and Avg R says it includes stock R. |
| The Playbook | A setup card's sparkline and stats stay taken-only. A dashed **Missed** row adds the count, would-win % and missed Avg R. A setup with only missed trades still gets a card. |
| Storage | **A trades row plus a 1:1 `missed_details` table** (§3). The hold range reuses `scalp_prices` and its filler. |
| Breakdowns by contract | DTE, Call/put, Option cost and Contracts **leave missed trades out**, with a note, since they have no contract. *(Mine: it follows from stock R.)* |
| Mistake cost | **Taken trades only**, whatever the filter. It compares dollars and option R with and without a mistake, which a missed trade can't add to. *(Mine.)* |

---

## 3. Data

- **`missed_details`** (migration 0010), one row per missed trade:
  - `trade_id` text primary key, references `trades`;
  - `direction` text, `long` or `short`;
  - `entry_price` real, not null;
  - `stop_price`, `target_price` and `exit_price` real, each null until set.
- **The trades row:**
  - `strategy` is scalp and `book` is missed;
  - no account, `source` manual, no legs, `net_pnl` null, fees 0;
  - `opened_at` is the entry time; `closed_at` is the exit time, or null until the exit is set. `exit_price` and `closed_at` are set and cleared together.
  - Setup, grade, notes, tags, excluded, screenshots and soft delete work as for any trade.
- **The trade record** (`TradeRecord`, so the list and `GET /api/trades/:id`) gains `missed: { direction, entryPrice, stopPrice, targetPrice, exitPrice } | null`.
- **The trade view** gains `missedRisk: MissedRisk | null` (§4.1), worked out on read like `risk`.
- **Tags:** `kind` accepts `skip`. `seedDefaults` seeds the six skip reasons once: when no `skip` tag exists, deleted ones included, so removing them all doesn't bring them back. A trade carries at most one skip tag, as with emotions ("A trade has at most one skip reason").
- **Hold range:** a missed trade's `scalp_prices` row holds the stock's high and low from the entry minute through the exit minute. Its `entry_price` column goes unused, since the entry is typed or clicked.

---

## 4. Core

### 4.1 `missed.ts`: one trade

```ts
interface MissedRisk {
  /** |entry − stop| per share; null without a stop, or with one on the wrong side. */
  risk: number | null;
  /** (exit − entry) ÷ risk, sign-adjusted for a short, to 0.01. */
  r: number | null;
  /** (target − entry) ÷ risk, sign-adjusted; null without a target or with one on the wrong side. */
  plannedRR: number | null;
  /** The hold's worst and best price against the entry, in R: mae ≤ 0 ≤ mfe. Null without the hold range or R. */
  mae: number | null;
  mfe: number | null;
  problem: "no_stop" | "wrong_side" | "stop_at_entry" | "no_exit" | null;
}
missedRisk(trade, live?: { direction?, entry?, stop?, target?, exit? }): MissedRisk | null
```

- **Null** for a trade that isn't missed.
- **`live`** overrides the stored values, so the side panel follows a drag, as `scalpRisk(trade, live)` does.
- **The problems, in this order:**
  - `no_stop`;
  - `stop_at_entry`;
  - `wrong_side`: a long's stop at or above the entry, or a short's at or below it;
  - `no_exit`.

  With a problem, `r`, `mae` and `mfe` are null. `plannedRR` needs only a valid stop and a target on the profit side.
- **MAE / MFE:** for a long, (hold low − entry) ÷ risk and (hold high − entry) ÷ risk, clamped to ≤ 0 and ≥ 0. For a short the high is the adverse side. The R rounding and the 1e-9 float guard follow `scalpRisk`.
- **Win / loss / scratch:** R > 0 / R < 0 / R = 0 (parent spec §9).
- **`snapToBar(price, bar)`** keeps a clicked price inside the bar's low and high (§6.4).

### 4.2 `missedStats.ts`: rollups

- **`missedSummary(trades)`:**
  - `count` (all missed trades the filter keeps) and `rCount` (those with an R);
  - wins, losses, scratches;
  - `winRate` (wins ÷ rCount);
  - `totalR` (the missed opportunity) and `avgR`;
  - `goodSkips` (R < 0) and their `goodSkipsR`;
  - `avgMfe`;
  - `topReason` (the skip reason with the most trades, ties broken by name, with its count and total R).
- **`missedBreakdown(trades, by, names)`:** rows by `skip`, `setup`, `ticker`, `open` (minutes-after-open bucket, the same buckets as scalps), `weekday` or `grade`. Each row has N, would-win %, total R, avg R and avg MFE. Trades without an R are counted in N but left out of the R columns, as the scalps' "R covers" note does.
- **`takenVsMissed(taken, missed, names)`:** rows by setup, taken scalps' N, win % and Avg R (option R) beside missed trades' N, would-win % and Avg R (stock R), and Took % = taken ÷ (taken + missed). A "no setup" row comes last.
- **`withMissed(taken, missed)`:** the Book filter's opt-in (§6.8). It takes the closed taken trades and the missed trades, and returns `summarize(taken)` with the missed trades with an R added to `trades`, `wins`, `losses`, `scratches`, `winRate`, `avgR` and `rCount`. The dollar fields are left alone. Avg R is recomputed from the raw R values of both lists, not from rounded averages.
- **`withMissedGroups(rows, missedRows)`** does the same for `GroupStats` rows, key by key. N, win % and avg R gain the missed trades, and net, PF and avg return stay taken-only. A key only missed trades have gets a row with blank dollar columns.

---

## 5. Server

- **`POST /api/trades`** accepts a missed trade: `book: "missed"`, `strategy: "scalp"`, and `missed: { direction, entryPrice, stopPrice?, targetPrice?, exitPrice? }`. It's refused (400) with:
  - an account, legs, a net P&L or iron-fly details;
  - no `missed`, or `missed` on another book;
  - a price at or below 0;
  - `exitPrice` without `closedAt`, or the reverse;
  - `closedAt` at or before `openedAt` ("The exit must come after the entry"), or on another New York date ("The exit must be on the entry's day, Sep 30").
- **`PATCH /api/trades/:id`** accepts `missed` as a partial (any field, `null` clearing stop, target or exit), with the same checks against the stored row. Moving the entry or exit to another minute makes the stored hold range stale, through the existing `staleScalpPrices` rule.
- **`GET /api/trades`:**
  - `taken=true` leaves missed trades out, which the Scalps page uses;
  - `book=missed` lists them, which the Missed page uses;
  - the Journal's "all" stays all.
- **The price filler** already takes every scalp. It now leaves missed trades out of the option-range condition: they have no contract, so they would stay in its gap list forever.
- **Taxonomy:** `POST /api/tags` accepts `kind: "skip"`, and seeding is per kind (§3).
- **The trade view** adds `missedRisk: missedRisk(trade)`.

---

## 6. Web

### 6.1 The Missed page (`/missed`, replacing the placeholder)
- **The header:** "Missed", the line "Setups you saw and didn't take, scored in R on the stock", a date preset select (Analytics' presets, default **Last 30 days**, by the entry's New York date), and **+ Missed trade**.
- **The KPIs:**
  - **Missed opportunity** (total R, "the R of all 14, had you taken them");
  - **Would have won** ("9 of 14", with the % under it);
  - **Avg R**, with "taken scalps: +0.41" under it (the taken scalps' Avg R over the same dates);
  - **Good skips** ("would have lost −4.1R");
  - **Top reason** ("6 trades · +6.2R").
- **The list,** newest first:
  - columns: Entry (date and time), Symbol, Dir (a Long or Short chip), Setup, Skipped, Notes, R, MFE and Grade;
  - a trade missing its stop or exit shows a **needs stop** or **needs exit** chip in the R column;
  - a row opens `/trades/:id`;
  - with none: "No missed trades in this period. + Missed trade marks one on a day's chart."
- **The + Missed trade popover:**
  - Ticker (the Analytics ticker pattern);
  - Date, defaulting to the last finished session: today after 16:00 New York on a trading day, otherwise the previous trading day. A non-trading day shows "Not a trading day".
  - **Open chart →** goes to `/missed/new?symbol=NVDA&date=2026-09-30`.

### 6.2 New missed trade (`/missed/new`)
- **The page:** layout B on that day's bars, with an empty side panel and the hint "Click the chart to place the entry". Nothing exists yet.
- **The first click** creates the trade: the entry, at the clicked bar's time and the snapped price, direction long. The page then replaces itself with `/trades/:id`.
- **Placing goes on by itself:** stop next ("Click the chart to place the stop"), then the exit. Esc stops placing. The panel's **+ Stop**, **+ Target** and **+ Exit** start placing any level that's unset.
- **A day with no bars:** "No bars for XYZ on Sep 30. Check the ticker." The entry can still be typed (time and price) and **Create** pressed.

### 6.3 The missed trade's page (`MissedWorkspace`, layout B)
- **`TradeDetail`** renders it for `book === "missed"` in place of the scalp or fly body. The header reads:
  - the ticker, its name, MISSED and the Long or Short chip;
  - the date and the times, "Sep 30, 09:41 → 09:58";
  - the R, large, on the right.

  There's no Edit button (everything is edited in place), and **Delete** stays.
- **The chart** (two thirds) is the intraday chart alone, with no daily chart beside it. The side panel (one third) holds:
  - **Direction:** Long | Short.
  - **Entry:** a time and a price field. **Stop**, **Target**: a price each. **Exit:** a time and a price.
    - Each saves on blur or Enter, the way the scalp review's level fields do, with × to clear the stop, target or exit.
    - A typed price outside its minute's low–high shows "Outside 09:41's range (178.10–178.55)", from the bars the chart holds, and still saves.
  - **The R line:** "R +2.4 · R:R 4.5", then "MAE −0.3R · MFE +3.1R". With a problem, it shows its text instead:
    - "Place the stop to see R";
    - "The stop is above the entry for a long";
    - "The stop can't be at the entry";
    - "Place the exit to see R".
  - **Setup**, **Grade**, **Skip reason** (one, from the `skip` tags, with + to add one) and **Emotion**, using the review's pickers.
  - **Notes**, and **Exclude from stats**.
- **Screenshots** sit under the chart and panel, as on every trade page.
- **Direction:**
  - When the stop is first placed by a click, the direction follows its side: below the entry is long, above is short.
  - The toggle flips it any time.
  - A typed or dragged stop never changes it, and a stop on the wrong side shows its problem.
- **The hold range** is fetched by the existing `useAutoFillPrices`, which already runs for scalps.

### 6.4 The chart
- **Points:** `IntradayChart` learns placeable and draggable **points** next to its lines (`PointMark { id: "entry" | "exit", t, price, label }`).
  - A point is drawn as a hollow circle at its price, with its label ("Entry 178.42").
  - `editing.placing` can name a point: a click places it at the bar under the pointer, its time snapped to that bar's start and its price snapped into the bar's range (`snapToBar`).
  - Pressing within `GRAB_PX` of a point drags it in both time and price, snapping the same way. It saves on release, and Esc puts it back.
  - The entry and exit are joined by a dotted line, and the hold is shaded.
- **Context markers** (the day's trades):
  - **Taken scalps:** a dimmed arrow at each one's entry and exit (`opened_at`, `closed_at`, from its single leg, as `tradeMarks` does without fills).
  - **Other missed trades:** dimmed hollow circles at their entry and exit, with a dotted line and a label ("Missed short −0.62R").
  - **Hover** shows a tooltip:
    - for a taken scalp, "Taken · NVDA 180C · Live / 10:04 → 10:16 · 3 contracts / +$186.40 · +1.62R / Click to open";
    - for a missed trade, "Missed · Short / 10:52 → 11:06 / −0.62R / Click to open".
  - **A click** opens the trade.
  - **They can't be dragged,** and placing ignores them.
- **Day's trades** is a new chart toggle (`day`, on by default), stored with the other toggles. It shows on missed trades' charts only. The trades come from `GET /api/trades?underlying=X`, kept to that New York date, without the trade itself.
- **+ Missed** sits in the toolbar of a taken scalp's chart and goes to `/missed/new?symbol=<ticker>&date=<entry date>`.

### 6.5 Lists
- **Journal:**
  - missed rows show the MISSED chip, "—" for Net and Return, the stock R in the R column, and the grade;
  - the existing Missed book button now finds them.
- **Scalps page:** taken scalps only (`taken=true`). The review queue already skips missed trades.
- **Shell:** the Missed nav item leads to §6.1.

### 6.6 Analytics: the Missed tab (`tab=missed`)
- **Its trades:**
  - it always reads missed trades, whatever the Book filter;
  - the dates, ticker and setup filters apply, and so does "include excluded";
  - dates are the entry's New York date, since a missed trade without an exit has no close.
- **KPIs:**
  - Missed trades;
  - Missed opportunity ("had you taken all 31");
  - Would have won ("19 of 31");
  - Avg R ("on the stock");
  - Good skips ("would have lost −9.2R");
  - Took ("143 taken · 31 missed").
- **Break down by:** Skip reason (the default), Setup, Ticker, Minutes after open, Weekday or Grade.
  - The table shows N, Would win %, Total R, Avg R and Avg MFE.
  - Beside it is a bar chart of Total R, in the existing breakdown's style.
  - The choice is kept in the URL (`mby`).
- **Taken and missed, by setup:** two column groups, "Taken (option R)" with N, Win % and Avg R, and "Missed (stock R)" with N, Would win % and Avg R, then Took.
  - Taken means the closed taken scalps under the same filters. The Live/Paper part of the Book filter picks them, and both are used when neither is on.
  - The note under it: "Took = taken ÷ (taken + missed)."
- **"R covers 29 of 31"** shows when some missed trades lack a stop or exit.

### 6.7 The Playbook
- **Skip reasons:** a third `TagList` beside Mistakes and Emotions.
- **The setup cards' Missed row** (dashed rule): Missed, Would win %, Missed avg R. It's hidden when the setup has no missed trades.
  - A setup with only missed trades gets a card with "No taken trades yet" in place of the sparkline and stats.
  - The card's "last" date counts missed entries too.

### 6.8 Analytics: the Book filter
- **The `books` parameter** becomes a comma list of `live`, `paper` and `missed`; absent means live and paper. An old link's single `live` or `paper` still parses.
- **Missed on** (with Live and/or Paper), on Overview and Scalps:
  - **KPIs:** the trade count, win rate and Avg R include missed trades (`withMissed`). Net P&L, profit factor, expectancy, avg return, max drawdown, the equity curve and the calendar stay on taken trades.
  - **The Avg R tile** gains "includes 31 missed (stock R)".
  - **Time of day and Breakdowns:** with the R or Win % bars, and in the table's N, Win % and Avg R columns, missed trades join (`withMissedGroups`).
    - By Book, Missed gets its own row.
    - DTE, Call/put, Option cost and Contracts leave them out, with "Missed trades have no contract, so they aren't in this breakdown."
  - **Mistake cost** stays taken-only.
- **Missed alone:** the Scalps tab shows only missed trades, with the dollar tiles blank ("—"). Overview reads the same way.
- **Iron flies** is unaffected, and the **Missed tab** ignores the Book filter.

---

## 7. Export / merge

- `missed_details` joins `BUNDLE_TABLES`, and it's a child in a trade's aggregate next to `scalp_details`, so it travels with the winning side of its trade.
- `skip` tags merge like the other tags: by kind and name ignoring case, the smaller id kept.
- A bundle from before this change has no `missed_details` table. A table a bundle lacks keeps its local rows, as for any older bundle.
- The bundle fixture and the property test's generator make missed trades, some with skip tags.

---

## 8. Demo data and README

- **`pnpm demo`** generates about 20 missed trades over its six months, on the scalp symbols:
  - an entry in the first 90 minutes;
  - stock levels like the scalps' (the stop 0.08–0.13 of the day's move away, the target 0.12–0.22);
  - the exit at the first of the target, the stop or a 5–40 minute time stop, which keeps the generated ones honest;
  - about 60% winners, plus a few good skips;
  - skip reasons weighted toward Hesitated and Saw it late;
  - setups, grades and a few notes;
  - their `scalp_prices` hold range written like the scalps'.
- **README:** a Missed page screenshot (`docs/images/missed.png`) taken from `pnpm demo` with the fixed `--end`, and a line in the feature list.

---

## 9. Errors and edge states

| Situation | Behaviour |
|---|---|
| A ticker or day with no bars | The chart reads "No bars for XYZ on Sep 30. Check the ticker." Typing still works. |
| No Alpaca key | The chart reads as for any trade. Values can be typed; MAE and MFE stay blank with "Add an Alpaca key in Settings to fetch the stock's range." |
| A weekend or holiday date | The popover reads "Not a trading day" and won't open the chart. |
| The exit before the entry, or on another day | 400; the field shows "The exit must come after the entry" or "The exit must be on the entry's day, Sep 30". |
| A typed price outside its minute's range | A warning under the field; it still saves. |
| No stop, or no exit | R blank, with the R line's text, and a **needs stop** or **needs exit** chip in the list. Counted in N, left out of the R stats with "R covers x of y". |
| The stop on the wrong side, or at the entry | R blank, with "The stop is above the entry for a long" or "The stop can't be at the entry". |
| Excluded | Left out of every stat unless "include excluded" is on, like any trade. |
| Deleted | A soft delete, as for any trade. It leaves the lists, stats and other charts' day's-trades markers. |
| A second skip reason | 400, "A trade has at most one skip reason". The picker swaps one for the other. |

---

## 10. Testing

- **core:**
  - `missedRisk`: long and short, each problem in order, `live` overrides, MAE/MFE clamping, R rounding at the 0.5 edge;
  - a **property test**: mirroring a long into a short (prices reflected around the entry) gives the same R, R:R, MAE and MFE;
  - `snapToBar`;
  - `missedSummary`, `missedBreakdown`, `takenVsMissed`;
  - `withMissed` and `withMissedGroups`, including that dollars never move.
- **db:**
  - the migration on a copy of an older schema;
  - the repository: create, patch (each field, clearing), the exit pair rule, one skip tag, per-kind seeding;
  - `missingScalpPrices` without the option condition for missed trades;
  - the bundle: missed trades in the property test's aggregates, and an older bundle without the table.
- **server:**
  - the POST and PATCH validation (each 400 in §5);
  - `taken=true`;
  - `missedRisk` on the view;
  - the filler filling a missed trade's hold range.
- **web:**
  - **the Missed page:** KPIs, the list and chips, the empty state, and the popover's date default and non-trading day;
  - **`/missed/new`:** the first click creates the trade and navigates;
  - **`MissedWorkspace`:** typed fields, the range warning, the direction rules, the R line's problems, the pickers and the skip-reason swap;
  - **the chart:** placing and dragging points with snapping, Esc, context markers with their tooltip and click, and the Day's trades toggle;
  - **+ Missed** on a scalp;
  - **Journal rows** and the **Scalps page** without missed trades;
  - **Analytics:** the Missed tab (KPIs, breakdown, taken vs missed, R covers), and the Book filter on, off and alone, including the contract-breakdown note;
  - **the Playbook:** Skip reasons, the cards' Missed row, and a missed-only card;
  - **search parsing:** `books` lists and old single values, `tab=missed`, `mby`.
- **Live check:** screenshots from a copy of the real journal (mark a missed trade on a real day) and from `pnpm demo`:
  - the Missed page;
  - a missed trade's page, with the day's trades;
  - the Analytics Missed tab;
  - the Book filter on;
  - a Playbook card.

---

## 11. Changes to the parent spec

- **§6:** the "missed trades only" fields move from `scalp_details` to `missed_details` (§3). `skip_reason` is a `skip` tag.
- **§8.4:**
  - the exit is marked by the user;
  - direction comes from the stop's first placement, and the toggle;
  - built: see this spec.
- **§9:**
  - the Analytics tabs are Overview, Scalps, Iron flies and **Missed**;
  - the Book filter gets Missed as described in §6.8;
  - the Missed opportunity KPI lives on the Missed page and tab.
