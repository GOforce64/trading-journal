# Analytics and Dashboard — Design Spec

- **Date:** 2026-09-27
- **Status:** Approved 2026-09-27; plan: [2026-09-27-analytics-and-dashboard.md](../plans/2026-09-27-analytics-and-dashboard.md)
- **Scope:**
  - The Dashboard: the current period at a glance.
  - The Analytics page, with Overview and Iron flies tabs.
  - A pure statistics module and a NYSE trading calendar in `core`.
  - The trade lists and trade page switch from "Return on risk" to "% kept".
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md). This spec details its §9 for iron flies (see §11).

---

## 1. Purpose and success criteria

The journal holds 42 iron flies, but it can't yet say why they are down $2,273, or what to change. This work answers four questions from the trades already logged:

1. **Where does the money go?** Before fees against fees, what's won against what's lost, and the few trades that decide the result.
2. **What works?** Results split by weekday, days to expiry, size, hold time, month, ticker, credit and wing shape, all visible at once.
3. **How am I trending?** The equity curve with its drawdown, P&L by month, and a rolling expectancy.
4. **How much credit do I keep?** Winners and losers are both measured against max profit, the credit after fees.

Success means:

- Opening the app shows how this month is going: KPIs, curve, calendar, and the open and recent trades.
- On Analytics, every number above is on screen for any date range, book and ticker. The view lives in the URL, so a link reproduces it.
- Every statistic is defined once in `core`, tested against hand-worked numbers, and never stored.

### Out of scope

- **Implied and actual move, IV crush, and P&L by move ratio.** No trade has that data yet. The next sub-project fills it in from Alpaca stock prices, together with a settle-at-expiry helper, and those charts arrive then. This spec leaves a placeholder for them.
- **Setups, mistake and emotion tags, the Playbook, and mistake cost.** They come in the sub-project after that. Their filters and splits come with them.
- **The global filter bar** across Journal and Iron Flies. The Journal keeps its Book toggle.
- **The Scalps, Missed and Setups tabs, and time-of-day analytics.** These are Phase 2.
- **CSV export of Analytics tables** (parent spec §9). It's deferred.
- **Storing split edges in the database.** They are display preferences (§7.4).

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Pages | Both the Dashboard and Analytics, sharing the KPI strip, equity curve and calendar components. |
| Where stats are computed | In the browser: a pure `core/stats` module runs over the trade list. One definition per statistic, easy to test, and it will work unchanged in the Phase 3 in-browser demo. A server endpoint and SQL aggregation were rejected, because per-trade fly metrics are computed in TypeScript and the data is only hundreds of trades. |
| Which trades count | Closed trades only. Each belongs to the day, week and month it **closed**, in New York time. Excluded and deleted trades are removed first, unless "include excluded" is on. |
| Filters | A filter row on Analytics only: dates, book, ticker, include excluded. It lives in the URL. |
| Dashboard period | Opens on the current month. The switch offers Week / Month / Year / All, with ‹ › to step. |
| Dashboard layout | KPIs, then a full-width equity curve, then the calendar beside the Open and Recent trades (mockup A). |
| Breakdowns | All splits at once: a grid of small tables with net bars (mockup B), not one table with a dimension picker. |
| Iron fly yardstick | **Max profit, not max loss.** Winners keep, and losers lose, a share of max profit. The user judges flies by the credit collected, so max loss appears only as reference on the trade page. |
| Lists and trade page | "Return on risk" becomes **"% kept"**: net P&L ÷ max profit. |
| Credit and contract splits | The user sets the edges, because credits and sizes grow as the account compounds. The edges are remembered per browser and also carried in the URL. |
| Hold time | Counted in NYSE sessions, with holidays computed by rule. The buckets follow the strategy: overnight, one full day, or over the weekend. |
| Charts | TradingView Lightweight Charts 5.2 for the equity curve, with the drawdown in its own pane. Recharts 3 for the kept-% histogram, the month bars and the rolling line. The calendar and split bars are plain CSS. |

