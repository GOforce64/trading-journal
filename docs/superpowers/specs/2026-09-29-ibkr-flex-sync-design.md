# IBKR Flex Sync and Scalps — Design Spec

- **Date:** 2026-09-29
- **Status:** Approved; implemented on feat/ibkr-sync. Plan: [2026-09-29-ibkr-flex-sync.md](../plans/2026-09-29-ibkr-flex-sync.md), whose deviations are folded in below.
- **Scope:**
  - **The sync:** trades from the IBKR paper account come into the journal from the Flex Web Service, from 2026-09-28 on. A Sync button starts it, and so does opening the app when the last sync is more than 15 minutes old.
  - **Grouping:** every fill is kept, and the fills are regrouped into trades on every sync. Scalps become scalp trades and flies become iron fly trades, without mixing the two up or duplicating what oQuants already imported.
  - **Scalps in the app:** a Scalps page, a scalp trade page with a Fills panel, and a scalp form for entering older scalps by hand.
  - **Your edits win:** a change you make to a synced trade is never overwritten by a later sync.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md). This is Phase 2, step 1 (§13). It details §8.1 and changes it where the account's real data says otherwise (§11).

---

## 1. Purpose and success criteria

The user's scalps are half their trading, and the journal has none of them. The iron flies they place in IBKR paper will soon come from IBKR rather than from oQuants. This work brings both in automatically, and keeps them correct and separate.

Success means:

- Opening the journal after a session shows that day's scalps, with the right P&L and fees. No button needs pressing.
- A fly entered in IBKR as four separate orders, in two lots, becomes **one** iron fly trade, never four scalps.
- Nothing from before 2026-09-28 comes in. None of the 42 flies imported from oQuants is duplicated, including during the few days when flies are still logged in oQuants as well.
- A number the user corrects on a synced trade stays corrected.
- Older scalps can be typed in with a scalp form, like flies can today.
- The live check: syncing a copy of the real journal brings in this morning's NVDA 232.5C (+$44.74) and TSLA 365P (+$300.55) scalps, and nothing else.

### Out of scope

- **The live account.** Paper only for now. The design stores which account each trade belongs to, so live is a second set of credentials later.
- **Grades, setups, tags, the review queue, stops and R.** These come with the scalp-review step (parent spec Phase 2, step 3), where the stop and R numbers they depend on are built.
- **Trade charts and the bars cache** (Phase 2, step 2).
- **Short single-leg scalps** in the scalp form. The user's scalps are bought calls and puts.
- **Stock positions**, including shares delivered by an assignment. They're ignored and counted.
- **Multi-leg structures other than iron flies** (verticals, strangles, a fifth leg). They're skipped with a reason, to be entered by hand.
- **Syncing on a timer while the app is open.** It syncs on open and on the button only.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Accounts | Paper only (DUR202994). The token comes from the paper account's own Settings. |
| Queries | Two Flex queries per account: **`TJ Activity`** (Activity, the last 365 days, which ends at the previous business day) and **`TJ Today`** (Trade Confirmation, today). The user's IDs are 1653145 and 1653147. |
| Start date | **2026-09-28**, a New York trade date, set in Settings. Fills before it are never stored. |
| When it syncs | The **Sync now** button, plus **automatically on app open** when the last sync is more than 15 minutes old. The server decides the 15 minutes, so two tabs can't double-sync. |
| Storage | **Every fill is kept** in a `fills` table, and all trades are regrouped from the fills on every sync (approach A). Rejected: rebuilding from IBKR's window with no fills table (no audit trail; depends on IBKR's window), and import-once (open positions could never complete). |
| Grouping | **By position, not by order.** IBKR sends every fly leg as its own order (§3), so episodes per ticker and expiry, classified by how each contract was opened. |
| Duplicates | Deterministic ids, as §8.1 says, plus two guards: a synced fly that matches a fly from oQuants or typed by hand, and a synced scalp that matches a scalp typed by hand. Either is skipped as "already in the journal". |
| Ownership | The sync owns the broker's facts, and the user owns the review side. **The user's edits win:** once the user changes a fact, the sync stops rewriting that trade until the user chooses **Use IBKR's numbers**. |
| Scalp form | Included. One long leg, picked from the Alpaca chain, with typing as a fallback. |
| New dependency | `fast-xml-parser` in `@tj/importers`, as the parent spec names it. |

---

## 3. What the spike found (2026-09-28/29)

A read-only call with the user's paper token fetched both queries. The raw statements are kept outside the repo.

