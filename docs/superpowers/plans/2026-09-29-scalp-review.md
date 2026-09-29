# Scalp Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scalps are reviewed on their trade page. The stop and target are lines you drag on the intraday chart, next to a setup, mistake and emotion tags, a grade and notes. A **To review** queue holds the scalps not yet reviewed, and a **Playbook** page manages setups and tags.

**Architecture:**
- **`@tj/core` (`review.ts`):** `reviewStatus` decides whether a trade waits in the queue and what it lacks. `LEVEL_BASES` is `stock | premium`. The trade patch schema gains `scalp` (the levels) and `reviewed`.
- **`@tj/db`:**
  - Migration 0005 adds `scalp_details` (the basis, stop and target) and `trades.reviewed_at`.
  - The trades repository merges the levels, stamps "Done reviewing" and allows one emotion per trade.
  - The taxonomy repository gains update, archive, trade counts and unique names.
- **The server:**
  - every trade carries `review` and `scalp`;
  - `GET /api/trades?review=pending` is the queue, oldest first;
  - a refused patch answers 400 with the reason;
  - setups and tags gain `PATCH`, `?includeArchived=true`, and a 409 on a duplicate name.
- **The web:**
  - `chart/drag.ts` holds the pure hit-testing and rounding, and `IntradayChart` handles placing and dragging with the mouse.
  - `review/` holds the data hooks, the default basis, the queue maths, `ReviewPanel` (pickers, grade, notes, Done reviewing), `LevelFields` with `useLevels`, `ScalpWorkspace` and `QueueBar`.
  - Elsewhere: the Scalps nav badge, the Scalps tabs, the grid's Setup column, the Dashboard's To review section, and the Playbook page.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), zod 4, Hono, Drizzle + better-sqlite3, React 19, TanStack Query 5, lightweight-charts 5.2, Tailwind 4, Vitest 5 (jsdom 26 for web), Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-scalp-review-design.md`

**Branch:** `feat/scalp-review`, from `main` (b46a412), with the spec at 6875409 and the option-bar facts at 6ba0093. Work in place; no worktree.

**Deviations from the spec, agreed while planning.** The spec is updated in the same commit as this plan.
1. **§8.3 and §8.6, mouse events rather than pointer events.**
   - Lightweight Charts 5.2 listens only to mouse and touch events, and jsdom 26 has no `PointerEvent`.
   - The drag starts on a capture-phase `mousedown` on the chart's container, stopped there so the chart doesn't pan. It follows `mousemove` on `window` and ends on `mouseup` on `window`, which also keeps a drag going outside the chart.
   - The editing props are `placing`, `onPlace`, `onDrag` (live, unsaved), `onDrop` (save) and `onCancel`.
2. **§8.1, §8.2 and §12, "+ Stop":**
   - **+ Stop** opens the typed field and arms the chart together, so you either click the chart or type.
   - The strip drops the "Lines appear when the chart loads" note: it can't know whether the chart loaded, and typing covers a missing chart.
3. **§6.2, a basis change** clears both levels unless the same patch sets them, since they're then in the new basis. The web never sends both.
4. **§8.4, an emptied field** goes back to the saved value, with no error.
5. **§12, an open or excluded scalp:** the queue bar reads "3 to review · Next →", as §7.2's table says, not "no queue bar".
6. **§10, the Playbook** edits a setup from its **Edit** button, not from a click on the row.

## Global Constraints

**The rules (spec §6)**
- A trade's levels have one **basis**, `stock` or `premium`, stored in `scalp_details.level_basis`.
  - The browser's default is kept in localStorage `tj.review` as `{ "levelBasis": "stock" | "premium" }`. Anything unreadable means `stock`.
  - The web sends the basis with every level write.
- **Prices:**
  - rounded to the cent with `round2` from `@tj/core`;
  - stock above 0, premium 0 or more; a negative price is always refused.
- **Review status:**
  - **`null`:** the trade isn't a scalp, is in the `missed` book, has `closedAt` null, or is excluded.
  - **`done`:** `reviewedAt` is set, or the setup, the grade and the stop are all set.
  - **`pending`:** otherwise.
  - `missing` lists `setup`, `grade` and `stop` in that order, for `done` too.
- **The queue** is ordered by `openedAt`, oldest first, ties by id.
- **The sync never writes** `scalp_details`, `reviewed_at`, the setup, the tags, the grade or the notes. A review edit stamps `edited_at`, never `facts_edited_at`.

**The chart**
- A press within **6 px** of a line grabs it (`GRAB_PX`).
- The stop is `#ef5350` (`COLORS.down`) and the target `#26a69a` (`COLORS.up`), both dashed, labelled `STOP` and `TARGET`. Only the stock basis draws them, and only on the intraday chart.

**UI copy (exact)**
- **Queue bar:**
  - `TO REVIEW`, `2 of 5`, and the needs line, e.g. `needs a stop`, `needs a setup and a stop`, `needs a setup, a grade and a stop`;
  - `← Prev`, `Next →`, `REVIEWED ✓`, `3 left`, `3 to review`.
- **Review strip and panel:**
  - the title `Review`;
  - `Levels on`, `Stock`, `Premium`, `+ Stop`, `+ Target`;
  - the fields `Stop` and `Target`, cleared with `Clear stop` and `Clear target`, and the hint `or click the chart`;
  - `Setup` (a select) with `None` and `+ New setup…`, and the field `New setup name`;
  - `Grade`, `Mistakes`, `Emotion`;
  - the buttons `Add a mistake tag` and `Add an emotion tag`, with the fields `New mistake tag` and `New emotion tag`;
  - the suffix ` (archived)`, `Notes`, `Exclude from stats`, `Done reviewing`, `Back to queue`;
  - `Couldn't save: {message}`.
- **The levels' own messages:**
  - `Premium levels aren't drawn yet: there's no option chart.`
  - `Click the chart to place the stop · Esc to cancel`, and the same for the target.
  - `Switching to premium clears the stop and target.`, or `Switching to stock …` the other way.
  - `Enter a price like 231.80`, and `A stock price must be above 0`.
- **Server messages:**
  - `Only a scalp has a stop and target`
  - `A scalp's first level needs a basis`
  - `A stock price must be above 0`
  - `A trade has at most one emotion`
  - `A setup with that name exists`
  - `A mistake tag with that name exists`
  - `An emotion tag with that name exists`
- **Lists:**
  - the Scalps tabs `All` and `To review (5)`, with the empty text `Nothing to review.`;
  - the grid column `Setup`, and the pending dot, with the hidden text `Waiting for review` and the title `To review`;
  - the Dashboard section `To review · 5` with `Start reviewing →`;
  - the nav badge, labelled `5 to review`.
- **Playbook:**
  - sections `Setups` and `Tags`, with `+ New setup` and `Show archived`;
  - columns `Name`, `Strategy`, `Description`, `Trades`; strategies `Scalps`, `Iron flies`, `Both`;
  - buttons `Edit`, `Archive`, `Restore`, `Save`, `Cancel`;
  - tag lists `Mistakes` and `Emotions`, with `+ New` and `Rename`.
- **Settings:** `Stop and target levels default to`, then `Stock` and `Premium`.

**Types across the RPC boundary (lesson TS2742):** a route's answer spells its unions inline. It never uses an alias from a package the web doesn't depend on. `@tj/core` is fine, since the web depends on it; `@tj/db` is not.

**CI and commits**
- CI runs on Ubuntu and Windows.
- Before every commit, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and check each exit code. Never pipe them through `tail`.
- When `pnpm lint` reports only formatting, run `pnpm format` (twice if needed) and check again.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these is a condition the spec implies but no obvious test covers. The owning task carries a test for each:

1. **A drag released outside the chart,** over the review strip or off the window. It must save once, where released, and give the chart its panning back. Test: Task 6.
2. **Enter in a price field, which then loses focus.** Exactly one save, not two. Test: Task 8.
3. **A price typed as `$231.80`, `231,80` or `-1`.** Refused inline, and nothing is sent. Test: Task 8.
4. **Two chip clicks in quick succession.** The second builds on the first, so no tag is lost while the first save is in flight. Test: Task 7.
5. **A queue list fetched before this trade's own save landed.** The bar goes by the trade's own status: a reviewed trade reads "Reviewed ✓", never "2 of 3". Test: Task 9.

---

### Task 1: The review status and the patch fields in `core`

**Files:**
- Create: `packages/core/src/review.ts`
- Create: `packages/core/src/review.test.ts`
- Modify: `packages/core/src/model.ts`, `packages/core/src/model.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `@tj/core`):

```ts
const LEVEL_BASES: readonly ["stock", "premium"];
type LevelBasis = "stock" | "premium";
type ReviewNeed = "setup" | "grade" | "stop";
interface ReviewStatus { status: "pending" | "done"; missing: ReviewNeed[] }
interface ReviewInput {
  strategy: string; book: string; closedAt: number | null; excluded: boolean;
  reviewedAt: number | null; setupId: string | null; grade: string | null;
  scalp: { stopPrice: number | null } | null;
}
function reviewStatus(trade: ReviewInput): ReviewStatus | null;
// tradePatchSchema gains:
//   scalp?: { levelBasis?: LevelBasis; stopPrice?: number | null; targetPrice?: number | null }  (prices ≥ 0)
//   reviewed?: boolean
```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type ReviewInput, reviewStatus } from "./review.js";

/** A closed scalp with nothing reviewed yet. */
const scalp: ReviewInput = {
  strategy: "scalp",
  book: "paper",
  closedAt: 1_790_603_172_000,
  excluded: false,
  reviewedAt: null,
  setupId: null,
  grade: null,
  scalp: null,
};

describe("reviewStatus", () => {
  it("keeps a closed scalp in the queue, saying what it lacks, in the order setup, grade, stop", () => {
    expect(reviewStatus(scalp)).toEqual({ status: "pending", missing: ["setup", "grade", "stop"] });
    expect(reviewStatus({ ...scalp, grade: "B" })).toEqual({ status: "pending", missing: ["setup", "stop"] });
    expect(reviewStatus({ ...scalp, setupId: "s1", scalp: { stopPrice: null } })).toEqual({
      status: "pending",
      missing: ["grade", "stop"],
    });
  });

  it("lets a scalp out once it has a setup, a grade and a stop, on either basis", () => {
    expect(reviewStatus({ ...scalp, setupId: "s1", grade: "A", scalp: { stopPrice: 231.8 } })).toEqual({
      status: "done",
      missing: [],
    });
    // A premium stop of 0 means "let it ride to zero", and still counts as a stop.
    expect(reviewStatus({ ...scalp, setupId: "s1", grade: "A", scalp: { stopPrice: 0 } })?.status).toBe("done");
  });

  it("lets a scalp out on Done reviewing, still saying what it lacks", () => {
    expect(reviewStatus({ ...scalp, reviewedAt: 5_000, grade: "C" })).toEqual({
      status: "done",
      missing: ["setup", "stop"],
    });
  });

  it("doesn't apply to a fly, a missed trade, an open scalp or an excluded one", () => {
    expect(reviewStatus({ ...scalp, strategy: "iron_fly" })).toBeNull();
    expect(reviewStatus({ ...scalp, book: "missed" })).toBeNull();
    expect(reviewStatus({ ...scalp, closedAt: null })).toBeNull();
    expect(reviewStatus({ ...scalp, excluded: true })).toBeNull();
  });
});
```

Append to `packages/core/src/model.test.ts`:

```ts
describe("tradePatchSchema for the scalp review", () => {
  it("takes part of a scalp's levels, and the Done reviewing flag", () => {
    expect(tradePatchSchema.parse({ scalp: { stopPrice: 231.8 }, reviewed: true })).toEqual({
      scalp: { stopPrice: 231.8 },
      reviewed: true,
    });
    expect(
      tradePatchSchema.parse({ scalp: { levelBasis: "premium", stopPrice: 0, targetPrice: null } }).scalp,
    ).toEqual({ levelBasis: "premium", stopPrice: 0, targetPrice: null });
  });

  it("refuses a negative price and an unknown basis", () => {
    expect(tradePatchSchema.safeParse({ scalp: { stopPrice: -1 } }).success).toBe(false);
    expect(tradePatchSchema.safeParse({ scalp: { levelBasis: "delta" } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core`
Expected: FAIL. There's no `./review.js`, and the patch schema strips `scalp` and `reviewed`.

- [ ] **Step 3: Implement**

Create `packages/core/src/review.ts`:

```ts
/** The scalp review (scalp-review spec §6.1): whether a trade waits in the To review queue, and what it lacks. */

/** What a scalp's stop and target are measured on: the stock's price, or the option's premium. */
export const LEVEL_BASES = ["stock", "premium"] as const;
export type LevelBasis = (typeof LEVEL_BASES)[number];

/** What a scalp needs before it leaves the queue on its own. */
export type ReviewNeed = "setup" | "grade" | "stop";

export interface ReviewStatus {
  status: "pending" | "done";
  /** What's absent, in the order setup, grade, stop. Filled in for a trade marked done by hand too. */
  missing: ReviewNeed[];
}

/** The fields the status reads, as a stored trade has them. */
export interface ReviewInput {
  strategy: string;
  book: string;
  closedAt: number | null;
  excluded: boolean;
  reviewedAt: number | null;
  setupId: string | null;
  grade: string | null;
  scalp: { stopPrice: number | null } | null;
}

/** Null where the queue doesn't apply: not a scalp, a missed trade, still open, or excluded. */
export function reviewStatus(trade: ReviewInput): ReviewStatus | null {
  if (trade.strategy !== "scalp" || trade.book === "missed" || trade.closedAt == null || trade.excluded) {
    return null;
  }
  const missing: ReviewNeed[] = [];
  if (trade.setupId == null) missing.push("setup");
  if (trade.grade == null) missing.push("grade");
  if (trade.scalp?.stopPrice == null) missing.push("stop");
  return { status: trade.reviewedAt != null || missing.length === 0 ? "done" : "pending", missing };
}
```

In `packages/core/src/model.ts`, add after the `zod` import:

```ts
import { LEVEL_BASES } from "./review.js";
```

Replace the `tradePatchSchema` declaration:

```ts
/** Every field optional, no defaults; `source` is provenance and is never patched. */
export const tradePatchSchema = z.object(tradeFields).omit({ source: true }).partial();
```

with:

```ts
/** A scalp's stop and target (scalp-review spec §6.2). Merged into what's stored; the basis rules apply on write. */
export const scalpLevelsPatchSchema = z
  .object({
    levelBasis: z.enum(LEVEL_BASES),
    stopPrice: z.number().min(0).nullable(),
    targetPrice: z.number().min(0).nullable(),
  })
  .partial();

/** Every field optional, no defaults; `source` is provenance and is never patched. */
export const tradePatchSchema = z
  .object(tradeFields)
  .omit({ source: true })
  .partial()
  .extend({
    scalp: scalpLevelsPatchSchema.optional(),
    /** true stamps the trade reviewed with the server's clock; false puts it back in the queue. */
    reviewed: z.boolean().optional(),
  });
```

In `packages/core/src/index.ts`, add `export * from "./review.js";` between `./pricing.js` and `./settle.js`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/core`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/core
git commit -m "feat(core): the scalp review's status, and levels and Done reviewing in a trade patch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stops, targets and Done reviewing in the database (migration 0005)

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create (generated): `packages/db/migrations/0005_scalp_review.sql`, its snapshot, and a `_journal.json` entry
- Modify: `packages/db/src/repositories/trades.ts`
- Modify: `packages/db/src/repositories/trades.test.ts`, `packages/db/src/repositories/ibkr.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**
- Consumes: `LevelBasis`, `round2`, `TradePatch` with `scalp` and `reviewed` (`@tj/core`, Task 1).
- Produces (exported from `@tj/db`):

```ts
type ScalpRow = { tradeId: string; levelBasis: "stock" | "premium"; stopPrice: number | null; targetPrice: number | null };
interface TradeRecord { /* …as before, plus */ reviewedAt: number | null; scalp: ScalpRow | null }
class ReviewRuleError extends Error {}   // the route answers 400 with its message
function mergeLevels(tradeId: string, existing: ScalpRow | null, patch: NonNullable<TradePatch["scalp"]>): ScalpRow;
// repo.update(id, patch): merges patch.scalp, stamps patch.reviewed, refuses two emotions; throws ReviewRuleError
```

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/repositories/trades.test.ts`, add to the imports:

```ts
import { createTaxonomyRepo } from "./taxonomy.js";
import { createTradesRepo, ReviewRuleError } from "./trades.js";
```

(the second replaces the existing `import { createTradesRepo } from "./trades.js";`), and append:

```ts
describe("the scalp review", () => {
  /** The Sep 28 NVDA 232.5C scalp, closed. */
  const nvda: NewTrade = {
    ...sampleFly,
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    underlyingName: null,
    structureLabel: "Long call",
    netPnl: 44.74,
    fees: 2.26,
    feesOpen: 0.93,
    feesClose: 1.33,
    notes: null,
    legs: [
      {
        right: "C",
        strike: 232.5,
        expiry: "2026-09-28",
        quantity: 2,
        multiplier: 100,
        openPrice: 1.06,
        closePrice: 1.295,
      },
    ],
    ironFly: null,
  };
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  it("stores a scalp's first level with its basis, to the cent", () => {
    const id = repo().create(nvda).id;
    expect(repo().get(id)?.scalp).toBeNull();
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231.804 } });
    expect(repo().get(id)?.scalp).toEqual({
      tradeId: id,
      levelBasis: "stock",
      stopPrice: 231.8,
      targetPrice: null,
    });
  });

  it("merges a partial patch, keeping the other level", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231.8 } });
    repo().update(id, { scalp: { targetPrice: 234.5 } });
    expect(repo().get(id)?.scalp).toMatchObject({ stopPrice: 231.8, targetPrice: 234.5 });
    repo().update(id, { scalp: { stopPrice: null } });
    expect(repo().get(id)?.scalp).toMatchObject({ stopPrice: null, targetPrice: 234.5 });
  });

  it("needs a basis for the first level, and writes nothing without one", () => {
    const id = repo().create(nvda).id;
    expect(() => repo().update(id, { scalp: { stopPrice: 231.8 }, grade: "A" })).toThrow(ReviewRuleError);
    expect(repo().get(id)).toMatchObject({ scalp: null, grade: null });
  });

  it("clears both levels when the basis changes, unless the patch sets them", () => {
    const id = repo().create(nvda).id;
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231.8, targetPrice: 234.5 } });
    repo().update(id, { scalp: { levelBasis: "premium" } });
    expect(repo().get(id)?.scalp).toMatchObject({ levelBasis: "premium", stopPrice: null, targetPrice: null });
    repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 231 } });
    expect(repo().get(id)?.scalp).toMatchObject({ levelBasis: "stock", stopPrice: 231, targetPrice: null });
  });

  it("refuses 0 on the stock basis, and takes it on premium", () => {
    const id = repo().create(nvda).id;
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 0 } })).toThrow(
      "A stock price must be above 0",
    );
    repo().update(id, { scalp: { levelBasis: "premium", stopPrice: 0 } });
    expect(repo().get(id)?.scalp?.stopPrice).toBe(0);
  });

  it("gives only a scalp a stop and target", () => {
    const id = repo().create(sampleFly).id;
    expect(() => repo().update(id, { scalp: { levelBasis: "stock", stopPrice: 50 } })).toThrow(
      "Only a scalp has a stop and target",
    );
  });

  it("stamps Done reviewing with the clock and clears it, as a review edit and not a fact edit", () => {
    const id = repo().create({ ...nvda, source: "ibkr_flex" }).id;
    clock = 2_000;
    const done = repo().update(id, { reviewed: true, scalp: { levelBasis: "stock", stopPrice: 231.8 } });
    expect(done).toMatchObject({ reviewedAt: 2_000, editedAt: 2_000, factsEditedAt: null });
    expect(repo().update(id, { reviewed: false })?.reviewedAt).toBeNull();
  });

  it("allows one emotion at most, with any number of mistakes", () => {
    const taxonomy = createTaxonomyRepo(db);
    const calm = taxonomy.createTag({ name: "Calm", kind: "emotion" }).id;
    const rushed = taxonomy.createTag({ name: "Rushed", kind: "emotion" }).id;
    const fomo = taxonomy.createTag({ name: "FOMO entry", kind: "mistake" }).id;
    const early = taxonomy.createTag({ name: "Exited early", kind: "mistake" }).id;
    const id = repo().create(nvda).id;
    const both = [calm, fomo, early].sort();
    expect(repo().update(id, { tagIds: [calm, fomo, early] })?.tagIds.sort()).toEqual(both);
    expect(() => repo().update(id, { tagIds: [calm, rushed] })).toThrow("A trade has at most one emotion");
    expect(repo().get(id)?.tagIds.sort()).toEqual(both);
  });
});
```

In `packages/db/src/repositories/ibkr.test.ts`, add `import { createTaxonomyRepo } from "./taxonomy.js";` to the imports, and inside `describe("applying a synced trade", …)` add:

```ts
  it("keeps the review when it rewrites a scalp's facts", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    const taxonomy = createTaxonomyRepo(db);
    const setup = taxonomy.createSetup({ name: "ORB breakout", strategy: "scalp" }).id;
    const calm = taxonomy.createTag({ name: "Calm", kind: "emotion" }).id;
    clock = 2_000;
    trades().update("trade-nvda", {
      setupId: setup,
      grade: "B",
      tagIds: [calm],
      notes: "clean break",
      reviewed: true,
      scalp: { levelBasis: "stock", stopPrice: 231.8, targetPrice: 234.5 },
    });
    clock = 5_000;
    expect(ibkr().apply(scalp({ netPnl: 40.1 }), ACCOUNT.id)).toBe("updated");
    const stored = trades().get("trade-nvda");
    expect(stored).toMatchObject({
      netPnl: 40.1,
      setupId: setup,
      grade: "B",
      tagIds: [calm],
      notes: "clean break",
      reviewedAt: 2_000,
    });
    expect(stored?.scalp).toMatchObject({ levelBasis: "stock", stopPrice: 231.8, targetPrice: 234.5 });
  });
