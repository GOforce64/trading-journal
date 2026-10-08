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
