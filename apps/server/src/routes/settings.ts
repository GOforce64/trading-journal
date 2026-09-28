import { zValidator } from "@hono/zod-validator";
import type { AlpacaKeys, KeyCheck } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import { SecretsFileBroken, writeAlpacaKeys } from "../config.js";
import type { MarketData } from "../marketData.js";

export interface SettingsDeps {
  dataDir: string;
  secretsFile: string;
  /** Tests a key with Alpaca before it is saved. */
  checkKeys: (keys: AlpacaKeys) => Promise<KeyCheck>;
}

const KEY_PROBLEMS: Record<Exclude<KeyCheck, "ok">, string> = {
  rejected: "Alpaca rejected this key. Check that both parts were copied in full.",
  not_paper:
    "Alpaca accepted this key for prices but not for option chains. It looks like a live-account key, so use your Paper account's key instead.",
  unreachable: "Couldn't reach Alpaca to test the key. Try again in a moment.",
};

const UNAVAILABLE = { error: "unavailable", message: "Settings can't be saved in this mode." };

const keysSchema = z.object({
  keyId: z.string().trim().min(1).max(100),
  secretKey: z.string().trim().min(1).max(200),
});

/**
 * The Settings page's API (spec §7.3). The secret key comes in here and goes only to
 * secrets.json and Alpaca: no answer, log line or error ever repeats it.
 */
export function settingsRoutes(market: MarketData | undefined, deps: SettingsDeps | undefined) {
  const view = () => ({
    dataDir: deps?.dataDir ?? null,
    marketData: {
      ...(market?.status() ?? { state: "off" as const, message: null }),
      keyIdHint: market?.keyIdHint() ?? null,
    },
  });

  const save = (keys: AlpacaKeys | null) => {
    if (!deps) return;
    writeAlpacaKeys(deps.secretsFile, keys);
    market?.configure(keys);
  };

  return new Hono()
    .get("/", (c) => c.json(view(), 200))
    .put(
      "/market-data",
      // Hono only reads bodies sent as application/json, which another site cannot send here without
      // a CORS preflight this server never approves. Anything else arrives empty and fails below.
      // The hook answers without zod's report, which could repeat what was typed.
      zValidator("json", keysSchema, (result, c) => {
        if (!result.success) {
          return c.json({ error: "invalid", message: "Enter both the key ID and the secret key." }, 400);
        }
      }),
      async (c) => {
        if (!market || !deps) return c.json(UNAVAILABLE, 503);
        const keys = c.req.valid("json");
        const check = await deps.checkKeys(keys);
        if (check !== "ok") return c.json({ error: check, message: KEY_PROBLEMS[check] }, 400);
        try {
          save(keys);
        } catch (error) {
          if (error instanceof SecretsFileBroken)
            return c.json({ error: "broken_file", message: error.message }, 409);
          throw error;
        }
        return c.json(view(), 200);
      },
    )
    .delete("/market-data", (c) => {
      if (!market || !deps) return c.json(UNAVAILABLE, 503);
      try {
        save(null);
      } catch (error) {
        if (error instanceof SecretsFileBroken)
          return c.json({ error: "broken_file", message: error.message }, 409);
        throw error;
      }
      return c.json(view(), 200);
    });
}