- **Paper supports the Flex Web Service.** The token is in the paper account's own Settings, next to the Flex queries.
- **`TJ Activity`** covers DUR202994 from 2025-09-26 to 2026-09-25, with the period "Last365CalendarDays". It holds 917 option `<Trade>` rows (level `EXECUTION`) and 61 `<OptionEAE>` rows.
- **`TJ Today`** covers 2026-09-28, with the period "Today". It has 7 `<TradeConfirm>` rows: the user's NVDA 232.5C and TSLA 365P scalps from that morning.
- **Times are New York time.**
  - IBKR has the AA fly opening at 13:52:42 and 13:53:13 ET. oQuants recorded 13:54 ET.
  - The AA fly in IBKR is the same trade as the oQuants one. The oQuants flies mirror the IBKR paper account, so the start date is essential.
- **The two queries name their fields differently:**

  | | Activity `<Trade>` | Today `<TradeConfirm>` |
  |---|---|---|
  | Execution id | `ibExecID` | `execID` |
  | Order id | `ibOrderID` | `orderID` |
  | Price | `tradePrice` | `price` |
  | Commission (negative) | `ibCommission` | `commission` |
  | Open or close | `openCloseIndicator` (`O`, `C`) | inside `code` (`O`, `C`, `O;P`) |

  Both have `tradeID`, `conid`, `underlyingSymbol`, `putCall`, `strike`, `expiry` (`20260717`), `multiplier`, a signed `quantity`, `buySell`, `dateTime` (`20260716;135242`), `tradeDate` and `transactionType`. Execution ids have the same format in both (`0000e242.6ab9e843.01.01`).
- **Flies are never combo orders.** **0 of 653 orders** span more than one contract. The AA fly's four legs went in as four orders in the same second, twice (one lot each).
- **Expiries and exercises are `BookTrade` rows** at 16:20 on the expiry date, at price $0. Their `notes` are `Ep` (expired) or `Ex` (exercised), and `A` would be assigned.
  - They have **no execution id** but always a `tradeID`.
  - The matching `<OptionEAE>` row carries a `markPrice`: $0.42 on the CLF 11.5C exercise. That's the leg's value at expiry.
- **Cancels:** a `TradeCancel` row (CZR, 2026-07-17) points to the canceled fill's `tradeID` through `origTradeID`. The original fill still appears as its own row.
- **Stock rows** appear too: shares from exercises and assignments, and the user's own stock trades.
- **The year's history splits cleanly** by ticker and expiry: **51** episodes that opened by selling calls and puts (flies), **30** that only bought (scalps), and **6** others.

---

## 4. Architecture

```
App open ──(auto, ≥ 15 min since last)──┐        Import / Sync "Sync now"
                                        ▼                    │
                           POST /api/ibkr/sync { auto } ◄────┘
                                        │
                     createIbkrSync (server) ── one run at a time
                                        │
      ibkrFlex(token).statement(TJ Today), then (TJ Activity)   ── @tj/importers/ibkr/flexClient
                                        │  XML
                         parseFlex(xml) → fills, cancels         ── @tj/importers/ibkr/parse
                                        │
         store fills (≥ start date; Activity wins; canceled flag)      ── @tj/db ibkr repo
                                        │
                 groupFills(all fills since the start date)      ── @tj/importers/ibkr/group
                                        │  trade candidates
        guards: deleted · already in the journal · your edits
                                        │
       one transaction: insert / update / orphan / link fills; sync_state
                                        │  summary + changedTradeIds
                                        ▼
        browser: refetch trades; move-data fill for changed flies
```

---

## 5. Data model

Migration `0003` (drizzle-kit, `--name ibkr_sync`) adds two tables and one column, and changes nothing else.

### 5.1 `fills`

One row per IBKR execution, expiry, exercise or assignment. These are facts: nothing but the sync writes them.

