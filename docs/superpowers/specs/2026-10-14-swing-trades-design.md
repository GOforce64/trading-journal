# Swing trades: design

- **Date:** 14 Oct 2026. **Status:** implemented on `feat/swing-trades`. The design was approved section by section on 14 Oct 2026, and the user moved on to the plan (writing-plans) after reading the spec. Plan: [2026-10-14-swing-trades.md](../plans/2026-10-14-swing-trades.md); its deviations are in §14, the live check in §15.
- **Branch:** `feat/swing-trades`, from main b66587d.
- **The ask (14 Oct 2026):** "i want to add a swing strategy, could be a long option or a spread".
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md).
- **Builds on:**
  - the IBKR sync ([2026-09-29-ibkr-flex-sync-design.md](2026-09-29-ibkr-flex-sync-design.md)): grouping fills into trades by episode (§7), who owns which field (§5.5), the duplicate guards;
  - the trade chart ([2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md)): `DailyChart`, `dailyModel`, the bar cache and the daily bars route;
  - the scalp review and scalp analytics ([2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md), [2026-09-30-scalp-analytics-design.md](2026-09-30-scalp-analytics-design.md)): the review panel, the review queue, the Scalps tab's breakdowns, the Playbook's stat cards;
  - the keys and the palette ([2026-10-12-launcher-keyboard-palette-design.md](2026-10-12-launcher-keyboard-palette-design.md)): `useShortcut`, the trade-page keys (§6), the palette's pages.

---

## 1. Purpose and success criteria

The user trades scalps (0DTE bought calls and puts) and earnings iron flies. They now also take **swings**: a bought call or put, or a debit vertical spread, held for days or weeks. The journal has no place for them. A swing synced from IBKR today becomes a "scalp" when it's a single option, and is skipped when it's a spread. This work makes swings a strategy of their own, with their own page, list, chart and analytics.

**Success,** on a copy of the real journal and in `pnpm demo`:
- **A debit vertical synced from IBKR** becomes one SWING trade labelled "Call debit spread". Example: NVDA, long 230C and short 240C, expiring 6 Nov 2026, opened 2 Oct 2026 at 3.80 and closed 9 Oct 2026 at 7.85, with $2.90 in fees. Its page shows:
  - debit $380.00, max profit $620.00 (width 10), break-even 233.80;
  - net P&L +$402.10, which is +105.8% return on debit and 64.9% of max profit;
  - held 7 days (5 sessions), DTE at open 35.
- **A bought call held overnight** syncs as a scalp, as now. Its page says "Held overnight: a swing?". **Switch to swing** moves it to Swings, and the next sync leaves it there.
- **The chart is right:**
  - the daily and weekly candles have wicks;
  - the 230, 240 and break-even lines carry their labels on the price axis, each at its own price;
  - the entry and exit markers sit on 2 Oct and 9 Oct (and on those weeks in Weekly).
- **The Analytics Swings tab** shows the KPIs and breakdowns of §6.3, and the Swings page lists every swing.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Where swings come from | **The IBKR sync** (the paper account, the only one synced today). Live-account sync is later (§12). |
| Single option: scalp or swing? | **The user marks each one.** A bought call or put syncs as a scalp until the user switches it. The choice survives every sync. |
| Spreads | **Debit verticals only.** One long and one short leg, same expiry, same right, same size at open, with the long strike nearer the money (lower for calls, higher for puts). They're swings without being marked. Credit verticals and other shapes stay skipped as "unrecognised", as now. |
| What journaling a swing gives | Results by strategy (a Swings page, swings counted everywhere, a Swings tab); a daily chart review with a **weekly** option; the spread maths. |
| Stops, targets, R | **None** for swings. |
| Analytics | **A Swings tab** in Analytics, with KPIs and breakdowns. No mistake cost. |
| The trade page | **Layout A** from the mockups: one full-width stock chart with a Daily \| Weekly switch, then tiles, then Legs and the review panel side by side. The user asked that the real chart's labels match their price lines and that candles have wicks (the mockup had neither): §10 checks both. |
| Where the user switches | **A Scalp \| Swing switch** in the trade page's header, the **W** key, and a **"Held overnight: a swing?"** hint on scalps that crossed a close. No bulk switch. |
| How it's stored | **Approach 1:** `swing` is a third strategy, and a new user-owned column `trades.chosen_strategy` holds the user's choice. The swing maths is computed from the legs on read. Rejected: a "held overnight" flag on scalps (two fields to check for "all swings"); a stored `swing_details` table (copies of what the legs already say). |
| Live-account sync | **Later,** as its own work. Until then, a live single option can be typed with **+ New scalp** and switched to Swing. |

