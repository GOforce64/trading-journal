import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { backupDatabase, openDatabase, runMigrations } from "@tj/db";
import { type AlpacaKeys, checkAlpacaKeys } from "@tj/market-data";
import { createApp } from "./app.js";
import { dataPaths, readSecrets, resolveDataDir } from "./config.js";
import { createMarketData } from "./marketData.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
const PORT = Number(process.env.TJ_PORT ?? 4178);

const paths = dataPaths(resolveDataDir(process.env, process.platform, homedir()));
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.attachmentsDir, { recursive: true });

runMigrations(paths.dbFile, { migrationsFolder: MIGRATIONS, backupDir: paths.backupDir });

// The built UI is optional: `pnpm dev:server` runs before the web app is built.
const webDir = existsSync(WEB_DIST) ? WEB_DIST : undefined;

// Market data is optional too: without a usable key the journal runs without it.
let keys: AlpacaKeys | null = null;
try {
  keys = readSecrets(paths.secretsFile).alpaca ?? null;
} catch (error) {
  console.warn(`Market data off: ${(error as Error).message}`);
}
const market = createMarketData(keys);

const app = createApp({
  db: openDatabase(paths.dbFile),
  webDir,
  backup: () => backupDatabase(paths.dbFile, paths.backupDir),
  market,
  settings: {
    dataDir: paths.dataDir,
    secretsFile: paths.secretsFile,
    checkKeys: (keys) => checkAlpacaKeys(keys),
  },
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Trading journal on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${paths.dataDir}`);
  console.log(
    market.sources()
      ? "Market data: Alpaca (IEX stock prices, indicative option quotes)"
      : "Market data: off (add an Alpaca key in Settings)",
  );
  if (!webDir) console.log("UI not built yet — run `pnpm build`, or use `pnpm dev:web`.");
});
