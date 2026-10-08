# Demo data and README — Design Spec

- **Date:** 2026-10-08
- **Status:** Approved on autopilot, 2026-10-08. The user's grant covers the wrap-up ("anything to wrap up the project or get close to most goals completed… do as much as possible without asking"), so the decisions in §2 are mine, recorded for the user to revisit.
- **Scope:** parent spec §13, Phase 3 items 2 (a deterministic fake-data and synthetic-bar generator) and 5 (the README with screenshots, an architecture diagram, run-it-yourself steps for Linux and Windows, and CONTRIBUTING).
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §11 (the public demo's seed data) and §13.

---

## 1. Purpose and success criteria

Anyone looking at the project, a recruiter or the user showing it, should see the journal full of plausible trades, with working charts, in one command and without an Alpaca key or an IBKR token. The README's screenshots should come from that same data, never from the user's real journal.

**Success:**
- **One command:** `pnpm demo` builds the app, creates a fresh journal of about six months of fake trades in a throwaway directory, and opens it on its own port. The user's own data directory is never touched.
- **Charts work offline:** every trade's stock chart, daily chart and option-premium chart draws from synthetic bars, with no "add an Alpaca key" message.
- **Plausible:**
  - scalps and earnings iron flies, in the live and paper books;
  - P&L that adds up from the legs and fees;
  - premiums that follow the stock;
  - reviews, setups, tags, grades and notes filled in, with a few recent scalps left in the review queue.
- **Deterministic:** the same seed and end date give the same trades, prices and bars.
- **README:** screenshots of the demo, an architecture diagram, run-it-yourself steps for Linux and Windows, and a CONTRIBUTING guide.

### Out of scope
- **The in-browser public demo** (Phase 3 items 1 and 3: sql.js, GitHub Pages). The generator is written so it can serve that later (§3.1), but nothing is built for it here.
- **Missed trades,** which have no UI yet: the `missed` book stays empty.
- **IBKR fills.** Demo trades are entered as manual trades with legs; no fills, no sync state.
- **Screenshots attached to demo trades,** since fake images would add nothing.
- **Open trades,** since their live marks need an Alpaca key. Every demo trade is closed.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Where the generator lives | **A new package, `packages/demo` (`@tj/demo`)**, depending only on `@tj/core` and `@tj/db`, with no Node-only imports. The local command uses it now, and an in-browser demo could later call it at startup. |
| How rows get in | **Through the app's own repositories** (trades, taxonomy, bars, scalp prices), so every row passes the same validation as a typed-in trade. |
| The command | **`pnpm demo`** = `pnpm build`, then `apps/server/src/demo.ts`: wipe and recreate `<os temp>/trading-journal-demo`, migrate, generate, then start the normal server on it. `TJ_DEMO_DIR` and `TJ_PORT` override the directory and the port (default **4179**, so it can run next to the real app on 4178). |
| Determinism | A seeded PRNG (mulberry32), seed **42** by default. Each symbol's prices draw from their own stream, seeded from the seed and the symbol, so adding a symbol changes no other. Trade ids are the repositories' random UUIDs: the content is deterministic, the ids aren't. |
| The period | **Six months of sessions ending on an end date**: by default the last finished New York trading day before today, so "this week" and the review queue look current. `--end YYYY-MM-DD` fixes it, as the README screenshots do. |
| Sessions | **The regular session only**, 09:30 to the close (16:00, or 13:00 on half days, from `regularClose`): 390 one-minute bars a full day. No extended hours: nothing in the demo trades there. |
| Symbols | **Scalps:** SPY, QQQ, NVDA, TSLA (daily expiries on SPY and QQQ, Friday weeklies on the others). **Iron flies:** ten earnings names (NFLX, ORCL, MU, NKE, FDX, ADBE, COST, AVGO, CRM, LULU), each reporting about once a quarter. |
| Price paths | **A daily geometric random walk per symbol**, then each day it trades, a **minute path bridged from the open to that day's close** with a U-shaped intraday volatility. A day's daily bar aggregates its minutes, so the two charts agree. Earnings days open with a gap: the earnings move. |
| Option prices | **Black-Scholes** (`bsPrice` in core) on the minute closes, with each symbol's IV plus a little noise; never below intrinsic. Option bars are written only for the scalp's own day. Its other chart days are recorded as known and empty, as for a contract that didn't trade. |
| How scalps are made | **1–4 a trading day on about 60% of sessions** (~140–200 in six months). The entry is mostly in the first 90 minutes, crowding the open; a call or a put, 1–5 contracts, a strike one step out of the money, with strikes spaced by the stock's price ($0.50 under $25, $1 under $200, $2.50 under $500, else $5). The exit is the first of: the target, the stop, or a 5–40 minute time stop. Stock levels sit a share of the stock's daily move away (stop 0.08–0.13, target 0.12–0.22); premium levels at −25–40% and +40–80%. The direction follows the next 30 minutes' drift 74% of the time. That gives a modest edge (about +$12 a scalp), a win rate around 50%, a positive Avg R, and real losers. *(Tuned in the live check, §8: the first figures, a 58% read and fixed percentages, gave a 36% win rate.)* |
| How flies are made | **One per earnings event:** entered the session before the report, closed the session after. The body is at the money, with wings about 1.5 implied moves out, 1–3 contracts. The credit is priced at the pre-earnings IV (70–120%) and the exit at the crushed IV (30–45%) on the gapped price. The gap is drawn with a spread of about 0.9 implied moves, so selling the move wins somewhat more often than it loses, as the strategy hopes. Implied move, actual move, IV before and after, and the earnings date and timing are all filled in. |
| Books | Scalps ~70% live and ~30% paper; flies live. |
| Annotations | Setups and tags come from the seeded taxonomy. Grades lean with the outcome (winners mostly A/B, losers B–D, a few F). About half the trades get a short note from a list of templates. A third of the losers carry a mistake tag. |
| Review state | Scalps older than the last three sessions are fully reviewed (setup, grade and stop). The last three sessions' scalps are left partly reviewed, so the queue holds a handful. |
| Scalp prices (R) | The generator writes each scalp's stock at entry and its stock and option ranges over the hold, using core's `stockAt` and `holdRange` on its own bars, the same way the server's price filler does. Avg R and the R column are filled from the start. |
| README images | PNGs in `docs/images/`, taken from `pnpm demo` with a fixed `--end` in headless Firefox, about 1440×900. |

---

## 3. The generator (`packages/demo`)

### 3.1 Interface
- `generateDemo(db: Db, options: { seed?: number; end: string; months?: number; now?: () => number }): DemoSummary`
  - `end` is the last session to trade; `months` defaults to 6.
  - It returns `{ scalps, flies, bars, from, to }` for the command to print.
- **Pure:** no `node:fs`, `node:os` or clock reads except through `now`, so the same code can run in a browser over sql.js later.
- **Units, each in its own file:**
  - `random.ts`: the PRNG and its helpers (uniform, normal, pick, weighted pick, a stream per key);
  - `prices.ts`: the daily walk, the minute bridge and option bars;
  - `scalps.ts` and `flies.ts`: trade plans as plain objects (no database);
  - `write.ts`: the repository calls;
  - `index.ts`: `generateDemo`.

### 3.2 Prices
- **The daily walk** covers each symbol from 1,095 calendar days before the period's first session (the daily chart's reach) to the end, over trading days only.
  - Each symbol has a starting price and an annual volatility.
  - The walk has a small upward drift, so the indexes end higher.