```

In `packages/db/src/migrate.test.ts`, add inside `describe("runMigrations", …)`:

```ts
  it("adds the scalp review's table and column", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("scalp_details")).toEqual(["trade_id", "level_basis", "stop_price", "target_price"]);
    expect(columns("trades")).toContain("reviewed_at");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL. There's no `ReviewRuleError`, no `scalp` on a trade, and no `scalp_details` table.

- [ ] **Step 3: Add the schema and generate the migration**

In `packages/db/src/schema.ts`, in the `trades` table, add after `factsEditedAt`:

```ts
    /** When the user clicked Done reviewing (scalp-review spec §5); null otherwise. */
    reviewedAt: integer("reviewed_at"),
```

and after the `ironFlyDetails` table, add:

```ts
/** A scalp's stop and target (scalp-review spec §5): one row per scalp, from its first level or basis. */
export const scalpDetails = sqliteTable("scalp_details", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  /** What both prices are measured on. */
  levelBasis: text("level_basis", { enum: ["stock", "premium"] }).notNull(),
  /** A stock price, or an option price per share. */
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
});
```

Generate the migration and read it:

```bash
pnpm --filter @tj/db exec drizzle-kit generate --name scalp_review
cat packages/db/migrations/0005_scalp_review.sql
```

Expected: `CREATE TABLE scalp_details` with its foreign key to `trades`, and `ALTER TABLE trades ADD reviewed_at integer`. Nothing else is touched.

- [ ] **Step 4: Implement the repository changes**

In `packages/db/src/repositories/trades.ts`:

Change the imports to:

```ts
import { type NewTrade, round2, sessionMoment, type TradePatch } from "@tj/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { ironFlyDetails, legs, scalpDetails, tags, trades, tradeTags } from "../schema.js";
```

After `export type IronFlyRow = …`, add `export type ScalpRow = typeof scalpDetails.$inferSelect;`, and add to `TradeRecord`:

```ts
  /** The scalp's stop and target (scalp-review spec §5); null until the first is set. */
  scalp: ScalpRow | null;
```

Before `createTradesRepo`, add:

```ts
/** A patch the review rules refuse (scalp-review spec §6.2). The route answers 400 with the message. */
export class ReviewRuleError extends Error {}

/**
 * A scalp's levels after a patch (scalp-review spec §6.2). The first write needs a basis. A new basis clears both
 * prices unless the patch sets them, because a stock level means nothing as a premium. Prices round to the cent.
 */
export function mergeLevels(
  tradeId: string,
  existing: ScalpRow | null,
  patch: NonNullable<TradePatch["scalp"]>,
): ScalpRow {
  const levelBasis = patch.levelBasis ?? existing?.levelBasis;
  if (!levelBasis) throw new ReviewRuleError("A scalp's first level needs a basis");
  const kept = existing?.levelBasis === levelBasis ? existing : null;
  const price = (sent: number | null | undefined, stored: number | null) => {
    const value = sent === undefined ? stored : sent;
    if (value == null) return null;
    if (levelBasis === "stock" && value <= 0) throw new ReviewRuleError("A stock price must be above 0");
    return round2(value);
  };
  return {
    tradeId,
    levelBasis,
    stopPrice: price(patch.stopPrice, kept?.stopPrice ?? null),
    targetPrice: price(patch.targetPrice, kept?.targetPrice ?? null),
  };
}
```

In `hydrate`, add after the `ironFly` line:

```ts
      scalp: conn.select().from(scalpDetails).where(eq(scalpDetails.tradeId, row.id)).get() ?? null,
```

Inside `createTradesRepo`, after `requireRow`, add:

```ts
  /** At most one emotion tag per trade (scalp-review spec §6.2). */
  function checkOneEmotion(tagIds: readonly string[]): void {
    if (tagIds.length < 2) return;
    const emotions = db
      .select({ id: tags.id })
      .from(tags)
      .where(and(inArray(tags.id, [...tagIds]), eq(tags.kind, "emotion")))
      .all();
    if (emotions.length > 1) throw new ReviewRuleError("A trade has at most one emotion");
  }
```

Replace `update` with:

```ts
    update(id: string, patch: TradePatch): TradeRecord | null {
      const existing = db
        .select()
        .from(trades)
        .where(and(eq(trades.id, id), isNull(trades.deletedAt)))
        .get();
      if (!existing) return null;

      const timestamp = now();
      const { legs: _legs, ironFly: _ironFly, tagIds: _tagIds, scalp, reviewed, ...rest } = patch;
      // Drop keys the caller never sent, so a patch only touches what it names.
      const columns = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
      // The review rules (scalp-review spec §6.2) are checked before anything is written.
      if (scalp && (patch.strategy ?? existing.strategy) !== "scalp") {
        throw new ReviewRuleError("Only a scalp has a stop and target");
      }
      const levels = scalp
        ? mergeLevels(id, db.select().from(scalpDetails).where(eq(scalpDetails.tradeId, id)).get() ?? null, scalp)
        : null;
      if (patch.tagIds) checkOneEmotion(patch.tagIds);

      const factsEdited = changesFacts(hydrate(db, existing), patch);
      return db.transaction((tx) => {
        tx.update(trades)
          .set({
            ...columns,
            ...(reviewed === undefined ? {} : { reviewedAt: reviewed ? timestamp : null }),
            updatedAt: timestamp,
            editedAt: timestamp,
            ...(factsEdited ? { factsEditedAt: timestamp } : {}),
          })
          .where(eq(trades.id, id))
          .run();
        writeChildren(tx, id, patch, timestamp);
        if (levels) {
          tx.insert(scalpDetails)
            .values(levels)
            .onConflictDoUpdate({ target: scalpDetails.tradeId, set: levels })
            .run();
        }
        const cleared = stalePrices(existing, patch);
        if (Object.keys(cleared).length > 0) {
          tx.update(ironFlyDetails).set(cleared).where(eq(ironFlyDetails.tradeId, id)).run();
        }
        return requireRow(tx, id);
      });
    },
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, the IBKR suite included.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db
git commit -m "feat(db): a scalp's stop and target, Done reviewing, and one emotion per trade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The review on every trade, and the queue in the API

**Files:**
- Modify: `apps/server/src/routes/trades.ts`
- Create: `apps/server/src/review.test.ts`

**Interfaces:**
- Consumes: `reviewStatus`, `ReviewStatus` (`@tj/core`, Task 1); `ReviewRuleError`, `TradeRecord.scalp` (`@tj/db`, Task 2).
- Produces:
  - every trade the API returns has `review: ReviewStatus | null` and `scalp: { tradeId, levelBasis, stopPrice, targetPrice } | null`;
  - `GET /api/trades?review=pending` (with the other filters) returns the pending trades only, oldest first, with no row limit;
  - a patch the review rules refuse answers **400** `{ error: "invalid", message }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** The Sep 28 NVDA 232.5C scalp, opened `minute` minutes after 09:30 ET and held 15 minutes. */
const scalp = (minute: number) => ({
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 8, 28, 13, 30 + minute),
  closedAt: Date.UTC(2026, 8, 28, 13, 45 + minute),
  netPnl: 44.74,
  fees: 2.26,
  legs: [{ right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
});

/** A balanced fly, closed. */
const fly = {
  strategy: "iron_fly",
  book: "paper",
  underlying: "AA",
  openedAt: Date.UTC(2026, 6, 16, 19, 50),
  closedAt: Date.UTC(2026, 6, 17, 13, 45),
  netPnl: 27.5,
  fees: 5,
  legs: [],
  ironFly: {
    bodyPutStrike: 47,
    bodyCallStrike: 47,
    putWingStrike: 40,
    callWingStrike: 54,
    contracts: 2,
    creditPerShare: 2.5,
  },
};

interface Reviewed {
  id: string;
  review: { status: string; missing: string[] } | null;
  scalp: { levelBasis: string; stopPrice: number | null; targetPrice: number | null } | null;
  reviewedAt: number | null;
}

function setup(now?: () => number) {
  const app = testApp({ now });
  const post = async (body: unknown) =>
    readJson<Reviewed>(
      await app.request("/api/trades", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
    );
  const patch = (id: string, body: unknown) =>
    app.request(`/api/trades/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const pending = async () =>
    (
      await readJson<Reviewed[]>(
        await app.request("/api/trades?strategy=scalp&review=pending", { headers: LOCAL }),
      )
    ).map((trade) => trade.id);
  /** The id of a seeded setup or tag, by name. */
  const idOf = async (path: "/api/setups" | "/api/tags", name: string) => {
    const items = await readJson<{ id: string; name: string }[]>(await app.request(path, { headers: LOCAL }));
    const found = items.find((item) => item.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found.id;
  };
  return { app, post, patch, pending, idOf };
}

describe("the scalp review API", () => {
  it("says what a new scalp lacks, and nothing about a fly", async () => {
    const { post } = setup();
    const nvda = await post(scalp(1));
    expect(nvda.review).toEqual({ status: "pending", missing: ["setup", "grade", "stop"] });
    expect(nvda.scalp).toBeNull();
    expect((await post(fly)).review).toBeNull();
  });

  it("takes the levels, the grade and the setup, and lets the scalp out of the queue", async () => {
    const { post, patch, idOf } = setup();
    const nvda = await post(scalp(1));
    const res = await patch(nvda.id, {
      scalp: { levelBasis: "stock", stopPrice: 231.8 },
      grade: "B",
      setupId: await idOf("/api/setups", "ORB breakout"),
    });
    expect(res.status).toBe(200);
    const body = await readJson<Reviewed>(res);
    expect(body.review).toEqual({ status: "done", missing: [] });
    expect(body.scalp).toMatchObject({ levelBasis: "stock", stopPrice: 231.8, targetPrice: null });
  });

  it("lists the queue oldest first: every pending scalp, and nothing else", async () => {
    const { post, patch, pending } = setup();
    const late = await post(scalp(20));
    const early = await post(scalp(0));
    const done = await post(scalp(10));
    await post(fly);
    await post({ ...scalp(30), closedAt: null, netPnl: null });
    await patch(done.id, { reviewed: true });
    expect(await pending()).toEqual([early.id, late.id]);
  });

  it("stamps Done reviewing with the server's clock", async () => {
    const { post, patch } = setup(() => 7_000);
    const nvda = await post(scalp(1));
    expect((await readJson<Reviewed>(await patch(nvda.id, { reviewed: true }))).reviewedAt).toBe(7_000);
  });

  it("refuses what the review rules refuse, saying why", async () => {
    const { post, patch, idOf } = setup();
    const nvda = await post(scalp(1));
    const aa = await post(fly);
    const refusal = async (id: string, body: unknown) => {
      const res = await patch(id, body);
      return { status: res.status, message: (await readJson<{ message?: string }>(res)).message };
    };
    expect(await refusal(aa.id, { scalp: { levelBasis: "stock", stopPrice: 46 } })).toEqual({
      status: 400,
      message: "Only a scalp has a stop and target",
    });
    expect(await refusal(nvda.id, { scalp: { stopPrice: 231.8 } })).toEqual({
      status: 400,
      message: "A scalp's first level needs a basis",
    });
    expect(await refusal(nvda.id, { scalp: { levelBasis: "stock", stopPrice: 0 } })).toEqual({
      status: 400,
      message: "A stock price must be above 0",
    });
    const tagIds = [await idOf("/api/tags", "Calm"), await idOf("/api/tags", "Rushed")];
    expect(await refusal(nvda.id, { tagIds })).toEqual({
      status: 400,
      message: "A trade has at most one emotion",
    });
    expect((await patch(nvda.id, { scalp: { levelBasis: "stock", stopPrice: -1 } })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/server/src/review.test.ts`
Expected: FAIL. Trades carry no `review`, `review=pending` is refused by the validator, and a rule error answers 500.

- [ ] **Step 3: Implement**

In `apps/server/src/routes/trades.ts`, change the imports to:

```ts
import { zValidator } from "@hono/zod-validator";
import {
  type IronFlyMetrics,
  type IronFlyOutcome,
  ironFlyMetrics,
  ironFlyOutcome,
  newTradeSchema,
  type ReviewStatus,
  reviewStatus,
  tradePatchSchema,
} from "@tj/core";
import {
  createIbkrRepo,
  createTradesRepo,
  type Db,
  type FillRow,
  ReviewRuleError,
  type TradeRecord,
} from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";
```

Add to `listQuerySchema`:

```ts
  /** The To review queue (scalp-review spec §6.2): pending trades only, oldest first, with no row limit. */
  review: z.enum(["pending"]).optional(),
```

Replace `TradeView` and `withMetrics` with:

```ts
export interface TradeView extends TradeRecord {
  metrics: (IronFlyMetrics & IronFlyOutcome) | null;
  /** Whether the trade waits in the To review queue (scalp-review spec §6.1); null where the queue doesn't apply. */
  review: ReviewStatus | null;
}

/** Metrics and the review status are derived on read, so a stored trade and its numbers can never drift apart. */
export function withMetrics(trade: TradeRecord): TradeView {
  return { ...trade, metrics: flyMetrics(trade), review: reviewStatus(trade) };
}

function flyMetrics(trade: TradeRecord): TradeView["metrics"] {
  const detail = trade.ironFly;
  if (
    !detail ||
    detail.bodyPutStrike == null ||
    detail.bodyCallStrike == null ||
    detail.putWingStrike == null ||
    detail.callWingStrike == null ||
    detail.contracts == null ||
    detail.creditPerShare == null
  ) {
    return null;
  }
  const metrics = ironFlyMetrics({
    bodyPutStrike: detail.bodyPutStrike,
    bodyCallStrike: detail.bodyCallStrike,
    putWingStrike: detail.putWingStrike,
    callWingStrike: detail.callWingStrike,
    contracts: detail.contracts,
    creditPerShare: detail.creditPerShare,
    fees: trade.fees,
  });
  // An open trade has no P&L yet, so its return stays empty rather than reading 0%.
  const outcome: IronFlyOutcome =
    trade.netPnl == null
      ? { returnOnRisk: null, pctOfMaxProfit: null, pnlPctOfCost: null }
      : ironFlyOutcome(metrics, trade.netPnl);
  return { ...metrics, ...outcome };
}
```

Replace the `.get("/", …)` handler with:

```ts
    .get("/", zValidator("query", listQuerySchema), (c) => {
      const query = c.req.valid("query");
      const filter = { strategy: query.strategy, book: query.book, underlying: query.underlying };
      if (query.review === "pending") {
        // Every pending trade, oldest first: the queue must never stop at the newest 500.
        return c.json(
          repo
            .list({ ...filter, limit: null })
            .map(withMetrics)
            .filter((trade) => trade.review?.status === "pending")
            .reverse(),
        );
      }
      return c.json(
        repo
          .list({
            ...filter,
            includeExcluded: query.includeExcluded === "true",
            limit: query.all === "true" ? null : undefined,
          })
          .map(withMetrics),
      );
    })
```

Replace the `.patch("/:id", …)` handler with:

```ts
    .patch("/:id", zValidator("json", tradePatchSchema), (c) => {
      try {
        const updated = repo.update(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(withMetrics(updated)) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof ReviewRuleError) return c.json({ error: "invalid", message: error.message }, 400);
        throw error;
      }
    })
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/server`
Expected: PASS, the existing trade tests included.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server
git commit -m "feat(server): the review status on every trade, the To review queue, and why a patch was refused

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If `pnpm typecheck` reports TS2742 in `apps/web/src/api.ts`, spell the offending type out inline in the route's answer.

---

### Task 4: Setups and tags: rename, archive, trade counts and unique names

**Files:**
- Modify: `packages/db/src/repositories/taxonomy.ts`, `packages/db/src/repositories/taxonomy.test.ts`
- Modify: `apps/server/src/routes/taxonomy.ts`
- Create: `apps/server/src/taxonomy.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// @tj/db
class DuplicateNameError extends Error {}   // the route answers 409 with its message
type SetupListItem = SetupRow & { tradeCount: number };
type TagListItem = TagRow & { tradeCount: number };
repo.listSetups(options?: { includeArchived?: boolean }): SetupListItem[];
repo.listTags(options?: { includeArchived?: boolean }): TagListItem[];
repo.updateSetup(id, patch: { name?: string; description?: string | null; strategy?: string | null; archived?: boolean }): SetupRow | null;
repo.updateTag(id, patch: { name?: string; archived?: boolean }): TagRow | null;
// createSetup / createTag now throw DuplicateNameError on a name already taken (ignoring case, archived included)
```

- HTTP:
  - `GET /api/setups` and `GET /api/tags` take `?includeArchived=true`, and each item carries `tradeCount`.
  - `PATCH /api/setups/:id` takes `{ name?, description?, strategy? ("scalp" | "iron_fly" | null), archived? }`.
  - `PATCH /api/tags/:id` takes `{ name?, archived? }`.
  - Both answer 404 for an unknown id.
  - `POST` and `PATCH` answer **409** `{ error: "duplicate", message }` for a name already taken.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/repositories/taxonomy.test.ts`, change the imports to:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newTradeSchema } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { createTaxonomyRepo, DuplicateNameError } from "./taxonomy.js";
import { createTradesRepo } from "./trades.js";
```

and add inside `describe("taxonomy repository", …)`:

```ts
  it("renames, describes and re-scopes a setup, and archives and restores it", () => {
    const orb = repo().createSetup({ name: "ORB breakout", strategy: "scalp" });
    expect(
      repo().updateSetup(orb.id, { name: "Opening range break", description: "First 5 minutes", strategy: null }),
    ).toMatchObject({ name: "Opening range break", description: "First 5 minutes", strategy: null });
    repo().updateSetup(orb.id, { archived: true });
    expect(repo().listSetups()).toHaveLength(0);
    expect(repo().listSetups({ includeArchived: true }).map((setup) => setup.archived)).toEqual([true]);
    repo().updateSetup(orb.id, { archived: false });
    expect(repo().listSetups()).toHaveLength(1);
    expect(repo().updateSetup(crypto.randomUUID(), { archived: true })).toBeNull();
  });

  it("refuses a setup name already taken, ignoring case, archived or not", () => {
    const orb = repo().createSetup({ name: "ORB breakout" });
    repo().updateSetup(orb.id, { archived: true });
    expect(() => repo().createSetup({ name: "orb BREAKOUT" })).toThrow(DuplicateNameError);
    const vwap = repo().createSetup({ name: "VWAP reclaim" });
    expect(() => repo().updateSetup(vwap.id, { name: "ORB Breakout" })).toThrow("A setup with that name exists");
    // Its own name, even with another case, is no clash.
    expect(repo().updateSetup(vwap.id, { name: "VWAP Reclaim" })?.name).toBe("VWAP Reclaim");
  });

  it("renames and archives a tag, refusing a name its own kind already has", () => {
    const fomo = repo().createTag({ name: "FOMO entry", kind: "mistake" });
    repo().createTag({ name: "Oversized", kind: "mistake" });
    repo().createTag({ name: "Rushed", kind: "emotion" });
    expect(() => repo().updateTag(fomo.id, { name: "oversized" })).toThrow("A mistake tag with that name exists");
    expect(() => repo().createTag({ name: "rushed", kind: "emotion" })).toThrow(
      "An emotion tag with that name exists",
    );
    // Another kind's name is fine.
    expect(repo().updateTag(fomo.id, { name: "Rushed" })?.name).toBe("Rushed");
    repo().updateTag(fomo.id, { archived: true });
    expect(
      repo()
        .listTags()
        .map((tag) => [tag.kind, tag.name]),
    ).toEqual([
      ["mistake", "Oversized"],
      ["emotion", "Rushed"],
    ]);
    expect(repo().updateTag(crypto.randomUUID(), { name: "Late" })).toBeNull();
  });

  it("counts the live trades using each setup and tag", () => {
    const orb = repo().createSetup({ name: "ORB breakout", strategy: "scalp" });
    const calm = repo().createTag({ name: "Calm", kind: "emotion" });
    const trades = createTradesRepo(db, () => 1_000);
    const scalp = newTradeSchema.parse({
      strategy: "scalp",
      book: "paper",
      underlying: "NVDA",
      openedAt: 1_000,
      setupId: orb.id,
      tagIds: [calm.id],
    });
    trades.create(scalp);
    trades.create(scalp);
    trades.softDelete(trades.create(scalp).id);
    expect(repo().listSetups()[0]?.tradeCount).toBe(2);
    expect(repo().listTags()[0]?.tradeCount).toBe(2);
    repo().createSetup({ name: "Unused" });
    expect(repo().listSetups().find((setup) => setup.name === "Unused")?.tradeCount).toBe(0);
  });
```

Create `apps/server/src/taxonomy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const JSON_HEADERS = { "content-type": "application/json", host: "localhost" };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

interface Item {
  id: string;
  name: string;
  kind?: string;
  strategy?: string | null;
  archived: boolean;
  tradeCount: number;
}

function setup() {
  const app = testApp();
  const list = async (path: string) => readJson<Item[]>(await app.request(path, { headers: LOCAL }));
  const send = (method: "POST" | "PATCH", path: string, body: unknown) =>
    app.request(path, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  const named = async (path: string, name: string) => {
    const found = (await list(`${path}?includeArchived=true`)).find((item) => item.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { list, send, named };
}

describe("setups and tags", () => {
  it("renames and archives a setup, listing archived ones only when asked, each with its trade count", async () => {
    const { list, send, named } = setup();
    const orb = await named("/api/setups", "ORB breakout");
    expect(orb.tradeCount).toBe(0);
    const renamed = await send("PATCH", `/api/setups/${orb.id}`, { name: "Opening range break", strategy: null });
    expect(await readJson<Item>(renamed)).toMatchObject({ name: "Opening range break", strategy: null });
    await send("PATCH", `/api/setups/${orb.id}`, { archived: true });
    expect((await list("/api/setups")).some((item) => item.id === orb.id)).toBe(false);
    expect((await named("/api/setups", "Opening range break")).archived).toBe(true);
  });

  it("renames and archives a tag, keeping its kind", async () => {
    const { send, named } = setup();
    const fomo = await named("/api/tags", "FOMO entry");
    const res = await send("PATCH", `/api/tags/${fomo.id}`, { name: "Chased", archived: true });
    expect(await readJson<Item>(res)).toMatchObject({ name: "Chased", kind: "mistake", archived: true });
  });

  it("answers 409 with the reason for a name already taken", async () => {
    const { send, named } = setup();
    const created = await send("POST", "/api/setups", { name: "vwap RECLAIM", strategy: "scalp" });
    expect(created.status).toBe(409);
    expect(await readJson<{ message: string }>(created)).toEqual({
      error: "duplicate",
      message: "A setup with that name exists",
    });
    const orb = await named("/api/setups", "ORB breakout");
    expect((await send("PATCH", `/api/setups/${orb.id}`, { name: "VWAP reclaim" })).status).toBe(409);
    const tag = await send("POST", "/api/tags", { name: "calm", kind: "emotion" });
    expect(await readJson<{ message: string }>(tag)).toMatchObject({ message: "An emotion tag with that name exists" });
  });

  it("answers 404 for an unknown setup or tag, and 400 for an empty name", async () => {
    const { send, named } = setup();
    expect((await send("PATCH", `/api/setups/${crypto.randomUUID()}`, { archived: true })).status).toBe(404);
    expect((await send("PATCH", `/api/tags/${crypto.randomUUID()}`, { archived: true })).status).toBe(404);
    const orb = await named("/api/setups", "ORB breakout");
    expect((await send("PATCH", `/api/setups/${orb.id}`, { name: "  " })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db/src/repositories/taxonomy.test.ts apps/server/src/taxonomy.test.ts`
Expected: FAIL. There's no `updateSetup`, `updateTag`, `DuplicateNameError` or `tradeCount`, and no PATCH routes.

- [ ] **Step 3: Implement the repository**

Replace `packages/db/src/repositories/taxonomy.ts` with:

```ts
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { setups, tags, trades, tradeTags } from "../schema.js";

export type SetupRow = typeof setups.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
/** A setup or tag as the Playbook and the pickers list it: with how many live trades use it. */
export type SetupListItem = SetupRow & { tradeCount: number };
export type TagListItem = TagRow & { tradeCount: number };

/** A name already taken (scalp-review spec §6.3). The route answers 409 with the message. */
export class DuplicateNameError extends Error {}

const DEFAULT_SETUPS = [
  {
    name: "Earnings IV crush",
    strategy: "iron_fly",
    description: "Short fly into earnings, out the next day",
  },
  { name: "ORB breakout", strategy: "scalp", description: "Break of the opening range" },
  { name: "VWAP reclaim", strategy: "scalp", description: "Reclaim of session VWAP after a flush" },
];

const DEFAULT_TAGS: { name: string; kind: "mistake" | "emotion" }[] = [
  { name: "Moved stop", kind: "mistake" },
  { name: "FOMO entry", kind: "mistake" },
  { name: "Oversized", kind: "mistake" },
  { name: "Exited early", kind: "mistake" },
  { name: "Calm", kind: "emotion" },
  { name: "Rushed", kind: "emotion" },
  { name: "Revenge", kind: "emotion" },
];

const setupTaken = () => new DuplicateNameError("A setup with that name exists");
const tagTaken = (kind: string) =>
  new DuplicateNameError(
    kind === "emotion" ? "An emotion tag with that name exists" : "A mistake tag with that name exists",
  );

/** Only the fields a patch names. */
const named = <T extends object>(patch: T) =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

export function createTaxonomyRepo(db: Db, now: () => number = Date.now) {
  const stamps = () => {
    const timestamp = now();
    return { createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  };

  /** Names are unique ignoring case, archived ones included: a setup among setups, a tag within its kind. */
  function setupNameTaken(name: string, exceptId?: string): boolean {
    const conditions = [sql`lower(${setups.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(setups.id, exceptId));
    return db.select({ id: setups.id }).from(setups).where(and(...conditions)).get() !== undefined;
  }

  function tagNameTaken(kind: string, name: string, exceptId?: string): boolean {
    const conditions = [eq(tags.kind, kind), sql`lower(${tags.name}) = lower(${name})`];
    if (exceptId) conditions.push(ne(tags.id, exceptId));
    return db.select({ id: tags.id }).from(tags).where(and(...conditions)).get() !== undefined;
  }

  /** How many live (not deleted) trades use each setup, and each tag. */
  function setupCounts(): Map<string, number> {
    const rows = db
      .select({ id: trades.setupId, count: sql<number>`count(*)` })
      .from(trades)
      .where(and(isNull(trades.deletedAt), isNotNull(trades.setupId)))
      .groupBy(trades.setupId)
      .all();
    return new Map(rows.flatMap((row) => (row.id ? [[row.id, row.count] as const] : [])));
  }

  function tagCounts(): Map<string, number> {
    const rows = db
      .select({ id: tradeTags.tagId, count: sql<number>`count(*)` })
      .from(tradeTags)
      .innerJoin(trades, eq(trades.id, tradeTags.tradeId))
      .where(isNull(trades.deletedAt))
      .groupBy(tradeTags.tagId)
      .all();
    return new Map(rows.map((row) => [row.id, row.count]));
  }

  function createSetup(input: {
    name: string;
    description?: string | null;
    strategy?: string | null;
  }): SetupRow {
    if (setupNameTaken(input.name)) throw setupTaken();
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? null,
      strategy: input.strategy ?? null,
      archived: false,
      ...stamps(),
    };
    db.insert(setups).values(row).run();
    return row;
  }

  function createTag(input: { name: string; kind: "mistake" | "emotion" }): TagRow {
    if (tagNameTaken(input.kind, input.name)) throw tagTaken(input.kind);
    const row = {
      id: crypto.randomUUID(),
      name: input.name,
      kind: input.kind,
      archived: false,
      ...stamps(),
    };
    db.insert(tags).values(row).run();
    return row;
  }

  return {
    listSetups(options: { includeArchived?: boolean } = {}): SetupListItem[] {
      const counts = setupCounts();
      return db
        .select()
        .from(setups)
        .where(options.includeArchived ? undefined : eq(setups.archived, false))
        .orderBy(asc(setups.name))
        .all()
        .map((row) => ({ ...row, tradeCount: counts.get(row.id) ?? 0 }));
    },

    createSetup,

    /** Null for an unknown setup. */
    updateSetup(
      id: string,
      patch: { name?: string; description?: string | null; strategy?: string | null; archived?: boolean },
    ): SetupRow | null {
      if (patch.name !== undefined && setupNameTaken(patch.name, id)) throw setupTaken();
      db.update(setups)
        .set({ ...named(patch), updatedAt: now() })
        .where(eq(setups.id, id))
        .run();
      return db.select().from(setups).where(eq(setups.id, id)).get() ?? null;
    },

    listTags(options: { includeArchived?: boolean } = {}): TagListItem[] {
      const counts = tagCounts();
      return db
        .select()
        .from(tags)
        .where(options.includeArchived ? undefined : eq(tags.archived, false))
        .orderBy(asc(tags.name))
        .all()
        .map((row) => ({ ...row, tradeCount: counts.get(row.id) ?? 0 }));
    },

    createTag,

    /** Null for an unknown tag. A tag's kind never changes. */
    updateTag(id: string, patch: { name?: string; archived?: boolean }): TagRow | null {
      const existing = db.select().from(tags).where(eq(tags.id, id)).get();
      if (!existing) return null;
      if (patch.name !== undefined && tagNameTaken(existing.kind, patch.name, id)) throw tagTaken(existing.kind);
      db.update(tags)
        .set({ ...named(patch), updatedAt: now() })
        .where(eq(tags.id, id))
        .run();
      return db.select().from(tags).where(eq(tags.id, id)).get() ?? null;
    },

    /** First-run content so the app is usable immediately. Safe to call on every boot. */
    seedDefaults(): void {
      if (db.select().from(setups).all().length === 0) {
        for (const setup of DEFAULT_SETUPS) createSetup(setup);
      }
      if (db.select().from(tags).all().length === 0) {
        for (const tag of DEFAULT_TAGS) createTag(tag);
      }
    },
  };
}
```

The tags test expects `listTags()` in name order. "Oversized" sorts before "Rushed", so the order is by name, not by kind.

- [ ] **Step 4: Implement the routes**

Replace `apps/server/src/routes/taxonomy.ts` with:

```ts
import { zValidator } from "@hono/zod-validator";
import { createTaxonomyRepo, type Db, DuplicateNameError } from "@tj/db";
import { Hono } from "hono";
import { z } from "zod";

const newSetupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullish(),
  strategy: z.enum(["scalp", "iron_fly"]).nullish(),
});

const newTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["mistake", "emotion"]),
});

/** Archived items are listed only on request: the pickers and the Playbook ask for them (scalp-review spec §6.3). */
const listQuerySchema = z.object({ includeArchived: z.enum(["true"]).optional() });

const setupPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500).nullable(),
    strategy: z.enum(["scalp", "iron_fly"]).nullable(),
    archived: z.boolean(),
  })
  .partial();

/** A tag's kind never changes. */
const tagPatchSchema = z.object({ name: z.string().trim().min(1).max(40), archived: z.boolean() }).partial();

export function taxonomyRoutes(db: Db, now?: () => number) {
  const repo = createTaxonomyRepo(db, now);
  repo.seedDefaults();

  const setups = new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) =>
      c.json(repo.listSetups({ includeArchived: c.req.valid("query").includeArchived === "true" })),
    )
    .post("/", zValidator("json", newSetupSchema), (c) => {
      try {
        return c.json(repo.createSetup(c.req.valid("json")), 201);
      } catch (error) {
        if (error instanceof DuplicateNameError) return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    })
    .patch("/:id", zValidator("json", setupPatchSchema), (c) => {
      try {
        const updated = repo.updateSetup(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof DuplicateNameError) return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    });

  const tags = new Hono()
    .get("/", zValidator("query", listQuerySchema), (c) =>
      c.json(repo.listTags({ includeArchived: c.req.valid("query").includeArchived === "true" })),
    )
    .post("/", zValidator("json", newTagSchema), (c) => {
      try {
        return c.json(repo.createTag(c.req.valid("json")), 201);
      } catch (error) {
        if (error instanceof DuplicateNameError) return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    })
    .patch("/:id", zValidator("json", tagPatchSchema), (c) => {
      try {
        const updated = repo.updateTag(c.req.param("id"), c.req.valid("json"));
        return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
      } catch (error) {
        if (error instanceof DuplicateNameError) return c.json({ error: "duplicate", message: error.message }, 409);
        throw error;
      }
    });

  return { setups, tags };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/db apps/server`
Expected: PASS. The existing "rejects a duplicate tag name within the same kind" still passes, since `DuplicateNameError` is thrown.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db apps/server
git commit -m "feat: rename and archive setups and tags, with trade counts and unique names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The queue's maths, the review's words, and the default basis in Settings

**Files:**
- Create: `apps/web/src/review/queue.ts`, `apps/web/src/review/queue.test.ts`
- Create: `apps/web/src/review/text.ts`, `apps/web/src/review/text.test.ts`
- Create: `apps/web/src/review/prefs.ts`, `apps/web/src/review/prefs.test.ts`
- Modify: `apps/web/src/chart/ChartSettings.tsx`, `apps/web/src/chart/ChartSettings.test.tsx`

**Interfaces:**
- Consumes: `LEVEL_BASES`, `LevelBasis`, `ReviewNeed` (`@tj/core`, Task 1).
- Produces:

```ts
// review/queue.ts
interface QueueItem { id: string; openedAt: number }
interface QueueNav { position: number | null; total: number; left: number; next: string | null; prev: string | null }
function queueNav(pending: readonly QueueItem[], current: QueueItem, currentPending: boolean): QueueNav;
// review/text.ts
function needsText(missing: readonly ReviewNeed[]): string;       // "needs a setup and a stop"
function missingList(missing: readonly ReviewNeed[]): string;     // "setup, stop"
function contractText(trade: { underlying: string; legs: readonly { strike: number; right: string }[] }): string; // "NVDA 232.5C"
// review/prefs.ts
function loadLevelBasis(): LevelBasis;
function saveLevelBasis(basis: LevelBasis): void;
function useDefaultBasis(): [LevelBasis, (next: LevelBasis) => void];
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/review/queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { queueNav } from "./queue.js";

const item = (id: string, minute: number) => ({ id, openedAt: Date.UTC(2026, 8, 28, 13, 30 + minute) });
const A = item("a", 1);
const B = item("b", 5);
const C = item("c", 9);
const PENDING = [A, B, C];

describe("queueNav", () => {
  it("places a pending trade in the queue, with the way on both sides", () => {
    expect(queueNav(PENDING, B, true)).toEqual({ position: 2, total: 3, left: 2, next: "c", prev: "a" });
  });

  it("wraps around at both ends", () => {
    expect(queueNav(PENDING, C, true)).toMatchObject({ position: 3, next: "a", prev: "b" });
    expect(queueNav(PENDING, A, true)).toMatchObject({ position: 1, next: "b", prev: "c" });
  });

  it("goes by the trade's own status when the list hasn't caught up with its save", () => {
    // B was just reviewed, but the list was fetched before that landed.
    expect(queueNav(PENDING, B, false)).toEqual({ position: null, total: 2, left: 2, next: "c", prev: "a" });
    // And a pending trade the list doesn't have yet still counts.
    expect(queueNav([A, C], B, true)).toMatchObject({ position: 2, total: 3, left: 2 });
  });

  it("leads from a trade outside the queue to the next one opened after it", () => {
    expect(queueNav(PENDING, item("x", 3), false)).toMatchObject({ position: null, left: 3, next: "b", prev: "a" });
  });

  it("has no way on when nothing else waits", () => {
    expect(queueNav([A], A, true)).toEqual({ position: 1, total: 1, left: 0, next: null, prev: null });
    expect(queueNav([], B, false)).toEqual({ position: null, total: 0, left: 0, next: null, prev: null });
  });

  it("orders trades opened in the same minute by id", () => {
    const twin = { id: "b2", openedAt: B.openedAt };
    expect(queueNav([A, twin, B, C], B, true)).toMatchObject({ position: 2, next: "b2" });
  });
});
```

Create `apps/web/src/review/text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contractText, missingList, needsText } from "./text.js";

describe("the review's words", () => {
  it("says what a scalp still needs", () => {
    expect(needsText(["setup", "grade", "stop"])).toBe("needs a setup, a grade and a stop");
    expect(needsText(["setup", "stop"])).toBe("needs a setup and a stop");
    expect(needsText(["stop"])).toBe("needs a stop");
    expect(needsText([])).toBe("");
  });

  it("lists what's missing for the Dashboard", () => {
    expect(missingList(["setup", "stop"])).toBe("setup, stop");
  });

  it("names the contract", () => {
    expect(contractText({ underlying: "NVDA", legs: [{ strike: 232.5, right: "C" }] })).toBe("NVDA 232.5C");
    expect(contractText({ underlying: "NVDA", legs: [] })).toBe("NVDA");
  });
});
```

Create `apps/web/src/review/prefs.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadLevelBasis, saveLevelBasis } from "./prefs.js";

afterEach(() => localStorage.clear());

describe("the default basis", () => {
  it("is stock until changed, and remembers a change", () => {
    expect(loadLevelBasis()).toBe("stock");
    saveLevelBasis("premium");
    expect(loadLevelBasis()).toBe("premium");
    expect(JSON.parse(localStorage.getItem("tj.review") ?? "{}")).toEqual({ levelBasis: "premium" });
  });

  it("falls back to stock for anything unreadable", () => {
    localStorage.setItem("tj.review", "{not json");
    expect(loadLevelBasis()).toBe("stock");
    localStorage.setItem("tj.review", JSON.stringify({ levelBasis: "delta" }));
    expect(loadLevelBasis()).toBe("stock");
  });
});
```

Append to `apps/web/src/chart/ChartSettings.test.tsx`, inside `describe("ChartSettings", …)`:

```ts
  it("keeps the default basis for stops and targets in this browser, stock to start", () => {
    render(<ChartSettings />);
    expect(screen.getByRole("button", { name: "Stock" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.getByRole("button", { name: "Premium" }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem("tj.review") ?? "{}")).toEqual({ levelBasis: "premium" });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/review apps/web/src/chart/ChartSettings.test.tsx`
Expected: FAIL. The modules don't exist, and Settings has no basis buttons.

- [ ] **Step 3: Implement**

Create `apps/web/src/review/queue.ts`:

```ts
/** A trade's place in the To review queue (scalp-review spec §7.2). */
export interface QueueItem {
  id: string;
  openedAt: number;
}

export interface QueueNav {
  /** This trade's place in the queue, from 1, while it's pending; null otherwise. */
  position: number | null;
  /** How many wait, this trade included when it's pending. */
  total: number;
  /** How many other trades wait. */
  left: number;
  /** The next pending trade opened after this one, wrapping to the oldest; null when no other waits. */
  next: string | null;
  /** The last pending trade opened before this one, wrapping to the newest. */
  prev: string | null;
}

const order = (a: QueueItem, b: QueueItem) => a.openedAt - b.openedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Where `current` sits among the `pending` trades. The trade's own status decides whether it counts, so a list
 * fetched before its last save can't put a reviewed trade back in the queue, or leave a pending one out.
 */
export function queueNav(pending: readonly QueueItem[], current: QueueItem, currentPending: boolean): QueueNav {
  const others = pending.filter((each) => each.id !== current.id).sort(order);
  const after = others.filter((each) => order(each, current) > 0);
  const before = others.filter((each) => order(each, current) < 0);
  return {
    position: currentPending ? before.length + 1 : null,
    total: others.length + (currentPending ? 1 : 0),
    left: others.length,
    next: (after[0] ?? others[0])?.id ?? null,
    prev: (before.at(-1) ?? others.at(-1))?.id ?? null,
  };
}
```

Create `apps/web/src/review/text.ts`:

```ts
import type { ReviewNeed } from "@tj/core";

const NEED_WORDS: Record<ReviewNeed, string> = { setup: "a setup", grade: "a grade", stop: "a stop" };

/** What a scalp still needs, for the queue bar: "needs a setup and a stop". */
export function needsText(missing: readonly ReviewNeed[]): string {
  const words = missing.map((need) => NEED_WORDS[need]);
  const last = words.at(-1);
  if (!last) return "";
  return words.length === 1 ? `needs ${last}` : `needs ${words.slice(0, -1).join(", ")} and ${last}`;
}

/** What a scalp lacks, for the Dashboard's rows: "setup, stop". */
export const missingList = (missing: readonly ReviewNeed[]) => missing.join(", ");

/** The contract a scalp traded: "NVDA 232.5C". */
export function contractText(trade: { underlying: string; legs: readonly { strike: number; right: string }[] }) {
  const leg = trade.legs[0];
  return leg ? `${trade.underlying} ${leg.strike}${leg.right}` : trade.underlying;
}
```

Create `apps/web/src/review/prefs.ts`:

```ts
import { LEVEL_BASES, type LevelBasis } from "@tj/core";
import { useState } from "react";

const KEY = "tj.review";

/** The basis a scalp's review starts on (scalp-review spec §11). Storage can be missing or refuse: stock, then. */
export function loadLevelBasis(): LevelBasis {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const basis = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>).levelBasis : null;
    return LEVEL_BASES.find((each) => each === basis) ?? "stock";
  } catch {
    return "stock";
  }
}

export function saveLevelBasis(basis: LevelBasis): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ levelBasis: basis }));
  } catch {
    // A private window: the choice lasts until the page closes.
  }
}

/** The default basis, and a setter that remembers it. */
export function useDefaultBasis(): [LevelBasis, (next: LevelBasis) => void] {
  const [basis, setBasis] = useState(loadLevelBasis);
  return [
    basis,
    (next) => {
      saveLevelBasis(next);
      setBasis(next);
    },
  ];
}
```

In `apps/web/src/chart/ChartSettings.tsx`, add the imports:

```ts
import { LEVEL_BASES } from "@tj/core";
import { useDefaultBasis } from "../review/prefs.js";
```

add inside `ChartSettings`, after `const [saved, setSaved] = useState(false);`:

```ts
  const [levelBasis, setLevelBasis] = useDefaultBasis();
