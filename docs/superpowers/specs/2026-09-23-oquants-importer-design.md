# oQuants Importer — Design Spec

- **Date:** 2026-09-23
- **Status:** Draft, awaiting review
- **Scope:** Getting the historical earnings iron-fly record out of oQuants and into the journal: a browser extractor snippet, a parser, and an import pipeline with preview, backup, undo and a duplicate guard.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), whose §7.2 and §7.2b this spec replaces for oQuants (see §10).

---

## 1. Purpose and success criteria

The user's earnings iron flies were tracked on oQuants, which has no export. This work brings that history, and any trades still open there, into the journal so it holds the complete record.

Success means:

- One paste of a snippet into the oQuants Portfolio page, one paste into the journal, and every **Earnings** trade appears as an `iron_fly` in the **paper** book, with legs, entry and exit prices, fees and P&L matching oQuants to the cent.
- Running it again later is safe and quiet: unchanged trades are left alone, trades that have closed since get their close data, and nothing is duplicated.
- The user's own edits are never overwritten, and a whole import can be undone.

### Out of scope

- The generic CSV/paste importer with column mapping (parent spec §7.2). All flies live in oQuants, and scalps will arrive through IBKR Flex in Phase 2, so there is no source that needs it yet.
- Market data backfill of earnings dates, IV and moves. Imported trades leave those empty for the user to fill.
- Unlimited-risk structures (no call wing). They are skipped with a reason.

---

## 2. Decisions

| Topic | Decision |
|---|---|
| What is imported | Only rows whose oQuants **Strategy** chip is `Earnings`. Every other row is listed as skipped with its reason. |
| Open trades | Imported. A later re-import fills in close time, exit prices, P&L and fees. |
| Book | Always `paper`. |
| Strategy | Always `iron_fly`. Condors fit unchanged, because the body put and call strikes are already separate fields. |
| One wing | The user never trades without at least one wing. A trade with no long put (e.g. ENVX, labelled "Short Straddle" by oQuants) imports with a **theoretical put wing at strike 0**, because the stock cannot fall below zero. Max loss and return on risk stay defined by the existing formulas. It is flagged **1 wing**. |
| No call wing | Skipped: "no call wing — unlimited risk, enter manually". |
| Identity | Natural key = ticker + open time (to the minute) + legs sorted by (type, strike, signed size). The trade id is the UUIDv5 of that key. Close time is **not** part of the key, so an open trade keeps its id when it closes. |
| Manual edits win | A new `trades.fills_edited_at` is set when the user changes a trade's fills. Import then skips that trade entirely. |
| Annotations | Grade, tags, setup, notes and exclusion are never written by import. |
| Field mapping | Structure → `structureLabel`. Notes → `ironFly.sourceNotes`, which import owns and may refresh. Strategy is used only for the filter. Earnings date and timing, IV and moves stay null. |
| Transport | The snippet reads cell text only, copies it to the clipboard, and all interpretation happens in the journal (§3). |

---

## 3. Architecture

```
oQuants tab (DevTools console)          Journal
┌───────────────────────────┐            ┌───────────────────────────────────────────┐
│ scripts/oquants-extract.js │  clipboard │ web: Import page                          │
│  walk pages, expand rows,  │ ─────────▶ │  paste → Preview → Commit / Undo          │
│  read cell text + link     │   (JSON)   │ server: /api/import/oquants/{preview,     │
│  copy(payload)             │            │          commit}, /api/import/batches/... │
└───────────────────────────┘            │ importers: parseOquants(payload)          │
                                         │ db: planImport, applyImport, undoImport   │
                                         └───────────────────────────────────────────┘
```

| Unit | Location | Does | Depends on |
|---|---|---|---|
| Extractor snippet | `scripts/oquants-extract.js` | Drives the live page and collects raw cell text. Interprets nothing. | the browser only |
| Payload schema + parser | `packages/importers` (new) | `parseOquants(payload)`: pure, no I/O. Returns one result per trade. | `core` |
| Import planning and writing | `packages/db` | `planImport`, `applyImport`, `undoImport`, `backupDatabase` | `core` |
| Routes | `apps/server/src/routes/import.ts` | preview, commit, batches, undo | `importers`, `db` |
| Import page | `apps/web/src/routes/Import.tsx` | paste, preview table, commit, history, undo | server API |

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
   - `fees` = Σ leg cost − row cost. `feesOpen` and `feesClose` stay null, because oQuants does not show the split.
   - `netCost` = row cost (negative = credit). `netPnl` = row P&L. `creditPerShare` = −Σ leg cost ÷ (contracts × 100).
   - Open trades: no exit prices, `netPnl` and `closedAt` null.
