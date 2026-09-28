import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
});
