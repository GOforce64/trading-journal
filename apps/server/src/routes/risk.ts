import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { ScalpPriceFiller } from "../scalpPrices.js";

const fillSchema = z.object({ tradeIds: z.array(z.uuid()).max(1000).optional() });

/** Fetches the stock prices scalps' R needs (scalp-R spec §7). */
export function riskRoutes(filler: ScalpPriceFiller) {
  return new Hono().post("/fill", zValidator("json", fillSchema), async (c) =>
    c.json(await filler.fill(c.req.valid("json").tradeIds), 200),
  );
}