---

## 3. Data and the sync

### 3.1 The model (`packages/core/src/model.ts`)
- `STRATEGIES` becomes `["scalp", "iron_fly", "swing"]`.
- **`swingShape(legs)`** in a new `packages/core/src/swing.ts` returns `"long_call" | "long_put" | "call_debit_spread" | "put_debit_spread" | null`. It's the one rule used by the model, the sync and the maths:
  - **long call / long put:** one leg, bought (quantity > 0);
  - **debit spread:** two legs with the same right and expiry, quantities +n and −n, and the long strike nearer the money: below the short strike for calls, above it for puts;
  - anything else is null.
- **New field `chosenStrategy`:** `"scalp" | "swing" | null`, default null. Refinements on a new trade:
  - a `swing` trade's legs have a swing shape;
  - `chosenStrategy` is null, or the trade has one bought leg, isn't missed, and has `strategy` equal to it;
  - a missed trade stays a scalp, as now.
- **`chosenStrategy` only means something on a single bought option.** When a synced single option later becomes a vertical (legging in, §3.3), the stored value stays but is ignored everywhere: by the sync (§3.4), by the hint (§5.3) and by the switch, which isn't shown on a vertical.
- **Structure labels:** "Long call", "Long put" (as today), "Call debit spread", "Put debit spread".

### 3.2 Migration 0011
- Adds `trades.chosen_strategy` (text, null).
- The export file copies every column of each table, so the new column travels with no change to the bundle code. A bundle from an older app has no such column, so the local value stays, as the bundle merge already does for missing columns.

### 3.3 Grouping (`packages/importers/src/ibkr/group.ts`)
- **An episode that only bought** still becomes scalps, one per contract round trip.
- **An episode that opened something by selling** is checked in order:
  1. iron fly (unchanged);
  2. **debit vertical:** exactly two contracts, neither changing side within the episode, one opened by buying and one by selling, the same total opening size, and `swingShape` of the two legs is a debit spread. It becomes a candidate with `strategy: "swing"`.
  3. anything else is skipped as "unrecognised", as now. That includes credit verticals, unequal sizes and rolls inside the same expiry (§7).
- **Legging in keeps the trade:** a call bought on Monday and a further call sold on Wednesday, in the same size, form one episode, a call debit spread. A trade's id comes from its first opening fill (IBKR spec §5.4), so the trade synced on Monday as a single option becomes the spread **in place**, with its notes, grade, tags and screenshots.

### 3.4 Writing a synced trade (`packages/db/src/repositories/ibkr.ts`)
- The sync owns `strategy` (IBKR spec §5.5), **except** on a trade with one bought leg: there it writes `strategy = chosen_strategy ?? candidate strategy`, reading `chosen_strategy` from the stored row. A trade that is now a vertical is a swing whatever `chosen_strategy` says, and the stored value is left alone.
- The sync never writes `chosen_strategy`.
- **The typed-scalp duplicate guard** (IBKR spec §7) matches a hand-typed single bought option on the same contract and New York day, **whether it's a scalp or a swing**. This matters once live sync exists: a live swing typed by hand and switched won't be synced a second time.

