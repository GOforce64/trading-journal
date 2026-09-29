import { zValidator } from "@hono/zod-validator";
import { nyDate } from "@tj/core";
import type { FlexCheck } from "@tj/importers";
import type { AlpacaKeys, KeyCheck } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import {
  type IbkrConfig,
  readSecrets,
  SecretsFileBroken,
  writeAlpacaKeys,
  writeIbkrConfig,
} from "../config.js";
import type { MarketData } from "../marketData.js";

export interface SettingsDeps {
  dataDir: string;
  secretsFile: string;
  /** Tests a key with Alpaca before it is saved. */
  checkKeys: (keys: AlpacaKeys) => Promise<KeyCheck>;
  /** Tests an IBKR token and query before they're saved. Omitted where IBKR is unavailable. */
  checkIbkr?: (token: string, queryId: string) => Promise<FlexCheck>;
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

// Date.parse rolls 2026-02-30 over to March 2, so the date must come back unchanged.
const realDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
};

const ibkrSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{10,40}$/)
    .optional(),
  activityQueryId: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/),
  todayQueryId: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(realDate)
    .refine((date) => date <= nyDate(Date.now())),
});

const IBKR_INVALID = {
  error: "invalid",
  message: "Enter the token, both query IDs (numbers only) and a start date no later than today.",
};

/**
 * The Settings page's API (spec §7.3). The secret key comes in here and goes only to
 * secrets.json and Alpaca: no answer, log line or error ever repeats it.
 */
export function settingsRoutes(market: MarketData | undefined, deps: SettingsDeps | undefined) {
  /** What Settings shows of the IBKR block: never the token itself. */
  const ibkrView = () => {
    let config: IbkrConfig | undefined;
    try {
      config = deps ? readSecrets(deps.secretsFile).ibkr : undefined;
    } catch {
      config = undefined;
    }
    return {
      configured: config != null,
      tokenHint: config ? `${config.token.slice(0, 2)}…${config.token.slice(-4)}` : null,
      activityQueryId: config?.activityQueryId ?? null,
      todayQueryId: config?.todayQueryId ?? null,
      since: config?.since ?? null,
    };
  };

  const view = () => ({
    dataDir: deps?.dataDir ?? null,
    marketData: {
      ...(market?.status() ?? { state: "off" as const, message: null }),
      keyIdHint: market?.keyIdHint() ?? null,
    },
    ibkr: ibkrView(),
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
    })
    .put(
      "/ibkr",
      zValidator("json", ibkrSchema, (result, c) => {
        if (!result.success) return c.json(IBKR_INVALID, 400);
      }),
      async (c) => {
        if (!deps?.checkIbkr) return c.json(UNAVAILABLE, 503);
        const input = c.req.valid("json");
        let saved: IbkrConfig | undefined;
        try {
          saved = readSecrets(deps.secretsFile).ibkr;
        } catch (error) {
          return c.json({ error: "broken_file", message: (error as Error).message }, 409);
        }
        const token = input.token ?? saved?.token;
        if (!token) return c.json(IBKR_INVALID, 400);
        for (const [which, queryId] of [
          ["Activity", input.activityQueryId],
          ["Today", input.todayQueryId],
        ] as const) {
          const check = await deps.checkIbkr(token, queryId);
          if (check === "token_rejected") {
            return c.json(
              {
                error: "token_rejected",
                message:
                  "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal.",
              },
              400,
            );
          }
          if (check === "query_not_found") {
            return c.json(
              {
                error: "query_not_found",
                message: `IBKR doesn't know the ${which} query ${queryId}. Check its ID on the Flex Queries page.`,
              },
              400,
            );
          }
          if (check === "unreachable") {
            return c.json(
              {
                error: "unreachable",
                message: "Couldn't reach IBKR to test the token. Try again in a moment.",
              },
              503,
            );
          }
        }
        try {
          writeIbkrConfig(deps.secretsFile, {
            token,
            activityQueryId: input.activityQueryId,
            todayQueryId: input.todayQueryId,
            since: input.since,
          });
        } catch (error) {
          if (error instanceof SecretsFileBroken)
            return c.json({ error: "broken_file", message: error.message }, 409);
          throw error;
        }
        return c.json(view(), 200);
      },
    )
    .delete("/ibkr", (c) => {
      if (!deps) return c.json(UNAVAILABLE, 503);
      try {
        writeIbkrConfig(deps.secretsFile, null);
      } catch (error) {
        if (error instanceof SecretsFileBroken)
          return c.json({ error: "broken_file", message: error.message }, 409);
        throw error;
      }
      return c.json(view(), 200);
    });
}
