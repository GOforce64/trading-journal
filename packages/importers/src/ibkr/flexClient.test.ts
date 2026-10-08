import { describe, expect, it } from "vitest";
import { checkFlexQuery, FLEX_BASE, FlexError, ibkrFlex } from "./flexClient.js";

const TOKEN = "1234567890123456789012";
const QUERY = "1653147";
const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/xml" } });
const accepted = (reference = "5555") =>
  xml(
    `<FlexStatementResponse timestamp="28 September, 2026 07:41 PM EDT"><Status>Success</Status><ReferenceCode>${reference}</ReferenceCode><Url>${FLEX_BASE}/GetStatement</Url></FlexStatementResponse>`,
  );
const refused = (status: "Warn" | "Fail", code: string, message: string) =>
  xml(
    `<FlexStatementResponse timestamp="28 September, 2026 07:41 PM EDT"><Status>${status}</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>${message}</ErrorMessage></FlexStatementResponse>`,
  );
const STATEMENT = `<FlexQueryResponse queryName="TJ Today" type="TCF"><FlexStatements count="1"></FlexStatements></FlexQueryResponse>`;

/**
 * Plays back one reply per call, or throws a given error, and records every call and every wait. The clock moves
 * with each wait, and by `latencyMs` with each answer.
 */
function fake(...replies: (Response | Error)[]) {
  return fakeWith({ latencyMs: 0 }, ...replies);
}

function fakeWith({ latencyMs }: { latencyMs: number }, ...replies: (Response | Error)[]) {
  const calls: { url: string; userAgent: string | null }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    clock += latencyMs;
    const reply = replies.shift();
    if (!reply) throw new Error("IBKR was called more often than expected");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  return { client: ibkrFlex(TOKEN, { fetch, sleep, now: () => clock }), calls, sleeps, elapsed: () => clock };
}

async function failure(promise: Promise<unknown>): Promise<FlexError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FlexError) return error;
    throw error;
  }
  throw new Error("expected a FlexError");
}

