# Option Chains and Live Marks — Design Spec

- **Date:** 2026-09-26
- **Status:** Draft, awaiting review
- **Scope:** The iron fly builder picks its expiry and strikes from Alpaca's listed contracts; open trades show an estimated cost to close, per leg and in total, in the trade lists, on the trade page and in the builder; a Settings page holds the Alpaca key. Builds on the `market-data` package from live quotes.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), whose §8.6 this spec details (see §12).

---

## 1. Purpose and success criteria

Strikes and expirations are typed by hand today, so a typo creates a contract that never existed, and an open position says nothing about where it stands until its exits are typed in. This work closes both gaps with data from Alpaca's free plan.

Success means:

- Entering a trade, new or years old (back to Alpaca's February 2024 history), means choosing the expiry and strikes from what was actually listed. Without a key, or when Alpaca is unreachable, entry still works by typing.
- Every open trade shows what closing it right now would realise, in muted type, labelled an estimate, refreshed each minute. **No estimate is ever stored**: exit prices and the trade's P&L stay empty until real fills are typed in.
- The key is entered once on a Settings page, tested before it is saved, and used immediately, without a restart.

### Out of scope

- Streaming quotes or refreshing faster than once a minute.
- Mid prices, and showing greeks or IV. The chain snapshot already carries them, for a later risk view.
- A "settle at expiry" helper that fills an expired trade's exits from the expiry-day close. A good follow-up: the open BB trade that expired on 2026-09-25 is exactly that case.
- Live-account Alpaca keys (§2), and IBKR tokens in Settings (Phase 2).
- Positions whose legs have different expiries, and scalps. The builder stays the four-legged fly with one expiry.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Mark price | **Cost to close only**: a short leg is bought back at the **ask**, a long leg is sold at the **bid**. Chosen over mid because wide spreads are a recurring cost in these trades, and the estimate should show what closing would really realise. |
| Estimated P&L | Σ over legs of size × multiplier × (mark − entry), using the real exit price for any leg already closed, minus the fees entered so far (normally just the entry fees). Exit fees are not guessed; the tooltip says so. |
| Where estimates show | Journal and Iron Flies lists (Net P&L column), the trade page (header and Legs panel) and the builder. Muted italics, never red or green. |
| Builder layout | Today's layout, with the Expiry field and each leg's Strike field becoming dropdowns of listed contracts. Chosen over a fly-shaped body + wings picker and a clickable chain. |
| 1-wing trades | Unchanged: leave the long leg blank. Each long leg's strike dropdown starts with a blank entry. |
| Marks in the builder | Shown as the **placeholder** of each empty Exit field, so they are visible but never a value. The Derived panel adds "Est. P&L if closed now". |
| Expired open trades | No marks (Alpaca stops quoting expired contracts). Lists and the trade page show `EXPIRED · add exits`. A trade is expired once the New York date is past its expiry date; on expiry day it is still marked. |
| Data flow | The server exposes raw chains and option quotes; one pure `core` function computes every estimate. The builder needs marks for legs that are not saved yet, so estimates cannot come from the server's trade records. |
| Refresh | Polling every 60 s, the same as live quotes. The server caches option quotes for 30 s. |
| Key storage | `secrets.json` in the data directory (parent spec §5), written by the Settings page. The key is tested before it is written, and the Alpaca clients are rebuilt in place, so no restart is needed. |
| Key type | **Paper account keys only.** Chains come from Alpaca's trading API, and its paper host (`paper-api.alpaca.markets`) accepts only paper keys. Every Alpaca account has a free paper account, and the Settings page says to use it. |
| Company name | Filled in from Alpaca's asset record when the Company field is blank. A name the user typed is never overwritten. |
| Expiry on save | Required. The builder's hidden `2100-01-01` placeholder for a blank expiry goes away, since a fake expiry can never be marked. |

---

## 3. What Alpaca's free plan provides

Confirmed on 2026-09-26 with the user's paper key. This resolves parent spec §16, item 3, except for how fresh indicative quotes are during a session (§14).

| Need | Endpoint | Findings |
|---|---|---|
| Listed contracts | `GET https://paper-api.alpaca.markets/v2/options/contracts` with `underlying_symbols`, `status`, `expiration_date_gte`, `expiration_date_lte`, `limit=10000`, `page_token` | M: 674 active contracts over 15 expirations in one 319 KB call. `expiration_date_lte` defaults to the coming weekend, so a range is always passed. Expired contracts need `status=inactive` (active returns none); confirmed for expiries back to July 2026, and Alpaca's options history starts in February 2024. |
| Option quotes | `GET https://data.alpaca.markets/v1beta1/options/quotes/latest?symbols=…&feed=indicative` | Returns `{ quotes: { <contract>: { bp, ap, t, … } } }`. Unknown and expired contracts are silently left out. A malformed contract code fails the whole call with 400 (`^[A-Z]{1,5}\d{6,7}[CP]\d{8}$`). At most 100 contracts per call (`symbol limit is 100`). A missing bid shows as `bp: 0`. |
| Company name | `GET https://paper-api.alpaca.markets/v2/assets/{symbol}` | `name: "Macy's Inc."`. |
| Limits | response headers | 200 calls per minute. Calls took 100–570 ms. |

The **indicative** feed is the free plan's options feed: quotes are derived from OPRA rather than being OPRA quotes, and trades are delayed 15 minutes. Quotes on Saturday carried Friday's 15:59:59 ET timestamps. Marks use quotes only, never trades.

---

## 4. Architecture

| Unit | Location | Does | Depends on |
|---|---|---|---|
| Chains | `packages/market-data` | `alpacaChains(keys)`: listed expirations and strikes for a symbol since a date | — |
| Option quotes | `packages/market-data` | `alpacaOptionQuotes(keys)`: bid, ask and time per contract | — |
| Company names | `packages/market-data` | `alpacaCompanyNames(keys)`: an underlying's name | — |
| Key check | `packages/market-data` | `checkAlpacaKeys(keys)`: whether a key works for prices and for chains | — |
| Cache | `packages/market-data` | `cachedLatest` (the live-quotes cache, made generic) and `cachedChains` | — |
| Contract codes, estimates | `packages/core` | `occSymbol(leg)`, `closeEstimate(…)`: pure | — |
| Market data holder | `apps/server/src/marketData.ts` | Builds the Alpaca sources from the current key; rebuilds them when the key changes | `market-data` |
| Secrets file | `apps/server/src/config.ts` | `readSecrets` (exists) and `writeAlpacaKeys` | — |
| Routes | `apps/server/src/routes/` | `chains`, `option-quotes`, `company`, `settings`; `quotes` moves onto the holder | `core`, `market-data` |
| Builder | `apps/web/src/routes/IronFlyForm.tsx` | Expiry and strike dropdowns, company fill-in, mark placeholders | server API, `core` |
| Lists, trade page | `Journal.tsx`, `TradeDetail.tsx` | Estimated P&L and per-leg marks | server API, `core` |
| Settings page | `apps/web/src/routes/Settings.tsx` (new) | Key status, save and test, remove; data directory | server API |

`market-data` stays free of `db`, as it is today. The parent spec's dependency rule holds: `server` wires everything, and `web` talks only to `server`. The Alpaca key never reaches the browser.

---

## 5. `packages/market-data`

### 5.1 Chains

```ts
interface ListedExpiration { date: string /* YYYY-MM-DD */; expired: boolean; strikes: number[] }
interface ChainSource {
  /** Every expiration on or after `since` (today when omitted), with the strikes listed for it. */
  listed(symbol: string, since?: string): Promise<ListedExpiration[]>;
}
```

`alpacaChains(keys, { fetch?, timeoutMs = 10_000, today? })`, where "today" is always the New York date (injectable for tests):

- Asks for **active** contracts with `expiration_date_gte` = today and `expiration_date_lte` = today + 3 years.
- When `since` is before today, it also asks for **inactive** contracts with `expiration_date_gte` = `since` and `expiration_date_lte` = the earlier of today and `since` + 90 days. That is far enough for any trade in the journal to find its expiry, and it keeps editing a year-old trade on a busy name to a small call. A stored expiry outside the window is still kept, marked `not listed` (§8).
- Follows `next_page_token` (also accepted as `page_token`) until it is empty.
- Merges the results by expiration date. Strikes are the union of call and put strikes, deduplicated and sorted ascending. `expired` is true for dates before today.
- Returns an empty list when nothing is listed; the route turns that into "none listed".
- Error handling is the same as for quotes: Alpaca's JSON error `message` is passed on, and anything else (such as the HTML page for a bad key) is reduced to the status code.

`cachedChains(source, { ttlMs = 15 min })` keeps each (symbol, `since`) answer for `ttlMs`. A failed call is not cached. (Keeping expired listings for the life of the process was considered; one cheap call per 15 minutes is not worth a second caching rule.)

### 5.2 Option quotes

```ts
interface OptionQuote { bid: number | null; ask: number | null; at: number /* epoch ms */ }
interface OptionQuoteSource { latest(contracts: readonly string[]): Promise<Map<string, OptionQuote>> }
```

`alpacaOptionQuotes(keys, options)` works as follows:

- It drops any code that does not match `^[A-Z]{1,5}\d{6,7}[CP]\d{8}$`, so one bad code can never sink a batch.
- It asks in batches of at most 100.
- `ask` is null unless `ap > 0`. `bid` is `bp`, which is 0 when there is no bid: a long leg with no bid closes for nothing, which is a valid estimate.

The existing `cachedQuotes` becomes `cachedLatest<T>(source, { ttlMs, onError })` and wraps both the stock and option quote sources with a 30 s TTL. Its rule carries over: a failed refresh drops the old value rather than show it as current.

### 5.3 Company names and the key check

- `alpacaCompanyNames(keys).name(symbol)` returns the asset's `name` with a trailing "Common Stock" removed, or null. It is cached for the life of the process.
- `checkAlpacaKeys(keys)` makes two read-only calls: the latest SPY trade on the data API, and the SPY asset on the paper trading API. It returns one of:
  - `ok`
  - `rejected`: the data API refused the key
  - `not_paper`: the data API accepted it and the paper trading API refused it
  - `unreachable`: a timeout or network error

---

## 6. `packages/core`

### 6.1 `occSymbol`

```ts
occSymbol({ underlying: "M", expiry: "2026-10-02", right: "C", strike: 22.5 }) // "M261002C00022500"
```

The root is the underlying's letters only (so `BRK.B` becomes `BRKB`), followed by `YYMMDD`, the right, and `round(strike × 1000)` padded to 8 digits. Tests use real codes from §3.

### 6.2 `closeEstimate`

```ts
closeEstimate(
  trade: { underlying: string; legs: LegLike[]; feesOpen: number | null; feesClose: number | null; fees: number },
  quotes: ReadonlyMap<string, OptionQuote>,
  todayEt: string, // YYYY-MM-DD in America/New_York
): CloseEstimate

type CloseEstimate =
  | { kind: "closed" }                                        // every leg has an exit price
  | { kind: "expired"; expiry: string }                       // an open leg's expiry is before todayEt
  | { kind: "unavailable"; reason: string }                   // e.g. "no ask for the short call"
  | {
      kind: "estimate";
      legs: { index: number; mark: number; side: "ask" | "bid"; pnl: number }[]; // open legs only
      grossPnl: number; // all legs, realised and estimated, before fees
      fees: number;     // fees entered so far
      netPnl: number;
      quotedAt: number; // the oldest quote used
    };
```

Rules:

- A leg with a `closePrice` contributes its realised P&L and needs no quote.
- For an open leg, `mark` is the ask for a short and the bid for a long. Leg P&L = quantity × multiplier × (mark − openPrice), rounded to cents.
- A missing quote for any open leg, or a missing ask for an open short leg, gives `unavailable`, with the reason naming the leg ("short call", "long put", and so on).
- `fees` = `feesOpen + feesClose` when both are known, otherwise `fees`.
- `expired` is checked before quotes are looked at.

`closeEstimate` never mutates its inputs, and nothing it returns is sent back to the server.

---

## 7. Server

### 7.1 The market data holder

```ts
interface MarketData {
  sources(): { quotes: QuoteSource; chains: ChainSource; optionQuotes: OptionQuoteSource; companies: CompanyNames } | null;
  configure(keys: AlpacaKeys | null): void;
  status(): { state: "on" | "off" | "error"; message: string | null };
}
```

`index.ts` builds it from `readSecrets` at startup, and passes it to `createApp` in place of `AppDeps.quotes`. The startup line reads `Market data: Alpaca (IEX stock prices, indicative option quotes)`, or `Market data: off (add an Alpaca key in Settings)`. Routes call `sources()` on every request, so a key saved in Settings takes effect on the next request. The state becomes `error`, with a short message, when Alpaca rejects the key (401 or 403) on a live call, and clears when a key is saved or removed. A revoked key does not recover by itself.

### 7.2 Read-only routes

| Route | Answer |
|---|---|
| `GET /api/chains/:symbol?since=YYYY-MM-DD` | `{ symbol, expirations: ListedExpiration[] }`, or `{ symbol, expirations: [], unavailable: { reason: "no_key" \| "none_listed" \| "unreachable", message } }` |
| `GET /api/option-quotes?contracts=…` | `{ quotes: { [contract]: OptionQuote } }`. It is `{}` without a key or when Alpaca fails, as `/api/quotes` does today. |
| `GET /api/company/:symbol` | `{ name: string \| null }`; null without a key or when Alpaca fails |

`:symbol` must be a plain ticker (the existing `TICKER` pattern), and `since` must be a valid date, or the route answers 400.

### 7.3 Settings routes

| Route | Does |
|---|---|
| `GET /api/settings` | `{ dataDir, marketData: { state, keyIdHint, message } }`. `keyIdHint` is the key ID's first 2 and last 4 characters (`PK…7QXA`). The secret key is never returned. |
| `PUT /api/settings/market-data` | Body `{ keyId, secretKey }`. See the steps below. |
| `DELETE /api/settings/market-data` | Removes the `alpaca` entry from the file (keeping the rest) and calls `configure(null)`. |

`PUT /api/settings/market-data`:

1. Runs `checkAlpacaKeys`.
2. On `ok`, writes the file and calls `configure(keys)`.
3. Otherwise it answers 400 with `rejected`, `not_paper` or `unreachable` and a plain message, and changes nothing.

`writeAlpacaKeys(file, keys | null)`:

- Reads the file as raw JSON, so entries this app version doesn't know about are kept. A missing file counts as `{}`.
- Sets or removes `alpaca`.
- Writes to `secrets.json.tmp` with mode `0600`, then renames it over `secrets.json`. On Windows the mode is ignored; the file lives in the user's own `%APPDATA%`.
- If the existing file is not valid JSON, it refuses (409, "secrets.json isn't valid JSON; fix or delete it by hand") rather than overwrite what might be other secrets. Like `readSecrets`, it never quotes the file's contents.

**Protection.**

- The settings routes accept only `application/json` bodies. A page on another site cannot send one to the local server without a CORS preflight, which the server never approves. Its Host check already blocks DNS rebinding.
- A test proves that a `text/plain` or form-encoded request to `PUT` is refused.
- The secret is never logged. Error messages from Alpaca are passed on only as their JSON `message`, never as raw responses.

---

## 8. The builder

**Loading the chain**

- 400 ms after the last keystroke in Underlying, the builder asks for the chain with `since` set to the Opened date if that is in the past, otherwise today.
- Changing Opened to an earlier date asks again.
- If Company is blank, it asks for the company name and fills it in.

**Expiry dropdown**

- It lists the expirations on or after the open date, labelled `Oct 2 · Fri · 6d` (days counted from the open date). Past ones are labelled `expired`.
- Nothing is preselected.
- An expiry is required to save.

**Strike dropdowns** (one per leg)

- Each lists the strikes of the chosen expiry, ascending.
- For a trade opened today, the strike nearest the stock's live price (from `/api/quotes`) is labelled `(ATM)`.
- Short legs require a strike. Long legs start with a blank entry, which means no wing (1-wing), exactly as today.
- Changing the expiry keeps the strikes that the new expiry lists and clears the rest, with a note naming the cleared legs.

**Editing a saved trade**

- The stored expiry and strikes are selected when the chain lists them.
- A stored value the chain does not list stays in its dropdown, marked `not listed`, so nothing is silently lost.

**Typed fallback**

- The builder falls back when there is no key, when Alpaca is unreachable, when nothing is listed for the symbol in that period (including trades before February 2024), or when the user clicks **type instead** beside Expiry. That link is an escape hatch for an odd contract Alpaca does not list.
- In each case Expiry and the strikes return to typed inputs, with a muted notice giving the reason. Validation is then as today, plus the required expiry.

**Marks**

- Once the expiry and a leg's strike are set and that leg's Exit is empty, the Exit field's placeholder shows the leg's mark (ask for shorts, bid for longs).
- The Derived panel adds "Est. P&L if closed now", in muted italics.
- Both come from `closeEstimate` over the form's current legs. A placeholder is never a value, so the submitted payload is unchanged: a test asserts that `closePrice` stays null.

---

## 9. Marks in the lists and on the trade page

- **Hooks.**
  - `useOptionQuotes(contracts)` polls `/api/option-quotes` every 60 s.
  - The lists gather the open legs of every open trade on screen into one call. The server splits it into batches of 100.
  - A trade is open while any leg lacks an exit price (parent spec §7.1).
- **Lists** (Journal and Iron Flies share one component).
  - An open trade's Net P&L cell shows `est −$46.80` in muted italics.
  - Hovering explains it: "Estimated cost to close, from quotes at Sep 25 3:59 PM ET (indicative feed), after the fees entered so far. Not saved."
  - An expired open trade shows an `EXPIRED · add exits` chip.
  - `unavailable` shows "—", with the reason on hover.
  - Return on risk stays "—".
- **Trade page.**
  - The header shows the estimate in place of "—".
  - For an open trade, the Legs panel adds **Mark (to close)**, showing the price and whether it is the ask or the bid, and **Est. P&L** per leg.
  - A footnote gives the estimate before and after fees, the quote time, and "refreshes every minute · never saved".
  - An expired open trade shows `EXPIRED · add exits` beside the Edit button.

---

## 10. Settings page

It replaces the "coming soon" page at `/settings`.

**Market data · Alpaca** panel:

- A status line:
  - "Connected · key PK…7QXA · paper account"
  - "Not set up: live prices, chains and marks are off"
  - the error state's message
- Key ID and Secret key fields (a password input). When a key is saved, the fields are empty and their placeholders say so, and the secret is never displayed.
- **Save and test**, and **Remove key** (asks for confirmation).
- A note: use your Paper account's keys, which are free and need no funding; where the file lives; that it is never in the repo or an export; and what the key powers.

After Save, the status line updates, and the lists and builder pick up the new key on their next refresh.

**Data** panel: the data directory (parent spec §14 promised it in Settings).

---

## 11. Errors

| Situation | Behaviour |
|---|---|
| No key | Typed expiry and strikes, with the hint "Add an Alpaca key in Settings to pick from the chain". No marks; lists look as they do today. |
| Alpaca times out (10 s), 5xx or 429 | Chains: typed fallback, with the reason. Marks: blank, and "Marks unavailable" on the trade page. Nothing stale is shown as current. One warning line in the server log per failure, as for quotes. |
| Nothing listed (unknown symbol, before February 2024) | Typed fallback: "No listed options for X in that period". |
| Key rejected on a live call (revoked) | Settings shows the error state; everything else carries on without market data. |
| Key rejected when saving | 400 with the reason; nothing written; the previous key stays in use. |
| `secrets.json` unreadable at startup | As today: a warning that never quotes the file, and market data off. Saving from Settings refuses to overwrite it (409). |
| Short leg with no ask, or a leg with no quote | No estimate; the reason on hover. |
| Open trade past expiry | `EXPIRED · add exits`, no marks. |

---

## 12. Changes to the parent spec

- §8.6 gains a pointer to this spec. It also records the decisions that refine it: marks use the cost to close, and chains need a paper key.
- §5: the Alpaca key in `secrets.json` is set from Settings.
- §4: `market-data` lists the Alpaca sources alongside the planned Massive adapter.
- §16, item 3: resolved by §3 of this spec, except intraday quote freshness (§14 below).

---

## 13. Testing

Test-first throughout, and real data never enters fixtures. Probe responses are trimmed and use only public contract data.

- **`core`:**
  - `occSymbol` against real codes, including a half-dollar strike, a strike of 100 or more, and a dotted ticker.
  - `closeEstimate`, table-driven: a short at the ask; a long at the bid; a zero bid; a missing ask; a missing quote; a partly closed trade; all legs closed; fees known and unknown; and the expiry boundary (expiry day is still marked, the day after is expired).
- **`market-data`** (with a fake `fetch`):
  - chains: the active and inactive requests and their date ranges; the default range never relied on; paging; merging and sorting strikes; and an empty result;
  - option quotes: malformed codes never sent; batches of 100; `ap: 0` becoming a null ask; omitted contracts;
  - `checkAlpacaKeys`: all four outcomes;
  - HTML error pages never echoed;
  - `cachedLatest` keeps the behaviour of today's quote cache tests.
- **`server`** (with `app.request()` and fake sources):
  - every new route with and without a key;
  - input validation;
  - `/api/quotes` working through the holder;
  - Settings: save writes the file with mode `0600` (checked on Linux only), keeps unknown entries, refuses a broken file (409), refuses a failed check and leaves the file untouched, never returns the secret, and makes the next `/api/quotes` call use the new key;
  - a `text/plain` `PUT` is refused.
- **`web`:**
  - the builder's dropdowns fill from a chain;
  - a blank long leg saves as 1-wing;
  - a stored value that is not listed is kept and flagged;
  - an expiry change clears strikes that are not listed;
  - the typed fallback, both on failure and via "type instead";
  - company fill-in never overwrites a typed name;
  - mark placeholders shown and never submitted;
  - the list estimate, expired chip and "—" states;
  - the trade page's mark columns;
  - Settings save, error and remove.
- **Live check** (weekday session): the builder on a real earnings name, marks during the session, and how fresh indicative quotes are (§14).

---

## 14. Open items

1. **Indicative quote freshness during the session.** The probe ran on a Saturday. Confirm on a weekday that quotes update within the 60 s refresh. If they lag badly, the tooltip should say how old they are rather than just when.

**Checked so far (Saturday 2026-09-26, the app on the real paper key):** the startup line, Settings status, company name, M's chain (16 expirations), BB's chain back to its expired 2026-09-25 expiry, and option quotes (Friday's closing bid/ask; the expired BB contract left out) all come through correctly. Still to check on a weekday session: quote freshness within the 60 s refresh, and saving the key again from Settings.
