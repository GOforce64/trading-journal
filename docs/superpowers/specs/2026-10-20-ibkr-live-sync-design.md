# IBKR live-account sync — design

**Date:** 20 Oct 2026. **Status:** the user chose this feature and skipped the questions ("skip the questions, just build it"), so every decision below is **my call**, made to fit the existing sync. The parent is the IBKR Flex sync spec (`2026-09-29-ibkr-flex-sync-design.md`, "the sync spec"). Its §1 already planned for this: "The design stores which account each trade belongs to, so live is a second set of credentials later."

## 1. Purpose

The user trades swings on their **live** IBKR account, but only the paper account syncs. This adds a second set of Flex credentials, for the live account, so the live account's trades come in the same way: the same grouping, the same guards, and the same "your edits win" rule.

**Success:** with both accounts set up in Settings, one Sync (or opening the app) brings in the trades of both. Live trades have book `live` and the account "IBKR live", so they get the LIVE chip and the Live filters that already exist in the Journal and Analytics. Paper syncs exactly as before.

### Out of scope
- More than one live or paper account.
- A per-account Sync button. One button syncs every account that's set up.
- Changes to grouping, the swing rules, or the trade page.

## 2. What already handles accounts (no change)

- **Fills, grouping, orphans and links** are all per account (`fills.account_id`, `softDeleteOrphans(accountId)`, `linkFills(accountId)`).
- **Ids** include the account's external id (`ibkr:{accountExternalId}:{key}`), so the two accounts' trades can't collide.
- **The account and the book come from the statement:** `DU…` means paper, anything else live. `ensureAccount` names them "IBKR paper" and "IBKR live".
- **Lists:** trades carry `book`; the Journal has Live / Paper / Missed filters and chips, and Analytics has book toggles.
- **The swing rules** (swing spec §3) apply as they do on paper. A bought call or put syncs as a scalp until the user switches it. A debit vertical becomes a swing on its own.

## 3. Credentials

- **`secrets.json` gains an `ibkrLive` entry** beside `ibkr`, with the same shape: `{ token, activityQueryId, todayQueryId, since }`.
- **`ibkr` stays the paper entry**, unchanged. So no file is rewritten, and the other machine keeps working.
- Each account has its own **start date**. The live one can reach back to older swings, limited by its Activity query's period.

## 4. The sync

- **`sync({ auto })` runs every configured account**, the two **in parallel**. They use different tokens, so IBKR's per-token limits aren't shared. Each account:
  - gets its own patience (`SYNC_PATIENCE_MS`);
  - writes in its own transaction;
  - records its own `sync_state` row;
  - follows its own 15-minute auto rule.
- **The wrong account in a slot:** if the queries saved as live return a `DU…` account, or the paper ones a live account, that account's run fails and stores nothing. The message: "These queries belong to the paper account DU1234567: use the live account's own queries." (or the other way round).
- **`sync_state` keys:** paper keeps the source `"ibkr"`, so its last run survives without a migration. Live is `"ibkr_live"`.
- **The answer** becomes a report:

  ```ts
  {
    ran: boolean;               // any account ran
    changedTradeIds: string[];  // every account's, for the move-data and price fill
    accounts: SyncSummary[];    // one per configured account, paper first; [] when none is set up
  }
  ```

  Each `SyncSummary` gains `book: "paper" | "live"`: the slot it ran for. Its `account` field still says what the statement held. `status: "not_configured"` goes, because an account that isn't set up is simply absent.
- **`GET /api/ibkr/status`** answers `{ configured, accounts: [{ book, since, lastRunAt, lastStatus, lastError, lastSummary }] }`, listing the configured accounts, paper first. `configured` is true when any account is set up.
- **"Use IBKR's numbers"** (`POST /api/ibkr/trades/:id/reset`) clears the mark, then syncs every account, and answers the report.

## 5. The duplicate guard compares the book

