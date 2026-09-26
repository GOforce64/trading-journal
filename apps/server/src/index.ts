import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { backupDatabase, openDatabase, runMigrations } from "@tj/db";
import { alpacaQuotes, cachedLatest } from "@tj/market-data";
import { createApp } from "./app.js";
import { dataPaths, readSecrets, resolveDataDir, type Secrets } from "./config.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
const PORT = Number(process.env.TJ_PORT ?? 4178);

const paths = dataPaths(resolveDataDir(process.env, process.platform, homedir()));
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.attachmentsDir, { recursive: true });

runMigrations(paths.dbFile, { migrationsFolder: MIGRATIONS, backupDir: paths.backupDir });

// The built UI is optional: `pnpm dev:server` runs before the web app is built.
const webDir = existsSync(WEB_DIST) ? WEB_DIST : undefined;

// Live prices are optional too: without a usable key the journal runs without them.
let secrets: Secrets = {};
try {
  secrets = readSecrets(paths.secretsFile);
} catch (error) {
  console.warn(`Live quotes off: ${(error as Error).message}`);
}
const quotes = secrets.alpaca
  ? cachedLatest(alpacaQuotes(secrets.alpaca), {
      // Shorter than the page's one-minute refresh, so every refresh gets a new price.
      ttlMs: 30_000,
      onError: (error) => console.warn(`Live quotes unavailable: ${(error as Error).message}`),
    })
  : undefined;

const app = createApp({
  db: openDatabase(paths.dbFile),
  webDir,
  backup: () => backupDatabase(paths.dbFile, paths.backupDir),
  quotes,
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Trading journal on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${paths.dataDir}`);
  console.log(
    quotes ? "Live quotes: Alpaca, IEX feed" : `Live quotes: off (add an Alpaca key to ${paths.secretsFile})`,
  );
  if (!webDir) console.log("UI not built yet — run `pnpm build`, or use `pnpm dev:web`.");
});