### 3.5 The switch (server)
- `PATCH /api/trades/:id` accepts `{ chosenStrategy: "swing" | "scalp" }`. In one write, the repository sets `chosen_strategy` and `strategy` to it and bumps `updatedAt`.
- **Refused (400)** on a trade that doesn't have exactly one bought leg, and on a missed trade. The message says why: "Only a single bought call or put can be switched."
- It doesn't set `facts_edited_at`: the choice is the user's, not a broker fact. On two machines, the newer choice wins in a merge, like the user's other fields.
- Switching back writes `"scalp"`, not null, so the overnight hint (§5.3) knows the user has decided.

### 3.6 What a switch does to a scalp's review data
- The scalp's stop, targets and scalp prices (`scalp_details`, `scalp_prices`) are **kept** and not shown on a swing. Switching back shows them again.
- The review queue and the scalp R filler only take scalps (`trades.strategy = "scalp"`), so a swing drops out of both.

### 3.7 Edit
- **A single-leg swing typed by hand** opens the scalp form. Saving keeps its `strategy` and `chosenStrategy`; today the form always writes `strategy: "scalp"`.
- **A synced single-leg swing** opens the scalp form, as a synced scalp does, and saving keeps it a swing. As for any synced trade, saving changed facts sets `facts_edited_at`, and the sync stops writing it.
- **A vertical has no form,** so its Edit button is hidden. Everything the user owns on it is in the review panel.

---

## 4. The maths (`packages/core`)

### 4.1 `swingMetrics(trade, today)` in `swing.ts`
A pure function of the legs, `netPnl`, `openedAt` and `closedAt`. It returns null when `swingShape` is null, and the page then shows "—".

| Field | Rule |
|---|---|
| `shape` | `swingShape(legs)` |
| `contracts` | The long leg's quantity. |
| `debitPerShare` | The long open price, minus the short open price on a spread. |
| `debit` | `debitPerShare × multiplier × contracts`, gross before fees, like the fly's credit. |
| `width` | Spreads: the distance between the strikes. Null on a single option. |
| `maxProfit` | Spreads: `(width − debitPerShare) × multiplier × contracts`. Null on a single option. |
| `breakEven` | Calls: long strike + `debitPerShare`. Puts: long strike − `debitPerShare`. |
| `pctOfMax` | Spreads, closed: `netPnl ÷ maxProfit`, the yardstick the user uses for flies. |
| `returnOnDebit` | Closed: `netPnl ÷ debit`. It's the header's % and the lists' Return. |
| `daysHeld` | Calendar days from the opening New York day to the closing one, or to `today` while open. |
| `sessionsHeld` | `sessionsBetween(open day, close day)` from `calendar.ts`, which knows weekends and NYSE holidays. |
| `dteAtOpen` | Calendar days from the opening New York day to the expiry. |

For an open swing, the page works out an estimated return as the live estimate's net P&L ÷ `debit`, shown in the estimate style (§5.1).

### 4.2 Weekly candles (`core/chart.ts`)
- **`weeklyBars(daily)`** groups daily bars by their New York week, Monday to Friday. Each weekly candle has the first open, the highest high, the lowest low, the last close and the summed volume. Its time is its first session's.
- The current week includes today's candle, which the daily model already builds from minute bars.
- **History:** the daily bars route (`GET /api/bars/:symbol/daily?to=…`) gains an optional span. The daily view keeps its 1,095 days. The weekly view asks for **1,826 days (5 years)**, about 260 weeks. An EMA draws from its (3 × length)th close, so EMA 50 starts at week 150, and EMA 8, 20 and 50 all draw across the opening view. Both come from the same bar cache.
- **EMA 167** would need about 10 years of weekly bars, so its toggle is greyed out on Weekly, with the title "Needs more history than a weekly chart has".