```

and add before the closing `</Panel>`:

```tsx
      <div className="mt-3 flex items-center gap-2 border-line border-t pt-2">
        <span className="text-[10px] text-muted uppercase tracking-wider">Stop and target levels default to</span>
        {LEVEL_BASES.map((basis) => (
          <button
            key={basis}
            type="button"
            aria-pressed={levelBasis === basis}
            onClick={() => setLevelBasis(basis)}
            className={`rounded-[2px] border px-2 py-0.5 ${
              levelBasis === basis ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
            }`}
          >
            {basis === "stock" ? "Stock" : "Premium"}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted">
        Where a scalp's review starts. A trade that already has a stop or target keeps its own. Kept in this
        browser.
      </p>
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/review apps/web/src/chart/ChartSettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/review apps/web/src/chart/ChartSettings.tsx apps/web/src/chart/ChartSettings.test.tsx
git commit -m "feat(web): the queue's order, the review's words, and a default basis for stops in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Placing and dragging lines on the intraday chart

**Files:**
- Create: `apps/web/src/chart/drag.ts`, `apps/web/src/chart/drag.test.ts`
- Modify: `apps/web/src/chart/IntradayChart.tsx`
- Modify: `apps/web/src/chart/testing.ts` (the fake learns a price scale, pane size, chart options and movable price lines)
- Modify: `apps/web/src/chart/charts.test.tsx`
- Modify: `apps/web/src/chart/TradeCharts.tsx`, `apps/web/src/chart/TradeCharts.test.tsx`
- Modify: `apps/web/src/theme.css`

**Interfaces:**
- Consumes: `round2` (`@tj/core`).
- Produces:

```ts
// chart/drag.ts
type LevelKind = "stop" | "target";
const GRAB_PX = 6;
interface ChartEditing {
  placing: LevelKind | null;
  onPlace(kind: LevelKind, price: number): void;  // a click placed a line: save it
  onDrag(kind: LevelKind, price: number): void;   // a dragged line is here now: nothing saved
  onDrop(kind: LevelKind, price: number): void;   // the drag ended here: save it
  onCancel(): void;                                // Esc: stop placing, or a dragged line went back
}
function nearestLine(lines: readonly { id: LevelKind; price: number }[], y: number, toY: (price: number) => number | null): LevelKind | null;
function priceAt(y: number, toPrice: (y: number) => number | null): number | null;
function inPane(x: number, y: number, pane: { width: number; height: number }): boolean;
// IntradayChart: PriceLine gains `id?: LevelKind`; new prop `editing?: ChartEditing`
// TradeCharts: new prop `levels?: { lines: readonly PriceLine[]; editing: ChartEditing }`, handed to IntradayChart only
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/chart/drag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inPane, nearestLine, priceAt } from "./drag.js";

// 240 at the top of a 400 px pane, 220 at the bottom: 0.05 a pixel.
const toY = (price: number) => ((240 - price) / 20) * 400;
const toPrice = (y: number) => 240 - (y / 400) * 20;
// The stop sits at y 164, the target at y 158.
const LINES = [
  { id: "stop" as const, price: 231.8 },
  { id: "target" as const, price: 232.1 },
];

describe("nearestLine", () => {
  it("grabs a line within 6 px, and the closer one when both are", () => {
    expect(nearestLine(LINES, 169, toY)).toBe("stop");
    expect(nearestLine(LINES, 161.5, toY)).toBe("stop");
    expect(nearestLine(LINES, 160, toY)).toBe("target");
  });

  it("grabs nothing further away, nothing off the scale, and nothing without lines", () => {
    expect(nearestLine(LINES, 171, toY)).toBeNull();
    expect(nearestLine(LINES, 164, () => null)).toBeNull();
    expect(nearestLine([], 164, toY)).toBeNull();
  });
});

describe("priceAt", () => {
  it("reads the price at a height, to the cent", () => {
    expect(priceAt(164, toPrice)).toBe(231.8);
    expect(priceAt(164.8, toPrice)).toBe(231.76);
    expect(priceAt(180, toPrice)).toBe(231);
  });

  it("reads nothing off the scale, or at or below zero", () => {
    expect(priceAt(10, () => null)).toBeNull();
    expect(priceAt(10, () => 0)).toBeNull();
    expect(priceAt(10, () => -2)).toBeNull();
  });
});

describe("inPane", () => {
  it("is the plot, not the axes", () => {
    const pane = { width: 800, height: 400 };
    expect(inPane(10, 10, pane)).toBe(true);
    expect(inPane(800, 10, pane)).toBe(false);
    expect(inPane(10, 400, pane)).toBe(false);
    expect(inPane(-1, 10, pane)).toBe(false);
  });
});
```

In `apps/web/src/chart/charts.test.tsx`, change `import { library, resetLibrary, seriesOf } from "./testing.js";` to `import { library, resetLibrary, seriesOf, yOf } from "./testing.js";`, and append:

```tsx
describe("IntradayChart editing the review's lines", () => {
  const STOP = { id: "stop" as const, price: 231.8, color: "#ef5350", dashed: true, label: "STOP" };
  const editing = (placing: "stop" | "target" | null = null) => ({
    placing,
    onPlace: vi.fn(),
    onDrag: vi.fn(),
    onDrop: vi.fn(),
    onCancel: vi.fn(),
  });
  const chart = () => screen.getByTestId("intraday-chart");
  const stopLine = () => seriesOf("Candlestick")[0]?.priceLines[0];
  const renderEditing = (edit: ReturnType<typeof editing>, lines = [STOP]) =>
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={lines} editing={edit} />);

  it("places the stop where the chart is clicked, to the cent", () => {
    const edit = editing("stop");
    renderEditing(edit, []);
    expect(screen.getByTestId("placing-hint").textContent).toBe(
      "Click the chart to place the stop · Esc to cancel",
    );
    expect(chart().dataset.cursor).toBe("crosshair");
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    expect(edit.onPlace).toHaveBeenCalledWith("stop", 231.8);
  });

  it("ignores a click on the price axis while placing, and stops placing on Esc", () => {
    const edit = editing("stop");
    renderEditing(edit, []);
    fireEvent.mouseDown(chart(), { clientX: 850, clientY: yOf(231.8), button: 0 });
    expect(edit.onPlace).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(edit.onCancel).toHaveBeenCalled();
  });

  it("drags a line: it follows, the chart stops panning, and the release saves once", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8) + 3, button: 0 });
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: false, handleScale: false });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(231) });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230.5) });
    expect(edit.onDrag).toHaveBeenLastCalledWith("stop", 230.5);
    expect(stopLine()?.price).toBe(230.5);
    expect(edit.onDrop).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(edit.onDrop).toHaveBeenCalledTimes(1);
    expect(edit.onDrop).toHaveBeenCalledWith("stop", 230.5);
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: true, handleScale: true });
  });

  it("keeps a drag going outside the chart, saving where it's released", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(document.body, { clientX: 1200, clientY: yOf(229) });
    fireEvent.mouseUp(document.body);
    expect(edit.onDrop).toHaveBeenCalledTimes(1);
    expect(edit.onDrop).toHaveBeenCalledWith("stop", 229);
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: true, handleScale: true });
  });

  it("puts a dragged line back on Esc, saving nothing", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230) });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stopLine()?.price).toBe(231.8);
    expect(edit.onCancel).toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(edit.onDrop).not.toHaveBeenCalled();
  });

  it("shows ↕ only over a line, and leaves a press away from the lines to the chart", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseMove(chart(), { clientX: 100, clientY: yOf(231.8) + 2 });
    expect(chart().dataset.cursor).toBe("ns-resize");
    fireEvent.mouseMove(chart(), { clientX: 100, clientY: 300 });
    expect(chart().dataset.cursor).toBeUndefined();
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: 300, button: 0 });
    fireEvent.mouseUp(window);
    expect(library.chartOptions).toEqual([]);
    expect(edit.onDrop).not.toHaveBeenCalled();
  });

  it("does nothing with the mouse without editing, as on a fly's page", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={[STOP]} />);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230) });
    expect(library.chartOptions).toEqual([]);
    expect(stopLine()?.price).toBe(231.8);
  });
});
```

In `apps/web/src/chart/TradeCharts.test.tsx`, change `import { resetLibrary } from "./testing.js";` to `import { resetLibrary, seriesOf } from "./testing.js";`, and add inside the file's main `describe`:

```tsx
  it("hands the review's lines and editing to the intraday chart", async () => {
    stub([answer(OK)]);
    const levels = {
      lines: [{ id: "stop" as const, price: 229, color: "#ef5350", dashed: true, label: "STOP" }],
      editing: { placing: "target" as const, onPlace: vi.fn(), onDrag: vi.fn(), onDrop: vi.fn(), onCancel: vi.fn() },
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TradeCharts trade={TRADE} levels={levels} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("intraday-chart");
    expect(seriesOf("Candlestick")[0]?.priceLines).toEqual([expect.objectContaining({ price: 229, title: "STOP" })]);
    expect(screen.getByTestId("placing-hint").textContent).toContain("place the target");
  });
```

(If the file has no top-level `describe`, add the test inside a new `describe("TradeCharts with the review", …)`.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/chart`
Expected: FAIL. There's no `./drag.js` and no `yOf`, and the chart takes no `editing`.

- [ ] **Step 3: Implement the pure pieces and the fake**

Create `apps/web/src/chart/drag.ts`:

```ts
import { round2 } from "@tj/core";

/** The two lines a scalp's review draws and drags (scalp-review spec §8). */
export type LevelKind = "stop" | "target";

/** How near, in pixels, a press must land to grab a line (spec §8.3). */
export const GRAB_PX = 6;

/** What the intraday chart reports while the user places or drags the review's lines. */
export interface ChartEditing {
  /** The line the next click on the chart places, if any. */
  placing: LevelKind | null;
  /** A click placed a line here: save it. */
  onPlace(kind: LevelKind, price: number): void;
  /** A dragged line is here now. Nothing is saved yet. */
  onDrag(kind: LevelKind, price: number): void;
  /** The drag ended here: save it. */
  onDrop(kind: LevelKind, price: number): void;
  /** Esc: stop placing, or a dragged line went back. */
  onCancel(): void;
}

/** The line within reach of `y`, the closer one when both are. `toY` answers null for a price off the scale. */
export function nearestLine(
  lines: readonly { id: LevelKind; price: number }[],
  y: number,
  toY: (price: number) => number | null,
): LevelKind | null {
  let best: { id: LevelKind; distance: number } | null = null;
  for (const line of lines) {
    const at = toY(line.price);
    if (at == null) continue;
    const distance = Math.abs(at - y);
    if (distance <= GRAB_PX && (!best || distance < best.distance)) best = { id: line.id, distance };
  }
  return best?.id ?? null;
}

/** The price at height `y`, to the cent. Null off the scale, or at or below zero. */
export function priceAt(y: number, toPrice: (y: number) => number | null): number | null {
  const price = toPrice(y);
  return price == null || !Number.isFinite(price) || price <= 0 ? null : round2(price);
}

/** Whether a point on the chart is on the plot rather than an axis. */
export const inPane = (x: number, y: number, pane: { width: number; height: number }) =>
  x >= 0 && y >= 0 && x < pane.width && y < pane.height;
```

Replace `apps/web/src/chart/testing.ts` with:

```ts
import type * as Charts from "lightweight-charts";

/** What a chart asked of one series. */
export interface FakeSeries {
  type: string;
  options: Record<string, unknown>;
  data: unknown[];
  applied: Record<string, unknown>[];
  /** The price lines it holds now, each as its current options. */
  priceLines: Record<string, unknown>[];
}

/** The fake's plot: 800 × 400 px, with 240 at the top and 220 at the bottom, so 0.05 a pixel. */
export const PANE = { width: 800, height: 400, high: 240, low: 220 };
/** The height a price sits at on the fake's scale. */
export const yOf = (price: number) => ((PANE.high - price) / (PANE.high - PANE.low)) * PANE.height;
const priceOf = (y: number) => PANE.high - (y / PANE.height) * (PANE.high - PANE.low);

/** The canvas can't draw in jsdom. This records what the components ask of Lightweight Charts instead. */
export const library = {
  charts: 0,
  removed: 0,
  series: [] as FakeSeries[],
  ranges: [] as unknown[],
  markers: [] as unknown[][],
  crosshair: null as ((param: { time?: unknown }) => void) | null,
  /** Every chart.applyOptions call, in order. */
  chartOptions: [] as Record<string, unknown>[],
};

export function resetLibrary(): void {
  library.charts = 0;
  library.removed = 0;
  library.series = [];
  library.ranges = [];
  library.markers = [];
  library.crosshair = null;
  library.chartOptions = [];
}

/** The real module with `createChart` and `createSeriesMarkers` replaced by recorders. */
export function fakeLibrary(real: typeof Charts): typeof Charts {
  const createChart = () => {
    library.charts++;
    return {
      addSeries: (definition: { type?: string }, options: Record<string, unknown> = {}) => {
        const series: FakeSeries = {
          type: definition.type ?? "?",
          options,
          data: [],
          applied: [],
          priceLines: [],
        };
        library.series.push(series);
        return {
          setData: (data: unknown[]) => {
            series.data = data;
          },
          applyOptions: (applied: Record<string, unknown>) => {
            series.applied.push(applied);
          },
          priceToCoordinate: (price: number) => yOf(price),
          coordinateToPrice: (y: number) => priceOf(y),
          createPriceLine: (line: Record<string, unknown>) => {
            const record = { ...line };
            series.priceLines.push(record);
            return {
              record,
              applyOptions: (next: Record<string, unknown>) => {
                Object.assign(record, next);
              },
            };
          },
          removePriceLine: (handle: { record: Record<string, unknown> }) => {
            series.priceLines = series.priceLines.filter((each) => each !== handle.record);
          },
        };
      },
      applyOptions: (options: Record<string, unknown>) => {
        library.chartOptions.push(options);
      },
      paneSize: () => ({ width: PANE.width, height: PANE.height }),
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({
        setVisibleLogicalRange: (range: unknown) => {
          library.ranges.push(range);
        },
      }),
      subscribeCrosshairMove: (handler: (param: { time?: unknown }) => void) => {
        library.crosshair = handler;
      },
      unsubscribeCrosshairMove: () => {},
      remove: () => {
        library.removed++;
      },
    };
  };
  const createSeriesMarkers = () => ({
    setMarkers: (markers: unknown[]) => {
      library.markers.push(markers);
    },
  });
  return {
    ...real,
    createChart: createChart as unknown as typeof real.createChart,
    createSeriesMarkers: createSeriesMarkers as unknown as typeof real.createSeriesMarkers,
  };
}

/** The series of one kind, in the order the chart added them. */
export const seriesOf = (type: string): FakeSeries[] =>
  library.series.filter((series) => series.type === type);
```

- [ ] **Step 4: Implement the chart's editing**

In `apps/web/src/chart/IntradayChart.tsx`:

Add the import:

```ts
import { type ChartEditing, inPane, type LevelKind, nearestLine, priceAt } from "./drag.js";
```

Replace the `PriceLine` interface with:

```ts
/** An extra horizontal line, such as the scalp review's stop or target. A line with an `id` can be dragged. */
export interface PriceLine {
  id?: LevelKind;
  price: number;
  color: string;
  dashed: boolean;
  label: string;
}
```

After the `Parts` interface, add:

```ts
/** A line being dragged: where it started, and where it is now (scalp-review spec §8.3). */
interface Drag {
  kind: LevelKind;
  line: IPriceLine;
  from: number;
  price: number;
}
```

Change the component's signature to take `editing`:

```tsx
export function IntradayChart({
  model,
  show,
  fitKey,
  lines = NO_LINES,
  editing,
  height = 420,
}: {
  model: IntradayModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  lines?: readonly PriceLine[];
  /** The scalp review's placing and dragging; without it the mouse only pans and zooms. */
  editing?: ChartEditing;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const times = useRef<number[]>([]);
  // The mouse handlers are attached once, so they read the latest lines and editing from here.
  const current = useRef({ lines, editing });
  const [hovered, setHovered] = useState<number | null>(null);
  const [grab, setGrab] = useState(false);

  useEffect(() => {
    current.current = { lines, editing };
  });
```

In the chart-building effect, replace

```ts
    parts.current = { chart, candles, volume, emas, vwap, levels, markers, priceLines: [] };
    return () => {
      chart.remove();
      parts.current = null;
    };
  }, []);
```

with:

```ts
    parts.current = { chart, candles, volume, emas, vwap, levels, markers, priceLines: [] };

    // Placing and dragging the review's lines (scalp-review spec §8.2–8.3). Lightweight Charts listens to mouse
    // events, so a press on a line is caught on its way down (capture) and kept from the chart, and the drag
    // follows the window, so it goes on outside the chart.
    let drag: Drag | null = null;
    const toY = (price: number) => candles.priceToCoordinate(price);
    const toPrice = (y: number) => candles.coordinateToPrice(y);
    function pointOf(event: MouseEvent) {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    }
    function grabbable() {
      return current.current.lines.flatMap((each) => (each.id ? [{ id: each.id, price: each.price }] : []));
    }
    function follow(event: MouseEvent) {
      if (!drag) return;
      const price = priceAt(pointOf(event).y, toPrice);
      if (price == null) return;
      drag.price = price;
      drag.line.applyOptions({ price });
      current.current.editing?.onDrag(drag.kind, price);
    }
    function release() {
      finish(true);
    }
    function finish(save: boolean) {
      const done = drag;
      if (!done) return;
      drag = null;
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", release);
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (save && done.price !== done.from) {
        current.current.editing?.onDrop(done.kind, done.price);
        return;
      }
      done.line.applyOptions({ price: done.from });
      if (!save) current.current.editing?.onCancel();
    }
    function press(event: MouseEvent) {
      const edit = current.current.editing;
      if (!edit || event.button !== 0) return;
      const { x, y } = pointOf(event);
      if (!inPane(x, y, chart.paneSize())) return;
      if (edit.placing) {
        const price = priceAt(y, toPrice);
        if (price == null) return;
        event.preventDefault();
        event.stopPropagation();
        edit.onPlace(edit.placing, price);
        return;
      }
      const kind = nearestLine(grabbable(), y, toY);
      const index = current.current.lines.findIndex((each) => each.id === kind);
      const line = parts.current?.priceLines[index];
      const from = current.current.lines[index]?.price;
      if (!kind || !line || from === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      chart.applyOptions({ handleScroll: false, handleScale: false });
      drag = { kind, line, from, price: from };
      window.addEventListener("mousemove", follow);
      window.addEventListener("mouseup", release);
    }
    function hover(event: MouseEvent) {
      if (drag) return;
      const { x, y } = pointOf(event);
      const over =
        current.current.editing != null &&
        inPane(x, y, chart.paneSize()) &&
        nearestLine(grabbable(), y, toY) != null;
      setGrab(over);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (drag) finish(false);
      else if (current.current.editing?.placing) current.current.editing.onCancel();
    }
    element.addEventListener("mousedown", press, true);
    element.addEventListener("mousemove", hover);
    window.addEventListener("keydown", escape);

    return () => {
      element.removeEventListener("mousedown", press, true);
      element.removeEventListener("mousemove", hover);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", release);
      chart.remove();
      parts.current = null;
    };
  }, []);
```

In the component's returned JSX, replace

```tsx
      <div ref={container} className="absolute inset-0" data-testid="intraday-chart" />
```

with:

```tsx
      <div
        ref={container}
        className="absolute inset-0"
        data-testid="intraday-chart"
        data-cursor={editing?.placing ? "crosshair" : grab ? "ns-resize" : undefined}
      />
      {editing?.placing && (
        <div
          data-testid="placing-hint"
          className="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2 rounded-sm border border-line bg-[#131722e6] px-2 py-0.5 text-[10px] text-fg"
        >
          Click the chart to place the {editing.placing} · Esc to cancel
        </div>
      )}
```

Append to `apps/web/src/theme.css`:

```css
/* The scalp review's lines (scalp-review spec §8): the cursor says what a press on the chart will do. Lightweight
   Charts sets a cursor on its own canvases, so this has to win over it. */
[data-cursor="ns-resize"],
[data-cursor="ns-resize"] * {
  /* biome-ignore lint/complexity/noImportantStyles: Lightweight Charts sets an inline cursor on its canvases */
  cursor: ns-resize !important;
}

[data-cursor="crosshair"],
[data-cursor="crosshair"] * {
  /* biome-ignore lint/complexity/noImportantStyles: Lightweight Charts sets an inline cursor on its canvases */
  cursor: crosshair !important;
}
```

In `apps/web/src/chart/TradeCharts.tsx`:
- Add `import type { ChartEditing } from "./drag.js";`, and change `import { IntradayChart } from "./IntradayChart.js";` to `import { IntradayChart, type PriceLine } from "./IntradayChart.js";`.
- Give the props a `levels` field, beside `trade`:

```tsx
export function TradeCharts({
  trade,
  levels,
}: {
  trade: {
    underlying: string;
    openedAt: number;
    closedAt: number | null;
    fills?: readonly ChartFill[];
    legs: ChartTrade["legs"];
  };
  /** A scalp's stop and target, and what placing and dragging them does (scalp-review spec §8). */
  levels?: { lines: readonly PriceLine[]; editing: ChartEditing };
}) {
```

- Change `<IntradayChart model={intraday} show={prefs.show} fitKey={fitKey} />` to:

```tsx
        <IntradayChart
          model={intraday}
          show={prefs.show}
          fitKey={fitKey}
          lines={levels?.lines}
          editing={levels?.editing}
        />
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web/src/chart`
Expected: PASS, the existing chart tests included. The "draws extra lines" test still sees plain option records in `priceLines`.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/chart apps/web/src/theme.css
git commit -m "feat(web): place the stop and target on the intraday chart, and drag them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The review panel: setup, tags, grade, notes and Done reviewing

**Files:**
- Create: `apps/web/src/review/data.ts`
- Create: `apps/web/src/review/Pickers.tsx`
- Create: `apps/web/src/review/ReviewPanel.tsx`, `apps/web/src/review/ReviewPanel.test.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`

**Interfaces:**
- Consumes: `GRADES` (`@tj/core`); `api`, `refusal`, `TradeView`, `TradeDetailView` (`../api.js`); the server's `review`, `reviewedAt` and `?includeArchived=true` (Tasks 3 and 4).
- Produces:

```ts
// review/data.ts
type Setup;  type Tag;            // list items from GET /api/setups and /api/tags (with tradeCount)
type TradePatchBody;              // the JSON PATCH /api/trades/:id takes
function useSetups(): UseQueryResult<Setup[]>;   // key ["setups"], archived included
function useTags(): UseQueryResult<Tag[]>;       // key ["tags"], archived included
function useSaveTrade(tradeId: string): UseMutationResult<…, Error, TradePatchBody>;
  // shows grade, setupId, tagIds, notes and excluded at once in ["trade", id]; puts them back on a refusal;
  // afterwards refetches ["trade", id] and ["trades"]
function useCreateSetup(): UseMutationResult<Setup-row, Error, { name: string; strategy: "scalp" | "iron_fly" | null; description?: string | null }>;
function useCreateTag(): UseMutationResult<Tag-row, Error, { name: string; kind: "mistake" | "emotion" }>;
// review/Pickers.tsx
const INPUT: string;
function NameField(props: { label: string; initial?: string; onSubmit(name: string): Promise<unknown>; onClose(): void }): JSX.Element;
function SetupPicker(props: { trade: TradeView; onPick(setupId: string | null): void }): JSX.Element;
function TagChips(props: { trade: TradeView; kind: "mistake" | "emotion"; onPick(tagIds: string[]): void }): JSX.Element;
// review/ReviewPanel.tsx
function ReviewPanel(props: { trade: TradeView; layout: "strip" | "side"; levels?: ReactNode }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/review/ReviewPanel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { ReviewPanel } from "./ReviewPanel.js";

const SETUPS = [
  { id: "orb", name: "ORB breakout", description: null, strategy: "scalp", archived: false, tradeCount: 3 },
  { id: "vwap", name: "VWAP reclaim", description: null, strategy: null, archived: false, tradeCount: 0 },
  { id: "crush", name: "Earnings IV crush", description: null, strategy: "iron_fly", archived: false, tradeCount: 9 },
  { id: "old", name: "Old ORB", description: null, strategy: "scalp", archived: true, tradeCount: 1 },
];
const TAGS = [
  { id: "fomo", name: "FOMO entry", kind: "mistake", archived: false, tradeCount: 0 },
  { id: "early", name: "Exited early", kind: "mistake", archived: false, tradeCount: 0 },
  { id: "moved", name: "Moved stop", kind: "mistake", archived: true, tradeCount: 2 },
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 0 },
  { id: "rushed", name: "Rushed", kind: "emotion", archived: false, tradeCount: 0 },
];
/** The Sep 28 NVDA scalp, closed and waiting in the queue. */
const SCALP = {
  id: "t1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  notes: null,
  grade: null,
  setupId: null,
  excluded: false,
  reviewedAt: null,
  tagIds: [],
  legs: [],
  ironFly: null,
  scalp: null,
  metrics: null,
  review: { status: "pending", missing: ["setup", "grade", "stop"] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Replies {
  trade?: unknown;
  patch?: (body: Record<string, unknown>) => Response | Promise<Response>;
  created?: (url: string, body: Record<string, unknown>) => Response;
}

/** Answers the trade, the setups and tags, creations (201 unless `created` says otherwise) and patches. */
function stubApi({ trade = SCALP, patch = () => json(trade), created }: Replies = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method === "PATCH") return patch(body);
    if (method === "POST") {
      if (created) return created(url, body);
      return json({ id: url.includes("/api/tags") ? "new-tag" : "new-setup", archived: false, ...body }, 201);
    }
    if (url.includes("/api/setups")) return json(SETUPS);
    if (url.includes("/api/tags")) return json(TAGS);
    return json(trade);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodies = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === method)
    .map((call) => JSON.parse(String(call[1]?.body)));

/** The panel over the trade page's own query, as TradeDetail holds it. */
function Harness({ layout }: { layout: "strip" | "side" }) {
  const { data } = useQuery({
    queryKey: ["trade", "t1"],
    queryFn: async () => (await (await fetch("/api/trades/t1")).json()) as TradeView,
  });
  return data ? <ReviewPanel trade={data} layout={layout} /> : null;
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function renderPanel(layout: "strip" | "side" = "strip", client = newClient()) {
  render(
    <QueryClientProvider client={client}>
      <Harness layout={layout} />
    </QueryClientProvider>,
  );
  return client;
}

const optionNames = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("ReviewPanel", () => {
  it("saves a grade, and clears it when the same grade is pressed again", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, grade: "B" } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "B" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ grade: null }]));
  });

  it("offers this strategy's setups and those for both, with None and + New setup…", async () => {
    const fetchMock = stubApi();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect(optionNames(select)).toEqual(["None", "ORB breakout", "VWAP reclaim", "+ New setup…"]),
    );
    fireEvent.change(select, { target: { value: "vwap" } });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ setupId: "vwap" }]));
  });

  it("keeps an archived setup the trade has, marked as archived", async () => {
    stubApi({ trade: { ...SCALP, setupId: "old" } });
    renderPanel();
    const select = (await screen.findByRole("combobox", { name: "Setup" })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("old"));
    expect(optionNames(select)).toContain("Old ORB (archived)");
  });

  it("creates a setup inline, for this trade's strategy, and picks it", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.change(await screen.findByRole("combobox", { name: "Setup" }), { target: { value: "__new" } });
    const name = screen.getByRole("textbox", { name: "New setup name" });
    fireEvent.change(name, { target: { value: "Gap and go" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ setupId: "new-setup" }]));
    expect(bodies(fetchMock, "POST")).toEqual([{ name: "Gap and go", strategy: "scalp" }]);
  });

  it("shows why a name was refused beside the field, keeping what was typed", async () => {
    stubApi({ created: () => json({ error: "duplicate", message: "A setup with that name exists" }, 409) });
    renderPanel();
    fireEvent.change(await screen.findByRole("combobox", { name: "Setup" }), { target: { value: "__new" } });
    const name = screen.getByRole("textbox", { name: "New setup name" });
    fireEvent.change(name, { target: { value: "orb breakout" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(await screen.findByText("A setup with that name exists")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "New setup name" }) as HTMLInputElement).value).toBe(
      "orb breakout",
    );
  });

  it("adds a mistake to those the trade has", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["early"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "FOMO entry" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["early", "fomo"] }]));
  });

  it("removes a mistake the trade has", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["early", "fomo"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Exited early" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["fomo"] }]));
  });

  it("keeps one emotion: another replaces it, and the mistakes stay", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["calm", "fomo"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Rushed" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["fomo", "rushed"] }]));
  });

  it("builds a second pick on the first while the first is still saving", async () => {
    const fetchMock = stubApi({ patch: () => new Promise<Response>(() => {}) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "FOMO entry" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "FOMO entry" }).getAttribute("aria-pressed")).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Exited early" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH").at(-1)).toEqual({ tagIds: ["fomo", "early"] }));
  });

  it("marks an archived tag the trade has, and lets it be removed", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["moved"] } });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Moved stop (archived)" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: [] }]));
  });

  it("creates a tag inline and applies it, replacing the emotion", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, tagIds: ["calm"] } });
    renderPanel();
    await screen.findByRole("button", { name: "Calm" });
    fireEvent.click(screen.getByRole("button", { name: "Add an emotion tag" }));
    const name = screen.getByRole("textbox", { name: "New emotion tag" });
    fireEvent.change(name, { target: { value: "Bored" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ tagIds: ["new-tag"] }]));
    expect(bodies(fetchMock, "POST")).toEqual([{ name: "Bored", kind: "emotion" }]);
  });

  it("saves the notes when they lose focus, and only when they changed", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, notes: "chased" } });
    renderPanel();
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    fireEvent.blur(notes);
    fireEvent.change(notes, { target: { value: "chased the open" } });
    fireEvent.blur(notes);
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ notes: "chased the open" }]));
  });

  it("saves the exclude flag", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.click(await screen.findByLabelText(/exclude from stats/i));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ excluded: true }]));
  });

  it("offers Done reviewing on a scalp in the queue", async () => {
    const fetchMock = stubApi();
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Done reviewing" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ reviewed: true }]));
  });

  it("puts a scalp marked done back in the queue", async () => {
    const fetchMock = stubApi({
      trade: { ...SCALP, reviewedAt: 5_000, review: { status: "done", missing: ["setup", "grade", "stop"] } },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Back to queue" }));
    await waitFor(() => expect(bodies(fetchMock, "PATCH")).toEqual([{ reviewed: false }]));
  });

  it("gives a fly its own setups in the side panel, with no Done reviewing", async () => {
    stubApi({ trade: { ...SCALP, strategy: "iron_fly", review: null } });
    renderPanel("side");
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect(optionNames(select)).toEqual(["None", "VWAP reclaim", "Earnings IV crush", "+ New setup…"]),
    );
    expect(screen.queryByRole("button", { name: "Done reviewing" })).toBeNull();
  });

  it("says why a save failed", async () => {
    stubApi({ patch: () => json({ error: "invalid", message: "A trade has at most one emotion" }, 400) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "C" }));
    expect(await screen.findByText("Couldn't save: A trade has at most one emotion")).toBeTruthy();
  });

  it("marks the trade lists stale after a change, so Analytics and the lists refetch", async () => {
    stubApi();
    const client = newClient();
    client.setQueryData(["trades", { all: true }], []);
    renderPanel("strip", client);
    fireEvent.click(await screen.findByRole("button", { name: "B" }));
    await waitFor(() => expect(client.getQueryState(["trades", { all: true }])?.isInvalidated).toBe(true));
  });
});
```

In `apps/web/src/routes/TradeDetail.test.tsx`:
- Below the existing `vi.mock("../chart/TradeCharts.js", …)`, add:

```tsx
// The review has its own tests; here it's a placeholder saying which layout it was given.
vi.mock("../review/ReviewPanel.js", () => ({
  ReviewPanel: ({ layout }: { layout: string }) => <div data-testid="review-panel">{layout}</div>,
}));
```

- Delete three tests that now live in `ReviewPanel.test.tsx`: "patches the grade when a grade button is pressed", "patches the exclude flag", and "marks the trade lists stale after a change, so Analytics and the lists refetch". Then run `grep -n 'name: "B"\|exclude from stats\|"Notes"' apps/web/src/routes/TradeDetail.test.tsx`: it should find nothing left.
- Add inside `describe("TradeDetail", …)`:

```tsx
  it("puts the review beside a fly's legs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    expect((await screen.findByTestId("review-panel")).textContent).toBe("side");
  });