6. **Reconciliation.** Σ leg P&L − row P&L should equal `fees` within $0.01. If not, the trade is still imported and flagged `doesn't reconcile ($x)`.
7. **Identity.** Key = `ticker | openedAt (minute) | legs sorted by (right, strike, signed size)`. Id = UUIDv5(key, a fixed project namespace).
8. **Fixed fields.** `source = "oquants_extract"`, `book = "paper"`, `strategy = "iron_fly"`, `underlyingName` from the Instrument cell, `structureLabel` from Structure, `ironFly.sourceNotes` from Notes.

**Counter check.** When the number of trades collected differs from the total in `pageCounter`, the result carries a warning. It does not block the import.

Flags (`1 wing`, `doesn't reconcile`) exist only in the preview. **1 wing** is derivable from `putWingStrike === 0` wherever else it is shown. The reconciliation flag is not stored, because it would go stale once the user corrects the trade.

---

## 7. Data model changes (one migration)

- `trades.fills_edited_at` (integer, nullable). Set by the trades repository when an update changes any of: legs, `openedAt`, `closedAt`, `netPnl`, `fees`, `feesOpen`, `feesClose`, or the iron-fly strikes, contracts, credit or net cost. Not set by changes to grade, tags, setup, notes, exclusion or other annotations. `edited_at` keeps its existing meaning.
- `import_batches`: `id`, `source`, `captured_at`, `imported_at`, `undone_at` (nullable), `counts` (JSON: new, updated, unchanged, skipped_edited, skipped).
- `import_batch_items`: `batch_id`, `trade_id`, `action` (`created` | `updated`), `before` (JSON snapshot of the trade with its legs and iron-fly details before an update; null for `created`).
- `ironFlyDetailsSchema.putWingStrike` becomes `nonnegative()` (was `positive()`). The builder form accepts 0 and displays it as `0 (theoretical)`.

The parent spec's planned `import_mappings` table and `mapping_id` column are dropped, along with the generic mapper.

---

## 8. Import pipeline

### 8.1 Preview — `POST /api/import/oquants/preview`

Writes nothing. Parses the payload, then `planImport` looks up each trade id and places it in one bucket:

| Bucket | When | Shown |
|---|---|---|
| **New** | id not in the database, or only soft-deleted | row; "re-creates a deleted trade" when it was deleted |
| **Update** | exists, and any import-owned field differs: legs, times, P&L, fees, iron-fly strikes/contracts/credit/net cost, `structureLabel` or `sourceNotes` (e.g. it has closed) | row, with the changed fields listed |
| **Unchanged** | exists, and no import-owned field differs | count only |
| **Skipped — you edited its fills** | `fills_edited_at` is set | row with reason; the trade is left entirely alone, including its source notes |
| **Skipped** | the parser skipped it | row with reason |

The response includes a **plan fingerprint**: a hash of the ordered (id, bucket, new values) list.

### 8.2 Commit — `POST /api/import/oquants/commit`

Body: the same payload plus the fingerprint.

1. Parse and plan again. If the fingerprint differs, respond `409` ("data changed — re-run preview").
2. Back up the database with SQLite's online backup API (`better-sqlite3`'s `backup()`) into `backups/`, keeping the last 10. The migration backup moves onto the same `backupDatabase()` helper, because a plain file copy is unsafe while the database is open in WAL mode.
3. In one transaction:
   - insert the `import_batches` row;
   - insert the new trades with their legs and iron-fly details (reviving any soft-deleted row with the same id);
   - for each update: write its `before` snapshot, then replace the import-owned fields listed in §8.1. Annotations are not written;
   - insert one `import_batch_items` row per created or updated trade.

   Any failure rolls back everything.

### 8.3 Undo — `POST /api/import/batches/:id/undo`

- Allowed only on the **most recent batch that has not been undone**. Otherwise an older batch's snapshots could overwrite a later import. Other batches respond `409`.
- Backs up first, then in one transaction: soft-deletes the trades the batch created, restores the import-owned fields of the trades it updated from their `before` snapshots (annotations added since are kept), and sets `undone_at`.
- The UI confirmation warns when created trades have since been edited, i.e. their `edited_at` is set ("4 of these trades have your notes or grades — they'll be removed too"). Import itself leaves `edited_at` null.

### 8.4 History — `GET /api/import/batches`

Newest first, with counts, `undone_at`, and whether the batch is currently undoable.

### 8.5 Errors

| Case | Response |
|---|---|
| Malformed payload or unknown `format` | `400` with the zod message |
| A required header is missing | `422` "oQuants changed its table" |
| A single trade fails to parse | not an error: a Skipped row with the reason |
| Plan changed between preview and commit | `409` |
| Undo of a batch that is not the latest | `409` |

---

## 9. Import page

