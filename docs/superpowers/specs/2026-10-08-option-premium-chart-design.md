# Option Premium Chart — Design Spec

- **Date:** 2026-10-08
- **Status:** Draft, awaiting the user's review.
- **Scope:** the option-premium chart that scalp review and the trade chart deferred. It covers:
  - Alpaca's 1-minute **option bars**, cached like stock bars and served by a new route;
  - a **Stock | Option** switch on a scalp's intraday chart, with the contract's candles, fills at their prices, and the toolbar's overlays;
  - **premium stops and targets** placed and dragged on the Option view, and a stock-basis scalp's levels shown there as estimates;
  - **premium MAE and MFE**, from the contract's range over the hold.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md).
- **Builds on:**
  - the trade chart ([2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md)): the bars cache, the bar service, `IntradayChart`, `intradayModel` and the toolbar. This is its §13 item 1;
  - the scalp review ([2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md)): the stock or premium basis, draggable lines and `useLevels`. This is its §16 item 1, with the probe facts quoted in §3 below;
  - scalp R ([2026-09-29-scalp-r-design.md](2026-09-29-scalp-r-design.md)): `scalpRisk`, the R tiles, the scalp price filler and `holdRange`.

---

## 1. Purpose and success criteria

The user's stops and targets are on the stock price for now, "but in the future I might switch to the options premium chart, so I want functionality for both" (2026-09-29). The Premium basis already exists, and R already works on it. But its levels can only be typed, and the strip says "Premium levels aren't drawn yet: there's no option chart." This spec gives the Premium basis its chart, and gives every scalp a view of how the contract itself traded.

**Success,** on a copy of the real journal with the user's Alpaca key:
- A scalp's page has a **Stock | Option** switch. The Option view shows the contract's 1-minute candles (or 3m/5m), with "B 2 @ 1.06" sitting at 1.06. The EMAs, VWAP, PD levels and volume come from the contract's own bars.
- On a **Premium** scalp, the page opens on the Option view. **+ Stop** places a stop with a click on it, and the stop can be dragged, exactly as stock lines are today. The R tiles follow.
- On a **Stock** scalp, the Option view shows the stop and targets as faint "≈ STOP" and "≈ T1" lines, at the option prices the R tiles compute.
- A closed Premium scalp's **MAE and MFE** tiles read in option dollars and in R, such as "−0.42" over "−0.78R · option low 0.64".
- For a scalp from today, the Option view says how far behind the option data is, and when the first bars will arrive.

### Out of scope
- **Iron flies.** A four-leg price built from thin strikes' bars would be mostly gaps. Flies keep the stock chart alone.
- **Live option candles.** The free plan's latest quotes are live, but its bars run about 70 minutes behind (§3). Nothing here builds candles from quotes.
- **Premarket and after-hours.** Options trade in the regular session only.
- **Contracts before 2024.** Alpaca has no option bars that old.
- **A daily option chart.** The daily chart beside the intraday one stays the stock's, in both views.
- **MAE and MFE in the analytics.** No analytics chart or table uses them yet. They stay on the trade page's tiles.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Where the option chart goes | **A Stock \| Option switch** on the intraday chart, with one view at a time. The daily chart stays beside it, unchanged. |
| Which view a page opens on | **The scalp's basis.** A Premium scalp opens on Option. Changing the basis flips the view. The user can flip the view freely, and that choice isn't saved. |
| Overlays on the Option view | **The toolbar's**: EMAs, VWAP, PD levels and volume, all from the contract's bars. PM levels are greyed out, since options don't trade premarket. |
| Minutes with no trade | **Left empty,** not filled with flat candles, so the time axis stays even and a thin strike shows its gaps. |
| Fills | **At their prices** on the Option view. On the Stock view they stay above and below the candles. |
| Lines on the Option view | **Premium basis:** the real stop and targets, draggable. **Stock basis:** read-only "≈" lines at the option prices `scalpRisk` estimates. |
| Where the bars come from | **Approach A:** the existing `bars`/`bar_days` cache and bar service, keyed by the contract's code. Option-specific tables (B) and no cache (C) were turned down. |
| Premium MAE/MFE | **Yes.** On the Premium basis they come from the contract's range over the hold, in R against the premium stop. |
| Whose option range is fetched | **Every closed scalp's,** not just Premium ones, so a basis switch needs no fetch. That's one request per scalp, cached for good. |

---

