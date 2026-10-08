# Export and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Data gets **Export journal**, which downloads a `.tjbundle`, and **Merge a bundle…**, which folds another machine's bundle into this journal by the parent spec's §12 rules, with a summary line.

**Architecture:** `packages/db/src/bundle.ts` holds the pure database work: `exportBundle`, `mergeBundle`, `schemaVersion` and `canonical`. It reads and writes raw snake_case rows through `db.$client`, so a bundle is just the tables. The merge resolves the union of both sides symmetrically and writes the difference in one transaction. `apps/server` adds `routes/bundle.ts`, which handles gzip, zod validation, the schema check and a `merge` backup. `apps/web` adds `routes/DataSettings.tsx`.

**Tech Stack:** TypeScript, better-sqlite3 via drizzle's `$client`, Hono, zod, node:zlib, React 19, TanStack Query, Vitest, fast-check.

**Spec:** [docs/superpowers/specs/2026-10-08-export-merge-design.md](../specs/2026-10-08-export-merge-design.md)

## Global Constraints

- Bundle tables, in this order (parents first): `accounts, setups, tags, trades, legs, iron_fly_details, scalp_details, scalp_targets, trade_tags, fills`. Never exported: `scalp_prices`, `bars`, `bar_days`, `sync_state`, and secrets.
- `manifest.format` is 1. `manifest.schema` is the count of `__drizzle_migrations` rows.
- File name: `journal-{machine}-{YYYY-MM-DD-HHmm}.tjbundle`, where `machine` is the hostname, lowercased, with non-alphanumerics becoming `-`.
- A trade's version is `[max(edited_at ?? -1, deleted_at ?? -1), updated_at, canonical(aggregate)]`. Any other row's is `[updated_at, canonical(row)]`.
- Setups match on `lower(name)`, and tags on `kind + lower(name)`. A group keeps its smallest id, with the newest row's fields.
- Copy, word for word:
  - "This isn't a journal bundle."
  - "This bundle comes from a newer version of the journal (schema {n}; this one is {m}). Update this machine first."
  - "Merged {file}: 12 trades added, 3 updated from the bundle, 2 kept as yours, 1 deleted, 140 fills added." (zero counts left out)
  - "Nothing to merge: this journal already has everything in {file}."
  - "Merging…", "Export journal", "Merge a bundle…"
- The body is limited to 100 MB. Merge backups are made with `backupDatabase(dbFile, backupDir, 10, "merge")`.
- Before each commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`, and the changed packages' tests.

## Review Focus

1. **Two machines seeded the same setups with different ids, and both have trades tagged with them.** After merging both ways there's one "ORB" and one "Calm", every trade points at it, and no unique-index error is raised. → Task 2's tests and Task 3's property.
2. **A bundle exported from an older app** (fewer columns, for example no `option_high` in a future table): it merges, keeping local values for the missing columns. → Task 2.
3. **A garbage upload** (an image, a truncated gzip, JSON of the wrong shape) answers 400 and writes nothing, with no backup made. → Task 4.
4. **Merging a bundle into the journal it came from** says "Nothing to merge" and writes nothing. → Tasks 2 and 5.
5. **A merge that loses the local version of a trade still keeps the local fills,** and a merge that takes the bundle's version deletes its `scalp_prices`, so R refetches. → Task 2.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/bundle.ts` (new) | `BUNDLE_TABLES`, `Bundle`, `schemaVersion`, `canonical`, `exportBundle`, `mergeBundle`, `MergeSummary` |
| `packages/db/src/bundle.test.ts` (new) | example tests of export and merge |
| `packages/db/src/bundle.property.test.ts` (new) | fast-check: idempotent, order-independent, nothing lost |
| `packages/db/src/backup.ts` | `BackupReason` gains `"merge"` |
| `packages/db/src/index.ts` | exports bundle.ts |
| `apps/server/src/routes/bundle.ts` (new) | `GET /api/bundle`, `POST /api/bundle/merge`, zod validation |
| `apps/server/src/app.ts`, `index.ts` | `mergeBackup` dep and route wiring |
| `apps/web/src/routes/DataSettings.tsx` (new) | the Data panel: export link, merge upload, summary text |
| `apps/web/src/routes/Settings.tsx` | renders `DataSettings` |

