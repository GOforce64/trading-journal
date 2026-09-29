# Scalp R — Design Spec

- **Date:** 2026-09-29
- **Status:** Draft, awaiting the user's review.
- **Scope:** R for each scalp. It covers:
  - the stock price at entry, fetched and interpolated from minute bars;
  - implied volatility, solved from the entry premium;
  - the option repriced at the stop and at each target;
  - planned risk and planned reward, the R-multiple and R:R;
  - MAE and MFE;
  - **multiple profit targets**, each trimming a number of contracts;
  - typed overrides for the stock price at entry and for the planned risk.

  R shows on the trade page, live in the review strip as you drag, as an R column in the lists, and as an **Avg R** KPI.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §8.3. This is the first part of Phase 2, step 3's second half. The second part, a Scalps tab in Analytics (time of day, breakdowns with R, mistake cost) and the Playbook's per-setup stat cards, gets its own spec.
- **Builds on:**
  - the scalp review ([2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md)): `scalp_details` with its basis, stop and target, the review strip, and the draggable lines;
  - the trade chart's bar cache ([2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md));
  - move data's pattern ([2026-09-28-move-data-design.md](2026-09-28-move-data-design.md)): store only the fetched stock prices, and work everything else out on read.

---

## 1. Purpose and success criteria

A scalp is judged in R: what it made against what the stop put at risk. The user sets the stop and targets on the stock chart, so the risk in dollars has to come from repricing the option at those stock prices.

**Success:** open the Sep 28 NVDA 232.5C scalp (2 contracts, 1.06 → 1.295, +$44.74). Put the stop at 229.00, T1 at 233.00 trimming 1, and T2 at 234.50 trimming 1. The page then shows:
- the stock at entry, **230.83**, interpolated at 09:31:05;
- **IV 70.4%**, with 6 h 29 min left;
- the option at the stop, **0.54**;
- **planned risk $104.05** and **R +0.43R**;
- **planned reward $288.61** over 2 targets, so **R:R 2.8**;
- **MAE −0.12 (−0.06R)** and **MFE +2.38 (+1.30R)**.

Dragging the stop to 228.00 updates the live line in the strip as the line moves. The Scalps list shows "+0.43R", and the Dashboard shows **Avg R**.

### Out of scope
- **The Scalps tab in Analytics:** time of day, hold time, breakdowns by setup, grade, mistake and emotion with R, and mistake cost. So are the Playbook's per-setup stat cards. Both are the second part.
- **Planned against actual trims.** The sell fills already show on the chart.
- **A risk-free-rate setting.** The rate stays at a fixed 4%, which barely matters with hours to expiry.
- **MAE/MFE in R on the premium basis.** It needs option bars, and comes with the option-premium chart.
- **R for missed trades** (Phase 2, item 5).
- **A second stop,** such as moving it to breakeven after T1.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Scope | Split in two: R for each scalp first (this spec), then the scalp analytics built on it. |
| The price at a stock stop | Black-Scholes at the stop with the IV solved at entry and the same time left (the instant move), as parent spec §8.3 says. The page notes that 0DTE decay makes the real loss somewhat larger. |
| No IV to solve for | **Estimate without IV:** the price at the stop is the stop's intrinsic value plus the time value at entry. It's labelled, and a typed planned risk still overrides it. |
| The stock price at entry | **Interpolated by the second** inside the fill's minute bar: open + (close − open) × seconds ÷ 60. It can be overridden by typing. |
| Where R shows | The trade page (tiles, layout A of the mockups), a live line in the review strip, an R column in the lists, and an **Avg R** KPI now. |
| Layout | **A:** an R row of tiles under the scalp tiles, plus a compact live "Risk · R · R:R" line with the overrides in the strip. |
| Targets | **Multiple targets**, each trimming a whole number of **contracts**. Untrimmed contracts (the runner) count **at the last target**. |
| Storage | Only the fetched stock prices are stored (`scalp_prices`). IV, the prices at the stop and targets, risk, reward, R, R:R and MAE/MFE are worked out on read by one pure function in `core`, which the server and the page share. |

---

## 3. Facts this design relies on