### 4.3 Markers
- **Daily:** for each New York day with fills, the opening fills make one marker and the closing fills another.
  - The size `n` is the most contracts on any one leg in that group.
  - The price is the group's net cash per spread: Σ(price × quantity) over its fills, ÷ n.
  - A group that paid reads "B n @ price"; one that received reads "S n @ price". So opening a 230/240 at 3.80 reads "B 1 @ 3.80", and closing it at 7.85 reads "S 1 @ 7.85". Legging in the short 240C at 1.30 reads "S 1 @ 1.30", which is what the user did.
  - An expiry reads "expired", an exercise "exercised" and an assignment "assigned".
- **A trade typed by hand** has no fills: its open and close come from the leg prices, as `tradeMarks` does today.
- **Weekly:** the same groups merged per week, at the size-weighted average price.

### 4.4 Price lines
- **Spread:** the long strike, the short strike and the break-even.
- **Single option:** the strike and the break-even.
- They're Lightweight Charts price lines, titled "230", "240" and "BE 233.80". The library draws each title on the price axis at the line's own price.

### 4.5 Analytics (`core/swingStats.ts`, beside `scalpStats.ts`)
- **`DAYS_HELD_BUCKETS`:** same day · 1–2 · 3–5 · 6–10 · 11–20 · 21+ (calendar days).
- **`DTE_BUCKETS`:** 0–7 · 8–21 · 22–45 · 46–90 · 90+.
- **`SWING_BREAKDOWNS`:** structure, days held, DTE at open, setup, ticker, weekday opened, grade, emotion, book, month.
- **`swingSummary(closed)`:** net P&L, trades, win %, profit factor, avg return on debit, avg days held, and avg % of max over the spreads only, with how many of the swings that is.

---

## 5. The swing trade page (layout A)

### 5.1 Header
- **Left to right:**
  - the ticker and name;
  - the **shape chip** ("Call debit spread", "Long call") in a new **SWING** tone, pink: text `#f48fb1` on `#ec407a22`. Pink because violet (flies), orange (scalps), teal (live), blue (paper) and grey (missed) are taken. The colour is confirmed at the screenshot check;
  - the book;
  - the dates ("2 Oct 2026 → 9 Oct 2026");
  - the net P&L and the return on debit;
  - Edit (not on a vertical, §3.7).
- **While open,** the P&L and the return are live estimates from option quotes, in the existing estimate style, as on an open fly.

### 5.2 The Scalp | Swing switch
- **Where:** a two-button switch beside the chip, on any trade with one bought leg that isn't missed: on the scalp page and on the swing page. Not on a vertical, a fly or a missed trade.
- **W** toggles it. It joins the trade-page keys (launcher spec §6.1), so ? lists it.
- **After a switch,** the page re-renders as the other kind. A queued scalp leaves the review queue, and the queue bar's count drops by one. J/K keep following the list the user came from.
- **A failed switch** keeps the page as it was and shows the server's message under the header.

### 5.3 The overnight hint
- **Shown** at the top of a scalp's page when all of these hold:
  - it has one bought leg;
  - `chosen_strategy` is null;
  - it isn't missed;
  - either it closed on a later New York day than it opened, or it's still open after its opening day's regular close (`regularClose`, so 13:00 on a half day).
- **It reads** "Held overnight: a swing?", with **Switch to swing** and **Keep as scalp**.
- **Keep as scalp** saves `chosenStrategy: "scalp"`, and the hint never shows again for that trade.
- Synced scalps land in the review queue, so the user meets the hint while reviewing.