- **A day's minute path:**
  - It opens at the previous close times a small gap, or the earnings gap on a reaction day.
  - It is a Brownian bridge to the day's close, with the volatility higher in the first and last half hour.
  - Each minute bar's high and low come from four sub-steps.
  - Volume is U-shaped and scaled by symbol.
- **Daily bars:** a day with minutes takes its open, high, low and close from them. Any other day gets an open near the previous close and a range scaled by its volatility.
- **Coverage, in `bars` and `bar_days`** (`bar_days` takes every calendar day in range, with `count` 0 on non-sessions):
  - each symbol's daily bars from the walk's start to the end date;
  - minute bars for every session in each trade's chart range (seven days before the entry through the exit day);
  - each scalp contract's minute bars on its trade day, and known empty days for the rest of its chart range.

### 3.3 Trades
- **Scalps** follow §2. Their legs carry open and close prices taken from the option minute bars at the entry and exit seconds. `netPnl` is `(close − open) × quantity × 100 − fees`. Fees are $0.65 a contract a side plus $0.02 a contract in exchange fees.
- **Levels:**
  - most scalps get a stop on the stock (the stop the exit rule used); about one in five gets a premium stop instead;
  - one or two targets, the last at the exit's target price for a winner;
  - trims that never exceed the position.
- **Iron flies:** four legs (long put wing, short put body, short call body, long call wing). Their P&L comes from the open credit and the closing debit, less fees. `ironFly` details are filled per §2.
- **Order:** trades are created in time order, with `now` set to each trade's close plus a few minutes, so `created_at` and `updated_at` look like a journal kept day by day.

### 3.4 Validation
`generateDemo` runs inside one transaction. If any repository call refuses a planned trade, the whole generation fails with that trade's description, rather than leaving a half-made journal: a refusal is a generator bug.

---

## 4. The command (`apps/server/src/demo.ts`)