describe("ibkrFlex.statement", () => {
  it("asks for the statement, then collects it once IBKR has generated it", async () => {
    const still = () =>
      refused("Warn", "1019", "Statement generation in progress. Please try again shortly.");
    const { client, calls, sleeps } = fake(accepted("5555"), still(), still(), xml(STATEMENT));
    expect(await client.statement(QUERY)).toBe(STATEMENT);
    expect(calls.map((call) => call.url)).toEqual([
      `${FLEX_BASE}/SendRequest?t=${TOKEN}&q=${QUERY}&v=3`,
      `${FLEX_BASE}/GetStatement?t=${TOKEN}&q=5555&v=3`,
      `${FLEX_BASE}/GetStatement?t=${TOKEN}&q=5555&v=3`,
      `${FLEX_BASE}/GetStatement?t=${TOKEN}&q=5555&v=3`,
    ]);
    expect(calls.every((call) => call.userAgent === "trading-journal/1.0")).toBe(true);
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);
  });

  it("collects the statement from its own host, whatever host IBKR's reply names", async () => {
    // IBKR has answered with gdcdyn.interactivebrokers.com, which doesn't resolve; ndcdyn serves the same reference.
    const elsewhere = xml(
      `<FlexStatementResponse timestamp="29 September, 2026 07:23 AM EDT"><Status>Success</Status><ReferenceCode>5555</ReferenceCode><Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`,
    );
    const { client, calls } = fake(elsewhere, xml(STATEMENT));
    expect(await client.statement(QUERY)).toBe(STATEMENT);
    expect(calls[1]?.url).toBe(`${FLEX_BASE}/GetStatement?t=${TOKEN}&q=5555&v=3`);
  });

  it("gives up as slow after about two minutes of 'still generating'", async () => {
    const replies = [
      accepted(),
      ...Array.from({ length: 20 }, () => refused("Warn", "1019", "In progress.")),
    ];
    const { client, sleeps } = fake(...replies);
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("slow");
    expect(error.message).toBe("IBKR is still preparing the statement. Try again shortly.");
    const waited = sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(waited).toBeGreaterThanOrEqual(120_000);
    expect(waited).toBeLessThan(150_000);
  });

  it("gives the statement about two minutes in all, asking and collecting together", async () => {
    const throttled = () => refused("Fail", "1018", "Too many requests have been made from this token.");
    const replies = [
      ...Array.from({ length: 6 }, throttled),
      accepted(),
      ...Array.from({ length: 20 }, () => refused("Warn", "1019", "In progress.")),
    ];
    const { client, elapsed } = fake(...replies);
    expect((await failure(client.statement(QUERY))).kind).toBe("slow");
    expect(elapsed()).toBeGreaterThanOrEqual(120_000);
    expect(elapsed()).toBeLessThan(150_000);
  });

  it("stops at a deadline it's given, which a sync shares between its statements", async () => {
    const replies = [
      accepted(),
      ...Array.from({ length: 20 }, () => refused("Warn", "1019", "In progress.")),
    ];
    const { client, elapsed } = fake(...replies);
    expect((await failure(client.statement(QUERY, 30_000))).kind).toBe("slow");
    expect(elapsed()).toBeGreaterThanOrEqual(30_000);
    expect(elapsed()).toBeLessThan(60_000);
  });

  it("counts the time IBKR takes to answer toward the two minutes", async () => {
    const replies = [
      accepted(),
      ...Array.from({ length: 20 }, () => refused("Warn", "1019", "In progress.")),
    ];
    const { client, elapsed } = fakeWith({ latencyMs: 15_000 }, ...replies);
    expect((await failure(client.statement(QUERY))).kind).toBe("slow");
    expect(elapsed()).toBeLessThan(160_000);
  });

  it("waits and retries when IBKR says too many requests", async () => {
    const { client } = fake(
      refused("Fail", "1018", "Too many requests have been made from this token."),
      accepted(),
      xml(STATEMENT),
    );
    expect(await client.statement(QUERY)).toBe(STATEMENT);
  });

  it.each([
    ["1012", "Token has expired."],
    ["1015", "Token is invalid."],
  ])("names a rejected token (%s) without ever repeating it", async (code, reason) => {
    const { client } = fake(refused("Fail", code, reason));
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("token");
    expect(error.message).toBe(
      `IBKR rejected the token (${reason}). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.`,
    );
    expect(error.message).not.toContain(TOKEN);
  });

  it("names the query IBKR refused", async () => {
    const { client } = fake(refused("Fail", "1014", "Query is invalid."));
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("query");
    expect(error.message).toBe(
      "IBKR refused query 1653147 (Query is invalid.). Check the query ID on the Flex Queries page.",
    );
  });

  it("says IBKR couldn't be reached, never quoting the request", async () => {
    const { client } = fake(new TypeError(`fetch failed for ${FLEX_BASE}/SendRequest?t=${TOKEN}`));
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("unreachable");
    expect(error.message).toBe("Couldn't reach IBKR.");
  });

  it("reports an HTTP failure plainly", async () => {
    const { client } = fake(xml("<html>down</html>", 503));
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("failed");
    expect(error.message).toBe("IBKR answered HTTP 503.");
    expect(error.message).not.toContain(TOKEN);
  });
});

describe("checkQuery and checkFlexQuery", () => {
  it("proves the token and the query with SendRequest alone", async () => {
    const { client, calls } = fake(accepted());
    await client.checkQuery(QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/SendRequest?");
  });

  it("maps IBKR's answer to what Settings says", async () => {
    const answer = (...replies: (Response | Error)[]) => {
      const queue = [...replies];
      return checkFlexQuery(TOKEN, QUERY, {
        fetch: async () => {
          const reply = queue.shift();
          if (!reply || reply instanceof Error) throw reply ?? new Error("no reply");
          return reply;
        },
        sleep: async () => {},
      });
    };
    expect(await answer(accepted())).toBe("ok");
    expect(await answer(refused("Fail", "1015", "Token is invalid."))).toBe("token_rejected");
    expect(await answer(refused("Fail", "1014", "Query is invalid."))).toBe("query_not_found");
    expect(await answer(new TypeError("fetch failed"))).toBe("unreachable");
  });
});
