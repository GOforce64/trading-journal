# Trading Journal — Design Spec

- **Date:** 2026-09-22
- **Status:** Draft, awaiting review
- **Scope:** Whole product. Built in three phases (§13), each with its own implementation plan.

---

## 1. Purpose

A personal options-trading journal that is also a public, open-source portfolio project.

It journals two very different strategies:

1. **Open scalps**: short-dated (0–1 DTE) single-leg options on index ETFs and single stocks, traded near the market open. Reviewed visually on a generated TradingView-style chart, measured in R.
2. **Earnings IV-crush iron flies**: short iron butterflies opened before earnings and closed the next day. Reviewed by the numbers (credit, implied vs actual move, IV crush). No chart.

### Goals

- Real trading data never leaves the user's machines and can never be committed to the repo by accident.
- Works the same on two machines (Fedora Linux and Windows), with export and **merge** between them.
- Imports the historical iron-fly record from oQuants and syncs new trades from IBKR (live and paper accounts).
- Tracks trades the user *didn't* take ("missed") as first-class, R-scored records.
- Looks like a professional trading tool (TradingView-grade charts, dense and fast UI).
- A public demo on fake data that recruiters can open with one click, at zero hosting cost.

### Non-goals

- Multi-user accounts, authentication, or cloud hosting of real data.
- Real-time or live-streaming data, order entry, or broker trading.
- Mobile-first UI. It must not break at narrow widths, but it is designed for desktop.
- Strategies other than the two above. The model is general enough to add them later; the UI is not built for them now.
- Syncing via a shared cloud folder. Export and merge is the only multi-machine mechanism.

---

## 2. Core concepts

| Concept | Definition |
|---|---|
| **Trade** | One position from open to flat. It has a strategy, one or more legs, and zero or more fills. |
| **Strategy** | `scalp` or `iron_fly`. Determines the detail fields, the metrics, and which pages show the trade. |
| **Book** | Which ledger a trade belongs to: **Live**, **Paper**, or **Missed**. Live/Paper come from the trade's account kind. Missed trades have no account. |
| **Missed trade** | A scalp setup the user saw but didn't take (missed trades are always `scalp`). It has no fills or dollar P&L. It is scored in **R** from entry, stop and exit points marked on the underlying's chart. |
| **Excluded** | A per-trade flag with an optional reason. Excluded trades stay visible (with a badge) but are left out of every statistic unless "include excluded" is toggled on. |
| **Setup** | A named playbook entry (e.g. "ORB breakout"). A trade has at most one. |
| **Tags** | `mistake` tags (many per trade) and `emotion` tags (at most one per trade). |
| **Grade** | Execution grade A–F. |
| **R** | Realized P&L ÷ planned risk. For missed trades it's the underlying move ÷ the underlying stop distance (§8). |

Terminology in the UI: **Paper** means the IBKR paper-trading account. **Demo** means only the public fake-data showcase.

---

## 3. Tech stack

### Decision: TypeScript full stack, local-first

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | One language across UI, server and domain logic. The most employable stack for a mixed/early-career profile. |
| Monorepo | **pnpm workspaces** | Standard in modern TS repos; strict dependency boundaries between packages. |
| Frontend | **React 19 + Vite** SPA | Fast dev loop. A local app doesn't need SSR. |
| Routing / data | **TanStack Router** (type-safe routes), **TanStack Query**, **TanStack Table** | End-to-end type safety, caching, and a fast journal grid. |
| UI kit | **Tailwind CSS v4 + shadcn/ui** (Radix primitives), **lucide** icons, **cmdk** command palette | Modern, accessible components we own and can restyle to the Terminal theme. |
| Forms | **react-hook-form + Zod** | Zod schemas shared with the server. |
| Trade charts | **TradingView Lightweight Charts** (Apache-2.0) | Same rendering, crosshair and feel as TradingView. Also used for the equity curve. |
| Analytics charts | **shadcn charts (Recharts)** for bars and scatters; calendar heatmap as a custom CSS grid | Consistent styling with the UI kit. |
| API server | **Hono** on Node.js (≥ 22), with **Hono RPC** typed client and `@hono/zod-validator` | Tiny, fast, web-standard, so the same app can also run in a browser (see §11). |
| Database | **SQLite** via **better-sqlite3**, **Drizzle ORM**, **drizzle-kit** migrations | One portable file. Builds natively on Linux and Windows. No Docker. |
| Options data | **Alpaca** (free account, key in the data directory) | Option chains, current quotes for open positions, and historical option bars including expired contracts. |
| Underlying bars | **Massive** (ex-Polygon, free tier) | Minute bars built from all exchanges, so charts match TradingView. Alpaca's free stock feed is single-exchange and would not. |
| Dates | **date-fns + @date-fns/tz** | All market logic in `America/New_York`, DST-correct. |
| Parsing | **fast-xml-parser** (IBKR Flex XML), **papaparse** (CSV / pasted tables), **fflate** (bundle zip) | Pure JS, cross-platform. |
| Quality | **Vitest**, **fast-check** (property tests), **Playwright** (e2e), **Biome** (lint and format) | |
| CI | **GitHub Actions**: typecheck, lint, test and build on `ubuntu-latest` **and** `windows-latest` | Proves the Windows requirement on every push. |
| PWA | **vite-plugin-pwa** | "Install app" in Chrome/Edge gives its own window and icon. |
| License | **MIT** | |