1. Resolve the directory (`TJ_DEMO_DIR`, or `<os temp>/trading-journal-demo`). Refuse it if it is the real data directory (`resolveDataDir`), or if it exists and isn't a previous demo (no `.tj-demo` marker file).
2. Wipe it, recreate it, write the marker, migrate, and run `generateDemo` with `--seed` and `--end` from the command line.
3. Print what it made (sessions, scalps, flies, bars) and the directory.
4. Start the server as `index.ts` does, with `TJ_DATA_DIR` set to the demo directory and `TJ_PORT` defaulting to 4179. There is no `secrets.json`, so market data and IBKR sync stay off.
- **Root script:** `"demo": "pnpm build && pnpm --filter @tj/server demo"`; the server package gets `"demo": "tsx src/demo.ts"`.

---

## 5. README and CONTRIBUTING

- **README:**
  - a hero screenshot under the title (the Dashboard);
  - a short **Try it with demo data** section: `pnpm install`, then `pnpm demo`, then open http://localhost:4179;
  - a gallery of 4–6 screenshots: a scalp's page with the chart, the review strip and R; Analytics; the Iron flies tab; the Journal list;
  - an **Architecture** section with a Mermaid diagram (web → typed client → Hono `createApp()` → repositories → SQLite, with market data and IBKR beside it, and the demo generator feeding the same database), plus a paragraph on the one seam (parent spec §6);
  - **Run it yourself** for Linux and Windows (`start.sh` / `start.cmd`, or `pnpm start`), keeping the existing Quickstart's facts.
- **CONTRIBUTING.md:**
  - setup (Node 22+, pnpm), and the checks to run before a PR (`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`);
  - where specs and plans live (`docs/superpowers/`);
  - the rule that real trading data never enters the repo (fixtures are fake);
  - CI on Ubuntu and Windows.

---

## 6. Testing

- **`random.ts`:** the same seed gives the same sequence; streams per key are independent of each other's order of use.
- **`prices.ts`:**
  - every bar has `low ≤ min(open, close)` and `high ≥ max(open, close)`;
  - a day's minutes end at its daily close, and the daily bar aggregates them;
  - a half day stops at 13:00;
  - an earnings day opens with its gap;
  - option bars stay at or above intrinsic.
- **`generateDemo`**, on an in-memory journal, with a fixed end:
  - counts in range (scalps 120–320, flies 15–40), all closed, in the live and paper books only;
  - each trade's P&L equals its legs less fees;
  - each scalp's entry and exit fall inside a session;
  - running it twice gives the same content (the trades' fields, without ids);
  - older scalps pass `reviewStatus`, and a few recent ones don't;
  - scalp prices exist for every scalp.
- **Server:**
  - with the demo journal and **no market keys**, the bar service answers every trade's minute, daily and option ranges with bars, not `no_key`;
  - `demo.ts`'s directory guard refuses the real data directory and a directory without the marker.
- **Live check:** run `pnpm demo --end <fixed date>`, open it in headless Firefox, and look at the Dashboard, Journal, a scalp, a fly, Analytics and the Playbook: charts drawn, no key messages, no console errors. These are the README's images.

---

## 7. Risks

- **Size:** about four scalp symbols and ten fly names over six months is ~300K minute bars (with the scalp contracts'), a database of tens of MB, generated in seconds. If generation takes over ~15 s, trim the fly names' minute coverage to their trade days first.
- **Plausibility tuning:** the exit rule and the 58% direction skill set the demo's stats. The tests pin wide ranges, not exact figures, so tuning stays free.
- **The calendar:** `isTradingDay` and `regularClose` already know holidays and half days, so a generated session never falls on a closed day.

---

## 8. Live check (2026-10-08)

`pnpm demo --end 2026-09-30` (seed 42):
- **What it made:** 143 scalps and 20 iron flies from 2026-04-01 to 2026-09-30, with about 256,000 bars, generated in about 2 s, in a journal.db of 25 MB. It served on port 4179 with market data off.
- **Headless Firefox at 1440×900:** the Dashboard, Journal, a scalp, a fly, Analytics (Scalps and Iron flies tabs) and the Playbook. No console errors on any page, and no "add an Alpaca key" message. The stock, daily and option-premium charts all drew from the synthetic bars. These are the README's images.
- **Tuning found by looking:**
  - The first run's scalps won 36% (NVDA 10%). A fixed $2.50 strike step put a $60 stock's first out-of-the-money strike 4% away, and fixed percentage levels were wide for SPY and tight for TSLA. Strikes now space by price, and levels by each symbol's volatility.
  - The second run's Avg R came out negative on a profitable book, because the targets sat nearer than the stops. The final figures (§2) give 51% wins, Avg R +0.13, a profit factor of 1.96 and +$2.9K on the scalps, and +$5.8K on the flies.
- **Speed:** `bars.store` built Drizzle SQL for every insert, and a month's generation took 2.6 s. It now runs one prepared statement a row: a month in 0.5 s, six months in 2 s. This speeds the real app's Alpaca fills too.
- **Dashboard:** it opens on the current month, which lies after a fixed `--end`. The README's image uses `/?period=month&at=2026-08-14`; run without `--end`, the demo ends yesterday, so the current month has trades.
