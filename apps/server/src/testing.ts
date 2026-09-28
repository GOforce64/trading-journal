import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { type AppDeps, createApp } from "./app.js";
import type { MarketSources } from "./marketData.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

/** Passes the server's Host check. */
export const LOCAL = { host: "localhost" };

/** Market sources that know nothing, with any of them replaced. */
export function fakeSources(overrides: Partial<MarketSources> = {}): MarketSources {
  return {
    quotes: { latest: async () => new Map() },
    optionQuotes: { latest: async () => new Map() },
    chains: { listed: async () => [] },
    companies: { name: async () => null },
    ...overrides,
  };
}

/** The app on a fresh, migrated database, with whatever else a test needs. */
export function testApp(deps: Omit<AppDeps, "db"> = {}) {
  const file = join(mkdtempSync(join(tmpdir(), "tj-app-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return createApp({ db: openDatabase(file), ...deps });
}
