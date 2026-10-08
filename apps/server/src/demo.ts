import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nyDate } from "@tj/core";
import { openDatabase, runMigrations } from "@tj/db";
import { generateDemo, lastFinishedSession } from "@tj/demo";
import { resolveDataDir } from "./config.js";
import { demoDir, parseDemoArgs, prepareDemoDir } from "./demoDir.js";

/**
 * `pnpm demo` (demo spec §4): a fresh journal of fake trades in its own directory, then the normal server on it, on
 * port 4179 unless `TJ_PORT` says otherwise. Without a secrets file there, market data and IBKR sync stay off.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

try {
  const { seed, end } = parseDemoArgs(process.argv.slice(2), nyDate(Date.now()));
  const dir = demoDir(process.env, tmpdir());
  prepareDemoDir(dir, resolveDataDir(process.env, process.platform, homedir()));
  const file = join(dir, "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  const db = openDatabase(file);
  const started = performance.now();
  const summary = generateDemo(db, { seed, end: end ?? lastFinishedSession(Date.now()) });
  db.$client.close();
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Demo journal: ${summary.scalps} scalps and ${summary.flies} iron flies from ${summary.from} to ${summary.to}, with ${summary.bars.toLocaleString("en-US")} bars, made in ${seconds} s.`,
  );
  console.log(`It lives in ${dir}; the next \`pnpm demo\` replaces it. Your own journal isn't touched.`);
  process.env.TJ_DATA_DIR = dir;
  process.env.TJ_PORT ??= "4179";
  await import("./index.js");
} catch (error) {
  console.error(`The demo didn't start: ${(error as Error).message}`);
  process.exitCode = 1;
}
