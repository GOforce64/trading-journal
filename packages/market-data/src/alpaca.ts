import { z } from "zod";
import type { Quote, QuoteSource } from "./quotes.js";

const LATEST_TRADES = "https://data.alpaca.markets/v2/stocks/trades/latest";

export interface AlpacaKeys {
  keyId: string;
  secretKey: string;
}

export interface AlpacaOptions {
  /** The global fetch unless a test supplies its own. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const latestTradesSchema = z.object({
  trades: z.record(z.string(), z.object({ p: z.number().positive(), t: z.iso.datetime({ offset: true }) })),
});

const errorSchema = z.object({ message: z.string() });

/** How Alpaca names the one symbol that sank a batch: `code=400, message=invalid symbol: GME1`. */
const INVALID_SYMBOL = /invalid symbol: ([^\s",]+)/;

/**
 * Last-trade prices from Alpaca's free Basic plan, where only the IEX feed is real time.
 * IEX is a single exchange, which is fine for a reference price.
 */
export function alpacaQuotes(keys: AlpacaKeys, options: AlpacaOptions = {}): QuoteSource {
  const { fetch: fetchImpl = fetch, timeoutMs = 10_000 } = options;
  const headers = { "APCA-API-KEY-ID": keys.keyId, "APCA-API-SECRET-KEY": keys.secretKey };

  return {
    async latest(symbols) {
      let pending = [...symbols];
      while (pending.length > 0) {
        const query = new URLSearchParams({ symbols: pending.join(","), feed: "iex" });
        const res = await fetchImpl(`${LATEST_TRADES}?${query}`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return toQuotes(latestTradesSchema.parse(await res.json()));

        const message = await errorMessage(res);
        // One unknown symbol fails the whole batch, so leave it out and ask again for the rest.
        const rejected = res.status === 400 ? INVALID_SYMBOL.exec(message)?.[1] : undefined;
        if (!rejected || !pending.includes(rejected))
          throw new Error(`Alpaca answered ${res.status}${message ? `: ${message}` : ""}`);
        pending = pending.filter((symbol) => symbol !== rejected);
      }
      return new Map();
    },
  };
}

function toQuotes(reply: z.infer<typeof latestTradesSchema>): Map<string, Quote> {
  return new Map(
    Object.entries(reply.trades).map(([symbol, trade]) => [
      symbol,
      { price: trade.p, at: Date.parse(trade.t) },
    ]),
  );
}

/** Alpaca explains errors in JSON. Anything else, such as the web page sent for a wrong key, adds nothing. */
async function errorMessage(res: Response): Promise<string> {
  try {
    return errorSchema.parse(JSON.parse(await res.text())).message;
  } catch {
    return "";
  }
}
