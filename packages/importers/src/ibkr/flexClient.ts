export const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const USER_AGENT = "trading-journal/1.0";

export type FlexErrorKind = "token" | "query" | "slow" | "unreachable" | "failed";

/** A refusal from IBKR's Flex Web Service, in terms the app can act on. It never carries the token. */
export class FlexError extends Error {
  readonly kind: FlexErrorKind;

  constructor(kind: FlexErrorKind, message: string) {
    super(message);
    this.name = "FlexError";
    this.kind = kind;
  }
}

export interface FlexOptions {
  /** The global fetch unless a test supplies its own. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  /** Per request. */
  timeoutMs?: number;
  /** How long to wait in all for IBKR to say yes. */
  patienceMs?: number;
}

export interface FlexClient {
  /** The statement's XML: SendRequest, then GetStatement until it's ready (spec §6.1). */
  statement(queryId: string): Promise<string>;
  /** SendRequest alone: proves the token and the query without waiting for a statement. */
  checkQuery(queryId: string): Promise<void>;
}

/** IBKR's "not yet" codes: generating, busy, not ready, or too many requests. */
const RETRY = new Set(["1001", "1004", "1005", "1006", "1007", "1008", "1009", "1018", "1019", "1021"]);
const TOKEN = new Set(["1011", "1012", "1013", "1015", "1020"]);
const QUERY = new Set(["1003", "1010", "1014", "1016"]);

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();

const slow = () => new FlexError("slow", "IBKR is still preparing the statement. Try again shortly.");

function refusal(code: string, reason: string, queryId: string): FlexError {
  if (TOKEN.has(code)) {
    return new FlexError(
      "token",
      `IBKR rejected the token (${reason}). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.`,
    );
  }
  if (QUERY.has(code)) {
    return new FlexError(
      "query",
      `IBKR refused query ${queryId} (${reason}). Check the query ID on the Flex Queries page.`,
    );
  }
  return new FlexError("failed", `IBKR answered ${code || "without a code"}: ${reason}`);
}

/** IBKR's Flex Web Service for one token. The token goes into request URLs, as IBKR requires, and nowhere else. */
export function ibkrFlex(token: string, options: FlexOptions = {}): FlexClient {
  const {
    fetch: fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 30_000,
    patienceMs = 120_000,
  } = options;

  async function get(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The underlying error can quote the URL, and the URL holds the token.
      throw new FlexError("unreachable", "Couldn't reach IBKR.");
    }
    if (!res.ok) throw new FlexError("failed", `IBKR answered HTTP ${res.status}.`);
    return res.text();
  }

  /** Waits 2, 4, 8, 16, then 20 s between tries, giving up after `patienceMs` in all. */
  function backoff() {
    let next = 2_000;
    let waited = 0;
    return async () => {
      if (waited >= patienceMs) throw slow();
      await sleep(next);
      waited += next;
      next = Math.min(next * 2, 20_000);
    };
  }

  async function sendRequest(queryId: string): Promise<{ reference: string; url: string }> {
    const wait = backoff();
    for (;;) {
      const body = await get(
        `${FLEX_BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`,
      );
      if (tag(body, "Status") === "Success") {
        const reference = tag(body, "ReferenceCode");
        if (!reference)
          throw new FlexError("failed", "IBKR accepted the request but sent no reference code.");
        return { reference, url: tag(body, "Url") ?? `${FLEX_BASE}/GetStatement` };
      }
      const code = tag(body, "ErrorCode") ?? "";
      if (!RETRY.has(code)) throw refusal(code, tag(body, "ErrorMessage") ?? "no reason given", queryId);
      await wait();
    }
  }

  return {
    async statement(queryId) {
      const { reference, url } = await sendRequest(queryId);
      const wait = backoff();
      for (;;) {
        // IBKR needs a moment before the first GetStatement.
        await wait();
        const body = await get(
          `${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(reference)}&v=3`,
        );
        if (body.includes("<FlexQueryResponse")) return body;
        const code = tag(body, "ErrorCode") ?? "";
        if (!RETRY.has(code)) throw refusal(code, tag(body, "ErrorMessage") ?? "no reason given", queryId);
      }
    },
    async checkQuery(queryId) {
      await sendRequest(queryId);
    },
  };
}

export type FlexCheck = "ok" | "token_rejected" | "query_not_found" | "unreachable";

/** What Settings tells the user about a token and a query before saving them. */
export async function checkFlexQuery(
  token: string,
  queryId: string,
  options: FlexOptions = {},
): Promise<FlexCheck> {
  try {
    await ibkrFlex(token, options).checkQuery(queryId);
    return "ok";
  } catch (error) {
    if (error instanceof FlexError && error.kind === "token") return "token_rejected";
    if (error instanceof FlexError && error.kind === "query") return "query_not_found";
    return "unreachable";
  }
}
