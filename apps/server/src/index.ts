import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { openDatabase, runMigrations } from "@tj/db";
import { createApp } from "./app.js";
import { dataPaths, resolveDataDir } from "./config.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const PORT = Number(process.env.TJ_PORT ?? 4178);

const paths = dataPaths(resolveDataDir(process.env, process.platform, homedir()));
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.attachmentsDir, { recursive: true });

runMigrations(paths.dbFile, { migrationsFolder: MIGRATIONS, backupDir: paths.backupDir });

const app = createApp({ db: openDatabase(paths.dbFile) });

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Trading journal on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${paths.dataDir}`);
});