## 3. Facts this design relies on

- **Probed on 2026-09-29 with the user's key** (scalp-review spec §16):
  - **The free plan serves historical 1-minute option bars** at `GET https://data.alpaca.markets/v1beta1/options/bars`. NVDA 232.5C of Sep 28 had 387 of 390 regular-session minutes, in 1.6 s. The 09:31 bar (0.97–1.53) holds the 1.06 buy, and the 09:46 bar (1.10–1.32) holds the last sell.
  - **Regular hours only:** 09:30–16:00, or to 16:15 for SPY.
  - **Thin strikes are sparse:** the far out-of-the-money 245C had bars in 79 of 390 minutes.
  - **History starts in 2024:** a Mar 2024 SPY contract returns bars, and a Mar 2023 one returns none.
  - **About 70 minutes behind, not 15:** a request ending within roughly the last 65–75 minutes is refused outright, with a 403 reading "OPRA agreement is not signed", even for an older contract.
- **To confirm in the plan's first task:** the reply's shape is the stock endpoint's, `{ bars: { <contract>: [{ t, o, h, l, c, v, … }] }, next_page_token }`, and paging and the 10,000 limit work the same.
- **Already built:**
  - `bars` and `bar_days` store rows by `symbol` and `timeframe`. A contract code such as `NVDA250926C00232500` can't clash with a ticker. Only finished days are stored, and empty days are recorded so they're never asked for again.
  - `createBarService().minute()` reads the cached days, fetches the missing ones in one request, and fetches today separately without storing it. `alpacaHistory` pages through the stock bars endpoint.
  - `occSymbol(contract)` in `core/marks.ts` builds a contract's code from its underlying, expiry, right and strike. `CONTRACT` in `market-data/options.ts` is Alpaca's pattern for one.
  - `intradayModel(bars, trade, minutes, emaLengths)` builds candles, EMAs, VWAP, the PM and PD levels, markers and the opening window. `IntradayChart` draws that model, along with `lines` and `editing` for the review's draggable levels.
  - `useLevels` serves the strip and the chart. It draws lines only on the stock basis and turns placing off on premium. `parsePrice` allows 0 on the premium basis.
  - `scalpRisk` prices a premium stop and targets directly: `optionAtStop`, and each target's `optionAt`. On the stock basis it reprices them through Black-Scholes. Its `mae` and `mfe` are `Excursion { stock, r }`, from `scalpPrices.holdHigh`/`holdLow`, with R only against a stock stop.
  - `holdRange(bars, from, to, complete)` gives the high and low from the entry minute through the exit minute. It returns null until the bars reach the exit minute, unless they're complete.
  - The scalp price filler (`POST /api/risk/fill`) finds gaps with `missingScalpPrices`, stores them with `setScalpPrices`, and answers `filled`, `missing` (`no_bars` or `too_recent`) and `unavailable`. `staleScalpPrices` drops a scalp's prices when its underlying or times are edited.
  - `lightweight-charts` 5.2.1 has price-positioned markers: `position: "atPriceTop" | "atPriceBottom" | "atPriceMiddle"` with a `price`.
  - `regularClose(date)` handles half days.

---

## 4. Architecture

| Package | New or changed |
|---|---|
| `core` | `OPTION_DELAY_MS` (80 minutes), `OPTION_BARS_SINCE` (`"2024-01-01"`), and `optionClose(date)` (the regular close plus 15 minutes). `scalpRisk`'s premium excursions, with `Excursion.stock` renamed `move`. |
| `market-data` | `optionMinuteBars(contract, start, end)` on the history client, and `optionTooRecent(error)` for the OPRA 403. |
| `db` | Migration 0007: `scalp_prices.option_high` and `option_low`. `setScalpPrices` and `missingScalpPrices` learn the option range. `staleScalpPrices` also drops prices when the contract changes. |
| `server` | `optionMinute(contract, from, to)` on the bar service, `GET /api/bars/option/:contract`, and the filler fetching each closed scalp's option range. |
| `web` | `useOptionBars`; the view switch in `TradeCharts` and `ChartToolbar`; price-positioned markers and empty minutes in `IntradayChart`; `useLevels` drawing and placing per view; the premium MAE/MFE text in `riskText` and `prices.ts`. |

The view state lives in `ScalpWorkspace`, which already joins the chart and the strip. `TradeCharts` takes it as props, so the basis switch and + Stop can flip the view.