---

### Task 1: db — export and the bundle's types

**Files:** Create `packages/db/src/bundle.ts` and `bundle.test.ts`. Modify `packages/db/src/index.ts` and `backup.ts`.

**Interfaces — Produces:**

```ts
export const BUNDLE_FORMAT = 1;
export const BUNDLE_TABLES: readonly ["accounts", "setups", "tags", "trades", "legs", "iron_fly_details", "scalp_details", "scalp_targets", "trade_tags", "fills"];
export type BundleTable = (typeof BUNDLE_TABLES)[number];
export type Row = Record<string, string | number | null>;
export interface BundleManifest { format: number; schema: number; machine: string; exportedAt: number; counts: Record<string, number> }
export interface Bundle { manifest: BundleManifest; tables: Record<BundleTable, Row[]> }
export const BUNDLE_KEYS: Record<BundleTable, readonly string[]>;
export function schemaVersion(db: Db): number;
export function canonical(value: unknown): string;
export function exportBundle(db: Db, options: { machine: string; now?: () => number }): Bundle;
```

- [ ] **Step 1: Write the failing tests** (`bundle.test.ts`). Use a migrated temp database (as `trades.test.ts` does), plus `createTradesRepo` and `createTaxonomyRepo`.
  - `exportBundle` returns `manifest.format === 1`, the `schema` equal to the migrations folder's entry count (8), the `machine` given, and `exportedAt` from `now`.
  - `counts` match the tables' lengths.
  - `tables` has exactly the ten keys. A created scalp with levels and a tag shows up in `trades`, `legs`, `scalp_details`, `scalp_targets` and `trade_tags`, in snake_case (`opened_at`).
  - A soft-deleted trade is included with its `deleted_at`.
  - `scalp_prices` is not a key.
  - `canonical({ b: 1, a: [2, { d: null, c: "x" }] })` is `{"a":[2,{"c":"x","d":null}],"b":1}`.
- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run packages/db/src/bundle.test.ts`.
- [ ] **Step 3: Implement.**

```ts
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/** The bundle's own format version (export-merge spec §3). */
export const BUNDLE_FORMAT = 1;
/** What a bundle carries, parents before children (export-merge spec §2). */
export const BUNDLE_TABLES = [
  "accounts", "setups", "tags", "trades", "legs",
  "iron_fly_details", "scalp_details", "scalp_targets", "trade_tags", "fills",
] as const;
export type BundleTable = (typeof BUNDLE_TABLES)[number];
/** A database row as SQLite gives it: snake_case columns, booleans as 0 and 1. */
export type Row = Record<string, string | number | null>;
export interface BundleManifest {
  format: number;
  /** The migrations applied to the journal it came from. */
  schema: number;
  machine: string;
  exportedAt: number;
  counts: Record<string, number>;
}
export interface Bundle {
  manifest: BundleManifest;
  tables: Record<BundleTable, Row[]>;
}
/** Each table's key columns: a row's identity across machines. */
export const BUNDLE_KEYS: Record<BundleTable, readonly string[]> = {
  accounts: ["id"], setups: ["id"], tags: ["id"], trades: ["id"], legs: ["id"],
  iron_fly_details: ["trade_id"], scalp_details: ["trade_id"],
  scalp_targets: ["trade_id", "position"], trade_tags: ["trade_id", "tag_id"], fills: ["id"],
};

/** The migrations applied to this journal: a bundle's schema version. */
export function schemaVersion(db: Db): number {
  return db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)?.n ?? 0;
}

