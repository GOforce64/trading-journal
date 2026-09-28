import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./client.js";

export interface MigrateOptions {
  migrationsFolder: string;
  backupDir?: string;
  keepBackups?: number;
}

/** Snapshot the database, prune old snapshots, then apply pending migrations. */
export function runMigrations(filePath: string, options: MigrateOptions): void {
  const { migrationsFolder, backupDir, keepBackups = 10 } = options;
  if (backupDir && existsSync(filePath)) backupDatabase(filePath, backupDir, keepBackups);
  const db = openDatabase(filePath);
  migrate(db, { migrationsFolder });
}