- **Already built:**
  - `core/pricing.ts` has `bsPrice` (European, no dividends), `impliedVol` (bisection on [1%, 1000%], null within half a cent of intrinsic value or at a bound), `intrinsic`, `yearsToExpiry` (to 16:00 New York on the expiry date) and `RATE = 0.04`.
  - `scalp_details` holds `level_basis`, `stop_price` and `target_price`. The `scalp` patch merges into it, and a basis change clears the levels.
  - The chart's lines are draggable by id (`stop`, `target`). The review strip's Levels column has the stop and target fields.
  - The bar service reads cached minute bars and fetches missing finished days from Alpaca. It fetches today on its own, 16 minutes behind.
  - A synced scalp's `openedAt` is its first opening fill, to the second. A typed-in scalp's is to the minute.
  - A scalp is one long leg: calls count as long the stock, puts as short.
- **The worked example**, checked against the cached bars on 2026-09-29:
  - The 09:31 bar is o 230.78, h 232.11, l 230.71, c 231.355. The fill at 09:31:05 gives 230.828.
  - That's 388.9 minutes to 16:00. The 1.06 premium solves to IV 70.38%.
  - The option is worth 0.540 at 229.00, 2.043 at 233.00 and 2.964 at 234.50.
  - The stock traded between 230.71 and 233.21 from 09:31 to 09:46.
  - Using the minute's close instead (231.355) would give IV 62.1% and R 0.34, against 0.43 here.

---

## 4. Architecture

| Package | New or changed |
|---|---|
| `core` | `risk.ts`: `scalpRisk(...)` and its result, `stockAt(bar, at)` (the interpolation), `holdRange(bars, from, to)`. `stats.ts`: `r` on a stat trade, `avgR` and `rCount` in the summary. The patch schema's `scalp` gains `targets`, `stockEntryOverride` and `riskOverride`, and loses `targetPrice`. |
| `db` | Migration 0006: `scalp_targets`, `scalp_prices`, the two override columns, and `target_price` moved into T1 and dropped. The trades repository hydrates targets and prices, replaces targets, applies the trim rule, and clears stale prices. |
| `server` | A scalp price filler over the bar service, `POST /api/risk/fill`, and `risk` on every trade. |
| `web` | The R tile row, the live line and overrides in the strip, the target list and its lines on the chart, the R column, Avg R in the KPI strips, and calling the filler (after a sync, after a save, when a trade page opens). |

`scalpRisk` is pure and takes plain inputs, so the server (lists, Avg R) and the page (live while dragging) get the same numbers.

---

## 5. Data model (migration 0006)

- **`scalp_targets`**, one row per target:

  | Column | Type | Notes |
  |---|---|---|
  | `trade_id` | TEXT, → `trades.id` | |
  | `position` | INTEGER | 1, 2, 3…, in price order from the entry (§6.3) |
  | `price` | REAL | A stock price or an option premium, on the trade's basis. |
  | `contracts` | INTEGER | Whole contracts trimmed at this target, at least 1. |

  The primary key is (`trade_id`, `position`).
- **`scalp_prices`**, one row per scalp, written only by the filler:

  | Column | Type | Notes |
  |---|---|---|
  | `trade_id` | TEXT, primary key, → `trades.id` | |
  | `entry_price` | REAL, nullable | The stock at `openedAt`, interpolated (§7). |
  | `hold_high`, `hold_low` | REAL, nullable | The stock's range from the entry minute through the exit minute. |
  | `fetched_at` | INTEGER | |
- **`scalp_details`** gains `stock_entry_override` and `risk_override` (REAL, nullable), and loses `target_price`.
- **Moving the data:** every non-null `target_price` becomes T1 of its trade, trimming the leg's full size. This is a hand-written `INSERT … SELECT` placed before the drop in the generated migration.
- Nothing else is backfilled. The filler fetches prices as trades are opened, saved or synced.

---

## 6. The model: `scalpRisk` (in `core/risk.ts`)

### 6.1 Inputs

- **The leg:** call or put, strike, expiry, contracts (`quantity`, which must be above 0), multiplier, and the entry premium (`openPrice`, the average).
- **The trade:** `openedAt` (the entry moment), `closedAt` and `netPnl`.
- **The levels:** the basis, the stop, and the targets `[{ price, contracts }]`.
- **The overrides:** `stockEntryOverride` and `riskOverride`.
- **The prices:** `entryPrice`, `holdHigh` and `holdLow`.
- A second stop argument, `liveStop?`, and a live targets list, `liveTargets?`, let the page price a line while it's being dragged.

### 6.2 Rules