---

## 5. Option bars

### 5.1 The Alpaca client
- `optionMinuteBars(contract, start, end)` asks `/v1beta1/options/bars` for 1-minute bars from `start` to `end` (epoch ms), oldest first, 10,000 a page, following `next_page_token`. It shares the stock client's page schema and paging.
- **An unknown contract** (a 400 that says so, or no key for it in the reply) returns `[]`.
- **`optionTooRecent(error)`** is true for a 403 whose message mentions the OPRA agreement. Callers treat it like the stock delay: no bars yet, not a failure.

### 5.2 The bar service: `optionMinute(contract, from, to)`
It mirrors `minute()` (trade-chart spec §6), with these differences:
- **The cache** is keyed by the contract's code, timeframe `1m`.
- **Days before `OPTION_BARS_SINCE`** are never asked for. If the whole range is before it, the answer is `unavailable: { reason: "no_bars", message: "No option bars before 2024." }`.
- **Finished days:** the missing ones are fetched in one request, ending at the midnight after the last of them or at now − `OPTION_DELAY_MS`, whichever is earlier, and stored, empty days included.
- **Today** (a session day, from 09:30 on) is fetched from midnight to `min(optionClose(today), now − OPTION_DELAY_MS)`, and never stored. The answer is `partial` while that end is before `optionClose(today)`. An `optionTooRecent` refusal gives no bars, still partial.
- **No bars at all:** `unavailable: { reason: "no_bars", message: "No option bars for NVDA250926C00232500." }`. The page names the contract its own way (§8).
- **No key:** the stock's `no_key` answer. **Alpaca failing:** `BarsUnreachable`, as now.

### 5.3 The route
`GET /api/bars/option/:contract?from=YYYY-MM-DD&to=YYYY-MM-DD` answers `{ contract, bars, partial, unavailable }`. It answers 400 when the contract doesn't match `CONTRACT`, when `from > to`, or when the range is over `MAX_BAR_DAYS`. It answers 502 when Alpaca fails, as `/api/bars/:symbol` does. It is registered before `/:symbol`.

### 5.4 The window
The same as the stock chart's: from the week before the trade (or `lastDay − MAX_BAR_DAYS`, whichever is later) through its last day. The week before gives the EMAs a warm-up when the contract traded then. A 0DTE has only its one day, so its long EMAs hide, as the toolbar already handles.

---

## 6. The Option view

### 6.1 The switch
- `ChartToolbar` gets a **Stock | Option** pair after the timeframes, shown only on a scalp (a trade with one option leg).
- **The view a page opens on** follows the basis: `scalp.levelBasis`, or the Settings default when there is none. Premium opens on Option.
- **Changing the basis** in the strip flips the view to match. **+ Stop and + Target** switch to the basis's view before arming it (§7).
- **Switching keeps the time range** in view (`timeScale().getVisibleRange()`, then `setVisibleRange()` on the other view). When the other view has no candle in that range, it falls back to Fit trade.
- The choice isn't saved. The next page opens on its scalp's basis.

### 6.2 What it draws
- **The model:** `intradayModel` over the contract's bars, at the toolbar's timeframe, with its EMAs.
  - **VWAP** and **PD levels** come from the contract's own regular sessions. A contract that didn't trade the day before has no PD levels.
  - **PM levels** have nothing to draw. The toolbar greys the button out on the Option view, with the tooltip "Options don't trade premarket".
- **Empty minutes:** each session day's slots, from 09:30 to the later of `optionClose(date)` and its last bar, become whitespace where no bar exists. Lightweight Charts then spaces the candles in time, rather than packing a thin strike's 79 bars side by side. Empty slots make no candles, EMA points or volume.
- **Fills:** `tradeMarks` gives each marker the fill's price. On the Option view, buys sit `atPriceTop` (the up arrow's tip at the price) and sells `atPriceBottom`, so "B 2 @ 1.06" points at 1.06. A trade typed in by hand uses its open and close prices. The Stock view keeps its markers above and below the bar.
- **The opening window** is the model's, WINDOW_PAD candles either side of the trade, and Fit trade returns to it.
- **The hover legend** shows the contract's OHLC and volume, as on the stock view.

### 6.3 Today's trade
- The view refreshes every minute while the answer is `partial`, as the stock view does while live.
- **The banner** reads: "Alpaca's free option data runs about 70 minutes behind."
- **With no bars yet** for a trade from today: "This contract's bars from 09:52 arrive around 11:12." That is the trade's open minute, and that minute plus `OPTION_DELAY_MS`.

