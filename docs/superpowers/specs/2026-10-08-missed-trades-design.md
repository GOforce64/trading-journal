# Missed Trades — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved 2026-10-08. The user made the decisions in §2 in the brainstorm, over four mockups, and approved the three design sections. They then said "proceed, you don't need me for anything, go on autopilot for now", so the written spec and the plan go ahead without a review stop. Implemented on feat/missed-trades. Plan: [2026-10-08-missed-trades.md](../plans/2026-10-08-missed-trades.md).
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
  - The entry and exit are joined by a dotted line. (Built without the shaded hold: see §13.)
- **Context markers** (the day's trades):
  - **Taken scalps:** a dimmed arrow at each one's entry and exit (`opened_at`, `closed_at`, from its single leg, as `tradeMarks` does without fills).
  - **Other missed trades:** dimmed hollow circles at their entry and exit, with a label ("Missed short −0.62R"). (Built without their dotted line: see §13.)
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

---

## 12. Live check (2026-10-08)

On a `.backup()` copy of the real journal (42 iron flies, no scalps), with the real Alpaca key, read-only. Two taken NVDA scalps were added to the copy on Oct 7 (09:36 → 10:02 long call, 10:16 → 10:31 long put, both VWAP reclaim), since the journal had none.

- **+ Missed** on the first scalp's chart opened `/missed/new?symbol=NVDA&date=2026-10-07`.
- **Two missed trades marked by clicking,** entry, then stop, then exit, on the 3-minute chart:
  - **Long,** 10:54 at 237.29, stop 236.89, exit 13:24 at 237.40: R +0.28 (0.11 ÷ 0.40), MAE −1.62R (low 236.64), MFE +1.24R (high 237.785). All match the 1-minute bars by hand.
  - **Short** (the stop clicked above the entry turned it short), 10:08 at 238.85 (that minute's high), stop 244.58, exit 10:44 at 237.76 (that minute's low): R +0.19, MAE −0.04R (high 239.08), MFE +0.22R (low 237.61). All match.
  - Setup, grade B and the Hesitated skip reason were set from the panel.
- **Day's trades:** on, the two taken scalps show as dimmed arrows and the other missed trade as "Missed long +0.28R"; off, they're gone.
- **The Missed page:** +0.47R missed opportunity, 2 of 2 would have won, avg R +0.23R against the taken scalps' +1.31R, Top reason Hesitated (1 · +0.19R). The + Missed trade popover defaults to Oct 8 after the close.
- **The Missed tab:** Took 50% (2 taken, 2 missed); by setup, VWAP reclaim took 67% (2 of 3).
- **The Book filter with Missed:** Overview's Avg R +0.77R = (1.22 + 1.40 + 0.28 + 0.19) ÷ 4, "includes 2 missed"; Net and the dollars unchanged; the Scalps tab counts 4 scalps and +$121.61.
- **The Playbook:** the VWAP reclaim card shows Missed 1, would win 100%, missed avg R +0.19R; Hesitated counts 1.
- **The Journal:** missed rows show MISSED, "—" for Net and Return, the stock R and the grade.

**Fixed from the check:**
- A click on a 3-minute candle put the point at the candle's start with a price from the whole candle's range, so the panel warned "Outside 10:54's range" on every click-placed point. The chart model now carries the 1-minute bars, and `snapToMinute` puts the point on the first minute inside the candle that traded the price, or the nearest one.
- The new missed trade's chart drew Open and Close marks at 09:30 and 16:00, from the placeholder trade that spans the session. It now passes no points, so those marks are dropped.

**Left as minors:**
- The new missed trade's page has no Day's trades, so the taken scalps only show after the first click.
- With Missed on, the Scalps tab's "R covers all 2 scalps" counts only the taken scalps, beside a Scalps KPI of 4.

---

## 13. Final review (2026-10-08)

A whole-branch Opus review (7354758..3c7bb39) found nothing Critical and two Important issues. Two of its minors were raised to the fix pass for their effect. All four were fixed test-first:
- **The Missed tab with the Book filter on Missed alone** read Took 0% and empty taken columns: it took the taken side from the Book-filtered trades. It now filters all trades itself, keeping the filter's Live and Paper, or both when neither is on (§6.6, §6.8).
- **A deleted missed trade lingered** in the Missed list, Analytics and other charts' day's trades for the 10-second stale time, and opening it again edited a deleted trade. The delete now drops the trade's cache and refreshes the lists; a failed delete says "Couldn't delete" and stays.
- **The Missed page's period** reset to Last 30 days on every Back from a trade. It's now in the URL (`?period=90|365|all`).
- **A point clicked on a sub-cent high or low** (Alpaca's IEX bars carry 237.2505) was stored rounded and then called "outside" its own minute. The range is now judged in cents, as it's shown.

**Built differently from §6.4** (the Task 8 rulings): no shaded hold band (the dotted entry–exit line marks the hold), and other missed trades on the chart have no dotted line of their own.

**Deferred minors:**
- A stale exit-time draft can be saved: after × clears the exit, typing only an exit price saves it with the old time.
- Typing a level while it's being placed doesn't end placing, so the next chart click re-places it.
- A dropped point briefly jumps back until the refetch arrives.
- With Missed on, a breakdown label only missed trades have is appended after the others, out of its dimension's order.
- Missed alone on the Scalps tab with the default Net metric draws flat $0 time-of-day and hold bars.
- The range note can say "Add an Alpaca key" when Alpaca is unreachable rather than unset.
- The server lets PATCH flip a trade between missed and taken, and POST skips the one-skip-reason check; the UI does neither.
- The new missed trade's typed time isn't range-checked ("25:00" lands on the next day).
- 400 messages show at the panel's foot, not under the field.
- The Scalps page still shows a Missed book button, which lists nothing there.
- Dragging an exit-less missed trade's entry onto an earlier day of the chart's warm-up, or clicking one on `/missed/new`, moves the trade to that day.
- The Playbook's Setups table "Trades" count includes missed trades.
- The missed trade's chart toolbar wraps "Fit trade" onto a second line.
- `/missed/new` has no Day's trades; with Missed on, "R covers all 2 scalps" counts only the taken scalps (§12).
- The test suites leave `tj-*` temp journals in /tmp (pre-existing).

---

## 14. Deferred minors fixed (2026-10-08)

All 16 of §13's deferred minors, each test-first, on the user's word ("fix the deferred minors on autopilot"):
- **The panel:**
  - a half-typed exit is forgotten once the exit is set or cleared;
  - typing the stop, target or exit being placed ends placing it, going on from the stop to an unmarked exit as a click does;
  - the server's reason for refusing a typed value shows under that field.
- **The chart:**
  - a dropped point stays where it was dropped (the save shows the missed levels and times at once);
  - a click or drag onto another of the chart's days is refused with "Place it on Sep 30", on a missed trade and on `/missed/new`;
  - the toolbar's timeframes and toggles wrap among themselves, with Fit trade and the page's buttons pinned top right.
- **`/missed/new`:** a typed time off the clock ("25:00") is refused; the day's trades show faintly.
- **The range note** names what stopped the fetch: no key, Alpaca not answering, or a failed request.
- **The server:** a trade stays missed or taken (a PATCH can't move it across or give a missed trade P&L or another strategy), and a new trade's tags follow the one-emotion and one-skip-reason rules.
- **Lists:** the Missed book button shows only where a list can hold missed trades (not on Scalps, its review queue or Iron Flies).
- **The Playbook:** the Setups table counts trades taken (`tradeCount`) apart from missed ones (`missedCount`, a new Missed column).
- **Analytics with Missed:**
  - a row only missed trades have takes its place in its dimension's order;
  - Missed alone draws its bars in R, with Net off;
  - the coverage line counts the missed trades' R ("R covers all 2 scalps and 2 of 3 missed trades").
- **Tests:** a run keeps its temp journals in a folder of its own and removes it (`scripts/vitest-tmp.ts`).

Still as built (§13): no shaded hold band, and no dotted line for other missed trades on the chart.

**Its final review** (Opus, whole branch) found nothing Critical. Three fixes, each test-first:
- the day's trades said "Click to open" on `/missed/new`, where a click places the entry; the chart now offers it only when a click opens the trade;
- a refused new exit emptied both typed fields; the draft now shows until the exit saves;
- the test run's temp setup now restores TMPDIR, TEMP and TMP, so watch mode survives a config restart.

**Still deferred:**
- the hold-range fill can be asked before a first exit's save lands (unlikely locally; the MFE line then waits for a reload);
- `testTmp.test.ts` passes only under the root config;
- `/missed/new`'s "Place it on …" note isn't cleared by a later click whose create fails;
- the month order leans on Intl's English month names.
