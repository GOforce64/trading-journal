# Session backgrounds on the intraday chart: design

- **Date:** 13 Oct 2026. **Status:** approved. The user said "yes go ahead" to the design on 13 Oct 2026.
- **Branch:** `feat/launcher-keys-palette`, so it ships with the launcher PR.
- **The ask (13 Oct 2026):** "in the scalps when reviewing a scalp on the chart i wanna see the pre market and after market have a different background behind the candles to make it clear, like a golden one for pre market and a darker purple one for after market like trading view, transparent and subtle".

## 1. Decisions

| Question | Decision |
|---|---|
| Pre-market, 04:00–09:30 ET | A faint **gold** wash behind the candles, about 7% opacity. |
| After-hours, the regular close (16:00, or 13:00 on a half day) to 20:00 | A faint, deeper **purple**, about 9%. |
| The regular session | Plain, as now. |
| Extended-hours candles | **Full colour.** They're drawn at 45% today; the background alone marks the session now. This was the user's answer when asked. |
| Where | The **stock view** of the intraday chart, wherever it shows: scalps, missed trades and any other trade's intraday chart. The option view has only regular hours (plus the options' quarter-hour), so it gets none. The daily chart gets none. |
| Shape | Each run of pre-market or after-hours candles is one band. It is the pane's full height, from its first candle's left edge to its last candle's right edge, behind the candles (the faint grid shows through). It follows zoom and scroll. |

The exact colours are tuned at the screenshot check (§4); the opacities above are the starting point.

## 2. Design

### 2.1 Core: a candle's session
- `Candle.extended: boolean` becomes `Candle.session: "pre" | "regular" | "post"`, decided where `extended` is today in `aggregate`:
  - a candle whose start slot is before 09:30 is `pre`;
  - one starting at or after `regularClose(date)` is `post`;
  - anything else is `regular`.
- An hourly candle starting at 09:00 is `pre`, as it was `extended`.
- `extended` has no other readers: the chart's dimming, which goes, and core's own tests.

### 2.2 Core: the bands
- `sessionBands(candles)` returns `{ from, to, session }[]`:
  - `from` and `to` are the indexes of a run's first and last candle;
  - `session` is `"pre"` or `"post"`.
- A run is consecutive candles with the same non-regular session **on the same New York day**. So one day's after-hours and the next day's pre-market are two bands, even with no regular candle between them.
- The stock view draws no whitespace, so a candle's index is its logical index on the chart's time scale. A quiet pre-market minute with no trades leaves no gap in the band.

### 2.3 Web: painting the bands
- **`chart/sessions.ts`** holds a Lightweight Charts series primitive (its plugin API, 5.2), `SessionBands`:
  - `setBands(bands)` keeps the bands and asks the chart to redraw;
  - one pane view, whose renderer paints in **`drawBackground`**, the layer the library offers for "time areas highlighting";
  - each band is a `fillRect` over the bitmap's full height, scaled by the pixel ratio. It runs from half a bar before its first candle's centre to half a bar after its last's: the outer edges of its end candles.
  - A logical index is a candle's centre. Lightweight Charts places **whole indexes only**: `logicalToCoordinate` gives 0 for a fraction. So a bar's width is the gap between the first candle's centre and the next one's. The first plan used ±0.5 and painted nothing; the screenshot check caught it (§5).
- **`IntradayChart`** attaches one `SessionBands` to the candle series when it builds the chart. On each draw it sets `sessionBands(model.candles)` for the stock view, and none for the option view (`model.slots` set).
- The `upExtended` and `downExtended` colours go. **`COLORS.preBand`** (gold) and **`COLORS.postBand`** (purple) join `style.ts`.

## 3. Tests
- **Core `chart.test.ts`:**
  - `aggregate` gives `pre`, `regular` and `post`, including a half day's 13:00 close;
  - `sessionBands` covers one day's pre and post runs, a regular-only day (no bands), and after-hours followed directly by the next day's pre-market (two bands).
- **Web `sessions.test.ts`:** with a recording canvas, `drawBackground` fills each band at the right bitmap x, width and full height, in its colour, at a pixel ratio of 2. With no bands it draws nothing.
- **Web `charts.test.tsx`:**
  - the stock view gives the attached primitive its bands, and extended-hours candles carry no colour of their own;
  - the option view gives it none.
  - The chart fake (`chart/testing.ts`) records `attachPrimitive`.

## 4. Check
- On `pnpm demo`, screenshot a scalp's stock chart showing pre-market, the regular session and after-hours, at 1 and 5 minutes, zoomed in and out. Then screenshot the option view to confirm it has no bands. Tune the two colours there.
- Use the visual check recipe: headless Firefox and puppeteer-core, waiting for Google Fonts first.

## 5. Check (13 Oct 2026)
- **Data:** `pnpm demo` makes regular-hours bars only. So the check added synthetic NVDA pre-market and after-hours minute bars for 9 and 12 Oct to the demo's database in the scratchpad, and screenshotted the 12 Oct NVDA scalp in headless Firefox.
- **Found and fixed:** the bands painted zero-wide, because `logicalToCoordinate` gives 0 for a fractional index (§2.3).
  - Both test fakes now behave like the library, and the tests failed before the fix.
  - Commit a52f44b.
- **After the fix:**
  - At 5m and 15m, zoomed out over two days, each pre-market is a gold band from 04:00 to the 09:30 candle and each after-hours a purple band from 16:00. Both are full height and behind the candles, with edges on candle boundaries.
  - A band scrolled off the left edge still fills to the edge.
  - The candles are in full colour.
  - The option view has no bands.
  - There were no console errors.
- **Colours tuned:** at 7%, the gold `rgba(255, 193, 7)` mixed to a grey-olive on `#131722`, and the purple `rgba(124, 77, 255)` at 9% leaned blue. They're now:
  - **pre-market `rgba(255, 176, 0, 0.1)`**, a warm gold;
  - **after-hours `rgba(150, 70, 230, 0.11)`**, a clearer purple.
  - Both are still subtle.