1. **The stock at entry** is `stockEntryOverride`, or else `entryPrice`. The stock basis needs it; the premium basis doesn't.
2. **IV (stock basis)** = `impliedVol({ right, price: entry premium, S: stock at entry, K: strike, T: yearsToExpiry(openedAt, expiry) })`, at the fixed 4%.
3. **The option at a stock level L:**
   - with an IV: `bsPrice(right, L, K, T, iv)`;
   - with none: `intrinsic(right, L, K) + max(0, entry premium − intrinsic(right, stock at entry, K))`. This is "estimated without IV".
4. **Premium basis:** the option at a level is the level itself.
5. **Planned risk** = (entry premium − option at the stop) × contracts × multiplier.
   - A positive `riskOverride` replaces it ("typed").
   - A computed risk of 0 or less means no risk:
     - with an IV, the stop is on the wrong side;
     - estimated without IV, the model can't price this option, and a typed planned risk is needed.
6. **Planned reward** = Σ over the targets of (option at the target − entry premium) × contracts trimmed × multiplier.
   - **Runner:** contracts no target trims add (option at the last target − entry premium) × runner × multiplier.
   - **A wrong-side target,** whose option price is at or below the entry premium, is flagged and adds nothing. The runner then counts at the last target that isn't on the wrong side.
7. **R:R** = planned reward ÷ planned risk. It's null without both.
8. **R** = net P&L ÷ planned risk, for a closed trade with a planned risk. An open trade has no R.
9. **MAE and MFE**, in stock dollars, need the hold range and the stock at entry:
   - **calls:** MAE = max(0, entry − low) and MFE = max(0, high − entry);
   - **puts:** MAE = max(0, high − entry) and MFE = max(0, entry − low);
   - **in R, on the stock basis with a stop:** ÷ |stock at entry − stop|;
   - **on the premium basis:** no R units.

### 6.3 The result

```ts
interface ScalpRisk {
  basis: "stock" | "premium";
  /** Why there's no planned risk; null when there is one. */
  problem: "no_stop" | "no_stock_price" | "wrong_side" | "cannot_price" | "not_single_long" | null;
  stockAtEntry: { price: number; typed: boolean } | null;
  iv: number | null;                 // null on premium, or when estimated without IV
  estimated: boolean;                // priced without IV
  minutesToExpiry: number;
  optionAtStop: number | null;
  plannedRisk: number | null;
  riskTyped: boolean;
  targets: { price: number; contracts: number; optionAt: number | null; wrongSide: boolean }[];
  runner: { contracts: number; atTarget: number } | null;   // atTarget: 1-based
  plannedReward: number | null;
  rewardRisk: number | null;
  r: number | null;
  mae: { stock: number; r: number | null } | null;
  mfe: { stock: number; r: number | null } | null;
}
```

- `scalpRisk` returns null for a trade that isn't a scalp.
- A scalp that isn't a single long option returns `problem: "not_single_long"` with everything else null.

### 6.4 Target order

- Targets are kept in the order the stock reaches them from the entry:
  - rising prices for a call on the stock basis;
  - falling prices for a put on the stock basis;
  - rising premiums on the premium basis.
- `position` is renumbered on every save, so T1 is always the nearest.

---

## 7. Fetching the stock prices

