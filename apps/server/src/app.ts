import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Db } from "@tj/db";
import type { QuoteSource } from "@tj/market-data";
import { Hono } from "hono";
import { importRoutes } from "./routes/import.js";
import { quoteRoutes } from "./routes/quotes.js";
import { taxonomyRoutes } from "./routes/taxonomy.js";
import { tradeRoutes } from "./routes/trades.js";

export interface AppDeps {
  db: Db;
  now?: () => number;
  /** Directory holding the built UI. Omitted in development, where Vite serves it. */
  webDir?: string;
  /** Snapshots the database before an import writes; returns the backup's path. */
  backup?: () => string;
  /** Live reference prices. Omitted when no data key is set up, and the app carries on without them. */
  quotes?: QuoteSource;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function createApp(deps: AppDeps) {
  const { setups, tags } = taxonomyRoutes(deps.db, deps.now);

  const app = new Hono()
    // Blocks DNS rebinding: a page on the internet cannot talk to this server.
    .use("*", async (c, next) => {
      const host = (c.req.header("host") ?? "").replace(/:\d+$/, "");
      if (!LOCAL_HOSTS.has(host)) return c.json({ error: "forbidden host" }, 403);
      await next();
    })
    .get("/api/health", (c) => c.json({ ok: true }))
    .route("/api/trades", tradeRoutes(deps.db, deps.now))
    .route("/api/setups", setups)
    .route("/api/tags", tags)
    .route("/api/import", importRoutes(deps.db, deps.backup, deps.now))
    .route("/api/quotes", quoteRoutes(deps.quotes));

  if (deps.webDir) {
    const webDir = deps.webDir;
    const indexHtml = join(webDir, "index.html");
    app
      // An unknown /api path is a mistake, not a client-side route.
      .all("/api/*", (c) => c.json({ error: "not found" }, 404))
      .use("/*", serveStatic({ root: webDir }))
      // Client-side routes such as /trades/:id must return the SPA shell.
      .get("*", (c) => c.html(readFileSync(indexHtml, "utf8")));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