The guard that skips a synced trade "already in the journal" (sync spec §8.1) now also needs the same **book**. A live trade is a duplicate only of a typed or imported **live** trade, and a paper trade only of a **paper** one. Without this, a paper scalp typed by hand would hide a live trade on the same contract the same day. The oQuants reverse guard (`syncedFrom`) gets the same rule.

**Safe for existing data:** checked read-only on the real journal (20 Oct, Fedora). It holds 35 synced paper scalps and 42 oQuants flies, all `book = paper`, and nothing typed by hand. So no paper candidate's answer changes.

## 6. Settings

- **`GET /api/settings`** answers `ibkr: { paper: IbkrView, live: IbkrView }`, each in the existing view's shape: `configured`, `tokenHint`, the query IDs, `since`.
- **`PUT` and `DELETE /api/settings/ibkr/:book`**, where `book` is `paper | live`. They keep today's validation, query checks and refusals. Each writes only its own entry.
- **The page shows two panels:** "IBKR Flex · paper" and "IBKR Flex · live". Each has the same form as today, and each is keyed by what's saved.
- **The live panel adds one line:** "Make the same two Flex queries (Activity, Today) while logged in to the live account; its token is in that account's Settings."

## 7. Import / Sync card

- The title becomes **"IBKR sync"**.
- **One block per configured account**, paper first. Each has the existing status line ("Paper DUR202994 · last synced … · 2 added, 1 updated, 3 unchanged", or its error) and the existing details: skipped, kept edits, ignored rows, Activity failed.
- **An account that isn't set up** gets no block. With neither set up, the card says "Not set up. Add your Flex token and query IDs in Settings."
- **One Sync now button** for all accounts.
- **The synced-trade banner** looks for the trade's kept edits in every account's last summary.

## 8. Testing

- **Config:** `ibkrLive` is read and written on its own, and a broken one doesn't switch off `ibkr` or Alpaca.
- **Sync:**
  - both accounts sync, each with its own book, account and summary;
  - one account's failure leaves the other's applied and reported;
  - a slot holding the other kind's queries is refused and nothing is stored;
  - the 15-minute rule applies per account;
  - only live configured works;
  - none configured gives `accounts: []`;
  - the paper `sync_state` row from before is still read.
- **Duplicate guard:** a typed paper scalp doesn't hide a live synced one; a typed live one does.
- **Settings routes and panels:** each book saves and removes its own entry.
- **The card** shows a block per account; **the banner** finds kept edits in the live summary.

## 9. Live check (for the user, on a machine with the live token)

1. In the **live** account's Client Portal, make the two Flex queries (Activity for the last 365 days, and Trade Confirmation for today) and get its Flex token.
2. Save them in Settings → IBKR Flex · live, with a start date.
3. Sync. The live swings come in with the LIVE chip, and paper is unchanged.
4. Sync again: everything unchanged.

**Done 21 Oct 2026:** the user made the live account's two queries and token, saved them in Settings → IBKR Flex · live, and synced: "all pops up good".

## 10. Plan deviations

1. **A run that throws unexpectedly** becomes that account's error summary. One account's failure never sinks the other's report.
2. **Every error line on the card names its account,** paper's too: "Paper · …", "Live · …". The same goes for "Not synced yet.".
3. **"Use IBKR's numbers" judges only the trade's own account,** found by the trade's book. While the live account is failing, a paper trade's hand-back says nothing about a failure. When the trade's account isn't set up any more, it says the sync didn't run. (The final review caught an earlier version that reported any account's failure.)
4. **Each Settings panel's remount key includes the Today query ID** as well. Before, a save that changed only that ID left the form showing the old one.
5. **The paper panel's Remove confirm names the account:** "Remove the IBKR paper token and queries from this machine?"
6. **Tests:**
   - the server tests gained `testDb()` and an optional `db` for `testApp`, so a test can write an old-style `sync_state` row;
   - the web tests' status and sync fixtures moved to the new shapes in the sync task, not the card task, so the suite stayed green between tasks.
