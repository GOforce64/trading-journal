import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/** Why a backup was taken. Each kind keeps its own most recent copies. */
export type BackupReason = "backup" | "import" | "migration" | "merge";

/**
 * A backup from before each kind had its name: `journal-` and the ISO time, made for migrations and imports alike.
 * Every kind prunes these with its own, so they go oldest first as new backups come.
 */
const LEGACY = /^journal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?\.db$/;

/** The cache tables: fetched again on demand, so a backup leaves them out. */
const CACHE_TABLES = ["bars", "bar_days"];

/**
 * Snapshot the database with VACUUM INTO on its own read-only connection. Unlike
 * copying the file, this is consistent while the app holds it open in WAL mode.
 * The bar cache is emptied from the copy, which Alpaca refills: it would otherwise be most of every backup.
 * Returns the backup's path.
 */
export function backupDatabase(
  dbFile: string,
  backupDir: string,
  keep = 10,
  reason: BackupReason = "backup",
): string {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `journal-${reason}-`;
  let target = join(backupDir, `${prefix}${stamp}.db`);
  for (let suffix = 1; existsSync(target); suffix++)
    target = join(backupDir, `${prefix}${stamp}-${suffix}.db`);

  const source = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    source.prepare("VACUUM INTO ?").run(target);
  } finally {
    source.close();
  }
  const copy = new Database(target);
  try {
    const present = new Set(
      copy
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    const cached = CACHE_TABLES.filter((table) => present.has(table));
    if (cached.length > 0) {
      for (const table of cached) copy.prepare(`DELETE FROM ${table}`).run();
      copy.exec("VACUUM");
    }
  } finally {
    copy.close();
  }
  pruneBackups(backupDir, prefix, keep);
  return target;
}

/**
 * Keeps the `keep` most recent backups of one kind, counting old-style ones with it. Files it didn't make, such as a
 * copy made by hand, stay.
 */
function pruneBackups(backupDir: string, prefix: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => (name.startsWith(prefix) && name.endsWith(".db")) || LEGACY.test(name))
    .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  for (const file of files.slice(keep)) unlinkSync(join(backupDir, file.name));
}
