# Scalp Review — Design Spec

- **Date:** 2026-09-29
- **Status:** Approved by the user on 2026-09-29. Plan: [2026-09-29-scalp-review.md](../plans/2026-09-29-scalp-review.md).
- **Scope:** reviewing scalps on their trade page. A scalp gets a **stop** and a **target**, drawn as lines you drag on the intraday chart, plus a **setup**, **mistake** and **emotion** tags, a **grade** and notes. A **To review** queue holds the scalps not yet reviewed. The **Playbook** page manages setups and tags.
- **Parent spec:** [2026-09-22-trading-journal-design.md](2026-09-22-trading-journal-design.md), §6, §8.3 and §9. This is the review half of Phase 2, step 3 (§13); R, the risk engine and MAE/MFE are the other half and come next.
- **Builds on:** the trade chart ([2026-09-29-trade-chart-design.md](2026-09-29-trade-chart-design.md)), whose `IntradayChart` takes extra price lines, and the IBKR sync ([2026-09-29-ibkr-flex-sync-design.md](2026-09-29-ibkr-flex-sync-design.md)), which fills the queue.

---

## 1. Purpose and success criteria

After a session the user reviews each scalp on the chart they traded from: where the stop and target were, which setup it was, how well it was executed, and what went wrong. The stop is what R will be measured against in the next step, so it has to be recorded while the trade is fresh.

**Success:**
- After a sync brings in five scalps, the nav reads **Scalps 5** and the Dashboard lists them under **To review**.
- **Start reviewing →** opens the oldest. On its page, below the charts, the user:
  - presses **+ Stop**, clicks the chart just under the entry candle, and drags the red dashed line to 231.80;
  - picks the setup, a grade, a mistake and an emotion.

  The queue bar turns to **Reviewed ✓ · 4 left**, and **Next →** opens the next scalp.
- A scalp whose stop the user can't remember leaves the queue with **Done reviewing**, and comes back with **Back to queue**.
- The placeholder setups are renamed or archived on the Playbook page, and the user's own setups and tags are added there or straight from the pickers.

### Out of scope
- **R, planned risk, MAE/MFE, the underlying's entry price, IV and greeks.** They are the next step, which reads the stop and target stored here (§15).
- **Drawing premium levels.** There's no option chart yet, so a premium stop or target is a number only.
- **Per-setup stats** on the Playbook page. They come with R.
- **Colours** for setups and tags (parent spec §6 lists them; not built).
- **Keyboard review** (J/K, 1–5 for the grade): parent spec Phase 3, item 4.
- **Missed trades** and their chart marking: Phase 2, item 5.

---

## 2. Decisions

