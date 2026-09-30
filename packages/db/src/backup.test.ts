import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { barDays, bars, trades } from "./schema.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

describe("backupDatabase", () => {
  it("copies a database the app still has open, including uncheckpointed writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    db.insert(trades)
      .values({
        id: "t1",
        strategy: "iron_fly",
        book: "paper",
        underlying: "XYZ",
        openedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const copy = backupDatabase(file, join(dir, "backups"));

    expect(openDatabase(copy).select().from(trades).all()).toHaveLength(1);
  });

  it("never overwrites a backup taken in the same millisecond", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const first = backupDatabase(file, join(dir, "backups"));
    const second = backupDatabase(file, join(dir, "backups"));
    expect(second).not.toBe(first);
  });

  it("keeps the most recent backups of each kind, and never deletes a file it didn't make", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    // A copy the user made by hand, before a risky change.
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "journal-before-notes-merge.db"), "x");
    const migration = backupDatabase(file, backupDir, 2, "migration");
    for (let index = 0; index < 3; index++) backupDatabase(file, backupDir, 2, "import");
    const names = readdirSync(backupDir).sort();
    expect(names.filter((name) => name.startsWith("journal-import-"))).toHaveLength(2);
    expect(names).toContain("journal-before-notes-merge.db");
    // Imports don't use up the migrations' share.
    expect(names).toContain(basename(migration));
  });

  it("leaves the bar cache out of a backup, since it's fetched again", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    db.insert(bars).values({ symbol: "NVDA", timeframe: "1m", t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }).run();
    db.insert(barDays)
      .values({ symbol: "NVDA", timeframe: "1m", date: "2026-09-28", count: 1, fetchedAt: 1 })
      .run();

    const copy = openDatabase(backupDatabase(file, join(dir, "backups")));
    expect(copy.select().from(bars).all()).toHaveLength(0);
    expect(copy.select().from(barDays).all()).toHaveLength(0);
    expect(db.select().from(bars).all()).toHaveLength(1);
  });
});
