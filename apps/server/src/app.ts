import type { Db } from "@tj/db";
import { Hono } from "hono";
import { taxonomyRoutes } from "./routes/taxonomy.js";
import { tradeRoutes } from "./routes/trades.js";

export interface AppDeps {
  db: Db;
  now?: () => number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function createApp(deps: AppDeps) {
  const { setups, tags } = taxonomyRoutes(deps.db, deps.now);

  return (
    new Hono()
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
  );
}

export type AppType = ReturnType<typeof createApp>;
