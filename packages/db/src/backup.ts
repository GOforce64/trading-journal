import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * Snapshot the database with VACUUM INTO on its own read-only connection. Unlike
 * copying the file, this is consistent while the app holds it open in WAL mode.
 */
export function backupDatabase(dbFile: string, backupDir: string, keep = 10): string {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let target = join(backupDir, `journal-${stamp}.db`);
  for (let suffix = 1; existsSync(target); suffix++)
    target = join(backupDir, `journal-${stamp}-${suffix}.db`);

  const source = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    source.prepare("VACUUM INTO ?").run(target);
  } finally {
    source.close();
  }
  pruneBackups(backupDir, keep);
  return target;
}

function pruneBackups(backupDir: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(keep)) unlinkSync(join(backupDir, file.name));
}