---

## 3. What the data holds today

Read from a copy of the real journal on 2026-09-27:

- 42 iron flies, all in the paper book, opened 2026-07-16 to 2026-09-23. 41 are closed. BB is open, and expired on 2026-09-25.
- Net −$2,273.24 on the 41 closed trades: 22 wins and 19 losses. Before fees −$1,855.00, fees $418.24. Max drawdown −$4,867.40, from the +$1,527 peak on Aug 13 to the low on Aug 28.
- The three largest losses add up to −$4,213: CRM −$2,324, CRWD −$1,128 and BULL −$761.
- Winners keep 32% of max profit on average; losers lose 35%. Across all trades, −10% of the total max profit on offer was kept.
- No grades, setups or tags. Notes on 31 trades.
- No earnings date, implied move, actual move or IV on any trade. That's why the move charts wait for the next sub-project.
- One trade has no call wing (a 1-wing fly). The server returns no `metrics` for it today, so its max profit must come from `core` (§5.3).

These numbers double as a sanity check for the finished pages.

---

## 4. Architecture

```
GET /api/trades?all=true&includeExcluded=true   (existing route; `all` is new)
        │  every trade, with legs and fly details
        ▼
useAllTrades()  ── one TanStack Query, shared by Dashboard and Analytics
        │
        ├─ filter in the browser: books, ticker, date range on close date, excluded
        ▼
@tj/core stats (pure)  ── KPIs, series, splits, kept %
        │
        ▼
Dashboard / Analytics components  ── KPI strip, equity curve, calendar, split grid, charts
```

- **One server change.** The list route already returns legs and `ironFly` details, but it caps lists at the newest 500 trades. It gains `all=true` so Analytics never quietly leaves trades out. Filtering in the browser makes filter changes instant, and both pages share one cached copy.
- **Freshness:** queries are fresh for 10 s app-wide (`staleTime` in `main.tsx`). Edits and imports already invalidate `["trades"]`; the trade page's grade and exclude changes now do too.
- **Open trades** on the Dashboard reuse the list code: 60-second option quotes → `closeEstimate`, or `EXPIRED · add exits`.

---

## 5. `packages/core`

### 5.1 `stats.ts`: headline numbers and series

Everything works on a minimal trade shape, `StatTrade`: `openedAt`, `closedAt`, `netPnl`, `fees`, `underlying`, legs (`expiry`, `quantity`) and the optional fly details. So `core` does not depend on the server's types.

| Statistic | Definition |
|---|---|
| Win / loss / scratch | net P&L > 0, < 0, = 0 |
| Win rate | wins ÷ all closed trades (scratches count in the denominator) |
| Profit factor | gross wins ÷ \|gross losses\|. `Infinity` with wins and no losses, `null` with neither. |
| Expectancy | mean net P&L per trade |
| Avg win / avg loss | mean net P&L of the winners, and of the losers |
| Equity series | cumulative net P&L in close-time order, starting at $0 |
| Max drawdown | the largest drop from a running peak of the equity series, with the peak starting at $0. Always ≤ 0. |
| Drawdown series | equity minus its running peak at each point (≤ 0), for the underwater pane |
| Daily P&L | net P&L and trade count per New York close date |
| Monthly P&L | net P&L and trade count per New York close month |
| Rolling expectancy | the mean net P&L of the last 10 trades, at each trade from the 10th on |
| Where the money goes | before fees (Σ net + Σ fees), fees, net; won $ and count; lost $ and count; the 3 largest losses |

### 5.2 Splits

A split groups trades by a dimension and reports, per group, the trade count, wins, win rate, net and profit factor. **The groups of one split always add up to the total net.** A split leaves out buckets that have no trades.

