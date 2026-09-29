import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "./index.js";
import { trades } from "./schema.js";

// fileURLToPath, not URL.pathname: the latter yields "/C:/..." on Windows.
const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tj-test-"));
}

describe("runMigrations", () => {
  it("creates the schema in a fresh database", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    expect(db.select().from(trades).all()).toEqual([]);
  });

  it("is safe to run twice", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    expect(() => runMigrations(file, { migrationsFolder: MIGRATIONS })).not.toThrow();
  });

  it("backs up an existing database before migrating", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir });
    expect(readdirSync(backupDir).filter((name) => name.endsWith(".db"))).toHaveLength(1);
  });

  it("does not back up a database that does not exist yet", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    runMigrations(join(dir, "journal.db"), { migrationsFolder: MIGRATIONS, backupDir });
    expect(readdirSync(dir).includes("backups")).toBe(false);
  });

  it("adds the stock price columns to the fly details", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const columns = openDatabase(file).all<{ name: string }>(sql`pragma table_info(iron_fly_details)`);
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["underlying_price_entry", "underlying_price_exit"]),
    );
  });

  it("keeps only the most recent backups", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir });
    for (let index = 0; index < 4; index++) {
      writeFileSync(join(backupDir, `journal-old-${index}.db`), "x");
    }
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir, keepBackups: 2 });
    expect(readdirSync(backupDir).filter((name) => name.endsWith(".db"))).toHaveLength(2);
  });

  it("adds the fills and sync_state tables, and the facts_edited_at column", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("fills")).toEqual(
      expect.arrayContaining([
        "broker_exec_key",
        "broker_trade_id",
        "open_close",
        "kind",
        "origin",
        "canceled",
        "raw",
      ]),
    );
    expect(columns("sync_state")).toEqual(expect.arrayContaining(["source", "account_id", "last_summary"]));
    expect(columns("trades")).toContain("facts_edited_at");
  });

  it("adds the bar cache tables", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("bars")).toEqual(["symbol", "timeframe", "t", "o", "h", "l", "c", "v"]);
    expect(columns("bar_days")).toEqual(["symbol", "timeframe", "date", "count", "fetched_at"]);
  });
});