| Column | Meaning |
|---|---|
| `id` | `UUIDv5("ibkr:{accountExternalId}:{key}")`. The key is the execution id, or `trade-{tradeID}` for bookings without one. |
| `account_id` | → `accounts.id` |
| `broker_exec_key`, `broker_trade_id`, `broker_order_id`, `conid` | IBKR's ids. `broker_trade_id` lets a cancel find its fill. |
| `underlying`, `right`, `strike`, `expiry` (YYYY-MM-DD), `multiplier` | The contract. |
| `executed_at` | Epoch ms, from IBKR's New York `dateTime` (seconds kept). |
| `quantity` | Signed: + bought, − sold. |
| `price` | Per share. For an exercise or assignment, the `OptionEAE` `markPrice`. |
| `commission` | Positive dollars. |
| `open_close` | `O`, `C` or null, from IBKR. |
| `kind` | `trade`, `expiration`, `exercise` or `assignment`. |
| `origin` | `confirm` or `activity`: which statement last wrote the row. |
| `canceled` | Set once IBKR cancels the fill. It sticks; the fill is kept and ignored. |
| `trade_id`, `leg_id` | Set by the regrouping; null when skipped. |
| `raw` | The source row as JSON, for audit. |
| `created_at`, `updated_at` | |

### 5.2 `sync_state`

One row per source: `source` (the primary key, `"ibkr"`), `account_id` (nullable: a run that fails before any statement names the account, such as a rejected token, is still recorded and shown), `last_run_at`, `last_status` (`ok` | `error`), `last_error`, `last_summary` (JSON, §8.2).

### 5.3 `trades.facts_edited_at`

A new nullable epoch-ms column. `repo.update` sets it when a patch **actually changes** a sync-owned value (§5.5): a leg, a price, a size, a time, fees, P&L or the fly's structure. Saving the fly form sends the legs every time, so the values are compared, not just the keys. Times are compared **to the minute**, because the forms drop seconds. Notes, exclude, the move overrides and earnings fields never set it.

### 5.4 Accounts and synced trades

- **The account** is created by the first sync, from the statement's `accountId`:
  - id `UUIDv5("ibkr-account:{accountId}")`;
  - name "IBKR paper";
  - broker `ibkr`;
  - kind `paper` for the `DU` prefix, otherwise `live`;
  - `external_id` = `accountId`.
- **A synced trade** is a normal `trades` row:
  - `source = ibkr_flex`, with the account set;
  - `book` from the account's kind;
  - `editedAt` null until the user edits it.
- **Ids:** a trade is `UUIDv5("ibkr:{accountExternalId}:{first opening fill's key}")` and a leg is `UUIDv5("{tradeId}:{conid}")`.
- **Shape:** a scalp has one leg. A fly also has its `iron_fly_details`.

### 5.5 Who owns what on a synced trade

