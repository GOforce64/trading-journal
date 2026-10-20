# IBKR Live-Account Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second set of IBKR Flex credentials, for the live account, synced beside paper by the same button and auto-sync.

**Architecture:** `secrets.json` gains `ibkrLive` beside `ibkr` (paper). The sync service runs each configured book in parallel through the existing per-account pipeline, with its own `sync_state` row, and answers a report holding one summary per account. Settings gets a panel per book; the Import card a block per account.

**Tech Stack:** TypeScript, Hono + zod (server), Drizzle on better-sqlite3, React + TanStack Query (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-ibkr-live-sync-design.md` (the parent is `2026-09-29-ibkr-flex-sync-design.md`).

## Global Constraints

- `type IbkrBook = "paper" | "live"`; paper always comes first in any list.
- `secrets.json`: paper stays `ibkr`, live is `ibkrLive`, with the same shape `{ token, activityQueryId, todayQueryId, since }`.
- `sync_state.source`: paper `"ibkr"` (unchanged, no migration), live `"ibkr_live"`.
- The wrong-account refusal text, verbatim: `These queries belong to the paper account DU1234567: use the live account's own queries.` and, the other way, `These queries belong to the live account U7654321: use the paper account's own queries.`
- Copy: the card's title is `IBKR sync`. The Settings panels are `IBKR Flex · paper` and `IBKR Flex · live`. The live panel's extra line: `Make the same two Flex queries (Activity, Today) while logged in to the live account; its token is in that account's Settings.`
- **European dates** in any text: D Mon YYYY.
- The token is never sent back.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before each commit. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A paper `sync_state` row written before this change** has a `lastSummary` with no `book`. Status must still show it as paper. Test: Task 3, "reads the paper run recorded before live existed".
2. **A broken `ibkrLive` entry** (hand-edited) must not switch off the paper sync or Alpaca. Tests: Task 1 (read alone), Task 3 (live config throws → paper still syncs).
3. **One account failing while the other succeeds:** the report has both summaries, the failure's error, and the success's `changedTradeIds`. Test: Task 3.
4. **The app-open auto-sync racing the button** must still give one run per account. Test: Task 3 (the existing one-at-a-time test, with both books).
5. **Saving the live panel** must not clear or reset the paper panel's fields or entry. Tests: Task 4 (file) and Task 6 (UI).

---

### Task 1: `ibkrLive` credentials

**Files:**
- Modify: `apps/server/src/config.ts`
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Produces:
  - `export type IbkrBook = "paper" | "live"`;
  - `Secrets` gains `ibkrLive?: IbkrConfig`;
  - `readSecrets(file, only?: keyof Secrets)` accepts `"ibkrLive"` and judges it alone;
  - `export function readIbkrConfig(file: string, book: IbkrBook): IbkrConfig | null`, which throws like `readSecrets` on a broken entry;
  - `writeIbkrConfig(file: string, book: IbkrBook, config: IbkrConfig | null): void` (book added as the 2nd parameter).

- [ ] **Step 1: Write the failing tests** in `config.test.ts`:
  - `"reads the live entry on its own: a broken one leaves paper and Alpaca readable"`: a file holding a valid `ibkr`, a valid `alpaca`, and `ibkrLive: { token: "" }`. `readIbkrConfig(file, "paper")` equals the paper block; `readSecrets(file, "alpaca").alpaca` is defined; `readIbkrConfig(file, "live")` throws, and the message matches `/ibkrLive/` and doesn't contain the token.
  - `"writes each book's entry and keeps the other"`: `writeIbkrConfig(file, "live", LIVE)`, then `writeIbkrConfig(file, "paper", PAPER)`. The file's JSON equals `{ ibkr: PAPER, ibkrLive: LIVE }`. Then `writeIbkrConfig(file, "live", null)` leaves `{ ibkr: PAPER }`.
  - Update the existing `writeIbkrConfig` calls to pass `"paper"`.
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/config.test.ts`. Expected: FAIL (`readIbkrConfig` is not exported).
- [ ] **Step 3: Implement.**
  - Add `ibkrLive: ibkrSchema.optional()` to `secretsSchema`.
  - Make the `only` pick work for any key, e.g. `secretsSchema.pick({ [only]: true })`.
  - Add `EXPECTED.ibkrLive`, the same shape as `ibkr` under the `ibkrLive` key.
  - Use `const IBKR_ENTRY = { paper: "ibkr", live: "ibkrLive" } as const` for both read and write.
  - Update the callers: `routes/settings.ts` (Task 4 reworks it; for now pass `"paper"`) and `index.ts`.
- [ ] **Step 4: Run** the config tests, then lint, typecheck and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(config): an ibkrLive entry in secrets.json beside the paper one`.

### Task 2: Repo — a `sync_state` row per book, and the duplicate guard by book

**Files:**
- Modify: `packages/db/src/repositories/ibkr.ts` (`SOURCE`, `matches`, `recordRun`, `lastRun`)
- Test: `packages/db/src/repositories/ibkr.test.ts`

**Interfaces:**
- Produces: `recordRun(source: string, run: SyncRun): void` and `lastRun(source: string): LastRun | null`. The `SOURCE` constant goes, because the caller names the source.

- [ ] **Step 1: Write the failing tests:**
  - `"keeps one last run per source"`: `recordRun("ibkr", okRun)`, then `recordRun("ibkr_live", errorRun)`. `lastRun("ibkr")?.lastStatus === "ok"`, `lastRun("ibkr_live")?.lastStatus === "error"`, and `lastRun("other") === null`.
  - `"a typed paper scalp doesn't hide a live synced one; a typed live one does"`:
    - a typed scalp (`source: "manual"`, `book: "paper"`), and a synced candidate on the same contract and New York day with `trade.book = "live"`: `isDuplicate(candidate) === false`;
    - after the typed trade's book becomes `"live"`: `true`;
    - a paper candidate against the typed paper trade: still `true`.
  - `"the oQuants guard only matches a synced fly of the same book"`: `syncedFrom` with a `book: "paper"` fly against a synced live fly of the same structure gives `false`.
  - Update the existing `recordRun` / `lastRun` calls to pass `"ibkr"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/db/src/repositories/ibkr.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `matches`, add `eq(trades.book, trade.book)` to the `where`.
  - Make the source a parameter of `recordRun` / `lastRun`.
  - In `apps/server/src/ibkr/sync.ts`, pass `"ibkr"` for now, so the suite stays green.
- [ ] **Step 4: Run** the repo tests, then lint, typecheck and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): a sync run per source, and the duplicate guard compares the book`.

### Task 3: The sync runs every configured book

**Files:**
- Modify:
  - `apps/server/src/ibkr/sync.ts`;
  - `apps/server/src/routes/ibkr.ts` (types only);
  - `apps/server/src/app.ts` (`ibkrConfig` dep);
  - `apps/server/src/index.ts` (wiring).
- Test: `apps/server/src/ibkr.test.ts`

**Interfaces:**
- Consumes: Task 1's `IbkrBook`, `readIbkrConfig`; Task 2's `recordRun(source, run)` / `lastRun(source)`.
- Produces (exported from `sync.ts`):

```ts
export const SYNC_SOURCE: Record<IbkrBook, string> = { paper: "ibkr", live: "ibkr_live" };
export interface SyncSummary { /* as now, plus: */ book: IbkrBook; status: "ok" | "error"; /* "not_configured" removed */ }
export interface SyncReport { ran: boolean; changedTradeIds: string[]; accounts: SyncSummary[] }
export interface IbkrAccountStatus {
  book: IbkrBook; since: string; lastRunAt: number | null;
  lastStatus: "ok" | "error" | null; lastError: string | null; lastSummary: SyncSummary | null;
}
export interface IbkrStatus { configured: boolean; accounts: IbkrAccountStatus[] }
export interface IbkrSync {
  sync(options: { auto: boolean }): Promise<SyncReport>;
  status(): IbkrStatus;
  reset(tradeId: string): Promise<SyncReport | null>;
}
export interface IbkrSyncDeps { db: Db; config: (book: IbkrBook) => IbkrConfig | null; client: (token: string) => FlexClient; now?: () => number }
```

  `AppDeps.ibkrConfig?: (book: IbkrBook) => IbkrConfig | null`. `index.ts` passes `(book) => readIbkrConfig(paths.secretsFile, book)`.

- [ ] **Step 1: Rework the test harness** in `ibkr.test.ts`:
  - `setup({ paper?: Config | null, live?: Config | null }, answers)`. It defaults to paper only.
  - Add `LIVE = { token: "2234567890123456789012", activityQueryId: "2653145", todayQueryId: "2653147", since: "2026-09-28" }`.
  - The fake client answers by token and query: the live token answers `TODAY_XML` / `ACTIVITY_XML` with `DU1234567` replaced by `U7654321`.
  - `sync()` returns the `SyncReport`. The existing tests read `report.accounts[0]` where they read the summary.
  - The `"answers not_configured"` test becomes `"answers no accounts without credentials"`: `accounts` is `[]` and `ran` is `false`.
- [ ] **Step 2: Write the new failing tests:**
  - `"syncs both accounts, each into its own book"`: with paper + live, `accounts.map(a => [a.book, a.account?.kind, a.account?.externalId])` equals `[["paper","paper","DU1234567"],["live","live","U7654321"]]`. The trades list has the same scalps twice, with `book` `paper` and `live`; the live ones have `source: "ibkr_flex"`. `changedTradeIds` holds all of them.
  - `"syncs the live account alone"`: paper `null`. One summary, with `book: "live"`.
  - `"refuses queries from the other kind of account, and stores nothing"`: live set up with the paper fixture (`DU1234567`). The live summary has `status: "error"`, and its message is exactly `These queries belong to the paper account DU1234567: use the live account's own queries.` No live trades exist.
  - `"keeps one account's trades when the other fails"`: live today = `new FlexError("token", "…")`. Paper added > 0, live `status: "error"` with error kind `"token"`, and `changedTradeIds` is non-empty.
  - `"keeps paper syncing when the live entry can't be read"`: `config: (book) => book === "live" ? throws : CONFIG`. One summary, paper `ok`.
  - `"runs the 15-minute rule per account"`: sync both. `advance(1 min)`. Live's run is reset by recording an old `lastRunAt` (or live configured only after the first sync). An auto sync re-runs live only: `asked` shows live's queries and not paper's.
  - `"reads the paper run recorded before live existed"`: write a `sync_state` row with source `"ibkr"` and a summary JSON without `book` (straight through the repo). `GET /api/ibkr/status` gives `accounts[0].book === "paper"` and `accounts[0].lastSummary.book === "paper"`.
  - The existing one-run-at-a-time test, with both books: two parallel `sync()` calls ask each query once per book.
- [ ] **Step 3: Run** `pnpm vitest run apps/server/src/ibkr.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Split today's `run` into `runBook(book, settings, { auto })`. The kind check comes right after the account is known: `account.kind !== book` → `fail(new FlexError("failed", message), null, book)`. `fail` and `recordRun` use `SYNC_SOURCE[book]`.
  - `run({ auto })`:
    - reads each book's config, with each read in its own try/catch → null;
    - `Promise.all` over the configured books, paper first;
    - `ran` = any summary's `ran`;
    - `changedTradeIds` = the concatenation.
  - `status()` maps the configured books to `IbkrAccountStatus`, filling `book` into a stored summary that lacks it.
  - `reset` returns `run`'s report.
  - The single-flight `running` promise stays, around the whole report.
- [ ] **Step 5: Run** the IBKR tests, then lint, typecheck and the suite. The web won't compile until Task 5 if it reads the old shapes, so keep the web compiling now: update the types used in `apps/web/src/ibkr.ts`, `IbkrCard.tsx` and `SyncedBanner.tsx` minimally (read `accounts[0]`). Task 5 does them properly. Expected: PASS.
- [ ] **Step 6: Commit** `feat(sync): sync the live account beside paper, each in its own book`.

### Task 4: Settings routes per book

**Files:**
- Modify: `apps/server/src/routes/settings.ts`
- Test: `apps/server/src/settings.test.ts`

**Interfaces:**
- Consumes: Task 1's `readIbkrConfig`, `writeIbkrConfig(file, book, config)`.
- Produces:
  - `GET /api/settings` → `ibkr: { paper: IbkrView; live: IbkrView }`;
  - `PUT /api/settings/ibkr/:book`, with the same body as today;
  - `DELETE /api/settings/ibkr/:book`. An unknown `book` → 404 or 400 from zod.

- [ ] **Step 1: Update and write the tests.** The existing IBKR tests use `/api/settings/ibkr/paper` and `ibkr.paper`. New:
  - `"saves the live account's queries beside paper's, and removes them alone"`: PUT paper, then PUT live with another token and queries. `GET` shows both views with their own `tokenHint`, and the file has `ibkr` and `ibkrLive`. `DELETE /ibkr/live` leaves `ibkr.paper.configured === true` and `ibkr.live.configured === false`.
  - `"tests the live queries with the live token, keeping the saved one when left out"`: the `checkIbkr` calls are `[liveToken, "2653145"]` and `[liveToken, "2653147"]`.
  - `"refuses an unknown book"`: `PUT /api/settings/ibkr/demo` → not 200, and nothing is written.
- [ ] **Step 2: Run** `pnpm vitest run apps/server/src/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `ibkrView(book)`.
  - `zValidator("param", z.object({ book: z.enum(["paper", "live"]) }))` on the PUT and the DELETE.
  - The saved token falls back to the same book's entry.
- [ ] **Step 4: Run.** Keep the web compiling (`Settings.tsx` / `IbkrSettings.tsx`: point at `ibkr.paper` and the `paper` route). Then lint, typecheck and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): IBKR Flex credentials per book`.

### Task 5: Web — the Import card and the synced banner read every account

**Files:**
- Modify:
  - `apps/web/src/ibkr.ts` (types: `SyncReport`, `SyncSummary = SyncReport["accounts"][number]`, `IbkrStatus`);
  - `apps/web/src/routes/IbkrCard.tsx`;
  - `apps/web/src/routes/SyncedBanner.tsx`.
- Test:
  - `apps/web/src/routes/IbkrCard.test.tsx`;
  - `apps/web/src/ibkr.test.tsx`;
  - the status fixtures in `TradeDetail.test.tsx`, `EditTrade.synced.test.tsx` and `Import.test.tsx`.

**Interfaces:**
- Consumes: Task 3's `SyncReport` and `IbkrStatus`, over RPC.

- [ ] **Step 1: Write the failing tests:**
  - IbkrCard, `"shows a block per account, paper first"`: a status with both accounts' last summaries. Two `ibkr-status` lines: `Paper DUR202994 · last synced … · 2 added, 0 updated, 3 unchanged` and `Live U7654321 · last synced … · 1 added, 0 updated, 0 unchanged`. The title reads `IBKR sync`.
  - IbkrCard, `"shows one account's error beside the other's counts"`: the live summary is an error. Its line reads `Live · IBKR rejected the token…` with the `text-down` class, and paper's counts still show.
  - IbkrCard, `"says a configured account hasn't synced yet"`: live has `lastSummary: null` → `Live · Not synced yet.`
  - IbkrCard, `"after Sync now, shows the report's summaries"`: the mutation's report replaces the status summaries per book.
  - SyncedBanner, in `TradeDetail.test.tsx`: `"finds kept edits in the live account's summary"`. The kept trade is listed only under `accounts[1].lastSummary.keptEdits`, and the banner shows IBKR's net.
  - Update every `/api/ibkr/status` and `/api/ibkr/sync` fixture to the new shapes.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/routes/IbkrCard.test.tsx apps/web/src/routes/TradeDetail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Extract the existing block into `AccountBlock({ book, summary })`.
  - The line: the success text as today; `${Label} · ${error message}`; or `${Label} · Not synced yet.`, where Label is `Paper` / `Live`.
  - The card maps over `status.data.accounts`, taking each book's summary from `sync.data?.accounts` first.
  - SyncedBanner searches `status.data?.accounts.flatMap(a => a.lastSummary?.keptEdits ?? [])`.
  - `useAfterSync` takes `Pick<SyncReport, "changedTradeIds">`.
- [ ] **Step 4: Run** the web tests, then lint, typecheck and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the IBKR card shows each account's sync`.

