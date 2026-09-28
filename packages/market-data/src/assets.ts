import { z } from "zod";
import { LATEST_TRADES } from "./alpaca.js";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet, TRADING_API } from "./http.js";

const ASSETS = `${TRADING_API}/v2/assets`;

export interface CompanyNames {
  /** The company's name, or null when Alpaca does not know the symbol. */
  name(symbol: string): Promise<string | null>;
}

const assetSchema = z.object({ name: z.string() });

/** Company names from Alpaca's asset list. Names do not change, so each is asked for once per run. */
export function alpacaCompanyNames(keys: AlpacaKeys, options: AlpacaOptions = {}): CompanyNames {
  const known = new Map<string, string | null>();
  return {
    async name(symbol) {
      const cached = known.get(symbol);
      if (cached !== undefined) return cached;
      let name: string | null;
      try {
        const asset = assetSchema.parse(
          await alpacaGet(`${ASSETS}/${encodeURIComponent(symbol)}`, keys, options),
        );
        name = asset.name.replace(/\s+Common Stock$/i, "").trim() || null;
      } catch (error) {
        if (!(error instanceof AlpacaError && error.status === 404)) throw error;
        name = null;
      }
      known.set(symbol, name);
      return name;
    },
  };
}

export type KeyCheck = "ok" | "rejected" | "not_paper" | "unreachable";

/**
 * Tests a key before it is saved, with two read-only calls: prices come from the data API and
 * chains from the paper trading API, which refuses live-account keys.
 */
export async function checkAlpacaKeys(keys: AlpacaKeys, options: AlpacaOptions = {}): Promise<KeyCheck> {
  const attempt = async (url: string): Promise<"ok" | "rejected" | "unreachable"> => {
    try {
      await alpacaGet(url, keys, options);
      return "ok";
    } catch (error) {
      return error instanceof AlpacaError && (error.status === 401 || error.status === 403)
        ? "rejected"
        : "unreachable";
    }
  };
  const data = await attempt(`${LATEST_TRADES}?symbols=SPY&feed=iex`);
  if (data !== "ok") return data;
  const trading = await attempt(`${ASSETS}/SPY`);
  return trading === "rejected" ? "not_paper" : trading;
}
