import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/** The journal's database, with the raw better-sqlite3 handle the bundle reads and writes rows through. */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDatabase(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