### Alternatives considered

- **Next.js full stack**: the strongest résumé keyword, but the server/client component model adds complexity a local single-user app doesn't need, and a SQLite-backed demo is awkward on serverless hosts. Rejected.
- **Python (FastAPI) backend + React**: a good quant signal, but it means two toolchains to install on both Linux and Windows. The quant math (Black-Scholes, IV solving, stats) shows equally well in a heavily tested TS `core` package. Rejected.
- **Desktop app (Tauri/Electron)**: recruiters won't install it. The PWA gives the same app-window feel. Rejected.

---

## 4. Architecture

```
trading-journal/
├─ apps/
│  ├─ web/            React SPA (pages, components, chart wrappers)
│  └─ server/         Hono app: createApp(deps) + Node entry (serves API and built web on one port)
├─ packages/
│  ├─ core/           PURE domain logic, no I/O: Zod models, fill grouping, P&L, Black-Scholes/IV,
│  │                  R and MAE/MFE, iron-fly metrics, indicators, stats, merge algorithm
│  ├─ db/             Drizzle schema, migrations, repositories (sync SQLite API)
│  ├─ importers/      IBKR Flex parser, CSV/paste parser, column mapping, presets (oQuants)
│  └─ market-data/    MarketDataProvider interface, Massive adapter, rate-limited queue, bar cache
├─ scripts/           start.sh / start.cmd, demo data generator
└─ docs/
```

**Dependency rule:** `core` depends on nothing. `importers` and `db` depend on `core`. `market-data` depends on `core` and `db`. `server` wires everything together. `web` talks only to `server`, through the typed Hono RPC client.

**Dependency injection at the edge.** `createApp({ db, files, marketData, ibkr, mode })` builds the Hono app from interfaces:

- `db`: a Drizzle SQLite database (better-sqlite3 locally, sql.js in the demo).
- `files`: attachment storage (filesystem locally, static assets in the demo).
- `marketData`: bar provider (Massive locally, pre-generated synthetic bars in the demo).
- `ibkr`: Flex client (real locally, disabled in the demo).

This one seam enables the local app, the in-browser demo (§11), and fast server tests against in-memory SQLite.

**Runtime.** `pnpm start` (or `start.sh` / `start.cmd`) runs one Node process on `127.0.0.1:4178`, serves API and UI, and opens the browser. The server:

- binds to loopback only;
- rejects requests whose `Host` header isn't `localhost`/`127.0.0.1` (DNS-rebinding protection);
- sends no permissive CORS headers.

---

## 5. Separating the app from the data

The code repository contains **no user data, ever**.

- **Data directory**, resolved in this order: env `TJ_DATA_DIR`, then the OS default:
  - Linux: `$XDG_DATA_HOME/trading-journal` (usually `~/.local/share/trading-journal`)
  - Windows: `%APPDATA%\trading-journal`
- **Contents:**
  - `journal.db`: all trades and settings
  - `attachments/<sha256>.<ext>`: screenshots, content-addressed
  - `backups/`: automatic DB snapshot before every migration, import and merge (the last 10 are kept)
  - `secrets.json`: IBKR Flex tokens and the Massive API key; file mode `0600` on Linux
  - `machine.json`: this installation's random `machineId`
- `.gitignore` also blocks `*.db`, `*.tjbundle`, `secrets.json`, `data/` and `.env*` as a second line of defense.
- Secrets are **never** included in export bundles. Each machine enters its own.
- Settings (risk-free rate, EMA periods, default chart timeframe) are per-machine and not merged. Every computed value that depends on a setting is stored on the trade, so both machines show identical numbers after a merge.

---

## 6. Data model

All tables use `id TEXT` (UUID). Syncable tables also carry `created_at`, `updated_at` and `deleted_at` (soft delete, epoch ms, UTC). All money is stored in dollars as REAL. Prices are per share; the multiplier is stored.

