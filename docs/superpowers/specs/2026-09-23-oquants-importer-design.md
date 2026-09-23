# oQuants Importer — Design Spec

- **Date:** 2026-09-23
- **Status:** Draft, awaiting review
- **Scope:** Getting the historical earnings iron-fly record out of oQuants and into the journal, kept deliberately lean: a browser extractor snippet, a parser, and an import with preview, backup and a duplicate guard. After the bulk import, trades are journaled in the app; re-running the import later only adds trades it has not seen.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), whose §7.2 and §7.2b this spec replaces for oQuants (see §10).

---

## 1. Purpose and success criteria

The user's earnings iron flies were tracked on oQuants, which has no export. This work brings that history, and any trades still open there, into the journal so it holds the complete record.

Success means:

- One run of a snippet on the oQuants Portfolio page, one paste into the journal, and every **Earnings** trade appears as an `iron_fly` in the **paper** book, with legs, entry and exit prices, fees and P&L matching oQuants to the cent.
- Running it again later is safe: trades already in the journal are skipped, so nothing is duplicated and nothing the user has edited is touched.

### Out of scope

- The generic CSV/paste importer with column mapping (parent spec §7.2). All flies live in oQuants, and scalps will arrive through IBKR Flex in Phase 2, so there is no source that needs it yet.
- Market data backfill of earnings dates, IV and moves. Imported trades leave those empty for the user to fill.
- Unlimited-risk structures (no call wing). They are skipped with a reason.
- Updating trades that already exist (e.g. filling in close data on a trade imported while open). Open trades are closed in the journal's builder instead.
- An undo button and import history. The pre-import backup is the undo.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| What is imported | Only rows whose oQuants **Strategy** chip is `Earnings`. Every other row is listed as skipped with its reason. |
| Open trades | Imported as open; the user closes them in the builder. |
| Book | Always `paper`. |
| Strategy | Always `iron_fly`. Condors fit unchanged, because the body put and call strikes are already separate fields. |
| One wing | The user never trades without at least one wing. A trade with no long put (e.g. ENVX, labelled "Short Straddle" by oQuants) imports with a **theoretical put wing at strike 0**, because the stock cannot fall below zero. Max loss and return on risk stay defined by the existing formulas. It is flagged **1 wing**. |
| No call wing | Skipped: "no call wing — unlimited risk, enter manually". |
| Identity | Natural key = ticker + open time (to the minute) + legs sorted by (type, strike, signed size). The trade id is the UUIDv5 of that key. A re-import skips any id that already exists. |
| Existing trades | Never modified by import, so the user's edits and annotations are always safe. |
| Field mapping | Structure → `structureLabel`. Notes → `ironFly.sourceNotes`, keeping the user's own `notes` empty. Strategy is used only for the filter. Earnings date and timing, IV and moves stay null. |
| Transport | The snippet reads cell text only, copies it to the clipboard, and all interpretation happens in the journal (§3). |

---

## 3. Architecture

```
oQuants tab (DevTools console)          Journal
┌───────────────────────────┐            ┌───────────────────────────────────────────┐
│ scripts/oquants-extract.js │  clipboard │ web: Import page                          │
│  walk pages, expand rows,  │ ─────────▶ │  paste → Preview → Import                │
│  read cell text + link     │   (JSON)   │ server: /api/import/oquants/{preview,     │
│  copy(payload)             │            │          commit}                          │
└───────────────────────────┘            │ importers: parseOquants(payload)          │
                                         │ db: backupDatabase + trades repository    │
                                         └───────────────────────────────────────────┘
```

| Unit | Location | Does | Depends on |
|---|---|---|---|
| Extractor snippet | `scripts/oquants-extract.js` | Drives the live page and collects raw cell text. Interprets nothing. | the browser only |
| Payload schema + parser | `packages/importers` (new) | `parseOquants(payload)`: pure, no I/O. Returns one result per trade. | `core` |
| Backup | `packages/db` | `backupDatabase` (inserts reuse the existing trades repository) | `core` |
| Routes | `apps/server/src/routes/import.ts` | preview, commit | `importers`, `db` |
| Import page | `apps/web/src/routes/Import.tsx` | paste, preview table, import | server API |

This keeps the parent spec's dependency rule: `importers` and `db` depend on `core`, and `server` wires them together.

Why the snippet does not parse: a parser fix then never requires the user to copy a new snippet, a stale snippet cannot produce subtly wrong trades, the parser is testable without a DOM, and the server only ever receives text. Posting straight from the oQuants tab to the local server was rejected, because it would need CORS on an API that deliberately refuses non-local origins.

---

## 4. The extractor snippet

Plain JavaScript with no build step, pasted into the DevTools console on the oQuants Portfolio page. It runs only when the user runs it, reads only the user's own page, and never touches cookies, tokens or storage.

1. Find the trades table as `document.querySelector(".MuiTablePagination-root").closest("table")`. The first `<table>` on the page is the canvas P&L chart, so `querySelector("table")` is wrong.
2. Go to the first page (`aria-label="Go to first page"`, if enabled).
3. On each page: click every collapsed row's expand button, wait until each trade has its leg rows, then read:
   - the header labels, once;
   - per trade row: the ticker (`p.oq-ticker-symbol`), every cell's `innerText`, and the designer link's `href`;
   - per leg row: every cell's `innerText`;
   - the "Totals" row is skipped.