```

- Add inside `describe("TradeDetail for a scalp", …)`:

```tsx
  it("puts the review strip under the charts and above the tiles", async () => {
    stubSynced(nvda);
    renderDetail();
    const review = await screen.findByTestId("review-panel");
    expect(review.textContent).toBe("strip");
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(screen.getByTestId("trade-charts"), review)).toBe(true);
    expect(follows(review, screen.getByTestId("tile-contract"))).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/review apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. There's no `./ReviewPanel.js`, and TradeDetail still draws its own Review panel.

- [ ] **Step 3: Implement the data hooks**

Create `apps/web/src/review/data.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, refusal, type TradeDetailView } from "../api.js";

type SetupsResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.setups.$get>>["json"]>>;
/** A setup as the pickers and the Playbook list it: archived ones included, each with its trade count. */
export type Setup = SetupsResponse[number];
type TagsResponse = Awaited<ReturnType<Awaited<ReturnType<typeof api.api.tags.$get>>["json"]>>;
export type Tag = TagsResponse[number];
/** What PATCH /api/trades/:id takes. */
export type TradePatchBody = Parameters<(typeof api.api.trades)[":id"]["$patch"]>[0]["json"];

/** Every setup, archived ones too: a trade keeps showing an archived setup it has (scalp-review spec §9.1). */
export function useSetups() {
  return useQuery({
    queryKey: ["setups"],
    queryFn: async (): Promise<Setup[]> => {
      const res = await api.api.setups.$get({ query: { includeArchived: "true" } });
      if (!res.ok) throw new Error(`load setups failed: ${res.status}`);
      return res.json();
    },
  });
}

/** Every tag, archived ones too. */
export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<Tag[]> => {
      const res = await api.api.tags.$get({ query: { includeArchived: "true" } });
      if (!res.ok) throw new Error(`load tags failed: ${res.status}`);
      return res.json();
    },
  });
}

/** The review's own fields, shown before the server answers so a second click builds on the first. */
function shownAtOnce(body: TradePatchBody) {
  return {
    ...(body.grade === undefined ? {} : { grade: body.grade }),
    ...(body.setupId === undefined ? {} : { setupId: body.setupId }),
    ...(body.tagIds === undefined ? {} : { tagIds: body.tagIds }),
    ...(body.notes === undefined ? {} : { notes: body.notes }),
    ...(body.excluded === undefined ? {} : { excluded: body.excluded }),
  };
}

/**
 * Saves part of a trade (scalp-review spec §7.3). The review's fields change on the page at once and go back if
 * the server refuses. Afterwards the trade, the lists and the queue refetch, after a refusal too.
 */
export function useSaveTrade(tradeId: string) {
  const queryClient = useQueryClient();
  const key = ["trade", tradeId];
  return useMutation({
    mutationFn: async (body: TradePatchBody) => {
      const res = await api.api.trades[":id"].$patch({ param: { id: tradeId }, json: body });
      if (!res.ok) throw await refusal(res, "save");
      return res.json();
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<TradeDetailView>(key);
      if (before) queryClient.setQueryData(key, { ...before, ...shownAtOnce(body) });
      return { before };
    },
    onError: (_error, _body, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]),
  });
}

export function useCreateSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      strategy: "scalp" | "iron_fly" | null;
      description?: string | null;
    }) => {
      const res = await api.api.setups.$post({ json: input });
      if (!res.ok) throw await refusal(res, "create the setup");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setups"] }),
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; kind: "mistake" | "emotion" }) => {
      const res = await api.api.tags.$post({ json: input });
      if (!res.ok) throw await refusal(res, "create the tag");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}
```

- [ ] **Step 4: Implement the pickers and the panel**

Create `apps/web/src/review/Pickers.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { TradeView } from "../api.js";
import { type Tag, useCreateSetup, useCreateTag, useSetups, useTags } from "./data.js";

export const INPUT =
  "rounded-sm border border-line bg-[#0e1118] px-1.5 py-0.5 text-fg outline-none focus:border-accent";
const NEW = "__new";

const chipClass = (on: boolean, archived: boolean) =>
  `rounded-[2px] border px-1.5 py-0.5 text-[11px] ${
    on ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
  } ${archived ? "opacity-50" : ""}`;

/**
 * A name typed inline (scalp-review spec §9.1, §10): Enter submits, Esc gives up. A refusal, such as a name
 * already taken, shows beside it and keeps the text.
 */
export function NameField({
  label,
  initial = "",
  onSubmit,
  onClose,
}: {
  label: string;
  initial?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={field}
        aria-label={label}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key !== "Enter" || !name.trim()) return;
          onSubmit(name.trim()).then(onClose, (error: unknown) =>
            setProblem(error instanceof Error ? error.message : String(error)),
          );
        }}
        className={`w-36 ${INPUT}`}
      />
      {problem && <span className="text-[11px] text-down">{problem}</span>}
    </span>
  );
}

/** The setup (spec §9.1): this strategy's active setups and those for both, None, and + New setup…. */
export function SetupPicker({ trade, onPick }: { trade: TradeView; onPick: (setupId: string | null) => void }) {
  const { data: setups = [] } = useSetups();
  const create = useCreateSetup();
  const [adding, setAdding] = useState(false);
  const strategy = trade.strategy === "iron_fly" ? "iron_fly" : "scalp";
  const offered = setups.filter(
    (setup) => !setup.archived && (setup.strategy == null || setup.strategy === strategy),
  );
  // The trade's own setup stays shown when it's archived, or for the other strategy.
  const current = setups.find((setup) => setup.id === trade.setupId);
  const kept = current && !offered.includes(current) ? current : null;
  if (adding) {
    return (
      <NameField
        label="New setup name"
        onClose={() => setAdding(false)}
        onSubmit={async (name) => {
          onPick((await create.mutateAsync({ name, strategy })).id);
        }}
      />
    );
  }
  return (
    <select
      aria-label="Setup"
      value={trade.setupId ?? ""}
      onChange={(event) => {
        if (event.target.value === NEW) setAdding(true);
        else onPick(event.target.value || null);
      }}
      className={INPUT}
    >
      <option value="">None</option>
      {kept && (
        <option value={kept.id}>
          {kept.name}
          {kept.archived ? " (archived)" : ""}
        </option>
      )}
      {offered.map((setup) => (
        <option key={setup.id} value={setup.id}>
          {setup.name}
        </option>
      ))}
      <option value={NEW}>+ New setup…</option>
    </select>
  );
}

/** Mistake or emotion chips (spec §9.1). Mistakes toggle freely; an emotion replaces the one the trade had. */
export function TagChips({
  trade,
  kind,
  onPick,
}: {
  trade: TradeView;
  kind: "mistake" | "emotion";
  onPick: (tagIds: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const [adding, setAdding] = useState(false);
  const mine = new Set(trade.tagIds);
  const kindOf = new Map(tags.map((tag) => [tag.id, tag.kind]));
  // An archived tag shows only on a trade that has it, and can only be taken off.
  const shown = tags.filter((tag) => tag.kind === kind && (!tag.archived || mine.has(tag.id)));
  const add = (id: string) =>
    onPick([...trade.tagIds.filter((each) => kind === "mistake" || kindOf.get(each) !== "emotion"), id]);
  const toggle = (tag: Tag) => (mine.has(tag.id) ? onPick(trade.tagIds.filter((id) => id !== tag.id)) : add(tag.id));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <button
          key={tag.id}
          type="button"
          aria-pressed={mine.has(tag.id)}
          onClick={() => toggle(tag)}
          className={chipClass(mine.has(tag.id), tag.archived)}
        >
          {tag.name}
          {tag.archived ? " (archived)" : ""}
        </button>
      ))}
      {adding ? (
        <NameField
          label={`New ${kind} tag`}
          onClose={() => setAdding(false)}
          onSubmit={async (name) => {
            add((await create.mutateAsync({ name, kind })).id);
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={kind === "emotion" ? "Add an emotion tag" : "Add a mistake tag"}
          onClick={() => setAdding(true)}
          className={chipClass(false, false)}
        >
          +
        </button>
      )}
    </span>
  );
}
```

Create `apps/web/src/review/ReviewPanel.tsx`:

```tsx
import { GRADES } from "@tj/core";
import type { ReactNode } from "react";
import type { TradeView } from "../api.js";
import { Panel } from "../components/ui.js";
import { type TradePatchBody, useSaveTrade } from "./data.js";
import { SetupPicker, TagChips } from "./Pickers.js";

const LABEL = "w-16 shrink-0 text-[10px] text-muted uppercase tracking-wider";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

/**
 * The review (scalp-review spec §7.3): a strip under a scalp's charts, or a panel beside a fly's legs. Every
 * change saves at once. `levels` is the scalp's stop and target column, first in the strip.
 */
export function ReviewPanel({
  trade,
  layout,
  levels,
}: {
  trade: TradeView;
  layout: "strip" | "side";
  levels?: ReactNode;
}) {
  const save = useSaveTrade(trade.id);
  const pick = (body: TradePatchBody) => save.mutate(body);

  const setup = (
    <Row label="Setup">
      <SetupPicker trade={trade} onPick={(setupId) => pick({ setupId })} />
    </Row>
  );
  const grade = (
    <Row label="Grade">
      {GRADES.map((each) => (
        <button
          key={each}
          type="button"
          aria-pressed={trade.grade === each}
          onClick={() => pick({ grade: trade.grade === each ? null : each })}
          className={`num w-6 rounded-[2px] border py-0.5 ${
            trade.grade === each ? "border-accent bg-accent text-white" : "border-line text-muted"
          }`}
        >
          {each}
        </button>
      ))}
    </Row>
  );
  const mistakes = (
    <Row label="Mistakes">
      <TagChips trade={trade} kind="mistake" onPick={(tagIds) => pick({ tagIds })} />
    </Row>
  );
  const emotion = (
    <Row label="Emotion">
      <TagChips trade={trade} kind="emotion" onPick={(tagIds) => pick({ tagIds })} />
    </Row>
  );
  const notes = (
    <textarea
      key={trade.id}
      aria-label="Notes"
      placeholder="Notes…"
      defaultValue={trade.notes ?? ""}
      onBlur={(event) => {
        if (event.target.value !== (trade.notes ?? "")) pick({ notes: event.target.value });
      }}
      className="min-h-14 w-full rounded-sm border border-line bg-[#0e1118] p-2 text-fg outline-none focus:border-accent"
    />
  );
  const exclude = (
    <label className="flex items-center gap-2 text-muted">
      <input
        type="checkbox"
        checked={trade.excluded}
        onChange={(event) => pick({ excluded: event.target.checked })}
      />
      Exclude from stats
    </label>
  );
  const problem = save.error && <p className="mt-2 text-down">Couldn't save: {save.error.message}</p>;

  if (layout === "side") {
    return (
      <Panel title="Review">
        <div className="flex flex-col gap-1.5">
          {setup}
          {grade}
          {mistakes}
          {emotion}
          {notes}
          {exclude}
        </div>
        {problem}
      </Panel>
    );
  }
  return (
    <Panel title="Review">
      <div className="grid gap-3 min-[900px]:grid-cols-[auto_1fr_1fr]">
        {levels}
        <div className="flex flex-col gap-1.5">
          {setup}
          {grade}
          {emotion}
        </div>
        <div className="flex flex-col gap-1.5">
          {mistakes}
          {notes}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 border-line border-t pt-2">
        {exclude}
        {trade.review && (
          <button
            type="button"
            onClick={() => pick({ reviewed: trade.reviewedAt == null })}
            className="ml-auto rounded-sm border border-line px-2 py-0.5 text-fg hover:border-accent"
          >
            {trade.reviewedAt == null ? "Done reviewing" : "Back to queue"}
          </button>
        )}
      </div>
      {problem}
    </Panel>
  );
}
```

- [ ] **Step 5: Put the panel on the trade page**

In `apps/web/src/routes/TradeDetail.tsx`:
- Change the first import to `import { useQuery } from "@tanstack/react-query";`.
- Add `import { ReviewPanel } from "../review/ReviewPanel.js";`.
- Delete `const GRADES = ["A", "B", "C", "D", "F"] as const;`.
- Delete `const queryClient = useQueryClient();` and the whole `const patch = useMutation({ … });` block. The panel saves for itself now.
- Replace `<TradeCharts trade={trade} />` with:

```tsx
      <TradeCharts trade={trade} />
      {trade.strategy === "scalp" && <ReviewPanel trade={trade} layout="strip" />}
```

- Replace the opening `<div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">` of the Legs row with:

```tsx
      <div className={`grid gap-3 ${trade.strategy === "iron_fly" ? "lg:grid-cols-[1.35fr_1fr]" : ""}`}>
```

- Replace the whole `<Panel title="Review">…</Panel>` block in that row with:

```tsx
        {trade.strategy === "iron_fly" && <ReviewPanel trade={trade} layout="side" />}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 7: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/review apps/web/src/routes/TradeDetail.tsx apps/web/src/routes/TradeDetail.test.tsx
git commit -m "feat(web): review a trade: setup, mistakes, an emotion, a grade, notes and Done reviewing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The stop and target: fields, the chart, and the scalp's workspace

**Files:**
- Create: `apps/web/src/review/levels.ts`, `apps/web/src/review/levels.test.ts`
- Create: `apps/web/src/review/LevelFields.tsx`
- Create: `apps/web/src/review/ScalpWorkspace.tsx`, `apps/web/src/review/ScalpWorkspace.test.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`

**Interfaces:**
- Consumes:
  - `ChartEditing`, `LevelKind` (`chart/drag.js`, Task 6); `PriceLine` (`chart/IntradayChart.js`, Task 6); `TradeCharts`' `levels` prop (Task 6);
  - `useDefaultBasis` (`review/prefs.js`, Task 5);
  - `useSaveTrade`, `ReviewPanel` with its `levels` slot, and `INPUT` (Task 7).
- Produces:

```ts
// review/levels.ts
function parsePrice(text: string, basis: LevelBasis): number | string;   // a price, or why it's refused
interface Levels {
  basis: LevelBasis;
  shown: Record<LevelKind, number | null>;   // saved, or where a line on the chart is before it's saved
  saved: Record<LevelKind, number | null>;
  placing: LevelKind | null;
  setPlacing(kind: LevelKind | null): void;
  save(kind: LevelKind, price: number | null): void;
  switchBasis(next: LevelBasis): void;
  error: string | null;
  chart: { lines: readonly PriceLine[]; editing: ChartEditing };
}
function useLevels(trade: TradeView): Levels;
// review/LevelFields.tsx
function LevelFields(props: { levels: Levels }): JSX.Element;
// review/ScalpWorkspace.tsx
function ScalpWorkspace(props: { trade: TradeDetailView }): JSX.Element;   // the charts, then the review strip
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/review/levels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePrice } from "./levels.js";