### 5.4 The chart
- **One chart, full width,** about 420 px tall.
- **Toolbar:** Daily | Weekly · EMA 8, 20, 50, 167 (167 greyed out on Weekly) · Volume · Fit trade.
- **Opening view:** the trade's candles with 20 candles of padding on each side in Daily, and 20 weeks in Weekly. Fit trade returns to it.
- **Daily or Weekly** is remembered in this browser with the other chart preferences (`chart/prefs.ts`). Daily is the default.
- **Price lines and markers** as in §4.3 and §4.4.
- **An open swing's** last candle is today's, built from minute bars with the usual 16-minute delay. Only the days the daily bars lack are built from minutes.
- **Candles** keep their wicks; the chart's candle style must not hide them (§9).
- **The no-key, loading and error states** are the daily chart's existing ones.

### 5.5 Tiles
- **Spread:** Debit (3.80 × 1) · Max profit (width 10) · Break-even · % of max · Held (7 days, 5 sessions) · DTE at open (6 Nov 2026).
- **Single option:** Debit · Break-even · Return on debit · Held · DTE at open.
- **While open,** % of max and Return on debit show the estimate, in the estimate style, or "—" without marks.

### 5.6 Below the tiles
- **Legs** (with marks while open) and the **review panel** side by side, as on a fly. The review panel holds setup, grade, mistakes, emotion, notes and exclude.
- **Then** Fills (on synced trades) and Screenshots.
- **Keys:** J/K, 1–5, Enter (next), S, M, E, N, X, W and ?. P and T aren't registered, since swings have no stop or targets.
- **Expiry:** an expired synced swing shows the fly's note, "IBKR books the expiry overnight: the next sync closes this trade at its expiry values." Exercises and assignments close at intrinsic value, as the sync does for any option.

### 5.7 Setups
- A setup's strategy can be **Swing**. In the Playbook's setup form, the strategy choices become Scalp, Iron fly, Swing and Any; "Both" becomes **"Any"**.
- On a swing, the setup picker lists swing setups and setups for any strategy.

---

## 6. Lists and analytics

### 6.1 Navigation and the palette
- **Swings** goes in the nav after Scalps.
- The palette gains **"Swings"** (`/swings`) and **"Analytics › Swings"** (`/analytics?tab=swings`).

### 6.2 The Swings page and the Journal
- **The Swings page** is the Journal locked to `{ strategy: "swing", taken: true }`, as Iron Flies and Scalps are.
  - There's no "+ New" button and no review tab.
  - Empty, it says "Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."
  - The % column is headed **Return** and shows return on debit.
- **The Journal** shows the SWING chip. Its "Return / % kept" column shows a swing's return on debit.
- **The strategy filter** gains Swing.
- **The Dashboard, equity curve, P&L calendar and Overview** already count every trade, so swings are in them.
- **Every table keyed by strategy** (`Record<Strategy, …>`: chip tones, labels, % headers) gains a swing entry. TypeScript names each one that's missing.

### 6.3 Analytics › Swings (`?tab=swings`)
- **Placement:** between Scalps and Iron flies. It counts closed swings in the global filter.
- **KPI strip:** Net P&L · Trades · Win % · Profit factor · Avg return on debit · Avg days held · Avg % of max ("n of N" swings are spreads).
- **Breakdowns:** one at a time with a dropdown, as on the Scalps tab, as a table (count, win %, net, avg return, PF) plus a bar chart.
  - The dimensions are `SWING_BREAKDOWNS` (§4.5); the default is structure.
  - A `by` in the URL that isn't a swing dimension falls back to structure.
- **No mistake cost,** as the user chose.

### 6.4 Playbook stat cards
- A **swing setup's** card leads with avg return on debit where a scalp setup's leads with avg R, and shows avg days held. Count, win %, net and PF are unchanged.
- A setup for any strategy keeps today's card.

---

## 7. Edge cases