4. Click `aria-label="Go to next page"` until it is disabled, waiting for the table body to change after each click.
5. Build the payload (§5), call the console's built-in `copy(payload)`, and log `Copied N trades (counter said "1–50 of 72")`.

If the table or pagination cannot be found, it logs a clear error and copies nothing. The snippet is not unit tested; its first live run is its test.

---

## 5. Payload format

Validated with zod before anything else runs. An unknown `format` or a malformed payload is rejected.

```json
{
  "format": "oquants-cells/1",
  "capturedAt": "2026-09-23T15:02:11.000Z",
  "timeZone": "Europe/Athens",
  "pageCounter": "1–50 of 72",
  "headers": ["Instrument", "Strategy", "Structure", "Notes", "Open Date", "Close Date",
              "Type", "Expiry", "Strike", "Size", "Cost", "P&L", "P&L %", "Actions"],
  "trades": [
    {
      "ticker": "XYZ",
      "cells": ["XYZ\n48.10\nExample Corp", "Earnings", "Short Iron Butterfly", "…",
                "Sep 9, 8:54 PM", "Sep 10, 8:44 PM\n(1d)", "", "", "", "", "-700.00", "+200.00", "+28.57%", ""],
      "designerHref": "/dashboard/designer/XYZ?positions%5B0%5D%5BbuySell%5D=S&…",
      "legs": [
        { "cells": ["", "", "", "", "", "", "Call", "Sep 11\n(2d)", "50.00", "-5", "-400.00", "+375.00", "+93.75%", ""] }
      ]
    }
  ]
}
```

Cells are always read **by header label**, never by position or CSS class (MUI class names are hashed). If a required header is missing, the whole preview fails with "oQuants changed its table — the parser needs updating".

---

## 6. Parser rules

`parseOquants(payload)` returns, per trade, either `{ kind: "trade", key, trade: NewTrade, flags, original }` or `{ kind: "skip", ticker, reason, original }`. `original` is the raw cell text, kept for the preview. Steps run in order, and the first failure skips the trade with that reason. A trade is never half-parsed.

1. **Filter.** Strategy must be `Earnings`. Otherwise skip: `strategy <value>`.
2. **Legs.** Side and quantity from the signed Size (`-5` = short 5, `+5` = long 5). Right from Type, strike from Strike. The ISO expiry comes from the designer link's `positions[i][expiration]`, matched to the leg by type and strike. The link's `price` values are ignored.
3. **Shape.** Every leg must have the same absolute size, which becomes `contracts`. The legs must be:
   - one short put and one short call (the body; equal strikes for a fly, different for a condor);
   - one long call above the body call strike;
   - optionally one long put below the body put strike. With none, `putWingStrike = 0` and the trade is flagged **1 wing**.

   No long call: skip, `no call wing — unlimited risk, enter manually`. Unequal sizes or any other shape: skip, `unrecognized structure`.
4. **Dates.** Displayed dates carry no year.
   - The open date takes the leg expiry's year, stepping back one year if that would put the open after expiry.
   - The close date takes the open's year, plus one if its month and day fall before the open's.
   - Times are interpreted in the payload's `timeZone` and stored as epoch ms.
   - An empty Close Date means the trade is **open**.
   - Any unparseable date: skip, `unparseable date "<text>"`.