| Question | Decision |
|---|---|
| What the stop and target are measured on | "For now they are all on the stock price, but in the future I might switch to the options premium chart, so I want functionality for both." Each trade has one **basis**, stock or premium, for both its stop and its target. |
| The basis default | A Settings choice, **stock** to start. Switching it later changes where new reviews start; trades already reviewed keep theirs. |
| Leaving the queue | A scalp leaves **To review** once it has a **setup, a grade and a stop**, or when the user clicks **Done reviewing** (for when the stop isn't known). Mistakes, emotion and notes stay optional. |
| Where the review happens | On the trade page, with the chart: "that's the visuals I'm reviewing on". |
| Setting the stop and target | **Draggable lines, as in TradingView**, with a typed field for each. |
| Layout | A **review strip directly under the charts**, full width (layout A of the mockups). The daily chart stays beside the intraday chart and gets no review lines: "I want less info on the daily chart anyways". |
| Moving through the queue | A list (nav badge, a Scalps tab, a Dashboard section), and **Next →** on the trade page. Nothing jumps on its own. |
| Setups and tags | Managed on the **Playbook** page (no stats yet), and created inline from the pickers. |
| Storage | A 1:1 `scalp_details` table for the levels (the table parent spec §6 planned), and `reviewed_at` on `trades`. The review status is derived on read. |

---

## 3. Facts this design relies on

- **Already built:**
  - `trades` has `setup_id`, `grade` and `notes`, and `trade_tags` links tags to trades. `PATCH /api/trades/:id` already accepts `setupId`, `tagIds` (replacing the set) and `grade`.
  - `setups` and `tags` exist, with list and create endpoints and seeded placeholders: the setups ORB breakout, VWAP reclaim and Earnings IV crush; the mistakes Moved stop, FOMO entry, Oversized and Exited early; the emotions Calm, Rushed and Revenge. `tags` has a unique index on (kind, name); `setups` has none.
  - The trade page's Review panel has the grade buttons, **Exclude from stats** and notes. Nothing in the web uses setups or tags; Playbook is a placeholder.
  - Journal, Scalps and Iron Flies share one trades grid (`Journal`).
  - `IntradayChart` takes `lines?: PriceLine[]` (`{ price, color, dashed, label }`) and draws them with `createPriceLine`.
  - The IBKR sync writes only a trade's broker facts (`facts(...)` in the ibkr repository). Trade ids are deterministic, so a trade keeps its id when later fills join it.
  - Chart preferences are stored in the browser (`tj.chart` in localStorage), per machine.
- **Lightweight Charts v5** has no draggable price line (v3 had one; v4 removed it). It has what a drag needs:
  - `series.priceToCoordinate(price)` and `series.coordinateToPrice(y)`;
  - `IPriceLine.applyOptions({ price })` to move a line;
  - `chart.applyOptions({ handleScroll, handleScale })` to switch the chart's own panning and axis scaling off during a drag;
  - `chart.subscribeClick` for placing.
- **The real journal has no scalps yet:** the sync's start date is 2026-09-29. The live check adds the Sep 28 NVDA 232.5C scalp to a copy, as the trade chart's did.

---

## 4. Architecture

| Package | New or changed |
|---|---|
| `core` | `reviewStatus(trade)` and its `missing` list; the patch schema's `scalp` and `reviewed` fields; `LEVEL_BASES`. |
| `db` | Migration 0005; `scalp_details` in the schema; the trades repository hydrates and merges it and stamps `reviewed_at`; the emotion rule; the taxonomy repository gains update, archive, trade counts and duplicate checks. |
| `server` | `?review=pending` on the trade list; `review` on every trade; `PATCH /api/setups/:id` and `PATCH /api/tags/:id`; `?includeArchived=true` on both lists. |
| `web` | `chart/drag.ts` (pure); `IntradayChart` editing; the `ReviewStrip`, `QueueBar` and pickers; the Scalps tabs; the nav badge; the Dashboard section; the Playbook page; the Settings choice. |

The review status lives in `core` so the server's filter and the web's labels can't disagree. The drag's arithmetic lives in a pure module so it's tested without a canvas.

---

## 5. Data model (migration 0005)

- **`scalp_details`**, one row per scalp, created the first time a level or the basis is written:

  | Column | Type | Notes |
  |---|---|---|
  | `trade_id` | TEXT, primary key, → `trades.id` | |
  | `level_basis` | TEXT, not null | `stock` \| `premium` |
  | `stop_price` | REAL, nullable | A stock price, or an option price per share. |
  | `target_price` | REAL, nullable | The same. |

  No sync columns, like `iron_fly_details`: a merge follows the trade's `edited_at` (parent spec §12). The R step adds its columns to this table (§15).
- **`trades.reviewed_at`**: INTEGER, nullable. When the user clicked **Done reviewing**; null otherwise.
- Nothing is backfilled: the table starts empty and every `reviewed_at` is null.

---

## 6. Review status and the API

### 6.1 `reviewStatus` (in `core`)

`reviewStatus(trade)` returns `null` or `{ status: "pending" | "done", missing: ("setup" | "grade" | "stop")[] }`:

- **`null` (doesn't apply):** the trade isn't a scalp, is in the `missed` book, is still open (`closedAt` is null), or is excluded.
- **`done`:** `reviewedAt` is set, or the setup, grade and stop are all set. The stop counts on either basis.
- **`pending`:** anything else. `missing` lists what's absent, in the order setup, grade, stop.

`missing` is filled in for `done` too, so a trade marked done by hand can still say it has no stop. Clearing a grade later puts a scalp back in the queue.

### 6.2 Trades

- **Every trade** the API returns carries `review` (the value above) and `scalp` (`{ levelBasis, stopPrice, targetPrice }`, or null without a row).
- **`GET /api/trades?review=pending`** returns the pending trades only, **oldest first** (by `openedAt`), with no 500-row limit. The queue, the nav badge and the Dashboard section all read `?strategy=scalp&review=pending`, so one query key serves them and one invalidation updates them.
- **`PATCH /api/trades/:id`** gains two fields:
  - `scalp: { levelBasis?, stopPrice?, targetPrice? }` merges into the row, the way `ironFly` does. A missing row is created; `levelBasis` is then required, and the web always sends it. A stock price must be above 0; a premium can be 0, meaning "let it ride to zero"; both are rounded to $0.01. Only a scalp takes `scalp` (400 otherwise).
  - `reviewed: true` stamps `reviewed_at` with the server's clock; `false` clears it.
- **Changing the basis clears both levels** on the server, unless the same patch sets them, since they're then in the new basis. A stock level means nothing as a premium. The web never sends both.
- **At most one emotion tag:** a `tagIds` holding two tags of kind `emotion` is refused (400, "A trade has at most one emotion").
- **Ownership:** the levels, the basis, `reviewed_at`, the setup, the tags, the grade and the notes belong to the user. Changing any of them stamps `edited_at`, never `facts_edited_at`, and the sync never writes them.

### 6.3 Setups and tags

- `GET /api/setups` and `GET /api/tags` return active items; `?includeArchived=true` returns all. Each item carries `tradeCount`, the number of live (not soft-deleted) trades using it.
- `PATCH /api/setups/:id` takes `name`, `description`, `strategy` (`scalp`, `iron_fly` or null for both) and `archived`. `PATCH /api/tags/:id` takes `name` and `archived`; a tag's kind never changes.
- **Names are unique:** a setup's among all setups, a tag's within its kind, ignoring case and archived or not. A duplicate is refused (409, "A setup with that name exists" / "A mistake tag with that name exists"). Create and rename both check.
- Nothing is hard-deleted. Archiving hides an item from the pickers and leaves it on the trades that have it.

---

## 7. The trade page

### 7.1 Layout

For a **scalp**, top to bottom:
1. the header (unchanged);
2. the synced banner (unchanged);
3. the **queue bar** (§7.2);
4. the charts (unchanged, the daily beside the intraday);
5. the **review strip** (§7.3), full width;
6. the scalp tiles;
7. **Legs**, now full width;
8. **Fills**.

For an **iron fly** the page is as today, with the Review panel beside Legs, but that panel is now the same component without the Levels column, the queue bar or **Done reviewing**. Flies are reviewed by the numbers, so their tiles stay near the top.

### 7.2 The queue bar

Scalps only, and only while there's something to say:

| This scalp | Others pending | The bar reads |
|---|---|---|
| pending | any | **TO REVIEW** · 2 of 5 · needs a setup and a stop · **← Prev** · **Next →** |
| done | yes | **REVIEWED ✓** · 3 left · **Next →** |
| not applicable (open, excluded) | yes | 3 to review · **Next →** |
| done or not applicable | none | no bar |

- "2 of 5" is this scalp's place in the pending list, oldest first.
- **Next →** opens the first pending scalp opened after this one, wrapping to the oldest. **← Prev** is the reverse. With only this scalp pending, both are hidden.
- The list is refetched after every save, so a scalp deleted or reviewed in another tab is never a **Next** target.

### 7.3 The review strip

One panel, "Review", in three columns (they stack below about 900 px):

- **Levels** (scalps only):
  - **Levels on:** Stock | Premium;
  - **Stop**: the price field with ✕ to clear, or **+ Stop** when there's none;
  - **Target**: the same.
- **Setup, grade, emotion:**
  - **Setup:** a dropdown (§9.1);
  - **Grade:** A B C D F, clicking the current grade clears it;
  - **Emotion:** chips (§9.1).
- **Mistakes and notes:**
  - **Mistakes:** chips (§9.1);
  - **Notes:** the textarea, saved when it loses focus.

Along the bottom: **Exclude from stats** on the left; **Done reviewing** on the right, which reads **Back to queue** once `reviewed_at` is set. Done reviewing shows only on scalps that aren't excluded, open or missed.

**Every change saves at once**, as the grade does today; there's no Save button. A failed save puts the value back and shows "Couldn't save: …" in the strip (§12).

---

## 8. Stop and target lines

### 8.1 Drawing

- **Stock basis only**, on the **intraday chart only**:
  - stop: red (`#ef5350`), dashed, labelled **STOP**;
  - target: green (`#26a69a`), dashed, labelled **TARGET**;
  - both show their price on the price axis.
- **Premium basis:** no lines. Under the fields: "Premium levels aren't drawn yet: there's no option chart."
- Without a chart (no key, an index, Alpaca down), the fields still work.

### 8.2 Placing

- **+ Stop** (or **+ Target**) opens the typed field and puts the intraday chart in placing mode, so you click the chart or type:
  - the cursor becomes a crosshair;
  - a hint over the chart reads "Click the chart to place the stop · Esc to cancel".
- The click's price (`coordinateToPrice`, rounded to $0.01) is saved, and placing mode ends. **Esc** cancels.
- A click that lands outside the price pane (on an axis, or off the data) is ignored and placing continues.

### 8.3 Dragging

- Within **6 px** of a line, the cursor turns to ↕ (`ns-resize`).
- **Press** starts the drag and switches the chart's panning and axis scaling off (`handleScroll.pressedMouseMove`, `handleScale.axisPressedMouseMove`).
- **Moving:**
  - the line follows the pointer;
  - the typed field shows the price as it goes;
  - nothing is saved yet.
- **Release** saves once, and turns panning and scaling back on.
- **Nearest wins:** if both lines are within 6 px, the drag takes the closer one.
- A press away from the lines pans the chart as before.
- **The drag follows the mouse across the window**, so it keeps going if the pointer leaves the chart. **Esc** during a drag puts the line back.
- Lightweight Charts listens to mouse events, not pointer events, so the drag does too. It starts on a capture-phase `mousedown` on the chart's container, stopped there so the chart doesn't pan, then follows `mousemove` and `mouseup` on `window`.

### 8.4 Typing

- Each field saves on **Enter** or when it loses focus, rounded to $0.01.
- **Esc** restores the saved value.
- **✕** clears the level.
- Anything but digits and a decimal point (a `$`, a comma, a minus sign), or 0 on the stock basis, is refused inline, with nothing sent. An emptied field goes back to the saved value.

### 8.5 Switching the basis

- With a stop or target set, switching asks first: "Switching to premium clears the stop and target." On OK, the patch carries the new basis and the server clears both levels (§6.2).
- With neither set, it switches at once.
- A trade with no `scalp_details` row shows the Settings default (§11). The first write sends it.

### 8.6 The code

- **`chart/drag.ts`** holds the pure pieces:
  - `nearestLine(lines, y, toY)`: the id of the line within 6 px of `y`, or null;
  - `priceAt(y, toPrice)`: the price at `y`, rounded to $0.01.
- **`IntradayChart`** gains optional props, used only by scalps:
  - `editing: { placing: "stop" | "target" | null, onPlace(kind, price), onDrag(kind, price), onDrop(kind, price), onCancel() }`: `onDrag` reports a line while it moves, unsaved, and `onDrop` saves it;
  - an `id` on each `PriceLine` (`"stop"`, `"target"`), so a drag knows which line it moved.

  Without `editing` the chart behaves exactly as today.
- **`chart/testing.ts`**, the fake Lightweight Charts, learns a linear price↔y mapping and click subscriptions, so a component test can place and drag a line.

---

## 9. The queue's surfaces and the pickers

### 9.1 Pickers

- **Setup:** a dropdown of the active setups whose strategy is this trade's or both, sorted by name. It also offers **None** and **+ New setup…**, which opens an inline name field. The new setup gets this trade's strategy and is selected at once.
- **Mistakes:** toggle chips, any number on.
- **Emotion:** toggle chips, one on at most. Clicking another switches to it, and clicking the active one clears it.
- Each tag row ends in **+**, which opens an inline name field, creates a tag of that kind, and applies it.
- **An archived setup or tag** already on this trade stays shown, dimmed and marked "archived", and can be removed. It can't be picked again.

### 9.2 Nav badge

The Scalps nav item shows the pending count, "Scalps 5", while it's above zero.

### 9.3 The Scalps page

- Tabs: **All** and **To review (5)**. To review is the same grid over the pending list, oldest first.
- The trades grid (Journal, Scalps, Iron Flies) gains a **Setup** column.
- Pending scalps get a small blue dot in the grid.

### 9.4 The Dashboard

- A **To review** section, above Open and Recent, lists up to 5 of the oldest pending scalps. Each row shows the time, the contract, the net P&L and what's missing, e.g. "stop, setup".
- The section title says how many there are in all.
- **Start reviewing →** opens the first.
- The section is hidden when the queue is empty.

---

## 10. The Playbook page

`/playbook` replaces the placeholder with two panels.

**Setups:**
- **The table:** name, strategy (Scalps / Iron flies / Both), description and **trades**, the trade count, so it's clear whether a setup is in use before archiving it.
- **Editing:** **Edit** turns the row into fields. Enter saves and Esc cancels. **Archive** and **Restore** sit at the end of the row.
- **+ New setup** adds a row.
- **Show archived** lists archived setups too, dimmed.

**Tags:**
- Two lists side by side, **Mistakes** and **Emotions**, each with inline rename, archive and **+ New**.
- **Show archived** works as it does for setups.

The seeded placeholders are ordinary rows, renamed or archived like any other. Per-setup stat cards come with R.

---

## 11. Settings

- Settings → Chart gains **"Stop and target levels default to: Stock | Premium"**.
- It's stored in the browser with the chart preferences, per machine. Anything unreadable falls back to stock.
- It only chooses the basis a trade starts on. A trade with a `scalp_details` row keeps its own.

---

## 12. Errors and edge states

| Case | Behaviour |
|---|---|
| A save fails (a drag, a typed price, a chip, the grade) | The value goes back to the saved one and the strip shows "Couldn't save: …" until the next successful save. Nothing is lost silently. |
| A bad price (negative, empty, 0 on stock) | Refused inline. The server refuses it too (400). |
| A second emotion tag (a stale tab, or by hand) | 400, "A trade has at most one emotion". The chips show the saved state. |
| A duplicate setup or tag name | 409, shown beside the field. The field keeps what was typed. |
| No chart for the underlying | The fields work (§8.1). |
| A level outside the chart's visible range | The line is off-screen; the axis label still shows it. Scrolling or **Fit trade** brings it back. |
| Switching the basis with levels set | A confirm (§8.5). Cancel leaves everything as it was. |
| The trade is still open | The strip works, but there's no Done reviewing, and the queue bar offers only Next (§7.2). It enters the queue when it closes. |
| An excluded scalp | Out of the queue. Un-excluding it brings it back if it's incomplete. |
| A synced scalp picks up a later fill | Same trade id, so the review stays (§3). |
| A scalp is deleted while it's next in the queue | The refetched list no longer has it, so **Next** skips it. |

---

## 13. Testing

- **core:** `reviewStatus` across the combinations: each of setup, grade and stop present or absent; `reviewedAt` set; open, excluded, missed, iron fly; the stop on the premium basis; `missing`'s order.
- **db:**
  - migration 0005 on a copy of the previous schema;
  - `scalp_details`: creation needs a basis; a partial patch keeps the other fields; a basis change clears both levels; rounding;
  - `reviewed` stamps and clears `reviewed_at`;
  - the one-emotion rule;
  - setups and tags: update, archive, restore, the case-insensitive duplicate checks, trade counts ignoring deleted trades;
  - an IBKR sync re-run over a reviewed scalp leaves its review, levels and tags untouched.
- **server:**
  - `?review=pending`: the filter, oldest first, no row limit, combined with `strategy`;
  - `review` and `scalp` on every trade;
  - the new patch fields, including `scalp` refused on a fly;
  - the setup and tag PATCH endpoints and `includeArchived`.
- **web:**
  - `drag.ts`: `nearestLine` (none, one, both in range, the closer wins) and `priceAt` rounding;
  - the review strip: the pickers, inline create, the single emotion, grade clearing, **Done reviewing** and **Back to queue**, the basis confirm, the value going back after a failed save;
  - placing and dragging through the chart fake: one save on release, none while moving, Esc cancels;
  - the queue bar: every row of §7.2, and **Next** wrapping around;
  - the Scalps tabs, the grid's Setup column and dot, the nav badge;
  - the Dashboard section, hidden when empty;
  - the Playbook page: create, rename, archive, restore, the 409 message;
  - the Settings choice and its fallback.
- **Live and visual check**, the way the trade chart's was done (a stand-in server over a read-only copy of the journal, headless Firefox driven by puppeteer-core), with the Sep 28 NVDA 232.5C scalp added:
  - in headless Firefox, place the stop, drag it, and confirm the saved price;
  - screenshots at 1280 and 1024 px of the strip under the charts, the queue bar in each state, the Scalps tabs, the Dashboard section and the Playbook page.

---

## 14. Changes to the parent spec

- **§6:** `scalp_details` exists, with `level_basis`, `stop_price` and `target_price`. `stop_level` and `target_level` are named `stop_price` and `target_price`, with a basis. `trades.reviewed_at` is added. Setups and tags have no colour yet.
- **§8.1:** the review queue is built as described here.
- **§8.3:** the stop can be on the premium; §15 says what that changes for R.
- **§9:** tagging is edited from the trade page, not inline in the journal grid. The grid shows the setup. The Playbook page manages setups and tags; its stat cards come with R.
- **§13, Phase 2, item 3:** split in two. The review (this spec) comes first; the risk engine, R, MAE/MFE and time-of-day analytics follow.
- **Chart spec §12:** points here.

---

## 15. For the R step

- R reads the stop from `scalp_details`:
  - **Premium basis:** planned risk is (entry premium − stop premium) × contracts × multiplier, with no model.
  - **Stock basis:** it needs the Black-Scholes reprice of parent spec §8.3.
- A scalp reviewed with **Done reviewing** and no stop has no R. It reads "—", as parent spec §8.3 already does when the risk can't be computed.
- The target gives planned reward and planned R:R the same way.
- The Playbook's per-setup stat cards, and R in the Analytics breakdowns by setup, grade and mistake, come with it.

---

## 16. Open items

1. **An option-premium chart** (chart spec §13, item 1), so premium levels can be drawn and dragged too. Its own spec, after this one and before R. Probed on 2026-09-29 with the user's key:
   - **The free plan serves historical 1-minute option bars** (`/v1beta1/options/bars`). NVDA 232.5C Sep 28: 387 of 390 regular-session minutes, in 1.6 s. The 09:31 bar (0.97–1.53) holds the 1.06 buy, and the 09:46 bar (1.10–1.32) holds the last sell.
   - **Regular hours only:** 09:30–16:00 (SPY to 16:15), so no premarket candles.
   - **Thin strikes are sparse:** the far out-of-the-money 245C had bars in 79 of 390 minutes.
   - **History starts in 2024:** a Mar 2024 SPY contract returns bars, and a Mar 2023 one returns none.
   - **About 70 minutes behind, not 15:** a request ending within roughly the last 65–75 minutes is refused outright (403, "OPRA agreement is not signed"), even for an older contract. The client must end its requests before that.
2. **Bulk review:** if the sync's start date is moved back months, the queue could hold hundreds of old scalps. A "Mark all before a date as reviewed" action can come if that happens.