### Task 6: Web — a Settings panel per book

**Files:**
- Modify: `apps/web/src/routes/IbkrSettings.tsx` and `apps/web/src/routes/Settings.tsx`
- Test: `apps/web/src/routes/IbkrSettings.test.tsx` (and Settings' own test, if it reads the IBKR view)

**Interfaces:**
- Consumes: Task 4's routes.
- Produces: `IbkrSettings({ book, ibkr, confirm }: { book: IbkrBook; ibkr: IbkrView; confirm })`. Each panel is a `<section aria-label="IBKR Flex · {book}">` around the `Panel`, so the same field labels stay unique within it.

- [ ] **Step 1: Write the failing tests:**
  - `"saves the live panel to the live route"`: render with `book="live"`, fill in the fields, Save. The fetch goes to `/api/settings/ibkr/live` with the typed body. The panel title is `IBKR Flex · live`, and it shows the line `Make the same two Flex queries (Activity, Today) while logged in to the live account; its token is in that account's Settings.`
  - `"removing live asks about the live account"`: the confirm text is `Remove the IBKR live token and queries from this machine?`, then a DELETE to `/api/settings/ibkr/live`.
  - Settings page, `"shows a panel for each book, keeping paper's fields when live saves"`: both regions render. Saving live leaves the paper panel's query ID inputs at their values.
  - Update the existing tests to `book="paper"` and the `/paper` route.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/src/routes/IbkrSettings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The unconfigured status for live: `Not set up: the live account's trades won't sync`. Paper keeps today's.
  - In `Settings.tsx`, render `paper` then `live`, each keyed by its own saved view.
- [ ] **Step 4: Run** the web tests, then lint, typecheck and the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): an IBKR Flex panel for the live account`.

### Task 7: Docs and a check on the demo

**Files:**
- Modify:
  - `README.md` (the IBKR lines);
  - `docs/superpowers/specs/2026-09-29-ibkr-flex-sync-design.md` (a pointer in §1 "Out of scope" and §5.2 / §5.6 / §8.2–8.4 / §9.2 / §9.4, to the live spec);
  - `docs/superpowers/specs/2026-10-20-ibkr-live-sync-design.md` (§10, the plan's deviations).

- [ ] **Step 1: Make the doc edits.** The README says the sync covers paper and live.
- [ ] **Step 2: Visual check** with `pnpm demo`: the Settings page at 1280 px shows both panels, and the Import card shows "Not set up…". Headless Firefox, per the recipe in memory.
- [ ] **Step 3: Run** lint, typecheck and the suite; push; open the PR. **Ask the user before merging.**