| The sync owns (the broker's facts) | The user owns |
|---|---|
| `strategy`, `underlying`, `structureLabel`, `openedAt`, `closedAt`, `netPnl`, `fees`, `feesOpen`, `feesClose`, `accountId`, `book`, every leg; the fly's `bodyPutStrike`, `bodyCallStrike`, `putWingStrike`, `callWingStrike`, `contracts`, `creditPerShare`, `netCost` | `underlyingName`, `notes`, `grade`, `setupId`, tags, `excluded`, `excludeReason`; the fly's earnings fields, the four move overrides, `sourceNotes`; the fetched stock prices (move data) |

- A sync writes only its own columns, and **only when something changed**. `updatedAt` stays meaningful for the machine merge (parent §12).
- A sync **never writes a trade with `facts_edited_at` set.**
- A sync never brings back a deleted trade.

### 5.6 Credentials

These go in `secrets.json`, next to the Alpaca key and with the same `0600` mode:

```json
"ibkr": { "token": "…", "activityQueryId": "1653145", "todayQueryId": "1653147", "since": "2026-09-28" }
```

Both machines need the same `since` to produce identical trades, and the Settings page says so.

---

## 6. The IBKR client and parser (`packages/importers/src/ibkr/`)

### 6.1 `flexClient.ts`

`ibkrFlex({ token, fetch?, sleep? })` exposes `statement(queryId): Promise<string>`, the XML.

- **Request:** `GET https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t={token}&q={queryId}&v=3`, with a `User-Agent` header. It returns a `ReferenceCode` and a `Url`.
- **Polling:** `GET {Url}?t={token}&q={ReferenceCode}&v=3`, until the body is a `<FlexQueryResponse>`.
  - `ErrorCode` 1019 (still generating) and 1018 (too many requests) mean wait and retry.
  - Waits are 2, 4, 8, 16 and then 20 s, stopping after about 120 s in total.
- **Errors** are `FlexError(kind, message)`:
  - `token` for an expired or invalid token (codes 1012, 1015, and IBKR's other token codes, matched on the message as a fallback);
  - `query` for an unknown query;
  - `slow` for still generating, or still throttled, at the limit;
  - `unreachable` for a network failure or a timeout;
  - `failed` for anything else, with IBKR's own message.
- **The token** goes into the URL, as IBKR requires, but never into an error message or a log line.
- `checkQuery(token, queryId)` runs `SendRequest` alone. Settings uses it to test credentials cheaply.

### 6.2 `parse.ts`

`parseFlex(xml)` returns `{ accountId, kind: "activity" | "confirm", fromDate, toDate, fills: ParsedFill[], cancels: { tradeId, quantity, price }[], ignored: { stock, other, malformed } }`.

- **Parsing:** fast-xml-parser with attributes kept as strings, so no id becomes a number.
- **Rows read:** Activity `<Trade>` and `<OptionEAE>`, and Today `<TradeConfirm>`. Only `assetCategory = OPT`; stock rows are counted as `stock`.
- **Mapping:** the table in §3, into one `ParsedFill` shape, with commissions as positive dollars.
- **Time:** `dateTime` is New York time and becomes epoch ms through core's `nyWallClock`, plus seconds. A row with a date and no time gets 16:20 New York.
- **Kind:**
  - `ExchTrade` is `trade`.
  - `BookTrade` is `expiration` when its notes say `Ep`, `exercise` for `Ex`, and `assignment` for `A`.
  - An exercise or assignment takes its price from the `OptionEAE` row with the same `tradeID`, which both rows carry (`markPrice`). If there's none, the price is $0 and the row is counted as malformed for the summary.
- **Open or close:** `openCloseIndicator`, or `O` / `C` found in `code`, stored as `open_close`.
- **Cancels:** `TradeCancel` rows go to `cancels` with their `origTradeID`, size and price, and are not fills themselves. IBKR re-books a corrected fill under the **same** trade id (the CZR 2-lot was canceled and re-booked as a 1-lot, `.01.01` and `.01.02`), so the size and price pick the fill that was canceled.
- **Validation:** each row is checked with zod. A malformed row is counted and skipped; it never fails the parse.

---

## 7. Grouping fills into scalps and flies (`packages/importers/src/ibkr/group.ts`)

`groupFills(fills)` is pure. It takes the non-canceled fills of one account and returns `{ candidates: SyncedTradeCandidate[], skipped: { reason, ticker, openedAt, fillIds }[], links: Map<fillId, { tradeId, legId }> }`.

1. **Episodes:**
   - Sort the fills by `executed_at`, then by key.
   - Walk each ticker-and-expiry bucket, tracking the net position per `conid`.
   - An episode starts when the whole bucket is flat and a fill arrives, and ends when every contract in it is flat again.
   - An episode still open at the end stays open.
2. **Classification**, by how each contract was opened. The opening fills are those marked `O`, or, where IBKR gave no mark, those that grow the position.
   - **Every contract opened by buying → scalps.** Each contract is split into its own round trips, flat to flat, and each round trip is one scalp with one leg.
   - **Some contract opened by selling → a multi-leg candidate.** It's an **iron fly** when it has exactly one short call, one short put, and at most one long call and one long put (core's `ironFlyStructureFromLegs`; 1-wing flies count). Otherwise it's skipped: "unrecognised structure, enter it by hand".
   - **A closing fill before any opening fill** for its contract means the episode is skipped: "opened before the start date".
3. **Legs, per contract:**
   - `quantity` is the total opened, signed.
   - `openPrice` is the size-weighted average of the opening fills.
   - `closePrice` is the size-weighted average of the closing fills, and only once the contract is flat; otherwise null.
   - Expiries close at $0, and exercises and assignments at `markPrice`.
4. **The trade:**
   - `openedAt` is the first fill. Once everything is flat, `closedAt` is the last **exchange** fill that closed a position. Expiry bookings (16:20) count only when nothing else closed the trade: the AA fly's body was bought back at 09:52 and its wings expired untouched, and move data reads the exit stock price at `closedAt`. While anything is open, it's null.
   - `feesOpen` and `feesClose` are the commissions of the opening and closing fills, each rounded to cents. `fees` is the sum of those two rounded parts, as the forms add them, so re-saving a trade can't move its fees by a cent.
   - `netPnl` comes from `positionCash(legs, { open, close })`.
   - A fly's details are computed as the fly form computes them: `ironFlyStructureFromLegs`, `contracts`, `creditPerShare = −(netCost − fees) ÷ shares`, and `netCost`.
   - Labels are "Long call" or "Long put", and "Short Iron Butterfly".
5. **Ids** are deterministic (§5.4). The same fills, in any order, give the same candidates.

**A fly winding down takes no new contracts.** Once all of a fly's short legs are bought back, its episode is only waiting for the wings to expire at 16:20. A fill on any other contract starts its own episode, so a 0DTE scalp the morning after a 1-DTE earnings fly is a trade of its own, even though it shares the fly's expiry.

**Known edge:** a scalp in the **same ticker and expiry while the fly's short legs are still open** joins the fly's episode. That episode then has five legs and is skipped as unrecognised, and the summary names it. A fly synced before that keeps its last synced state, with its notes (§8.1, orphans).

---

## 8. Sync service, endpoints and Settings

### 8.1 `createIbkrSync({ db, config, client, now })`

This is `apps/server/src/ibkr/sync.ts`. `sync({ auto })` returns a summary. A second call while one is running gets that run's result.

1. **Configured?** With no token or query IDs, it answers `{ status: "not_configured" }`.
2. **Recent?** With `auto` and a `last_run_at` less than 15 minutes ago, it returns the last summary with `ran: false`.
3. **Fetch** `TJ Today`, then `TJ Activity`, and parse both.
   - A `token` or `query` error on Today stops the run.
   - An Activity failure after Today worked makes the run **partial**: today's fills go in, and `activityFailed: true`.
4. **Account:** find or create it from the statement's `accountId`.
5. **Everything below happens in one transaction**, after all network calls:
   - **Store fills.** Drop fills whose `tradeDate` is before `since`, and count them. Insert new ones. An Activity row replaces a `confirm` row with the same key (final commissions). Mark the cancels, each on the first fill with its trade id, size and price.
   - **Regroup.** Run `groupFills` over the account's fills on or after `since`.
   - **Guards, per candidate:**
     - A trade with the candidate's id that was deleted is skipped: "deleted".
     - **Already in the journal:** a fly with the same ticker, expiry and body strike(s), opened the same New York day, from any non-IBKR source (oQuants or typed). For a scalp, a typed scalp on the same contract (ticker, right, strike, expiry) opened the same New York day. Either is skipped: "already in the journal". The oQuants import applies the same test the other way round: a fly already synced from IBKR shows as "already synced from IBKR" and is never imported, because for a few days flies are logged in both.
     - **Your edits:** a trade with `facts_edited_at` set is not written. If the candidate differs from it, the summary adds "kept your edits".
   - **Write.**
     - Insert new trades (`source = ibkr_flex`).
     - Update the sync-owned columns of existing ones, only if they changed. A moved time or ticker clears the stale stock price, reusing the repo's `stalePrices`.
     - Replace the legs when they changed.
     - Update the fly's structure columns in place.
   - **Orphans.** A synced trade of this account whose id no candidate produced is soft-deleted, unless:
     - it has `facts_edited_at`;
     - its first fill is before `since` (a start date that moved later);
     - or its fills now sit in an episode grouping skipped. It then keeps its last synced state and its fill links, and the skip is reported.
   - **Link** each fill to its trade and leg.
6. **Record** the run in `sync_state`.

### 8.2 The summary

```ts
{
  status: "ok" | "error" | "not_configured";
  ran: boolean;
  account: { externalId: string; kind: "paper" | "live" } | null;
  added: number; updated: number; unchanged: number; orphaned: number;
  skipped: { reason: "before_start" | "unrecognised" | "duplicate" | "deleted"; ticker: string; openedAt: number }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];   // IBKR's own net P&L
  ignored: { beforeStart: number; stock: number; other: number; malformed: number };
  activityFailed: boolean;
  changedTradeIds: string[];          // added or updated, for the browser's move-data fill
  error: { kind: "token" | "query" | "slow" | "unreachable" | "failed"; message: string } | null;
  lastRunAt: number | null;
}
```

### 8.3 Endpoints

- **`POST /api/ibkr/sync`**, body `{ auto: boolean }`, answers the summary. It's 200 even for an IBKR error; the error is in the body.
- **`GET /api/ibkr/status`** answers `{ configured, since, lastRunAt, lastStatus, lastError, lastSummary }`.
- **`POST /api/ibkr/trades/:id/reset`** clears `facts_edited_at` and runs a sync, so the broker's numbers apply. This is the "Use IBKR's numbers" action. It answers the summary.
- **`GET /api/trades/:id`** also answers the trade's `fills`, for the Fills panel. The list route doesn't include them.

### 8.4 Settings

- `GET /api/settings` gains `ibkr: { configured, tokenHint, activityQueryId, todayQueryId, since }`. `tokenHint` is the first 2 and last 4 digits. **The token is never sent back.**
- **`PUT /api/settings/ibkr`** takes `{ token?, activityQueryId, todayQueryId, since }`.
  - The token is optional when one is already saved.
  - Query IDs must be digits, and `since` must be a real date no later than today in New York.
  - **Both queries are tested with `checkQuery` before saving.** The answers: 400 `token_rejected`, 400 `query_not_found` (naming which one), or 503 `unreachable`.
- **`DELETE /api/settings/ibkr`** removes the block.
- Writes go through the existing secrets file handling, including its "broken file" refusal.

---

## 9. Web

### 9.1 Navigation and lists

- **Scalps** is added to the nav after Iron Flies. It's the Journal locked to `strategy: "scalp"`, with a **+ New scalp** button, the way Iron Flies works.
- Scalps also appear in the Journal, the Dashboard and Analytics Overview, which count every trade. "% kept" shows "—" for a scalp.

### 9.2 Import / Sync

A new **IBKR** card sits above the oQuants import.

- **The status line:**
  - "Paper DUR202994 · last synced 10:32 · 2 added, 1 updated";
  - "Not set up. Add your Flex token and query IDs in Settings.";
  - or the last error.
- **Sync now** reads "Syncing with IBKR…" while it runs; a statement can take up to a minute.
- **The last run's details:**
  - skipped trades with their reasons, in plain words;
  - "kept your edits" trades, with links;
  - ignored rows ("3 stock rows ignored");
  - "The Activity statement failed; today's fills are in." when that happened.

### 9.3 Auto-sync on open

The app shell sends one `POST /api/ibkr/sync { auto: true }` when the app loads. A `useRef` guard keeps React's StrictMode double effect to one request. The nav's plain links reload the page, and the server's 15-minute rule answers those repeats.

- While it runs, the Import / Sync nav item shows a small spinner.
- When it finishes, `["trades"]` and `["trade"]` are invalidated, and the move-data fill runs for `changedTradeIds`.
- Nothing pops up; errors show on the Import card.

### 9.4 Settings

An **IBKR Flex** section next to the Alpaca one:

- the token (hidden; showing the hint once saved);
- the Activity and Today query IDs;
- the start date, defaulting to today's New York date, with "Both machines need the same start date.";
- **Save**, which tests the queries first, and **Remove**.
- A line points to where each value is found in Client Portal.

### 9.5 The trade page

It adapts to the strategy.

**Scalp tiles:**

| Tile | Example |
|---|---|
| Contract | NVDA 232.5C · exp Sep 28 |
| Size | 2 contracts |
| Entry → exit | 1.06 → 1.295 (average fill prices) |
| Held | 15 min |
| Fees | $2.26 |
| Return on cost | +21.1% (net P&L ÷ quantity × multiplier × entry price) |

**Also on the page:**

- **A Fills panel** on every synced trade, flies included. It lists the time (ET), buy or sell, size, price and commission. Expiries, exercises, assignments and canceled fills are labelled.
- **When the user has changed a synced trade's facts,** a banner reads "Your edits are kept. Later syncs won't change this trade." It carries a **Use IBKR's numbers** button. If the last sync saw a difference, it adds IBKR's net P&L: "IBKR now has +$44.74 net."
- The Review panel (notes, exclude) is unchanged.

### 9.6 The scalp form

The form is at `/scalps/new`. It's also the edit form for scalps; `EditTrade` picks the form by strategy.

- **Fields:**
  - underlying, with the company filled in automatically;
  - call or put;
  - expiry and strike, from the Alpaca chain, with typing as a fallback (the existing `ChainPickers`);
  - size (whole contracts);
  - entry and exit price;
  - opened and closed times;
  - entry and exit fees;
  - book (live or paper);
  - notes.
- **A Derived panel** shows the cost, P&L before fees, net P&L and return on cost as you type, all from `positionCash`.
- **Saving** creates `strategy: "scalp"` with one long leg, `structureLabel` "Long call" or "Long put", and `source: "manual"`.
- **On a synced trade,** the form shows: "Synced from IBKR. Changes you make here are kept: later syncs won't overwrite them." The same note appears on the fly form for synced flies.
- **After saving,** the move-data fill runs only for flies. Scalps have no move data.

---

## 10. Errors and edge states

No failure leaves half a sync behind: every database write happens in one transaction, after IBKR has answered.

| Situation | Behaviour |
|---|---|
| Not set up | The card points to Settings. The auto-sync is silent. |
| Token rejected or expired | The run stops: "IBKR rejected the token. It may have expired (tokens last up to a year). Generate a new one in Client Portal and save it in Settings." It shows until a sync succeeds. |
| Wrong query ID | Settings refuses it, naming which one. A sync says the same. |
| Still generating after about 120 s | "IBKR is still preparing the statement. Try again shortly." Nothing is written. |
| Too many requests | Backoff within the run. If it persists: "IBKR asked us to slow down. Try again in a minute." |
| Network down or timeout | "Couldn't reach IBKR." Nothing is written. |
| Activity fails, Today works | A partial run: today's fills go in, the card says so, and the next sync catches up. |
| A malformed row | Counted and skipped; the rest of the sync goes on. |
| An exercise with no `OptionEAE` row | That fill is priced $0 and counted as malformed, and the summary names it. |
| Fills before the start date | Never stored; counted. |
| Two syncs at once | One run; both get its summary. |
| A deleted trade | Never brought back; its fills are stored. |
| A trade the user edited | Never written. "Kept your edits" appears, with a banner if IBKR differs. |
| The start date moved later | Trades already synced before it stay; nothing is deleted. |
| The start date moved earlier | Older fills come in, within Activity's 365 days. The duplicate guards stop copies of typed scalps and oQuants flies. |
| Unrecognised structure, or a close with no open | Skipped with the reason. The user can type the trade in. |
| `secrets.json` unreadable | Settings shows the existing "broken file" message, and a sync answers `not_configured`. |
| Migration 0003 | Backed up first, as always. |

---

## 11. Changes to the parent spec

- **§6:**
  - `fills` gains the columns in §5.1: `broker_trade_id`, `conid`, the contract, `open_close`, `kind`, `origin`, `canceled`.
  - `trades` gains `facts_edited_at`.
  - `sync_state` carries `last_summary`.
  - `scalp_details` is not built yet (it comes with R).
- **§8.1:**
  - **Paper supports the Flex Web Service**, with its own token. The queries are an Activity query **and a Trade Confirmation query**, because Activity queries stop at the previous business day.
  - **Grouping is by position episode, not by order.** The rule "a multi-leg order is detected when one order ID has fills across more than one contract" never fires for this account: 0 of 653 orders do. **Iron flies are imported as iron fly trades**, not skipped. Other multi-leg structures are skipped with a reason.
  - **A start date** bounds the sync, and two duplicate guards protect trades from oQuants and trades typed by hand.
  - The trade id's "first opening execId" becomes the first opening fill's key, which covers bookings without an execution id.
  - **The review queue** moves to the scalp-review step, together with stops, setups and grades.
- **§12:** `facts_edited_at` complements `edited_at`. Once the user edits a synced trade's facts, the sync leaves them alone, and "last writer wins" is settled in the user's favour until they choose "Use IBKR's numbers".
- **§13, Phase 2, item 1:** it adds the scalp form, the Scalps page and the scalp trade page. The review queue moves to item 3.
- **§16, item 2:** resolved by §3 above. What remains is in §13 below.

---

## 12. Testing

- **The parser**, on trimmed copies of the real statements, with the account renamed `DU1234567`:
  - the AA fly's eight opening fills, its closing fills, and two expiries at $0;
  - the CLF exercise at $0.42;
  - the CZR cancel in `cancels`, canceling only the original fill;
  - stock rows ignored and counted;
  - 13:52:42 New York in July becoming 17:52:42Z, and a row with no time getting 16:20;
  - Today and Activity rows giving the same fill shape;
  - positive commissions, and ids that stay strings;
  - a malformed row skipped.
- **The client**, with a fake fetch and an instant sleep:
  - a reference code, then two "still generating" replies, then the statement;
  - token codes throwing `FlexError("token")`;
  - giving up after about 120 s;
  - the `User-Agent` header sent;
  - **the token absent from every error message**;
  - `checkQuery`.
- **Grouping:**
  - NVDA 232.5C at **+$44.74** and TSLA 365P at **+$300.55**, from the Today fixture;
  - the AA fly as one iron fly (40 / 47 / 54, 2 contracts). Its structure and credit match the oQuants AA row ($2.65 × 2), and its net P&L is IBKR's **+$27.32**. It doesn't reconcile to the cent with oQuants' $33.56: oQuants rounds the 47C close to 0.33 (IBKR 0.325), books the expiring wings at 0.01 (IBKR 0), and uses its own fee model ($6.44 against IBKR's $9.68);
  - two strikes bought at once becoming two scalps, and two round trips in one contract becoming two trades;
  - an unsold contract as an open trade;
  - "opened before the start date" and "unrecognised structure";
  - the same ids for the same fills in any order;
  - a **fast-check property**: every fill lands in exactly one trade or is skipped, and the trades' net P&L equals the fills' cash minus commissions.