/** JSON with its keys sorted, so equal content compares equal: the merge's tie-breaker (export-merge spec §2). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function readTable(db: Db, table: BundleTable): Row[] {
  return db.$client.prepare(`select * from "${table}"`).all() as Row[];
}

/** Everything the user made or synced, as rows (export-merge spec §3). Tombstones travel too. */
export function exportBundle(db: Db, { machine, now = Date.now }: { machine: string; now?: () => number }): Bundle {
  const tables = Object.fromEntries(BUNDLE_TABLES.map((table) => [table, readTable(db, table)])) as Bundle["tables"];
  return {
    manifest: {
      format: BUNDLE_FORMAT,
      schema: schemaVersion(db),
      machine,
      exportedAt: now(),
      counts: Object.fromEntries(BUNDLE_TABLES.map((table) => [table, tables[table].length])),
    },
    tables,
  };
}
```

  Add `"merge"` to `BackupReason`. Export `./bundle.js` from `index.ts`.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit:** `feat(db): export the journal as a bundle of rows`.

---

### Task 2: db — merge

**Files:** Modify `packages/db/src/bundle.ts` and `bundle.test.ts`.

**Interfaces — Produces:**

```ts
export interface MergeSummary {
  added: number; updated: number; kept: number; deleted: number;
  fillsAdded: number; setupsAdded: number; tagsAdded: number;
  /** Nothing was written. */
  unchanged: boolean;
}
export function mergeBundle(db: Db, bundle: Bundle): MergeSummary;
```

- [ ] **Step 1: Write the failing tests.** Make two journals A and B, each a migrated temp file with its own repos and clocks. Put trades on B by merging A's export into it, then edit.
  - **Into an empty journal:** everything arrives. The summary's `added` counts the live trades, and `fillsAdded`, `setupsAdded` and `tagsAdded` count what's new. Seeded setups with the same names collapse onto the smaller ids, and every `setup_id`/`tag_id` points at a kept id.
  - **The same bundle again:** `unchanged: true`, and the dumps are equal.
  - **Edits:**
    - an edit made later on B wins when A's bundle comes in (`kept: 1`), and B's later bundle replaces A's version (`updated: 1`);
    - on a tie in `edited_at`, both sides pick the same version (merge both ways, then compare dumps).
  - **Deletes:**
    - B deletes after A's edit, so B's bundle deletes on A (`deleted: 1`);
    - A edits after B's delete, so the trade comes back on B (`updated: 1`).
  - **Sync-only trades:** the newer `updated_at` wins, and an edited trade beats a newer sync-only one.
  - **Fills:**
    - the union, by id;
    - for the same id, the newer `updated_at` wins (a commission change);
    - a local fill whose trade lost the comparison is kept.
  - **Prices:** the bundle's winning version deletes the local `scalp_prices` row; a local win keeps it.
  - **Setups and tags:**
    - an "ORB" on each side with different ids becomes one, with the smaller id;
    - the newer row's fields win (a rename, `archived`);
    - every trade and `trade_tags` row moves to it;
    - the tag "Calm" behaves the same way, with no unique-index error.
  - **An older bundle:** delete a column from the bundle's trade rows (for example `reviewed_at`). The merge keeps the local value when the bundle wins, and the default when inserting.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** In `bundle.ts`:

```ts
export interface MergeSummary {
  added: number;
  updated: number;
  kept: number;
  deleted: number;
  fillsAdded: number;
  setupsAdded: number;
  tagsAdded: number;
  /** Nothing was written. */
  unchanged: boolean;
}

type Version = [number, ...(number | string)[]];
const stamp = (value: unknown) => (typeof value === "number" ? value : -1);
/** Positive when `a` is the newer version. */
function compare(a: Version, b: Version): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index];
    const y = b[index];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
const keyOf = (table: BundleTable, row: Row) => BUNDLE_KEYS[table].map((column) => String(row[column])).join("\u0000");
const rowVersion = (row: Row): Version => [stamp(row.updated_at), canonical(row)];

