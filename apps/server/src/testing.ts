import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { type AppDeps, createApp } from "./app.js";
import type { MarketSources } from "./marketData.js";

// Not `new URL(…, import.meta.url)`: under the web tests Vite rewrites that into an asset URL.
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations");

/** Passes the server's Host check. */
export const LOCAL = { host: "localhost" };

/** Market sources that know nothing, with any of them replaced. */
export function fakeSources(overrides: Partial<MarketSources> = {}): MarketSources {
  return {
    quotes: { latest: async () => new Map() },
    optionQuotes: { latest: async () => new Map() },
    chains: { listed: async () => [] },
    companies: { name: async () => null },
    bars: { priceAt: async () => null, closeOn: async () => null },
    history: { minuteBars: async () => [], dailyBars: async () => [] },
    optionHistory: { minuteBars: async () => [] },
    ...overrides,
  };
}

/** A fresh, migrated database. */
export function testDb() {
  const file = join(mkdtempSync(join(tmpdir(), "tj-app-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return openDatabase(file);
}

/** The app on a fresh, migrated database (or the one given), with whatever else a test needs. */
export function testApp(deps: Omit<AppDeps, "db"> & { db?: AppDeps["db"] } = {}) {
  return createApp({ ...deps, db: deps.db ?? testDb() });
}
