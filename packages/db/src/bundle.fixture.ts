import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewTrade } from "@tj/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { BUNDLE_KEYS, BUNDLE_TABLES, canonical, exportBundle, readTable } from "./bundle.js";
import type { Db } from "./client.js";
import { runMigrations } from "./migrate.js";
import { createTaxonomyRepo } from "./repositories/taxonomy.js";
import { createTradesRepo } from "./repositories/trades.js";
import * as schema from "./schema.js";

/** Test fixtures for the bundle (export-merge spec §8). */
export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * A migrated, empty journal, made once. Each test journal starts as an in-memory copy of it: migrating a file per
 * journal made the property test take 28 s on Windows, long enough to slow its neighbours past their timeouts.
 */
let template: Buffer | null = null;
function migrated(): Buffer {
  if (!template) {
    const file = join(mkdtempSync(join(tmpdir(), "tj-bundle-")), "template.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const raw = new Database(file, { readonly: true });
    template = raw.serialize();
    raw.close();
    // A WAL database's image can't be opened in memory: its header's file-format bytes go back to rollback (1).
    template[18] = 1;
    template[19] = 1;
  }
  return template;
}

/** A journal in memory from a database image, with the app's own pragma and its own clock. */
function fromImage(image: Buffer, start: number) {
  const sqlite = new Database(image);
  sqlite.pragma("foreign_keys = ON");
  const db: Db = drizzle(sqlite, { schema });
  const clock = { now: start };
  const tick = () => clock.now;
  return { db, clock, trades: createTradesRepo(db, tick), taxonomy: createTaxonomyRepo(db, tick) };
}

/** A fresh, migrated journal, with its own clock. */
export function journal(start = 1_000) {
  return fromImage(migrated(), start);
}

/** Another machine's journal that started as a copy of `source`'s, with its own clock from `start`. */
export function copyOf(source: ReturnType<typeof journal>, start: number) {
  return fromImage(source.db.$client.serialize(), start);
}

/** The Sep 28 NVDA 232.5C scalp. */
export const scalp: NewTrade = {
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: "Long call",
  openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
  closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
  netPnl: 44.74,
  fees: 2.26,
  feesOpen: null,
  feesClose: null,
  notes: null,
  grade: null,
  excluded: false,
  excludeReason: null,
  source: "manual",
  setupId: null,
  tagIds: [],
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
  missed: null,
};

/** Every bundle table's rows by key, as canonical JSON: two journals with equal dumps hold the same data. */
export function dump(db: Db): Record<string, string[]> {
  return Object.fromEntries(
    BUNDLE_TABLES.map((table) => [
      table,
      readTable(db, table)
        .map((row) => `${BUNDLE_KEYS[table].map((key) => row[key]).join("|")} ${canonical(row)}`)
        .sort(),
    ]),
  );
}

/** One journal's bundle, as the other machine would receive it. */
export const bundleOf = (db: Db) => exportBundle(db, { machine: "test", now: () => 0 });

/** An IBKR account and a fill on it, written as the sync would. */
export function addFill(
  db: Db,
  fill: { id: string; tradeId: string | null; commission: number; updatedAt: number },
): void {
  db.$client
    .prepare(
      `insert into accounts (id, name, broker, kind, external_id, created_at, updated_at)
       values ('acct', 'IBKR paper', 'ibkr', 'paper', 'DU1', 1, 1) on conflict do nothing`,
    )
    .run();
  db.$client
    .prepare(
      `insert into fills (id, account_id, broker_exec_key, broker_trade_id, conid, underlying, "right", strike, expiry,
         multiplier, trade_date, executed_at, quantity, price, commission, kind, origin, canceled, trade_id, raw,
         created_at, updated_at)
       values (@id, 'acct', @id, 'T1', '1', 'NVDA', 'C', 232.5, '2026-09-28', 100, '2026-09-28', 1, 1, 1.06,
         @commission, 'trade', 'confirm', 0, @tradeId, '{}', 1, @updatedAt)
       on conflict (id) do update set commission = excluded.commission, updated_at = excluded.updated_at`,
    )
    .run(fill);
}
