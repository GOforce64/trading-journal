import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { MoveFiller } from "../moves.js";

const fillSchema = z.object({ tradeIds: z.array(z.uuid()).max(1000).optional() });

/** Fetches missing stock prices for the move data (spec §8.2). */
export function moveRoutes(filler: MoveFiller) {
  return new Hono().post("/fill", zValidator("json", fillSchema), async (c) =>
    c.json(await filler.fill(c.req.valid("json").tradeIds), 200),
  );
}