### 6.4 Loading
- `useOptionBars(contract, from, to, live)` runs as soon as a scalp's page opens, not only when the Option view is chosen. The switch is then instant, and + Stop knows whether there's anything to place on.
- Every state in §8 stays inside the Option view. The stock view never waits on, or shows, the option fetch.

---

## 7. Levels on the Option view

- **Premium basis:**
  - On the Option view, the stop and targets are drawn exactly as stock lines are (`STOP`, `T1 ×2`, …). They can be placed and dragged through the existing `ChartEditing`.
  - **A premium line can't go below 0.00.** A drag or click under 0 lands on 0.
  - The Stock view draws no level lines, because the levels are option prices.
- **Stock basis:**
  - On the Stock view, nothing changes.
  - On the Option view, the live `scalpRisk` gives `optionAtStop` and each target's `optionAt`. Those are drawn as thin, faded, solid lines labelled "≈ STOP" and "≈ T1". They have no `id`, so they can't be dragged. A level with no option price (no stock price yet, or a target on the wrong side) draws nothing.
- **Placing:** `useLevels` arms the chart only when the basis matches the view.
  - + Stop and + Target switch to the basis's view and arm it: the Option view on Premium, the Stock view on Stock.
  - When the contract has no bars (before 2024, none yet, or none at all), the premium levels are typed only, as now.
- **The strip's note:**
  - "Premium levels aren't drawn yet: there's no option chart" goes away.
  - On the Premium basis with no option bars, the note reads "No option bars for this contract: type the levels."
  - For a scalp from today whose bars aren't out, it reads "The option chart's bars arrive around 11:12: type the levels or wait."

---

## 8. Errors and edge states