| Split | Key | Buckets |
|---|---|---|
| Weekday opened | New York weekday of `openedAt` | Mon–Fri |
| Days to expiry | calendar days from the New York open date to the earliest leg expiry | 0–1 · 2–7 · 8–14 · 15+ · unknown |
| Contracts | fly contracts (for other trades, the largest leg quantity) | user edges, default `2, 4, 6` → 1 · 2–3 · 4–5 · 6+ |
| Hold time | §5.4 | same day · overnight · 1 full day · weekend · longer · unknown |
| Month | New York close month | one row per month |
| Ticker | underlying | every ticker by net when there are 10 or fewer; otherwise the top 5, one "N others" row, and the bottom 5 |
| Credit (flies) | gross credit: credit per share × contracts × 100 | user edges, default `250, 500, 1000` → < $250 · $250–500 · $500–1,000 · $1,000+ |
| Wings (flies) | from the fly details | balanced · broken · 1-wing |
| Wider wing width (flies) | the wider of the put and call wing, in points | ≤ 2.5 · 2.5–5 · 5–10 · 10+ · 1-wing |

**Edges.** Each edge starts a new bucket. Edges `a, b, c` give: below `a`; `a` up to `b`; `b` up to `c`; `c` and above. Valid edges are one or more positive numbers in increasing order.

### 5.3 Credit kept (iron flies)

- `flyMaxProfit(creditPerShare, contracts, fees, multiplier = 100)` = credit per share × contracts × multiplier − fees. `ironFlyMetrics` uses it too, so there is one formula. It needs no wing, so 1-wing flies have a max profit.
- **% kept** = net P&L ÷ max profit. It's `null` when max profit ≤ 0 (fees at least the credit); such trades are left out of kept statistics and counted in a note.
- **Winners keep:** the mean and median % kept over winners.
- **Losers lose:** the mean and median of −% kept over losers, shown as a positive share.
- **Kept overall:** Σ net ÷ Σ max profit, over the trades with a max profit.
- **Histogram bins:** below −150%, then 25-point bins from −150% to 100%, with 100% in the last bin. Each bin lists its trades.

### 5.4 `calendar.ts`: NYSE sessions and hold time

- **Holidays are computed by rule,** not listed, so nothing expires:
  - New Year's Day; Martin Luther King Jr. Day (3rd Monday of January); Washington's Birthday (3rd Monday of February);
  - **Good Friday** (from the Easter date); Memorial Day (last Monday of May); Juneteenth; Independence Day;
  - Labor Day (1st Monday of September); Thanksgiving (4th Thursday of November); Christmas.
  - A holiday on a Saturday is observed on the Friday before, and one on a Sunday on the Monday after. One exception: New Year's Day on a Saturday is not observed on the prior Friday, as on the NYSE.
- **A short exceptions list** covers one-off closures. It starts with 2025-01-09, the national day of mourning.
- `isTradingDay(date)` is true for a weekday that is not a holiday.
- **Sessions held:** the number of trading days after the New York open date, up to and including the New York close date.

| Sessions | Condition | Bucket |
|---|---|---|
| 0 | — | Same day |
| 1 | a Saturday lies between the open and close dates | Weekend (e.g. Fri → Mon, or Fri → Tue over Labor Day) |
| 1 | closed before 12:00 New York time | Overnight |
| 1 | closed at 12:00 New York time or later | 1 full day |
| 2 or more | — | Longer |
| — | close before open, or a date missing | unknown |

---

## 6. Dashboard (`/`)

- **Period bar.**
  - Week (Monday to Sunday) / Month / Year / All, with ‹ › to step by one period (hidden for All).
  - URL: `/?period=month&at=2026-09-27`. `at` is any date inside the period, and defaults to today in New York.
- **KPI strip** (6): net P&L, win rate, profit factor, expectancy, trades, and max drawdown within the period.
- **Equity curve** of the period, starting at $0, with its drawdown pane.
- **Calendar** of one month, Monday to Friday, plus a week-total column:
  - It shows the period's last month, or today's month when the period includes today. Its own ‹ › step months.
  - Each day shows its net and trade count, tinted green or red. Holidays are dimmed, with the holiday's name on hover.
  - Clicking a day lists that day's closed trades under the calendar, each linking to its trade page.
