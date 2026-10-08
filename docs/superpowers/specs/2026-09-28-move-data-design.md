# Move Data and Settle at Expiry — Design Spec

- **Date:** 2026-09-28
- **Status:** Approved; implemented on feat/move-data. Plan: [2026-09-28-move-data.md](../plans/2026-09-28-move-data.md)
- **Scope:**
  - Every iron fly gets its implied move, actual move, move ratio and IV before → after, worked out from its own fills and the stock price at entry and exit.
  - Stock prices come from Alpaca's historical minute bars. They're fetched automatically after a save or an import, and a "Fill in missing" button covers the backlog and retries.
  - The Iron flies tab gets its three move charts, replacing the placeholder. The trade page's move tiles show their working.
  - An expired fly with no exits can be settled at intrinsic value from the expiry-day close, after the user confirms.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md). This spec details its §7.3 move metrics and §9 iron fly charts, and changes some of their definitions (see §11).
- **Follows:** [2026-09-27-analytics-and-dashboard-design.md](2026-09-27-analytics-and-dashboard-design.md), which left the move charts as a placeholder.

---

## 1. Purpose and success criteria

The Iron flies tab says how much credit the flies keep, but not why they lose. For an earnings fly, the reason is usually that the stock moved more than the options priced in. This work answers three questions for every trade already logged:

1. **What move was priced in?** The implied move at entry.
2. **What move happened?** The stock's move from entry to exit, and its ratio to the implied move.
3. **Did IV get crushed?** IV at entry against IV at exit, solved from the user's own fill prices.

Success means:

- After one click of "Fill in missing" on the real journal, the numbers match the spike (§3). M shows 7.3% implied, −5.3% actual, 0.73×, and IV 123% → 77%.
- A new or edited trade gets its stock prices without any extra step. A trade Alpaca can't price says why, and its move values can be typed by hand.
- BB, expired on 2026-09-25 with no exits, can be settled in two clicks at +$433.00.
- Every move number is defined once in `core` and tested against hand-worked values. Only the two stock prices are stored.

### Out of scope

- **Earnings date and timing**, and the parent spec's announcement-based actual move (§11).
- **P&L attribution** (IV-crush P&L against price-move P&L, parent §7.3). This work supplies its inputs, and it can follow on its own.
- **A bars cache table and the Massive adapter** (parent §8.2). The Phase 2 chart work needs them. This feature stores two prices per trade and nothing else.
- **A risk-free rate setting.** The rate is fixed at 4% (§7.2).
- **Scalps.** Move data is for iron flies only.
- **Retrying automatically after 15 minutes** for a price that was too recent. The button covers it.
- **Settling without confirmation**, or settling a trade whose open legs have different expiries.
- **Move ratio as a split in the Overview grid.** The Iron flies tab's ratio table covers it for now.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Actual move | **Entry to exit**: the stock price at the fill time against the price at the close time, signed. That's the move the trade lived through, which for an earnings fly spans the announcement. The move ratio uses its absolute value. |
| Implied move | The short straddle's entry credit (short call entry + short put entry) ÷ the stock price at entry. |
| What's stored | **Only the stock price at entry and at exit** (approach A), in two new `iron_fly_details` columns. Implied and actual move, the ratio and IV are computed on read, so they can never drift from the legs. |
| Hand-typed values | The existing `implied_move_pct`, `actual_move_pct`, `iv_before` and `iv_after` columns become **overrides**. A filled one wins over the computed value. They're edited in a new "Move overrides" row on the edit form. |
| Filling | **Automatic, plus a button.** The browser calls one fill endpoint after a trade is saved or an import is committed. "Fill in missing" on the Iron flies tab and the trade page fills the backlog and retries. Filling never overwrites a value. |
| Who triggers the automatic fill | **The browser**, not a server hook. An import fill is about 82 Alpaca calls (10–20 s), too long to hold the commit response. A background fill on the server would need polling for the page to learn it's done. One endpoint that the page calls after its own save keeps one code path, and the page knows when the prices land. A trade created from outside the app is filled by the button. |
| Price at a moment | The close of the last regular-session 1-minute bar before the moment, from the SIP feed with raw (unadjusted) prices. |
| Moments outside market hours | Clamped into 09:31–16:00 New York on their own date, because some stored times are outside market hours (CRM opened "18:11 ET", PATH "07:45"). |
| IV model | Black-Scholes, r = 4%, no dividends, solved by bisection. IV before = the mean of both short legs at entry. IV after = the OTM short leg(s) at exit. |
| IV after near expiry | Left blank within 24 h of expiry, where a few cents swing the solve wildly (KLAR solved to 665%, SMR to 433%). |
| Expiry moment | 16:00 New York on the expiry date. |
| IV crush | In **points**: IV before − IV after. |
| Settle at expiry | Previews each open leg's exit at intrinsic value from the expiry-day close. It flags an in-the-money short as "assigned, not cash", shows the net P&L, and saves only when the user confirms. The exits can be edited first. |
| Where move numbers are computed | In the browser, with `core`, the same way `pctKept` and `keptStats` are. The trade reply already carries the legs and the fly details, so the server adds nothing. |
| Units | `core` returns fractions (0.073 = 7.3%), like its other ratios. The override columns stay in percentage points (7.3, and IV 123), as the trade page shows them today. |