describe("parsePrice", () => {
  it("reads plain prices, to the cent", () => {
    expect(parsePrice("231.8", "stock")).toBe(231.8);
    expect(parsePrice("231.804", "stock")).toBe(231.8);
    expect(parsePrice(".5", "premium")).toBe(0.5);
    expect(parsePrice("1.", "premium")).toBe(1);
  });

  it("refuses what it can't read", () => {
    for (const typed of ["$231.80", "231,80", "-1", "1e3", "abc", ""]) {
      expect(parsePrice(typed, "stock")).toBe("Enter a price like 231.80");
    }
  });

  it("refuses 0 on stock, and takes it on premium", () => {
    expect(parsePrice("0", "stock")).toBe("A stock price must be above 0");
    expect(parsePrice("0.001", "stock")).toBe("A stock price must be above 0");
    expect(parsePrice("0", "premium")).toBe(0);
  });
});
```

Create `apps/web/src/review/ScalpWorkspace.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeDetailView } from "../api.js";
import type { ChartEditing } from "../chart/drag.js";
import { ScalpWorkspace } from "./ScalpWorkspace.js";

/** Every `lines` array the chart was handed, to see a redraw. */
const drawn = vi.hoisted(() => [] as unknown[]);

// The chart has its own tests; this stand-in shows its lines and can place, drag and drop the stop.
vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: ({ levels }: { levels?: { lines: { label: string; price: number }[]; editing: ChartEditing } }) => {
    drawn.push(levels?.lines);
    return (
      <div data-testid="trade-charts">
        <span data-testid="chart-lines">
          {levels?.lines.map((line) => `${line.label} ${line.price}`).join(", ")}
        </span>
        <span data-testid="chart-placing">{levels?.editing.placing ?? "none"}</span>
        <button type="button" onClick={() => levels?.editing.onPlace("stop", 231.8)}>
          chart: place the stop
        </button>
        <button type="button" onClick={() => levels?.editing.onDrag("stop", 230.9)}>
          chart: drag the stop
        </button>
        <button type="button" onClick={() => levels?.editing.onDrop("stop", 230.5)}>
          chart: drop the stop
        </button>
      </div>
    );
  },
}));

// The rest of the review has its own tests; here the strip shows only the levels column it's given.
vi.mock("./ReviewPanel.js", () => ({
  ReviewPanel: ({ levels }: { levels?: ReactNode }) => <div data-testid="review-panel">{levels}</div>,
}));

const SCALP = {
  id: "t1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  notes: null,
  grade: null,
  setupId: null,
  excluded: false,
  reviewedAt: null,
  tagIds: [],
  legs: [],
  fills: [],
  ironFly: null,
  scalp: null,
  metrics: null,
  review: { status: "pending", missing: ["setup", "grade", "stop"] },
};
const STOCK = { tradeId: "t1", levelBasis: "stock", stopPrice: 231.8, targetPrice: 234.5 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers the trade, an empty queue, and patches. */
function stubApi({ trade = SCALP as unknown, patch = () => json(trade) } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(init?.method).toUpperCase() === "PATCH") return patch();
    return json(String(input).includes("review=pending") ? [] : trade);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patches = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === "PATCH")
    .map((call) => JSON.parse(String(call[1]?.body)));