Replaces the "Coming soon" page behind the existing **Import / Sync** nav item, in the Terminal style.

```
IMPORT / SYNC ─ oQuants
┌ 1 · Extract ──────────────────────────────────────────────────────────────┐
│ Open oQuants → Portfolio, press F12 → Console, paste the snippet, Enter.  │
│ [ Copy snippet ]   ✓ copied                                               │
└───────────────────────────────────────────────────────────────────────────┘
┌ 2 · Paste ────────────────────────────────────────────────────────────────┐
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ {"format":"oquants-cells/1", …                                        │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ [ Preview ]                                                               │
└───────────────────────────────────────────────────────────────────────────┘
⚠ Collected 70 trades, the page counter said 72. Some rows may be missing.
 NEW 31   UPDATE 2   UNCHANGED 0   SKIP (edited) 0   SKIP 37      [ Commit 33 ]
┌───────┬────────┬──────────────────────┬──────────────┬──────────┬─────────┬────────────────────┐
│ Act.  │ Ticker │ Structure            │ Opened (ET)  │ Closed   │ Net P&L │ Flags / reason     │
├───────┼────────┼──────────────────────┼──────────────┼──────────┼─────────┼────────────────────┤
│ NEW   │ XYZ    │ Short Iron Butterfly │ Sep 9 13:54  │ Sep 10   │ +200.00 │                    │
│ NEW   │ ENVX   │ Short Straddle       │ Aug 6 15:40  │ Aug 7    │  +61.00 │ 1 wing             │
│ UPD   │ ORCL   │ Short Iron Condor    │ Sep 8 15:30  │ Sep 9    │ +140.00 │ closed · P&L, fees │
│ SKIP  │ SPY    │ Short Iron Condor    │ …            │          │         │ strategy VRP       │
└───────┴────────┴──────────────────────┴──────────────┴──────────┴─────────┴────────────────────┘

IMPORT HISTORY
 Sep 23 18:02  oquants  31 new · 2 updated · 37 skipped     [ Undo ]
 Sep 20 11:15  oquants  12 new                              (undone)
```

(Values illustrative.)

- **Copy snippet** copies `scripts/oquants-extract.js`, bundled into the web app at build time (a Vite `?raw` import), so the page always offers the current snippet and the repo holds one copy.
- The table shows New and Update rows by default. Bucket chips filter it; skipped rows are behind the SKIP chip, each with its reason.
- Clicking a row expands it: the original oQuants text (dates as displayed, in the captured timezone) beside the parsed values and the leg breakdown, so the timezone conversion can be checked.
- **Commit N** writes, then shows a toast ("33 trades imported · Undo") and refreshes the history. A `409` re-runs the preview automatically.
- Only the latest batch that has not been undone gets an active **Undo**; the others explain why not in a tooltip.
- Elsewhere: trades with `putWingStrike === 0` get a **1 wing** badge in the Iron Flies list and on the trade page.

---

## 10. Changes to the parent spec

Made in the same commit as this spec:

- §5 data model: `external_ref` no longer claims oQuants ids exist; `import_batches` gains the §7 shape here; `import_mappings` is removed.
- §7.2 (generic CSV/paste mapper) is marked deferred: no current source needs it.
- §7.2b is replaced by a pointer to this spec. Its outdated lines were: the snippet downloading `oquants-trades.json` (now a clipboard copy of raw cell text), the natural key including close time (it does not), oQuants trade ids in `external_ref` (none exist), the "built-in oQuants mapping" (the parser replaces it), and the fallback to the generic mapper.
- §13 Phase 1 items 5 and 6 are updated to match.

---

## 11. Testing

- **Parser** (`packages/importers`), against a synthetic payload fixture shaped like the real capture. Real captures stay outside the repo, in the data directory. Cases:
  - a butterfly, a condor, and a 1-wing trade;
  - an open trade, and the same trade closed (same id);
  - every skip reason;
  - year rollover across New Year;
  - timezone conversion;
  - a reconciliation mismatch;
  - a missing header (`422`), a malformed payload, and the counter warning.
- **DB**: `planImport` puts trades in every bucket; commit writes one batch in one transaction; commit rolls back on failure; undo soft-deletes created trades and restores updated ones; only the latest batch can be undone; a soft-deleted trade is revived; `fills_edited_at` is set by fill edits and not by annotation edits; `backupDatabase` produces a readable copy of an open WAL database.
- **Server**: preview, commit, and the `400`, `422` and `409` responses; undo, including a non-latest batch.
- **Web**: the paste → preview → commit flow, the bucket filters, the Undo button's enabled state.
- **Snippet**: not unit tested. Verified on the first live run, which also confirms how oQuants shows an open trade's Close Date.
