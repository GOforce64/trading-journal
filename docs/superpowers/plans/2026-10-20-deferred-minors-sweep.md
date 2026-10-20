# Deferred minors sweep (autopilot, 20 Oct 2026)

The user (20 Oct 2026): "do all the deferred minors on your own … fix up all of them on autopilot", scope **the whole backlog**. The terms are the earlier autopilot runs' (see the autopilot memory):
- each item is fixed test-first, or ruled "won't fix" with the reason written here;
- one branch and PR per group, each with a final Opus review;
- a PR is merged once CI is green on Ubuntu and Windows.

Hand off at about 70% context: keep `next-session` current, push, then `/pickup`.

Mark each item `[x]` with its commit, or `[-] won't fix: why`.

## PR 1 — sync: live-sync review, swings, IBKR sync (branch `fix/minors-sync`)

### Live-sync review (20 Oct)
- [x] `packages/db/src/schema.ts` sync_state.source comment: `'ibkr' | 'ibkr_live'`
- [x] settings test "refuses an unknown book": assert 400 for PUT and DELETE
- [x] a test for a book whose run rejects unexpectedly (client() throws for live → live error summary, paper ok)
- [x] `IbkrCard.tsx` account label: use `LABEL[summary.account.kind]`
- [x] parent sync spec: a pointer at §5.2, §5.6, §8.1–8.4, §9.2, §9.4 to the live spec
- [x] the card's Skipped list: collapse past 5 lines into "… and N more"

### Swings (PR #23 review)
- [x] (already showed it; now pinned by a test) a failed switch from the "Held overnight" hint shows no message
- [x] PATCH {strategy} can contradict chosen_strategy: a changed strategy becomes the choice (none off a single bought option); a re-save with the same strategy leaves it
- [x] an older app's bundle row can do the same (merge): the local choice stands and the strategy follows it
- [x] (tests added: ReviewPanel swing setups; SwingTiles open spread + single; repo switch refused on a fly, missed.test on a missed trade; risk.test leaves swings alone) unwritten spec §9 tests: setup picker filter on a swing; open swing tiles; switch refused on fly/missed; R filler skips swings
- [x] (repo test added; it held) no repo test for focus #2 (re-save keeps facts_edited_at null)
- [x] (one `daysHeldOf` in swing.ts, used by both stats) days held computed twice
- [x] (`premiumPaid` in cents, scalps too) the header return uses the unrounded debit