- **Open trades:** every open trade, in any period, with its estimate, or `EXPIRED · add exits`.
- **Recent trades:** the last 5 closed in the period.

---

## 7. Analytics (`/analytics`)

### 7.1 Filter row and URL

Everything below lives in the URL through TanStack Router search parameters, validated with zod. A bad value falls back to its default.

| Parameter | Values | Default |
|---|---|---|
| `tab` | `overview`, `flies` | `overview` |
| `from`, `to` | `YYYY-MM-DD`, inclusive, on the close date | unbounded |
| `books` | any of `live`, `paper` | both |
| `ticker` | a traded underlying | all |
| `excluded` | `1` to include excluded trades | off |
| `creditEdges`, `contractEdges` | comma-separated numbers | the remembered edges, else the defaults (§5.2) |

The Dates control offers All time, This month, Last month, Last 90 days, This year and Custom (two date fields). Book is a pair of toggles, one of which must stay on. Ticker is a dropdown of the tickers in the journal.

### 7.2 Overview tab

- **KPI strip** (7): net P&L, win rate, profit factor, expectancy, avg win / avg loss, trades, max drawdown.
- **Equity curve** of the filtered trades, with its drawdown pane.
- **Where the money goes:**
  - bars for before fees, fees and net;
  - bars for won (count) and lost (count);
  - the 3 largest losses, with date, ticker, net and % kept;
  - a line comparing them with the net result, e.g. "The 3 largest losses are 1.9× the whole net loss".
- **Trend:** P&L bars per month, labelled with the trade count, and the rolling 10-trade expectancy line with its current value.
- **Splits grid** (6): Weekday opened, Days to expiry, Contracts (edges editable), Hold time, Month, Ticker.
  - Each row shows the bucket, the trade count, the net and a bar.
  - Hovering a row shows its win rate and profit factor.

### 7.3 Iron flies tab

- **KPI strip** (5): avg credit, avg max profit, winners keep (with median), losers lose (with median), kept overall.
- **% of max profit kept**: a full-width histogram (§5.3). Winners are green right of 0, losers red left of 0, and hovering a bar lists its trades.
- **Fly splits** (3): Credit (edges editable), Wings, Wider wing width.
- **Move charts placeholder:** "Implied vs actual move · IV crush · P&L by move ratio". It explains that these fill in once the move data exists, and counts the trades that have it (0 today).

### 7.4 Editing split edges

- Credit and Contracts panels carry a small **edit** link. It opens an inline field such as `250, 500, 1000`.
- **Save** validates the edges (§5.2), writes them to the URL and to `localStorage`, and redraws the split. **Reset** restores the defaults.
- An invalid entry shows an inline error and changes nothing.
- The URL wins over `localStorage`, so a shared link shows its own edges.
- Edges are per-browser display preferences: they are not in the database and don't travel with export and merge.

---

## 8. Lists and trade page

- The Journal and Iron Flies lists replace the **Return on risk** column with **% kept**. It's computed with `flyMaxProfit`, so the 1-wing trade has a value. Non-fly trades and open trades show "—".
- The trade page replaces its **Return on risk** tile with **% kept**. Max loss stays in the page's details, as reference only.

---

## 9. Charts

- **Equity curve** (Lightweight Charts 5.2, in one wrapper component):
  - The equity line is in pane 0. The drawdown is in pane 1, as a baseline series at $0, which fills between $0 and the line.
  - Times are close times in seconds. Trades closing in the same second merge into one point, since the library requires strictly increasing times.
  - A $0 point one second before the first close starts the line.
  - Axis labels and the crosshair show New York dates. Colours come from the Terminal palette.
  - The TradingView attribution logo stays on, as its license asks.
  - With fewer than 2 points, a message replaces the chart.
- **Recharts 3:**
  - the kept-% histogram and the month bars (`BarChart`), and the rolling expectancy (`LineChart`);
  - tooltips styled to match the app.
  - The move scatter in the next sub-project will use it too.
