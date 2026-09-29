import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { IbkrSync } from "../ibkr/sync.js";

/** The IBKR sync (spec §8.3): run it, read its status, and hand a trade back to IBKR's numbers. */
export function ibkrRoutes(sync: IbkrSync) {
  return new Hono()
    .post("/sync", zValidator("json", z.object({ auto: z.boolean() })), async (c) =>
      c.json(await sync.sync(c.req.valid("json")), 200),
    )
    .get("/status", (c) => c.json(sync.status(), 200))
    .post("/trades/:id/reset", async (c) => {
      const summary = await sync.reset(c.req.param("id"));
      return summary ? c.json(summary, 200) : c.json({ error: "not found" }, 404);
    });
}
