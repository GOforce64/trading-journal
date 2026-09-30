# Scalp Analytics — Design Spec

- **Date:** 2026-09-30
- **Status:** Approved; implemented on feat/scalp-analytics. Plan: [2026-09-30-scalp-analytics.md](../plans/2026-09-30-scalp-analytics.md), whose deviations are folded in.
- **Scope:** the second part of R. It covers:
  - a **Scalps tab** in Analytics: a scalp KPI strip, R coverage, time of day, hold time, a breakdown picker, and mistake cost;
  - a **Setup** filter on the Analytics page;
  - **per-setup stat cards** on the Playbook;
  - a **backfill** that fetches the stock prices every scalp's R needs (scalp R's deferred minor #9).
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §8.3 and §9. This finishes Phase 2, step 3.
- **Builds on:**
  - scalp R ([2026-09-29-scalp-r-design.md](2026-09-29-scalp-r-design.md)): `risk` on every trade (R and why a scalp has none), `returnOnCost`, `summarize`'s `avgR`, and the scalp price filler (`POST /api/risk/fill`);
  - the scalp review ([2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md)): setups, mistake and emotion tags, grades, and the Playbook page;
  - analytics ([2026-09-27-analytics-and-dashboard-design.md](2026-09-27-analytics-and-dashboard-design.md)): the Analytics page, its URL state, the filter row, `KpiStrip`, `Section`, editable edges, and the Recharts look.

---

## 1. Purpose and success criteria

Scalp R gave each scalp its R. This part answers what the R is *for*: which scalps work. That means by time after the open, by hold time, by setup and the other dimensions, and what each mistake costs. Each is measured in R and return on cost, as well as dollars.

**Success,** over a scratch journal seeded with about 30 closed scalps that have setups, grades, tags and stops:
- **Analytics → Scalps** shows:
  - the KPI strip, with Avg R "over N of M" and Avg return;
  - a coverage line saying which scalps lack R and why;
  - the minutes-after-open and hold-time charts, switching between Net, Avg R and Win % with one toggle;
  - the breakdown table and its bars for whichever dimension is picked;
  - mistake cost, with/without, plus the avg-R dumbbell.
- **The Setup dropdown** narrows every tab to one setup, and the URL carries it.
- **The Playbook** shows a card per setup that has closed trades: Avg R large, a cumulative-R sparkline, trades, win %, net and avg return. Its "N trades →" link opens Analytics filtered to that setup.
- **A backfilled scalp:** a scalp with a stop but no stored stock price, as those reviewed before scalp R are, gets its R when the Scalps tab or the Playbook opens. Its own page never needs opening.

### Out of scope
- **A Setups tab in Analytics.** The Playbook cards stand in for it (§2), and the parent spec's tab list changes to match.
- **The Missed tab.** Missed trades aren't built yet (Phase 2, item 5).
- **CSV export**, and the rest of the parent spec's global filter bar (strategy, account and tag filters).
- **Mistake as a breakdown dimension.** Mistake cost covers it.
- **Comparing periods,** such as this month against last.
- **R for flies,** and MAE/MFE in R on the premium basis, which comes with the option-premium chart.

---

## 2. Decisions

| Question | Decision |
|---|---|
| A Setups tab | **Dropped.** The Playbook's cards cover per-setup stats, and a Setup breakdown sits in the Scalps tab. |
| How breakdowns show | **One at a time** (layout B of the mockups): a "Break down by" picker, one table, and a bar chart beside it. Everything at once would be too much. |
| Mistake cost | **With vs without, plus a dumbbell:** n · net · avg R · win % for the scalps carrying the tag and for those without it, with an avg-R dot pair on a shared axis. |
| Stat cards | **Headline and sparkline** (card B): Avg R large, cumulative R trade by trade, then trades · win % · net · avg return. |
| Where a card links | **Analytics, filtered to the setup.** So Analytics gains a Setup filter. |
| Scalps without R | Counted everywhere except in Avg R and the R columns, which say how many they cover. A coverage line names why the rest have none. |
| Hold-time buckets | < 1 min, 1–3, 3–10, 10–30, 30+. |
| The backfill | **Automatic,** once per visit to the Scalps tab or the Playbook, through the existing filler. There's no button. |
| Where the numbers are computed | **In the browser,** from the list of every trade, like Overview and Iron flies. The functions are pure and live in `core`. There's no new endpoint. |

