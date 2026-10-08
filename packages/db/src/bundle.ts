import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/** The bundle's own format version (export-merge spec §3). */
export const BUNDLE_FORMAT = 1;

/** What a bundle carries, parents before children (export-merge spec §2). */
export const BUNDLE_TABLES = [
  "accounts",
  "setups",
  "tags",
  "trades",
  "legs",
  "iron_fly_details",
  "scalp_details",
  "scalp_targets",
  "trade_tags",
  "fills",
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

/** Each table's key columns: a row's identity on every machine. */
export const BUNDLE_KEYS: Record<BundleTable, readonly string[]> = {
  accounts: ["id"],
  setups: ["id"],
  tags: ["id"],
  trades: ["id"],
  legs: ["id"],
  iron_fly_details: ["trade_id"],
  scalp_details: ["trade_id"],
  scalp_targets: ["trade_id", "position"],
  trade_tags: ["trade_id", "tag_id"],
  fills: ["id"],
};

/** The migrations applied to this journal: a bundle's schema version. */
export function schemaVersion(db: Db): number {
  return db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)?.n ?? 0;
}

/** JSON with its keys sorted, so equal content reads the same: the merge's tie-breaker (export-merge spec §2). */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A table's rows as SQLite has them. */
export function readTable(db: Db, table: BundleTable): Row[] {
  return db.$client.prepare(`select * from "${table}"`).all() as Row[];
}

