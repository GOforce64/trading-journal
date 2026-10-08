import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  it("closes its connection, so the journal can be moved or deleted at once (Windows locks open files)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-migrate-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    // SQLite removes a WAL journal's -wal file when its last connection closes.
    expect(existsSync(`${file}-wal`)).toBe(false);
  });

  it("adds the scalp review's and scalp R's tables and columns", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("scalp_details")).toEqual([
      "trade_id",
      "level_basis",
      "stop_price",
      "stock_entry_override",
      "risk_override",
    ]);
    expect(columns("scalp_targets")).toEqual(["trade_id", "position", "price", "contracts"]);
    expect(columns("scalp_prices")).toEqual([
      "trade_id",
      "entry_price",
      "hold_high",
      "hold_low",
      "fetched_at",
      "option_high",
      "option_low",
    ]);
    expect(columns("trades")).toContain("reviewed_at");
    expect(columns("missed_details")).toEqual([
      "trade_id",
      "direction",
      "entry_price",
      "stop_price",
      "target_price",
      "exit_price",
    ]);
    expect(columns("attachments")).toEqual([
      "id",
      "trade_id",
      "sha256",
      "ext",
      "mime",
      "bytes",
      "caption",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
  });

  it("turns a stored target into T1 trimming the whole position, then drops the column", () => {
    const dir = tempDir();
    // The migrations up to 0005, so the old column can be filled in first.
    const before = join(dir, "migrations");
    cpSync(MIGRATIONS, before, { recursive: true });
    const journalFile = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < "0006");
    writeFileSync(journalFile, JSON.stringify(journal));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: before });
    const old = openDatabase(file);
    old.run(sql`insert into trades (id, strategy, book, underlying, opened_at, created_at, updated_at)
      values ('nvda', 'scalp', 'paper', 'NVDA', 1, 1, 1), ('amd', 'scalp', 'paper', 'AMD', 1, 1, 1)`);
    old.run(sql`insert into legs (id, trade_id, "right", strike, expiry, quantity, open_price, created_at, updated_at)
      values ('l1', 'nvda', 'C', 232.5, '2026-09-28', 2, 1.06, 1, 1)`);
    old.run(sql`insert into scalp_details (trade_id, level_basis, stop_price, target_price)
      values ('nvda', 'stock', 229, 234.5), ('amd', 'stock', 150, null)`);

    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    expect(db.all(sql`select trade_id, position, price, contracts from scalp_targets`)).toEqual([
      { trade_id: "nvda", position: 1, price: 234.5, contracts: 2 },
    ]);
    expect(db.all(sql`select trade_id, stop_price from scalp_details order by trade_id`)).toEqual([
      { trade_id: "amd", stop_price: 150 },
      { trade_id: "nvda", stop_price: 229 },
    ]);
  });

  it("adds the option's range to the stored scalp prices, keeping what's there", () => {
    const dir = tempDir();
    // The migrations up to 0006, so a stored price is there first.
    const before = join(dir, "migrations");
    cpSync(MIGRATIONS, before, { recursive: true });
    const journalFile = join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < "0007");
    writeFileSync(journalFile, JSON.stringify(journal));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: before });
    const old = openDatabase(file);
    old.run(sql`insert into trades (id, strategy, book, underlying, opened_at, created_at, updated_at)
      values ('nvda', 'scalp', 'paper', 'NVDA', 1, 1, 1)`);
    old.run(sql`insert into scalp_prices (trade_id, entry_price, hold_high, hold_low, fetched_at)
      values ('nvda', 230.83, 233.21, 230.71, 5)`);

    runMigrations(file, { migrationsFolder: MIGRATIONS });
    expect(openDatabase(file).all(sql`select * from scalp_prices`)).toEqual([
      {
        trade_id: "nvda",
        entry_price: 230.83,
        hold_high: 233.21,
        hold_low: 230.71,
        fetched_at: 5,
        option_high: null,
        option_low: null,
      },
    ]);
  });

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

  it("keeps only the most recent pre-migration backups, leaving other files alone", () => {
    const dir = tempDir();
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir });
    writeFileSync(join(backupDir, "journal-before-notes-merge.db"), "x");
    for (let index = 0; index < 3; index++) {
      runMigrations(file, { migrationsFolder: MIGRATIONS, backupDir, keepBackups: 2 });
    }
    const names = readdirSync(backupDir);
    expect(names.filter((name) => name.startsWith("journal-migration-"))).toHaveLength(2);
    expect(names).toContain("journal-before-notes-merge.db");
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