| Case | What the Option view shows |
|---|---|
| Loading | "Loading the option chart…" |
| Alpaca failed, nothing drawn yet | "Alpaca didn't answer." with Retry |
| Alpaca failed on a refresh | The drawn chart stays, with "Couldn't refresh the option chart: Alpaca didn't answer. Trying again in a minute." |
| No key | "Add your Alpaca key in Settings to see the chart." |
| Before 2024 | "No option bars before 2024." |
| None at all (an index option, a contract Alpaca doesn't know, or one that never traded) | "No option bars for NVDA 232.5C Sep 26.", named from the trade's leg |
| Today, none out yet | "This contract's bars from 09:52 arrive around 11:12." |

- The switch stays usable in every state, so the user can always go back to Stock.
- Thin strikes draw the bars there are. The gaps show as empty space (§6.2).

---

## 9. The option range and premium MAE/MFE

### 9.1 Storage
- **Migration 0007** adds `option_high` and `option_low` (real, nullable) to `scalp_prices`: the contract's high and low from the entry minute through the exit minute. Stored like `hold_high`/`hold_low`.
- **`setScalpPrices`** takes `optionHigh` and `optionLow` too, and keeps what an earlier run stored, as now.
- **`missingScalpPrices`** also returns a closed scalp opened on or after `OPTION_BARS_SINCE` whose `option_high` is null. Each gap carries the scalp's contract code.
- **`staleScalpPrices`** also drops a scalp's prices when an edit changes its leg's strike, expiry or right. The filler's `unchanged` check compares the contract too.
- **`TradeView.scalpPrices`** carries `optionHigh` and `optionLow`. `needsPrices` asks for them on a closed scalp opened on or after `OPTION_BARS_SINCE`.

### 9.2 The filler
For each gap, after the stock prices (which are unchanged):
- **Too early:** if the exit minute isn't yet published under `OPTION_DELAY_MS`, the option range is `too_recent`.
- **Otherwise:** `optionMinute(contract, nyDate(openedAt), nyDate(closedAt))`, then `holdRange(bars, openedAt, closedAt, !partial)`. The range is stored if there is one. If there's none, it's `no_bars` when the answer is complete, and `too_recent` when it's partial.
- **Alpaca failing on an option request** ends the option fetching for this run, since later requests would fail the same way. The run still fills stock prices. The scalps it skipped get `unreachable` for their option range.
- **`missing`** entries gain `what: "stock" | "option"`, and the option reasons are `no_bars`, `too_recent` or `unreachable`. `unavailable` (`no_key` or `unreachable`) still describes the stock run.
- A contract with no bars keeps its gap, as an empty stock day does. Asking again reads `bar_days` and never reaches Alpaca.
- The analytics backfill (`useBackfillPrices`) and the IBKR sync's fill pick up option ranges through `needsPrices` and the same filler. That's one Alpaca request per scalp, the first time.

### 9.3 `scalpRisk`
- `Excursion { stock, r }` becomes `Excursion { move, r }`. The basis says which unit `move` is in.
- **Stock basis:** unchanged. Stock dollars from `holdHigh`/`holdLow`, with R against a stock stop on the losing side.
- **Premium basis:** from `optionHigh`/`optionLow`, for calls and puts alike, since a long option loses when its price falls:
  - MAE = max(0, entry premium − option low);
  - MFE = max(0, option high − entry premium);
  - in R, each is divided by (entry premium − stop) when the stop is below the entry. Otherwise R is null.
  - With no option range, both are null, and the tiles explain why (§9.4).

### 9.4 The tiles
- **On the Premium basis:**
  - **MAE** reads "−0.42", over "−0.78R · option low 0.64".
  - **MFE** reads "+0.31", over "+0.58R · option high 1.37".
  - Without R, the small print is just the low or high.
- **Waiting, the small print reads:**
  - "fetching the option's range…";
  - "waits for Alpaca's ~70-minute option delay";
  - "Alpaca has no option bars for the hold";
  - "couldn't fetch the option's range".
- **A tooltip on both tiles**, on both bases: "From the entry minute through the exit minute. Trades in your entry minute before your fill count too." A one-minute bar can't tell which trades came first. That matters more for an option: the 09:31 bar ran 0.97–1.53 around a 1.06 buy.

---

## 10. Testing

- **core:**
  - premium MAE and MFE for a call and for a put;
  - a premium stop at or above the entry (no R);
  - a missing option range;
  - the stock basis unchanged under `move`;
  - `optionClose` on a full day and on a half day.
- **market-data:** `optionMinuteBars` against a fake fetch:
  - paging;
  - an unknown contract → `[]`;
  - the OPRA 403 → `optionTooRecent`;
  - any other error thrown.
- **db:**
  - migration 0007 over a 0006 database with rows;
  - `setScalpPrices` keeping and adding the option range;
  - `missingScalpPrices` returning a closed 2024+ scalp without one and skipping an older one;
  - `staleScalpPrices` on a strike, expiry or right edit.
- **server:**
  - `optionMinute`: cached days not refetched; days before 2024 never asked for; today partial and clamped to now − 80 min; a too-recent refusal giving no bars; nothing stored after a failure;
  - the route's 400s and 502;
  - the filler: stores the option range; `too_recent` within 80 minutes of the exit; `no_bars` for a complete empty answer; an option failure leaving the stock prices filled; a contract edit mid-fetch dropping the result.
- **web,** with the fake Lightweight Charts (`chart/testing.ts`):
  - the switch on a scalp and none on an iron fly;
  - the view opening on the basis, and a basis change flipping it;
  - premium lines draggable on the Option view only, and clamped at 0;
  - the "≈" lines on the stock basis, and no lines for a level with no option price;
  - + Stop switching to the basis's view and arming it;
  - PM levels greyed out on Option;
  - fill markers at price on Option;
  - empty minutes as whitespace;
  - each message in §8;
  - the premium MAE/MFE text and its waiting words.
- **Live check,** on a copy of the real journal with the user's key, through a scratchpad stand-in server and headless Firefox, as in the earlier live checks:
  - time the first and cached opens of a real scalp's contract;
  - pin the actual delay, adjusting `OPTION_DELAY_MS` if 80 minutes is wrong;
  - find Alpaca's first month of option history, adjusting `OPTION_BARS_SINCE`;
  - screenshots at 1280 and 1024 px: both views, a premium stop placed and dragged, the "≈" lines, a thin strike's gaps, and today's waiting message.

---

## 11. Changes to other specs

- **Trade-chart spec §13 item 1** and **scalp-review spec §16 item 1:** point here.
- **Scalp-review spec §8:** premium levels are drawn and dragged on the Option view.
- **Scalp-R spec §9.1:** MAE and MFE follow the basis; on Premium they come from the option's range.
- **Scalp-analytics spec §1, out of scope:** "MAE/MFE in R on the premium basis" now lives here, on the trade page.