- **accounts**: `name`, `broker` (`ibkr` | `other`), `kind` (`live` | `paper`), `external_id` (IBKR account number).
- **trades**:
  - identity: `strategy` (`scalp` | `iron_fly`), `is_missed`, `account_id` (null only if missed), `status` (`open` | `closed`), `underlying`, `underlying_name` (e.g. "XYZ Industries"), `structure_label` (free text from the source, e.g. "Short Iron Butterfly")
  - timing and money: `opened_at`, `closed_at`, `gross_pnl`, `fees` (round trip), `fees_open`, `fees_close`, `net_pnl` (null if missed), `planned_risk`, `r_multiple`
  - review: `setup_id`, `grade`, `notes` (Markdown), `excluded`, `exclude_reason`
  - provenance: `source` (`ibkr_flex` | `csv_import` | `oquants_extract` | `manual`), `import_batch_id`, `external_ref` (the source platform's own trade ID where it has a stable one; oQuants does not, so those trades key on the natural-key hash of §7.2b)
  - merge: `edited_at` (last *user* edit; see §12). Set at creation for manual and imported trades, which are user-authored. Null for IBKR-synced trades until the user first edits one.
- **legs**: `trade_id`, `right` (C/P), `strike`, `expiry`, `multiplier`, `side` (long/short), `quantity`, `avg_open_price`, `avg_close_price`, `broker_conid`.
- **fills**: `trade_id`, `leg_id`, `executed_at`, `side`, `quantity`, `price`, `commission`, `broker_exec_id`, `raw` (JSON of the source row, for audit). Fills are immutable facts.
- **scalp_details** (1:1 with trade):
  - context: `direction` (long/short underlying; calls are long, puts short), `underlying_entry_price`, `underlying_exit_price`
  - plan: `stop_level`, `target_level`
  - risk model: `iv_at_entry`, `delta_at_entry`, `gamma_at_entry`, `est_option_price_at_stop`, `risk_override`, `risk_free_rate_used`
  - outcome: `mae_underlying`, `mfe_underlying`, `mae_r`, `mfe_r`, `minutes_after_open`, `hold_seconds`
  - missed trades only: `planned_entry_at`, `planned_entry_price`, `planned_exit_at`, `planned_exit_price`, `skip_reason`
- **iron_fly_details** (1:1 with trade). All fields are nullable, because historical imports will be incomplete:
  - structure: `body_put_strike`, `body_call_strike` (equal for a standard fly, different for a broken one), `put_wing_strike`, `call_wing_strike`, `contracts`, `credit` (per share). **Wings do not have to be the same width**, so put-side and call-side risk are tracked separately.
  - cash: `net_cost` (negative = credit received, matching oQuants' Cost column), `pnl_pct_of_cost`
  - earnings: `earnings_date`, `earnings_timing` (`BMO` | `AMC`), `beat_miss`, `sector`, `hist_avg_move_pct`
  - move and IV: `underlying_price_entry`, `underlying_price_exit`, `implied_move_pct`, `actual_move_pct`, `iv_before`, `iv_after`
  - `move_source` (`import` | `derived` | `manual`)

  The four contracts themselves live in the shared **legs** table (right, strike, expiry, side, quantity), so the trade page can show an oQuants-style leg breakdown, and non-butterfly structures fit the same model later.
- **setups**: `name`, `description`, `strategy` (nullable = both), `color`, `archived`.
- **tags**: `name`, `kind` (`mistake` | `emotion`), `color`, `archived`. **trade_tags**: `trade_id`, `tag_id`.
- **attachments**: `trade_id`, `sha256`, `ext`, `mime`, `bytes`, `caption`.
- **import_batches**: `source`, `file_name`, `mapping_id`, `imported_at`, `row_counts`. Enables **Undo import**.
- **import_mappings**: `name`, `strategy`, `columns` (JSON: source column → field + transform), `date_format`, `number_format`.
- **bars** (cache, *not* exported): `symbol`, `timeframe` (`1m` | `1d`), `ts`, `o`, `h`, `l`, `c`, `v`, `source`. Primary key `(symbol, timeframe, ts)`.
- **sync_state**: `account_id`, `last_run_at`, `last_status`, `last_error`.
- **settings**: key/value, per machine.

Derived values that are expensive or need market data (`r_multiple`, IV and greeks, MAE/MFE, `actual_move_pct`) are **stored** and recomputed when their inputs change. Cheap derivations (wing width, max loss, return on risk) are computed on read in `core`.

---

## 7. Features: iron flies (Phase 1)

### 7.1 The position builder (manual entry and editing)

Positions are built the way oQuants shows them: **leg by leg, priced individually**. The builder has one row per leg of the short iron butterfly (short call, short put, long call, long put), each taking a **strike, a size, an entry premium and an exit premium**, plus **entry fees and exit fees** as separate figures.

- **Nothing about money is typed twice.** Net cost, credit per share, P&L before fees, net P&L, contract count, max profit, max loss, the risky side, breakevens and wing widths are all derived from the legs (`positionCash` and `ironFlyMetrics` in `core`) and update as you type. The trade's stored P&L is what those prices imply, never a number typed beside them.
- **Round-trip fees land in the cost line**, matching oQuants, so an imported row and a hand-built one reconcile identically. `feesOpen` and `feesClose` are stored alongside the total.
- **Sizes are whole contracts.** A fractional size is a typo and is refused.
- **A position with any exit price missing is still open**: P&L reads "—" rather than a wrong number, and the exit fields stay empty until real fills are entered. Estimated values for a live position come from market data (§8.6) and are never written into those fields.
- **The same builder edits an existing trade**, reached from Edit on the trade page. Saving recomputes the P&L from the edited prices rather than trusting what was stored.
- **Strikes and expirations are not free text.** They are chosen from the option chain for that underlying (§8.6), because a strike that was never listed is always a mistake.

Scalps and any structure that is not a four-legged fly need a general multi-leg editor. That is deliberately **out of scope here** and gets its own plan alongside the Phase 2 scalp work.

### 7.2 Import: CSV and pasted tables with column mapping

A single importer handles any tabular source: an oQuants export, a table copied from a web page, or an old spreadsheet.

1. **Input:** upload a `.csv`, or paste a table. Tab-separated text from a copied HTML table is detected automatically.
2. **Map:** each source column is assigned to a journal field or "ignore". Transforms are available for date formats, `%` vs decimal, `$`/thousands separators, and `BMO`/`AMC` synonyms. Mappings can be saved by name and reused.
3. **Preview:** the first 50 rows are parsed, with per-row errors highlighted (e.g. "row 12: unparseable date"). Invalid rows are skipped, never half-imported.
4. **Book:** choose Live or Paper for the whole batch, then bulk-edit individual trades afterwards.
5. **Commit:** everything goes in one transaction after an automatic DB backup, and gets an `import_batch_id`. **Undo import** soft-deletes the whole batch.
6. **Duplicate guard:** when a row matches an existing trade on underlying, earnings date, body strike and contracts, it is flagged in the preview and skipped by default.

### 7.2b Getting trades out of oQuants (no export button exists)

oQuants has no export, so the history is extracted from the user's own logged-in session, by hand, never by an automated crawler:

- The repo ships a **browser extractor snippet** (`scripts/oquants-extract.js`) that the user pastes into the DevTools console on their Portfolio page. It expands every row, reads the table (instrument, strategy, structure, notes, open/close dates, per-leg type/expiry/strike/size, cost, P&L, P&L %), and downloads `oquants-trades.json`.
- **What the platform exposes** (confirmed from live markup, 2026-09-22): oQuants is a Next.js App Router app on Vercel. The Portfolio page is server-rendered; the only related request is an RSC prefetch (`text/x-component`) of the strategy designer. There is no JSON trades API, so the snippet reads the page itself, from three sources:
  1. **The parent row** (MUI table): instrument ticker (`p.oq-ticker-symbol`, one of the few stable class names) and company name, strategy chip ("Earnings"), structure chip ("Short Iron Butterfly"), notes, open date/time, close date/time with holding days, cost, P&L, P&L %.
  2. **The expanded child rows**, one per leg: type (Call/Put), expiry, strike, size (signed: `-5` short, `+5` long), cost, P&L, P&L %.
  3. **The row's designer link**, whose query string encodes every leg — `positions[i][buySell|size|type|strike|expiration]` — plus the structure `name` and the symbol. This is where the **ISO expiry** comes from (`2026-09-11`); the table only shows "Sep 11 (2d)". Leg `price` values in the link are unreliable (mostly `0`) and are ignored.
  - MUI class names are hashed and unstable, so cells are read **by column index resolved from the header labels**, never by class.
- **Derived on import** (worked through on a sample row, a 4-lot broken-wing fly):
  - leg open price = |leg cost| ÷ (size × 100); leg close cash = leg P&L − leg open cash, giving the close price;
  - **fees = Σ leg cost − row cost** (that row: −1,200.00 vs −1,192.00, so $8.00). The same difference appears in P&L (+520.00 vs +512.00), so the numbers reconcile and fees need not be guessed;
  - the import preview shows this reconciliation per trade and flags any row where it doesn't balance.
- **No stable identifier exists.** The link's `portfolio-0-1790108523081` is generated at render time and changes on reload. Identity therefore comes from a **natural key**: ticker + open timestamp + close timestamp + sorted (right, strike, size) legs. The trade's UUID is UUIDv5 of that key, which makes re-imports idempotent and keeps both machines in agreement (§12).
- **Dates need repair.** Displayed dates carry no year ("Sep 9"), so the year is taken from the link's ISO expiry, stepping back one year if that would place the open after expiry. Times are rendered in the viewer's timezone, so the snippet records `Intl.DateTimeFormat().resolvedOptions().timeZone` in its output, and the import preview shows both the original text and the converted ET time for confirmation.
- **Collection mechanics:** the snippet expands every collapsed row (clicking the chevron buttons), waits for the leg rows, walks all pages of the table, and accumulates. It then downloads `oquants-trades.json`.
- Fallback if the markup shifts: the Next.js flight payload embedded in the page (`self.__next_f`) carries the same records and can be parsed.
- The snippet never reads session cookies or tokens, and none are stored in the repo or in the journal's data directory.
- That JSON is dropped into the importer, which has a **built-in oQuants mapping**, so the column-mapping step is skipped.
- The snippet only ever touches the user's own account data, it runs manually, and it stores no credentials. Re-running it and re-importing is safe: rows carry oQuants' own trade IDs in `external_ref`, so duplicates are detected.
- Fallback if the page's markup changes: copy the table and paste it into the generic mapper (§7.2), which loses the per-leg detail but keeps the numbers.

### 7.3 Iron fly metrics (computed in `core`)

- **Wings are handled independently**, so broken-wing flies work:
  - call-side width = call wing − call body; put-side width = put body − put wing;
  - call-side risk = (call-side width − credit) × 100 × contracts; put-side risk likewise;
  - **max loss** = the larger of the two. Both are shown, since a broken wing means one side is the real risk.
- **Max profit** = credit × 100 × contracts (minus fees).
- **Return on risk** = net P&L ÷ max loss. **% of max profit captured** = net P&L ÷ max profit.
- **P&L % of cost** = net P&L ÷ |net cost|, the same number oQuants shows, so imported rows reconcile against the source. Return on risk is the one used for ranking, since P&L % of cost is measured against the credit and flatters wide-wing trades.
- **Breakevens** = body ± credit per share, with the wings marking where the loss stops growing.
- **Actual move %** = |S_post − S_pre| ÷ S_pre, where:
  - S_pre is the regular-session close before the announcement (AMC: same day; BMO: previous trading day);
  - S_post is the first regular-session open after it.
  - Imported values take precedence. Otherwise it is derived from daily bars (Phase 2 backfill).
- **Move ratio** = actual ÷ implied, with buckets `<0.5×`, `0.5–1×`, `1–1.5×`, `>1.5×`.
- **IV crush %** = (IV before − IV after) ÷ IV before.
- The trade page also shows, so an imported trade can be reconciled against its oQuants row at a glance: the **leg breakdown** (type, expiry, strike, size), the **structure label**, the **source notes**, **open and close date/time with holding days**, **net cost**, **P&L** and **P&L % of cost**.
- **P&L attribution (estimate)**: shown only when all strikes, both IVs and both underlying prices are present.
  - Reprice the position with Black-Scholes at the exit IV and the *entry* underlying price. The difference is the **IV-crush P&L**.
  - The remainder of the actual P&L is the **price-move P&L**.
  - Labeled "estimate" in the UI.

---

## 8. Features: scalps (Phase 2)

### 8.1 IBKR sync

- Settings, per account (live and paper): a Flex Web Service token and a Flex Query ID, stored in `secrets.json`.
- **Sync** button flow:
  1. `SendRequest` returns a reference code.
  2. Poll `GetStatement` with backoff while the statement is still generating.
  3. Parse the XML and upsert fills.
  4. Regroup trades.
- **Idempotent and deterministic IDs:**
  - fill `id` = UUIDv5(`ibkr:{account}:{execId}`)
  - trade `id` = UUIDv5(`ibkr:{account}:{first opening execId}`)
  - leg `id` = UUIDv5(`{tradeId}:{conid}`)

  Both machines therefore produce **identical records** for the same fills, which the merge in §12 relies on.
- **Grouping:** per (account, contract), a running position going from 0 to non-zero and back to 0 is one trade. Scaling in and out and partial fills are supported. A position that is still open is kept as `status=open` and completes on a later sync.
- **Scope:** single-leg option executions become `scalp` trades (re-classifiable). Executions that belong to multi-leg orders are skipped, with a notice in the sync summary. A multi-leg order is detected when one order ID has fills across more than one contract. Stock executions are ignored.
- **No resurrection:** a sync never revives a soft-deleted trade. Its fills are stored, but the trade stays deleted.
- **Review queue:** synced scalps with no stop level, setup or grade appear under **To review**, with a badge count in the nav.

### 8.2 Market data and the generated chart

- The `MarketDataProvider` interface has `getMinuteBars(symbol, sessionDate)` (04:00–20:00 ET) and `getDailyBars(symbol, from, to)`.
- **Massive** adapter (free tier):
  - split-adjusted minute and daily aggregates;
  - a client-side queue limits requests to 5/min, with retry on 429;
  - the API key comes from `secrets.json`.
- **Cache:** bars are stored in `bars` forever, because historical bars don't change. They are fetched lazily when a trade page opens, and prefetched after a sync. Opening one scalp costs up to 4 minute-bar calls (its session plus 3 prior sessions for EMA warm-up) and one daily-bar call, all of which are then cached. At 5 calls/min, the first open of a trade can take a few seconds; the chart renders as soon as the trade's own session arrives and the EMAs fill in behind it.
- **Chart** (Lightweight Charts):
  - Candles plus volume. Timeframes: **1m, 3m, 5m, 10m, 30m and daily**. 1m is native and 3m/5m/10m/30m are aggregated from it client-side; daily comes from daily bars. Time axis in ET.
  - **Markers:** an arrow at each entry and exit fill, labeled with quantity and price.
  - **Price lines:** stop (red, dashed), target (green, dashed), and levels (thin, labeled).
  - TradingView attribution is kept as the library's license requires.
- **Indicators and levels**, computed in `core` so they are testable. Each toggles independently, and the set of enabled toggles is remembered:
  - **EMA 8, 20, 50 and 167** (periods editable in settings);
  - **session VWAP**, anchored at 09:30 ET;
  - **premarket high** and **premarket low** (04:00–09:29 ET);
  - **previous day high** and **previous day low** (regular session).
- **EMA warm-up:** an EMA is only meaningful with roughly 3× its period of prior bars, and the 167 EMA on a 1-minute chart needs about 500 bars, which is more than one session. Bars are therefore loaded from **up to 3 previous sessions** for warm-up, and drawn only once enough history exists. Where it doesn't (a stock's first days, or a gap in free-tier history), that EMA is hidden with a tooltip saying why.
- On the **daily** timeframe, VWAP and the premarket/previous-day levels don't apply and are disabled; the EMAs use daily bars.
- **No data** covers: index underlyings not in the free stocks tier (SPX, NDX), sessions older than about 2 years, today's session before data is published, and a missing API key. In these cases the chart area shows an empty state with a reason and an **Attach screenshot** call to action.

### 8.6 Option chains and live marks (used by the builder, §7.1)

- **Chains.** For a given underlying, Alpaca supplies the listed expirations and, for a chosen expiration, the listed strikes. The builder turns both into pickers, so a position can only be built from contracts that exist. Chains are cached per underlying and expiry for the session; when the API is unreachable the fields fall back to plain typed entry with a notice, rather than blocking the entry of an old trade.
- **Live marks.** While a position is open, the builder and the trade page show the **current premium per leg** and the unrealised P&L it implies, clearly labelled as an estimate and shown in muted type.
- **Estimates never become records.** A live mark is never written into an exit price, and never stored as the trade's P&L. Exit fields stay empty until the real fills are typed in. A trade only counts as closed once its exit prices are entered.
- **Credentials** live in `secrets.json` in the data directory (§5), never in the repository or an export bundle. Without a key the app still works; only the pickers and marks go quiet.

### 8.3 Risk and R (Black-Scholes, in `core/pricing`)

- **Model:** European Black-Scholes with no dividends, used as the approximation for short-dated American equity options. The limitation is documented in the UI tooltip and the README.
- **Inputs at entry:**
  - the leg's average entry price;
  - the underlying price at entry: the close of the 1m bar containing the first entry fill, overridable;
  - the strike;
  - time to expiry to the minute, to 16:00 ET on expiry day (critical for 0DTE);
  - the risk-free rate from settings (stored on the trade).
- **IV solve:** Newton-Raphson on vega, falling back to bisection, bounded to [1%, 500%]. If the price is below intrinsic value or the solve fails, the trade is flagged **risk needs manual input**.
- **Estimated option price at stop:** a full Black-Scholes reprice with S = stop level, the same IV and the same time to expiry (the "instant move" assumption). The UI notes that for 0DTE, time decay makes the real loss at the stop somewhat larger.
- **Planned risk ($)** = (avg entry price − est. price at stop) × contracts × multiplier. `risk_override` replaces it when set. Targets give **planned reward** and **planned R:R** the same way.
- **R-multiple** = net P&L ÷ planned risk.
- **MAE/MFE:** from the 1m bars between first entry and last exit, the worst and best underlying excursion against the trade direction. Stored in dollars of underlying and in R units (÷ |entry − stop|).
- Also stored per trade: **minutes after open** (first entry − 09:30 ET), **hold time**, and **option cost** (avg entry × contracts × multiplier).

### 8.4 Missed trades

- Created from **New → Missed trade**: pick the underlying, session date and direction; the chart loads.
- **Chart-marking mode:** click to place **Entry** (time + price), drag a horizontal line for **Stop**, click to place **Exit**. An optional **Target** can be added too. Every value stays editable in the side form.
- **R** = (exit − entry) ÷ |entry − stop|, sign-adjusted for direction.
- Also recorded: MAE/MFE from bars, setup, tags, grade, notes, `skip_reason` (preset list plus free text) and screenshots.
- Missed trades never contribute dollars. With the Missed book selected they contribute to R-based stats. A **Missed opportunity** KPI shows the sum of R across missed trades.

### 8.5 Screenshots (all trades)

- Add by pasting (Ctrl+V anywhere on the trade page), drag-and-drop, or file picker. PNG, JPEG and WebP are accepted, up to 20 MB each.
- Stored content-addressed, so the same image attached twice is stored once.
- Lightbox with zoom and captions.

---

## 9. Review and analytics (Phase 1 core, extended in Phase 2)

- **Tagging:** a setup (playbook page with per-setup stat cards), mistake tags, one emotion tag, grade A–F, and Markdown notes. All are editable inline from the trade page and the journal grid.
- **Global filter bar** (persisted in the URL): book (Live / Paper / Missed, multi-select), strategy, account, date range, ticker, setup, tag, and **include excluded**.
- **Two separate surfaces:**
  - the **Dashboard** is the landing page: how the current period is going, recent trades, and anything sitting in the review queue;
  - **Analytics** is its own page for aggregated stats, with tabs for **Overview, Scalps, Iron flies, Missed and Setups**, the global filter bar applied across all of them, and CSV export of any table it shows.
- **Dashboard and Analytics Overview share these:**
  - KPIs: net P&L, win rate, profit factor, expectancy ($/trade), avg R, trade count, max drawdown;
  - equity curve with drawdown shading;
  - month P&L calendar (click a day to see its trades).
- **Time of day** (scalps): net P&L, avg R and win rate by minutes-after-open bucket (0–5, 5–15, 15–30, 30–60, 60+) and by hold-time bucket.
- **Breakdowns:** choose any dimension (setup, ticker, DTE, call/put, book, grade, emotion, mistake, weekday, earnings timing, move-ratio bucket). The result is a table (count, win %, net, avg R, PF) plus a bar chart.
- **Mistake cost:** for each mistake tag, the net P&L and avg R of trades that carry it, next to the same numbers for trades that don't.
- **Iron fly page:**
  - implied vs actual move scatter (win/loss colored, with a y = x line);
  - IV crush distribution;
  - P&L by move-ratio bucket;
  - % of max profit captured distribution.
- **Definitions** (in `core/stats`, unit-tested):
  - win: net P&L > 0 (missed: R > 0); loss: < 0; scratch: = 0;
  - profit factor = gross wins ÷ |gross losses|;
  - expectancy = mean net P&L;
  - excluded and soft-deleted trades are removed before any aggregation.

---

## 10. Visual design: direction A, "Terminal" (chosen)

- TradingView's own dark palette, so trade charts and the rest of the app look like one product:
  - background `#0b0e14`, panels `#131722`, lines `#1f2430`, text `#d1d4dc`, muted `#6b7385`;
  - accent `#2962ff`, up `#26a69a`, down `#ef5350`.
- **Inter** for UI text and **JetBrains Mono** for every number (tabular, aligned). Uppercase micro-labels. 2–3 px radii. Dense tables.
- Semantic chips: strategy (IRON FLY violet, SCALP amber), book (LIVE green, PAPER blue, MISSED grey), and EXCLUDED (dashed outline).
- Layout: a left nav (Dashboard, Journal, Analytics, Iron Flies, Scalps, Missed, Playbook, Import / Sync, Settings) and a top filter bar.
- On a trade page, secondary detail (the leg breakdown, the raw imported row) sits behind an expander rather than on screen by default, so the page opens on the numbers that matter.
- Dark by default. A light theme exists (tokens defined once in CSS variables), but it is not the design focus.
- Command palette (Ctrl+K) to jump to trades, pages and actions. Keyboard review flow: J/K for next/previous trade, and 1–5 to set the grade.

---

## 11. Public demo (Phase 3)

- **The real app, running entirely in the visitor's browser.**
  - The demo build instantiates `createApp()` in the page with Drizzle on **sql.js** (WASM SQLite, the same sync API as better-sqlite3).
  - The typed client calls it through `hc<AppType>(…, { fetch: app.request })`.
  - The UI is untouched.
- Hosted on **GitHub Pages**, deployed by GitHub Actions: no server, no cost, no cold start.
- **Seed data:** a deterministic generator creates around 6 months of plausible fake trades across both strategies and all three books. It includes synthetic minute bars, because real Massive data must not be redistributed.
- Visitors can click, filter, tag and edit freely. Changes live in memory and reset on reload. IBKR sync and API-key settings are hidden in demo mode.
- **Fallback** if the in-browser approach fails its Phase 3 spike: run the same `createApp()` on a small Node host with `mode: "demo"`.

---

## 12. Export, import and merge between machines

- **Export** writes a full snapshot as `journal-{machine}-{timestamp}.tjbundle` (zip):
  - `manifest.json` (format version, app version, schema version, `machineId`, export time, counts);
  - `data/*.json`, one file per syncable table;
  - `attachments/`.
  Bars and secrets are excluded.
- **Import (merge)** runs in one transaction after an automatic backup. A bundle with a newer schema than the app is refused, with a message to update the app first.
- **Merge rules** per trade aggregate (trade + details + legs + fills + tag links + attachment metadata):
  - **Fills:** set union by ID. They are immutable broker facts, and IDs are deterministic (§8.1). Legs and P&L are recomputed from the merged fills.
  - **User-editable fields** (stop, target, setup, tags, grade, emotion, notes, excluded, details for manual/imported trades): **last writer wins by `edited_at`**. A trade that was only synced and never edited has `edited_at = null`, so it never overwrites someone's annotations.
  - **Deletes:** a tombstone (`deleted_at`) beats an edit only if it is newer.
  - **Other syncable tables** (accounts, setups, tags, mappings): the record with the newer `updated_at` wins.
  - **Attachments:** files missing locally are copied by sha256.
- **Summary** after merge: counts of added, updated from the bundle, kept local, deleted, and fills added.
- **Guarantees** (property-tested with fast-check):
  - merge is **idempotent**: importing the same bundle twice changes nothing;
  - merge is **order-independent**: A→B then B→A converges.
  Wall-clock last-writer-wins is acceptable for a single user.

---

## 13. Phases

Each phase ends usable, and each gets its own implementation plan.

**Phase 1: Foundation and iron flies** (get the history in and analyzed)
1. Monorepo scaffold, Biome, Vitest, CI matrix (Ubuntu + Windows), README skeleton, MIT license.
2. Data directory, secrets, backups; Drizzle schema, migrations and repositories.
3. App shell in the Terminal theme: nav, global filter bar, command palette skeleton.
4. Journal grid and trade detail page; manual iron fly entry; exclude flag; soft delete.
5. CSV/paste importer with column mapping, saved mappings, preview, undo, duplicate guard.
6. oQuants browser extractor snippet plus its built-in mapping (§7.2b), including per-leg detail.
7. Iron fly metrics and P&L attribution in `core`; dashboard, calendar, equity curve, breakdowns, iron fly page.
8. Setups, mistake/emotion tags, grades, notes.
9. Export bundle and merge import.

**Phase 2: Scalps**
1. IBKR Flex sync (live + paper), deterministic IDs, fill grouping, review queue.
2. Market data module (Massive), bar cache, trade chart with markers, stop/target lines, indicators and levels.
3. Black-Scholes and IV risk engine, R-multiples, MAE/MFE, time-of-day analytics.
4. Screenshots.
5. Missed trades with chart marking.
6. Iron fly backfill: derive `actual_move_pct` from daily bars where missing.

**Phase 3: Public demo and polish**
1. Spike: in-browser `createApp()` on sql.js. Go, or fall back to a Node host.
2. Deterministic fake-data and synthetic-bar generator.
3. Demo build and GitHub Pages deploy workflow.
4. PWA install, keyboard review flow, full command palette.
5. README with screenshots/GIF, an architecture diagram, "run it yourself" instructions for Linux and Windows, and CONTRIBUTING.

---

## 14. Error handling

| Situation | Behavior |
|---|---|
| Import row fails validation | Shown in the preview with row number and reason; the row is skipped; the rest imports. |
| Import or merge crashes midway | Transaction rolls back; the pre-import backup is kept; an error is shown with a path to the backup. |
| Bundle schema newer than app | Refused, with an "update the app on this machine first" message. |
| Flex statement still generating | Poll with exponential backoff (up to ~2 min), then "try again shortly". |
| Flex token invalid or expired | Sync summary names the account and links to Settings; other accounts still sync. |
| Massive 429 / network error | Queued retry with backoff. Chart shows loading and then the no-data state. Never blocks the page. |
| IV solve fails | Trade flagged **risk needs manual input**; R shows "—" until `risk_override` is set. |
| DB migration | Automatic backup first; on failure the app refuses to start and prints the backup path. |
| Missing data directory | Created on first run. Its location is printed on startup and shown in Settings. |

---

## 15. Testing strategy

- **`core`** (the largest suite):
  - Black-Scholes prices and greeks against reference values;
  - IV round-trip (price → IV → price);
  - fill grouping edge cases: scale in/out, partials, a position open across a sync;
  - stats definitions; iron fly metrics; indicators against hand-computed fixtures (VWAP anchoring, EMA warm-up, premarket window across DST);
  - merge properties (idempotence, convergence) with fast-check.
- **`importers`:** fixture files (a sanitized IBKR Flex XML, and the oQuants sample once provided), mapping transforms, duplicate detection.
- **`server`:** the Hono app via `app.request()` on in-memory SQLite, covering routes, validation, the import transaction and rollback, and the DNS-rebinding guard.
- **`web`:** focused component tests for the mapping wizard and chart marking. A **Playwright** smoke run on the demo build: open, filter, open a trade, tag it.
- **CI** runs everything on Ubuntu and Windows. Fixture data is fake or sanitized; real data never enters the repo.

---

## 16. Open items to verify

These are facts to confirm at the start of the relevant phase. None of them blocks the design.

1. **oQuants extraction (Phase 1):** resolved. Markup for a parent row and its four leg rows was captured, the field mapping is written up in §7.2b, and the totals reconcile. Two small unknowns remain, both answerable while building the snippet against the live page: how the table paginates (page-size control vs infinite scroll), and confirmation that displayed times are in the viewer's timezone rather than ET.
2. **IBKR Flex (Phase 2):**
   - whether paper accounts support the Flex Web Service (fallback: upload a Flex file);
   - which query type includes same-day executions;
   - the exact field names for execution ID, order ID and conid.
3. **Alpaca (next):** confirm the free plan's chain endpoint coverage and rate limits, and how quickly indicative quotes update, before relying on live marks during the session.
4. **Massive free tier (Phase 2):** when a session's minute bars become available, whether extended hours are included, and the current rate limits.
5. **Lightweight Charts (Phase 2):** confirm the current attribution requirement.
6. **In-browser demo (Phase 3):** the spike in Phase 3, step 1 (§13) confirms that Hono and Drizzle/sql.js work in-page within a reasonable bundle size.
