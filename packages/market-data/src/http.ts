import { z } from "zod";

export interface AlpacaKeys {
  keyId: string;
  secretKey: string;
}

export interface AlpacaOptions {
  /** The global fetch unless a test supplies its own. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/** Market data: stock trades and option quotes. */
export const DATA_API = "https://data.alpaca.markets";
/** The paper trading API, which lists option contracts and assets. Only paper keys work here. */
export const TRADING_API = "https://paper-api.alpaca.markets";

/** A refusal from Alpaca: the HTTP status, and its JSON `message` when it sent one. */
export class AlpacaError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Alpaca answered ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "AlpacaError";
    this.status = status;
    this.detail = detail;
  }
}

const errorSchema = z.object({ message: z.string() });

/** One GET with the key and a timeout. Returns the parsed body, or throws an AlpacaError. */
export async function alpacaGet(
  url: string,
  keys: AlpacaKeys,
  options: AlpacaOptions = {},
): Promise<unknown> {
  const { fetch: fetchImpl = fetch, timeoutMs = 10_000 } = options;
  const res = await fetchImpl(url, {
    headers: { "APCA-API-KEY-ID": keys.keyId, "APCA-API-SECRET-KEY": keys.secretKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new AlpacaError(res.status, await errorMessage(res));
  return res.json();
}

/** Alpaca explains errors in JSON. Anything else, such as the web page sent for a wrong key, adds nothing. */
async function errorMessage(res: Response): Promise<string> {
  try {
    return errorSchema.parse(JSON.parse(await res.text())).message;
  } catch {
    return "";
  }
}