---

## 3. What the data holds today

Read from the real journal on 2026-09-28:

- 42 iron flies, all imported from oQuants into the paper book. 41 are closed. BB is open, and expired on 2026-09-25.
- `implied_move_pct`, `actual_move_pct`, `iv_before`, `iv_after` and `earnings_date` are empty on all 42.

The spike (2026-09-27) ran these definitions against Alpaca for every closed fly:

- **M:** $21.66 → $20.505. Implied 7.3%, actual −5.3% (0.73×). IV 123% → 77%. +$224.
- **The big losers:** CRM +18.0% against 7.0% implied (2.57×), −$2,324. Then CRWD 2.05×, KLAR 1.76×, BIDU 1.71× and BULL 1.49×.
- **By move ratio:**

  | Ratio | Trades | Won | Net |
  |---|---|---|---|
  | < 0.5× | 20 | 17 | +$3,130 |
  | 0.5–1× | 9 | 5 | +$292 |
  | 1–1.5× | 7 | 0 | −$1,478 |
  | 1.5×+ | 5 | 0 | −$4,218 |

  Every trade that moved more than implied lost. Buckets use unrounded ratios: rounding to 0.1% moved LYFT, NIO and BULL across edges.
- **IV:** 34 trades have both ends, 23 of them crushed, and the median crush is 16 points.
- **BB settle:** the SIP close on 2026-09-25 was $8.21. Only the short 8.5 put is in the money (0.29). Net = 612 credit − 174 to close − 5 fees = **+$433.00**.

These numbers double as the check for the finished work.

---

## 4. Architecture

```
save / import commit (browser)                "Fill in missing" (browser)
        │                                              │
        └──────────── POST /api/moves/fill { tradeIds? } ┘
                              │
                 createMoveFiller (server)  ── one run at a time
                              │  for each missing side: sessionMoment(at)   (core)
                              ▼
                 bars.priceAt(symbol, moment)   (market-data, Alpaca 1Min SIP)
                              │
                 repo.setUnderlyingPrice(id, side, price)  ── only where still null
                              ▼
       iron_fly_details.underlying_price_entry / underlying_price_exit
                              │
GET /api/trades … (unchanged)  │  legs + fly details, prices and overrides included
                              ▼
       core tradeMoves(trade)  ── implied, actual, ratio, IV (overrides win)
                              │
          ├─ trade page tiles       ├─ Iron flies tab: scatter, ratio table, IV crush
          ▼
Settle panel ── GET /api/close/:symbol?date= ── core settleAtExpiry ── PATCH /api/trades/:id
```

---

## 5. Data model and migration

### 5.1 New columns

Migration `0002`, generated by drizzle-kit like `0001`, adds two nullable columns to `iron_fly_details`:

- `underlying_price_entry` (real, dollars): the stock price at `openedAt`;
- `underlying_price_exit` (real, dollars): the stock price at `closedAt`.

The names come from the parent spec's data model (§6). Null means "not fetched yet". The startup backup runs before the migration, as for every migration.

**Only the fill service writes them.** They are not part of `ironFlyDetailsSchema`, so the form, `POST`/`PATCH /api/trades` and the importer can't set them. That keeps fetched prices and typed values apart.

### 5.2 The overrides

`implied_move_pct`, `actual_move_pct`, `iv_before` and `iv_after` keep their schema and their units, percentage points: 7.3 means 7.3%, and IV 123 means 123%. `actual_move_pct` is signed. When one is filled, it replaces the computed value for that field (§7.3).