/** The local journal's own column names, which a bundle's rows are read through. */
function columnsOf(db: Db, table: BundleTable): string[] {
  return (db.$client.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map((column) => column.name);
}
const pick = (row: Row, columns: readonly string[]): Row =>
  Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column] ?? null]));

/** Each key resolved across both sides by `version`: the newer wins. A bundle row lacking columns keeps the local ones. */
function resolve(
  table: BundleTable,
  local: readonly Row[],
  remote: readonly Row[],
  version: (row: Row) => Version = rowVersion,
): Map<string, Row> {
  const result = new Map(local.map((row) => [keyOf(table, row), row]));
  for (const row of remote) {
    const key = keyOf(table, row);
    const mine = result.get(key);
    const theirs = mine ? { ...mine, ...row } : row;
    if (!mine || compare(version(theirs), version(mine)) > 0) result.set(key, theirs);
  }
  return result;
}

/** Rows that are the same by name collapse onto the smallest id, with the newest row's fields (export-merge spec §2). */
function collapse(rows: Map<string, Row>, nameOf: (row: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const row of rows.values()) {
    const name = nameOf(row);
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  const kept = new Map<string, Row>();
  const moved = new Map<string, string>();
  for (const group of groups.values()) {
    const id = group.map((row) => String(row.id)).sort()[0] ?? "";
    const newest = group.reduce((best, row) => (compare(rowVersion(row), rowVersion(best)) > 0 ? row : best));
    kept.set(id, { ...newest, id });
    for (const row of group) if (row.id !== id) moved.set(String(row.id), id);
  }
  return { kept, moved };
}

const CHILDREN = ["legs", "iron_fly_details", "scalp_details", "scalp_targets", "trade_tags"] as const;
type Child = (typeof CHILDREN)[number];
interface Aggregate {
  trade: Row;
  children: Record<Child, Row[]>;
}

function aggregates(tables: Record<BundleTable, Row[]>): Map<string, Aggregate> {
  const result = new Map<string, Aggregate>();
  for (const trade of tables.trades) {
    result.set(String(trade.id), {
      trade,
      children: { legs: [], iron_fly_details: [], scalp_details: [], scalp_targets: [], trade_tags: [] },
    });
  }
  for (const child of CHILDREN) {
    for (const row of tables[child]) result.get(String(row.trade_id))?.children[child].push(row);
  }
  for (const aggregate of result.values()) {
    for (const child of CHILDREN) {
      aggregate.children[child].sort((a, b) => (keyOf(child, a) < keyOf(child, b) ? -1 : 1));
    }
  }
  return result;
}

/** A trade's version (export-merge spec §2): the later of its edit and delete, then its update, then its content. */
const tradeVersion = (aggregate: Aggregate): Version => [
  Math.max(stamp(aggregate.trade.edited_at), stamp(aggregate.trade.deleted_at)),
  stamp(aggregate.trade.updated_at),
  canonical(aggregate),
];

/**
 * Folds another machine's bundle into this journal (export-merge spec §4): the final state of every row is resolved
 * from both sides at once, so A into B and B into A agree, and only what differs is written, in one transaction.
 */
export function mergeBundle(db: Db, bundle: Bundle): MergeSummary {
  return db.$client.transaction(() => {
    const columns = Object.fromEntries(BUNDLE_TABLES.map((table) => [table, columnsOf(db, table)])) as Record<
      BundleTable,
      string[]
    >;
    const original = Object.fromEntries(BUNDLE_TABLES.map((table) => [table, readTable(db, table)])) as Record<
      BundleTable,
      Row[]
    >;
    const theirs = Object.fromEntries(
      BUNDLE_TABLES.map((table) => [table, (bundle.tables[table] ?? []).map((row) => pick(row, columns[table]))]),
    ) as Record<BundleTable, Row[]>;
    const mine = structuredClone(original);

    const accounts = resolve("accounts", mine.accounts, theirs.accounts);
    const setups = collapse(resolve("setups", mine.setups, theirs.setups), (row) => String(row.name).toLowerCase());
    const tags = collapse(
      resolve("tags", mine.tags, theirs.tags),
      (row) => `${row.kind}\u0000${String(row.name).toLowerCase()}`,
    );
    // Both sides' references move to the kept ids before any trade is compared.
    for (const side of [mine, theirs]) {
      for (const trade of side.trades) {
        if (typeof trade.setup_id === "string") trade.setup_id = setups.moved.get(trade.setup_id) ?? trade.setup_id;
      }
      const links = new Map<string, Row>();
      for (const link of side.trade_tags) {
        const moved = { ...link, tag_id: tags.moved.get(String(link.tag_id)) ?? link.tag_id };
        links.set(keyOf("trade_tags", moved), moved);
      }
      side.trade_tags = [...links.values()];
    }

    const summary: MergeSummary = {
      added: 0, updated: 0, kept: 0, deleted: 0,
      fillsAdded: 0, setupsAdded: 0, tagsAdded: 0, unchanged: true,
    };
    const ours = aggregates(mine);
    const final = new Map(ours);
    const replaced: string[] = [];
    for (const [id, incoming] of aggregates(theirs)) {
      const local = ours.get(id);
      const candidate = local ? { ...incoming, trade: { ...local.trade, ...incoming.trade } } : incoming;
      if (!local) {
        final.set(id, candidate);
        if (candidate.trade.deleted_at == null) summary.added++;
        continue;
      }
      const order = compare(tradeVersion(candidate), tradeVersion(local));
      if (order === 0) continue;
      if (order < 0) {
        summary.kept++;
        continue;
      }
      final.set(id, candidate);
      replaced.push(id);
      if (candidate.trade.deleted_at != null && local.trade.deleted_at == null) summary.deleted++;
      else summary.updated++;
    }
    const fills = resolve("fills", mine.fills, theirs.fills);
    const localFills = new Set(original.fills.map((row) => keyOf("fills", row)));
    summary.fillsAdded = [...fills.keys()].filter((key) => !localFills.has(key)).length;
    const localSetups = new Set(original.setups.map((row) => String(row.id)));
    const localTags = new Set(original.tags.map((row) => String(row.id)));
    summary.setupsAdded = [...setups.kept.keys()].filter((id) => !localSetups.has(id)).length;
    summary.tagsAdded = [...tags.kept.keys()].filter((id) => !localTags.has(id)).length;

    const desired: Record<BundleTable, Map<string, Row>> = {
      accounts,
      setups: setups.kept,
      tags: tags.kept,
      trades: new Map([...final.values()].map((aggregate) => [String(aggregate.trade.id), aggregate.trade])),
      legs: new Map(),
      iron_fly_details: new Map(),
      scalp_details: new Map(),
      scalp_targets: new Map(),
      trade_tags: new Map(),
      fills,
    };
    for (const aggregate of final.values()) {
      for (const child of CHILDREN) {
        for (const row of aggregate.children[child]) desired[child].set(keyOf(child, row), row);
      }
    }

    // Rows that lose their key go first, children before parents: a tag collapsing onto the bundle's id would
    // otherwise meet its old self in the (kind, name) index. References are checked at commit instead.
    db.$client.pragma("defer_foreign_keys = ON");
    let writes = 0;
    for (const table of [...BUNDLE_TABLES].reverse()) {
      for (const row of original[table]) {
        if (desired[table].has(keyOf(table, row))) continue;
        remove(db, table, row);
        writes++;
      }
    }
    for (const table of BUNDLE_TABLES) {
      const before = new Map(original[table].map((row) => [keyOf(table, row), canonical(row)]));
      for (const [key, row] of desired[table]) {
        if (before.get(key) === canonical(row)) continue;
        upsert(db, table, row);
        writes++;
      }
    }
    // The bundle's facts may differ from those the local prices were fetched for.
    for (const id of replaced) {
      writes += db.$client.prepare("delete from scalp_prices where trade_id = ?").run(id).changes;
    }
    summary.unchanged = writes === 0;
    return summary;
  })();
}

function upsert(db: Db, table: BundleTable, row: Row): void {
  const columns = Object.keys(row);
  const keys = BUNDLE_KEYS[table];
  const updates = columns.filter((column) => !keys.includes(column));
  const quoted = (column: string) => `"${column}"`;
  db.$client
    .prepare(
      `insert into "${table}" (${columns.map(quoted).join(", ")}) values (${columns.map(() => "?").join(", ")})
       on conflict (${keys.map(quoted).join(", ")}) do ${
         updates.length === 0
           ? "nothing"
           : `update set ${updates.map((column) => `${quoted(column)} = excluded.${quoted(column)}`).join(", ")}`
       }`,
    )
    .run(...columns.map((column) => row[column]));
}

function remove(db: Db, table: BundleTable, row: Row): void {
  const keys = BUNDLE_KEYS[table];
  db.$client
    .prepare(`delete from "${table}" where ${keys.map((column) => `"${column}" = ?`).join(" and ")}`)
    .run(...keys.map((column) => row[column]));
}
```

  `trade_tags` has a unique index rather than a primary key; `on conflict (trade_id, tag_id)` uses it. If SQLite refuses the conflict target, ledger a ruling and give the table a `delete … insert` path.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run packages/db`.
- [ ] **Step 5: Commit:** `feat(db): merge a bundle by the parent spec's rules, the same both ways`.

---

### Task 3: db — the merge's guarantees, property-tested

**Files:** Create `packages/db/src/bundle.property.test.ts`. Add `fast-check` (^4.10.2) to `@tj/db`'s devDependencies (`pnpm --filter @tj/db add -D fast-check@^4.10.2`).

- [ ] **Step 1: Write the property tests.**
  - **Setup:** a shared base journal, with an account and the seeded setups and tags, is built from `shared` operations. It's copied to A and B (`fs.writeFileSync(file, db.$client.serialize())`, then `openDatabase`). Each copy then runs its own operations with its own clock. A starts at 10,000 and steps by 7; B starts at 10,000 and steps by 11, so ties happen.
  - **Operations:**
    - `create` a scalp;
    - `edit` the n-th live trade: grade, notes, or `scalp: { levelBasis: "stock", stopPrice }`;
    - `delete` the n-th trade;
    - `tag` the n-th trade with one of this side's tags;
    - `setup` (create a setup named "ORB", "VWAP" or "Gap", ignoring `DuplicateNameError`);
    - `fill` (upsert fill `f{k}`, k from 1 to 4, on the account and the n-th trade, with a commission and an `updated_at` from the clock).
  - **The properties,** with `numRuns: 40`:
    - **order-independent:** export A and B, merge B's bundle into A and A's into B, and `dump(A)` equals `dump(B)`. `dump` is every bundle table's rows by key, as canonical JSON;
    - **idempotent:** merging the same bundle into A again returns `unchanged: true` and leaves `dump(A)` as it was;
    - **nothing lost:** every trade id and fill id from either side is in the result, and every setup and tag name.
- [ ] **Step 2: Run it.** It may pass at once, since Task 2 built the behaviour. If it fails, the shrunk counterexample is a bug: debug it and fix `bundle.ts` (systematic-debugging), with the counterexample as an example test.
- [ ] **Step 3: Commit:** `test(db): merging is idempotent and the same both ways, property-tested`.

---

### Task 4: server — the routes

**Files:** Create `apps/server/src/routes/bundle.ts` and `apps/server/src/bundle.test.ts`. Modify `app.ts` (the `mergeBackup?: () => string` dep and the route) and `index.ts` (`mergeBackup: () => backupDatabase(paths.dbFile, paths.backupDir, 10, "merge")`).

**Interfaces — Produces:**
- `GET /api/bundle` answers gzip bytes, with `content-type: application/gzip` and `content-disposition: attachment; filename="journal-{machine}-{stamp}.tjbundle"`.
- `POST /api/bundle/merge` takes the raw body and answers `MergeSummary`. Errors are 400 `{ error: "invalid", message: "This isn't a journal bundle." }`, 409 `{ error: "newer", message }` and 413 for a body over 100 MB.
- `machineName(hostname: string): string` and `bundleFileName(machine: string, at: Date): string` are exported for tests.

- [ ] **Step 1: Write the failing tests.**
  - The export's headers: `bundleFileName("fedora", new Date(2026, 9, 8, 9, 12))` is `journal-fedora-2026-10-08-0912.tjbundle`, and `machineName("DESKTOP-4K2L.local")` is `desktop-4k2l-local`. Gunzipping the body gives a bundle whose trades include one created through the API.
  - A round trip: export from app A, `POST` it to app B. The summary says added, the trade lists on B, and B's `mergeBackup` was called once.
  - Merging it again: `unchanged: true`.
  - A garbage body, a gzip of non-JSON, and a gzip of `{}` each answer 400 "This isn't a journal bundle.", and no backup is made.
  - A bundle whose `manifest.schema` is the app's + 1 answers 409 with the copy from Global Constraints.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** `routes/bundle.ts` with:
  - zod: a `cell` is string, number or null; a `row` is a record of cells;
  - `manifest`: `format` the literal 1, `schema` an integer ≥ 0, `machine` a string, `exportedAt` a number, `counts` a record;
  - `tables`: an object with each `BUNDLE_TABLES` key an array of rows, plus a refine that every key column is present and non-null;
  - `gunzipSync`, with errors caught as 400, then `JSON.parse` the same way;
  - `bodyLimit` from `hono/body-limit` at 100 MB.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/server`.
- [ ] **Step 5: Commit:** `feat(server): export the journal, and merge a bundle after a backup`.

---

### Task 5: web — the Data panel

**Files:** Create `apps/web/src/routes/DataSettings.tsx` and `DataSettings.test.tsx`. Modify `Settings.tsx` to render `<DataSettings dataDir={data?.dataDir} />` in place of its Data panel.

**Interfaces — Produces:** `mergeSummaryText(file: string, summary: MergeSummary): string` and `DataSettings({ dataDir })`.

- [ ] **Step 1: Write the failing tests.**
  - `mergeSummaryText`:
    - all counts: "Merged f.tjbundle: 12 trades added, 3 updated from the bundle, 2 kept as yours, 1 deleted, 140 fills added.";
    - singulars: "1 trade added";
    - zeros left out;
    - `unchanged` gives "Nothing to merge: this journal already has everything in f.tjbundle.";
    - setups and tags added but no trades: "Merged f.tjbundle: 2 setups added, 1 tag added.".
  - The panel:
    - shows the data directory;
    - the Export journal link has `href="/api/bundle"`;
    - choosing a file posts it to `/api/bundle/merge` with the file as the body, shows "Merging…", then the summary line;
    - a 400 or 409 shows the server's message in red;
    - after a merge, the query client's queries are invalidated (spy on `invalidateQueries`).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Use `useMutation` posting with `fetch("/api/bundle/merge", { method: "POST", body: file })`, then `queryClient.invalidateQueries()` on success. Use the Settings page's `Panel` and button look.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/web`.
- [ ] **Step 5: Commit:** `feat(web): Export journal and Merge a bundle in Settings`.

---

### Task 6: docs, the full check, the live check, and the review

- [ ] Point the parent spec's §12 here, and the README's "Known limitations" or features list.
- [ ] Run `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Live check** on a stand-in over a copy of the real journal:
  - time `GET /api/bundle` and record the file size;
  - merge it into a stand-in on an empty scratch journal, and time it;
  - merge it into the copy itself, which should say "Nothing to merge";
  - check the counts against the copy's trades and fills;
  - take a screenshot of the Data panel after a merge.
- [ ] Fold findings into the spec, then commit `docs: the export and merge live check`.
- [ ] Run the final review (superpowers:requesting-code-review) and a fix pass. Push, `gh pr create`, wait for CI, then merge (granted for this run).