- **Database:**
  - migration 0003 applies;
  - Activity replaces confirm, and `canceled` sticks;
  - a new synced trade is inserted, an **unchanged one is not rewritten** (`updatedAt` stays), and an update rewrites only the sync's columns (notes and overrides survive);
  - a deleted trade is not brought back;
  - **`facts_edited_at` is set when legs actually change, and not by notes or by an unchanged fly-form save**;
  - a flagged trade is never written or orphaned;
  - a moved time clears the stale stock price.
- **Server:**
  - a first sync adds, a second is unchanged;
  - `auto` within 15 minutes doesn't run;
  - a token error;
  - a partial run when Activity fails;
  - both duplicate guards;
  - one run at a time;
  - the reset endpoint;
  - Settings tests queries before saving, and **never returns the token**;
  - `GET /api/trades/:id` includes fills.
- **Web:**
  - the Settings IBKR section: saving, the hint, errors;
  - the Import card: status, Sync now, reasons in words;
  - the auto-sync firing once on open;
  - the Scalps page;
  - the scalp tiles and the Fills panel;
  - the scalp form: live P&L, the saved payload, typing without a chain;
  - the synced-trade note, and the "Use IBKR's numbers" banner.
- **Live check** on a copy of the real journal, with the real paper token:
  - a sync brings in NVDA +$44.74 and TSLA +$300.55, and nothing before 2026-09-28;
  - a second sync changes nothing;
  - screenshots at 1280 and 1024 px of Scalps, the scalp trade page, the Import card, Settings and the scalp form.
