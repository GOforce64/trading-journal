import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewTrade } from "@tj/core";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { createTaxonomyRepo } from "./repositories/taxonomy.js";
import { createTradesRepo } from "./repositories/trades.js";

/** Test fixtures for the bundle (export-merge spec §8). */
export const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/** A journal on a fresh, migrated file, with its own clock. */
export function journal(start = 1_000) {
  const file = join(mkdtempSync(join(tmpdir(), "tj-bundle-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  const db = openDatabase(file);
  const clock = { now: start };
  const tick = () => clock.now;
  return { file, db, clock, trades: createTradesRepo(db, tick), taxonomy: createTaxonomyRepo(db, tick) };
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
};