5. **Money.**
   - Leg entry price = |leg cost| ÷ (|size| × 100).
   - Leg exit price = |leg cost + leg P&L| ÷ (|size| × 100). Example: a 5-lot short call with cost −400 and P&L +375 exits at |−400 + 375| ÷ 500 = 0.05.
   - `fees` = row cost − Σ leg cost (round-trip fees make the row's credit smaller: −1,192.00 vs −1,200.00 gives $8.00). `feesOpen` and `feesClose` stay null, because oQuants does not show the split. Fees below zero: skip, `fees came out negative ($x)`.
   - `netCost` = row cost (negative = credit). `netPnl` = row P&L. `creditPerShare` = −Σ leg cost ÷ (contracts × 100).
   - Open trades: no exit prices, `netPnl` and `closedAt` null.
6. **Reconciliation.** Σ leg P&L − row P&L should equal `fees` within $0.01. If not, the trade is still imported and flagged `doesn't reconcile ($x)`.
7. **Identity.** Key = `ticker | openedAt (minute) | legs sorted by (right, strike, signed size)`. Id = UUIDv5(key, a fixed project namespace). A second row with the same id in one payload (e.g. a page read twice): skip, `duplicate row`.
8. **Fixed fields.** `source = "oquants_extract"`, `book = "paper"`, `strategy = "iron_fly"`, `underlyingName` from the Instrument cell, `structureLabel` from Structure, `ironFly.sourceNotes` from Notes.

**Counter check.** When the number of trades collected differs from the total in `pageCounter`, the result carries a warning. It does not block the import.

Flags (`1 wing`, `doesn't reconcile`) are shown only in the preview and are not stored.

---

## 7. Data model changes

- `ironFlyDetailsSchema.putWingStrike` becomes `nonnegative()` (was `positive()`), in the model and the builder form, so a 1-wing trade can be edited after import.
- No new tables or columns. Imported trades get the existing `trades.import_batch_id` (one random id per import run) and `source = "oquants_extract"`.

The parent spec's planned `import_mappings` table and `mapping_id` column are dropped, along with the generic mapper.

---

## 8. Import pipeline

### 8.1 Preview — `POST /api/import/oquants/preview`

Writes nothing. Parses the payload and looks up each trade id:

| Bucket | When |
|---|---|
| **New** | id not in the database |
| **Already imported** | id exists, including a soft-deleted trade (a trade the user deleted stays deleted) |
| **Skipped** | the parser skipped it; the row shows the reason |

Existing trades are never modified. Running the import again later therefore only adds trades that are new since the last run.

### 8.2 Commit — `POST /api/import/oquants/commit`

Body: the same payload. The server parses and looks up again (so nothing from the preview is trusted), then:

1. Backs up the database with `VACUUM INTO` on a separate read-only connection into `backups/`, keeping the last 10. The migration backup moves onto the same `backupDatabase()` helper, because a plain file copy is unsafe while the database is open in WAL mode. When nothing is new, no backup is taken.
2. Inserts every **New** trade, with its legs and iron-fly details, in one transaction through the existing trades repository. Any failure rolls back everything.
3. Returns the count inserted and the backup file name.

### 8.3 Undoing an import

There is no undo button. The safety nets are the backup taken before every commit (restore it by replacing `journal.db` while the app is stopped) and the existing per-trade delete.

### 8.4 Errors

| Case | Response |
|---|---|
| Malformed payload or unknown `format` | `400` with the zod message |
| A required header is missing | `422` "oQuants changed its table" |
| A single trade fails to parse | not an error: a Skipped row with the reason |

---

## 9. Import page

Replaces the "Coming soon" page behind the existing **Import / Sync** nav item, in the Terminal style.

```
IMPORT / SYNC ─ oQuants
 Run scripts/oquants-extract.js in the DevTools console on oQuants → Portfolio, then paste here.
┌───────────────────────────────────────────────────────────────────────────┐
│ {"format":"oquants-cells/1", …                                            │
└───────────────────────────────────────────────────────────────────────────┘
[ Preview ]
⚠ Collected 70 trades, the page counter said 72. Some rows may be missing.
 NEW 31   ALREADY IMPORTED 0   SKIPPED 37                        [ Import 31 ]
┌───────┬────────┬──────────────────────┬──────────────┬──────────┬─────────┬────────────────────┐
│       │ Ticker │ Structure            │ Opened (ET)  │ Closed   │ Net P&L │ Flags / reason     │
├───────┼────────┼──────────────────────┼──────────────┼──────────┼─────────┼────────────────────┤
│ NEW   │ XYZ    │ Short Iron Butterfly │ Sep 9 13:54  │ Sep 10   │ +200.00 │                    │
│ NEW   │ ENVX   │ Short Straddle       │ Aug 6 15:40  │ Aug 7    │  +61.00 │ 1 wing             │
│ SKIP  │ SPY    │ Short Iron Condor    │ …            │          │         │ strategy VRP       │
└───────┴────────┴──────────────────────┴──────────────┴──────────┴─────────┴────────────────────┘
```

(Values illustrative.)

- One table listing every row, New first. No filters, no row expansion.
- **Import N** commits and then shows "31 trades imported · backup saved as …" with a link to the Iron Flies page.
- The snippet is used straight from the repo file; the page does not bundle or copy it.

---

## 10. Changes to the parent spec

Made in the same commit as this spec:

- §6 data model: `external_ref` no longer claims oQuants ids exist; `import_batches` and `import_mappings` are removed (imports use the existing `import_batch_id` column only).
- §7.2 (generic CSV/paste mapper) is marked deferred: no current source needs it.
- §7.2b is replaced by a pointer to this spec. Its outdated lines were: the snippet downloading `oquants-trades.json` (now a clipboard copy of raw cell text), the natural key including close time (it does not), oQuants trade ids in `external_ref` (none exist), the "built-in oQuants mapping" (the parser replaces it), and the fallback to the generic mapper.
- §13 Phase 1 items 5 and 6 are updated to match.

---

## 11. Testing

- **Parser** (`packages/importers`), against a synthetic payload fixture shaped like the real capture. Real captures stay outside the repo, in the data directory. Cases: a butterfly, a condor, a 1-wing trade, an open trade, every skip reason, year rollover across New Year, timezone conversion, a reconciliation mismatch, a missing header, a malformed payload, and the counter warning.
- **DB**: `backupDatabase` produces a readable copy of an open WAL database; commit inserts only new ids in one transaction and rolls back on failure; a second run with the same payload inserts nothing.
- **Server**: preview and commit, and the `400` and `422` responses.
- **Web**: the paste → preview → import flow.
- **Snippet**: not unit tested. Verified on the first live run, which also confirms how oQuants shows an open trade's Close Date.