| Case | What happens |
|---|---|
| Legging into a vertical | The single option's trade becomes the spread in place (§3.3). A stored `chosen_strategy` is ignored on a vertical. |
| Legging out (the short bought back, the long still held) | The episode isn't flat, so the trade stays an open spread until the long is closed too. |
| Unequal leg sizes (bought 2, sold 1) | Skipped as "unrecognised", and the sync summary names it. A trade synced before that keeps its last synced state (IBKR spec §8.1, orphans). |
| A roll inside the same expiry (230/240 closed, 235/245 opened) | Four contracts in one episode: skipped as unrecognised and named in the summary. A roll to another expiry is a different expiry group, so each part becomes its own swing. |
| A scalp in the same ticker and expiry while a vertical is open | It joins the vertical's episode, which then has three contracts and is skipped. This is the same known edge flies have (IBKR spec §7). |
| A worthless expiry | Closed at $0 at 16:20 on expiry day (IBKR spec §7). Days held counts to expiry day. |
| An exercise or assignment | The leg closes at its intrinsic value (`markPrice`). The stock it delivers is ignored, as today. |
| A credit vertical | Skipped as unrecognised, as now (§12). |
| No Alpaca key | The chart's existing no-key state. The tiles work, since they come from the legs, but an open swing has no live estimate. |
| A failed bar fetch, the 5-year weekly one included | The chart's existing error state, inside the chart only. |
| A switch on a synced trade | Doesn't set `facts_edited_at`. The next sync keeps the choice (§3.4). |
| The same trade switched on two machines | The newer `updatedAt` wins in a merge. |
| A swing opened before 18 Jan 2024 | No effect: the chart uses stock bars, which go back further. |

---

## 8. Demo data

- `pnpm demo` seeds about eight swings across its six months: long calls, long puts, call and put debit spreads, winners and losers, one still open.
- For a swing, the demo writes daily bars reaching **1,826 days** back from the trade's last day, not the 1,095 it writes for other trades, so the weekly view has its five years.
- The README gets a swing page screenshot (`docs/images/swing.png`) taken from the demo.

---

## 9. Testing

Test-first, each test failing before its code.

- **core:**
  - `swingShape`: each of the four shapes; credit verticals, unequal sizes, two rights, two expiries and three legs refused;
  - `swingMetrics`: the NVDA example's numbers (§1); a long put's break-even; an open swing's days held to `today`; days held and sessions across a weekend and across a holiday (Thanksgiving 2025); DTE at open;
  - the model's refinements: a `swing` needs a swing shape; `chosenStrategy` only on one bought leg and equal to `strategy`; a missed trade stays a scalp;
  - `weeklyBars`: a full week, a holiday week, the partial current week;
  - day and week markers: a spread opened in one day, a legged-in spread, a partial close, an expiry, a hand-typed trade;
  - `swingStats`: the summary, including "n of N" spreads; a property test that every closed swing lands in exactly one days-held bucket and one DTE bucket.
- **importers (group.ts):**
  - a debit vertical becomes a swing candidate labelled "Call debit spread" or "Put debit spread";
  - credit verticals and unequal sizes are skipped as unrecognised;
  - legging in keeps the first opening fill's trade id;
  - a buy-only episode is still scalps.
- **db and server:**
  - migration 0011 adds the column;
  - the switch PATCH: accepted on a single bought option (sets both columns, bumps `updatedAt`, leaves `facts_edited_at`); refused on a vertical, a fly and a missed trade;
  - the sync applies `chosen_strategy` to single options and never writes it; a vertical ignores it;
  - the typed-scalp duplicate guard matches a typed swing;
  - an export file round trip carries `chosen_strategy`; an older file without it keeps the local value;
  - the review queue and the R filler skip swings.
- **web:**
  - the switch and the W key, on a scalp and a swing; neither on a vertical, a fly or a missed trade;
  - the hint: closed the next day, open past the close, open past a half day's 13:00 close, not shown on a same-day scalp, and gone after Keep as scalp;
  - the tiles for a spread and a single option, closed and open;
  - Edit hidden on a vertical; the scalp form keeps a typed swing a swing;
  - the Swings page and its empty state; the SWING chip; the strategy filter;
  - the Swings tab's KPIs and a breakdown; an unknown `by` falling back;
  - the palette entries; the setup picker's filter; a swing setup's card.