- **`stockAt(bar, at)`** = o + (c − o) × (the seconds of `at` into the bar's minute ÷ 60). A typed-in scalp's `openedAt` has no seconds, so it gets the bar's open.
- **`holdRange(bars, from, to)`** gives the lowest low and highest high of the minute bars from `from`'s minute through `to`'s minute, inclusive.
  - It's null unless the bar for `to`'s minute is present, because a closing minute Alpaca hasn't published yet would cut the range short.
  - The entry minute includes the seconds before the fill, so MAE/MFE can be slightly overstated. The page doesn't claim otherwise.
- **The filler,** `createScalpPriceFiller({ db, bars })`, works like move data's:
  - `fill(tradeIds?)` looks at scalps with no `scalp_prices` row, or a closed scalp with no hold range.
  - It reads the bar service's minute bars for the underlying from the entry date to the exit date (today for an open trade).
  - It writes `entry_price` when the entry minute's bar exists, and `hold_high` and `hold_low` when `holdRange` answers.
  - It returns `{ filled, missing: [{ tradeId, reason: "no_bars" | "too_recent" }], unavailable: { reason: "no_key" | "unreachable", message } | null }`, spelled out inline for the RPC boundary.
- **`POST /api/risk/fill { tradeIds? }`** runs it.
  - The web calls it after an IBKR sync (for the trades it changed), after a scalp is saved, and when a scalp's trade page opens with prices missing.
  - The chart has usually just cached those bars, so the last case costs no Alpaca request.
- **Staleness:** a patch that changes a scalp's underlying, or moves `openedAt` or `closedAt` to another minute, deletes its `scalp_prices` row in the same transaction.

---

## 8. Targets: API and rules

- **The `scalp` patch** gains the following, merged as today:
  - `targets?: { price: number; contracts: number }[]` replaces the whole list; `[]` clears it.
  - `stockEntryOverride?: number | null` must be above 0.
  - `riskOverride?: number | null` must be above 0.

  `targetPrice` is removed.
- **The server's checks:**
  - prices above 0 on the stock basis, 0 or more on premium, rounded to the cent;
  - contracts are whole numbers of at least 1;
  - Σ contracts ≤ the leg's size. Otherwise it answers 400, e.g. "The targets trim 3 contracts; the position has 2."
  - The server stores the targets in §6.4's order.
- **Switching the basis** clears the stop and every target, unless the same patch sets them (scalp-review spec §6.2).
- **The IBKR sync** never writes `scalp_targets`, the overrides or `scalp_prices`. Only an edit does, and the staleness rule covers that.

---

## 9. The trade page (layout A)

### 9.1 The R tile row

It sits under the scalp tiles.

| Tile | Value | Small print |
|---|---|---|
| Planned risk | $104.05 | "option 1.06 → 0.54 at the stop". Or "estimated without IV", or "typed". |
| R | +0.43R | "+$44.74 ÷ $104.05". An open trade reads "open". |
| R:R planned | 2.8 | "reward $288.61 over 2 targets", plus "· 1 runner at T2" when there is one |
| MAE | −0.12 | "−0.06R · stock low 230.71" |
| MFE | +2.38 | "+1.30R · stock high 233.21" |
| Model | IV 70.4% | "stock 230.83 · 6 h 29 min left". Or "stock typed", or "no IV" on premium. |

- **Under the row:** "Black-Scholes, the stock jumping straight to the stop. For 0DTE, time decay makes the real loss at the stop somewhat larger."
- **Without a planned risk,** the tiles read "—", and one line gives the reason:

  | Problem | Message |
  |---|---|
  | `no_stop` | "Set a stop in the review strip to get R." |
  | `no_stock_price` | "Fetching the stock price…", or the filler's message: no key, no bars, too recent. |
  | `wrong_side` | "The stop is above the stock at entry (230.83), so this call can't lose there." Mirrored for puts. |
  | `cannot_price` | "The model can't price this option: type the planned risk." |
  | `not_single_long` | "R needs a single long option." |

### 9.2 The review strip's Levels column

- **Stop:** as today.
- **Targets:** a list. Each row is **T1** [price] × [contracts] ✕.
  - **+ Target** opens a price field and arms the chart, like **+ Stop**. Its contracts field defaults to the contracts not yet trimmed, or 1.
  - A wrong-side target shows "on the wrong side" under its row.
  - When contracts are left untrimmed, the list ends with "1 runner, counted at T2".
- **The live line:** "Risk $104.05 · R +0.43 · R:R 2.8".
  - It's `scalpRisk` run in the page with the lines where they are right now, so it follows a drag.
  - Without a planned risk, it shows §9.1's reason instead.
- **The overrides:**
  - "Stock at entry 230.83 ✎" opens a field. ✕ goes back to the fetched price, and there's no ✕ while nothing is typed.
  - "Planned risk ✎" is typed in dollars and replaces the model. It's shown as "Planned risk $120.00 (typed) ✕".

### 9.3 The chart

- **The stop line** is unchanged.
- **Each target** is its own green dashed line labelled "T1 ×1" or "T2 ×1", draggable, with the ids `t1`, `t2` and so on. Dropping a line saves the whole target list with that price. The server reorders the list, so a dragged target can become T1.
- **The chart's line ids widen** from `"stop" | "target"` to a string. `nearestLine`, the placing hint ("Click the chart to place T2 · Esc to cancel") and the editing callbacks all take the id.

---

## 10. Lists and Avg R

- **The trades grid** (Journal, Scalps, Iron Flies) gains an **R** column, e.g. "+0.43R" or "−1.00R", coloured by sign. It reads "—" without an R.
- **Avg R** joins the KPI strips on the Dashboard and on Analytics Overview.
  - It's the mean R over the period's closed, counted trades that have an R, rounded to 0.01.
  - The small print says "over 7 scalps". With none, it reads "—".
- **In `core/stats`:** `StatTrade` gains `r: number | null`, filled from the trade's `risk.r`, and `Summary` gains `avgR` and `rCount`.

---

## 11. Errors and edge states

| Case | Behaviour |
|---|---|
| No IV to solve for | Estimated without IV (§6.2), labelled. |
| That estimate gives no risk | `cannot_price`: the page asks for a typed planned risk. |
| A stop on the wrong side, or exactly at the entry stock price | `wrong_side`, R "—". |
| A target on the wrong side | Flagged in its row, and left out of the reward. |
| Targets trimming more than the position | Refused inline. The server refuses it too, with a 400 and the reason. |
| A typed planned risk, or stock price, of 0 or less | Refused inline and by the server. |
| No stock price (no key, no bars, too recent, Alpaca down) | The reason shows in the strip and the tiles. The stock override still works. |
| An open scalp | Risk and R:R show, and R reads "open". The hold range waits for the close. |
| Editing a scalp's ticker or times | Its `scalp_prices` row goes, and the next fill fetches again. |
| A scalp opened after 16:00 on its expiry day (T ≤ 0) | `bsPrice` gives intrinsic value, IV is null, and the price is estimated without IV. |
| An iron fly | `risk: null`; no R anywhere. |

---

## 12. Testing

- **core:**
  - `stockAt`: the worked example gives 230.828, and a typed-in minute gives the open.
  - `holdRange`: the range across minutes; null without the closing minute's bar.
  - `scalpRisk`, the worked example: IV 0.7038, 0.540 at the stop, risk $104.05, R 0.430, reward $288.61, R:R 2.77.
  - The same with 3 contracts, T1 ×1, T2 ×1 and a runner at T2: reward $478.97 and R:R 3.07.
  - The premium basis; the no-IV estimate on an ITM option; `cannot_price` on an OTM option with no IV.
  - A wrong-side stop and a wrong-side target; both overrides; MAE and MFE for a call and a put; an open trade; `not_single_long`.
  - A property test: planned risk never decreases as a stock stop moves further from the entry.
  - `summarize`: `avgR` and `rCount`.
- **db:**
  - Migration 0006 turns an existing `target_price` into T1 of the full size.
  - Replacing targets; their price order; the over-trim refusal; a basis switch clearing targets.
  - The overrides.
  - `scalp_prices` and its staleness rule.
  - An IBKR re-sync keeping the targets, overrides and prices.
- **server:**
  - The filler over fake bars: the interpolation, the hold range, too recent, no bars, no key.
  - `risk` on every trade; `POST /api/risk/fill`; the 400 for an over-trim.
- **web:**
  - The R tiles and each problem's line.
  - The live line following a drag, through the chart fake.
  - The overrides.
  - Adding, removing and dragging targets.
  - The runner line.
  - The R column; Avg R on the Dashboard and Overview.
  - The seam test from the scalp review's final review, extended to targets.
- **Live check:**
  - On a copy of the real journal, the Sep 28 NVDA scalp with a 229 stop and T1 233 ×1, T2 234.50 ×1. The tiles show §1's numbers.
  - A real drag of T2 in headless Firefox updates the live line and saves.
  - Screenshots at 1280 and 1024 px.

---

## 13. Changes to other specs

- **Parent spec §6:**
  - `scalp_details` becomes `level_basis`, `stop_price`, `stock_entry_override` and `risk_override`, with targets in `scalp_targets` and fetched prices in `scalp_prices`.
  - The risk-model columns (`iv_at_entry`, `est_option_price_at_stop` and the like) are computed on read, not stored.
- **Parent spec §8.3:**
  - The underlying price at entry is interpolated by the second, not the minute's close.
  - A failed IV solve is estimated without IV, not flagged.
  - Newton-Raphson and the rate setting aren't needed.
  - Targets are a list with trims.
- **Scalp-review spec:**
  - §5 and §6.2: `target_price` is replaced by `scalp_targets`.
  - §8: the target line becomes one line per target.
  - §15 points here.

---

## 14. Open items

1. **The second part:** the Scalps tab in Analytics (time of day, hold time, breakdowns with R, mistake cost) and the Playbook's per-setup stat cards.
2. **The option-premium chart** (scalp-review spec §16, item 1), which also gives MAE/MFE in R on the premium basis.