function Harness() {
  const { data } = useQuery({
    queryKey: ["trade", "t1"],
    queryFn: async () => (await (await fetch("/api/trades/t1")).json()) as TradeDetailView,
  });
  return data ? <ScalpWorkspace trade={data} /> : null;
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const field = (name: "Stop" | "Target") => screen.getByRole("textbox", { name }) as HTMLInputElement;

beforeEach(() => {
  drawn.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ScalpWorkspace levels", () => {
  it("draws a saved stock stop and target, and shows them in the fields", async () => {
    stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("chart-lines").textContent).toBe("STOP 231.8, TARGET 234.5"));
    expect(field("Stop").value).toBe("231.80");
    expect(field("Target").value).toBe("234.50");
  });

  it("+ Stop opens the field and arms the chart, and a click on the chart saves the stop there", async () => {
    const fetchMock = stubApi();
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Stop" }));
    expect(document.activeElement).toBe(field("Stop"));
    expect(screen.getByTestId("chart-placing").textContent).toBe("stop");
    expect(screen.getByText("or click the chart")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "chart: place the stop" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 231.8 } }]));
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
  });

  it("follows a drag in the field, and saves once when it's dropped", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "chart: drag the stop" }));
    await waitFor(() => expect(field("Stop").value).toBe("230.90"));
    expect(patches(fetchMock)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "chart: drop the stop" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 230.5 } }]));
  });

  it("saves a typed price once on Enter, though the field then loses focus", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "231.75" } });
    fireEvent.keyDown(stop, { key: "Enter" });
    fireEvent.blur(stop);
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 231.75 } }]);
  });

  it("refuses a price it can't read, and 0 on stock, sending nothing", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    for (const typed of ["$231.80", "231,80", "-1"]) {
      act(() => stop.focus());
      fireEvent.change(stop, { target: { value: typed } });
      fireEvent.blur(stop);
      expect(screen.getByText("Enter a price like 231.80")).toBeTruthy();
    }
    fireEvent.change(stop, { target: { value: "0" } });
    fireEvent.blur(stop);
    expect(screen.getByText("A stock price must be above 0")).toBeTruthy();
    expect(patches(fetchMock)).toEqual([]);
  });

  it("takes 0 on the premium basis, and draws no premium lines", async () => {
    const premium = { ...STOCK, levelBasis: "premium", stopPrice: 0.8, targetPrice: null };
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: premium } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    expect(screen.getByTestId("chart-lines").textContent).toBe("");
    expect(screen.getByText("Premium levels aren't drawn yet: there's no option chart.")).toBeTruthy();
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "0" } });
    fireEvent.blur(stop);
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "premium", stopPrice: 0 } }]));
  });

  it("puts the saved price back on Esc, and clears a level with ✕", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "230" } });
    fireEvent.keyDown(stop, { key: "Escape" });
    expect(field("Stop").value).toBe("231.80");
    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", targetPrice: null } }]));
  });

  it("asks before switching the basis with levels set, and does nothing if you cancel", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Premium" }));
    expect(confirm).toHaveBeenCalledWith("Switching to premium clears the stop and target.");
    expect(patches(fetchMock)).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "premium" } }]));
  });

  it("starts from the Settings default, and switches at once with nothing set", async () => {
    localStorage.setItem("tj.review", JSON.stringify({ levelBasis: "premium" }));
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = stubApi();
    renderWorkspace();
    expect((await screen.findByRole("button", { name: "Premium" })).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
    // Premium levels are typed: the chart isn't armed.
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Stock" }));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock" } }]));
  });

  it("puts the line back where it's saved when a save is refused, saying why", async () => {
    stubApi({
      trade: { ...SCALP, scalp: STOCK },
      patch: () => json({ error: "invalid", message: "A stock price must be above 0" }, 400),
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "chart: drop the stop" }));
    const before = drawn.at(-1);
    expect(await screen.findByText("Couldn't save: A stock price must be above 0")).toBeTruthy();
    // A fresh array of the saved lines: the chart redraws them where they're saved.
    await waitFor(() => expect(drawn.at(-1)).not.toBe(before));
    expect(drawn.at(-1)).toEqual(before);
    await waitFor(() => expect(field("Stop").value).toBe("231.80"));
  });
});
```

In `apps/web/src/routes/TradeDetail.test.tsx`:
- Below the `ReviewPanel` mock, add:

```tsx
// A scalp's charts and review strip have their own tests; here they're one placeholder.
vi.mock("../review/ScalpWorkspace.js", () => ({
  ScalpWorkspace: ({ trade }: { trade: { underlying: string } }) => (
    <div data-testid="scalp-workspace">{trade.underlying}</div>
  ),
}));
```

- Replace the test "puts the review strip under the charts and above the tiles" (added in Task 7) with:

```tsx
  it("puts a scalp's charts and review strip under the header, above the tiles", async () => {
    stubSynced(nvda);
    renderDetail();
    const workspace = await screen.findByTestId("scalp-workspace");
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(workspace, screen.getByTestId("tile-contract"))).toBe(true);
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/review apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. There's no `./levels.js` or `./ScalpWorkspace.js`.

- [ ] **Step 3: Implement the levels**

Create `apps/web/src/review/levels.ts`:

```ts
import { type LevelBasis, round2 } from "@tj/core";
import { useMemo, useState } from "react";
import type { TradeView } from "../api.js";
import type { ChartEditing, LevelKind } from "../chart/drag.js";
import type { PriceLine } from "../chart/IntradayChart.js";
import { COLORS } from "../chart/style.js";
import { useSaveTrade } from "./data.js";
import { useDefaultBasis } from "./prefs.js";

const KINDS: readonly LevelKind[] = ["stop", "target"];
const LOOK = {
  stop: { color: COLORS.down, label: "STOP" },
  target: { color: COLORS.up, label: "TARGET" },
} as const;

/** A typed price, or why it's refused (scalp-review spec §8.4): digits and a decimal point only; above 0 on stock. */
export function parsePrice(text: string, basis: LevelBasis): number | string {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return "Enter a price like 231.80";
  const price = round2(Number(text));
  if (basis === "stock" && price <= 0) return "A stock price must be above 0";
  return price;
}

export interface Levels {
  basis: LevelBasis;
  /** What each field shows: the saved price, or where a line on the chart is before it's saved. */
  shown: Record<LevelKind, number | null>;
  saved: Record<LevelKind, number | null>;
  /** The line the next click on the chart places. */
  placing: LevelKind | null;
  setPlacing(kind: LevelKind | null): void;
  save(kind: LevelKind, price: number | null): void;
  switchBasis(next: LevelBasis): void;
  error: string | null;
  /** For the intraday chart: the stock-basis lines, and what placing and dragging them does. */
  chart: { lines: readonly PriceLine[]; editing: ChartEditing };
}

/** A scalp's stop and target (scalp-review spec §8), shared by its fields and the intraday chart. */
export function useLevels(trade: TradeView): Levels {
  const [defaultBasis] = useDefaultBasis();
  const mutation = useSaveTrade(trade.id);
  const [placing, setPlacing] = useState<LevelKind | null>(null);
  // A line the chart moved or placed, until its save is settled.
  const [moved, setMoved] = useState<{ kind: LevelKind; price: number } | null>(null);
  // Bumped after a refused save, so the chart redraws its lines where they're saved (spec §12).
  const [redraw, setRedraw] = useState(0);
  const basis = trade.scalp?.levelBasis ?? defaultBasis;
  const stop = trade.scalp?.stopPrice ?? null;
  const target = trade.scalp?.targetPrice ?? null;

  const write = (body: { levelBasis?: LevelBasis; stopPrice?: number | null; targetPrice?: number | null }) =>
    mutation.mutate(
      // The basis goes with every write, because the first one creates the row (spec §6.2).
      { scalp: { levelBasis: basis, ...body } },
      { onError: () => setRedraw((count) => count + 1), onSettled: () => setMoved(null) },
    );
  const save = (kind: LevelKind, price: number | null) =>
    write(kind === "stop" ? { stopPrice: price } : { targetPrice: price });

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw asks for a fresh array after a refused save
  const lines = useMemo<PriceLine[]>(
    () =>
      basis !== "stock"
        ? []
        : KINDS.flatMap((kind) => {
            const price = kind === "stop" ? stop : target;
            return price == null ? [] : [{ id: kind, price, dashed: true, ...LOOK[kind] }];
          }),
    [basis, stop, target, redraw],
  );

  return {
    basis,
    saved: { stop, target },
    shown: {
      stop: moved?.kind === "stop" ? moved.price : stop,
      target: moved?.kind === "target" ? moved.price : target,
    },
    placing,
    setPlacing,
    save,
    switchBasis: (next) => {
      setPlacing(null);
      write({ levelBasis: next });
    },
    error: mutation.error?.message ?? null,
    chart: {
      lines,
      editing: {
        // Premium levels are typed: there's no option chart to place them on.
        placing: basis === "stock" ? placing : null,
        onPlace: (kind, price) => {
          setPlacing(null);
          setMoved({ kind, price });
          save(kind, price);
        },
        onDrag: (kind, price) => setMoved({ kind, price }),
        onDrop: (kind, price) => {
          setMoved({ kind, price });
          save(kind, price);
        },
        onCancel: () => {
          setPlacing(null);
          setMoved(null);
        },
      },
    },
  };
}
```

Create `apps/web/src/review/LevelFields.tsx`:

```tsx
import { LEVEL_BASES, type LevelBasis } from "@tj/core";
import { useEffect, useRef, useState } from "react";
import type { LevelKind } from "../chart/drag.js";
import { type Levels, parsePrice } from "./levels.js";
import { INPUT } from "./Pickers.js";

const NAMES = { stop: "Stop", target: "Target" } as const;
const TONES = { stop: "text-down", target: "text-up" } as const;
const BASIS_NAMES: Record<LevelBasis, string> = { stock: "Stock", premium: "Premium" };
const LABEL = "w-16 shrink-0 text-[10px] uppercase tracking-wider";

/** The review strip's stop and target column (scalp-review spec §7.3, §8). */
export function LevelFields({ levels }: { levels: Levels }) {
  const switchTo = (next: LevelBasis) => {
    if (next === levels.basis) return;
    const set = levels.saved.stop != null || levels.saved.target != null;
    if (set && !window.confirm(`Switching to ${next} clears the stop and target.`)) return;
    levels.switchBasis(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className={`${LABEL} text-muted`}>Levels on</span>
        {LEVEL_BASES.map((basis) => (
          <button
            key={basis}
            type="button"
            aria-pressed={levels.basis === basis}
            onClick={() => switchTo(basis)}
            className={`rounded-[2px] border px-1.5 py-0.5 text-[11px] ${
              levels.basis === basis ? "border-accent bg-accent text-white" : "border-line text-muted hover:text-fg"
            }`}
          >
            {BASIS_NAMES[basis]}
          </button>
        ))}
      </div>
      <LevelRow kind="stop" levels={levels} />
      <LevelRow kind="target" levels={levels} />
      {levels.basis === "premium" && (
        <p className="max-w-60 text-[10px] text-muted">Premium levels aren't drawn yet: there's no option chart.</p>
      )}
      {levels.error && <p className="text-[11px] text-down">Couldn't save: {levels.error}</p>}
    </div>
  );
}

/** One level: + Stop until there is one, then a field that saves on Enter or when it loses focus (spec §8.4). */
function LevelRow({ kind, levels }: { kind: LevelKind; levels: Levels }) {
  const value = levels.shown[kind];
  // The text being typed; null shows the level itself, which follows a drag on the chart.
  const [text, setText] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const escaped = useRef(false);
  const armed = levels.placing === kind;

  useEffect(() => {
    if (opened) field.current?.focus();
  }, [opened]);
  // Placing ended, by a click on the chart or Esc: a field left empty closes.
  useEffect(() => {
    if (armed) return;
    setText((typed) => (typed === "" ? null : typed));
    setOpened(false);
  }, [armed]);

  const close = () => {
    setText(null);
    setProblem(null);
    setOpened(false);
    if (levels.placing === kind) levels.setPlacing(null);
  };
  // Enter and Esc only blur the field, so a save happens here, once.
  const finish = () => {
    const typed = text?.trim() ?? null;
    if (escaped.current || typed === null || typed === "") {
      escaped.current = false;
      close();
      return;
    }
    const price = parsePrice(typed, levels.basis);
    if (typeof price === "string") {
      setProblem(price);
      return;
    }
    close();
    if (price !== levels.saved[kind]) levels.save(kind, price);
  };

  const label = <span className={`${LABEL} ${TONES[kind]}`}>{NAMES[kind]}</span>;
  if (value == null && text === null && !opened) {
    return (
      <div className="flex items-center gap-1">
        {label}
        <button
          type="button"
          onClick={() => {
            setOpened(true);
            setText("");
            if (levels.basis === "stock") levels.setPlacing(kind);
          }}
          className="rounded-sm border border-line border-dashed px-2 py-0.5 text-muted hover:text-fg"
        >
          + {NAMES[kind]}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label}
      <input
        ref={field}
        aria-label={NAMES[kind]}
        inputMode="decimal"
        value={text ?? (value == null ? "" : value.toFixed(2))}
        onFocus={() => setText((typed) => typed ?? (value == null ? "" : value.toFixed(2)))}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") field.current?.blur();
          if (event.key === "Escape") {
            escaped.current = true;
            field.current?.blur();
          }
        }}
        onBlur={finish}
        className={`num w-20 ${INPUT}`}
      />
      {value != null && text === null && (
        <button
          type="button"
          aria-label={`Clear ${kind}`}
          onClick={() => levels.save(kind, null)}
          className="text-muted hover:text-down"
        >
          ✕
        </button>
      )}
      {armed && <span className="text-[10px] text-muted">or click the chart</span>}
      {problem && <span className="w-full text-[11px] text-down">{problem}</span>}
    </div>
  );
}
```

Create `apps/web/src/review/ScalpWorkspace.tsx`:

```tsx
import type { TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";
import { ReviewPanel } from "./ReviewPanel.js";

/** A scalp's charts and its review strip (scalp-review spec §7.1), sharing the stop and target. */
export function ScalpWorkspace({ trade }: { trade: TradeDetailView }) {
  const levels = useLevels(trade);
  return (
    <>
      <TradeCharts trade={trade} levels={levels.chart} />
      <ReviewPanel trade={trade} layout="strip" levels={<LevelFields levels={levels} />} />
    </>
  );
}
```

In `apps/web/src/routes/TradeDetail.tsx`, add `import { ScalpWorkspace } from "../review/ScalpWorkspace.js";`, and replace

```tsx
      <TradeCharts trade={trade} />
      {trade.strategy === "scalp" && <ReviewPanel trade={trade} layout="strip" />}
```

with:

```tsx
      {trade.strategy === "scalp" ? <ScalpWorkspace trade={trade} /> : <TradeCharts trade={trade} />}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/review apps/web/src/routes/TradeDetail.tsx apps/web/src/routes/TradeDetail.test.tsx
git commit -m "feat(web): a scalp's stop and target, typed or placed and dragged on the chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The queue bar and Next on the trade page

**Files:**
- Modify: `apps/web/src/review/data.ts` (add `usePendingReviews`)
- Create: `apps/web/src/review/QueueBar.tsx`, `apps/web/src/review/QueueBar.test.tsx`
- Modify: `apps/web/src/review/ScalpWorkspace.tsx`, `apps/web/src/review/ScalpWorkspace.test.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`, `apps/web/src/routes/TradeDetail.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `queueNav` and `needsText` (Task 5); `GET /api/trades?strategy=scalp&review=pending` (Task 3).
- Produces:

```ts
// review/data.ts
function usePendingReviews(): UseQueryResult<TradeView[]>;   // key ["trades", { review: "pending" }], oldest first
// review/QueueBar.tsx
function QueueBar(props: { trade: TradeView; onOpenTrade?: (id: string) => void }): JSX.Element | null;
// ScalpWorkspace and TradeDetail gain `onOpenTrade?: (id: string) => void`
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/review/QueueBar.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { QueueBar } from "./QueueBar.js";

const at = (minute: number) => Date.UTC(2026, 8, 28, 13, 30 + minute);
const scalp = (id: string, minute: number, review: unknown = { status: "pending", missing: ["stop"] }) =>
  ({ id, openedAt: at(minute), review }) as unknown as TradeView;
const PENDING = [scalp("a", 1), scalp("b", 5), scalp("c", 9)];

function renderBar(trade: TradeView, pending: TradeView[] = PENDING) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(pending), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onOpenTrade = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
  return { fetchMock, onOpenTrade };
}

afterEach(() => vi.unstubAllGlobals());

describe("QueueBar", () => {
  it("shows a pending scalp's place and what it needs, with the way on both sides", async () => {
    const { fetchMock, onOpenTrade } = renderBar(scalp("b", 5, { status: "pending", missing: ["setup", "stop"] }));
    const bar = await screen.findByTestId("queue-bar");
    await waitFor(() => expect(bar.textContent).toContain("2 of 3"));
    expect(bar.textContent).toContain("TO REVIEW");
    expect(bar.textContent).toContain("needs a setup and a stop");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
    expect(onOpenTrade.mock.calls).toEqual([["c"], ["a"]]);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("strategy=scalp");
    expect(url).toContain("review=pending");
  });

  it("wraps from the newest scalp to the oldest", async () => {
    const { onOpenTrade } = renderBar(scalp("c", 9));
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("a");
  });

  it("says a reviewed scalp is done and how many are left, even before the list has caught up", async () => {
    const { onOpenTrade } = renderBar(scalp("b", 5, { status: "done", missing: [] }));
    const bar = await screen.findByTestId("queue-bar");
    expect(bar.textContent).toContain("REVIEWED ✓");
    expect(bar.textContent).toContain("2 left");
    expect(bar.textContent).not.toContain(" of ");
    expect(screen.queryByRole("button", { name: "← Prev" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("c");
  });

  it("counts the scalps waiting from one the queue doesn't apply to", async () => {
    const { onOpenTrade } = renderBar(scalp("x", 3, null));
    const bar = await screen.findByTestId("queue-bar");
    expect(bar.textContent).toContain("3 to review");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("b");
  });

  it("shows a lone pending scalp as 1 of 1, with no way on", async () => {
    renderBar(scalp("a", 1), [scalp("a", 1)]);
    const bar = await screen.findByTestId("queue-bar");
    await waitFor(() => expect(bar.textContent).toContain("1 of 1"));
    expect(screen.queryByRole("button", { name: "Next →" })).toBeNull();
  });

  it("shows nothing on a reviewed scalp when nothing else waits", async () => {
    const { fetchMock } = renderBar(scalp("a", 1, { status: "done", missing: [] }), []);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("queue-bar")).toBeNull();
  });
});
```

Append to `describe("ScalpWorkspace levels", …)` in `apps/web/src/review/ScalpWorkspace.test.tsx`:

```tsx
  it("puts the queue bar above the charts", async () => {
    stubApi();
    renderWorkspace();
    const bar = await screen.findByTestId("queue-bar");
    expect(bar.compareDocumentPosition(screen.getByTestId("trade-charts")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.textContent).toContain("1 of 1");
  });
```

In `apps/web/src/routes/TradeDetail.test.tsx`:
- Replace the `ScalpWorkspace` mock with one that can ask for the next trade:

```tsx
// A scalp's charts and review strip have their own tests; here they're one placeholder that can ask for Next.
vi.mock("../review/ScalpWorkspace.js", () => ({
  ScalpWorkspace: ({ trade, onOpenTrade }: { trade: { underlying: string }; onOpenTrade?: (id: string) => void }) => (
    <div data-testid="scalp-workspace">
      {trade.underlying}
      <button type="button" onClick={() => onOpenTrade?.("t2")}>
        workspace: next
      </button>
    </div>
  ),
}));
```

- Change `renderDetail` so a test can pass `onOpenTrade`:

```tsx
function renderDetail(onOpenTrade?: (id: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TradeDetail tradeId="t1" onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
}
```

- Add inside `describe("TradeDetail for a scalp", …)`:

```tsx
  it("opens the trade the queue bar asks for", async () => {
    stubSynced(nvda);
    const onOpenTrade = vi.fn();
    renderDetail(onOpenTrade);
    fireEvent.click(await screen.findByRole("button", { name: "workspace: next" }));
    expect(onOpenTrade).toHaveBeenCalledWith("t2");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/review apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. There's no `./QueueBar.js`, and TradeDetail takes no `onOpenTrade`.

- [ ] **Step 3: Implement**

In `apps/web/src/review/data.ts`, add `type TradeView` to the `../api.js` import, and append:

```ts
/**
 * The To review queue (scalp-review spec §6.2): pending scalps, oldest first. The nav badge, the Scalps tab, the
 * Dashboard and the queue bar share this one query, and every trade save refetches it.
 */
export function usePendingReviews() {
  return useQuery({
    queryKey: ["trades", { review: "pending" }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({ query: { strategy: "scalp", review: "pending" } });
      if (!res.ok) throw new Error(`load the queue failed: ${res.status}`);
      return res.json();
    },
  });
}
```

Create `apps/web/src/review/QueueBar.tsx`:

```tsx
import type { TradeView } from "../api.js";
import { usePendingReviews } from "./data.js";
import { queueNav } from "./queue.js";
import { needsText } from "./text.js";

const BUTTON = "rounded-sm border border-line bg-panel px-2 py-0.5 text-fg hover:border-accent";

/** Where this scalp stands in the To review queue, and the way to the next one (scalp-review spec §7.2). */
export function QueueBar({ trade, onOpenTrade }: { trade: TradeView; onOpenTrade?: (id: string) => void }) {
  const { data: pending = [] } = usePendingReviews();
  const status = trade.review?.status ?? null;
  const nav = queueNav(pending, trade, status === "pending");
  if (status !== "pending" && nav.left === 0) return null;
  const go = (id: string | null) => {
    if (id) onOpenTrade?.(id);
  };
  return (
    <div
      data-testid="queue-bar"
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[#2962ff55] bg-[#2962ff14] px-2 py-1 text-[11px]"
    >
      {status === "pending" ? (
        <>
          <b className="text-[#82a8ff]">TO REVIEW</b>
          <span className="num">
            {nav.position} of {nav.total}
          </span>
          <span className="text-muted">{needsText(trade.review?.missing ?? [])}</span>
        </>
      ) : status === "done" ? (
        <>
          <b className="text-up">REVIEWED ✓</b>
          <span className="num text-muted">{nav.left} left</span>
        </>
      ) : (
        <span className="num text-muted">{nav.left} to review</span>
      )}
      <span className="ml-auto flex gap-1">
        {status === "pending" && nav.prev && (
          <button type="button" onClick={() => go(nav.prev)} className={BUTTON}>
            ← Prev
          </button>
        )}
        {nav.next && (
          <button type="button" onClick={() => go(nav.next)} className={BUTTON}>
            Next →
          </button>
        )}
      </span>
    </div>
  );
}
```

Replace `apps/web/src/review/ScalpWorkspace.tsx` with:

```tsx
import type { TradeDetailView } from "../api.js";
import { TradeCharts } from "../chart/TradeCharts.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";
import { QueueBar } from "./QueueBar.js";
import { ReviewPanel } from "./ReviewPanel.js";

/** A scalp's queue bar, charts and review strip (scalp-review spec §7.1), sharing the stop and target. */
export function ScalpWorkspace({
  trade,
  onOpenTrade,
}: {
  trade: TradeDetailView;
  onOpenTrade?: (id: string) => void;
}) {
  const levels = useLevels(trade);
  return (
    <>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
      <TradeCharts trade={trade} levels={levels.chart} />
      <ReviewPanel trade={trade} layout="strip" levels={<LevelFields levels={levels} />} />
    </>
  );
}
```

In `apps/web/src/routes/TradeDetail.tsx`:
- Add `onOpenTrade` to the props:

```tsx
export function TradeDetail({
  tradeId,
  onEdit,
  onSettle,
  onOpenTrade,
}: {
  tradeId: string;
  onEdit?: (id: string) => void;
  onSettle?: (id: string) => void;
  /** Opens another trade: the queue bar's Next and Prev. */
  onOpenTrade?: (id: string) => void;
}) {
```

- Change `<ScalpWorkspace trade={trade} />` to `<ScalpWorkspace trade={trade} onOpenTrade={onOpenTrade} />`.

In `apps/web/src/router.tsx`, change the trade page's component so Next opens the next trade fresh:

```tsx
  component: function TradeDetailRoute() {
    const { id } = tradeDetailRoute.useParams();
    // Keyed by id: Next opens the next scalp with fresh fields, not the last one's typing.
    return <TradeDetail key={id} tradeId={id} onEdit={editTrade} onSettle={settleTrade} onOpenTrade={openTrade} />;
  },
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src/review apps/web/src/routes/TradeDetail.tsx apps/web/src/routes/TradeDetail.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): the queue bar on a scalp's page, with Next and Prev through the scalps to review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The queue in the lists: the nav badge, the Scalps tabs, the grid's Setup column, and the Dashboard

**Files:**
- Modify: `apps/web/src/components/ui.tsx` (gains `TabButton`), `apps/web/src/routes/Analytics.tsx` (imports it from there)
- Modify: `apps/web/src/components/Shell.tsx`, `apps/web/src/components/Shell.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/routes/Journal.tsx`, `apps/web/src/routes/Journal.test.tsx`
- Modify: `apps/web/src/routes/Scalps.tsx`, `apps/web/src/routes/Scalps.test.tsx`
- Modify: `apps/web/src/routes/Dashboard.tsx`, `apps/web/src/routes/Dashboard.test.tsx`
- Modify: `apps/web/src/analytics/testing.tsx` (`stubTrades` answers the queue)

**Interfaces:**
- Consumes: `usePendingReviews`, `useSetups` (Tasks 7 and 9); `contractText`, `missingList` (Task 5).
- Produces:
  - `Shell` takes `toReview?: number`.
  - `JournalFilter` takes `review?: "pending"`, and `Journal` takes `emptyText?: string`.
  - `TabButton` is exported from `components/ui.tsx`.
  - `stubTrades(trades, pending = [])`.

- [ ] **Step 1: Write the failing tests**

Append to `describe("Shell", …)` in `apps/web/src/components/Shell.test.tsx`:

```tsx
  it("counts the scalps waiting for review beside Scalps", () => {
    const { rerender } = render(
      <Shell activePath="/" toReview={5}>
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByLabelText("5 to review").textContent).toBe("5");
    rerender(
      <Shell activePath="/">
        <p>content</p>
      </Shell>,
    );
    expect(screen.queryByLabelText(/to review/)).toBeNull();
  });
```

In `apps/web/src/routes/Journal.test.tsx`:
- Add `setups?: unknown[];` to `StubbedApi`.
- Change the `stubApi` signature to `function stubApi({ trades = [trade], quotes = {}, optionQuotes = {}, marketOn = true, setups = [] }: StubbedApi = {})`.
- Inside it, before `if (!url.includes("/api/quotes")) return jsonResponse(trades);`, add `if (url.includes("/api/setups")) return jsonResponse(setups);`.
- Append inside `describe("Journal", …)`:

```tsx
  it("names each trade's setup, and dots the scalps waiting for review", async () => {
    stubApi({
      trades: [{ ...trade, setupId: "orb", review: { status: "pending", missing: ["stop"] } }],
      setups: [{ id: "orb", name: "ORB breakout" }],
    });
    renderJournal();
    const row = await screen.findByTestId("row-t1");
    await waitFor(() => expect(row.textContent).toContain("ORB breakout"));
    expect(within(row).getByText("Waiting for review")).toBeTruthy();
  });
```

Replace `apps/web/src/routes/Scalps.test.tsx`'s `setup` function and its tests with:

```tsx
/** Answers the scalps, the scalps waiting (`pending`), and an empty setup list. */
function setup(onNewScalp?: () => void, pending: unknown[] = [scalp]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/setups") ? [] : url.includes("review=pending") ? pending : [scalp];
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Scalps onNewScalp={onNewScalp} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Scalps", () => {
  it("asks for scalps only, and lists them under its own title", async () => {
    const fetchMock = setup();
    expect(await screen.findByText("NVDA")).toBeTruthy();
    expect(screen.getByText("Scalps")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("strategy=scalp"))).toBe(true);
    expect(screen.queryByRole("button", { name: "+ New scalp" })).toBeNull();
  });

  it("opens the scalp form from + New scalp", async () => {
    const onNewScalp = vi.fn();
    setup(onNewScalp);
    fireEvent.click(await screen.findByRole("button", { name: "+ New scalp" }));
    expect(onNewScalp).toHaveBeenCalled();
  });

  it("counts the scalps to review, and lists them on their own tab", async () => {
    const fetchMock = setup();
    fireEvent.click(await screen.findByRole("button", { name: "To review (1)" }));
    expect(await screen.findByText("To review")).toBeTruthy();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]).includes("review=pending") && String(call[0]).includes("strategy=scalp"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("NVDA")).toBeTruthy();
  });

  it("says so when nothing waits", async () => {
    setup(undefined, []);
    fireEvent.click(await screen.findByRole("button", { name: "To review (0)" }));
    expect(await screen.findByText("Nothing to review.")).toBeTruthy();
  });
});
```

Also change the Scalps test's testing-library import to `import { fireEvent, render, screen, waitFor } from "@testing-library/react";`.

In `apps/web/src/analytics/testing.tsx`, replace `stubTrades` with:

```ts
/** Answers the trade list with `trades`, the review queue with `pending`, and option quotes with none (a key is set up). */
export function stubTrades(trades: unknown[], pending: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/option-quotes")
      ? { quotes: {}, available: true }
      : url.includes("review=pending")
        ? pending
        : trades;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
```

Append inside `describe("Dashboard", …)` in `apps/web/src/routes/Dashboard.test.tsx`:

```tsx
  it("lists the oldest scalps waiting for review, with what each lacks, and starts on the first", async () => {
    const scalps = Array.from({ length: 6 }, (_, index) => ({
      ...tradeRow({
        id: `s${index}`,
        underlying: "NVDA",
        opened: `2026-09-28 09:3${index}`,
        closed: `2026-09-28 09:4${index}`,
        netPnl: 10 + index,
        strategy: "scalp",
      }),
      review: { status: "pending", missing: ["setup", "stop"] },
    }));
    stubTrades(TRADES, scalps);
    const onOpenTrade = vi.fn();
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} onOpenTrade={onOpenTrade} />);
    const section = await screen.findByRole("region", { name: "To review · 6" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]?.textContent).toContain("NVDA 10C");
    expect(rows[0]?.textContent).toContain("setup, stop");
    fireEvent.click(within(section).getByRole("button", { name: "Start reviewing →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("s0");
  });

  it("shows no To review section when nothing waits", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(screen.queryByRole("region", { name: /To review/ })).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/components apps/web/src/routes`
Expected: FAIL. There's no badge, no Setup column, no tabs, and no To review section.

- [ ] **Step 3: Move `TabButton` into the UI kit**

Cut the `TabButton` function from `apps/web/src/routes/Analytics.tsx` and paste it at the end of `apps/web/src/components/ui.tsx`, unchanged and still exported. In `Analytics.tsx`, import it: add `TabButton` to its `../components/ui.js` import, or add `import { TabButton } from "../components/ui.js";` if it has none. Then run `grep -rn "TabButton" apps/web/src` and point any other importer at `../components/ui.js`. The Scalps page can then use it without pulling the lazily loaded Analytics page into the main bundle.

- [ ] **Step 4: Implement the badge, the grid, the tabs and the Dashboard section**

In `apps/web/src/components/Shell.tsx`, add `toReview` to the props:

```tsx
export function Shell({
  activePath,
  syncing = false,
  toReview = 0,
  children,
}: {
  activePath: string;
  syncing?: boolean;
  /** Scalps waiting in the To review queue (scalp-review spec §9.2). */
  toReview?: number;
  children: ReactNode;
}) {
```

and inside the nav link, after the `/import` spinner, add:

```tsx
                {item.path === "/scalps" && toReview > 0 && (
                  <span
                    aria-label={`${toReview} to review`}
                    className="num ml-1.5 rounded-[2px] bg-accent px-1 text-[10px] text-white"
                  >
                    {toReview}
                  </span>
                )}
```

In `apps/web/src/router.tsx`, add `import { usePendingReviews } from "./review/data.js";`, and in `RootLayout`:

```tsx
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useAutoSync();
  const syncing = useIbkrSyncing();
  const toReview = usePendingReviews().data?.length ?? 0;
  return (
    <Shell activePath={pathname} syncing={syncing} toReview={toReview}>
      <Outlet />
    </Shell>
  );
}
```

In `apps/web/src/routes/Journal.tsx`:
- Add `import { useSetups } from "../review/data.js";`.
- Add to `JournalFilter`:

```ts
  /** Only the scalps waiting for review, oldest first (scalp-review spec §9.3). */
  review?: "pending";
```

- In `useTrades`, add `review: filter.review,` to the query object.
- Add to `JournalProps`: `/** What an empty list says. */ emptyText?: string;`, and take `emptyText` in `Journal`'s parameters.
- In `Journal`, after the `useTrades` call, add:

```ts
  const { data: setups } = useSetups();
  const setupNames = new Map((setups ?? []).map((setup) => [setup.id, setup.name]));
```

- Replace the empty-state paragraph's text with `{emptyText ?? "No trades yet. Add one from Iron Flies → New trade."}`.
- Add a header cell after `Book`: `<th className="w-36 text-left font-medium">Setup</th>`.
- In the Symbol cell, before `{trade.underlying}`, add:

```tsx
                  {trade.review?.status === "pending" && (
                    <>
                      <span
                        aria-hidden="true"
                        title="To review"
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
                      />
                      <span className="sr-only">Waiting for review</span>
                    </>
                  )}
```

- After the Book cell, add:

```tsx
                <td className="truncate pr-3 text-muted">{setupNames.get(trade.setupId ?? "") ?? "—"}</td>
```

Replace `apps/web/src/routes/Scalps.tsx` with:

```tsx
import { useState } from "react";
import { TabButton } from "../components/ui.js";
import { usePendingReviews } from "../review/data.js";
import { Journal } from "./Journal.js";

/** Every scalp, synced from IBKR or typed in (spec §9.1), and those waiting for review (scalp-review spec §9.3). */
export function Scalps({
  onOpenTrade,
  onNewScalp,
}: {
  onOpenTrade?: (id: string) => void;
  onNewScalp?: () => void;
}) {
  const [tab, setTab] = useState<"all" | "review">("all");
  const waiting = usePendingReviews().data?.length ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Scalps tabs" className="flex gap-4 border-line border-b text-[12px]">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All
        </TabButton>
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          {`To review (${waiting})`}
        </TabButton>
      </nav>
      {tab === "all" ? (
        <Journal
          title="Scalps"
          lockedFilter={{ strategy: "scalp" }}
          onOpenTrade={onOpenTrade}
          actions={
            onNewScalp && (
              <button
                type="button"
                onClick={() => onNewScalp()}
                className="ml-2 rounded-[2px] bg-accent px-2 py-0.5 text-white"
              >
                + New scalp
              </button>
            )
          }
        />
      ) : (
        <Journal
          title="To review"
          lockedFilter={{ strategy: "scalp", review: "pending" }}
          emptyText="Nothing to review."
          onOpenTrade={onOpenTrade}
        />
      )}
    </div>
  );
}
```

In `apps/web/src/routes/Dashboard.tsx`:
- Add the imports:

```ts
import { usePendingReviews } from "../review/data.js";
import { contractText, missingList } from "../review/text.js";
```

- Below `ET_DAY`, add:

```ts
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
```

- In the right-hand column, before `<Section title="Open">`, add `<ToReview onOpenTrade={onOpenTrade} />`.
- Append the component:

```tsx
/** The scalps waiting for review, oldest first (scalp-review spec §9.4). Hidden when none wait. */
function ToReview({ onOpenTrade }: { onOpenTrade?: (id: string) => void }) {
  const { data: pending = [] } = usePendingReviews();
  const first = pending[0];
  if (!first) return null;
  return (
    <Section
      title={`To review · ${pending.length}`}
      right={
        <button
          type="button"
          onClick={() => onOpenTrade?.(first.id)}
          className="text-accent normal-case tracking-normal hover:underline"
        >
          Start reviewing →
        </button>
      }
    >
      <ul aria-label="Scalps to review" className="flex flex-col">
        {pending.slice(0, 5).map((trade) => (
          <li key={trade.id} className="flex items-center gap-3 border-line border-t py-1">
            <span className="num text-muted">{ET_TIME.format(new Date(trade.openedAt))}</span>
            <button type="button" onClick={() => onOpenTrade?.(trade.id)} className="text-fg hover:text-accent">
              {contractText(trade)}
            </button>
            <span className="text-muted">{missingList(trade.review?.missing ?? [])}</span>
            <span className="ml-auto">
              <Money value={trade.netPnl} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, the Analytics, Journal and Dashboard suites included.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): the To review queue in the nav, the Scalps tabs, the grid and the Dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Playbook page

**Files:**
- Modify: `apps/web/src/review/data.ts` (add `useUpdateSetup`, `useUpdateTag`)
- Create: `apps/web/src/routes/Playbook.tsx`, `apps/web/src/routes/Playbook.test.tsx`
- Modify: `apps/web/src/router.tsx` (the route replaces the placeholder)

**Interfaces:**
- Consumes: `useSetups`, `useTags`, `useCreateSetup`, `useCreateTag`, `NameField`, `INPUT` (Task 7); `Section` (`analytics/Section.js`); the setup and tag `PATCH` endpoints (Task 4).
- Produces:

```ts
// review/data.ts
function useUpdateSetup(): UseMutationResult<Setup-row, Error, { id: string; patch: { name?; description?; strategy?; archived? } }>;
function useUpdateTag(): UseMutationResult<Tag-row, Error, { id: string; patch: { name?; archived? } }>;
// routes/Playbook.tsx
function Playbook(): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/Playbook.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Playbook } from "./Playbook.js";

const SETUPS = [
  { id: "orb", name: "ORB breakout", description: "Break of the opening range", strategy: "scalp", archived: false, tradeCount: 3 },
  { id: "crush", name: "Earnings IV crush", description: null, strategy: "iron_fly", archived: false, tradeCount: 12 },
  { id: "old", name: "Old setup", description: null, strategy: null, archived: true, tradeCount: 0 },
];
const TAGS = [
  { id: "fomo", name: "FOMO entry", kind: "mistake", archived: false, tradeCount: 4 },
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 7 },
  { id: "bored", name: "Bored", kind: "emotion", archived: true, tradeCount: 1 },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers the lists; creations and changes succeed, or are refused with `refusal` (409). */
function stubApi(refusal?: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      if (refusal) return json({ error: "duplicate", message: refusal }, 409);
      return json({ id: "new", ...JSON.parse(String(init?.body)) }, method === "POST" ? 201 : 200);
    }
    return json(url.includes("/api/tags") ? TAGS : SETUPS);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === method)
    .map((call) => [String(call[0]), JSON.parse(String(call[1]?.body))]);

function renderPlaybook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Playbook />
    </QueryClientProvider>,
  );
}

const setupsPanel = () => screen.getByRole("region", { name: "Setups" });
const tagsPanel = () => screen.getByRole("region", { name: "Tags" });

afterEach(() => vi.unstubAllGlobals());

