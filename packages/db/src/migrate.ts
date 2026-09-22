import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "./client.js";

export interface MigrateOptions {
  migrationsFolder: string;
  backupDir?: string;
  keepBackups?: number;
}

/** Snapshot the database, prune old snapshots, then apply pending migrations. */
export function runMigrations(filePath: string, options: MigrateOptions): void {
  const { migrationsFolder, backupDir, keepBackups = 10 } = options;

  if (backupDir && existsSync(filePath)) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(filePath, join(backupDir, `journal-${stamp}.db`));
    pruneBackups(backupDir, keepBackups);
  }

  const db = openDatabase(filePath);
  migrate(db, { migrationsFolder });
}

function pruneBackups(backupDir: string, keep: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(keep)) unlinkSync(join(backupDir, file.name));
}
