import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { trades } from "./schema.js";

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

  it("keeps only the most recent backups", () => {
    const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
    const file = join(dir, "journal.db");
    const backupDir = join(dir, "backups");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    backupDatabase(file, backupDir);
    for (let index = 0; index < 4; index++) writeFileSync(join(backupDir, `journal-old-${index}.db`), "x");
    backupDatabase(file, backupDir, 2);
    expect(readdirSync(backupDir).filter((name) => name.endsWith(".db"))).toHaveLength(2);
  });
});