- **The chart** (against the Lightweight Charts fake in `chart/testing.ts`):
  - price lines at 230, 240 and 233.80 with their titles;
  - markers on 2 Oct and 9 Oct in Daily, and on those weeks in Weekly;
  - the weekly series is the aggregated candles;
  - EMA 167's toggle disabled on Weekly;
  - the candle series created with wicks visible.

---

## 10. Live check

This is the user's "make sure the end product works".

- **The page, in headless Firefox** (headless Firefox and puppeteer-core, waiting for Google Fonts first), on a copy of the real journal with the user's Alpaca key:
  - two swings are posted to the copy through the API on real tickers and dates: a call debit spread and a long put;
  - screenshots at 1280 and 1024 px of each, in Daily and in Weekly;
  - a crop of each price axis, checked against the chart's own `priceToCoordinate` for each line's price: **every label sits on its line**;
  - **the candles have wicks**; **the markers sit on the right days and weeks**;
  - nothing overlaps or is cut off at 1024 px.
- **The sync:** a run on a copy of the real journal with the user's paper token. Nothing already in the journal changes strategy; a single option the user switched stays a swing after a second run.
- **Keys on a swing page:** W, J/K, 1–5 and ?.
- **The demo:** the Swings page, a swing page and the Swings tab, screenshotted for the README.

---

## 11. Changes to other specs

- **Parent spec:**
  - §2 glossary: a strategy is `scalp`, `iron_fly` or `swing`;
  - §6 data model: `strategy` gains `swing`, and `trades` gains `chosen_strategy`;
  - the chips line: SWING pink;
  - the nav line: Swings after Scalps.
- **IBKR spec:**
  - §1 out of scope: debit verticals are now swings;
  - §5.5: on a single bought option the sync writes `chosen_strategy ?? scalp`;
  - §7: the debit-vertical step and the duplicate guard matching typed swings.
- **Launcher spec §6.1:** W in the key table.

---

## 12. Out of scope, and later

- **Live-account sync** (the user chose "later"). The sync reads one IBKR account, the paper one. Accounts and books already allow a live account; what's missing is a second set of credentials (token, Activity and Trade Confirmation queries, start date) and running both. Until then, a live single option can be typed with + New scalp and switched to Swing.
- **Credit verticals, calendars, diagonals** and other shapes. Calendars and diagonals would need the grouping to look across expiries.
- **A swing entry form.** Single options can use the scalp form; verticals come only from the sync.
- **Stops, targets and R** for swings.
- **Mistake cost** for swings.
- **Bulk switching** from the Scalps list.
- **A position-value chart** (mockup C): the option's or the spread's daily value under the stock chart.
- **Rolls inside the same expiry** as one trade.

---

## 13. Order of work

One branch (`feat/swing-trades`) and one PR:

1. **core:** the strategy, `swingShape`, the model's refinements, `swingMetrics`, `weeklyBars`, the markers and `swingStats`.
2. **db:** migration 0011, the switch in the repository, the export file round trip.
3. **The sync and the server:** the debit-vertical grouping, `chosen_strategy` in the sync's write, the duplicate guard, the switch PATCH, the queue and the R filler.
4. **Lists:** the SWING chip and labels, the strategy filter, the Journal's Return, the Swings page, the nav and the palette.
5. **The trade page:** the header, the switch and W, the hint, the tiles, Legs and the review panel, the keys, Edit, the setup picker.
6. **The chart:** Daily | Weekly, the 5-year span, the price lines, the markers, EMA 167 on Weekly.
7. **Analytics:** the Swings tab and the Playbook's swing cards.
8. **Demo, docs and the check:** the demo's swings, the README screenshot, the other specs' changes (§11), and the live check (§10).

---

## 14. Plan deviations