### 5.3 Edits keep what they don't touch

Today, a patch that carries `ironFly` makes `writeChildren` delete the `iron_fly_details` row and insert a new one. The two price columns aren't in the schema, so no patch carries them, and every edit would drop them. The fix is in two places:

- **Repo:** `writeChildren` updates the details row in place (insert if missing) and sets only the columns the input names. The stock prices, which no input names, survive every edit. `ironFly: null` still deletes the row.
- **Form (already done):** `EditTrade`'s `keepIronFlyExtras` sends back the stored detail fields the form doesn't show (`earningsDate`, `earningsTiming`, `sourceNotes`), so those already survive an edit. The new override row (§9.3) goes after them, so the typed values win.

### 5.4 Stale prices are cleared

A stored price is only right for the time and ticker it was fetched for. `repo.update` clears prices whose inputs change, in the same transaction:

- `underlying` changes → both prices;
- `openedAt` moves to another minute → the entry price;
- `closedAt` moves to another minute, or back to null → the exit price.

"Another minute" means a different `sessionMoment` (§7.1), because that decides which bar is read. The edit form drops seconds from every time, so comparing raw timestamps would clear an imported trade's prices on every save. The automatic fill after that save fetches new ones.

### 5.5 New repo methods

- `setUnderlyingPrice(tradeId, side: "entry" | "exit", price)` runs `UPDATE … SET underlying_price_<side> = ? WHERE trade_id = ? AND underlying_price_<side> IS NULL`. It returns whether a row changed. It never overwrites, even if an edit lands at the same moment. It doesn't touch `updatedAt` or `editedAt`: a fill isn't a user edit, and any machine can reproduce it.
- `missingPrices(tradeIds?)` returns the candidates (§8.1), with their underlying, `openedAt`, `closedAt` and which sides are missing.

---

## 6. Market data: the bars client

New file `packages/market-data/src/bars.ts`:

```ts
export interface BarSource {
  /** The close of the last regular-session 1-min bar that started before `at`, or null if Alpaca has none. */
  priceAt(symbol: string, at: number): Promise<number | null>;
  /** The regular-session close on a New York date, from the daily bar, or null. */
  closeOn(symbol: string, date: string): Promise<number | null>;
}
export function alpacaBars(keys: AlpacaKeys, options?: AlpacaOptions): BarSource;
```

- **`priceAt`**: one call to `GET /v2/stocks/bars?symbols=<S>&timeframe=1Min&feed=sip&adjustment=raw&limit=1000&start=<09:30 NY on at's date>&end=<at>`. It returns the close of the last bar whose start time is before `at`.
  - `at` is already the clamped moment (§7.1), whole minutes. The bar starting at 15:53 ends at 15:54, so a moment of 15:54 gets that bar.
  - A session is at most 390 bars, so one page always covers it, and a thin stock with gaps between trades still finds its last print.
  - On a half day, the last bar is 12:59 and a 16:00 moment picks it up without special handling.
- **`closeOn`**: `timeframe=1Day&feed=sip&adjustment=raw&start=<date>&end=<date>`. It returns that bar's close. For BB on 2026-09-25 that gives $8.21.
- **Why `adjustment=raw`:** split-adjusted prices would no longer match the strikes. It's Alpaca's default, but it's sent explicitly.
- **Reply schema (zod):** `{ bars: Record<symbol, { t: ISO datetime, c: positive number }[] | null> | null, next_page_token }`. An empty object, a missing symbol and null all mean null.
- **Refusals that mean "no price", not an error:**
  - A 403 whose message mentions "recent SIP data" means the free plan's 15-minute delay. It returns null. It must not reach `report()`, which treats every 403 as a rejected key and would turn Settings red. The fill service avoids asking for such moments at all (§8.1), so this is a backstop.
  - A 400 "invalid symbol" (the same pattern `alpaca.ts` already matches) returns null.