### IBKR sync (PR #7 review). Check each still applies first.
- [x] (already fixed: the auto skip answers `changedTradeIds: []`, sync.ts runBook) `ran:false` repeats changedTradeIds, so each page load within 15 min re-asks the move fill
- [x] (already fixed: `sameFacts(…, toTheMinute)`, repositories/ibkr.ts) `sameFacts` compares times to the second, giving false "kept your edits" after a form save
- [x] (already fixed: linkFills links a canceled fill to its correction's trade; repo test) canceled fills are never linked, so the Fills "canceled" label never shows
- [x] (already fixed: "Asking IBKR…", the price fill after, the outcome line; TradeDetail tests) "Use IBKR's numbers" has no spinner and no move fill, and hides the banner even on error
- [x] (already fixed: test "shows fill and leg prices to their last digit, as 1.295") the Legs/Fills tables use toFixed(2), so 1.295 shows as 1.29
- [x] (already fixed: `row.tradePrice ?? row.price`, parse.ts) `cancelOf` reads tradePrice, but TCF rows use price, so same-day cancels count as malformed
- [x] (already fixed: `splitCrossings`, group.ts) a position crossing zero never goes flat
- [x] (already fixed: one `SYNC_PATIENCE_MS` deadline for both statements) the Flex patience is per phase (~4 min)
- [x] (already fixed: index.ts reads only the "alpaca" entry; config test) an invalid ibkr block in secrets.json turns off Alpaca at startup
- [x] (already fixed: EditTrade fills moves only for an iron fly) scalp saves run the move fill
- [x] (already fixed: `groupSkipped` + its test) IbkrCard skipped-list React keys can collide
- [x] (already fixed: EditTrade.synced.test "re-saves every synced trade unchanged") no end-to-end form re-save test
- [x] (already fixed: TradeDetail test "shows a scalp's return on cost in the header, and keeps its contract on one line") the scalp header % shows "—", and the Contract tile wraps

## PR 2 — launcher, keys and missed (branch `fix/minors-launcher-missed`)

PR 1 merged as #26 (d046606).

### Launcher (launcher spec §14)
- [x] the lock: an unreadable lock counts as stale
- [x] the lock: the takeover is unlink, then create
- [x] the lock: a live launcher's lock ages out after 60 s during a long `pnpm install`
- [ ] shutdown isn't idempotent (a second Stop during the drain exits mid-sync), and has no time limit
- [ ] Edit → Save reopens the trade without its list, so J/K stop following it
- [x] closing the palette with Ctrl+K keeps the typed query (Esc and a click outside clear it)
- [x] `parseDayMonthYear("09/12/0026")` gives "26-12-09" (the year isn't padded to four digits)
- [x] the date guard catches `new Date(…).toLocaleString(` but not `someDate.toLocaleString(`
- [ ] the `.desktop` records the versioned `/usr/bin/node-22`
- [ ] clicking a button that already had keyboard focus doesn't mark it mouse-focused
- [ ] (pre-existing) MissedWorkspace's "keeps a refused new exit's typed time and price" flakes under suite load

### Missed (missed spec §14, "Still deferred")
- [ ] the hold-range fill can be asked before a first exit's save lands
- [ ] `testTmp.test.ts` passes only under the root config
- [ ] `/missed/new`'s "Place it on …" note isn't cleared by a later click whose create fails
- [ ] the month order leans on Intl's English month names

## PR 3 — screenshots and demo (branch `fix/minors-screens-demo`)

### Screenshots (screenshots spec §8)
- [ ] the caption input has no maxLength (past 500 characters: "Saving the caption failed: 400")
- [ ] a soft-deleted trade's live screenshot rows still put their files in every bundle
- [ ] a bundle's attachment rows aren't checked: a crafted sha256 could point a thumbnail at another /api path
- [ ] Windows: a rename right after a write can fail under antivirus (the upload answers 500)
- [ ] served files lack `X-Content-Type-Options: nosniff`
- [ ] thumbnails are cropped to 160×96 (object-cover), though §5 says their aspect is kept
- [ ] a thumbnail dragged within the page may drop back as a duplicate (`draggable={false}`)
- [ ] test gaps: a 404 upload asserting no row; caption and remove in the property test; `tj-shots-*` temp dirs left behind
- [ ] the lightbox has no focus trap, and its zoom is mouse-only

### Demo (demo spec §9)
- [ ] penny contracts: SPY gets $2.50 strikes (it lists $1), so about 1 scalp in 7 opens at $0.05 or less; one premium plan's stop equals its entry
- [ ] the guard checks equality only (a real data dir nested in a marked demo dir would be wiped)
- [ ] an empty `TJ_DEMO_DIR` fails with "ENOENT mkdir ''"; a relative one resolves against apps/server
- [ ] an `--end` before mid-2024 gives option charts that read "too old"
- [ ] option bars: each bar's open isn't the previous bar's close (cosmetic)

## Final reviews

- **PR 1** (Opus, 6568b75..d3b0bbe): 0 Critical, 0 Important, 6 minors in the sweep's own changes, all fixed test-first:
  - a strategy change recorded as the choice no longer marks the facts edited;
  - the bundle rule applies only to legs a choice can apply to;
  - a test that a newer row's own null choice stands;
  - the hidden skipped count sums trades, not grouped lines;
  - an orphaned comment;
  - one `round2` for cents.
  - The flaky MissedWorkspace test failed once under the full suite and passed alone; it is PR 2's item.