- **CSS only:** the calendar grid and the split bars.
- **Loading:** the Analytics page is split off and loads with its charts on first visit, so the Journal's bundle does not grow.

---

## 10. Empty and edge states

| Situation | Behaviour |
|---|---|
| No closed trades in the filter or period | KPIs show "—". The curve, splits and charts say "No closed trades in this range". |
| Fewer than 10 closed trades | The rolling line says "Needs 10 trades". |
| Wins and no losses / no trades | Profit factor shows "∞" / "—". |
| Max profit ≤ 0 | Left out of kept numbers, with a count in a note under the KPIs. |
| No leg expiry | Days to expiry "unknown". |
| Close before open, or a date missing | Hold time "unknown". Nothing throws. |
| Bad URL parameters | Ignored; defaults are used. |
| Bad edges typed | Inline error; nothing saved. |
| Fewer than 2 equity points | A message instead of the chart. |
| Open-trade estimates without a key | As in the lists: nothing shown. |

---

## 11. Changes to the parent spec

- §9: a pointer to this spec. It also records the decisions that refine it:
  - iron flies are measured against max profit;
  - breakdowns show all splits at once;
  - Analytics filters live on the page for now, not in a global bar;
  - CSV export is deferred.
- §9, Definitions: add win rate (scratches in the denominator), max drawdown (peak starts at $0), and % kept.
- §10: the Dashboard layout (curve on top).
- §13, Phase 1 item 7: dashboard, calendar, equity curve and breakdowns are done by this spec. The move charts move to the next sub-project.
- §16, item 5: Lightweight Charts attribution is resolved by keeping the logo on.

---

## 12. Testing

- **`core/stats`**: table-driven tests on a hand-worked 8-trade fixture, with literal expected values for:
  - every KPI, the equity and drawdown series, and daily, monthly and rolling values;
  - each split, including the edges;
  - kept %, including a 1-wing trade and a trade with max profit ≤ 0.
- **`core/calendar`**:
  - every NYSE holiday for 2024, 2025 and 2026 against the published dates (Good Friday included), weekend observance, and the 2025-01-09 closure;
  - hold-time buckets: same day; overnight at 09:50; 1 full day at 12:00 exactly and at 15:44; Fri → Mon; Fri → Tue over Labor Day; Wed → Fri over Thanksgiving counts as one session; longer; close before open.
- **Properties (fast-check, new dev dependency of `core`):**
  - for random trade lists: each split's groups sum to the total net;
  - the equity series ends at the total net;
  - max drawdown is ≤ 0 and no lower than the sum of the losses;
  - wins + losses + scratches = trades;
  - % kept is `null` exactly when max profit ≤ 0.
- **Web (Vitest + Testing Library):**
  - the filter row and tabs update the URL, and the numbers follow (book toggle, ticker, date preset);
  - a bad URL value falls back;
  - the edge editor: saving updates the URL and `localStorage`; a bad entry shows an error; Reset restores the defaults; the URL wins over `localStorage`;
  - Dashboard: period switch and ‹ ›, the calendar's month stepping, a day click listing its trades, and open trades showing `EXPIRED · add exits`;
  - lists and the trade page show "% kept", including for the 1-wing trade.
  - Charts are tested through the data handed to them, since jsdom has no canvas.
- **Visual check** with a stand-in server over a copy of the real journal, at 1280 and 1024 px. The numbers in §3 should appear.
- Lint, typecheck, build, and CI on Ubuntu and Windows.

---

## 13. Open items

1. **Bundle size.** Lightweight Charts and Recharts together add roughly 150 KB gzipped. Confirm in the build that splitting off Analytics keeps the first load close to today's 143 KB gzipped plus Lightweight Charts, which the Dashboard needs.
2. **New York time on the chart axis.** Resolved while planning. Lightweight Charts has no timezone option. The documented way is `timeScale.tickMarkFormatter` and `localization.timeFormatter`, formatting with `Intl` in `America/New_York`.