describe("Playbook", () => {
  it("lists the setups with their strategy, description and trade count, archived ones on request", async () => {
    stubApi();
    renderPlaybook();
    const orb = await screen.findByTestId("setup-orb");
    expect(orb.textContent).toContain("ORB breakout");
    expect(orb.textContent).toContain("Scalps");
    expect(orb.textContent).toContain("Break of the opening range");
    expect(orb.textContent).toContain("3");
    expect(screen.getByTestId("setup-crush").textContent).toContain("Iron flies");
    expect(screen.queryByTestId("setup-old")).toBeNull();
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    expect(screen.getByTestId("setup-old").textContent).toContain("Both");
  });

  it("adds a setup from + New setup", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(await screen.findByRole("button", { name: "+ New setup" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Setup name" }), { target: { value: "Gap and go" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Strategy" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Setup name" }), { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([
        [expect.stringContaining("/api/setups"), { name: "Gap and go", strategy: null, description: null }],
      ]),
    );
  });

  it("edits a setup inline: Enter saves, Esc gives up", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(within(await screen.findByTestId("setup-orb")).getByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox", { name: "Setup name" }) as HTMLInputElement;
    expect(name.value).toBe("ORB breakout");
    fireEvent.change(name, { target: { value: "Opening range break" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Setup name" })).toBeNull();
    expect(sent(fetchMock, "PATCH")).toEqual([]);
    fireEvent.click(within(screen.getByTestId("setup-orb")).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "First 5 minutes" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Description" }), { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [
          expect.stringContaining("/api/setups/orb"),
          { name: "ORB breakout", strategy: "scalp", description: "First 5 minutes" },
        ],
      ]),
    );
  });

  it("archives and restores a setup", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    fireEvent.click(within(await screen.findByTestId("setup-orb")).getByRole("button", { name: "Archive" }));
    fireEvent.click(within(setupsPanel()).getByLabelText("Show archived"));
    fireEvent.click(within(screen.getByTestId("setup-old")).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [expect.stringContaining("/api/setups/orb"), { archived: true }],
        [expect.stringContaining("/api/setups/old"), { archived: false }],
      ]),
    );
  });

  it("shows why a name was refused beside the row, keeping the draft", async () => {
    stubApi("A setup with that name exists");
    renderPlaybook();
    fireEvent.click(await screen.findByRole("button", { name: "+ New setup" }));
    const name = screen.getByRole("textbox", { name: "Setup name" }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "orb breakout" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(await screen.findByText("A setup with that name exists")).toBeTruthy();
    expect(name.value).toBe("orb breakout");
  });

  it("lists mistakes and emotions side by side, and adds, renames and archives a tag", async () => {
    const fetchMock = stubApi();
    renderPlaybook();
    const mistakes = await screen.findByRole("list", { name: "Mistakes" });
    await waitFor(() => expect(mistakes.textContent).toContain("FOMO entry"));
    expect(mistakes.textContent).toContain("4");
    const emotions = screen.getByRole("list", { name: "Emotions" });
    expect(emotions.textContent).toContain("Calm");
    expect(emotions.textContent).not.toContain("Bored");
    fireEvent.click(within(tagsPanel()).getByLabelText("Show archived"));
    expect(screen.getByRole("list", { name: "Emotions" }).textContent).toContain("Bored");

    fireEvent.click(within(tagsPanel()).getAllByRole("button", { name: "+ New" })[0] as HTMLElement);
    const added = screen.getByRole("textbox", { name: "New mistake tag" });
    fireEvent.change(added, { target: { value: "Chased" } });
    fireEvent.keyDown(added, { key: "Enter" });
    await waitFor(() =>
      expect(sent(fetchMock, "POST")).toEqual([[expect.stringContaining("/api/tags"), { name: "Chased", kind: "mistake" }]]),
    );

    const fomo = within(mistakes).getByText("FOMO entry").closest("li") as HTMLElement;
    fireEvent.click(within(fomo).getByRole("button", { name: "Rename" }));
    const renamed = screen.getByRole("textbox", { name: "Rename FOMO entry" });
    fireEvent.change(renamed, { target: { value: "FOMO" } });
    fireEvent.keyDown(renamed, { key: "Enter" });
    await waitFor(() => expect(sent(fetchMock, "PATCH")).toHaveLength(1));
    fireEvent.click(within(fomo).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH")).toEqual([
        [expect.stringContaining("/api/tags/fomo"), { name: "FOMO" }],
        [expect.stringContaining("/api/tags/fomo"), { archived: true }],
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/Playbook.test.tsx`
Expected: FAIL. There's no `./Playbook.js`.

- [ ] **Step 3: Implement**

Append to `apps/web/src/review/data.ts`:

```ts
type SetupPatch = Parameters<(typeof api.api.setups)[":id"]["$patch"]>[0]["json"];
type TagPatch = Parameters<(typeof api.api.tags)[":id"]["$patch"]>[0]["json"];

export function useUpdateSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SetupPatch }) => {
      const res = await api.api.setups[":id"].$patch({ param: { id }, json: patch });
      if (!res.ok) throw await refusal(res, "save the setup");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setups"] }),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TagPatch }) => {
      const res = await api.api.tags[":id"].$patch({ param: { id }, json: patch });
      if (!res.ok) throw await refusal(res, "save the tag");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
}
```

Create `apps/web/src/routes/Playbook.tsx`:

```tsx
import { Fragment, type KeyboardEvent, useState } from "react";
import { Section } from "../analytics/Section.js";
import {
  useCreateSetup,
  useCreateTag,
  useSetups,
  useTags,
  useUpdateSetup,
  useUpdateTag,
} from "../review/data.js";
import { INPUT, NameField } from "../review/Pickers.js";

type Strategy = "scalp" | "iron_fly" | null;
const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "scalp", label: "Scalps" },
  { value: "iron_fly", label: "Iron flies" },
  { value: null, label: "Both" },
];
const strategyLabel = (value: string | null) => STRATEGIES.find((each) => each.value === value)?.label ?? "Both";
const BUTTON = "rounded-sm border border-line px-2 py-0.5 text-muted hover:border-accent hover:text-fg";
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Draft {
  name: string;
  strategy: Strategy;
  description: string;
}

/** Setups and tags (scalp-review spec §10). The per-setup stat cards come with R. */
export function Playbook() {
  return (
    <div className="flex flex-col gap-3">
      <SetupsPanel />
      <TagsPanel />
    </div>
  );
}

function ShowArchived({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 normal-case tracking-normal">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      Show archived
    </label>
  );
}

function SetupsPanel() {
  const { data: setups = [], isLoading } = useSetups();
  const create = useCreateSetup();
  const update = useUpdateSetup();
  const [showArchived, setShowArchived] = useState(false);
  // The row being edited: a setup's id, "new" for + New setup, or none.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", strategy: "scalp", description: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const shown = setups.filter((setup) => showArchived || !setup.archived);

  const edit = (id: string, from: Draft) => {
    setEditing(id);
    setDraft(from);
    setProblem(null);
  };
  const close = () => {
    setEditing(null);
    setProblem(null);
  };
  const save = () => {
    const input = {
      name: draft.name.trim(),
      strategy: draft.strategy,
      description: draft.description.trim() || null,
    };
    if (!input.name || !editing) return;
    const request =
      editing === "new" ? create.mutateAsync(input) : update.mutateAsync({ id: editing, patch: input });
    request.then(close, (error: unknown) => setProblem(messageOf(error)));
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") close();
  };

  const editor = (
    <tr className="border-line border-t">
      <td className="py-1 pr-2">
        <input
          aria-label="Setup name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          onKeyDown={keys}
          className={`w-full ${INPUT}`}
        />
      </td>
      <td className="pr-2">
        <select
          aria-label="Strategy"
          value={draft.strategy ?? ""}
          onChange={(event) => setDraft({ ...draft, strategy: (event.target.value || null) as Strategy })}
          className={INPUT}
        >
          {STRATEGIES.map((each) => (
            <option key={each.label} value={each.value ?? ""}>
              {each.label}
            </option>
          ))}
        </select>
      </td>
      <td className="pr-2">
        <input
          aria-label="Description"
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          onKeyDown={keys}
          className={`w-full ${INPUT}`}
        />
      </td>
      <td />
      <td className="whitespace-nowrap text-right">
        <button type="button" onClick={save} className={BUTTON}>
          Save
        </button>{" "}
        <button type="button" onClick={close} className={BUTTON}>
          Cancel
        </button>
        {problem && <div className="text-[11px] text-down">{problem}</div>}
      </td>
    </tr>
  );

  return (
    <Section
      title="Setups"
      right={
        <span className="flex items-center gap-3">
          <ShowArchived checked={showArchived} onChange={setShowArchived} />
          <button
            type="button"
            onClick={() => edit("new", { name: "", strategy: "scalp", description: "" })}
            className="rounded-[2px] bg-accent px-2 py-0.5 text-white normal-case tracking-normal"
          >
            + New setup
          </button>
        </span>
      }
    >
      {isLoading && <p className="text-muted">Loading…</p>}
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-[9px] text-muted uppercase tracking-wider">
            <th className="w-48 py-1 text-left font-medium">Name</th>
            <th className="w-28 text-left font-medium">Strategy</th>
            <th className="text-left font-medium">Description</th>
            <th className="w-16 text-right font-medium">Trades</th>
            <th className="w-44" />
          </tr>
        </thead>
        <tbody>
          {shown.map((setup) =>
            editing === setup.id ? (
              <Fragment key={setup.id}>{editor}</Fragment>
            ) : (
              <tr
                key={setup.id}
                data-testid={`setup-${setup.id}`}
                className={`border-line border-t ${setup.archived ? "opacity-50" : ""}`}
              >
                <td className="py-1 text-fg">{setup.name}</td>
                <td className="text-muted">{strategyLabel(setup.strategy)}</td>
                <td className="text-muted">{setup.description ?? ""}</td>
                <td className="num text-right">{setup.tradeCount}</td>
                <td className="whitespace-nowrap text-right">
                  <button
                    type="button"
                    onClick={() =>
                      edit(setup.id, {
                        name: setup.name,
                        strategy: setup.strategy as Strategy,
                        description: setup.description ?? "",
                      })
                    }
                    className={BUTTON}
                  >
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: setup.id, patch: { archived: !setup.archived } })}
                    className={BUTTON}
                  >
                    {setup.archived ? "Restore" : "Archive"}
                  </button>
                </td>
              </tr>
            ),
          )}
          {editing === "new" && editor}
        </tbody>
      </table>
    </Section>
  );
}

function TagsPanel() {
  const [showArchived, setShowArchived] = useState(false);
  return (
    <Section title="Tags" right={<ShowArchived checked={showArchived} onChange={setShowArchived} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <TagList kind="mistake" title="Mistakes" showArchived={showArchived} />
        <TagList kind="emotion" title="Emotions" showArchived={showArchived} />
      </div>
    </Section>
  );
}

function TagList({
  kind,
  title,
  showArchived,
}: {
  kind: "mistake" | "emotion";
  title: string;
  showArchived: boolean;
}) {
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const update = useUpdateTag();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const shown = tags.filter((tag) => tag.kind === kind && (showArchived || !tag.archived));
  return (
    <div>
      <div className="mb-1 text-[10px] text-muted uppercase tracking-wider">{title}</div>
      <ul aria-label={title} className="flex flex-col">
        {shown.map((tag) => (
          <li
            key={tag.id}
            className={`flex items-center gap-2 border-line border-t py-1 ${tag.archived ? "opacity-50" : ""}`}
          >
            {renaming === tag.id ? (
              <NameField
                label={`Rename ${tag.name}`}
                initial={tag.name}
                onClose={() => setRenaming(null)}
                onSubmit={(name) => update.mutateAsync({ id: tag.id, patch: { name } })}
              />
            ) : (
              <span className="text-fg">{tag.name}</span>
            )}
            <span className="num ml-auto text-muted">{tag.tradeCount}</span>
            <button type="button" onClick={() => setRenaming(tag.id)} className={BUTTON}>
              Rename
            </button>
            <button
              type="button"
              onClick={() => update.mutate({ id: tag.id, patch: { archived: !tag.archived } })}
              className={BUTTON}
            >
              {tag.archived ? "Restore" : "Archive"}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1">
        {adding ? (
          <NameField
            label={`New ${kind} tag`}
            onClose={() => setAdding(false)}
            onSubmit={(name) => create.mutateAsync({ name, kind })}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            + New
          </button>
        )}
      </div>
    </div>
  );
}
```

In `apps/web/src/router.tsx`:
- Add `import { Playbook } from "./routes/Playbook.js";`.
- Remove the `/playbook` entry from `PLACEHOLDERS`.
- Add the route:

```tsx
const playbookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playbook",
  component: () => <Playbook />,
});
```

- Add `playbookRoute` to `rootRoute.addChildren([...])`, after `settingsRoute`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): the Playbook page: add, rename, describe and archive setups and tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, and a live and visual check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§6, §8.1, §8.3, §9, §13)
- Modify: `docs/superpowers/specs/2026-09-29-trade-chart-design.md` (§12)
- Modify: `docs/superpowers/specs/2026-09-29-scalp-review-design.md` (status, a live-check note)
- Modify: `README.md`
- Scratchpad only, not committed: `serve-review.mts`, `shots-review.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: the specs and README describe the review, the live results are recorded, and there are screenshots at 1280 and 1024 px.

- [ ] **Step 1: Update the parent spec** (as the scalp-review spec's §14 lists)

In `docs/superpowers/specs/2026-09-22-trading-journal-design.md`:
- **§6, `trades`:** in the review bullet, add `reviewed_at` after `exclude_reason`.
- **§6, `scalp_details`:** replace the "plan" bullet with "plan: `level_basis` (`stock` | `premium`), `stop_price`, `target_price`, built by the scalp review ([2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md)). The risk-model and outcome columns come with R."
- **§6, setups and tags:** add "No colours yet."
- **§8.1, the "Review queue" bullet:** "**Review queue:** built in [2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md). A closed scalp waits in **To review** until it has a setup, a grade and a stop, or until the user clicks **Done reviewing**."
- **§8.3:** add the bullet "**A stop on the premium:** a trade's levels can be option prices instead (scalp-review spec §15). Planned risk is then (entry − stop premium) × contracts × multiplier, with no model."
- **§9, the Tagging bullet:** append "Built in the scalp-review spec: edited from the trade page, not inline in the grid. The grid shows the setup. The Playbook page manages setups and tags, and its stat cards come with R."
- **§13, Phase 2, item 3:** "3. The scalp review (stops and targets, setups, tags, grades, the queue and the Playbook page): done, [2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md). Then the Black-Scholes and IV risk engine, R-multiples, MAE/MFE and time-of-day analytics."

- [ ] **Step 2: Update the chart spec, the scalp-review spec and the README**

- In `docs/superpowers/specs/2026-09-29-trade-chart-design.md`, §12, add a first line: "Designed and built in [2026-09-29-scalp-review-design.md](2026-09-29-scalp-review-design.md)."
- In `docs/superpowers/specs/2026-09-29-scalp-review-design.md`, set the **Status** to "Approved; implemented on feat/scalp-review. Plan: [2026-09-29-scalp-review.md](../plans/2026-09-29-scalp-review.md), whose deviations are folded in." Then add the results of Steps 3 and 4 under a new "### Live check (date)" heading at the end of §16.
- In `README.md`, in the Scalps bullet, replace "then a planned stop on the underlying, a Black-Scholes estimate of the dollar risk that stop implies, R-multiples, and a chart of the session on the trade page" with "reviewed on the trade page with the chart: drag the stop and target on the chart (or type them as option premium), pick a setup, mistakes, an emotion and a grade, and work through a To review queue; setups and tags live on the Playbook page. Next: a Black-Scholes estimate of the dollar risk the stop implies, and R-multiples. The chart of the session". Then replace "Scalps, trade charts and IBKR sync arrive in later phases" with "R-multiples, missed trades and an option-premium chart arrive in later steps".

- [ ] **Step 3: Live check over a copy of the real journal**

Build first with `pnpm build`. Then create `serve-review.mts` in the scratchpad. It's the trade chart's stand-in (its plan's Task 9), copying the journal read-only, migrating the copy to 0005, and serving it with the real Alpaca key:

```ts
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { serve } from "/home/kiryu/Projects/TradingJournal/apps/server/node_modules/@hono/node-server/dist/index.mjs";
import { createApp } from "/home/kiryu/Projects/TradingJournal/apps/server/src/app.ts";
import { readSecrets } from "/home/kiryu/Projects/TradingJournal/apps/server/src/config.ts";
import { createMarketData } from "/home/kiryu/Projects/TradingJournal/apps/server/src/marketData.ts";
import { openDatabase, runMigrations } from "/home/kiryu/Projects/TradingJournal/packages/db/src/index.ts";

const require = createRequire("/home/kiryu/Projects/TradingJournal/packages/db/package.json");
const Database = require("better-sqlite3");
const dataDir = join(homedir(), ".local/share/trading-journal");
const copy = join(mkdtempSync(join(process.cwd(), "tj-review-")), "journal.db");
await new Database(join(dataDir, "journal.db"), { readonly: true }).backup(copy);
runMigrations(copy, { migrationsFolder: "/home/kiryu/Projects/TradingJournal/packages/db/migrations" });
serve({
  fetch: createApp({
    db: openDatabase(copy),
    webDir: "/home/kiryu/Projects/TradingJournal/apps/web/dist",
    market: createMarketData(readSecrets(join(dataDir, "secrets.json")).alpaca ?? null),
    settings: { dataDir, secretsFile: join(dataDir, "secrets.json"), checkKeys: async () => "ok" },
  }).fetch,
  port: 4199,
  hostname: "127.0.0.1",
});
console.log(`stand-in on http://localhost:4199 over ${copy}`);
```

Run it in the background from the scratchpad with `/home/kiryu/Projects/TradingJournal/apps/server/node_modules/.bin/tsx serve-review.mts`. Add the Sep 28 NVDA scalp and a second one to the copy:

```bash
for OPEN in 1790602265000 1790604000000; do
  curl -s -X POST -H 'content-type: application/json' -H 'host: localhost' http://localhost:4199/api/trades \
    -d "{\"strategy\":\"scalp\",\"book\":\"paper\",\"underlying\":\"NVDA\",\"structureLabel\":\"Long call\",\"openedAt\":$OPEN,\"closedAt\":$((OPEN + 907000)),\"netPnl\":44.74,\"fees\":2.26,\"legs\":[{\"right\":\"C\",\"strike\":232.5,\"expiry\":\"2026-09-28\",\"quantity\":2,\"multiplier\":100,\"openPrice\":1.06,\"closePrice\":1.295}]}" | head -c 120; echo
done
curl -s -H 'host: localhost' 'http://localhost:4199/api/trades?strategy=scalp&review=pending' | head -c 300; echo
```

Expected: both scalps come back pending, each missing `["setup","grade","stop"]`, oldest first. Note the first `id`.

- [ ] **Step 4: Visual check, with a real drag**

Use the saved recipe: headless Firefox through `puppeteer-core` (symlink an earlier scratchpad's `node_modules`, or `npm i puppeteer-core` in the scratchpad), awaiting `document.fonts.ready`. Create `shots-review.mjs`:

```js
import puppeteer from "puppeteer-core";

const [id] = process.argv.slice(2);
const api = async (path) => (await fetch(`http://localhost:4199${path}`)).json();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: "/usr/bin/firefox", headless: true });
const page = await browser.newPage();

async function open(path, width) {
  await page.setViewport({ width, height: 1100 });
  await page.goto(`http://localhost:4199${path}`);
  await page.evaluate(() => document.fonts.ready);
  await pause(1500);
}

await open(`/trades/${id}`, 1280);
await page.screenshot({ path: "review-1280-pending.png" });

// Place the stop: + Stop, then a click 60% of the way down the chart.
const chart = await page.$('[data-testid="intraday-chart"]');
const box = await chart.boundingBox();
const x = box.x + box.width * 0.4;
const y = box.y + box.height * 0.6;
await page.locator("::-p-text(+ Stop)").click();
await page.mouse.click(x, y);
await pause(800);
const placed = (await api(`/api/trades/${id}`)).scalp?.stopPrice;
console.log("placed stop", placed);

// Drag it 40 px down: a stock stop lower on the chart is a lower price.
await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.move(x, y + 40, { steps: 8 });
await page.mouse.up();
await pause(800);
const dragged = (await api(`/api/trades/${id}`)).scalp?.stopPrice;
console.log("dragged stop", dragged, dragged < placed ? "lower: ok" : "NOT LOWER");
await page.screenshot({ path: "review-1280-stop.png" });

await page.locator("::-p-text(Done reviewing)").click();
await pause(800);
await page.screenshot({ path: "review-1280-done.png" });

for (const [path, name] of [
  ["/scalps", "scalps"],
  ["/", "dashboard"],
  ["/playbook", "playbook"],
]) {
  await open(path, 1280);
  await page.screenshot({ path: `review-1280-${name}.png` });
}
await open(`/trades/${id}`, 1024);
await page.screenshot({ path: "review-1024-trade.png" });
await browser.close();
```

Run `node shots-review.mjs <the first id>`.

Expected:
- "placed stop" prints a price near NVDA's range that morning, and "dragged stop" prints a lower price with "lower: ok".
- The chart didn't pan during the drag: the candles sit where they were in the first screenshot.
- `review-1280-pending.png`:
  - the queue bar reads "TO REVIEW · 1 of 2 · needs a setup, a grade and a stop";
  - the review strip sits under the charts, with Levels, Setup, Grade, Emotion, Mistakes and Notes;
  - the daily chart is beside the intraday chart.
- `review-1280-stop.png` shows the red dashed STOP line with its price on the axis, and the Stop field showing the same price.
- `review-1280-done.png` reads "REVIEWED ✓ · 1 left · Next →", and the button now says "Back to queue".
- The Scalps nav badge reads 1. The Scalps page has the tabs "All" and "To review (1)", and the grid has the Setup column. The Dashboard has "To review · 1". The Playbook lists the seeded setups and tags with their counts.
- At 1024 px, the strip's columns stack, and nothing overlaps or is cut off.

Look at every screenshot. Stop the server with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/superpowers/specs/2026-09-22-trading-journal-design.md docs/superpowers/specs/2026-09-29-trade-chart-design.md docs/superpowers/specs/2026-09-29-scalp-review-design.md README.md
git commit -m "docs: point the parent spec and README at the scalp review, with its live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