---

## 3. Facts this design relies on

- **Already built, and in the web app's trade rows (`TradeView`):**
  - `setupId`, `grade` (A, B, C, D or F, or null), `tagIds`, `book`, and `openedAt`/`closedAt` (a synced scalp's to the second);
  - `legs` with `right`, `strike`, `expiry`, `quantity`, `multiplier` and `openPrice`;
  - `risk`: a scalp's `ScalpRisk`, with `r` and `problem` (`no_stop`, `no_stock_price`, `wrong_side`, `cannot_price` or `not_single_long`); `r` is null for an open scalp;
  - `scalpPrices`, which `needsPrices` in `review/prices.ts` reads.
- **In `core`:**
  - `summarize` returns net, wins, losses, win rate, PF, expectancy, `avgR` and `rCount`;
  - `returnOnCost(trade)` is net P&L ÷ the premium paid, and null for anything but a closed single long option;
  - `nyMinuteOfDay`, `nyWeekday`, `daysToExpiry`, `tradeSize`, `edgeBucket` and `edgeLabels`, `keptStats` (with `keptOverall`), and the `group` helper in `splits.ts`.
- **In the web app:**
  - `useAllTrades` returns every trade, excluded ones too;
  - `useSetups` and `useTags` return every setup and tag, archived ones too, with names;
  - `useFillScalpPrices` posts to the filler under the mutation key `PRICE_FILL_KEY` and refetches every trade query when it settles.
- **The filler** takes up to 1,000 trade ids per request. It answers with `filled`, `missing` (`no_bars` or `too_recent`), and `unavailable` (`no_key` or `unreachable`).
- **The real journal** has 42 flies and no scalps yet, so the live check seeds scalps into a scratch copy.

---

## 4. Architecture

| Package | New or changed |
|---|---|
| `core` | A new `scalpStats.ts`: time buckets, `scalpSummary`, `scalpBreakdown`, `mistakeCost`, `cumulativeR` and `setupCards`. |
| `web` | `ScalpsTab`, `BucketBars`, `Breakdown`, `MistakeCost` and `SetupCards`, plus a `useBackfillPrices` hook. The Analytics URL state and filter row gain the tab, the setup, the dimension, the metric and the option-cost edges. |
| `server`, `db` | No change. |

Every function in `scalpStats.ts` takes the trades the page has already filtered, so the Setup, date, book, ticker and excluded filters apply without the functions knowing about them.

---

## 5. The Analytics page

### 5.1 URL state

`AnalyticsSearch` gains these. Defaults are left out, as now:

| Key | Values | Default |
|---|---|---|
| `tab` | `"scalps"` or `"flies"` | Overview |
| `setup` | a setup id | All |
| `by` | `setup`, `ticker`, `dte`, `side`, `grade`, `emotion`, `weekday`, `cost`, `contracts`, `book`, `month` | `setup` |
| `metric` | `"r"` or `"win"` | Net |
| `costEdges` | edges like "250,500,1000" | remembered, else 250, 500, 1000 |

`parseAnalyticsSearch` keeps what's valid and drops the rest, as now. A `setup` must look like an id (letters, digits and dashes).

### 5.2 The Setup filter

- The filter row gains **Setup** after Ticker: All, then each setup that isn't archived, by name. A selected archived setup is listed too.
- `filterTrades` keeps only the trades with that `setupId`. The filter applies on every tab.
- **A setup id the journal doesn't have** (an old or hand-edited link) counts as All, which is what the dropdown shows. That's how an unknown ticker works now.

### 5.3 The tabs

The tab row reads **Overview · Scalps · Iron flies**.

---

## 6. The Scalps tab

It covers the **closed scalps** among the filtered trades. Open scalps are left out, as they are everywhere in Analytics.

### 6.1 The KPI strip

Eight tiles:

| Tile | Value | Small print |
|---|---|---|
| Net P&L | the sum of net P&L | |
| Win rate | wins ÷ scalps | |
| Avg R | the mean R of the scalps that have one, e.g. "+0.31R" | "over 31 of 38" |
| Avg return | the mean return on cost of the scalps that have one, e.g. "+8.4%" | "on premium paid" |
| Profit factor | as on Overview | |
| Expectancy | net ÷ scalps | |
| Avg hold | the mean hold (§6.3) | "median 4 min" |
| Scalps | the count | |

- **The hold reads** "45 s" under a minute, "6 min" under an hour, and "1 h 12 min" from an hour.
- **With no closed scalps,** every tile reads "—" and the tab shows "No closed scalps in this range." in place of the charts. The exception is the Scalps tile, which reads 0, as Overview's Trades tile does.

### 6.2 R coverage

A line under the strip says which scalps lack R, and why:

- "R covers 31 of 38 scalps · 5 have no stop · 2 have no stock price · 1 can't be priced". Parts that are zero are left out. With every scalp covered, it reads "R covers all 38 scalps", or "R covers the scalp" for one. Without closed scalps the line is left out.
  - **"No stop"** is the problem `no_stop`.
  - **"No stock price"** is `no_stock_price`.
  - **"Can't be priced"** is any other problem.
- **While the backfill runs** (§8), it reads "Fetching stock prices for 7 scalps…".
- **When the filler couldn't run,** its reason follows:
  - with `no_key`: "Add an Alpaca key in Settings to fetch the missing stock prices.";
  - with `unreachable`: "Alpaca didn't answer: reload to try again."

### 6.3 Time of day and hold time

Two charts side by side, each with one bar per bucket:

- **Minutes after the open:** the New York minute of the first entry minus 09:30. So 09:34:59 is minute 4.
  - The buckets are 0–5, 5–15, 15–30, 30–60 and 60+, each including its lower edge.
  - An entry typed before 09:30 falls in a **before open** bucket, shown only when it has scalps.
- **Hold time:** close − open, in minutes.
  - The buckets are < 1 min, 1–3, 3–10, 10–30 and 30+, each including its lower edge.
  - A close before the open counts as unknown, shown only when it has scalps.
- **The five main buckets always show**, so the axis never shifts. An empty one has no bar and a count of 0 under its label, e.g. "0–5 · 12".
- **A bar's label** is cut to 12 characters, e.g. "Earnings IV… · 2", so neighbours don't overlap. Its tooltip keeps the full name.
- **One toggle** above the charts, **Net / Avg R / Win %**, switches both of them and the breakdown's bars (§6.4). It's kept in the URL (`metric`).
  - **Net:** the sum of net P&L. Bars are coloured by sign and hang from a zero line.
  - **Avg R:** the mean R. A bucket with no R draws no bar.
  - **Win %:** in the accent colour, with a 50% reference line.
- **The tooltip** on a bar shows everything, e.g. "0–5 min · 12 scalps · +$820 · +0.62R over 10 · win 66.7%".

### 6.4 Break down by

- **A row of buttons** picks one dimension. It's kept in the URL (`by`).
- **One table** has the columns: the label · n · Win % · Net · Avg R · Avg return · PF.
  - Avg R reads "—" for a row with no R. Its tooltip says "over k of n".
  - Avg return reads "—" for a row without one.
- **A bar chart beside the table** has one bar per row, in the table's order, and follows the §6.3 toggle.

| Dimension (`by`) | Rows | Order |
|---|---|---|
| Setup (`setup`) | each setup's name; "no setup" | net, best first; "no setup" last |
| Ticker (`ticker`) | each ticker; past 10, the best 5, "N others", the worst 5 (as Overview) | net, best first |
| DTE (`dte`) | 0, 1, 2–7, 8+ (calendar days from the open date to the expiry) | as listed |
| Call/Put (`side`) | Calls, Puts | as listed |
| Grade (`grade`) | A, B, C, D, F, ungraded | as listed |
| Emotion (`emotion`) | each emotion tag the scalps carry; "none" | net, best first; "none" last |
| Weekday (`weekday`) | Mon–Fri, by the open date | as listed |
| Option cost (`cost`) | premium paid, bucketed by editable dollar edges | the buckets' order |
| Contracts (`contracts`) | contracts held, bucketed by Overview's contract edges | the buckets' order |
| Book (`book`) | Live, Paper | as listed |
| Month (`month`) | close month | oldest first |

- **Empty rows are left out,** and "unknown" rows come last, as Overview's splits do.
- **A scalp with two emotion tags** counts in both rows. The review UI allows one, so this is for safety only.
- **Option cost** is contracts × multiplier × entry premium, the denominator of return on cost. Its edges get an **edit** link, as the flies' Credit split has. They're remembered in the browser under their own key, apart from the credit edges, and carried in the URL (`costEdges`).
- **Contracts** shares Overview's edges and their URL key (`contractEdges`), with the same **edit** link here.

### 6.5 Mistake cost

A section under the breakdown:

- **One row per mistake tag** that at least one of the scalps carries, by name, archived tags included.
- **Two column groups:**
  - *With*: the scalps carrying the tag;
  - *Without*: the rest of the scalps in view;
  - each group shows n · Net · Avg R · Win %.
- **The Avg R column** at the end draws a **dumbbell** on a shared axis:
  - a blue dot for avg R with the tag, a gray dot for without;
  - the line between them is red when *with* is lower, green when it's higher, and gray when they're equal;
  - tick labels sit under the last row;
  - the axis runs −2R to +2R, widened to the next whole R past the largest value when one falls outside;
  - the tooltip reads, e.g., "Chased entry: −0.62R with, +0.52R without, 1.14R worse";
  - a side with no R draws no dot and no line.
- **The rows are sorted** by the *with* group's net, worst first, then by name.
- **The last row is "no mistakes":**
  - *With* is the scalps carrying no mistake tag, and *Without* is those carrying at least one.
  - It reads green when clean scalps do better.
- **A group with no scalps** (every scalp carries the tag) reads "—" throughout.
- **With no mistake tags** on any scalp in view, the section says "No mistakes tagged in this range."
- **Before the tags load,** the section reads "Loading…". If they fail to load, it reads "Couldn't load the tags.", since without tag kinds there's no telling which tags are mistakes.

---

## 7. The Playbook's stat cards

### 7.1 Which setups get a card

- **Placement:** a grid titled **Setup stats · all time**, above the Setups table, which stays as it is for editing. It shows 3 cards a row from `lg`, 2 from `md`, and 1 below.
- **One card per setup with at least one closed trade.** Both books count, excluded and deleted trades don't, and the period is all time.
- **Archived setups** get a card only while the Setups panel's **Show archived** is on. That state moves up to the page so both can read it.
- **The order:** by closed-trade count, most first, then by name.
- **With no cards,** the grid shows "Tag trades with a setup to see its stats here."

### 7.2 A card

- **The scalp card** (a setup with at least one scalp) shows:
  - the name, a strategy chip (its words from `strategyLabel` in `review/text.ts`, shared with the Setups table), and the description on one line, cut short with "…";
  - **Avg R** in large type, with "over N of M" under it (N scalps with R, M closed trades);
  - a **sparkline** of cumulative R, one point per trade with R, in close order, on a zero line. It's green when it ends at or above 0 and red below. Hovering a point shows e.g. "Sep 28 · NVDA · +0.43R · total +3.10R";
  - four smaller numbers: **Trades**, **Win %**, **Net** and **Avg return**.
- **The fly card** (a setup whose closed trades are all flies) shows:
  - **Kept** in large type: % of max profit kept overall, the Iron flies tab's number, with "of max profit" under it;
  - a sparkline of cumulative net $;
  - **Trades**, **Win %**, **Net** and **PF**.
- **Either card:**
  - With fewer than 2 points, the sparkline is left out.
  - Win %, net and trades count every closed trade in the setup.
- **The stats** spread across the card by their content, each label on one line, so a narrow card at 1024 px keeps them level.
- **The footer** reads "last Sep 28" (the newest close date, with the year when it isn't New York's current year; `SetupCards` takes `today` for that) and **"17 trades →"**. The link opens `/analytics?tab=scalps&setup=<id>`, or `tab=flies` from a fly card, over all dates.

---

## 8. The backfill

- **When:** the Scalps tab and the Playbook each call `useBackfillPrices(trades)` with every trade (`useAllTrades`), not just the filtered ones, once they've loaded.
  - It collects the scalps that `needsPrices` and sends their ids to the filler through `useFillScalpPrices`, in one request per 1,000 ids.
  - It runs **once per visit,** that is, once per mount of the tab or the page. A StrictMode double mount doesn't send twice, the same guard `useAutoFillPrices` uses.
- **Sharing the key:** it uses the same mutation key, so a trade page opened afterwards reads the same results.
- **After:** the hook's `onSettled` refetches every trade query, so R, the coverage line and the cards update.
- **Too recent:** scalps the filler calls `too_recent` are asked about again a minute later, while the page stays open, as on the trade page.
- **Nothing blocks:** the page shows its numbers throughout, and they update once the fill lands.

---

## 9. `core/scalpStats.ts`

Pure functions, tested on their own. Each takes closed scalps (or, for the cards, closed trades) that satisfy:

```ts
interface ScalpStatTrade extends StatTrade, ReturnTrade {
  book: string;
  setupId: string | null;
  grade: string | null;
  tagIds: readonly string[];
  legs: readonly { right: string; expiry: string; quantity: number; multiplier: number; openPrice: number }[];
  risk?: { r: number | null; problem: string | null } | null;
}
```

The web's `TradeView` satisfies it as it is.

| Function | Returns |
|---|---|
| `minutesAfterOpen(openedAt)` | the New York minute of the day minus 570 |
| `openBucket(minutes)`, `holdTimeBucket(minutes)` | the §6.3 labels; the five main buckets are exported in order. (`calendar.ts` already has a `holdBucket`, for flies, so the name differs.) |
| `holdMinutes(trade)` | close − open, in minutes |
| `groupStats(trades)` | a row's numbers (`GroupStats`): trades, win rate (null when empty), net, PF, avg R and R count, avg return and its count |
| `rCoverage(trades)` | the §6.2 counts: `{ total, withR, noStop, noStockPrice, cannotPrice }` |
| `scalpSummary(trades)` | `summarize`'s fields, plus `avgReturn` and `returnCount`, `avgHoldMinutes` and `medianHoldMinutes`, and `coverage: { total, withR, noStop, noStockPrice, cannotPrice }` |
| `bucketStats(trades, "open" \| "hold")` | one row per bucket: label, n, net, win rate, avg R, R count. The five main buckets are always present; "before open" and "unknown" only with scalps. |
| `scalpBreakdown(trades, by, context)` | the §6.4 rows, each `GroupStats` plus a label. `context` (`BreakdownContext`) holds the setup names, the emotion tags' names, the cost edges and the contract edges. |
| `mistakeCost(trades, mistakes)` | one row per mistake tag, `{ tagId, label, withTag, withoutTag }`, each side a `GroupStats` or null when empty (`with` is a reserved word), sorted as §6.5, plus the "no mistakes" row with `tagId: null` |
| `cumulativeR(trades)` | `{ id, closedAt, underlying, value, total }` per trade with R, in close order |
| `setupCards(trades, names)` | one card per setup with closed trades: `GroupStats` plus `kind` (`scalp` or `fly`), `kept`, the sparkline points and the last close. `names` gives the tie order. |

Breakdown rows reuse `splits.ts`'s grouping, now exported as `groupTrades` (a trade with several labels counts under each), and its ticker folding, now `foldMiddle`. So the ordering and "unknown" rules match Overview's. `risk.ts` gains `premiumPaid`, the option cost, which `returnOnCost` now uses.

---

## 10. Errors and edge states

| Case | What shows |
|---|---|
| No closed scalps in the range | "No closed scalps in this range."; the KPIs read "—". |
| A bucket or row with no R | Avg R reads "—", and no bar draws with Avg R selected. |
| The trades fail to load | The page's existing "Could not load trades" message. |
| Setups fail to load | Setup rows read "unknown setup" in place of names; nothing else changes. |
| Tags fail to load | Mistake cost reads "Couldn't load the tags." (§6.5), and every scalp falls under "none" by emotion. |
| The filler fails (throws) | The coverage line keeps its counts and adds "Couldn't fetch stock prices: reload to try again." |
| The filler has no key, or Alpaca is unreachable | The §6.2 messages. |
| A setup id in the URL that doesn't exist | Counted as All. |
| Every scalp carries a mistake tag | Its *Without* group reads "—". |
| A setup with only open trades | No card, though it's still in the Setups table. |

---

## 11. Testing

- **`core/scalpStats`, unit tests:**
  - the bucket edges: 09:30:00, 09:34:59 and 09:35:00, before 09:30, and a hold of 59 s, 60 s and 30 min;
  - the summary's avg return and hold, and the coverage counts for each problem;
  - each breakdown dimension's rows and order, with "no setup", "none" and ungraded;
  - mistake cost: a two-tag scalp in both rows, the sort, "no mistakes", and an empty *Without*;
  - cumulative R, and the cards' kind, order and numbers.
- **`core/scalpStats`, property tests** (fast-check, as `stats.property.test.ts` uses):
  - *with* + *without* = all scalps for every mistake row;
  - bucket counts sum to the scalp count;
  - cumulative R's last total equals the sum of R.
- **Web tests** (the page-test pattern; Recharts mocked, as Dashboard mocks `EquityCurve`):
  - the Scalps tab: the KPIs, the coverage line, the toggle and the picker patching the URL, and the Setup filter narrowing every tab;
  - `MistakeCost`: its rows, the dumbbell's dots and line colour, and "—";
  - the Playbook's cards: which setups get one, archived ones, the fly card, and the link;
  - `useBackfillPrices`: fires once with the ids that need prices, sends nothing when none do, and asks again after `too_recent`;
  - `parseAnalyticsSearch` with the new keys.
- **Live and visual check,** as scalp R's was, with headless Firefox screenshots:
  - seed about 30 closed scalps into a scratch copy of the journal, with setups, grades, emotion and mistake tags, and stops (a few left without, to test coverage);
  - leave some without stock prices, to watch the backfill fill them;
  - screenshot the Scalps tab (each metric, a few dimensions) and the Playbook at 1024 px and at full width.

### Live check (2026-09-30)

Over a read-only copy of the real journal (42 flies, no scalps), migrated to 0006, with the real Alpaca key. Headless Firefox took the screenshots at 1280 and 1024 px.

- **The seed:** 30 closed scalps on Sep 21–29 in NVDA, SPY, QQQ and AMD, calls and puts, mostly 0DTE. Each strike and premium was built from the stock's price at entry, read from `/api/bars`.
  - Setups: 14 ORB breakout, 12 VWAP reclaim and 4 with none.
  - Grades A–F, with a few ungraded; the emotions Calm, Rushed and Revenge.
  - The mistakes FOMO entry (8), Moved stop (6), Oversized (3) and Exited early (1).
  - Stock-basis stops on 25, and none on 5.
  - The API seeds no stock prices, so every scalp waited on the backfill.
- **The backfill:** opening Analytics → Scalps read "Fetching stock prices for 30 scalps…" at 0.9 s, then "R covers 25 of 30 scalps · 5 have no stop" 0.1 s later. The seeding had already cached the day's bars. The API then showed 25 scalps with R and 5 `no_stop`.
- **The tab:**
  - The KPIs read net +$688.00, win 50.0%, Avg R −0.08R over 25 of 30, Avg return +2.3%, PF 1.35, hold 7 min (median 3 min).
  - Net, Avg R and Win % switch every bar. Win % draws its dashed 50% line, and the 30–60 bucket's lone loser draws no bar at 0%.
  - By setup: VWAP reclaim +$968 (+0.82R), ORB breakout +$133 (−0.40R), no setup −$414 (−1.45R). The Emotion and Option cost views and the cost edges' edit link read right.
  - Mistake cost's rows run FOMO entry, Moved stop, Exited early, Oversized, no mistakes. FOMO's dumbbell runs −1.78R (blue) to +0.73R (gray), joined red; "no mistakes" is joined green.
- **The Playbook:** a card each for ORB breakout (−0.40R over 11 of 14, a falling red sparkline) and VWAP reclaim (+0.82R over 10 of 12, rising green). "14 trades →" opened `/analytics?tab=scalps&setup=<ORB's id>` with the Setup dropdown on ORB breakout and 14 scalps.
- **Fixed from the check:** at 1024 px the card's "Avg return" label wrapped onto two lines, dropping its value below its neighbours'. The stats now spread by content, with their labels on one line (6e91a18).
- **At 1024 px** nothing else overlaps. The Profit factor tile's label truncates to "PROFIT FACT…", as Overview's does.

---

## 12. Changes to other specs

- **Parent spec §9:**
  - Analytics' tabs become Overview, Scalps and Iron flies, with Missed to come.
  - The Setups tab is dropped in favour of the Playbook's cards.
  - Time of day, the breakdowns and mistake cost point here.
  - The global filter bar gains Setup (on the Analytics page).
- **Parent spec §8.3:** minutes after open, hold time and option cost are built here.
- **Scalp-R spec §14:** item 1 is done here, and the backfill closes deferred minor #9.
- **Scalp-review spec §10:** the Playbook's stat cards are built here.
- **README:** the Scalps tab and the Playbook cards.