/** Everything the user made or synced, as rows (export-merge spec §3). Tombstones travel too. */
export function exportBundle(
  db: Db,
  { machine, now = Date.now }: { machine: string; now?: () => number },
): Bundle {
  const tables = Object.fromEntries(
    BUNDLE_TABLES.map((table) => [table, readTable(db, table)]),
  ) as Bundle["tables"];
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

/** What a merge did (export-merge spec §4.6). Identical versions count in none of these. */
export interface MergeSummary {
  /** Live trades new to this journal. */
  added: number;
  /** The bundle's different version replaced a live local one. */
  updated: number;
  /** The bundle had a different version, and the local one won. */
  kept: number;
  /** The bundle's tombstone won over a live local trade. */
  deleted: number;
  fillsAdded: number;
  setupsAdded: number;
  tagsAdded: number;
  /** Nothing was written. */
  unchanged: boolean;
}

type Version = (number | string)[];
const stamp = (value: unknown) => (typeof value === "number" ? value : -1);

/** Positive when `a` is the newer version, element by element. */
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

const keyOf = (table: BundleTable, row: Row) =>
  BUNDLE_KEYS[table].map((column) => String(row[column])).join("\u0000");
/** Any row but a trade: its last write, then its content (export-merge spec §2). */
const rowVersion = (row: Row): Version => [stamp(row.updated_at), canonical(row)];

/** The local journal's own columns, which a bundle's rows are read through. */
function columnsOf(db: Db, table: BundleTable): string[] {
  return (db.$client.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

const pick = (row: Row, columns: readonly string[]): Row =>
  Object.fromEntries(
    columns.filter((column) => column in row).map((column) => [column, row[column] ?? null]),
  );

/** Each key resolved across both sides: the newer version wins. A bundle row lacking columns keeps the local ones. */
function resolve(table: BundleTable, local: readonly Row[], remote: readonly Row[]): Map<string, Row> {
  const result = new Map(local.map((row) => [keyOf(table, row), row]));
  for (const row of remote) {
    const key = keyOf(table, row);
    const mine = result.get(key);
    const theirs = mine ? { ...mine, ...row } : row;
    if (!mine || compare(rowVersion(theirs), rowVersion(mine)) > 0) result.set(key, theirs);
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

/** A trade's children: the rest of its aggregate, which moves with it as one (export-merge spec §2). */
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

/** A trade's version (export-merge spec §2): the later of its edit and delete, then its last write, then its content. */
const tradeVersion = (aggregate: Aggregate): Version => [
  Math.max(stamp(aggregate.trade.edited_at), stamp(aggregate.trade.deleted_at)),
  stamp(aggregate.trade.updated_at),
  canonical(aggregate),
];

function upsert(db: Db, table: BundleTable, row: Row): void {
  const columns = Object.keys(row);
  const keys = BUNDLE_KEYS[table];
  const updates = columns.filter((column) => !keys.includes(column));
  const quoted = (column: string) => `"${column}"`;
  const onConflict =
    updates.length === 0
      ? "nothing"
      : `update set ${updates.map((column) => `${quoted(column)} = excluded.${quoted(column)}`).join(", ")}`;
  db.$client
    .prepare(
      `insert into "${table}" (${columns.map(quoted).join(", ")}) values (${columns.map(() => "?").join(", ")})
       on conflict (${keys.map(quoted).join(", ")}) do ${onConflict}`,
    )
    .run(...columns.map((column) => row[column]));
}

function remove(db: Db, table: BundleTable, row: Row): void {
  const keys = BUNDLE_KEYS[table];
  db.$client
    .prepare(`delete from "${table}" where ${keys.map((column) => `"${column}" = ?`).join(" and ")}`)
    .run(...keys.map((column) => row[column]));
}

/**
 * Folds another machine's bundle into this journal (export-merge spec §4): the final state of every row is resolved
 * from both sides at once, so A into B and B into A agree, and only what differs is written, in one transaction.
 * The bundle must already be valid: the server checks its shape and schema first.
 */
export function mergeBundle(db: Db, bundle: Bundle): MergeSummary {
  return db.$client.transaction(() => {
    const columns = Object.fromEntries(BUNDLE_TABLES.map((table) => [table, columnsOf(db, table)])) as Record<
      BundleTable,
      string[]
    >;
    const original = Object.fromEntries(
      BUNDLE_TABLES.map((table) => [table, readTable(db, table)]),
    ) as Record<BundleTable, Row[]>;
    const theirs = Object.fromEntries(
      BUNDLE_TABLES.map((table) => [
        table,
        (bundle.tables[table] ?? []).map((row) => pick(row, columns[table])),
      ]),
    ) as Record<BundleTable, Row[]>;
    const mine = structuredClone(original);

    const accounts = resolve("accounts", mine.accounts, theirs.accounts);
    const setups = collapse(resolve("setups", mine.setups, theirs.setups), (row) =>
      String(row.name).toLowerCase(),
    );
    const tags = collapse(
      resolve("tags", mine.tags, theirs.tags),
      (row) => `${row.kind}\u0000${String(row.name).toLowerCase()}`,
    );
    // Both sides' references move to the kept ids before any trade is compared.
    for (const side of [mine, theirs]) {
      for (const trade of side.trades) {
        if (typeof trade.setup_id === "string")
          trade.setup_id = setups.moved.get(trade.setup_id) ?? trade.setup_id;
      }
      const links = new Map<string, Row>();
      for (const link of side.trade_tags) {
        const moved: Row = { ...link, tag_id: tags.moved.get(String(link.tag_id)) ?? link.tag_id ?? null };
        links.set(keyOf("trade_tags", moved), moved);
      }
      side.trade_tags = [...links.values()];
    }

    const summary: MergeSummary = {
      added: 0,
      updated: 0,
      kept: 0,
      deleted: 0,
      fillsAdded: 0,
      setupsAdded: 0,
      tagsAdded: 0,
      unchanged: true,
    };
    const ours = aggregates(mine);
    const final = new Map(ours);
    const replaced: string[] = [];
    for (const [id, incoming] of aggregates(theirs)) {
      const local = ours.get(id);
      if (!local) {
        final.set(id, incoming);
        if (incoming.trade.deleted_at == null) summary.added++;
        continue;
      }
      const candidate = { ...incoming, trade: { ...local.trade, ...incoming.trade } };
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