1. **There is no strategy filter in the UI.** "The strategy filter gains Swing" (§6.2) means the list API's `strategy` parameter (the Swings page uses it) and the palette's strategy words ("swing", "swings").
2. **The Swings tab's breakdown is kept in `sby`**, like the Missed tab's `mby`, so the Scalps tab's `by` is untouched. An unknown `sby` is dropped rather than "falling back" (§6.3); the tab then shows its default, by structure.
3. **Every demo swing is closed** (§8 said one would be open). An open one would ask the chart for bars up to the real today, which the demo can't have without a key.
4. **The demo writes five years of daily bars for every symbol**, not only for swings. The older two years are walked backwards from the existing walk's first open, so no price the demo already made moves.
5. **Strike lines are titled `String(strike)`** ("230", "232.5"); the break-even is "BE " + `priceText` ("BE 233.80").
6. **The swing chart's load failure** reads "Couldn't load the chart: Alpaca didn't answer." with a Retry button, and the toolbar stays, so Daily still works when Weekly's fetch fails.
7. **Label alignment was checked on screenshots** (§15): Lightweight Charts' coordinates aren't reachable from the page.
8. **Tests the plan missed** were updated as they surfaced: the palette's page count (13 → 15), the chart preferences' defaults (`swingPeriod: "daily"`, plus a test that Weekly is remembered), the key tests' trade fixture (`legs: []`), the migration test's own `columns` read, and the demo's missed-trades test counting taken trades with swings.

## 15. Live check (14 Oct 2026, Fedora)

**This machine has no `secrets.json`:** no Alpaca key and no IBKR sync settings. So the two checks against real data ran as substitutes:

- **The chart, on `pnpm demo`** (synthetic bars, five years, no key needed). Screenshots at 1280 and 1024 px, Daily and Weekly, of the QQQ 407.5/417.5 call debit spread (2 Jun → 11 Jun 2026) and the SPY 402.5 long put:
  - **every label sits on its line**: the 417.5, "BE 411.27" and 407.5 title boxes and their axis labels each centred on their dotted line;
  - **the candles have wicks**, in Daily and in Weekly;
  - **the markers are on the right candles**: "B 2 @ 3.77" on 2 Jun and "S 2 @ 3.52" on 11 Jun; in Weekly, on the weeks of 1 Jun and 8 Jun;
  - EMA 167 is greyed out on Weekly, and EMA 8, 20 and 50 draw;
  - the tiles agree: 9 days and 7 sessions held, DTE 38 (10 Jul 2026), −4.44% of max (−$55.36 of $1,246), −7.34% return on the $754 debit;
  - at 1024 px nothing overlaps; the Scalp | Swing switch shows on the long put (Swing pressed) and not on the spread, whose Edit is hidden;
  - the Analytics Swings tab: 8 swings, the KPIs, and the breakdown by structure with its bars.
- **The sync, offline on a copy of the real journal** (35 synced paper scalps, 97 fills, 42 oQuants flies). The real `createIbkrSync` ran with an IBKR stand-in whose statements are empty, so it regrouped every stored fill with the new rules and applied them:
  - run 1: 35 unchanged, nothing added, updated, orphaned or skipped, and no trade changed strategy;
  - after switching the SPCX scalp to Swing, run 2: 35 unchanged, SPCX still a swing, its facts not marked edited.
- **Keys on a swing page** (headless Firefox, opened from the Swings list): W switched the long put to Scalp and back to Swing; 2 set grade B; ? listed "Scalp or swing"; J moved to the next swing.

**Still to check with real data, on a machine with the keys:** a swing's chart on real Alpaca bars, and a real paper sync bringing in a debit vertical as a swing.

**Noticed, not changed:** a closed swing's daily chart ends at its exit day, as a scalp's does (the bars are fetched up to the trade's last day), so the padding after the exit is blank. Seeing what the stock did after the exit would need the range to run past the close.