- Lint, typecheck, build, and CI on Ubuntu and Windows.

---

## 13. Open items

1. **The next trading day** (like option chains' weekday check), check that:
   - a fill's execution id is identical in `TJ Today` and in the next day's `TJ Activity`;
   - Activity's final commissions replace Today's;
   - an assigned leg's `markPrice` equals its intrinsic value at the close.

   The design relies on the first. If it fails, the fallback key is `tradeID`, which both statements carry.

   **Still open after the live check.** The check ran at 23:25 New York time on 2026-09-28, when Activity still ended at Friday 2026-09-25. So all seven NVDA and TSLA fills came in through `TJ Today` (`origin = confirm`), with exactly the fixture's execution ids. It settles on the first sync after Activity includes 2026-09-28: the seven rows should turn `origin = activity` with the same keys, and no second NVDA or TSLA trade should appear.
2. **Token expiry.** The paper token's lifetime isn't recorded. The error message covers expiry, and Settings could show the token's date if IBKR exposes it.
3. **IV-after cutoff (from move data, spec §13 item 5).** Still the user's call. It's unrelated to this spec.
4. **Closing `BookTrade` rows with no notes.** The real Activity statement has 76 of them: option positions closed at $0 on 2026-07-25 and 2026-08-06, weeks before expiry, most likely paper-account adjustments. They're counted as `other` and ignored. All are before the start date, so nothing is affected today. One after the start date would leave its position open, so a later trade in that contract would join the same episode.

**Live check (2026-09-28, 23:25 New York time)**, on a copy of the real journal, with the real paper token and both real queries:
- The first sync took 6 s: `status: ok`, 2 added, nothing skipped. Ignored: 840 fills before the start date, 6 stock rows, 77 other (the 76 rows in item 4 and 1 CASH row).
- **NVDA 232.5C:** +$44.74, 2 contracts, 1.06 → 1.295, fees $2.26 (0.93 + 1.33), opened 09:31:05, closed 09:46:12.
- **TSLA 365P:** +$300.55, 2 contracts, 1.64 → 3.155, fees $2.45 (0.83 + 1.62), opened 09:37:15, closed 09:52:59.
- Nothing before 2026-09-28 came in: the account's only synced trades are these two.
- The second sync: 0 added, 0 updated, 2 unchanged.
- There were no commission differences to compare, because Activity didn't include the day yet (item 1).
- Screenshots of Scalps, the NVDA trade page, Import / Sync, Settings and the scalp form at 1280 and 1024 px showed nothing overlapping or cut off.
