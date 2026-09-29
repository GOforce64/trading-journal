# Trade Chart — Design Spec

- **Date:** 2026-09-29
- **Status:** Approved; implemented on feat/trade-chart. Plan: [2026-09-29-trade-chart.md](../plans/2026-09-29-trade-chart.md), whose deviations are folded in below.
- **Scope:** every trade page gets two charts:
  - a **3-minute intraday chart** of the underlying, with the trade's fills marked on it;
  - a **daily chart** beside it.

  The intraday chart carries EMAs, VWAP and the premarket and prior-day levels. Bars come from Alpaca and are cached locally.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §8.2. This is Phase 2, step 2 (§13), and it changes §8.2 where noted in §11.
- **What comes next:** the scalp review ([decisions so far](#12-for-the-scalp-review)). It is done on this page and draws the stop and target on these charts. The user: "reviewing the page MUST include the chart, as that's the visuals I'm reviewing on".

---

## 1. Purpose and success criteria

Scalps are reviewed on the chart. The trade page must show what the user saw on TradingView when they traded: candles on their timeframe, their moving averages, VWAP and the day's key levels, with their own entries and exits marked.

**Success:**
- Opening this morning's NVDA 232.5C scalp (2026-09-28) shows a 3m chart zoomed on 09:31–09:46, with:
  - two buy arrows at 09:31 ("B 1 @ 1.06" each) and sells at 09:31 and 09:46;
  - EMA 8/20/50/167, VWAP, and the PM and PD highs and lows.

  NVDA's daily chart sits beside it.
- The chart opens zoomed on the trade. Zooming or scrolling out reaches the whole extended day and the warm-up days, and **Fit trade** returns.
- Switching 3m → 5m is instant.
- Reopening a past trade makes no Alpaca call, and works offline.
- Without an Alpaca key, or for a symbol Alpaca doesn't carry, the page still works and says why there's no chart.

### Out of scope
- The stop and target lines and everything else of the scalp review: they are the next spec. This spec only leaves room for extra price lines.
- **An option-premium chart**, i.e. the option contract's own candles. The user may switch their stops to premium later, and the chart component takes any bar series, so it can be added then.
- **Index underlyings** (SPX, NDX, RUT) charted through an ETF proxy.
- Drawing tools, alerts, or indicators beyond those listed.

---

## 2. Decisions

| Question | Decision |
|---|---|
| What's on the chart | EMAs, VWAP, premarket and prior-day levels, and volume (the user's TradingView layout). |
| EMA lengths | 8, 20, 50 and 167, editable in Settings. |
| Timeframe | Opens on **3m**; "mostly 3m, but also sometimes the 5m". 1m, 2m, 5m, 10m, 15m, 30m and 1h are one click away. |
| Hours | **Full extended hours**, 04:00–20:00 ET. |
| Zoom | "Let me zoom in so I don't see all the candles at all times, only when I need them." It opens on the trade; the rest is a scroll or pinch away. |
| Daily chart | "A daily chart on the side of the scalp 3m chart": a second chart beside the intraday one, not only a timeframe option. |
| Prior-day levels | "Prior day high and lows overlaid on the 3m" (PD high and PD low on the intraday chart), with PM high and PM low. |
| Approach | The server caches Alpaca's 1-minute and daily bars. Timeframes and indicators are pure functions in `core`, drawn by Lightweight Charts in the browser. |

---

## 3. Facts this design relies on

- **Alpaca's free plan** serves historical SIP bars, minute and daily, including pre- and post-market.
  - It refuses the most recent **15 minutes** (403, "subscription does not permit querying recent SIP data"). Established by the move-data work.
  - `adjustment=raw` gives prices as traded, so they match the option strikes.
  - A page holds up to 10,000 bars, with `next_page_token` for more.
- **Checked live on 2026-09-29 with the user's key:**
  - SPY, QQQ and IWM have minute and daily bars (Sep 25 closes 771.35, 744.50, 281.97);
  - SPX has none.
- **`lightweight-charts` ^5.2.1** is already a dependency. It is used by the equity curve, whose tests mock the library, because jsdom has no canvas.
- **`core`** already has `nyDate` and `nyWallClock` for New York time, and `packages/market-data/src/bars.ts` already calls Alpaca's bars endpoint.
- **An extended session is 960 one-minute bars.** The EMAs need warm-up: the 167 EMA on 3m candles needs about 500 of them, which is about 1,500 minutes, or 1.5 extended sessions.

---

## 4. Architecture

```
web: TradeCharts ─ IntradayChart + DailyChart (Lightweight Charts), ChartToolbar, chart prefs
        │  uses core/chart to build candles, indicators and levels; builds markers from the trade's fills
        ▼
server: GET /api/bars/:symbol (1m, a date range)   GET /api/bars/:symbol/daily
        │  bar service: serve cached days, fetch the missing ones, cache finished days
        ├──► db: bars, bar_days (the cache; never exported)
        └──► market-data: alpacaBars.minuteBars / dailyBars (SIP, raw, paged)
core/chart: aggregate, ema, vwap, sessionLevels (pure, tested)
```

**Units:**
- **`packages/core/src/chart.ts`**, pure (one file: `core` is a flat package):
  - `aggregate(bars1m, minutes)`: build candles of any length;
  - `ema(closes, length)`: the moving average, with its warm-up;
  - `vwap(bars1m)`: per regular session;
  - `sessionLevels(bars1m, date)`: PM high/low and PD high/low.
- **`packages/market-data`:** a new `BarHistory` source (`alpacaHistory`) with `minuteBars(symbol, start, end)` and `dailyBars(symbol, from, to)`, paged. It's a market source of its own (`history`), beside move data's `bars`.
- **`packages/db`:** the `bars` and `bar_days` tables, and a `createBarsRepo` for the cache.
- **`apps/server`:** a bar service with the caching rules (§6), and the two routes.
- **`apps/web`:**
  - `TradeCharts` (the layout, and fetching);
  - `IntradayChart` and `DailyChart` (thin wrappers around Lightweight Charts);
  - `ChartToolbar`;
  - `chartModel` (pure: series, markers and the opening range from bars and the trade);
  - chart preferences.

---

## 5. Data model (migration 0004)

- **`bars`:** `symbol`, `timeframe` (`1m` | `1d`), `t` (epoch ms, the bar's start), `o`, `h`, `l`, `c`, `v`. The primary key is (`symbol`, `timeframe`, `t`). This table is the parent spec §6's `bars` cache; its `source` column is dropped, since Alpaca is the only source.
- **`bar_days`:** `symbol`, `timeframe`, `date` (YYYY-MM-DD, New York), `count`, `fetched_at`. The primary key is (`symbol`, `timeframe`, `date`). It records that a day was fetched and is finished, even when it had **no** bars (a weekend or holiday), so it's never asked for again.
- **Neither table is exported or merged.** Both machines can rebuild them from Alpaca.

---

## 6. Fetching and caching

- **Intraday:** `GET /api/bars/:symbol?from=YYYY-MM-DD&to=YYYY-MM-DD` answers `{ symbol, bars: Bar[], partial: boolean, unavailable: { reason, message } | null }`.
  - `Bar` is `{ t, o, h, l, c, v }`: 1-minute, 04:00–20:00 ET, oldest first.
- **The trade page's range:** from **7 calendar days before** the trade's first day, which gives 3 to 5 prior sessions of warm-up, through the trade's last day. For an open trade, the last day is today.
- **The daily range:** `GET /api/bars/:symbol/daily?to=YYYY-MM-DD` answers the same shape with daily bars, for the 1,095 days (three years, about 750 trading days) up to `to` (the trade's last day), and never later than yesterday. The 167 daily EMA draws from its 501st close, and the chart opens on the last 126. Alpaca's daily bar for a day exists only once the day is over, so **the daily chart builds the candle for today (and any later trade day it lacks) from that day's regular-session minute bars**.
- **The bar service, per request:**
  1. List the days in the range. Days found in `bar_days` are read from `bars`.
  2. Fetch the missing finished days from Alpaca in **one** paged request, from the first missing day to the last.
     - Today is fetched in a request of its own, ending 16 minutes ago or at 20:00 ET if that's earlier, because of the 15-minute limit. It's never combined with finished days: otherwise a refusal of the recent minutes could be cached as empty days.
     - `partial: true` says today's tail is missing.
  3. Store bars and `bar_days` rows only for **finished** days: those before today in New York.
     - A finished day with no bars is stored with `count = 0`.
     - Today is never cached.
- **Today's trades:** the page refetches every 60 s while the trade's last day is today and the time is before 20:16 ET.
- **Unavailable, answered with 200 and an empty `bars`:**
  - no Alpaca key, with days still to fetch: `no_key`;
  - no bars at all in the range: `no_bars` ("No stock bars for SPX."). Alpaca answers a symbol it doesn't carry with no bars, the same as a symbol with none in the period, so the two can't be told apart.
- **Alpaca failing** (network, 5xx, 429 after its retries) answers 502 with `{ error, message }`. Days already cached are still served when they cover the whole range. Otherwise the page shows the message and a **Retry** button.

---

## 7. Timeframes and indicators (`core/chart`)

- **`aggregate(bars, minutes)`:**
  - builds candles on clock boundaries counted from 04:00 ET each day, so a 3m candle covers 09:30–09:33, as on TradingView;
  - never crosses days;
  - open is the first bar's open, close the last bar's close, high and low the extremes, volume the sum;
  - a gap (no trades that minute) just leaves the candle with fewer bars;
  - 1h candles start at 04:00, 05:00, and so on.
- **`ema(closes, length)`:**
  - α = 2 ÷ (length + 1), seeded with the first close, as TradingView's `ta.ema`;
  - carried across days and through extended hours;
  - values before index 3 × length − 1 are `null` (not warmed up) and are not drawn;
  - an EMA with no drawable value is hidden, and its toolbar toggle shows "needs more history".
- **`vwap(bars1m)`:** regular session only (09:30–16:00 ET), restarting each day: Σ(typical price × volume) ÷ Σ volume, where the typical price is (h + l + c) ÷ 3. It's computed on 1-minute bars and sampled at each candle's close for the chosen timeframe.
- **`sessionLevels(bars1m, date)`:**
  - **PM high / PM low:** the highest high and lowest low from 04:00 to 09:29 ET on `date`;
  - **PD high / PD low:** the regular-session (09:30–16:00) high and low of the last day before `date` that has regular-session bars, so holidays are skipped. On a half day, the session simply ends early.
  - A level with no bars behind it is `null` and isn't drawn.
- **The levels drawn** are those of the trade's **first** day, as horizontal lines across that day.

---

## 8. The charts on the trade page

- **Layout:**
  - under the trade header, above the tiles;
  - the intraday chart takes about ⅔ of the width and the daily chart about ⅓, both about 420 px tall;
  - under about 1100 px wide, the daily chart moves below the intraday one;
  - the rest of the page is unchanged.
- **Intraday chart:**
  - candles in the app's up and down colours, with a volume histogram along the bottom and the time axis in ET;
  - candles outside 09:30–16:00 are tinted slightly lighter, so the regular session stands out;
  - **Opening view:** from 20 candles before the first fill to 20 after the last, at 3m. Scroll or pinch zooms, and dragging pans across everything loaded. **Fit trade** restores the opening view.
  - **Toolbar:** the timeframes `1m 2m 3m 5m 10m 15m 30m 1h`, then toggles for `EMA 8`, `EMA 20`, `EMA 50`, `EMA 167`, `VWAP`, `PM levels`, `PD levels` and `Volume`.
  - **Markers:**
    - one per fill, on the candle containing its time;
    - buys below the candle pointing up, sells above pointing down;
    - the text is the option size and price, e.g. "B 2 @ 1.06" or "S 1 @ 1.44";
    - expiries read "expired", and canceled fills are left out;
    - a trade typed in by hand gets one entry marker at `openedAt` and one exit marker at `closedAt`, from its legs.
  - **Levels:** thin labelled lines "PM H", "PM L", "PD H", "PD L".
  - **Crosshair legend:** at the top left, the time, OHLC and volume, and each visible indicator's value at the hovered candle.
  - **Extra price lines:** the component takes a `lines` list (`{ price, color, style, label }`), so the scalp review can add the stop and target without changing the chart.
- **Daily chart:**
  - daily candles, volume, and the four EMAs on daily closes;
  - it opens showing about 6 months up to the trade's last day, with scrolling back to 2 years;
  - a marker on each day the trade was open.
- **Preferences** are kept per browser (localStorage, safely wrapped): the timeframe, the toggles, and the four EMA lengths. The lengths are edited in a new **Chart** section in Settings.
- **Iron flies** get the same charts, covering their open-to-close days.

---

## 9. Errors and edge states

| Situation | Behaviour |
|---|---|
| No Alpaca key | The chart area reads "Add your Alpaca key in Settings to see the chart." The page is otherwise unchanged. |
| A symbol Alpaca doesn't carry (SPX, NDX, RUT), or no bars in the range | "No stock bars for SPX." (`no_bars`). The empty days are cached like any others. |
| Alpaca unreachable or failing | The message, and **Retry**. |
| Part of a range cached, the rest failing | The error, and **Retry**; nothing partial is drawn. |
| Today, within 15 minutes of now | Bars up to 15 minutes ago, noted "Alpaca's free data runs 15 minutes behind". It refreshes every 60 s. |
| Weekends and holidays in the range | Fetched once, stored with `count = 0`, never fetched again. |
| An EMA without enough history | Not drawn; its toggle says "needs more history". |
| A split inside the warm-up days | The raw prices step, bending the EMAs for that trade. It's rare, and accepted. |
| A trade with no fills and no times | No markers; the opening view is the trade's first day, 09:30–10:30. |

---

## 10. Testing

- **`core/chart`:**
  - `aggregate`: 3m boundaries at 04:00 and 09:30, no crossing of days, and a property test that volume sums and high/low extremes are preserved;
  - `ema`: hand-computed values for a short series, the seed, and `null` before 3 × length − 1;
  - `vwap`: by hand, with the reset each day and nothing before 09:30;
  - `sessionLevels`: PM and PD levels, after a holiday, on a half day, and a `null` with no bars.
- **`market-data`:** paging with `next_page_token`, the recent-SIP 403 on today's tail, and an unknown symbol.
- **`db`:** finished days stored with their `bar_days` rows, empty days remembered, today never stored.
- **Server:**
  - a second request for a past range makes no Alpaca call;
  - today's range refetches, clamped to 16 minutes ago;
  - `no_key` and `no_symbol`;
  - a 502 on failure.
- **Web**, with Lightweight Charts mocked as in the equity curve's tests:
  - `chartModel`: markers from synced fills and from a typed trade's times, the opening range, levels, EMAs hidden without history;
  - the toolbar: timeframe switch, toggles, remembered choices;
  - the empty states;
  - the layout's two charts.
- **Live and visual check:** NVDA from 2026-09-28 on a copy of the real journal, with screenshots at 1280 and 1024 px of the 3m and daily charts, the zoomed-out day, 5m, and a no-key state.

---

## 11. Changes to the parent spec

- **§8.2:**
  - **Alpaca's free plan** supplies the bars, not Massive: it has historical SIP minute and daily bars, and a rate limit that needs no client-side queue;
  - the timeframes are `1m 2m 3m 5m 10m 15m 30m 1h` plus a **daily chart beside** the intraday one, not daily as a timeframe;
  - the chart shows **extended hours**, opens on **3m**, and is zoomed on the trade;
  - warm-up is the week before the trade;
  - index underlyings get an empty state.
- **§6:** `bars` loses `source`, and `bar_days` is added. Neither is exported.
- **§16, item 4 (Massive):** no longer needed.

---

## 12. For the scalp review

Decided with the user on 2026-09-29, and designed in the next spec:
- **Stops and targets** are on the stock price for now, with the option premium supported too: each has a basis (stock | premium), stock by default and switchable per trade. They are drawn on these charts through the `lines` input.
- **The To review queue:** a scalp leaves it once it has a setup, a grade and a stop, or when the user clicks **Done reviewing**.
- **The review happens on the trade page,** with these charts.

---

## 13. Open items

1. **Option-premium chart:** Alpaca's option bars on the free plan, for when stops move to premium.
2. **Index underlyings:** chart SPX, NDX and RUT through SPY, QQQ and IWM, labelled as a proxy, if the user trades index options.

### Live check (2026-09-29)

On a copy of the real journal, with the user's key, and this morning's NVDA 232.5C scalp added by hand:
- **NVDA, Sep 21–28:** 5,613 one-minute bars in 1.7 s the first time and 0.07 s from the cache, the same bars both times, `partial: false`.
  - Storing a row per statement had made the first open take 4.4 s, so the cache now inserts 500 rows at a time.
- **Daily:** 500 bars up to Sep 28 (close 228.86) in 0.7 s.
- **SPX:** "No stock bars for SPX."
- **Screenshots at 1280 and 1024 px:**
  - The trade opens on 3m, zoomed on 08:30–10:45, with "B 2 @ 1.06" and "S 2 @ 1.295".
  - The EMAs, VWAP, and the labelled PM and PD lines are drawn. The premarket candles are lighter.
  - The daily chart sits beside the intraday chart at 1280 and below it at 1024. 5m, zooming out, Fit trade and the hover legend all work.
  - AA's iron fly (Jul 16–17) shows "Open" and "Close" markers.
  - Settings has the Chart panel. Without a key, the page reads "Add your Alpaca key in Settings to see the chart."
- **Found and fixed:** Lightweight Charts joins a line's points across gaps, so VWAP ran straight from one session's close to the next open. Each day's last VWAP point is now transparent.