- **Everything else** (other 4xx, 5xx, a timeout, a reply that doesn't parse) throws an `AlpacaError` or the parse error, as the other clients do.
- **No cache layer.** Each price is fetched once and then stored, so the TTL caches used for quotes aren't needed.
- **Wiring:** `MarketSources` gains `bars: BarSource`, built in `alpacaSources` next to the others, with the same `alpacaGet` and 10 s timeout.

---

## 7. `packages/core`

### 7.1 `calendar.ts` additions

- `nyWallClock(date, minuteOfDay)`: the UTC epoch ms of a New York wall-clock time on a date. UTC = NY wall clock − the NY offset, so 16:00 EDT (−4 h) is 20:00Z. The spike first got this sign wrong, so both sides of each DST switch are tested.
- `sessionMoment(at)`: the New York date of `at`, its minute of day (seconds dropped) clamped to [09:31, 16:00], and that moment through `nyWallClock`. The trade page also uses it to show when each price was taken.
- `expiryMoment(expiry)` = `nyWallClock(expiry, 16 × 60)`.

### 7.2 `pricing.ts` (new)

- `RATE = 0.04`, no dividends.
- `normCdf(x)`: the Abramowitz–Stegun approximation, the same one the spike used.
- `bsPrice(right, S, K, T, sigma)`: European Black-Scholes. With T ≤ 0 or sigma ≤ 0 it returns intrinsic value.
- `impliedVol({ right, price, S, K, T })` → `number | null`: bisection for sigma between 0.01 and 10 (1% to 1000%), 100 steps. It returns null when:
  - T ≤ 0;
  - the price is no more than half a cent above intrinsic;
  - the solve ends at either bound: the upper one (≥ 9.99), or the 1% lower one, where a price below Black-Scholes at 1% can't be solved either.
- `yearsToExpiry(at, expiry)` = (`expiryMoment(expiry)` − `at`) ÷ (365 days in ms).

Parent spec §8.3 planned a `core/pricing` for Phase 2's risk engine. This is its start, and Phase 2 can add Newton-Raphson and a rate setting to it.

### 7.3 `moves.ts` (new): one trade

```ts
interface MoveValue {
  value: number;                     // a fraction: 0.073 = 7.3%, 1.23 = 123% IV
  source: "computed" | "override";
  computed: number | null;           // what the fill data gives, shown beside an override
}
type IvBlank = "near_expiry" | "unsolvable";

interface TradeMoves {
  stockAtEntry: number | null;
  stockAtExit: number | null;
  impliedMove: MoveValue | null;
  actualMove: MoveValue | null;      // signed
  moveRatio: number | null;          // |actual| ÷ implied, from the resolved values
  ivBefore: MoveValue | null;
  ivAfter: MoveValue | null;
  ivBeforeBlank: IvBlank | null;     // why a computed IV is missing although its prices exist
  ivAfterBlank: IvBlank | null;
}

function tradeMoves(trade: {
  openedAt: number; closedAt: number | null;
  legs: { right; strike; expiry; quantity; openPrice; closePrice }[];
  ironFly: { underlyingPriceEntry; underlyingPriceExit;
             impliedMovePct; actualMovePct; ivBefore; ivAfter } | null;
}): TradeMoves;
```

- **Short legs** are the legs with a negative quantity. The trade needs exactly one short call and one short put, or every computed value is null. Overrides still apply.
- **Implied** = (short call `openPrice` + short put `openPrice`) ÷ stock at entry.
- **Actual** = (stock at exit − stock at entry) ÷ stock at entry.
- **Ratio** = |resolved actual| ÷ resolved implied. Overrides carry into it. Null if either is missing or implied ≤ 0.
- **IV before** = the mean of the two short legs' `impliedVol` at their `openPrice`, with S = stock at entry and T from `openedAt`. If only one solves, it's that one. If neither solves, it's null with `ivBeforeBlank: "unsolvable"`.
- **IV after** uses the short leg(s) that are out of the money at exit: a call with strike ≥ stock at exit, a put with strike ≤ stock at exit. It takes the mean of their `impliedVol` at their `closePrice`, with S = stock at exit and T from `closedAt`. If neither leg is out of the money, it uses both.
  - If `closedAt` is within 24 h of the expiry moment, it's null with `ivAfterBlank: "near_expiry"`.
  - If nothing solves, it's null with `"unsolvable"`.
  - It needs the legs' exit prices, so it's null on an open trade.
- **Overrides:** a filled `*_pct` or IV column, ÷ 100, replaces that field's value with `source: "override"`. `computed` keeps the fill-derived value, or null.

### 7.4 `moves.ts`: rollups for the Iron flies tab

These run in the browser over the tab's closed, filtered flies, like `keptStats`:

- `movePoints(flies)`: one point per fly with both a resolved implied and actual move. Each point has `{ id, ticker, implied, absActual, netPnl }`.
- `moveRatioBuckets(flies)`: `< 0.5×`, `0.5–1×`, `1–1.5×` and `1.5×+`. Each includes its lower edge and excludes its upper one. Each bucket has `{ label, trades, won, net }`. It uses unrounded ratios, rounded to 1e-9 only to drop float noise: 0.15 ÷ 0.1 is 1.4999999999999998 in JavaScript. It also returns `{ withRatio, without }` for the coverage line, and `{ trades, won, net }` for all flies with ratio ≥ 1.
- `ivCrushHistogram(flies)`: crush = (IV before − IV after) × 100, in points, for flies with both. The bins are `< −50`, `−50…−25`, `−25…0`, `0…25`, `25…50` and `50+`, each including its lower edge. It also returns `{ median, count }`, and the median of an even count is the mean of the two middle values.

### 7.5 `settle.ts` (new)

`settleAtExpiry(legs, close)` works only on the legs with no `closePrice`, and returns for each:

- `exit`: intrinsic value, rounded to cents. That's max(0, S − K) for a call and max(0, K − S) for a put.
- `flag`: `"assigned"` for an in-the-money short, `"exercised"` for an in-the-money long, otherwise null.

It returns null if the open legs don't share one expiry. `settleExpiry(legs)` returns that shared expiry, or null, so the page knows which date's close to ask for. `settleAtExpiry` doesn't compute P&L: the caller uses the existing `positionCash`, the same function the edit form uses, so the two can't disagree.

---

## 8. Server

### 8.1 Fill service (`apps/server/src/moves.ts`)

`createMoveFiller({ db, market, now })` exposes `fill(tradeIds?: string[]): Promise<FillResult>`.

- **Candidates:** iron flies that aren't deleted (excluded ones count) and are missing their entry price, or are closed and missing their exit price. With `tradeIds`, only those; unknown ids and ids that aren't flies are ignored. The entry price is filled even while a trade is open, so the implied move shows before earnings.
- **Order:** oldest `openedAt` first. For each trade, the entry side, then the exit side.
- **For each missing side:**
  1. `moment = sessionMoment(openedAt or closedAt)`.
  2. If the moment's date isn't a trading day (`isTradingDay`), the result is `no_session`, with no call.
  3. If `moment > now − 16 min`, the result is `too_recent`, with no call.
  4. `bars.priceAt(underlying, moment)`. A price is written with `setUnderlyingPrice`. Null is `no_bars`.
- **Calls go one at a time.** The backlog of about 82 calls takes seconds and stays well under the free plan's 200 calls a minute.
- **The first thrown error stops the run.** It's passed to `report()` (so a rejected key turns Settings red, as today), and later calls would fail the same way. Prices already written are kept.
- **One run at a time:** runs queue behind a single promise. A second click waits, then finds almost nothing left to do.
- **No key:** returns `unavailable: no_key` straight away.

### 8.2 `POST /api/moves/fill`

New `routes/moves.ts`, mounted at `/api/moves`. The request body is `{ tradeIds?: string[] }`, with up to 1,000 UUIDs; anything else gets a 400. The answer:

```ts
{
  filled: number,
  missing: { tradeId: string, underlying: string, side: "entry" | "exit",
             reason: "no_bars" | "no_session" | "too_recent" }[],
  unavailable: null | { reason: "no_key" | "unreachable", message: string },
}
```

`missing` lists only the sides this run tried and couldn't fill. After a stop, sides not yet tried are left out. The messages reuse the wording of `/chains`: "Add an Alpaca key in Settings…" and "Alpaca didn't answer…".

### 8.3 `GET /api/close/:symbol?date=YYYY-MM-DD`

Added to `marketRoutes`, with the same ticker and date validation as `/chains`. It answers `{ symbol, date, close: number | null, unavailable }` using `bars.closeOn`, and the same `no_key` / `unreachable` shape.

### 8.4 Import commit

`POST /api/import/oquants/commit` also returns `importedIds: string[]`, so the Import page can fill exactly those trades.

### 8.5 Trades

No new trade route. The trade reply already includes every `iron_fly_details` column, so the two prices reach the browser. `repo.update` gains the stale-price clearing (§5.4) and `writeChildren` the in-place update (§5.3).

---

## 9. Web

### 9.1 Automatic fill

- A shared `useFillMoves()` mutation (mutation key `["fill-moves"]`) posts to `/api/moves/fill`. When it settles, it invalidates `["trades"]` and each `["trade", id]`.
- **After a save:** New iron fly and Edit call it with the saved trade's id, then navigate as they do today. While a fill is running, the trade page's move tiles read "Fetching from Alpaca…" (`useIsMutating`).
- **After an import commit:** the Import page fills the `importedIds` and reports the result, for example "Filled 80 of 82 stock prices. 2 missing, see the Iron flies tab."
- **The key's state** comes from the market status on `GET /api/settings`. Without a key, the buttons are disabled with the tooltip "Add an Alpaca key in Settings". The automatic fill still runs and answers `no_key` quietly.

### 9.2 Trade page tiles

The three existing move tiles are rebuilt and a fourth is added. They get their own row of four, and the five other tiles fit one row of five. They follow the approved mockup, `move-charts.html`:

| Tile | Value | Working (small print) |
|---|---|---|
| Implied move | 7.3% | straddle 1.58 ÷ $21.66 at entry |
| Actual move | −5.3% | $21.66 → $20.51 · 0.73× implied |
| IV before → after | 123% → 77% | crush 46 pts · from your fills |
| Stock at entry / exit | $21.66 / $20.51 | Alpaca, Sep 9 15:54 → Sep 10 15:44 ET |

- **An override** reads "typed", plus "(computed 7.1%)" when the fill data gives a value too.
- **A missing price** is explained on the stock tile only; the other tiles say what they need ("needs the stock at entry"). The reason comes from one of two places:
  - this session's last fill for that trade: "Alpaca has no price for this time; type the moves in Edit.";
  - the page itself: "Not a trading day; type the moves in Edit.", "Alpaca shares prices 15 min after the fact; try Fill in missing later." or "Add an Alpaca key in Settings to fetch stock prices.".

  Otherwise it reads "Not fetched yet.". A "Fill in missing" button sits beside it when a key is set.
- **A blank IV** shows "left blank within 24 h of expiry" or "couldn't solve: price at intrinsic".
- **An open trade** shows the implied move and IV before, with "—" for the exit side.
- The times on the stock tile are the `sessionMoment`s, so they show which bar was read.

### 9.3 "Move overrides" row on the edit form

The form gets one optional row with four inputs: Implied %, Actual %, IV before % and IV after %.
- Each input's placeholder is the computed value from `tradeMoves`, or "auto" on a new trade.
- Blank means use the computed value, and it saves as null.
- The row is sent inside `ironFly` with the fields the form doesn't show (§5.3).
- Actual % accepts a sign.

### 9.4 Iron flies tab

The placeholder section becomes a row of three panels over the tab's filtered, closed flies, as in the mockup:

- **Implied vs actual move** (Recharts scatter):
  - x = implied %, y = |actual| %, with a y = x reference line;
  - dots coloured win or loss with the theme's up and down colours, and sized by |P&L|;
  - a tooltip on every dot, and ticker labels on the five largest |P&L|.
- **P&L by move ratio:** a table of bucket, trades, won and net, with CSS net bars like `SplitGrid`. A footer line: "Moved more than implied: N trades, W won, net $X".
- **IV crush:** a Recharts bar chart of the bins, in the style of the kept histogram. The note reads "Median crush 16 pts over 34 trades. IV after is left blank within 24 h of expiry."
- **Above the row:** "Move data for N of M closed flies", with "Fill in missing" next to it when N < M. N counts flies with both a resolved implied and actual move.

The charts are built following the dataviz skill and the existing chart components, and are tested through the data handed to them (jsdom has no canvas).

### 9.5 Settle panel

- **When it shows:** on the trade page of an iron fly in the existing `closeEstimate` "expired" state, meaning an open leg's expiry is before today in New York, and only when `settleAtExpiry` accepts the legs (one shared expiry). It sits below the tiles; the header keeps "EXPIRED · add exits" in its P&L slot.
- **What it shows:** it fetches `GET /api/close/:symbol?date=<expiry>` and renders:
  - "BB closed at $8.21 on Sep 25. Proposed exits at intrinsic value:";
  - a table of leg, strike, size, entry and exit at expiry, with "(in the money: assigned, not cash)" or "(exercised)" beside flagged legs;
  - "Net P&L if saved: +$433.00 (612 credit − 174 to close − 5 fees)", from `positionCash(legs with exits, { open: feesOpen ?? fees, close: 0 })`.
- **Save these exits** sends one `PATCH /api/trades/:id`:
  - `closedAt` = `expiryMoment(expiry)`;
  - every leg, with the proposed exits filled into the empty ones;
  - `netPnl`, and `feesClose: 0` if it was empty, with `fees` unchanged.
  
  The fill then runs as after any save and gets the exit price from the 15:59 bar.
- **Edit them first** opens `/trades/:id/edit?settle=true`. The edit page asks for the same close, and starts the form with the proposed exits and `closedAt` already filled in. A reload keeps the proposal.
- **No close available** (no key, Alpaca down, or no daily bar): the panel says why and offers only "Edit".

Equity options settle in shares, so an assigned short means the real account got stock. The journal records the cash equivalent at the close, and the flag says so.

---

## 10. Errors and edge states

No failure blocks a save, and each is explained where it shows.

| Situation | Behaviour |
|---|---|
| No key | Fill answers `no_key`. The buttons are disabled with a tooltip. Settle offers only Edit. |
| Key rejected (401, or a 403 other than recent data) | `report()` marks the key rejected, as today. The fill run stops and keeps what it wrote. The answer is `unreachable`. |
| Network error, timeout, 429, 5xx, or a reply that doesn't parse | The run stops and keeps partial writes. The answer is `unreachable`, and the button retries. |
| Recent-data 403 | null (`no_bars`) and the key status is untouched. The service normally skips these as `too_recent` first. |
| Unknown or delisted symbol, a halt, or a 400 "invalid symbol" | `no_bars`. The tile points to the override row. |
| A stored time on a weekend or holiday | `no_session`, with the same hint. |
| A stored time outside market hours | Clamped to 09:31–16:00 on its date. The stock tile shows the time actually read. |
| IV at or below intrinsic, or at the 1000% bound | That IV is blank with "couldn't solve". |
| Exit within 24 h of expiry | IV after is blank with "within 24 h of expiry". |
| A fly without exactly one short call and one short put | Computed values are null. Overrides still show. |
| An edit changes the ticker or a time | The affected price is cleared, and the automatic fill fetches it again. |
| A bad fill request body | 400. Unknown ids are ignored. |
| Open legs with different expiries | No settle panel. The exits are typed in Edit. |
| Migration | Backed up first, as always. |

---

## 11. Changes to the parent spec

- **§6, `iron_fly_details`:**
  - `underlying_price_entry` and `underlying_price_exit` are added now.
  - `move_source` is dropped: `core` reports whether each value is computed or typed.
  - The move values are computed on read, not stored. Only the two prices are stored.
  - The `bars` cache table isn't built by this work.
- **§7.3:**
  - **Actual move** becomes entry to exit, signed: (exit − entry) ÷ entry, with the stock price at the fill times. The announcement-based definition (S_pre and S_post around the earnings release) is dropped, together with earnings timing.
  - **The move ratio** uses |actual|.
  - **IV crush** is in points (before − after), not a percentage of IV before.
  - "Imported values take precedence" becomes "typed overrides take precedence", since oQuants exports none.
- **§8.2:** this feature reads historical bars from Alpaca (free SIP historical minute and daily bars), not Massive. The Phase 2 chart can decide separately.
- **§8.3:** `core/pricing` starts here, with bisection on [1%, 1000%] and a fixed 4% rate. Phase 2 adds Newton-Raphson and the rate setting.
- **§8.6, "Estimates never become records":** settling writes exits only when the user confirms, and from the official close, which is a fact rather than an estimate.
- **§9, Iron fly page:** the three move charts are done by this spec.
- **§13, Phase 1 item 7:** the move charts are done. P&L attribution remains.

---

## 12. Testing

- **`core/calendar`:**
  - `nyWallClock` on both sides of each DST switch (2026-03-08 and 2026-11-01);
  - `sessionMoment` before the open, after the close, on a half day, and with seconds;
  - `expiryMoment` in summer and in winter.
- **`core/pricing`:**
  - the textbook values: S = K = 100, T = 1, r = 5% and σ = 20% give a call of 10.4506 and a put of 5.5735;
  - a fast-check round trip: price at σ and solve, and σ comes back within 1e-4;
  - null at T ≤ 0, at intrinsic, and at the upper bound.
- **`core/moves`:**
  - the M fixture gives 7.3%, −5.3%, 0.73× and 123% → 77%;
  - overrides win, and `computed` is kept;
  - IV after within 24 h of expiry is blank;
  - the OTM leg choice, and the fallback to both legs;
  - a missing short leg, and an open trade;
  - bucket edges at exactly 0.5, 1 and 1.5, with unrounded ratios;
  - crush bins, and the median for odd and even counts.
- **`core/settle`:** the BB fixture: $8.21 gives the short put 0.29 (assigned) and 0 for every other leg. With `positionCash`, that's +$433.00. Also covered: legs already closed are kept, and mixed expiries give null.
- **`market-data` bars client**, with a fake fetch in the existing pattern:
  - it picks the last bar before the moment, across gaps;
  - `{}`, null and a missing symbol give null;
  - the URL carries `feed=sip`, `adjustment=raw` and the 09:30 start;
  - a recent-data 403 and an invalid-symbol 400 give null, and any other failure throws;
  - `closeOn`.
- **`db`:**
  - migration 0002 applies;
  - an edit through `update` keeps the prices and the overrides;
  - changing `underlying`, `openedAt` or `closedAt` clears the right price;
  - `setUnderlyingPrice` never overwrites.
- **Server:**
  - fill with fake bars and a fake clock: filled, `too_recent`, `no_session`, `no_bars`;
  - it stops on the first error and keeps the writes before it;
  - `no_key`;
  - two runs at once are serialized;
  - a bad body gets a 400;
  - `/close`, and `importedIds` in the commit reply.
- **Web** (Vitest + Testing Library):
  - the tiles: computed, typed with its computed value, fetching, each missing reason, and an open trade;
  - the override row round-trips, and saving doesn't wipe the earnings or source fields;
  - save and import trigger the fill;
  - the buttons are disabled without a key;
  - the Iron flies panels from a fixture: the coverage line, the ratio table and the crush note;
  - settle: the BB preview, "Save" sends the right PATCH, and the fallbacks when there's no close.
- **Live check** on the real journal:
  - run "Fill in missing" and compare against §3;
  - settle BB and expect +$433.00;
  - take screenshots at 1280 and 1024 px with the headless recipe.
- Lint, typecheck, build, and CI on Ubuntu and Windows.

---

## 13. Open items

1. **Stored times outside market hours.** Some imported trades carry open or close times outside the session (CRM "18:11 ET", PATH "07:45"), probably a timezone quirk in the oQuants import. Clamping gives a usable price, but the cause is worth checking in the importer separately.
2. **Rate limit on the backlog.** Resolved. The live fill on 2026-09-28 made 83 sequential calls in 10.4 s, with no 429.
3. **Half days.** Resolved 2026-10-08. `sessionMoment` clamps to the date's own close (13:00 on a half day), and `expiryMoment` puts a half day's expiry at 13:00. The 16:00 clamp had read after-hours bars, since a half day's after-hours session trades from 13:00.
4. **Live check, 2026-09-28** (a copy of the real journal, the real paper key):
   - The fill wrote all 83 prices (41 closed flies × 2, plus BB's entry), with none missing. BB's close on 2026-09-25 is $8.21, and the settle panel shows +$433.00.
   - M matches §3 exactly: $21.66 → $20.505, 7.3%, −5.3%, 0.73×, IV 123% → 77%. Every trade's prices match the spike.
   - The ratio buckets are `< 0.5×` 19 trades, 16 won, +$2,720; `0.5–1×` 10, 6, +$702; `1–1.5×` 7, 0, −$1,478; `1.5×+` 5, 0, −$4,218. They differ from §3 by one trade, NIO (+$410). Its stock moved exactly $0.21 on a $0.42 straddle, so its ratio is exactly 0.5 and belongs in `0.5–1×`. JavaScript computes 0.49999999999999994, which the spike counted below 0.5. The 1e-9 float-noise guard (§7.4) puts it on the right side of the edge.
5. **IV after is blank for most flies.** 23 of the 41 closed flies were closed within 24 h of expiry, so their IV after is left blank (§7.3). The IV crush chart therefore shows 18 trades (median crush 31 pts), where the spike counted 34. PATH's IV before doesn't solve either: its stored open time is the 07:45 import quirk. A shorter cutoff would bring most trades back, but KLAR, closed 5.9 h before expiry, solved to 665%. That's the user's call.
