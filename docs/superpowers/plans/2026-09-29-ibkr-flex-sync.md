# IBKR Flex Sync and Scalps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trades from the IBKR paper account flow into the journal from 2026-09-28 on: scalps as scalps and flies as iron flies. Every fill is kept and regrouped on each sync, duplicates of oQuants and typed trades are skipped, and the user's own edits always win. The app gains a Scalps page, a scalp trade page with its fills, and a scalp form.

**Architecture:**
- **`@tj/importers/ibkr`** is all pure or injectable:
  - `flexClient.ts` talks to IBKR's Flex Web Service;
  - `parse.ts` turns both statement types into one fill shape;
  - `group.ts` regroups fills into trade candidates by position episode.
- **`@tj/db`:**
  - migration 0003 adds the `fills` and `sync_state` tables and `trades.facts_edited_at`;
  - `repositories/ibkr.ts` stores fills, applies candidates without touching the user's side, and records runs.
- **The server:**
  - `createIbkrSync` fetches, parses, stores and regroups, all in one transaction;
  - it backs `/api/ibkr/sync`, `/api/ibkr/status` and `/api/ibkr/trades/:id/reset`;
  - it also adds IBKR credentials to Settings and each trade's fills to `GET /api/trades/:id`.
- **The web:**
  - an auto-sync on open, and an IBKR card on Import / Sync;
  - an IBKR section in Settings;
  - a Scalps page, scalp tiles, a Fills panel and a "Use IBKR's numbers" banner;
  - the scalp form.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), zod 4, **fast-xml-parser (new)**, Hono, Drizzle + better-sqlite3, React 19, TanStack Query 5 and Router 1, Tailwind 4, Vitest 5 (jsdom for web), fast-check 4, Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-29-ibkr-flex-sync-design.md`

**Branch:** `feat/ibkr-sync`, from `main` (ae00ac9, with the spec at 3ed0788). Work in place; no worktree.

**Deviations from the spec, agreed while planning.** The spec is updated in the same commit as this plan.

- **§7.4, when a fly closes:** `closedAt` is the last *exchange* closing fill. Expiry bookings (16:20) count only when nothing else closed the trade. The AA fly's body was bought back at 09:52 and its wings expired untouched. Using 16:20 would move move-data's exit stock price to the expiry close, and put oQuants' 09:54 and IBKR's close hours apart.
- **§6.2, cancels:** a cancel is matched by trade id **and** size and price. IBKR re-booked the canceled CZR 2-lot as a 1-lot correction under the **same** trade id: execution `.01.01` was canceled, `.01.02` stands. The parser returns `cancels: { tradeId, quantity, price }[]`, not bare trade ids.
- **§6.2, exercise prices:** they're matched to their `OptionEAE` row by `tradeID`, which both rows carry, instead of by conid and date.
- **§5.2, `sync_state`:** it's keyed by `source` (`"ibkr"`), with a nullable `account_id`. A run that fails before any statement names the account, such as a rejected token, must still be recorded and shown.
- **§5.3, what counts as a change of facts:** `facts_edited_at` compares `openedAt` and `closedAt` **to the minute**. The edit forms drop seconds from every time, so an untouched synced trade would otherwise count as edited on every save.
- **§12, the AA check:** IBKR's AA fly does **not** reconcile to the cent with the oQuants row.
  - The opens and the credit match: 1.37, 1.49, 0.13 and 0.08, a credit of $2.65 × 2.
  - oQuants rounds the 47C close to 0.33 (IBKR 0.325), books the expiring wings at 0.01 (IBKR 0), and uses its own fee model ($6.44 against IBKR's $9.68).
  - So the test checks the structure and credit against oQuants, and takes IBKR's **+$27.32** as the truth.
- **§7, fees:** a trade's `fees` is the sum of its **rounded** open and close fees, as the forms add them. The raw commissions are four-decimal and can sum a cent differently, and a notes-only save would then look like an edited fee.
- **§8.1, duplicates the other way round:** the oQuants import skips a fly that was already synced from IBKR (`syncedFrom`, Task 5; the import, Task 8). The spec only guarded the sync against oQuants, but for a few days flies are logged in both, and IBKR may come first.
- **§9.3, the auto-sync:** it runs from the app's root layout, with a `useRef` guard so React's StrictMode double effect sends one request. The nav's plain links reload the page, so each load asks once, and the server's 15-minute rule answers the repeats.

## Global Constraints

**IBKR**
- Base URL: `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService`, `v=3`, with the header `User-Agent: trading-journal/1.0`.
- Polling waits 2, 4, 8, 16, then 20 s, up to 120 s in total.
- The token appears **only** in request URLs: never in an error message, a log line, a summary or an API response.
- IBKR's codes:
  - wait and retry: 1001, 1004–1009, 1018, 1019, 1021;
  - token: 1011, 1012, 1013, 1015, 1020;
  - query: 1003, 1010, 1014, 1016.
- The user's paper queries are Activity **1653145** and Today **1653147**, and the start date defaults to **2026-09-28**.

**Ids**
- `IBKR_NAMESPACE = "7c1f2b9a-4e3d-4c8b-9a6f-2d5e8b1c3f40"`.
- A fill is `uuidV5("ibkr:{account}:{key}")`, and a trade is `uuidV5("ibkr:{account}:{first opening fill's key}")`, both with `IBKR_NAMESPACE`. A fill's id equals its trade's id when it is that trade's first opening fill; they live in different tables.
- A leg is `uuidV5("{tradeId}:{conid}")`.
- The key is the execution id, or `trade-{tradeID}` for a booking without one.
- An account is `uuidV5("ibkr-account:{accountId}")`.

**Ownership (spec §5.5)**
- The sync writes only `strategy`, `underlying`, `structureLabel`, `openedAt`, `closedAt`, `netPnl`, `fees`, `feesOpen`, `feesClose`, `accountId`, `book`, the legs, and the fly's structure columns (`bodyPutStrike`, `bodyCallStrike`, `putWingStrike`, `callWingStrike`, `contracts`, `creditPerShare`, `netCost`).
- It never writes `editedAt`, any review field, any override, or the stock prices.
- A trade with `facts_edited_at` set is never written or orphaned by a sync.

**Types across the RPC boundary (lesson TS2742, from move data)**
- A route that answers a server type the web infers must spell its unions inline.
- It must not use an alias from a package the web doesn't depend on (`@tj/importers`, `@tj/db` internals), nor a server-internal alias as a property type.

**UI copy (exact)**
- Nav: `Scalps`, with the button `+ New scalp`. The IBKR card is titled `IBKR · paper sync`, and its button is `Sync now` / `Syncing with IBKR…`.
- `Not set up. Add your Flex token and query IDs in Settings.`
- The token message: `IBKR rejected the token ({IBKR's reason}). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.`
- `IBKR is still preparing the statement. Try again shortly.` and `Couldn't reach IBKR.`
- `The Activity statement failed; today's fills are in.`
- Skipped reasons:
  - `opened before the start date`
  - `not an iron fly or a single option: enter it by hand`
  - `already in the journal`
  - `you deleted it`
- The banner: `Your edits are kept. Later syncs won't change this trade.`, then `IBKR now has +$44.74 net.` when the last sync found a difference, with the button `Use IBKR's numbers`.
- The forms: `Synced from IBKR. Changes you make here are kept: later syncs won't overwrite them.`
- Settings: `IBKR Flex` and `Both machines need the same start date.`
- The scalp tiles: `Contract`, `Size`, `Entry → exit`, `Held`, `Fees`, `Return on cost`.

**Palette:** up `#26a69a`, down `#ef5350`, accent `#2962ff`, panel `#131722`, line `#1f2430`, muted `#6b7385`.

**New dependency:** `fast-xml-parser` in `@tj/importers`, at the current major (`pnpm --filter @tj/importers add fast-xml-parser`).

**CI and commits**
- CI runs on Ubuntu and Windows.
- Before every commit, run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and check each exit code. Never pipe them through `tail`.
- When `pnpm lint` reports only formatting, run `pnpm format` and check again.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these is a condition the spec implies but no obvious test covers. The owning task carries a test for each:

1. **A form save of a synced fly that changes only a move override or the notes.** The fly form re-sends every leg and drops the seconds from the times. That must not set `facts_edited_at`, or the trade would stop updating forever. Test: Task 4.
2. **IBKR's cancel-and-correct.** A canceled fill re-booked under the same trade id must cancel only the original, the CZR case. Tests: Task 2 (the parser's `cancels`) and Task 5 (`markCanceled`).
3. **Wings that expire untouched.** A fly whose body was bought back at 09:52 closes at 09:52, not at the 16:20 expiry booking. Move data reads the exit stock price there. Test: Task 3.
4. **A day with no trades.** An empty `<TradeConfirms/>` (no trades today) parses to zero fills, and the sync still records a clean run. Tests: Task 2 and Task 7.
5. **Opening the app twice.** React's StrictMode double effect, or two tabs, must mean one auto-sync request per page load, and the server runs at most once per 15 minutes. Tests: Task 7 (`auto` within 15 minutes) and Task 9 (one POST under StrictMode).

---

### Task 1: The Flex Web Service client

**Files:**
- Create: `packages/importers/src/ibkr/flexClient.ts`
- Create: `packages/importers/src/ibkr/flexClient.test.ts`
- Modify: `packages/importers/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `@tj/importers`):

```ts
const FLEX_BASE: string;
type FlexErrorKind = "token" | "query" | "slow" | "unreachable" | "failed";
class FlexError extends Error { readonly kind: FlexErrorKind }
interface FlexOptions { fetch?: (url: string, init?: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; patienceMs?: number }
interface FlexClient { statement(queryId: string): Promise<string>; checkQuery(queryId: string): Promise<void> }
function ibkrFlex(token: string, options?: FlexOptions): FlexClient;
type FlexCheck = "ok" | "token_rejected" | "query_not_found" | "unreachable";
function checkFlexQuery(token: string, queryId: string, options?: FlexOptions): Promise<FlexCheck>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/importers/src/ibkr/flexClient.test.ts`:

```ts
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

/** Plays back one reply per call, or throws a given error, and records every call and every wait. */
function fake(...replies: (Response | Error)[]) {
  const calls: { url: string; userAgent: string | null }[] = [];
  const sleeps: number[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    const reply = replies.shift();
    if (!reply) throw new Error("IBKR was called more often than expected");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { client: ibkrFlex(TOKEN, { fetch, sleep }), calls, sleeps };
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
    const still = () => refused("Warn", "1019", "Statement generation in progress. Please try again shortly.");
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

  it("gives up as slow after about two minutes of 'still generating'", async () => {
    const replies = [accepted(), ...Array.from({ length: 20 }, () => refused("Warn", "1019", "In progress."))];
    const { client, sleeps } = fake(...replies);
    const error = await failure(client.statement(QUERY));
    expect(error.kind).toBe("slow");
    expect(error.message).toBe("IBKR is still preparing the statement. Try again shortly.");
    const waited = sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(waited).toBeGreaterThanOrEqual(120_000);
    expect(waited).toBeLessThan(150_000);
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/importers/src/ibkr/flexClient.test.ts`
Expected: FAIL, because `./flexClient.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/importers/src/ibkr/flexClient.ts`:

```ts
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
        if (!reference) throw new FlexError("failed", "IBKR accepted the request but sent no reference code.");
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
        const body = await get(`${url}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(reference)}&v=3`);
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
```

In `packages/importers/src/index.ts`, add `export * from "./ibkr/flexClient.js";` before the `./oquants/...` exports.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/importers/src/ibkr/flexClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/importers/src/ibkr packages/importers/src/index.ts
git commit -m "feat(importers): a client for IBKR's Flex Web Service that never leaks the token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parsing Flex statements into fills

**Files:**
- Modify: `packages/importers/package.json` (fast-xml-parser)
- Create: `packages/importers/src/ibkr/parse.ts`
- Create: `packages/importers/src/ibkr/parse.test.ts`
- Create: `packages/importers/src/ibkr/fixtures/activity.xml`, `packages/importers/src/ibkr/fixtures/today.xml`
- Modify: `packages/importers/src/index.ts`

**Interfaces:**
- Consumes: `nyWallClock` (`@tj/core`).
- Produces (exported from `@tj/importers`):

```ts
type FillKind = "trade" | "expiration" | "exercise" | "assignment";
interface ParsedFill {
  key: string; tradeId: string; orderId: string | null; conid: string;
  underlying: string; right: "C" | "P"; strike: number; expiry: string /* YYYY-MM-DD */; multiplier: number;
  tradeDate: string /* YYYY-MM-DD, New York */; executedAt: number; quantity: number /* signed */;
  price: number; commission: number /* positive dollars */; openClose: "O" | "C" | null; kind: FillKind;
  raw: Record<string, string>;
}
interface CancelRef { tradeId: string; quantity: number; price: number }
interface FlexStatementData {
  accountId: string; kind: "activity" | "confirm"; fromDate: string; toDate: string;
  fills: ParsedFill[]; cancels: CancelRef[]; ignored: { stock: number; other: number; malformed: number };
}
class FlexParseError extends Error {}
function flexTime(value: string): number;          // "20260716;135242" (New York) → epoch ms
function parseFlex(xml: string): FlexStatementData;
```

- [ ] **Step 1: Add the dependency and the fixtures**

```bash
pnpm --filter @tj/importers add fast-xml-parser
grep fast-xml-parser packages/importers/package.json
```

Expected: a `"fast-xml-parser": "^5…"` (or newer) line under `dependencies`.

Create `packages/importers/src/ibkr/fixtures/activity.xml`. It's trimmed from the user's real Activity statement, with the account renamed:
- the AA fly with its opens, closes and expiries;
- the CLF exercise and expiry, with their `OptionEAE` rows;
- CLF stock rows;
- the CZR cancel-and-correct.

```xml
<FlexQueryResponse queryName="TJ Activity" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="DU1234567" fromDate="20250926" toDate="20260925" period="Last365CalendarDays" whenGenerated="20260928;194113">
<Trades>
<Trade accountId="DU1234567" currency="USD" assetCategory="STK" symbol="CLF" description="CLEVELAND-CLIFFS INC" conid="286030327" underlyingSymbol="CLF" multiplier="1" strike="" expiry="" putCall="" tradeID="1792882250" dateTime="20260724;162000" tradeDate="20260724" transactionType="BookTrade" quantity="400" tradePrice="11.5" ibCommission="0" openCloseIndicator="O" notes="Ex" buySell="BUY" ibOrderID="10675823111" transactionID="10675823111" ibExecID="" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="STK" symbol="CLF" description="CLEVELAND-CLIFFS INC" conid="286030327" underlyingSymbol="CLF" multiplier="1" strike="" expiry="" putCall="" tradeID="1793852824" dateTime="20260727;123544" tradeDate="20260727" transactionType="ExchTrade" quantity="-100" tradePrice="11.72" ibCommission="-1.0439432" openCloseIndicator="O" notes="P" buySell="SELL" ibOrderID="729674861" transactionID="10678204901" ibExecID="00025b44.6a6836df.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00047000" description="AA 17JUL26 47 C" conid="835947148" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="C" tradeID="1785797699" dateTime="20260716;135242" tradeDate="20260716" transactionType="ExchTrade" quantity="-1" tradePrice="1.37" ibCommission="-0.7934122" openCloseIndicator="O" notes="" buySell="SELL" ibOrderID="725886161" transactionID="10648717556" ibExecID="0000e183.6a58737f.04.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00047000" description="AA 17JUL26 47 C" conid="835947148" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="C" tradeID="1785797710" dateTime="20260716;135313" tradeDate="20260716" transactionType="ExchTrade" quantity="-1" tradePrice="1.37" ibCommission="-0.7934122" openCloseIndicator="O" notes="" buySell="SELL" ibOrderID="725886168" transactionID="10648717583" ibExecID="0000e183.6a587384.04.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00047000" description="AA 17JUL26 47 C" conid="835947148" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="C" tradeID="1786309082" dateTime="20260717;094853" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.38" ibCommission="-1.0333" openCloseIndicator="C" notes="" buySell="BUY" ibOrderID="726147864" transactionID="10650330289" ibExecID="0000e183.6a59afb6.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00047000" description="AA 17JUL26 47 C" conid="835947148" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="C" tradeID="1786326799" dateTime="20260717;095200" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.27" ibCommission="-0.7873" openCloseIndicator="C" notes="" buySell="BUY" ibOrderID="726155237" transactionID="10650358562" ibExecID="0000e183.6a59b094.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00054000" description="AA 17JUL26 54 C" conid="894354032" underlyingSymbol="AA" multiplier="100" strike="54" expiry="20260717" putCall="C" tradeID="1785797128" dateTime="20260716;135242" tradeDate="20260716" transactionType="ExchTrade" quantity="1" tradePrice="0.1" ibCommission="-0.7873" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="725885759" transactionID="10648715436" ibExecID="0000e183.6a58737f.02.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00054000" description="AA 17JUL26 54 C" conid="894354032" underlyingSymbol="AA" multiplier="100" strike="54" expiry="20260717" putCall="C" tradeID="1785798241" dateTime="20260716;135313" tradeDate="20260716" transactionType="ExchTrade" quantity="1" tradePrice="0.16" ibCommission="-0.7873" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="725886524" transactionID="10648719718" ibExecID="0000e183.6a587384.02.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00054000" description="AA 17JUL26 54 C" conid="894354032" underlyingSymbol="AA" multiplier="100" strike="54" expiry="20260717" putCall="C" tradeID="1787168394" dateTime="20260717;162000" tradeDate="20260717" transactionType="BookTrade" quantity="-2" tradePrice="0" ibCommission="0" openCloseIndicator="C" notes="Ep" buySell="SELL" ibOrderID="10653829572" transactionID="10653829572" ibExecID="" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00040000" description="AA 17JUL26 40 P" conid="832607262" underlyingSymbol="AA" multiplier="100" strike="40" expiry="20260717" putCall="P" tradeID="1785797111" dateTime="20260716;135242" tradeDate="20260716" transactionType="ExchTrade" quantity="1" tradePrice="0.08" ibCommission="-0.7873" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="725885747" transactionID="10648715432" ibExecID="0000e183.6a58737f.05.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00040000" description="AA 17JUL26 40 P" conid="832607262" underlyingSymbol="AA" multiplier="100" strike="40" expiry="20260717" putCall="P" tradeID="1785798229" dateTime="20260716;135313" tradeDate="20260716" transactionType="ExchTrade" quantity="1" tradePrice="0.08" ibCommission="-0.7873" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="725886516" transactionID="10648719717" ibExecID="0000e183.6a587384.05.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00040000" description="AA 17JUL26 40 P" conid="832607262" underlyingSymbol="AA" multiplier="100" strike="40" expiry="20260717" putCall="P" tradeID="1787185242" dateTime="20260717;162000" tradeDate="20260717" transactionType="BookTrade" quantity="-2" tradePrice="0" ibCommission="0" openCloseIndicator="C" notes="Ep" buySell="SELL" ibOrderID="10653864496" transactionID="10653864496" ibExecID="" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00047000" description="AA 17JUL26 47 P" conid="835947939" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="P" tradeID="1785797770" dateTime="20260716;135242" tradeDate="20260716" transactionType="ExchTrade" quantity="-1" tradePrice="1.5" ibCommission="-0.79368" openCloseIndicator="O" notes="" buySell="SELL" ibOrderID="725886212" transactionID="10648717852" ibExecID="0000e183.6a58737f.03.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00047000" description="AA 17JUL26 47 P" conid="835947939" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="P" tradeID="1785797795" dateTime="20260716;135313" tradeDate="20260716" transactionType="ExchTrade" quantity="-1" tradePrice="1.48" ibCommission="-0.7936388" openCloseIndicator="O" notes="" buySell="SELL" ibOrderID="725886233" transactionID="10648717879" ibExecID="0000e183.6a587384.03.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00047000" description="AA 17JUL26 47 P" conid="835947939" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="P" tradeID="1786324343" dateTime="20260717;095134" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="2.14" ibCommission="-0.7673" openCloseIndicator="C" notes="" buySell="BUY" ibOrderID="726154187" transactionID="10650349329" ibExecID="0000e183.6a59b066.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00047000" description="AA 17JUL26 47 P" conid="835947939" underlyingSymbol="AA" multiplier="100" strike="47" expiry="20260717" putCall="P" tradeID="1786330251" dateTime="20260717;095210" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="2.14" ibCommission="-0.7673" openCloseIndicator="C" notes="" buySell="BUY" ibOrderID="726156619" transactionID="10650358114" ibExecID="0000e183.6a59b09b.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CLF   260724C00011500" description="CLF 24JUL26 11.5 C" conid="889375205" underlyingSymbol="CLF" multiplier="100" strike="11.5" expiry="20260724" putCall="C" tradeID="1792882249" dateTime="20260724;162000" tradeDate="20260724" transactionType="BookTrade" quantity="-4" tradePrice="0" ibCommission="0" openCloseIndicator="C" notes="Ex" buySell="SELL" ibOrderID="10675823110" transactionID="10675823110" ibExecID="" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CLF   260724P00007500" description="CLF 24JUL26 7.5 P" conid="898660652" underlyingSymbol="CLF" multiplier="100" strike="7.5" expiry="20260724" putCall="P" tradeID="1792905223" dateTime="20260724;162000" tradeDate="20260724" transactionType="BookTrade" quantity="-4" tradePrice="0" ibCommission="0" openCloseIndicator="C" notes="Ep" buySell="SELL" ibOrderID="10675872248" transactionID="10675872248" ibExecID="" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821C00030000" description="CZR 21AUG26 30 C" conid="893396239" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="C" tradeID="1786699376" dateTime="20260717;120440" tradeDate="20260717" transactionType="ExchTrade" quantity="2" tradePrice="0.73" ibCommission="-1.3666" openCloseIndicator="O" notes="P" buySell="BUY" ibOrderID="726326436" transactionID="10651107881" ibExecID="0001938c.6a59af42.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821C00030000" description="CZR 21AUG26 30 C" conid="893396239" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="C" tradeID="" dateTime="20260717;120440" tradeDate="20260717" transactionType="TradeCancel" quantity="-2" tradePrice="0.73" ibCommission="0" openCloseIndicator="" notes="Ca" buySell="BUY (Ca.)" ibOrderID="726326436" transactionID="10651118319" ibExecID="" origTradeID="1786699376" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821C00030000" description="CZR 21AUG26 30 C" conid="893396239" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="C" tradeID="1786699376" dateTime="20260717;120440" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.73" ibCommission="0.3333" openCloseIndicator="O" notes="P" buySell="BUY" ibOrderID="726326436" transactionID="10651118321" ibExecID="0001938c.6a59af42.01.02" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821C00030000" description="CZR 21AUG26 30 C" conid="893396239" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="C" tradeID="1786704333" dateTime="20260717;120619" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.73" ibCommission="-0.3333" openCloseIndicator="O" notes="P" buySell="BUY" ibOrderID="726326436" transactionID="10651118445" ibExecID="0001938c.6a59af4e.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821P00030000" description="CZR 21AUG26 30 P" conid="893397460" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="P" tradeID="1786698522" dateTime="20260717;120440" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.7" ibCommission="-1.0413" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="726326038" transactionID="10651107206" ibExecID="0001938c.6a59af43.01.01" origTradeID="" levelOfDetail="EXECUTION" />
<Trade accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CZR   260821P00030000" description="CZR 21AUG26 30 P" conid="893397460" underlyingSymbol="CZR" multiplier="100" strike="30" expiry="20260821" putCall="P" tradeID="1786707991" dateTime="20260717;120816" tradeDate="20260717" transactionType="ExchTrade" quantity="1" tradePrice="0.7" ibCommission="-0.5553" openCloseIndicator="O" notes="" buySell="BUY" ibOrderID="726330515" transactionID="10651127617" ibExecID="0001938c.6a59af56.01.01" origTradeID="" levelOfDetail="EXECUTION" />
</Trades>
<OptionEAE>
<OptionEAE accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CLF   260724C00011500" conid="889375205" underlyingSymbol="CLF" multiplier="100" strike="11.5" expiry="20260724" putCall="C" date="20260724" transactionType="Exercise" quantity="-4" tradePrice="0" markPrice="0.42" realizedPnl="0" tradeID="1792882249" />
<OptionEAE accountId="DU1234567" currency="USD" assetCategory="STK" symbol="CLF" conid="286030327" underlyingSymbol="CLF" multiplier="1" strike="" expiry="" putCall="" date="20260724" transactionType="Buy" quantity="400" tradePrice="11.5" markPrice="11.93" realizedPnl="0" tradeID="1792882250" />
<OptionEAE accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717C00054000" conid="894354032" underlyingSymbol="AA" multiplier="100" strike="54" expiry="20260717" putCall="C" date="20260717" transactionType="Expiration" quantity="-2" tradePrice="0" markPrice="0" realizedPnl="-27.5746" tradeID="1787168394" />
<OptionEAE accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="AA    260717P00040000" conid="832607262" underlyingSymbol="AA" multiplier="100" strike="40" expiry="20260717" putCall="P" date="20260717" transactionType="Expiration" quantity="-2" tradePrice="0" markPrice="0" realizedPnl="-17.5746" tradeID="1787185242" />
<OptionEAE accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="CLF   260724P00007500" conid="898660652" underlyingSymbol="CLF" multiplier="100" strike="7.5" expiry="20260724" putCall="P" date="20260724" transactionType="Expiration" quantity="-4" tradePrice="0" markPrice="0" realizedPnl="-12.63092" tradeID="1792905223" />
</OptionEAE>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>
```

Create `packages/importers/src/ibkr/fixtures/today.xml`, the user's real `TJ Today` from 2026-09-28 (the NVDA 232.5C and TSLA 365P scalps), with the account renamed:

```xml
<FlexQueryResponse queryName="TJ Today" type="TCF">
<FlexStatements count="1">
<FlexStatement accountId="DU1234567" fromDate="20260928" toDate="20260928" period="Today" whenGenerated="20260928;194114">
<TradeConfirms>
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="NVDA  260928C00232500" description="NVDA 28SEP26 232.5 C" conid="924107824" underlyingSymbol="NVDA" multiplier="100" strike="232.5" expiry="20260928" putCall="C" transactionType="ExchTrade" tradeID="1866047710" orderID="754464364" execID="0000e242.6ab9e843.01.01" dateTime="20260928;093105" tradeDate="20260928" buySell="BUY" quantity="1" price="1.06" commission="-0.8453" code="O;P" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="NVDA  260928C00232500" description="NVDA 28SEP26 232.5 C" conid="924107824" underlyingSymbol="NVDA" multiplier="100" strike="232.5" expiry="20260928" putCall="C" transactionType="ExchTrade" tradeID="1866048325" orderID="754464364" execID="0000e242.6ab9e842.01.01" dateTime="20260928;093105" tradeDate="20260928" buySell="BUY" quantity="1" price="1.06" commission="-0.0833" code="O;P" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="NVDA  260928C00232500" description="NVDA 28SEP26 232.5 C" conid="924107824" underlyingSymbol="NVDA" multiplier="100" strike="232.5" expiry="20260928" putCall="C" transactionType="ExchTrade" tradeID="1866048287" orderID="754464622" execID="0000e242.6ab9e92d.01.01" dateTime="20260928;093149" tradeDate="20260928" buySell="SELL" quantity="-1" price="1.44" commission="-0.7735564" code="C" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="NVDA  260928C00232500" description="NVDA 28SEP26 232.5 C" conid="924107824" underlyingSymbol="NVDA" multiplier="100" strike="232.5" expiry="20260928" putCall="C" transactionType="ExchTrade" tradeID="1866178141" orderID="754510269" execID="0000e242.6ab9efd8.01.01" dateTime="20260928;094612" tradeDate="20260928" buySell="SELL" quantity="-1" price="1.15" commission="-0.560959" code="C" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="TSLA  260928P00365000" description="TSLA 28SEP26 365 P" conid="923651466" underlyingSymbol="TSLA" multiplier="100" strike="365" expiry="20260928" putCall="P" transactionType="ExchTrade" tradeID="1866116935" orderID="754491537" execID="0001938b.6ab9eb2d.01.01" dateTime="20260928;093715" tradeDate="20260928" buySell="BUY" quantity="2" price="1.64" commission="-0.8346" code="O" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="TSLA  260928P00365000" description="TSLA 28SEP26 365 P" conid="923651466" underlyingSymbol="TSLA" multiplier="100" strike="365" expiry="20260928" putCall="P" transactionType="ExchTrade" tradeID="1866131698" orderID="754496715" execID="0001938b.6ab9ebb3.01.01" dateTime="20260928;093924" tradeDate="20260928" buySell="SELL" quantity="-1" price="2.11" commission="-0.5629366" code="C" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="DU1234567" currency="USD" assetCategory="OPT" symbol="TSLA  260928P00365000" description="TSLA 28SEP26 365 P" conid="923651466" underlyingSymbol="TSLA" multiplier="100" strike="365" expiry="20260928" putCall="P" transactionType="ExchTrade" tradeID="1866221947" orderID="754524970" execID="0001938b.6ab9f46a.01.01" dateTime="20260928;095259" tradeDate="20260928" buySell="SELL" quantity="-1" price="4.2" commission="-1.052222" code="C" levelOfDetail="EXECUTION" />
</TradeConfirms>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>
```

- [ ] **Step 2: Write the failing tests**

Create `packages/importers/src/ibkr/parse.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlexParseError, flexTime, parseFlex } from "./parse.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const activity = parseFlex(fixture("activity.xml"));
const today = parseFlex(fixture("today.xml"));

describe("flexTime", () => {
  it("reads IBKR's New York time, seconds included", () => {
    expect(flexTime("20260716;135242")).toBe(Date.UTC(2026, 6, 16, 17, 52, 42));
    expect(flexTime("20261201;093000")).toBe(Date.UTC(2026, 11, 1, 14, 30, 0));
  });

  it("puts a booking with a date alone at 16:20 New York", () => {
    expect(flexTime("20260725")).toBe(Date.UTC(2026, 6, 25, 20, 20));
  });
});

describe("parseFlex on an Activity statement", () => {
  it("names the account, the kind and the period", () => {
    expect(activity).toMatchObject({
      accountId: "DU1234567",
      kind: "activity",
      fromDate: "2025-09-26",
      toDate: "2026-09-25",
    });
  });

  it("turns an exchange execution into a fill, ids kept as strings and commission as positive dollars", () => {
    const fill = activity.fills.find((each) => each.key === "0000e183.6a58737f.04.01");
    expect(fill).toEqual({
      key: "0000e183.6a58737f.04.01",
      tradeId: "1785797699",
      orderId: "725886161",
      conid: "835947148",
      underlying: "AA",
      right: "C",
      strike: 47,
      expiry: "2026-07-17",
      multiplier: 100,
      tradeDate: "2026-07-16",
      executedAt: Date.UTC(2026, 6, 16, 17, 52, 42),
      quantity: -1,
      price: 1.37,
      commission: 0.7934122,
      openClose: "O",
      kind: "trade",
      raw: expect.objectContaining({ ibExecID: "0000e183.6a58737f.04.01" }),
    });
  });

  it("turns an expiry booking into an expiration at $0, keyed by its trade id", () => {
    const expiry = activity.fills.find((each) => each.key === "trade-1787168394");
    expect(expiry).toMatchObject({
      underlying: "AA",
      right: "C",
      strike: 54,
      quantity: -2,
      price: 0,
      commission: 0,
      kind: "expiration",
      openClose: "C",
      executedAt: Date.UTC(2026, 6, 17, 20, 20),
    });
  });

  it("prices an exercise at the mark IBKR gives it, not the $0 it books", () => {
    const exercise = activity.fills.find((each) => each.key === "trade-1792882249");
    expect(exercise).toMatchObject({ underlying: "CLF", right: "C", strike: 11.5, kind: "exercise", price: 0.42 });
  });

  it("returns a cancel by trade id, size and price, and keeps the correction booked under the same id", () => {
    expect(activity.cancels).toEqual([{ tradeId: "1786699376", quantity: 2, price: 0.73 }]);
    const booked = activity.fills.filter((each) => each.tradeId === "1786699376").map((each) => each.key);
    expect(booked).toEqual(["0001938c.6a59af42.01.01", "0001938c.6a59af42.01.02"]);
  });

  it("counts stock rows as ignored", () => {
    expect(activity.ignored).toEqual({ stock: 2, other: 0, malformed: 0 });
  });

  it("reads all 21 option fills", () => {
    // 24 rows: 2 stock, 1 cancel, 21 option fills.
    expect(activity.fills).toHaveLength(21);
  });
});

describe("parseFlex on a Trade Confirmation statement", () => {
  it("maps Today's field names onto the same fill shape", () => {
    expect(today).toMatchObject({ accountId: "DU1234567", kind: "confirm", fromDate: "2026-09-28" });
    expect(today.fills).toHaveLength(7);
    expect(today.fills[0]).toMatchObject({
      key: "0000e242.6ab9e843.01.01",
      orderId: "754464364",
      conid: "924107824",
      underlying: "NVDA",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
      quantity: 1,
      price: 1.06,
      commission: 0.8453,
      openClose: "O",
      kind: "trade",
      executedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
    });
    expect(today.fills.find((each) => each.key === "0000e242.6ab9e92d.01.01")?.openClose).toBe("C");
  });

  it("reads an empty statement, a day with no trades, as no fills", () => {
    const empty = fixture("today.xml").replace(/<TradeConfirms>[\s\S]*<\/TradeConfirms>/, "<TradeConfirms />");
    expect(parseFlex(empty)).toMatchObject({ fills: [], cancels: [], ignored: { stock: 0, other: 0, malformed: 0 } });
  });
});

describe("parseFlex with bad input", () => {
  it("skips a malformed row and counts it, without failing the rest", () => {
    const broken = fixture("today.xml").replace('strike="232.5"', 'strike=""');
    const parsed = parseFlex(broken);
    expect(parsed.ignored.malformed).toBe(1);
    expect(parsed.fills).toHaveLength(6);
  });

  it("refuses something that isn't a Flex statement", () => {
    expect(() => parseFlex("<html></html>")).toThrow(FlexParseError);
  });

  it("refuses a query that covers more than one account", () => {
    const two = fixture("today.xml").replace(
      /(<FlexStatement [\s\S]*<\/FlexStatement>)/,
      "$1$1",
    );
    expect(() => parseFlex(two)).toThrow("more than one account");
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run packages/importers/src/ibkr/parse.test.ts`
Expected: FAIL, because `./parse.js` doesn't exist.

- [ ] **Step 4: Implement**

Create `packages/importers/src/ibkr/parse.ts`:

```ts
import { nyWallClock } from "@tj/core";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export type FillKind = "trade" | "expiration" | "exercise" | "assignment";

/** One execution or booking, the same shape whichever statement it came from (spec §6.2). */
export interface ParsedFill {
  /** The execution id, or `trade-{tradeID}` for a booking that has none. */
  key: string;
  tradeId: string;
  orderId: string | null;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  multiplier: number;
  /** YYYY-MM-DD, New York */
  tradeDate: string;
  executedAt: number;
  /** Signed: + bought, − sold. */
  quantity: number;
  price: number;
  /** Positive dollars. */
  commission: number;
  openClose: "O" | "C" | null;
  kind: FillKind;
  raw: Record<string, string>;
}

/** A cancel names the fill it undoes by trade id, size and price: IBKR books corrections under the same trade id. */
export interface CancelRef {
  tradeId: string;
  quantity: number;
  price: number;
}

export interface FlexStatementData {
  accountId: string;
  kind: "activity" | "confirm";
  fromDate: string;
  toDate: string;
  fills: ParsedFill[];
  cancels: CancelRef[];
  ignored: { stock: number; other: number; malformed: number };
}

export class FlexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlexParseError";
  }
}

type Row = Record<string, string>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Ids like 1785797699 must stay strings.
  parseAttributeValue: false,
  parseTagValue: false,
});

const asArray = <T>(value: T | T[] | undefined | ""): T[] =>
  value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value];

const ymd = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/** IBKR's `20260716;135242`, New York time, as epoch ms. A date alone is a booking, made at 16:20. */
export function flexTime(value: string): number {
  const [date = "", time = "162000"] = value.split(";");
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(2, 4));
  const seconds = Number(time.slice(4, 6));
  return nyWallClock(ymd(date), hours * 60 + minutes) + seconds * 1000;
}

const numeric = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .refine((value) => Number.isFinite(value), "not a number");

const optionRow = z.object({
  conid: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  putCall: z.enum(["C", "P"]),
  strike: numeric,
  expiry: z.string().regex(/^\d{8}$/),
  multiplier: numeric,
  quantity: numeric.refine((value) => value !== 0, "zero quantity"),
  dateTime: z.string().regex(/^\d{8}(;\d{6})?$/),
  tradeDate: z.string().regex(/^\d{8}$/),
  tradeID: z.string().min(1),
});
type OptionRow = z.infer<typeof optionRow>;

const openCloseOf = (values: string[]): "O" | "C" | null =>
  values.includes("O") ? "O" : values.includes("C") ? "C" : null;

// `-Number("0")` is −0, which would never equal 0 in a test or a comparison.
const commissionOf = (value: string | undefined) => -Number(value || 0) || 0;

function toFill(
  base: OptionRow,
  row: Row,
  extra: Pick<ParsedFill, "key" | "orderId" | "price" | "commission" | "openClose" | "kind">,
): ParsedFill {
  return {
    ...extra,
    tradeId: base.tradeID,
    conid: base.conid,
    underlying: base.underlyingSymbol,
    right: base.putCall,
    strike: base.strike,
    expiry: ymd(base.expiry),
    multiplier: base.multiplier,
    tradeDate: ymd(base.tradeDate),
    executedAt: flexTime(base.dateTime),
    quantity: base.quantity,
    raw: row,
  };
}

/** An Activity `<Trade>` row: null when malformed, "other" when it isn't a fill this app keeps. */
function activityFill(row: Row, marks: Map<string, string>, ignored: FlexStatementData["ignored"]) {
  const parsed = optionRow.safeParse(row);
  if (!parsed.success) return null;
  const notes = (row.notes ?? "").split(";");
  let kind: FillKind;
  if (row.transactionType === "ExchTrade") kind = "trade";
  else if (row.transactionType === "BookTrade" && notes.includes("Ep")) kind = "expiration";
  else if (row.transactionType === "BookTrade" && notes.includes("Ex")) kind = "exercise";
  else if (row.transactionType === "BookTrade" && notes.includes("A")) kind = "assignment";
  else return "other" as const;

  let price = Number(row.tradePrice);
  if (kind === "exercise" || kind === "assignment") {
    // IBKR books these at $0; the leg's value at expiry is the mark on its OptionEAE row.
    const mark = Number(marks.get(parsed.data.tradeID));
    if (Number.isFinite(mark) && marks.has(parsed.data.tradeID)) price = mark;
    else {
      ignored.malformed++;
      price = 0;
    }
  }
  if (!Number.isFinite(price)) return null;
  return toFill(parsed.data, row, {
    key: row.ibExecID || `trade-${parsed.data.tradeID}`,
    orderId: row.ibOrderID || null,
    price,
    commission: commissionOf(row.ibCommission),
    openClose: openCloseOf((row.openCloseIndicator ?? "").split(";")),
    kind,
  });
}

/** A Trade Confirmation `<TradeConfirm>` row. */
function confirmFill(row: Row) {
  if (row.transactionType !== "ExchTrade") return "other" as const;
  const parsed = optionRow.safeParse(row);
  const price = Number(row.price);
  if (!parsed.success || !row.execID || !Number.isFinite(price)) return null;
  return toFill(parsed.data, row, {
    key: row.execID,
    orderId: row.orderID || null,
    price,
    commission: commissionOf(row.commission),
    openClose: openCloseOf((row.code ?? "").split(";")),
    kind: "trade",
  });
}

function cancelOf(row: Row): CancelRef | null {
  const quantity = -Number(row.quantity);
  const price = Number(row.tradePrice);
  if (!row.origTradeID || !Number.isFinite(quantity) || quantity === 0 || !Number.isFinite(price)) return null;
  return { tradeId: row.origTradeID, quantity, price };
}

/** One Flex statement, Activity or Trade Confirmation, as fills (spec §6.2). */
export function parseFlex(xml: string): FlexStatementData {
  let doc: { FlexQueryResponse?: { type?: string; FlexStatements?: { FlexStatement?: unknown } } };
  try {
    doc = parser.parse(xml);
  } catch {
    throw new FlexParseError("IBKR sent something that isn't XML.");
  }
  const response = doc.FlexQueryResponse;
  if (!response) throw new FlexParseError("IBKR sent something that isn't a Flex statement.");
  const kind = response.type === "AF" ? "activity" : response.type === "TCF" ? "confirm" : null;
  if (!kind) throw new FlexParseError("The Flex query is neither an Activity nor a Trade Confirmation query.");
  const statements = asArray(response.FlexStatements?.FlexStatement) as Record<string, unknown>[];
  if (statements.length > 1) {
    throw new FlexParseError("The Flex query covers more than one account; make one query per account.");
  }
  const statement = statements[0];
  if (!statement) throw new FlexParseError("The Flex statement names no account.");

  const section = (name: string, rowName: string) =>
    asArray((statement[name] as Record<string, Row | Row[]> | "" | undefined) || undefined)
      .flatMap((holder) => asArray(holder[rowName]));
  const marks = new Map(section("OptionEAE", "OptionEAE").map((row) => [row.tradeID ?? "", row.markPrice ?? ""]));
  const rows = kind === "activity" ? section("Trades", "Trade") : section("TradeConfirms", "TradeConfirm");

  const ignored = { stock: 0, other: 0, malformed: 0 };
  const fills: ParsedFill[] = [];
  const cancels: CancelRef[] = [];
  for (const row of rows) {
    if (row.assetCategory !== "OPT") {
      if (row.assetCategory === "STK") ignored.stock++;
      else ignored.other++;
      continue;
    }
    if (row.levelOfDetail && row.levelOfDetail !== "EXECUTION") {
      ignored.other++;
      continue;
    }
    if (row.transactionType === "TradeCancel") {
      const cancel = cancelOf(row);
      if (cancel) cancels.push(cancel);
      else ignored.malformed++;
      continue;
    }
    const fill = kind === "activity" ? activityFill(row, marks, ignored) : confirmFill(row);
    if (fill === "other") ignored.other++;
    else if (fill === null) ignored.malformed++;
    else fills.push(fill);
  }
  return {
    accountId: String(statement.accountId ?? ""),
    kind,
    fromDate: ymd(String(statement.fromDate ?? "")),
    toDate: ymd(String(statement.toDate ?? "")),
    fills,
    cancels,
    ignored,
  };
}
```

In `packages/importers/src/index.ts`, add `export * from "./ibkr/parse.js";` after the flex client export.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/importers`
Expected: PASS. If the empty-statement test fails because `<TradeConfirms />` parses to an object with no rows rather than `""`, `section()` already handles both: check `asArray(holder[rowName])` on an empty object.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/importers pnpm-lock.yaml
git commit -m "feat(importers): parse IBKR Activity and Trade Confirmation statements into one fill shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Grouping fills into scalps and flies

**Files:**
- Create: `packages/importers/src/ibkr/group.ts`
- Create: `packages/importers/src/ibkr/group.test.ts`
- Modify: `packages/importers/src/index.ts`

**Interfaces:**
- Consumes:
  - `ParsedFill`, `FillKind` and `parseFlex` (Task 2), and `uuidV5` (`oquants/ids.ts`);
  - `positionCash`, `ironFlyStructureFromLegs`, `round2`, `NewTrade`, `LegInput` and `PricedLeg` (`@tj/core`).
- Produces (exported from `@tj/importers`):

```ts
const IBKR_NAMESPACE = "7c1f2b9a-4e3d-4c8b-9a6f-2d5e8b1c3f40";
function fillIdFor(account: string, key: string): string;
function tradeIdFor(account: string, firstOpeningKey: string): string;
function legIdFor(tradeId: string, conid: string): string;
function accountIdFor(accountId: string): string;   // the journal's id for an IBKR account
interface FillForGrouping {
  id: string; key: string; conid: string; underlying: string; right: "C" | "P"; strike: number; expiry: string;
  multiplier: number; executedAt: number; quantity: number; price: number; commission: number;
  openClose: "O" | "C" | null; kind: FillKind;
}
interface TradeCandidate { id: string; trade: NewTrade; legIds: string[] /* parallel to trade.legs */; fillIds: string[] }
interface SkippedEpisode { reason: "before_start" | "unrecognised"; ticker: string; openedAt: number; fillIds: string[] }
interface Grouped { candidates: TradeCandidate[]; skipped: SkippedEpisode[]; links: Map<string, { tradeId: string; legId: string }> }
function groupFills(fills: readonly FillForGrouping[], options: { account: string; book: "live" | "paper" }): Grouped;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/importers/src/ibkr/group.test.ts`:

```ts
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type FillForGrouping, fillIdFor, groupFills, legIdFor, tradeIdFor } from "./group.js";
import { parseFlex } from "./parse.js";

const ACCOUNT = "DU1234567";
const OPTIONS = { account: ACCOUNT, book: "paper" as const };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A statement's fills as stored, with the canceled one removed as the sync would (by trade id, size and price). */
function storedFills(name: string): FillForGrouping[] {
  const statement = parseFlex(fixture(name));
  const canceled = new Set<string>();
  for (const cancel of statement.cancels) {
    const hit = statement.fills
      .filter((fill) => fill.tradeId === cancel.tradeId && fill.quantity === cancel.quantity && fill.price === cancel.price)
      .sort((a, b) => a.key.localeCompare(b.key))[0];
    if (hit) canceled.add(hit.key);
  }
  return statement.fills
    .filter((fill) => !canceled.has(fill.key))
    .map((fill) => ({ ...fill, id: fillIdFor(ACCOUNT, fill.key) }));
}

const leg = (candidate: { trade: { legs: { right: string; strike: number }[] } } | undefined, right: string, strike: number) =>
  candidate?.trade.legs.find((each) => each.right === right && each.strike === strike);

describe("groupFills on the user's scalps (TJ Today, 2026-09-28)", () => {
  const { candidates, skipped } = groupFills(storedFills("today.xml"), OPTIONS);
  const nvda = candidates.find((each) => each.trade.underlying === "NVDA");
  const tsla = candidates.find((each) => each.trade.underlying === "TSLA");

  it("makes one scalp per round trip, scaled in and out", () => {
    expect(candidates).toHaveLength(2);
    expect(skipped).toEqual([]);
    expect(nvda?.trade).toMatchObject({
      strategy: "scalp",
      book: "paper",
      source: "ibkr_flex",
      structureLabel: "Long call",
      openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
      closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
      fees: 2.26,
      feesOpen: 0.93,
      feesClose: 1.33,
      netPnl: 44.74,
    });
    expect(nvda?.trade.legs).toHaveLength(1);
    expect(nvda?.trade.legs[0]).toMatchObject({ right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2 });
    expect(nvda?.trade.legs[0]?.openPrice).toBeCloseTo(1.06, 10);
    expect(nvda?.trade.legs[0]?.closePrice).toBeCloseTo(1.295, 10);
  });

  it("nets TSLA's put +$300.55", () => {
    expect(tsla?.trade).toMatchObject({ structureLabel: "Long put", fees: 2.45, netPnl: 300.55 });
  });

  it("names each trade after its first opening fill, and each leg after its contract", () => {
    // Two NVDA buys in the same second: the smaller execution id comes first.
    expect(nvda?.id).toBe(tradeIdFor(ACCOUNT, "0000e242.6ab9e842.01.01"));
    expect(nvda?.legIds).toEqual([legIdFor(nvda?.id ?? "", "924107824")]);
  });
});

describe("groupFills on the Activity fixture", () => {
  const { candidates, skipped, links } = groupFills(storedFills("activity.xml"), OPTIONS);
  const aa = candidates.find((each) => each.trade.underlying === "AA");

  it("makes the AA fly, entered as eight single-leg orders in two lots, one iron fly", () => {
    expect(aa?.trade.strategy).toBe("iron_fly");
    expect(aa?.trade.structureLabel).toBe("Short Iron Butterfly");
    expect(aa?.trade.legs).toHaveLength(4);
    expect(leg(aa, "C", 47)).toMatchObject({ quantity: -2, openPrice: 1.37 });
    expect(leg(aa, "C", 47)?.closePrice).toBeCloseTo(0.325, 10);
    expect(leg(aa, "P", 47)?.openPrice).toBeCloseTo(1.49, 10);
    expect(leg(aa, "P", 47)).toMatchObject({ quantity: -2, closePrice: 2.14 });
    expect(leg(aa, "C", 54)).toMatchObject({ quantity: 2, closePrice: 0 });
    expect(leg(aa, "C", 54)?.openPrice).toBeCloseTo(0.13, 10);
    expect(leg(aa, "P", 40)).toMatchObject({ quantity: 2, openPrice: 0.08, closePrice: 0 });
  });

  it("agrees with oQuants on the structure and the credit, and takes IBKR's own P&L", () => {
    // oQuants: body 47, wings 40 / 54, 2 contracts, $2.65 credit (it rounds closes and books wings at 0.01).
    expect(aa?.trade.ironFly).toMatchObject({
      bodyPutStrike: 47,
      bodyCallStrike: 47,
      putWingStrike: 40,
      callWingStrike: 54,
      contracts: 2,
      netCost: -520.32,
    });
    expect(aa?.trade.ironFly?.creditPerShare).toBeCloseTo(2.65, 10);
    expect(aa?.trade).toMatchObject({ fees: 9.68, feesOpen: 6.32, feesClose: 3.36, netPnl: 27.32 });
  });

  it("closes the fly when the body was bought back, not when the untouched wings expired at 16:20", () => {
    expect(aa?.trade.openedAt).toBe(Date.UTC(2026, 6, 16, 17, 52, 42));
    expect(aa?.trade.closedAt).toBe(Date.UTC(2026, 6, 17, 13, 52, 10)); // 09:52:10 ET
  });

  it("links every AA fill to the fly and its leg", () => {
    const aaFills = storedFills("activity.xml").filter((fill) => fill.underlying === "AA");
    expect(aaFills).toHaveLength(14);
    for (const fill of aaFills) expect(links.get(fill.id)?.tradeId).toBe(aa?.id);
  });

  it("skips CLF, whose position was opened before the statement's first fill", () => {
    expect(skipped).toContainEqual(
      expect.objectContaining({ reason: "before_start", ticker: "CLF", openedAt: Date.UTC(2026, 6, 24, 20, 20) }),
    );
  });

  it("makes CZR's call and put, both bought, two open scalps, the canceled fill left out", () => {
    const czr = candidates.filter((each) => each.trade.underlying === "CZR");
    expect(czr.map((each) => each.trade.structureLabel).sort()).toEqual(["Long call", "Long put"]);
    for (const scalp of czr) {
      expect(scalp.trade).toMatchObject({ strategy: "scalp", closedAt: null, netPnl: null });
      expect(scalp.trade.legs[0]).toMatchObject({ quantity: 2, closePrice: null });
    }
    expect(czr.find((each) => each.trade.legs[0]?.right === "C")?.trade.feesOpen).toBe(0);
  });

  it("gives the same ids however the fills arrive", () => {
    const shuffled = [...storedFills("activity.xml")].reverse();
    const again = groupFills(shuffled, OPTIONS);
    expect(again.candidates.map((each) => each.id).sort()).toEqual(candidates.map((each) => each.id).sort());
  });
});

let seq = 0;
/** A synthetic fill on XYZ 50C expiring 2026-10-16, one minute after the last. */
function fill(overrides: Partial<FillForGrouping> & Pick<FillForGrouping, "quantity" | "price">): FillForGrouping {
  seq++;
  const key = overrides.key ?? `x.${String(seq).padStart(5, "0")}`;
  return {
    id: `f-${key}`,
    key,
    conid: "1",
    underlying: "XYZ",
    right: "C",
    strike: 50,
    expiry: "2026-10-16",
    multiplier: 100,
    executedAt: Date.UTC(2026, 9, 1, 14, 0) + seq * 60_000,
    commission: 1,
    openClose: null,
    kind: "trade",
    ...overrides,
  };
}

describe("groupFills rules", () => {
  it("splits two round trips in one contract into two scalps", () => {
    const { candidates } = groupFills(
      [fill({ quantity: 1, price: 1 }), fill({ quantity: -1, price: 2 }), fill({ quantity: 1, price: 1 }), fill({ quantity: -1, price: 1.5 })],
      OPTIONS,
    );
    expect(candidates.map((each) => each.trade.netPnl)).toEqual([98, 48]);
  });

  it("keeps a bought contract that hasn't been sold as an open scalp", () => {
    const { candidates } = groupFills([fill({ quantity: 3, price: 2 })], OPTIONS);
    expect(candidates[0]?.trade).toMatchObject({ closedAt: null, netPnl: null });
  });

  it("skips a structure that isn't an iron fly, such as a short strangle", () => {
    const { candidates, skipped } = groupFills(
      [
        fill({ conid: "c", right: "C", strike: 55, quantity: -1, price: 1 }),
        fill({ conid: "p", right: "P", strike: 45, quantity: -1, price: 1 }),
      ],
      OPTIONS,
    );
    expect(candidates).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason: "unrecognised", ticker: "XYZ" })]);
  });

  it("adds the fees from their rounded parts, as the forms do, so re-saving a trade can't move them by a cent", () => {
    // 0.006 + 0.006 is 0.01 as a total, but 0.01 + 0.01 as parts. The forms add the parts.
    const { candidates } = groupFills(
      [fill({ quantity: 1, price: 1, commission: 0.006 }), fill({ quantity: -1, price: 1.5, commission: 0.006 })],
      OPTIONS,
    );
    expect(candidates[0]?.trade).toMatchObject({ feesOpen: 0.01, feesClose: 0.01, fees: 0.02, netPnl: 49.98 });
  });

  it("puts every fill in exactly one trade, and the trades' P&L adds up to the fills' cash (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lots: fc.integer({ min: 1, max: 5 }),
            buy: fc.integer({ min: 5, max: 1_000 }),
            sell: fc.integer({ min: 0, max: 2_000 }),
            fee: fc.integer({ min: 0, max: 300 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (trips) => {
          const fills = trips.flatMap((trip) => [
            fill({ quantity: trip.lots, price: trip.buy / 100, commission: trip.fee / 100 }),
            fill({ quantity: -trip.lots, price: trip.sell / 100, commission: trip.fee / 100 }),
          ]);
          const { candidates, links } = groupFills(fills, OPTIONS);
          expect(candidates).toHaveLength(trips.length);
          expect(fills.every((each) => links.has(each.id))).toBe(true);
          const total = candidates.reduce((sum, each) => sum + (each.trade.netPnl ?? 0), 0);
          const cash = trips.reduce((sum, trip) => sum + trip.lots * (trip.sell - trip.buy) - (2 * trip.fee) / 100, 0);
          // positionCash rounds the gross, the fees and the net to cents: at most 1.5 cents per trade.
          expect(Math.abs(total - cash)).toBeLessThanOrEqual(0.02 * trips.length);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/importers/src/ibkr/group.test.ts`
Expected: FAIL, because `./group.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/importers/src/ibkr/group.ts`:

```ts
import {
  ironFlyStructureFromLegs,
  type LegInput,
  type NewTrade,
  type PricedLeg,
  positionCash,
  round2,
} from "@tj/core";
import { uuidV5 } from "../oquants/ids.js";
import type { FillKind } from "./parse.js";

/** Fixed namespace for IBKR ids; changing it would make every synced trade new. */
export const IBKR_NAMESPACE = "7c1f2b9a-4e3d-4c8b-9a6f-2d5e8b1c3f40";

export const fillIdFor = (account: string, key: string) => uuidV5(`ibkr:${account}:${key}`, IBKR_NAMESPACE);
export const tradeIdFor = (account: string, firstOpeningKey: string) =>
  uuidV5(`ibkr:${account}:${firstOpeningKey}`, IBKR_NAMESPACE);
export const legIdFor = (tradeId: string, conid: string) => uuidV5(`${tradeId}:${conid}`, IBKR_NAMESPACE);
export const accountIdFor = (accountId: string) => uuidV5(`ibkr-account:${accountId}`, IBKR_NAMESPACE);

/** A stored fill, as grouping needs it. */
export interface FillForGrouping {
  id: string;
  key: string;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  multiplier: number;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  openClose: "O" | "C" | null;
  kind: FillKind;
}

export interface TradeCandidate {
  id: string;
  trade: NewTrade;
  /** Parallel to `trade.legs`. */
  legIds: string[];
  fillIds: string[];
}

export interface SkippedEpisode {
  reason: "before_start" | "unrecognised";
  ticker: string;
  openedAt: number;
  fillIds: string[];
}

export interface Grouped {
  candidates: TradeCandidate[];
  skipped: SkippedEpisode[];
  links: Map<string, { tradeId: string; legId: string }>;
}

interface GroupOptions {
  account: string;
  book: "live" | "paper";
}

const byTime = (a: FillForGrouping, b: FillForGrouping) =>
  a.executedAt - b.executedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
/** Size-weighted average price, to 6 decimals, so an edit form shows 1.49 rather than 1.4899999999999998. */
const averagePrice = (fills: FillForGrouping[]) =>
  Math.round(
    (sum(fills.map((fill) => Math.abs(fill.quantity) * fill.price)) / sum(fills.map((fill) => Math.abs(fill.quantity)))) *
      1e6,
  ) / 1e6;

function byContract(fills: FillForGrouping[]): FillForGrouping[][] {
  const contracts = new Map<string, FillForGrouping[]>();
  for (const fill of fills) {
    const list = contracts.get(fill.conid);
    if (list) list.push(fill);
    else contracts.set(fill.conid, [fill]);
  }
  return [...contracts.values()];
}

/** One contract's fills split flat to flat. */
function roundTrips(fills: FillForGrouping[]): FillForGrouping[][] {
  const trips: FillForGrouping[][] = [];
  let trip: FillForGrouping[] = [];
  let position = 0;
  for (const fill of fills) {
    trip.push(fill);
    position += fill.quantity;
    if (position === 0) {
      trips.push(trip);
      trip = [];
    }
  }
  if (trip.length > 0) trips.push(trip);
  return trips;
}

/**
 * IBKR's fills regrouped into trades by position episode (spec §7): per ticker and expiry, flat to flat.
 * An episode that only bought is scalps, one per contract round trip; one that opened by selling calls and
 * puts is an iron fly; anything else is skipped with its reason.
 */
export function groupFills(fills: readonly FillForGrouping[], options: GroupOptions): Grouped {
  const out: Grouped = { candidates: [], skipped: [], links: new Map() };
  const buckets = new Map<string, FillForGrouping[]>();
  for (const fill of [...fills].sort(byTime)) {
    const key = `${fill.underlying}|${fill.expiry}`;
    const list = buckets.get(key);
    if (list) list.push(fill);
    else buckets.set(key, [fill]);
  }
  for (const bucket of buckets.values()) {
    let episode: FillForGrouping[] = [];
    const position = new Map<string, number>();
    for (const fill of bucket) {
      episode.push(fill);
      position.set(fill.conid, (position.get(fill.conid) ?? 0) + fill.quantity);
      if ([...position.values()].every((quantity) => quantity === 0)) {
        settle(episode, out, options);
        episode = [];
        position.clear();
      }
    }
    if (episode.length > 0) settle(episode, out, options);
  }
  out.candidates.sort((a, b) => a.trade.openedAt - b.trade.openedAt);
  return out;
}

function settle(episode: FillForGrouping[], out: Grouped, options: GroupOptions): void {
  const skip = (reason: SkippedEpisode["reason"]) =>
    out.skipped.push({
      reason,
      ticker: episode[0]?.underlying ?? "",
      openedAt: episode[0]?.executedAt ?? 0,
      fillIds: episode.map((fill) => fill.id),
    });
  const contracts = byContract(episode);
  // A contract whose first fill closes a position was opened before the fills we have.
  if (contracts.some((fills) => fills[0]?.openClose === "C")) return skip("before_start");

  const openedBySelling = contracts.some((fills) => (fills[0]?.quantity ?? 0) < 0);
  if (!openedBySelling) {
    for (const fills of contracts) for (const trip of roundTrips(fills)) addTrade([trip], "scalp", out, options);
    return;
  }
  const opened = (right: "C" | "P", short: boolean) =>
    contracts.filter((fills) => fills[0]?.right === right && (fills[0]?.quantity ?? 0) < 0 === short).length;
  const isFly =
    opened("C", true) === 1 &&
    opened("P", true) === 1 &&
    opened("C", false) <= 1 &&
    opened("P", false) <= 1 &&
    opened("C", false) + opened("P", false) >= 1;
  if (!isFly) return skip("unrecognised");
  addTrade(contracts, "iron_fly", out, options);
}

function addTrade(
  legFills: FillForGrouping[][],
  strategy: "scalp" | "iron_fly",
  out: Grouped,
  options: GroupOptions,
): void {
  const all = legFills.flat().sort(byTime);
  const openingIds = new Set<string>();
  for (const fills of legFills) {
    const sign = Math.sign(fills[0]?.quantity ?? 0);
    for (const fill of fills) if (Math.sign(fill.quantity) === sign) openingIds.add(fill.id);
  }
  const firstOpening = all.find((fill) => openingIds.has(fill.id)) ?? all[0];
  if (!firstOpening) return;
  const tradeId = tradeIdFor(options.account, firstOpening.key);

  const legs: LegInput[] = [];
  const legIds: string[] = [];
  let feesOpen = 0;
  let feesClose = 0;
  let flat = true;
  for (const fills of legFills) {
    const first = fills[0];
    if (!first) continue;
    const opening = fills.filter((fill) => openingIds.has(fill.id));
    const closing = fills.filter((fill) => !openingIds.has(fill.id));
    const legFlat = sum(fills.map((fill) => fill.quantity)) === 0;
    if (!legFlat) flat = false;
    feesOpen += sum(opening.map((fill) => fill.commission));
    feesClose += sum(closing.map((fill) => fill.commission));
    legs.push({
      right: first.right,
      strike: first.strike,
      expiry: first.expiry,
      quantity: sum(opening.map((fill) => fill.quantity)),
      multiplier: first.multiplier,
      openPrice: averagePrice(opening),
      closePrice: legFlat && closing.length > 0 ? averagePrice(closing) : null,
    });
    const legId = legIdFor(tradeId, first.conid);
    legIds.push(legId);
    for (const fill of fills) out.links.set(fill.id, { tradeId, legId });
  }

  const priced: PricedLeg[] = legs.map((leg) => ({
    right: leg.right,
    strike: leg.strike,
    quantity: leg.quantity,
    multiplier: leg.multiplier,
    openPrice: leg.openPrice,
    closePrice: leg.closePrice,
  }));
  // From the rounded parts, as the forms add them: re-saving an unchanged trade must not move its fees by a cent.
  const cash = positionCash(priced, { open: round2(feesOpen), close: round2(feesClose) });
  // Untouched wings expire at 16:20; the trade was closed when its last exchange fill closed it.
  const closings = all.filter((fill) => !openingIds.has(fill.id));
  const lastExchangeClose = closings.filter((fill) => fill.kind === "trade").at(-1);
  const closedAt = flat ? (lastExchangeClose ?? closings.at(-1) ?? all.at(-1))?.executedAt ?? null : null;
  const structure = strategy === "iron_fly" ? ironFlyStructureFromLegs(priced) : null;

  const trade: NewTrade = {
    strategy,
    book: options.book,
    underlying: firstOpening.underlying,
    underlyingName: null,
    structureLabel: strategy === "iron_fly" ? "Short Iron Butterfly" : firstOpening.right === "C" ? "Long call" : "Long put",
    openedAt: all[0]?.executedAt ?? firstOpening.executedAt,
    closedAt,
    netPnl: cash.netPnl,
    fees: cash.fees,
    feesOpen: round2(feesOpen),
    feesClose: round2(feesClose),
    notes: null,
    grade: null,
    excluded: false,
    excludeReason: null,
    source: "ibkr_flex",
    setupId: null,
    tagIds: [],
    legs,
    ironFly: structure
      ? {
          ...structure,
          contracts: cash.contracts,
          creditPerShare: -(cash.netCost - cash.fees) / cash.shares,
          netCost: cash.netCost,
          earningsDate: null,
          earningsTiming: null,
          impliedMovePct: null,
          actualMovePct: null,
          ivBefore: null,
          ivAfter: null,
          sourceNotes: null,
        }
      : null,
  };
  out.candidates.push({ id: tradeId, trade, legIds, fillIds: all.map((fill) => fill.id) });
}
```

In `packages/importers/src/index.ts`, add `export * from "./ibkr/group.js";` after the parse export.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/importers`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/importers
git commit -m "feat(importers): regroup IBKR fills into scalps and iron flies by position episode

IBKR sends every fly leg as its own order, so grouping goes by position,
flat to flat per ticker and expiry, not by order id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration 0003, and the user's edits marked

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create (generated): `packages/db/migrations/0003_ibkr_sync.sql`, `packages/db/migrations/meta/0003_snapshot.json`, and a `_journal.json` entry
- Modify: `packages/db/src/repositories/trades.ts`
- Test: `packages/db/src/repositories/trades.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**
- Consumes: `sessionMoment` (`@tj/core`, already used by `stalePrices`).
- Produces (exported from `@tj/db`):
  - the `schema.fills` and `schema.syncState` tables;
  - `trades.factsEditedAt` (`number | null`), which every `TradeRecord`, and so the API's trades, now carry;
  - `changesFacts(existing: TradeRecord, patch: TradePatch): boolean`;
  - `stalePrices(existing: TradeRow, patch: Pick<TradePatch, "underlying" | "openedAt" | "closedAt">)`, now exported for the ibkr repo;
  - `repo.update` sets `factsEditedAt` when `changesFacts`;
  - `repo.clearFactsEdited(id: string): boolean`, which clears it on an IBKR trade and returns false otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/repositories/trades.test.ts`:

```ts
describe("facts the user edited", () => {
  // As a sync stores them: to the second.
  const OPEN = Date.UTC(2026, 8, 9, 19, 54, 37);
  const CLOSE = Date.UTC(2026, 8, 10, 19, 44, 12);
  const minute = (at: number) => Math.floor(at / 60_000) * 60_000;
  const details = sampleFly.ironFly as IronFlyDetailsInput;
  let db: Db;
  let clock = 1_000;
  const repo = () => createTradesRepo(db, () => clock);

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-repo-")), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    db = openDatabase(file);
    clock = 1_000;
  });

  const created = () => repo().create({ ...sampleFly, openedAt: OPEN, closedAt: CLOSE }).id;
  const factsEditedAt = (id: string) => repo().get(id)?.factsEditedAt;

  it("marks a trade whose leg the user changed", () => {
    const id = created();
    clock = 2_000;
    const legs = (sampleFly.legs ?? []).map((leg, index) => (index === 0 ? { ...leg, closePrice: 0.9 } : leg));
    repo().update(id, { legs });
    expect(factsEditedAt(id)).toBe(2_000);
  });

  it("doesn't mark it for notes, exclude or a move override", () => {
    const id = created();
    repo().update(id, { notes: "held too long", excluded: true });
    repo().update(id, { ironFly: { ...details, impliedMovePct: 7.3 } });
    expect(factsEditedAt(id)).toBeNull();
  });

  it("doesn't mark it for a form save that sends the same facts back, with the seconds dropped", () => {
    const id = created();
    const stored = repo().get(id);
    if (!stored) throw new Error("missing");
    repo().update(id, {
      strategy: "iron_fly",
      book: stored.book as "live",
      underlying: stored.underlying,
      structureLabel: stored.structureLabel,
      openedAt: minute(OPEN),
      closedAt: minute(CLOSE),
      netPnl: stored.netPnl,
      fees: stored.fees,
      feesOpen: stored.feesOpen,
      feesClose: stored.feesClose,
      // The form sends every leg, in its own order.
      legs: [...stored.legs].reverse().map((leg) => ({
        right: leg.right as "C" | "P",
        strike: leg.strike,
        expiry: leg.expiry,
        quantity: leg.quantity,
        multiplier: leg.multiplier,
        openPrice: leg.openPrice,
        closePrice: leg.closePrice,
      })),
      ironFly: { ...details, impliedMovePct: 6.8 },
    });
    expect(factsEditedAt(id)).toBeNull();
  });

  it("marks it when a time moves to another minute, or the P&L changes", () => {
    const first = created();
    repo().update(first, { closedAt: CLOSE + 60_000 });
    expect(factsEditedAt(first)).not.toBeNull();
    const second = created();
    repo().update(second, { netPnl: 400 });
    expect(factsEditedAt(second)).not.toBeNull();
  });

  it("clears the mark on an IBKR trade, and refuses any other", () => {
    const id = repo().create({ ...sampleFly, source: "ibkr_flex" }).id;
    repo().update(id, { netPnl: 400 });
    expect(repo().clearFactsEdited(id)).toBe(true);
    expect(factsEditedAt(id)).toBeNull();
    const typed = created();
    expect(repo().clearFactsEdited(typed)).toBe(false);
  });
});
```

In `packages/db/src/migrate.test.ts`, add inside `describe("runMigrations", …)`:

```ts
  it("adds the fills and sync_state tables, and the facts_edited_at column", () => {
    const file = join(tempDir(), "journal.db");
    runMigrations(file, { migrationsFolder: MIGRATIONS });
    const db = openDatabase(file);
    const columns = (table: string) =>
      db.all<{ name: string }>(sql.raw(`pragma table_info(${table})`)).map((column) => column.name);
    expect(columns("fills")).toEqual(
      expect.arrayContaining(["broker_exec_key", "broker_trade_id", "open_close", "kind", "origin", "canceled", "raw"]),
    );
    expect(columns("sync_state")).toEqual(expect.arrayContaining(["source", "account_id", "last_summary"]));
    expect(columns("trades")).toContain("facts_edited_at");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db`
Expected: FAIL. `factsEditedAt` and `clearFactsEdited` don't exist, and the tables are missing.

- [ ] **Step 3: Add the schema and generate the migration**

In `packages/db/src/schema.ts`, add to `trades`, after `editedAt`:

```ts
    /** The user changed a broker fact on this trade, so the sync stops writing it (spec §5.3). */
    factsEditedAt: integer("facts_edited_at"),
```

and append at the end of the file:

```ts
/** One IBKR execution, expiry, exercise or assignment: a fact only the sync writes (spec §5.1). */
export const fills = sqliteTable(
  "fills",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** The execution id, or `trade-{tradeID}` for a booking without one. */
    brokerExecKey: text("broker_exec_key").notNull(),
    brokerTradeId: text("broker_trade_id").notNull(),
    brokerOrderId: text("broker_order_id"),
    conid: text("conid").notNull(),
    underlying: text("underlying").notNull(),
    /** 'C' | 'P' */
    right: text("right").notNull(),
    strike: real("strike").notNull(),
    /** YYYY-MM-DD */
    expiry: text("expiry").notNull(),
    multiplier: integer("multiplier").notNull(),
    /** YYYY-MM-DD, New York */
    tradeDate: text("trade_date").notNull(),
    executedAt: integer("executed_at").notNull(),
    /** Signed: + bought, − sold. */
    quantity: integer("quantity").notNull(),
    price: real("price").notNull(),
    /** Positive dollars. */
    commission: real("commission").notNull(),
    /** 'O' | 'C' */
    openClose: text("open_close"),
    /** 'trade' | 'expiration' | 'exercise' | 'assignment' */
    kind: text("kind").notNull(),
    /** 'confirm' | 'activity': the statement that last wrote the row. */
    origin: text("origin").notNull(),
    canceled: integer("canceled", { mode: "boolean" }).notNull().default(false),
    tradeId: text("trade_id").references(() => trades.id),
    legId: text("leg_id"),
    /** The source row as JSON, for audit. */
    raw: text("raw").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("fills_account_time_idx").on(table.accountId, table.executedAt),
    index("fills_trade_idx").on(table.tradeId),
  ],
);

/** The last sync run of a source. Keyed by source: a run can fail before any account is known. */
export const syncState = sqliteTable("sync_state", {
  /** 'ibkr' */
  source: text("source").primaryKey(),
  accountId: text("account_id").references(() => accounts.id),
  lastRunAt: integer("last_run_at").notNull(),
  /** 'ok' | 'error' */
  lastStatus: text("last_status").notNull(),
  lastError: text("last_error"),
  /** The run's summary, as JSON. */
  lastSummary: text("last_summary"),
});
```

Generate the migration and read it:

```bash
pnpm --filter @tj/db exec drizzle-kit generate --name ibkr_sync
cat packages/db/migrations/0003_ibkr_sync.sql
```

Expected:
- `CREATE TABLE \`fills\``, with its two foreign keys;
- the two `CREATE INDEX` statements;
- `CREATE TABLE \`sync_state\``;
- `ALTER TABLE \`trades\` ADD \`facts_edited_at\` integer;`.

It must **not** contain `__new_trades` or `PRAGMA foreign_keys=OFF`, which would mean a table rebuild. If it does, stop and ask.

- [ ] **Step 4: Mark and clear edited facts in the repository**

In `packages/db/src/repositories/trades.ts`:
- export `stalePrices`, and widen its patch type to `Pick<TradePatch, "underlying" | "openedAt" | "closedAt">`. The body is unchanged.
- add below it:

```ts
const SYNC_SCALARS = [
  "strategy",
  "book",
  "underlying",
  "structureLabel",
  "netPnl",
  "fees",
  "feesOpen",
  "feesClose",
] as const;
const FLY_STRUCTURE = [
  "bodyPutStrike",
  "bodyCallStrike",
  "putWingStrike",
  "callWingStrike",
  "contracts",
  "creditPerShare",
  "netCost",
] as const;

/** The edit forms keep minutes, not seconds, so a time only changes when its minute does. */
const minuteOf = (at: number | null | undefined) => (at == null ? null : Math.floor(at / 60_000));

const legKey = (leg: {
  right: string;
  strike: number;
  expiry: string;
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}) => JSON.stringify([leg.right, leg.strike, leg.expiry, leg.quantity, leg.multiplier, leg.openPrice, leg.closePrice]);

/**
 * Whether a patch changes a broker fact: a leg, a price, a size, a time (to the minute), fees, P&L or a fly's
 * structure (spec §5.3). The forms send every fact on each save, so values are compared, not just keys.
 */
export function changesFacts(existing: TradeRecord, patch: TradePatch): boolean {
  for (const key of SYNC_SCALARS) {
    if (patch[key] !== undefined && patch[key] !== existing[key]) return true;
  }
  if (patch.openedAt !== undefined && minuteOf(patch.openedAt) !== minuteOf(existing.openedAt)) return true;
  if (patch.closedAt !== undefined && minuteOf(patch.closedAt) !== minuteOf(existing.closedAt)) return true;
  if (patch.legs !== undefined) {
    const before = existing.legs.map(legKey).sort();
    const after = patch.legs.map(legKey).sort();
    if (before.length !== after.length || before.some((key, index) => key !== after[index])) return true;
  }
  if (patch.ironFly !== undefined) {
    if (!patch.ironFly || !existing.ironFly) return Boolean(patch.ironFly) !== Boolean(existing.ironFly);
    for (const key of FLY_STRUCTURE) {
      if (patch.ironFly[key] !== existing.ironFly[key]) return true;
    }
  }
  return false;
}
```

In `update`, replace the trades update inside the transaction with:

```ts
      const factsEdited = changesFacts(hydrate(db, existing), patch);
      return db.transaction((tx) => {
        tx.update(trades)
          .set({
            ...columns,
            updatedAt: timestamp,
            editedAt: timestamp,
            ...(factsEdited ? { factsEditedAt: timestamp } : {}),
          })
          .where(eq(trades.id, id))
          .run();
```

(The rest of the transaction is unchanged; remove the old `return db.transaction((tx) => {` and the old `.set(…)` it replaces.)

Add this method after `softDelete`:

```ts
    /** "Use IBKR's numbers": the next sync may write this trade again. Only IBKR trades carry the mark. */
    clearFactsEdited(id: string): boolean {
      const result = db
        .update(trades)
        .set({ factsEditedAt: null, updatedAt: now() })
        .where(and(eq(trades.id, id), eq(trades.source, "ibkr_flex"), isNull(trades.deletedAt)))
        .run();
      return result.changes > 0;
    },
```

In `packages/db/src/migrate.test.ts`, the new test uses `sql`, which the file already imports from the move-data work.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/db`
Expected: PASS, including every existing repository test.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db
git commit -m "feat(db): fills and sync state tables, and mark trades whose facts the user edited

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The IBKR repository

**Files:**
- Create: `packages/db/src/repositories/ibkr.ts`
- Create: `packages/db/src/repositories/ibkr.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: the Task 4 schema, `stalePrices`, `NewTrade`, and `nyDate` (`@tj/core`).
- Produces (exported from `@tj/db`):

```ts
type FillRow = typeof fills.$inferSelect;
interface FillInput {
  id: string; brokerExecKey: string; brokerTradeId: string; brokerOrderId: string | null; conid: string;
  underlying: string; right: "C" | "P"; strike: number; expiry: string; multiplier: number; tradeDate: string;
  executedAt: number; quantity: number; price: number; commission: number; openClose: "O" | "C" | null;
  kind: "trade" | "expiration" | "exercise" | "assignment"; raw: Record<string, string>;
}
interface CancelInput { brokerTradeId: string; quantity: number; price: number }
interface SyncedTradeInput { id: string; trade: NewTrade; legIds: string[] }
type ApplyResult = "added" | "updated" | "unchanged" | "deleted" | "kept_edits";
interface IbkrAccount { id: string; externalId: string; kind: "paper" | "live" }
interface SyncRun { at: number; status: "ok" | "error"; error: string | null; summary: unknown; accountId: string | null }
interface LastRun { accountId: string | null; lastRunAt: number; lastStatus: "ok" | "error"; lastError: string | null; lastSummary: unknown }
function createIbkrRepo(db: Db, now?: () => number): {
  ensureAccount(account: IbkrAccount): void;
  storeFills(accountId: string, fills: FillInput[], origin: "confirm" | "activity"): { inserted: number; updated: number };
  markCanceled(accountId: string, cancels: CancelInput[]): number;
  fillsSince(accountId: string, since: string): FillRow[];
  fillsForTrade(tradeId: string): FillRow[];
  tradeExists(id: string): boolean;
  isDuplicate(candidate: SyncedTradeInput): boolean;
  syncedFrom(trade: NewTrade): boolean;
  apply(candidate: SyncedTradeInput, accountId: string): ApplyResult;
  softDeleteOrphans(accountId: string, produced: ReadonlySet<string>, since: string): number;
  linkFills(accountId: string, links: ReadonlyMap<string, { tradeId: string; legId: string }>): void;
  recordRun(run: SyncRun): void;
  lastRun(): LastRun | null;
};
```

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/repositories/ibkr.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewTrade } from "@tj/core";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { type FillInput, type SyncedTradeInput, createIbkrRepo } from "./ibkr.js";
import { createTradesRepo } from "./trades.js";

const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));
const ACCOUNT = { id: "acct-1", externalId: "DU1234567", kind: "paper" as const };
const OPEN = Date.UTC(2026, 8, 28, 13, 31, 5); // 09:31:05 ET
const CLOSE = Date.UTC(2026, 8, 28, 13, 46, 12);

let db: Db;
let clock = 1_000;
const ibkr = () => createIbkrRepo(db, () => clock);
const trades = () => createTradesRepo(db, () => clock);

beforeEach(() => {
  const file = join(mkdtempSync(join(tmpdir(), "tj-ibkr-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  db = openDatabase(file);
  clock = 1_000;
  ibkr().ensureAccount(ACCOUNT);
});

let seq = 0;
function fillInput(overrides: Partial<FillInput> = {}): FillInput {
  seq++;
  return {
    id: `fill-${seq}`,
    brokerExecKey: `exec.${seq}`,
    brokerTradeId: `t${seq}`,
    brokerOrderId: `o${seq}`,
    conid: "924107824",
    underlying: "NVDA",
    right: "C",
    strike: 232.5,
    expiry: "2026-09-28",
    multiplier: 100,
    tradeDate: "2026-09-28",
    executedAt: OPEN,
    quantity: 1,
    price: 1.06,
    commission: 0.85,
    openClose: "O",
    kind: "trade",
    raw: {},
    ...overrides,
  };
}

/** The NVDA scalp as the grouper would hand it over. */
function scalp(overrides: Partial<NewTrade> = {}, id = "trade-nvda"): SyncedTradeInput {
  const trade: NewTrade = {
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    underlyingName: null,
    structureLabel: "Long call",
    openedAt: OPEN,
    closedAt: CLOSE,
    netPnl: 44.74,
    fees: 2.26,
    feesOpen: 0.93,
    feesClose: 1.33,
    notes: null,
    grade: null,
    excluded: false,
    excludeReason: null,
    source: "ibkr_flex",
    setupId: null,
    tagIds: [],
    legs: [
      { right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06, closePrice: 1.295 },
    ],
    ironFly: null,
    ...overrides,
  };
  return { id, trade, legIds: [`${id}-leg`] };
}

/** An AA fly: short 47 straddle, wings 40 / 54, 2 lots. */
function fly(overrides: Partial<NewTrade> = {}, id = "trade-aa"): SyncedTradeInput {
  const legs = [
    { right: "C" as const, strike: 47, expiry: "2026-07-17", quantity: -2, multiplier: 100, openPrice: 1.37, closePrice: 0.325 },
    { right: "P" as const, strike: 47, expiry: "2026-07-17", quantity: -2, multiplier: 100, openPrice: 1.49, closePrice: 2.14 },
    { right: "C" as const, strike: 54, expiry: "2026-07-17", quantity: 2, multiplier: 100, openPrice: 0.13, closePrice: 0 },
    { right: "P" as const, strike: 40, expiry: "2026-07-17", quantity: 2, multiplier: 100, openPrice: 0.08, closePrice: 0 },
  ];
  const trade: NewTrade = {
    ...scalp().trade,
    strategy: "iron_fly",
    underlying: "AA",
    structureLabel: "Short Iron Butterfly",
    openedAt: Date.UTC(2026, 6, 16, 17, 52, 42),
    closedAt: Date.UTC(2026, 6, 17, 13, 52, 10),
    netPnl: 27.32,
    fees: 9.68,
    feesOpen: 6.32,
    feesClose: 3.36,
    legs,
    ironFly: {
      bodyPutStrike: 47,
      bodyCallStrike: 47,
      putWingStrike: 40,
      callWingStrike: 54,
      contracts: 2,
      creditPerShare: 2.65,
      netCost: -520.32,
      earningsDate: null,
      earningsTiming: null,
      impliedMovePct: null,
      actualMovePct: null,
      ivBefore: null,
      ivAfter: null,
      sourceNotes: null,
    },
    ...overrides,
  };
  return { id, trade, legIds: [`${id}-47c`, `${id}-47p`, `${id}-54c`, `${id}-40p`] };
}

describe("storing fills", () => {
  it("inserts new fills, and lets Activity's version replace Today's", () => {
    const today = fillInput({ commission: 0.85 });
    expect(ibkr().storeFills(ACCOUNT.id, [today], "confirm")).toEqual({ inserted: 1, updated: 0 });
    expect(ibkr().storeFills(ACCOUNT.id, [{ ...today, commission: 0.8453 }], "activity")).toEqual({
      inserted: 0,
      updated: 1,
    });
    expect(ibkr().storeFills(ACCOUNT.id, [{ ...today, commission: 9 }], "confirm")).toEqual({ inserted: 0, updated: 0 });
    expect(ibkr().fillsSince(ACCOUNT.id, "2026-09-28")[0]).toMatchObject({ commission: 0.8453, origin: "activity" });
  });

  it("cancels only the fill a cancel names by trade id, size and price, not the correction booked under that id", () => {
    const original = fillInput({ brokerExecKey: "a.01.01", brokerTradeId: "1786699376", quantity: 2, price: 0.73 });
    const correction = fillInput({ brokerExecKey: "a.01.02", brokerTradeId: "1786699376", quantity: 1, price: 0.73 });
    ibkr().storeFills(ACCOUNT.id, [original, correction], "activity");
    const cancel = { brokerTradeId: "1786699376", quantity: 2, price: 0.73 };
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(1);
    expect(ibkr().markCanceled(ACCOUNT.id, [cancel])).toBe(0);
    expect(ibkr().fillsSince(ACCOUNT.id, "2026-09-28").map((fill) => fill.brokerExecKey)).toEqual(["a.01.02"]);
  });

  it("leaves fills before the start date out of what's regrouped", () => {
    ibkr().storeFills(ACCOUNT.id, [fillInput({ tradeDate: "2026-09-25" }), fillInput()], "activity");
    expect(ibkr().fillsSince(ACCOUNT.id, "2026-09-28")).toHaveLength(1);
  });
});

describe("applying a synced trade", () => {
  it("adds a new trade as the sync's, with its leg ids", () => {
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("added");
    const stored = trades().get("trade-nvda");
    expect(stored).toMatchObject({ source: "ibkr_flex", accountId: ACCOUNT.id, editedAt: null, netPnl: 44.74 });
    expect(stored?.legs.map((leg) => leg.id)).toEqual(["trade-nvda-leg"]);
  });

  it("leaves an unchanged trade alone, updatedAt included", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    clock = 5_000;
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("unchanged");
    expect(trades().get("trade-nvda")?.updatedAt).toBe(1_000);
  });

  it("rewrites only its own side, keeping the user's notes and a fly's overrides", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    trades().update("trade-aa", { notes: "earnings pop", ironFly: { ...(fly().trade.ironFly as NonNullable<NewTrade["ironFly"]>), impliedMovePct: 7.1 } });
    clock = 5_000;
    expect(ibkr().apply(fly({ netPnl: 27.5, fees: 9.5 }), ACCOUNT.id)).toBe("updated");
    const stored = trades().get("trade-aa");
    expect(stored).toMatchObject({ netPnl: 27.5, notes: "earnings pop", updatedAt: 5_000 });
    expect(stored?.ironFly?.impliedMovePct).toBe(7.1);
  });

  it("clears a stock price the new close time made stale", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    trades().setUnderlyingPrice("trade-aa", "exit", 46.1);
    ibkr().apply(fly({ closedAt: Date.UTC(2026, 6, 17, 14, 30) }), ACCOUNT.id);
    expect(trades().get("trade-aa")?.ironFly?.underlyingPriceExit).toBeNull();
  });

  it("never brings back a trade the user deleted", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().softDelete("trade-nvda");
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("deleted");
    expect(trades().get("trade-nvda")).toBeNull();
  });

  it("keeps a trade whose facts the user edited, saying so when IBKR differs", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().update("trade-nvda", { netPnl: 50 });
    expect(ibkr().apply(scalp(), ACCOUNT.id)).toBe("kept_edits");
    expect(trades().get("trade-nvda")?.netPnl).toBe(50);
    expect(ibkr().apply(scalp({ netPnl: 50 }), ACCOUNT.id)).toBe("unchanged");
  });
});

describe("the duplicate guards", () => {
  const typedFly = (openedAt: number) =>
    trades().create({ ...fly().trade, source: "oquants_extract", openedAt, closedAt: openedAt + 86_400_000 });

  it("finds a fly already imported from oQuants: same ticker, body, expiry and New York day", () => {
    typedFly(Date.UTC(2026, 6, 16, 17, 54));
    expect(ibkr().isDuplicate(fly())).toBe(true);
  });

  it("doesn't match another day, or a trade the sync made itself", () => {
    typedFly(Date.UTC(2026, 6, 15, 17, 54));
    expect(ibkr().isDuplicate(fly())).toBe(false);
    ibkr().apply(fly({}, "synced-aa"), ACCOUNT.id);
    expect(ibkr().isDuplicate(fly())).toBe(false);
  });

  it("tells the oQuants import when a fly was already synced from IBKR", () => {
    ibkr().apply(fly(), ACCOUNT.id);
    const fromOquants = { ...fly().trade, source: "oquants_extract" as const, openedAt: Date.UTC(2026, 6, 16, 17, 54) };
    expect(ibkr().syncedFrom(fromOquants)).toBe(true);
    expect(ibkr().syncedFrom({ ...fromOquants, underlying: "AAL" })).toBe(false);
  });

  it("finds a scalp typed by hand on the same contract and day", () => {
    trades().create({ ...scalp().trade, source: "manual", openedAt: OPEN + 3_600_000 });
    expect(ibkr().isDuplicate(scalp())).toBe(true);
  });
});

describe("orphans, links and runs", () => {
  it("soft-deletes a synced trade no group produced, but never one the user edited or one from before the start date", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    ibkr().apply(scalp({ underlying: "TSLA" }, "trade-tsla"), ACCOUNT.id);
    trades().update("trade-tsla", { netPnl: 1 });
    ibkr().apply(fly(), ACCOUNT.id);
    expect(ibkr().softDeleteOrphans(ACCOUNT.id, new Set(), "2026-09-28")).toBe(1);
    expect(trades().get("trade-nvda")).toBeNull();
    expect(trades().get("trade-tsla")).not.toBeNull();
    expect(trades().get("trade-aa")).not.toBeNull();
  });

  it("links fills to their trade and leg, and unlinks the rest", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    const linked = fillInput();
    const stray = fillInput();
    ibkr().storeFills(ACCOUNT.id, [linked, stray], "confirm");
    ibkr().linkFills(ACCOUNT.id, new Map([[linked.id, { tradeId: "trade-nvda", legId: "trade-nvda-leg" }]]));
    expect(ibkr().fillsForTrade("trade-nvda").map((fill) => fill.id)).toEqual([linked.id]);
    ibkr().linkFills(ACCOUNT.id, new Map());
    expect(ibkr().fillsForTrade("trade-nvda")).toEqual([]);
  });

  it("records the last run, errors before any account included", () => {
    expect(ibkr().lastRun()).toBeNull();
    ibkr().recordRun({ at: 2_000, status: "error", error: "IBKR rejected the token.", summary: { added: 0 }, accountId: null });
    expect(ibkr().lastRun()).toEqual({
      accountId: null,
      lastRunAt: 2_000,
      lastStatus: "error",
      lastError: "IBKR rejected the token.",
      lastSummary: { added: 0 },
    });
    ibkr().recordRun({ at: 3_000, status: "ok", error: null, summary: { added: 2 }, accountId: ACCOUNT.id });
    expect(ibkr().lastRun()).toMatchObject({ accountId: ACCOUNT.id, lastStatus: "ok", lastSummary: { added: 2 } });
  });

  it("knows which trades exist, deleted ones included", () => {
    ibkr().apply(scalp(), ACCOUNT.id);
    trades().softDelete("trade-nvda");
    expect(ibkr().tradeExists("trade-nvda")).toBe(true);
    expect(ibkr().tradeExists("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/db/src/repositories/ibkr.test.ts`
Expected: FAIL, because `./ibkr.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/db/src/repositories/ibkr.ts`:

```ts
import { type NewTrade, nyDate } from "@tj/core";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "../client.js";
import { accounts, fills, ironFlyDetails, legs, syncState, trades } from "../schema.js";
import { stalePrices } from "./trades.js";

export type FillRow = typeof fills.$inferSelect;

/** A parsed fill with its id, as the sync stores it. */
export interface FillInput {
  id: string;
  brokerExecKey: string;
  brokerTradeId: string;
  brokerOrderId: string | null;
  conid: string;
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  multiplier: number;
  tradeDate: string;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  openClose: "O" | "C" | null;
  kind: "trade" | "expiration" | "exercise" | "assignment";
  raw: Record<string, string>;
}

export interface CancelInput {
  brokerTradeId: string;
  quantity: number;
  price: number;
}

/** A trade candidate from grouping: its id, the trade, and one id per leg. */
export interface SyncedTradeInput {
  id: string;
  trade: NewTrade;
  legIds: string[];
}

export type ApplyResult = "added" | "updated" | "unchanged" | "deleted" | "kept_edits";

export interface IbkrAccount {
  id: string;
  externalId: string;
  kind: "paper" | "live";
}

export interface SyncRun {
  at: number;
  status: "ok" | "error";
  error: string | null;
  summary: unknown;
  accountId: string | null;
}

export interface LastRun {
  accountId: string | null;
  lastRunAt: number;
  lastStatus: "ok" | "error";
  lastError: string | null;
  lastSummary: unknown;
}

const SOURCE = "ibkr";
const FLY_STRUCTURE = [
  "bodyPutStrike",
  "bodyCallStrike",
  "putWingStrike",
  "callWingStrike",
  "contracts",
  "creditPerShare",
  "netCost",
] as const;

const legKey = (leg: {
  right: string;
  strike: number;
  expiry: string;
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}) => JSON.stringify([leg.right, leg.strike, leg.expiry, leg.quantity, leg.multiplier, leg.openPrice, leg.closePrice]);

/** The columns the sync owns on a trade (spec §5.5). */
function facts(trade: NewTrade, accountId: string) {
  return {
    strategy: trade.strategy,
    book: trade.book,
    underlying: trade.underlying,
    structureLabel: trade.structureLabel,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    netPnl: trade.netPnl,
    fees: trade.fees,
    feesOpen: trade.feesOpen,
    feesClose: trade.feesClose,
    accountId,
  };
}

/** Fills, sync runs, and synced trades written without touching the user's side (spec §8.1). */
export function createIbkrRepo(db: Db, now: () => number = Date.now) {
  function writeLegs(candidate: SyncedTradeInput, timestamp: number) {
    db.delete(legs).where(eq(legs.tradeId, candidate.id)).run();
    candidate.trade.legs.forEach((leg, index) => {
      db.insert(legs)
        .values({
          id: candidate.legIds[index] ?? `${candidate.id}:${index}`,
          tradeId: candidate.id,
          right: leg.right,
          strike: leg.strike,
          expiry: leg.expiry,
          quantity: leg.quantity,
          multiplier: leg.multiplier,
          openPrice: leg.openPrice,
          closePrice: leg.closePrice,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        })
        .run();
    });
  }

  /** Writes a fly's structure in place, so its earnings fields, overrides and stock prices stay the user's. */
  function writeFly(candidate: SyncedTradeInput) {
    const fly = candidate.trade.ironFly;
    if (!fly) {
      db.delete(ironFlyDetails).where(eq(ironFlyDetails.tradeId, candidate.id)).run();
      return;
    }
    const structure = {
      bodyPutStrike: fly.bodyPutStrike,
      bodyCallStrike: fly.bodyCallStrike,
      putWingStrike: fly.putWingStrike,
      callWingStrike: fly.callWingStrike,
      contracts: fly.contracts,
      creditPerShare: fly.creditPerShare,
      netCost: fly.netCost,
    };
    db.insert(ironFlyDetails)
      .values({ tradeId: candidate.id, ...structure })
      .onConflictDoUpdate({ target: ironFlyDetails.tradeId, set: structure })
      .run();
  }

  function sameFacts(existing: typeof trades.$inferSelect, candidate: SyncedTradeInput, accountId: string): boolean {
    const want = facts(candidate.trade, accountId);
    for (const [key, value] of Object.entries(want)) {
      if (existing[key as keyof typeof want] !== value) return false;
    }
    const storedLegs = db
      .select()
      .from(legs)
      .where(and(eq(legs.tradeId, existing.id), isNull(legs.deletedAt)))
      .all()
      .map(legKey)
      .sort();
    const wantLegs = candidate.trade.legs.map(legKey).sort();
    if (storedLegs.length !== wantLegs.length || storedLegs.some((key, index) => key !== wantLegs[index])) return false;
    const fly = db.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, existing.id)).get();
    const wantFly = candidate.trade.ironFly;
    if (!fly || !wantFly) return !fly && !wantFly;
    return FLY_STRUCTURE.every((key) => fly[key] === wantFly[key]);
  }

  /** The same trade from another source: a fly by ticker, body, expiry and New York day; a scalp by contract and day. */
  function matches(trade: NewTrade, amongSynced: boolean): boolean {
    const day = nyDate(trade.openedAt);
    const first = trade.legs[0];
    const others = db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.underlying, trade.underlying),
          eq(trades.strategy, trade.strategy),
          amongSynced ? eq(trades.source, "ibkr_flex") : ne(trades.source, "ibkr_flex"),
          isNull(trades.deletedAt),
        ),
      )
      .all()
      .filter((other) => nyDate(other.openedAt) === day);
    for (const other of others) {
      const otherLegs = db
        .select()
        .from(legs)
        .where(and(eq(legs.tradeId, other.id), isNull(legs.deletedAt)))
        .all();
      if (trade.strategy === "iron_fly") {
        const theirs = db.select().from(ironFlyDetails).where(eq(ironFlyDetails.tradeId, other.id)).get();
        const ours = trade.ironFly;
        if (
          theirs &&
          ours &&
          theirs.bodyPutStrike === ours.bodyPutStrike &&
          theirs.bodyCallStrike === ours.bodyCallStrike &&
          otherLegs.some((leg) => leg.expiry === first?.expiry)
        ) {
          return true;
        }
      } else if (
        first &&
        otherLegs.some((leg) => leg.right === first.right && leg.strike === first.strike && leg.expiry === first.expiry)
      ) {
        return true;
      }
    }
    return false;
  }

  return {
    ensureAccount(account: IbkrAccount): void {
      const timestamp = now();
      db.insert(accounts)
        .values({
          id: account.id,
          name: account.kind === "paper" ? "IBKR paper" : "IBKR live",
          broker: "ibkr",
          kind: account.kind,
          externalId: account.externalId,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        })
        .onConflictDoNothing()
        .run();
    },

    /** New fills are inserted. Activity's version of a fill replaces Today's, with the final commission. */
    storeFills(accountId: string, input: FillInput[], origin: "confirm" | "activity") {
      let inserted = 0;
      let updated = 0;
      const timestamp = now();
      for (const fill of input) {
        const existing = db.select().from(fills).where(eq(fills.id, fill.id)).get();
        const values = {
          brokerExecKey: fill.brokerExecKey,
          brokerTradeId: fill.brokerTradeId,
          brokerOrderId: fill.brokerOrderId,
          conid: fill.conid,
          underlying: fill.underlying,
          right: fill.right,
          strike: fill.strike,
          expiry: fill.expiry,
          multiplier: fill.multiplier,
          tradeDate: fill.tradeDate,
          executedAt: fill.executedAt,
          quantity: fill.quantity,
          price: fill.price,
          commission: fill.commission,
          openClose: fill.openClose,
          kind: fill.kind,
          origin,
          raw: JSON.stringify(fill.raw),
          updatedAt: timestamp,
        };
        if (!existing) {
          db.insert(fills)
            .values({ id: fill.id, accountId, canceled: false, tradeId: null, legId: null, createdAt: timestamp, ...values })
            .run();
          inserted++;
        } else if (origin === "activity" && existing.origin === "confirm") {
          db.update(fills).set(values).where(eq(fills.id, fill.id)).run();
          updated++;
        }
      }
      return { inserted, updated };
    },

    /** Each cancel marks the first matching fill by trade id, size and price; a correction under the same id stands. */
    markCanceled(accountId: string, cancels: CancelInput[]): number {
      let marked = 0;
      for (const cancel of cancels) {
        const hit = db
          .select()
          .from(fills)
          .where(
            and(
              eq(fills.accountId, accountId),
              eq(fills.brokerTradeId, cancel.brokerTradeId),
              eq(fills.quantity, cancel.quantity),
              eq(fills.canceled, false),
            ),
          )
          .orderBy(asc(fills.brokerExecKey))
          .all()
          .find((fill) => Math.abs(fill.price - cancel.price) < 1e-9);
        if (!hit) continue;
        db.update(fills).set({ canceled: true, updatedAt: now() }).where(eq(fills.id, hit.id)).run();
        marked++;
      }
      return marked;
    },

    fillsSince(accountId: string, since: string): FillRow[] {
      return db
        .select()
        .from(fills)
        .where(and(eq(fills.accountId, accountId), eq(fills.canceled, false)))
        .orderBy(asc(fills.executedAt), asc(fills.brokerExecKey))
        .all()
        .filter((fill) => fill.tradeDate >= since);
    },

    fillsForTrade(tradeId: string): FillRow[] {
      return db
        .select()
        .from(fills)
        .where(eq(fills.tradeId, tradeId))
        .orderBy(asc(fills.executedAt), asc(fills.brokerExecKey))
        .all();
    },

    /** Whether a trade row with this id exists at all, deleted or not. */
    tradeExists(id: string): boolean {
      return db.select({ id: trades.id }).from(trades).where(eq(trades.id, id)).get() !== undefined;
    },

    /**
     * Already in the journal from another source (spec §8.1): a fly with the same ticker, expiry and body opened
     * the same New York day, or a scalp on the same contract opened that day.
     */
    isDuplicate(candidate: SyncedTradeInput): boolean {
      return matches(candidate.trade, false);
    },

    /** The oQuants import's reverse guard: this trade was already synced from IBKR. */
    syncedFrom(trade: NewTrade): boolean {
      return matches(trade, true);
    },

    /** Inserts or rewrites the sync's side of a trade (spec §5.5). Never the user's side, a deleted trade, or edited facts. */
    apply(candidate: SyncedTradeInput, accountId: string): ApplyResult {
      const existing = db.select().from(trades).where(eq(trades.id, candidate.id)).get();
      if (existing?.deletedAt != null) return "deleted";
      const timestamp = now();
      if (!existing) {
        db.insert(trades)
          .values({
            id: candidate.id,
            ...facts(candidate.trade, accountId),
            underlyingName: null,
            notes: null,
            grade: null,
            setupId: null,
            excluded: false,
            excludeReason: null,
            source: "ibkr_flex",
            externalRef: null,
            importBatchId: null,
            editedAt: null,
            factsEditedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
          })
          .run();
        writeLegs(candidate, timestamp);
        writeFly(candidate);
        return "added";
      }
      const same = sameFacts(existing, candidate, accountId);
      if (existing.factsEditedAt != null) return same ? "unchanged" : "kept_edits";
      if (same) return "unchanged";
      db.update(trades)
        .set({ ...facts(candidate.trade, accountId), updatedAt: timestamp })
        .where(eq(trades.id, candidate.id))
        .run();
      writeLegs(candidate, timestamp);
      writeFly(candidate);
      const cleared = stalePrices(existing, candidate.trade);
      if (Object.keys(cleared).length > 0) {
        db.update(ironFlyDetails).set(cleared).where(eq(ironFlyDetails.tradeId, candidate.id)).run();
      }
      return "updated";
    },

    /** Synced trades no group produced any more. Never one the user edited, nor one from before the start date. */
    softDeleteOrphans(accountId: string, produced: ReadonlySet<string>, since: string): number {
      const timestamp = now();
      let deleted = 0;
      const synced = db
        .select()
        .from(trades)
        .where(
          and(
            eq(trades.accountId, accountId),
            eq(trades.source, "ibkr_flex"),
            isNull(trades.deletedAt),
            isNull(trades.factsEditedAt),
          ),
        )
        .all();
      for (const trade of synced) {
        if (produced.has(trade.id) || nyDate(trade.openedAt) < since) continue;
        db.update(trades).set({ deletedAt: timestamp, updatedAt: timestamp }).where(eq(trades.id, trade.id)).run();
        deleted++;
      }
      return deleted;
    },

    linkFills(accountId: string, links: ReadonlyMap<string, { tradeId: string; legId: string }>): void {
      db.update(fills).set({ tradeId: null, legId: null }).where(eq(fills.accountId, accountId)).run();
      for (const [fillId, link] of links) {
        db.update(fills).set({ tradeId: link.tradeId, legId: link.legId }).where(eq(fills.id, fillId)).run();
      }
    },

    recordRun(run: SyncRun): void {
      const values = {
        accountId: run.accountId,
        lastRunAt: run.at,
        lastStatus: run.status,
        lastError: run.error,
        lastSummary: JSON.stringify(run.summary),
      };
      db.insert(syncState)
        .values({ source: SOURCE, ...values })
        .onConflictDoUpdate({ target: syncState.source, set: values })
        .run();
    },

    lastRun(): LastRun | null {
      const row = db.select().from(syncState).where(eq(syncState.source, SOURCE)).get();
      if (!row) return null;
      return {
        accountId: row.accountId,
        lastRunAt: row.lastRunAt,
        lastStatus: row.lastStatus === "error" ? "error" : "ok",
        lastError: row.lastError,
        lastSummary: row.lastSummary ? (JSON.parse(row.lastSummary) as unknown) : null,
      };
    },
  };
}
```

In `packages/db/src/index.ts`, add `export * from "./repositories/ibkr.js";`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/db`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/db
git commit -m "feat(db): store IBKR fills, apply synced trades without touching the user's side, record runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: IBKR credentials in Settings

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/routes/settings.ts`
- Test: `apps/server/src/settings.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `FlexCheck` (Task 1), and `nyDate` (`@tj/core`).
- Produces:
  - `config.ts`: `type IbkrConfig = { token: string; activityQueryId: string; todayQueryId: string; since: string }`; `Secrets.ibkr?: IbkrConfig`; `writeIbkrConfig(file: string, config: IbkrConfig | null): void`.
  - `SettingsDeps.checkIbkr?: (token: string, queryId: string) => Promise<FlexCheck>`.
  - `GET /api/settings` gains `ibkr: { configured: boolean; tokenHint: string | null; activityQueryId: string | null; todayQueryId: string | null; since: string | null }`.
  - `PUT /api/settings/ibkr` takes `{ token?: string; activityQueryId: string; todayQueryId: string; since: string }` and answers the settings view, or `{ error, message }` with 400, 409 or 503.
  - `DELETE /api/settings/ibkr` answers the settings view.
  - The web calls them as `api.api.settings.ibkr.$put({ json })` and `api.api.settings.ibkr.$delete()`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/config.test.ts`, add (importing `writeIbkrConfig` next to the existing imports):

```ts
describe("writeIbkrConfig", () => {
  it("adds the IBKR block beside the Alpaca key, and removes it again", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tj-config-")), "secrets.json");
    writeFileSync(file, JSON.stringify({ alpaca: { keyId: "PK1", secretKey: "s" } }));
    const ibkr = { token: "1234567890123456789012", activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28" };
    writeIbkrConfig(file, ibkr);
    expect(readSecrets(file)).toEqual({ alpaca: { keyId: "PK1", secretKey: "s" }, ibkr });
    writeIbkrConfig(file, null);
    expect(readSecrets(file)).toEqual({ alpaca: { keyId: "PK1", secretKey: "s" } });
  });
});
```

(Add `mkdtempSync`, `writeFileSync`, `tmpdir` and `join` to its imports if the file lacks them.)

In `apps/server/src/settings.test.ts`:
- in the `Setup` interface add `ibkrCheck?: FlexCheck;`, and import `type FlexCheck` from `@tj/importers`;
- in `setup`, destructure `ibkrCheck = "ok"`, add `const ibkrChecked: [string, string][] = [];`, and add this to `settings`:

```ts
      checkIbkr: async (token, queryId) => {
        ibkrChecked.push([token, queryId]);
        return ibkrCheck;
      },
```

  and return `ibkrChecked` too;
- in the test "shows the data directory and that market data is off", add to the expected object:

```ts
      ibkr: { configured: false, tokenHint: null, activityQueryId: null, todayQueryId: null, since: null },
```

and append:

```ts
describe("IBKR Flex settings", () => {
  const TOKEN = "1234567890123456789012";
  const body = (fields: Record<string, unknown>) =>
    JSON.stringify({ activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28", ...fields });
  const putIbkr = (app: ReturnType<typeof createApp>, json: string) =>
    app.request("/api/settings/ibkr", { method: "PUT", headers: JSON_HEADERS, body: json });

  it("tests both queries with the token, saves them, and shows only a hint of the token", async () => {
    const { app, secretsFile, ibkrChecked } = setup();
    const res = await putIbkr(app, body({ token: TOKEN }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).ibkr).toEqual({
      configured: true,
      tokenHint: "12…9012",
      activityQueryId: "1653145",
      todayQueryId: "1653147",
      since: "2026-09-28",
    });
    expect(ibkrChecked).toEqual([
      [TOKEN, "1653145"],
      [TOKEN, "1653147"],
    ]);
    expect(readSecrets(secretsFile).ibkr?.token).toBe(TOKEN);
  });

  it("keeps the saved token when a save leaves it out", async () => {
    const { app, secretsFile } = setup();
    await putIbkr(app, body({ token: TOKEN }));
    expect((await putIbkr(app, body({ since: "2026-09-29" }))).status).toBe(200);
    expect(readSecrets(secretsFile).ibkr).toMatchObject({ token: TOKEN, since: "2026-09-29" });
  });

  it.each([
    ["token_rejected", 400, "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal."],
    ["query_not_found", 400, "IBKR doesn't know the Activity query 1653145. Check its ID on the Flex Queries page."],
    ["unreachable", 503, "Couldn't reach IBKR to test the token. Try again in a moment."],
  ] as const)("refuses to save when IBKR says %s", async (check, status, message) => {
    const { app, secretsFile } = setup({ ibkrCheck: check });
    const res = await putIbkr(app, body({ token: TOKEN }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: check, message });
    expect(existsSync(secretsFile)).toBe(false);
  });

  it("refuses letters in a query id, a start date in the future, and no token at all, without echoing them", async () => {
    const { app } = setup();
    for (const json of [
      body({ token: TOKEN, activityQueryId: "abc" }),
      body({ token: TOKEN, since: "2099-01-01" }),
      body({}),
    ]) {
      const res = await putIbkr(app, json);
      expect(res.status).toBe(400);
      const answer = (await res.json()) as { message: string };
      expect(answer.message).not.toContain("abc");
    }
  });

  it("removes the IBKR block and keeps the Alpaca key", async () => {
    const { app, secretsFile } = setup();
    await put(app, JSON.stringify(KEYS));
    await putIbkr(app, body({ token: TOKEN }));
    const res = await app.request("/api/settings/ibkr", { method: "DELETE", headers: LOCAL });
    expect(((await res.json()) as { ibkr: { configured: boolean } }).ibkr.configured).toBe(false);
    expect(readSecrets(secretsFile)).toEqual({ alpaca: KEYS });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/server/src/settings.test.ts apps/server/src/config.test.ts`
Expected: FAIL. There's no `ibkr` in the view, no `/api/settings/ibkr`, and no `writeIbkrConfig`.

- [ ] **Step 3: Implement the config**

In `apps/server/src/config.ts`, replace `secretsSchema` with:

```ts
const ibkrSchema = z.object({
  token: z.string().min(1),
  activityQueryId: z.string().regex(/^\d+$/),
  todayQueryId: z.string().regex(/^\d+$/),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** The Flex Web Service token, the two queries, and the date the sync starts from (spec §5.6). */
export type IbkrConfig = z.infer<typeof ibkrSchema>;

const secretsSchema = z.object({
  alpaca: z.object({ keyId: z.string().min(1), secretKey: z.string().min(1) }).optional(),
  ibkr: ibkrSchema.optional(),
});
```

Replace `writeAlpacaKeys` with a shared writer and two callers:

```ts
/**
 * Sets (or, with null, removes) one entry in secrets.json and keeps every other one.
 * The new file is written beside the old one, made readable by its owner only, then renamed
 * into place, so a crash never leaves half a file.
 */
function writeEntry(file: string, name: string, value: unknown): void {
  const { [name]: _replaced, ...rest } = readSecretsObject(file);
  const next = value == null ? rest : { ...rest, [name]: value };
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  // The mode above only applies to a new file; a temp file left by a crash keeps its old one.
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

/** Sets or removes the Alpaca key. */
export function writeAlpacaKeys(file: string, keys: AlpacaKeys | null): void {
  writeEntry(file, "alpaca", keys ? { keyId: keys.keyId, secretKey: keys.secretKey } : null);
}

/** Sets or removes the IBKR Flex block. */
export function writeIbkrConfig(file: string, config: IbkrConfig | null): void {
  writeEntry(file, "ibkr", config);
}
```

- [ ] **Step 4: Implement the routes**

In `apps/server/src/routes/settings.ts`:
- add the imports `import { nyDate } from "@tj/core";` and `import type { FlexCheck } from "@tj/importers";`;
- change the config import to `import { type IbkrConfig, readSecrets, SecretsFileBroken, writeAlpacaKeys, writeIbkrConfig } from "../config.js";`;
- add to `SettingsDeps`:

```ts
  /** Tests an IBKR token and query before they're saved. Omitted where IBKR is unavailable. */
  checkIbkr?: (token: string, queryId: string) => Promise<FlexCheck>;
```

- add below `keysSchema`:

```ts
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
  activityQueryId: z.string().trim().regex(/^\d{1,12}$/),
  todayQueryId: z.string().trim().regex(/^\d{1,12}$/),
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
```

- inside `settingsRoutes`, add before `view`:

```ts
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
```

- add `ibkr: ibkrView(),` to the object `view` returns;
- append these two routes to the chain, after `.delete("/market-data", …)`, moving the final `;`:

```ts
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
                message: "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal.",
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
              { error: "unreachable", message: "Couldn't reach IBKR to test the token. Try again in a moment." },
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/server`
Expected: PASS, including the existing settings and config tests.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server
git commit -m "feat(server): save IBKR Flex credentials from Settings after testing both queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The sync service and its endpoints

**Files:**
- Create: `apps/server/src/ibkr/sync.ts`
- Create: `apps/server/src/routes/ibkr.ts`
- Create: `apps/server/src/ibkr.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes/trades.ts` (fills on `GET /:id`)
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes:
  - `ibkrFlex`, `FlexClient`, `FlexError`, `FlexParseError`, `parseFlex`, `groupFills`, `fillIdFor`, `accountIdFor`, `FillForGrouping` and `checkFlexQuery` (Tasks 1–3);
  - `createIbkrRepo`, `FillInput`, `FillRow` and `createTradesRepo` (Tasks 4–5);
  - `IbkrConfig` and `readSecrets` (Task 6).
- Produces:

```ts
// apps/server/src/ibkr/sync.ts
const AUTO_INTERVAL_MS = 15 * 60_000;
interface SyncSummary {
  status: "ok" | "error" | "not_configured"; ran: boolean;
  account: { externalId: string; kind: "paper" | "live" } | null;
  added: number; updated: number; unchanged: number; orphaned: number;
  skipped: { reason: "before_start" | "unrecognised" | "duplicate" | "deleted"; ticker: string; openedAt: number }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number; other: number; malformed: number };
  activityFailed: boolean; changedTradeIds: string[];
  error: { kind: "token" | "query" | "slow" | "unreachable" | "failed"; message: string } | null;
  lastRunAt: number | null;
}
interface IbkrStatus { configured: boolean; since: string | null; lastRunAt: number | null; lastStatus: "ok" | "error" | null; lastError: string | null; lastSummary: SyncSummary | null }
interface IbkrSync { sync(options: { auto: boolean }): Promise<SyncSummary>; status(): IbkrStatus; reset(tradeId: string): Promise<SyncSummary | null> }
function createIbkrSync(deps: { db: Db; config: () => IbkrConfig | null; client: (token: string) => FlexClient; now?: () => number }): IbkrSync;
```

- **Endpoints:**
  - `POST /api/ibkr/sync` with `{ auto: boolean }` answers a `SyncSummary` (`api.api.ibkr.sync.$post`);
  - `GET /api/ibkr/status` answers an `IbkrStatus` (`api.api.ibkr.status.$get`);
  - `POST /api/ibkr/trades/:id/reset` answers a `SyncSummary`, or 404 (`api.api.ibkr.trades[":id"].reset.$post`).
- **`GET /api/trades/:id`** also answers `fills: { id, executedAt, quantity, price, commission, kind, canceled, openClose, right, strike, expiry }[]`.
- **`AppDeps`** gains `ibkrConfig?: () => IbkrConfig | null` and `flexClient?: (token: string) => FlexClient`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/ibkr.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type FlexClient, FlexError } from "@tj/importers";
import { describe, expect, it } from "vitest";
import { LOCAL, testApp } from "./testing.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/importers/src/ibkr/fixtures/${name}`, import.meta.url)), "utf8");
const TODAY_XML = fixture("today.xml");
const ACTIVITY_XML = fixture("activity.xml");
const JSON_HEADERS = { "content-type": "application/json", ...LOCAL };
const CONFIG = { token: "1234567890123456789012", activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28" };
const NOW = Date.UTC(2026, 8, 29, 1, 0);

interface Summary {
  status: string;
  ran: boolean;
  added: number;
  updated: number;
  unchanged: number;
  skipped: { reason: string; ticker: string }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number };
  activityFailed: boolean;
  changedTradeIds: string[];
  error: { kind: string; message: string } | null;
}

interface Answers {
  today?: string | Error;
  activity?: string | Error;
}

/** The app with a fake Flex client that answers each query from the fixtures, and a clock the test moves. */
function setup(config: typeof CONFIG | null = CONFIG, answers: Answers = {}) {
  const asked: string[] = [];
  let clock = NOW;
  const client: FlexClient = {
    async statement(queryId) {
      asked.push(queryId);
      // A statement takes a moment, as IBKR's does, so two syncs at once really overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const answer = queryId === CONFIG.todayQueryId ? (answers.today ?? TODAY_XML) : (answers.activity ?? ACTIVITY_XML);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async checkQuery() {},
  };
  const app = testApp({ ibkrConfig: () => config, flexClient: () => client, now: () => clock });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  return {
    app,
    asked,
    advance: (ms: number) => {
      clock += ms;
    },
    async sync(auto = false) {
      return (await (await post("/api/ibkr/sync", { auto })).json()) as Summary;
    },
    async trades() {
      return (await (await app.request("/api/trades", { headers: LOCAL })).json()) as {
        id: string;
        underlying: string;
        netPnl: number | null;
        source: string;
        book: string;
        factsEditedAt: number | null;
      }[];
    },
    post,
  };
}

describe("POST /api/ibkr/sync", () => {
  it("brings in this morning's scalps, and nothing from before the start date", async () => {
    const app = setup();
    const summary = await app.sync();
    expect(summary).toMatchObject({ status: "ok", ran: true, added: 2, activityFailed: false, error: null });
    expect(summary.ignored).toMatchObject({ beforeStart: 21, stock: 2 });
    const trades = await app.trades();
    expect(trades.map((trade) => [trade.underlying, trade.netPnl, trade.source, trade.book]).sort()).toEqual([
      ["NVDA", 44.74, "ibkr_flex", "paper"],
      ["TSLA", 300.55, "ibkr_flex", "paper"],
    ]);
  });

  it("brings in the Activity statement's trades from an earlier start date, skipping what it can't place", async () => {
    const app = setup({ ...CONFIG, since: "2026-07-01" });
    const summary = await app.sync();
    // NVDA, TSLA, the AA fly and CZR's call and put.
    expect(summary.added).toBe(5);
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "before_start", ticker: "CLF" }));
  });

  it("changes nothing on a second sync", async () => {
    const app = setup();
    await app.sync();
    expect(await app.sync()).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
  });

  it("doesn't run an automatic sync within 15 minutes of the last one", async () => {
    const app = setup();
    await app.sync();
    app.advance(10 * 60_000);
    expect(await app.sync(true)).toMatchObject({ ran: false, added: 2 });
    expect(app.asked).toHaveLength(2);
    app.advance(6 * 60_000);
    expect((await app.sync(true)).ran).toBe(true);
    expect(app.asked).toHaveLength(4);
  });

  it("runs one sync at a time", async () => {
    const app = setup();
    const [first, second] = await Promise.all([app.sync(), app.sync()]);
    expect(first).toEqual(second);
    expect(app.asked).toHaveLength(2);
  });

  it("stops on a rejected token and records the error", async () => {
    const message =
      "IBKR rejected the token (Token has expired.). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.";
    const app = setup(CONFIG, { today: new FlexError("token", message) });
    const summary = await app.sync();
    expect(summary).toMatchObject({ status: "error", error: { kind: "token", message }, added: 0 });
    const status = (await (await app.app.request("/api/ibkr/status", { headers: LOCAL })).json()) as {
      lastStatus: string;
      lastError: string;
    };
    expect(status).toMatchObject({ lastStatus: "error", lastError: message });
  });

  it("keeps today's fills when the Activity statement fails", async () => {
    const app = setup(CONFIG, {
      activity: new FlexError("slow", "IBKR is still preparing the statement. Try again shortly."),
    });
    expect(await app.sync()).toMatchObject({ status: "ok", added: 2, activityFailed: true });
  });

  it("records a clean run on a day with no trades", async () => {
    const empty = TODAY_XML.replace(/<TradeConfirms>[\s\S]*<\/TradeConfirms>/, "<TradeConfirms />");
    const app = setup(CONFIG, { today: empty });
    expect(await app.sync()).toMatchObject({ status: "ok", added: 0, error: null });
  });

  it("skips a fly already imported from oQuants", async () => {
    const app = setup({ ...CONFIG, since: "2026-07-01" });
    await app.post("/api/trades", {
      strategy: "iron_fly",
      book: "paper",
      underlying: "AA",
      source: "oquants_extract",
      openedAt: Date.UTC(2026, 6, 16, 17, 54),
      closedAt: Date.UTC(2026, 6, 17, 13, 54),
      netPnl: 33.56,
      fees: 6.44,
      legs: [{ right: "C", strike: 47, expiry: "2026-07-17", quantity: -2, openPrice: 1.37, closePrice: 0.33 }],
      ironFly: { bodyPutStrike: 47, bodyCallStrike: 47, putWingStrike: 40, callWingStrike: 54, contracts: 2, creditPerShare: 2.65 },
    });
    const summary = await app.sync();
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "duplicate", ticker: "AA" }));
    expect((await app.trades()).filter((trade) => trade.underlying === "AA")).toHaveLength(1);
  });

  it("never brings back a deleted trade", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    await app.app.request(`/api/trades/${nvda?.id}`, { method: "DELETE", headers: LOCAL });
    const summary = await app.sync();
    expect(summary.skipped).toContainEqual(expect.objectContaining({ reason: "deleted", ticker: "NVDA" }));
  });

  it("answers not_configured without credentials", async () => {
    const app = setup(null);
    expect(await app.sync()).toMatchObject({ status: "not_configured", ran: false });
    expect(app.asked).toEqual([]);
  });
});

describe("the user's edits", () => {
  it("are kept by later syncs until the user asks for IBKR's numbers", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    await app.app.request(`/api/trades/${nvda?.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ netPnl: 50 }),
    });
    const kept = await app.sync();
    // IBKR's own number, which the trade page shows beside the user's.
    expect(kept.keptEdits).toEqual([{ tradeId: nvda?.id, ticker: "NVDA", netPnl: 44.74 }]);
    expect((await app.trades()).find((trade) => trade.id === nvda?.id)?.netPnl).toBe(50);

    const reset = await app.post(`/api/ibkr/trades/${nvda?.id}/reset`, {});
    expect(reset.status).toBe(200);
    expect((await app.trades()).find((trade) => trade.id === nvda?.id)).toMatchObject({
      netPnl: 44.74,
      factsEditedAt: null,
    });
  });

  it("answers 404 for a reset of a trade the sync doesn't own", async () => {
    const app = setup();
    expect((await app.post("/api/ibkr/trades/nope/reset", {})).status).toBe(404);
  });
});

describe("GET /api/trades/:id", () => {
  it("lists a synced trade's fills", async () => {
    const app = setup();
    await app.sync();
    const nvda = (await app.trades()).find((trade) => trade.underlying === "NVDA");
    const detail = (await (await app.app.request(`/api/trades/${nvda?.id}`, { headers: LOCAL })).json()) as {
      fills: { quantity: number; price: number; kind: string }[];
    };
    expect(detail.fills.map((fill) => [fill.quantity, fill.price, fill.kind])).toEqual([
      [1, 1.06, "trade"],
      [1, 1.06, "trade"],
      [-1, 1.44, "trade"],
      [-1, 1.15, "trade"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/server/src/ibkr.test.ts`
Expected: FAIL. `/api/ibkr/sync` answers 404, and `testApp` doesn't take `ibkrConfig`.

- [ ] **Step 3: Write the sync service**

Create `apps/server/src/ibkr/sync.ts`:

```ts
import { createIbkrRepo, createTradesRepo, type Db, type FillInput, type FillRow } from "@tj/db";
import {
  accountIdFor,
  type FillForGrouping,
  type FlexClient,
  FlexError,
  FlexParseError,
  type FlexStatementData,
  fillIdFor,
  groupFills,
  type ParsedFill,
  parseFlex,
} from "@tj/importers";
import type { IbkrConfig } from "../config.js";

/** An automatic sync (on app open) runs at most this often; the button always runs. */
export const AUTO_INTERVAL_MS = 15 * 60_000;

// Unions are spelled out: the web infers these types over RPC and must be able to print them (TS2742).
export interface SyncSummary {
  status: "ok" | "error" | "not_configured";
  ran: boolean;
  account: { externalId: string; kind: "paper" | "live" } | null;
  added: number;
  updated: number;
  unchanged: number;
  orphaned: number;
  skipped: { reason: "before_start" | "unrecognised" | "duplicate" | "deleted"; ticker: string; openedAt: number }[];
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[];
  ignored: { beforeStart: number; stock: number; other: number; malformed: number };
  activityFailed: boolean;
  changedTradeIds: string[];
  error: { kind: "token" | "query" | "slow" | "unreachable" | "failed"; message: string } | null;
  lastRunAt: number | null;
}

export interface IbkrStatus {
  configured: boolean;
  since: string | null;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastSummary: SyncSummary | null;
}

export interface IbkrSync {
  /** One run at a time: a call during a run gets that run's summary. */
  sync(options: { auto: boolean }): Promise<SyncSummary>;
  status(): IbkrStatus;
  /** "Use IBKR's numbers": clears the user's mark on a synced trade and syncs. Null for any other trade. */
  reset(tradeId: string): Promise<SyncSummary | null>;
}

export interface IbkrSyncDeps {
  db: Db;
  config: () => IbkrConfig | null;
  client: (token: string) => FlexClient;
  now?: () => number;
}

const emptySummary = (): SyncSummary => ({
  status: "ok",
  ran: true,
  account: null,
  added: 0,
  updated: 0,
  unchanged: 0,
  orphaned: 0,
  skipped: [],
  keptEdits: [],
  ignored: { beforeStart: 0, stock: 0, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: [],
  error: null,
  lastRunAt: null,
});

const toInput = (account: string, fill: ParsedFill): FillInput => ({
  id: fillIdFor(account, fill.key),
  brokerExecKey: fill.key,
  brokerTradeId: fill.tradeId,
  brokerOrderId: fill.orderId,
  conid: fill.conid,
  underlying: fill.underlying,
  right: fill.right,
  strike: fill.strike,
  expiry: fill.expiry,
  multiplier: fill.multiplier,
  tradeDate: fill.tradeDate,
  executedAt: fill.executedAt,
  quantity: fill.quantity,
  price: fill.price,
  commission: fill.commission,
  openClose: fill.openClose,
  kind: fill.kind,
  raw: fill.raw,
});

const toGrouping = (row: FillRow): FillForGrouping => ({
  id: row.id,
  key: row.brokerExecKey,
  conid: row.conid,
  underlying: row.underlying,
  right: row.right === "P" ? "P" : "C",
  strike: row.strike,
  expiry: row.expiry,
  multiplier: row.multiplier,
  executedAt: row.executedAt,
  quantity: row.quantity,
  price: row.price,
  commission: row.commission,
  openClose: row.openClose === "O" || row.openClose === "C" ? row.openClose : null,
  kind:
    row.kind === "expiration" || row.kind === "exercise" || row.kind === "assignment" ? row.kind : "trade",
});

/** The IBKR sync (spec §8.1): fetch both statements, store fills, regroup, write, all after IBKR has answered. */
export function createIbkrSync({ db, config, client, now = Date.now }: IbkrSyncDeps): IbkrSync {
  const repo = createIbkrRepo(db, now);
  let running: Promise<SyncSummary> | null = null;

  const readConfig = (): IbkrConfig | null => {
    try {
      return config();
    } catch {
      return null;
    }
  };

  function fail(error: unknown, accountId: string | null): SyncSummary {
    const flex =
      error instanceof FlexError
        ? error
        : new FlexError("failed", error instanceof FlexParseError ? error.message : "The sync failed unexpectedly.");
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(),
      status: "error",
      error: { kind: flex.kind, message: flex.message },
      lastRunAt: at,
    };
    repo.recordRun({ at, status: "error", error: flex.message, summary, accountId });
    return summary;
  }

  async function run({ auto }: { auto: boolean }): Promise<SyncSummary> {
    const settings = readConfig();
    const last = repo.lastRun();
    if (!settings) return { ...emptySummary(), status: "not_configured", ran: false, lastRunAt: last?.lastRunAt ?? null };
    if (auto && last?.lastSummary && now() - last.lastRunAt < AUTO_INTERVAL_MS) {
      return { ...(last.lastSummary as SyncSummary), ran: false };
    }

    const flex = client(settings.token);
    let today: FlexStatementData;
    try {
      today = parseFlex(await flex.statement(settings.todayQueryId));
    } catch (error) {
      return fail(error, last?.accountId ?? null);
    }
    let activity: FlexStatementData | null = null;
    let activityFailed = false;
    try {
      activity = parseFlex(await flex.statement(settings.activityQueryId));
    } catch (error) {
      if (error instanceof FlexError && (error.kind === "token" || error.kind === "query")) {
        return fail(error, last?.accountId ?? null);
      }
      activityFailed = true;
    }
    if (activity && activity.accountId !== today.accountId) {
      return fail(
        new FlexError(
          "failed",
          `The two queries belong to different accounts (${today.accountId} and ${activity.accountId}). Use queries from the same account.`,
        ),
        null,
      );
    }

    const externalId = today.accountId;
    const account = {
      id: accountIdFor(externalId),
      externalId,
      kind: externalId.startsWith("DU") ? ("paper" as const) : ("live" as const),
    };
    const at = now();
    const summary: SyncSummary = {
      ...emptySummary(),
      account: { externalId, kind: account.kind },
      activityFailed,
      lastRunAt: at,
    };
    try {
      db.transaction(() => {
        repo.ensureAccount(account);
        // Today first, so Activity's final version of the same fill replaces it.
        for (const statement of [today, activity]) {
          if (!statement) continue;
          summary.ignored.stock += statement.ignored.stock;
          summary.ignored.other += statement.ignored.other;
          summary.ignored.malformed += statement.ignored.malformed;
          const kept = statement.fills.filter((fill) => fill.tradeDate >= settings.since);
          summary.ignored.beforeStart += statement.fills.length - kept.length;
          repo.storeFills(
            account.id,
            kept.map((fill) => toInput(externalId, fill)),
            statement.kind,
          );
          repo.markCanceled(
            account.id,
            statement.cancels.map((cancel) => ({
              brokerTradeId: cancel.tradeId,
              quantity: cancel.quantity,
              price: cancel.price,
            })),
          );
        }

        const grouped = groupFills(repo.fillsSince(account.id, settings.since).map(toGrouping), {
          account: externalId,
          book: account.kind,
        });
        for (const skip of grouped.skipped) {
          summary.skipped.push({ reason: skip.reason, ticker: skip.ticker, openedAt: skip.openedAt });
        }
        const linked = new Set<string>();
        for (const candidate of grouped.candidates) {
          const ticker = candidate.trade.underlying;
          if (!repo.tradeExists(candidate.id) && repo.isDuplicate(candidate)) {
            summary.skipped.push({ reason: "duplicate", ticker, openedAt: candidate.trade.openedAt });
            continue;
          }
          const result = repo.apply(candidate, account.id);
          linked.add(candidate.id);
          if (result === "added") summary.added++;
          else if (result === "updated") summary.updated++;
          else if (result === "unchanged") summary.unchanged++;
          else if (result === "deleted") {
            summary.skipped.push({ reason: "deleted", ticker, openedAt: candidate.trade.openedAt });
          } else summary.keptEdits.push({ tradeId: candidate.id, ticker, netPnl: candidate.trade.netPnl });
          if (result === "added" || result === "updated") summary.changedTradeIds.push(candidate.id);
        }
        summary.orphaned = repo.softDeleteOrphans(
          account.id,
          new Set(grouped.candidates.map((candidate) => candidate.id)),
          settings.since,
        );
        repo.linkFills(account.id, new Map([...grouped.links].filter(([, link]) => linked.has(link.tradeId))));
        repo.recordRun({ at, status: "ok", error: null, summary, accountId: account.id });
      });
    } catch (error) {
      console.error("IBKR sync failed while saving:", error instanceof Error ? error.message : error);
      return fail(new FlexError("failed", "The sync couldn't save what IBKR sent."), account.id);
    }
    return summary;
  }

  const sync: IbkrSync["sync"] = (options) => {
    if (running) return running;
    running = run(options).finally(() => {
      running = null;
    });
    return running;
  };

  return {
    sync,
    status() {
      const settings = readConfig();
      const last = repo.lastRun();
      return {
        configured: settings != null,
        since: settings?.since ?? null,
        lastRunAt: last?.lastRunAt ?? null,
        lastStatus: last?.lastStatus ?? null,
        lastError: last?.lastError ?? null,
        lastSummary: (last?.lastSummary as SyncSummary | null) ?? null,
      };
    },
    async reset(tradeId) {
      if (!createTradesRepo(db, now).clearFactsEdited(tradeId)) return null;
      return sync({ auto: false });
    },
  };
}
```

Create `apps/server/src/routes/ibkr.ts`:

```ts
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
```

- [ ] **Step 4: Wire it into the app, the trade route and the server**

In `apps/server/src/app.ts`:
- add the imports `import { type FlexClient, ibkrFlex } from "@tj/importers";`, `import type { IbkrConfig } from "./config.js";`, `import { createIbkrSync } from "./ibkr/sync.js";` and `import { ibkrRoutes } from "./routes/ibkr.js";`;
- add to `AppDeps`:

```ts
  /** IBKR Flex credentials, read on every sync so a save in Settings applies at once. Omitted: not set up. */
  ibkrConfig?: () => IbkrConfig | null;
  /** Builds the Flex client for a token; tests pass a fake. */
  flexClient?: (token: string) => FlexClient;
```

- add to the chain, after `.route("/api/moves", …)`:

```ts
    .route(
      "/api/ibkr",
      ibkrRoutes(
        createIbkrSync({
          db: deps.db,
          config: deps.ibkrConfig ?? (() => null),
          client: deps.flexClient ?? ((token) => ibkrFlex(token)),
          now: deps.now,
        }),
      ),
    )
```

In `apps/server/src/routes/trades.ts`:
- import `createIbkrRepo` and `type FillRow` from `@tj/db`;
- inside `tradeRoutes`, add `const ibkr = createIbkrRepo(db, now);` below `repo`;
- add this helper above `tradeRoutes`:

```ts
/** What the trade page's Fills panel shows of a fill. */
const fillView = (fill: FillRow) => ({
  id: fill.id,
  executedAt: fill.executedAt,
  quantity: fill.quantity,
  price: fill.price,
  commission: fill.commission,
  kind: fill.kind,
  canceled: fill.canceled,
  openClose: fill.openClose,
  right: fill.right,
  strike: fill.strike,
  expiry: fill.expiry,
});
```

- change the `/:id` GET to:

```ts
    .get("/:id", (c) => {
      const trade = repo.get(c.req.param("id"));
      return trade
        ? c.json({ ...withMetrics(trade), fills: ibkr.fillsForTrade(trade.id).map(fillView) })
        : c.json({ error: "not found" }, 404);
    })
```

In `apps/server/src/index.ts`:
- import `checkFlexQuery` from `@tj/importers`;
- pass these two to `createApp`:

```ts
  // Read on every sync, so saving in Settings applies at once; a broken file means not set up.
  ibkrConfig: () => readSecrets(paths.secretsFile).ibkr ?? null,
```

  and, inside `settings`, `checkIbkr: (token, queryId) => checkFlexQuery(token, queryId),`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/server`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server
git commit -m "feat(server): sync IBKR fills into scalps and flies, one run at a time, keeping the user's edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If `pnpm typecheck` reports TS2742 in `apps/web/src/api.ts` (a type the RPC client can't name), find the alias in the route's answer and spell it out inline, as the move-data plan did for `MissingReason`.

---

### Task 8: The oQuants import skips flies already synced from IBKR

**Files:**
- Modify: `apps/server/src/routes/import.ts`
- Test: `apps/server/src/import.test.ts`

**Interfaces:**
- Consumes: `createIbkrRepo(...).syncedFrom(trade)` (Task 5).
- Produces: in the oQuants preview, a fly that was already synced from IBKR shows `status: "existing"` with `reason: "already synced from IBKR"`, and the commit never imports it. This covers spec §1's "including during the few days when flies are still logged in oQuants as well", in the order the sync's own guard can't see: IBKR first, oQuants second.

- [ ] **Step 1: Write the failing test**

In `apps/server/src/import.test.ts`:
- import `createIbkrRepo` and `type Db` from `@tj/db` (next to `openDatabase` and `runMigrations`), and `parseOquants` from `@tj/importers`;
- keep the database in the test scope: declare `let db: Db;` beside `app`, and in `beforeEach` replace `app = createApp({ db: openDatabase(file), backup });` with:

```ts
    db = openDatabase(file);
    app = createApp({ db, backup });
```

- append inside `describe("oQuants import", …)`:

```ts
  it("counts a fly already synced from IBKR as in the journal, and never imports it twice", async () => {
    const row = parseOquants(payload).rows.find((each) => each.kind === "trade");
    if (row?.kind !== "trade") throw new Error("the fixture has no trade");
    const ibkr = createIbkrRepo(db);
    ibkr.ensureAccount({ id: "acct", externalId: "DU1234567", kind: "paper" });
    // The same fly, synced from IBKR first: apply() stores it as an IBKR trade under its own id.
    ibkr.apply(
      {
        id: "synced-xyz",
        trade: row.trade,
        legIds: row.trade.legs.map((_, index) => `synced-xyz-${index}`),
      },
      "acct",
    );

    const preview = await readJson<PreviewBody>(await send("preview", payload));
    expect(preview.counts).toEqual({ new: 0, existing: 1, skipped: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "existing", reason: "already synced from IBKR" });
    expect(await readJson(await send("commit", payload))).toEqual({ imported: 0, backupFile: null, importedIds: [] });
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm vitest run apps/server/src/import.test.ts`
Expected: FAIL. The preview counts the fly as new.

- [ ] **Step 3: Implement**

In `apps/server/src/routes/import.ts`:
- change the db import to `import { createIbkrRepo, createTradesRepo, type Db } from "@tj/db";`;
- inside `importRoutes`, add `const ibkr = createIbkrRepo(db, now);` below `repo`;
- in `plan`, right after `const existing = repo.existingIds(…);`, add:

```ts
    // A fly already synced from IBKR is the same trade (spec §1): it must never come in twice.
    const synced = new Set(
      parsed.filter((row) => !existing.has(row.id) && ibkr.syncedFrom(row.trade)).map((row) => row.id),
    );
```

- in the `.map` for trade rows, replace `const already = existing.has(row.id);` and the returned `status` and `reason` with:

```ts
        const already = existing.has(row.id);
        const fromIbkr = synced.has(row.id);
        return {
          status: already || fromIbkr ? "existing" : "new",
          ticker: row.trade.underlying,
          structure: row.trade.structureLabel ?? "",
          openedAt: row.trade.openedAt,
          closedAt: row.trade.closedAt,
          netPnl: row.trade.netPnl,
          flags: row.flags,
          reason: already ? "already imported" : fromIbkr ? "already synced from IBKR" : null,
        };
```

- change the returned `fresh` to `parsed.filter((row) => !existing.has(row.id) && !synced.has(row.id))`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/server`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/server
git commit -m "fix(server): the oQuants import skips a fly already synced from IBKR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Syncing from the browser, the Scalps page and the nav

**Files:**
- Create: `apps/web/src/ibkr.ts`
- Create: `apps/web/src/ibkr.test.tsx`
- Modify: `apps/web/src/components/Shell.tsx`, `apps/web/src/components/Shell.test.tsx`
- Create: `apps/web/src/routes/Scalps.tsx`, `apps/web/src/routes/Scalps.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: the Task 7 endpoints, and `useFillMoves` (`moves.ts`).
- Produces:

```ts
// apps/web/src/ibkr.ts
type SyncSummary;   // the server's SyncSummary, as the RPC client types it
type IbkrStatus;
const SYNC_KEY: string[];   // ["ibkr-sync"]
const SKIP_REASON: Record<"before_start" | "unrecognised" | "duplicate" | "deleted", string>;
function useIbkrStatus(): UseQueryResult<IbkrStatus>;
function useIbkrSync(): UseMutationResult<SyncSummary, Error, boolean>;   // mutate(auto)
function useIbkrSyncing(): boolean;
function useAutoSync(): void;   // once per page load
// Shell: prop `syncing?: boolean`; "Scalps" in the nav after "Iron Flies".
// Scalps({ onOpenTrade?, onNewScalp? }): the Journal locked to scalps; "+ New scalp" only with onNewScalp.
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/ibkr.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoSync } from "./ibkr.js";

const SUMMARY = {
  status: "ok",
  ran: true,
  account: { externalId: "DU1234567", kind: "paper" },
  added: 1,
  updated: 0,
  unchanged: 0,
  orphaned: 0,
  skipped: [],
  keptEdits: [],
  ignored: { beforeStart: 0, stock: 0, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: ["t1"],
  error: null,
  lastRunAt: 1,
};

function AutoSync() {
  useAutoSync();
  return null;
}

afterEach(() => vi.unstubAllGlobals());

describe("useAutoSync", () => {
  it("asks the server for one automatic sync per page load, even under StrictMode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const body = String(input).includes("/api/moves/fill") ? { filled: 0, missing: [], unavailable: null } : SUMMARY;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <AutoSync />
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/moves/fill"))).toBe(true),
    );
    const syncs = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/ibkr/sync"));
    expect(syncs).toHaveLength(1);
    expect(JSON.parse(String(syncs[0]?.[1]?.body))).toEqual({ auto: true });
    // Trades the sync added get their stock prices, as after a save.
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/moves/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["t1"] });
  });
});
```

In `apps/web/src/components/Shell.test.tsx`, add `"Scalps"` to `DESTINATIONS` after `"Iron Flies"`, and append inside `describe("Shell", …)`:

```tsx
  it("shows a spinner beside Import / Sync while IBKR syncs", () => {
    const { rerender } = render(
      <Shell activePath="/" syncing>
        <p>content</p>
      </Shell>,
    );
    expect(screen.getByRole("status", { name: "Syncing with IBKR" })).toBeTruthy();
    rerender(
      <Shell activePath="/">
        <p>content</p>
      </Shell>,
    );
    expect(screen.queryByRole("status", { name: "Syncing with IBKR" })).toBeNull();
  });
```

Create `apps/web/src/routes/Scalps.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scalps } from "./Scalps.js";

const scalp = {
  id: "s1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: "Long call",
  source: "ibkr_flex",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  grade: null,
  notes: null,
  excluded: false,
  tagIds: [],
  ironFly: null,
  metrics: null,
  legs: [
    { id: "l1", right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06, closePrice: 1.295 },
  ],
};

function setup(onNewScalp?: () => void) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([scalp]), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Scalps onNewScalp={onNewScalp} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Scalps", () => {
  it("asks for scalps only, and lists them under its own title", async () => {
    const fetchMock = setup();
    expect(await screen.findByText("NVDA")).toBeTruthy();
    expect(screen.getByText("Scalps")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("strategy=scalp"))).toBe(true);
    expect(screen.queryByRole("button", { name: "+ New scalp" })).toBeNull();
  });

  it("opens the scalp form from + New scalp", async () => {
    const onNewScalp = vi.fn();
    setup(onNewScalp);
    fireEvent.click(await screen.findByRole("button", { name: "+ New scalp" }));
    expect(onNewScalp).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/ibkr.test.tsx apps/web/src/components/Shell.test.tsx apps/web/src/routes/Scalps.test.tsx`
Expected: FAIL. There's no `./ibkr.js`, no Scalps page, no Scalps in the nav, and no spinner.

- [ ] **Step 3: Implement the hooks**

Create `apps/web/src/ibkr.ts`:

```ts
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./api.js";
import { useFillMoves } from "./moves.js";

type SyncResponse = Awaited<ReturnType<typeof api.api.ibkr.sync.$post>>;
/** What one IBKR sync did (spec §8.2). */
export type SyncSummary = Awaited<ReturnType<SyncResponse["json"]>>;
type StatusResponse = Awaited<ReturnType<typeof api.api.ibkr.status.$get>>;
export type IbkrStatus = Awaited<ReturnType<StatusResponse["json"]>>;

export const SYNC_KEY = ["ibkr-sync"];

/** Why a trade was left out, in the Import card's words. */
export const SKIP_REASON = {
  before_start: "opened before the start date",
  unrecognised: "not an iron fly or a single option: enter it by hand",
  duplicate: "already in the journal",
  deleted: "you deleted it",
} as const;

export function useIbkrStatus() {
  return useQuery({
    queryKey: ["ibkr-status"],
    queryFn: async () => {
      const res = await api.api.ibkr.status.$get();
      if (!res.ok) throw new Error(`IBKR status failed: ${res.status}`);
      return res.json();
    },
  });
}

/**
 * Runs a sync: the button passes `false`, opening the app passes `true`. Afterwards the trade lists refetch,
 * and trades the sync added or changed get their stock prices (move data), as after a save.
 */
export function useIbkrSync() {
  const queryClient = useQueryClient();
  const fill = useFillMoves();
  return useMutation({
    mutationKey: SYNC_KEY,
    mutationFn: async (auto: boolean): Promise<SyncSummary> => {
      const res = await api.api.ibkr.sync.$post({ json: { auto } });
      if (!res.ok) throw new Error(`IBKR sync failed: ${res.status}`);
      return res.json();
    },
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["trade"] }),
      ]);
      if (summary.changedTradeIds.length > 0) fill.mutate(summary.changedTradeIds);
    },
  });
}

/** True while a sync runs, wherever it was started. */
export const useIbkrSyncing = () => useIsMutating({ mutationKey: SYNC_KEY }) > 0;

/** One automatic sync per page load (spec §9.3). The server skips it if the last one is under 15 minutes old. */
export function useAutoSync() {
  const sync = useIbkrSync();
  const started = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice on one component; the ref keeps that to one request.
    if (started.current) return;
    started.current = true;
    sync.mutate(true);
  }, [sync]);
}
```

- [ ] **Step 4: Implement the nav, the Scalps page and the wiring**

In `apps/web/src/components/Shell.tsx`:
- add `{ label: "Scalps", path: "/scalps" },` to `NAV` after Iron Flies;
- change the signature to `export function Shell({ activePath, syncing = false, children }: { activePath: string; syncing?: boolean; children: ReactNode })`;
- in the link, after `{item.label}`, add:

```tsx
                {item.path === "/import" && syncing && (
                  <span role="status" aria-label="Syncing with IBKR" className="ml-1 inline-block animate-spin text-accent">
                    ↻
                  </span>
                )}
```

Create `apps/web/src/routes/Scalps.tsx`:

```tsx
import { Journal } from "./Journal.js";

/** Every scalp, synced from IBKR or typed in (spec §9.1). */
export function Scalps({
  onOpenTrade,
  onNewScalp,
}: {
  onOpenTrade?: (id: string) => void;
  onNewScalp?: () => void;
}) {
  return (
    <Journal
      title="Scalps"
      lockedFilter={{ strategy: "scalp" }}
      onOpenTrade={onOpenTrade}
      actions={
        onNewScalp && (
          <button
            type="button"
            onClick={() => onNewScalp()}
            className="ml-2 rounded-[2px] bg-accent px-2 py-0.5 text-white"
          >
            + New scalp
          </button>
        )
      }
    />
  );
}
```

In `apps/web/src/router.tsx`:
- import `useAutoSync` and `useIbkrSyncing` from `./ibkr.js`, and `Scalps` from `./routes/Scalps.js`;
- change `RootLayout` to:

```tsx
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useAutoSync();
  const syncing = useIbkrSyncing();
  return (
    <Shell activePath={pathname} syncing={syncing}>
      <Outlet />
    </Shell>
  );
}
```

- add a route after `ironFliesRoute`:

```tsx
const scalpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scalps",
  component: () => <Scalps onOpenTrade={openTrade} />,
});
```

- add `scalpsRoute` to `rootRoute.addChildren([...])` after `newIronFlyRoute`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): sync IBKR on open, show it in the nav, and list scalps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: IBKR Flex in Settings

**Files:**
- Modify: `apps/web/src/api.ts` (the shared `refusal` helper)
- Create: `apps/web/src/routes/IbkrSettings.tsx`
- Modify: `apps/web/src/routes/Settings.tsx`
- Create: `apps/web/src/routes/IbkrSettings.test.tsx`

**Interfaces:**
- Consumes: `GET /api/settings` (with its `ibkr` block), and `PUT` and `DELETE /api/settings/ibkr` (Task 6).
- Produces:
  - `api.ts`: `refusal(res, action): Promise<Error>`, moved from `Settings.tsx`;
  - `IbkrSettings({ ibkr, confirm })`, rendered by Settings under the Alpaca panel.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/IbkrSettings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings.js";

const NOT_SET = { configured: false, tokenHint: null, activityQueryId: null, todayQueryId: null, since: null };
const SET = { configured: true, tokenHint: "12…9012", activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28" };
const view = (ibkr: unknown) => ({
  dataDir: "/data",
  marketData: { state: "off", message: null, keyIdHint: null },
  ibkr,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** GET answers the current view; PUT and DELETE answer `reply`, and a 200 reply becomes the new view. */
function stub(initial: unknown, reply?: { status: number; body: unknown }) {
  let current = view(initial);
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") return json(current);
    if (!reply) throw new Error(`unexpected ${method}`);
    if (reply.status === 200) current = reply.body as ReturnType<typeof view>;
    return json(reply.body, reply.status);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSettings(confirm: (text: string) => boolean = () => true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Settings confirm={confirm} />
    </QueryClientProvider>,
  );
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => vi.unstubAllGlobals());

describe("IBKR Flex settings", () => {
  it("says it isn't set up, and saves the token, both query IDs and the start date", async () => {
    const fetchMock = stub(NOT_SET, { status: 200, body: view(SET) });
    renderSettings();
    expect(await screen.findByText("Not set up: scalps and flies from IBKR won't sync")).toBeTruthy();
    expect(screen.getByText("Both machines need the same start date.")).toBeTruthy();
    fill("Flex token", "1234567890123456789012");
    fill("Activity query ID", "1653145");
    fill("Today query ID", "1653147");
    fill("Start date", "2026-09-28");
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    await waitFor(() => expect(screen.getByText(/Set up · token 12…9012/)).toBeTruthy());
    const put = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PUT");
    expect(String(put?.[0])).toContain("/api/settings/ibkr");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      token: "1234567890123456789012",
      activityQueryId: "1653145",
      todayQueryId: "1653147",
      since: "2026-09-28",
    });
    expect((screen.getByLabelText("Flex token") as HTMLInputElement).value).toBe("");
  });

  it("keeps the saved token when the field is left blank", async () => {
    const fetchMock = stub(SET, { status: 200, body: view(SET) });
    renderSettings();
    await screen.findByText(/Set up · token 12…9012/);
    expect((screen.getByLabelText("Activity query ID") as HTMLInputElement).value).toBe("1653145");
    expect(screen.getByLabelText("Flex token").getAttribute("placeholder")).toBe("saved; leave blank to keep it");
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[1]?.method).toUpperCase() === "PUT")).toBe(true),
    );
    const put = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).not.toHaveProperty("token");
  });

  it("shows why IBKR refused", async () => {
    const message = "IBKR rejected the token. Check it was copied in full, or generate a new one in Client Portal.";
    stub(NOT_SET, { status: 400, body: { error: "token_rejected", message } });
    renderSettings();
    await screen.findByText("Not set up: scalps and flies from IBKR won't sync");
    fill("Flex token", "1234567890123456789012");
    fill("Activity query ID", "1653145");
    fill("Today query ID", "1653147");
    fireEvent.click(screen.getByRole("button", { name: "Save IBKR" }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("removes the IBKR setup after asking", async () => {
    const fetchMock = stub(SET, { status: 200, body: view(NOT_SET) });
    const confirm = vi.fn(() => true);
    renderSettings(confirm);
    await screen.findByText(/Set up · token 12…9012/);
    fireEvent.click(screen.getByRole("button", { name: "Remove IBKR" }));
    await screen.findByText("Not set up: scalps and flies from IBKR won't sync");
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.method).toUpperCase() === "DELETE")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/IbkrSettings.test.tsx`
Expected: FAIL. There's no IBKR section yet.

- [ ] **Step 3: Implement**

Move `refusal` out of `apps/web/src/routes/Settings.tsx` into `apps/web/src/api.ts`, exported and unchanged:

```ts
/** The server explains a refusal in `message`; fall back to the status. */
export async function refusal(res: { status: number; json(): Promise<unknown> }, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(body.message ?? `${action} failed: ${res.status}`);
}
```

In `Settings.tsx`, import it: `import { api, refusal } from "../api.js";`.

Create `apps/web/src/routes/IbkrSettings.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, refusal } from "../api.js";
import { Panel } from "../components/ui.js";
import { todayNy } from "../market.js";

export interface IbkrView {
  configured: boolean;
  tokenHint: string | null;
  activityQueryId: string | null;
  todayQueryId: string | null;
  since: string | null;
}

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none placeholder:text-[#4a5163] placeholder:italic focus:border-accent";

/** The IBKR Flex Web Service: token, the two queries, and the date the sync starts from (spec §9.4). */
export function IbkrSettings({ ibkr, confirm }: { ibkr: IbkrView; confirm: (text: string) => boolean }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [activityQueryId, setActivity] = useState(ibkr.activityQueryId ?? "");
  const [todayQueryId, setToday] = useState(ibkr.todayQueryId ?? "");
  const [since, setSince] = useState(ibkr.since ?? todayNy());

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["settings"] }),
      queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
    ]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings.ibkr.$put({
        json: { token: token.trim() || undefined, activityQueryId, todayQueryId, since },
      });
      if (!res.ok) throw await refusal(res, "save");
    },
    onSuccess: async () => {
      setToken("");
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings.ibkr.$delete();
      if (!res.ok) throw await refusal(res, "remove");
    },
    onSuccess: refresh,
  });

  const status = ibkr.configured
    ? `Set up · token ${ibkr.tokenHint} · Activity ${ibkr.activityQueryId} · Today ${ibkr.todayQueryId} · from ${ibkr.since}`
    : "Not set up: scalps and flies from IBKR won't sync";
  const problem = save.error ?? remove.error;

  return (
    <Panel title="IBKR Flex">
      <p className="mb-2 flex items-center gap-2 rounded-sm border border-line bg-[#0e1118] px-2 py-1">
        <span className={`inline-block size-2 rounded-full ${ibkr.configured ? "bg-up" : "bg-muted"}`} />
        <span>{status}</span>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <label className={FIELD}>
          Flex token
          <input
            aria-label="Flex token"
            type="password"
            autoComplete="off"
            value={token}
            placeholder={ibkr.configured ? "saved; leave blank to keep it" : ""}
            onChange={(event) => setToken(event.target.value)}
            className={INPUT}
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className={FIELD}>
            Activity query ID
            <input
              aria-label="Activity query ID"
              value={activityQueryId}
              onChange={(event) => setActivity(event.target.value)}
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Today query ID
            <input
              aria-label="Today query ID"
              value={todayQueryId}
              onChange={(event) => setToday(event.target.value)}
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Start date
            <input
              aria-label="Start date"
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
              className={INPUT}
            />
          </label>
        </div>
        <p className="text-[10px] text-muted">
          In Client Portal, Performance &amp; Reports → Flex Queries shows each query's ID, and Settings → Account Settings →
          Flex Web Service gives the token.
        </p>
        <p className="text-[10px] text-muted">Both machines need the same start date.</p>
        <div className="flex gap-2">
          <button
            type="submit"
            aria-label="Save IBKR"
            disabled={save.isPending}
            className="rounded-sm bg-accent px-3 py-1 text-white disabled:opacity-50"
          >
            {save.isPending ? "Testing with IBKR…" : "Save"}
          </button>
          {ibkr.configured && (
            <button
              type="button"
              aria-label="Remove IBKR"
              onClick={() => {
                if (confirm("Remove the IBKR token and queries from this machine?")) remove.mutate();
              }}
              className="rounded-sm border border-line px-3 py-1 text-fg hover:border-accent"
            >
              Remove
            </button>
          )}
        </div>
        {problem && <p className="text-down">{problem.message}</p>}
      </form>
    </Panel>
  );
}
```

In `apps/web/src/routes/Settings.tsx`:
- import `IbkrSettings` and `type IbkrView` from `./IbkrSettings.js`;
- add below the Alpaca `</Panel>`:

```tsx
      {data && (
        // Keyed by what's saved, so the fields start from it once it loads and after each save.
        <IbkrSettings
          key={`${data.ibkr?.tokenHint}-${data.ibkr?.activityQueryId}-${data.ibkr?.since}`}
          ibkr={data.ibkr ?? NOT_SET}
          confirm={confirm}
        />
      )}
```

- add at module level:

```ts
const NOT_SET: IbkrView = {
  configured: false,
  tokenHint: null,
  activityQueryId: null,
  todayQueryId: null,
  since: null,
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, including the existing Settings tests, whose views have no `ibkr` and show the "not set up" state.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): IBKR Flex token, queries and start date in Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The IBKR card on Import / Sync

**Files:**
- Create: `apps/web/src/routes/IbkrCard.tsx`
- Create: `apps/web/src/routes/IbkrCard.test.tsx`
- Modify: `apps/web/src/routes/Import.tsx`
- Modify: `apps/web/src/routes/Import.test.tsx`

**Interfaces:**
- Consumes: `useIbkrStatus`, `useIbkrSync`, `useIbkrSyncing` and `SKIP_REASON` (Task 9).
- Produces: `IbkrCard()`, rendered first on the Import page.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/IbkrCard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IbkrCard } from "./IbkrCard.js";

const RUN_AT = Date.UTC(2026, 8, 29, 14, 32); // 10:32 ET
const summary = (overrides: Record<string, unknown> = {}) => ({
  status: "ok",
  ran: true,
  account: { externalId: "DU1234567", kind: "paper" },
  added: 2,
  updated: 1,
  unchanged: 5,
  orphaned: 0,
  skipped: [
    { reason: "duplicate", ticker: "AA", openedAt: Date.UTC(2026, 8, 28, 17, 52) },
    { reason: "unrecognised", ticker: "SPY", openedAt: Date.UTC(2026, 8, 28, 14, 0) },
  ],
  keptEdits: [{ tradeId: "t9", ticker: "NVDA", netPnl: 44.74 }],
  ignored: { beforeStart: 917, stock: 3, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: [],
  error: null,
  lastRunAt: RUN_AT,
  ...overrides,
});
const status = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  since: "2026-09-28",
  lastRunAt: RUN_AT,
  lastStatus: "ok",
  lastError: null,
  lastSummary: summary(),
  ...overrides,
});

function stub(statusBody: unknown, syncBody: unknown = summary()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/ibkr/status") ? statusBody : url.includes("/api/ibkr/sync") ? syncBody : {};
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IbkrCard />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("IbkrCard", () => {
  it("points to Settings when IBKR isn't set up", async () => {
    stub(status({ configured: false, lastRunAt: null, lastStatus: null, lastSummary: null }));
    renderCard();
    expect((await screen.findByTestId("ibkr-status")).textContent).toBe(
      "Not set up. Add your Flex token and query IDs in Settings.",
    );
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the last run in plain words", async () => {
    stub(status());
    renderCard();
    expect((await screen.findByTestId("ibkr-status")).textContent).toBe(
      "Paper DU1234567 · last synced Sep 29, 10:32 ET · 2 added, 1 updated, 5 unchanged",
    );
    expect(screen.getByText(/AA · Sep 28, 13:52 — already in the journal/)).toBeTruthy();
    expect(screen.getByText(/SPY · Sep 28, 10:00 — not an iron fly or a single option: enter it by hand/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "NVDA" }).getAttribute("href")).toBe("/trades/t9");
    expect(screen.getByText("917 fills before the start date, 3 stock rows ignored.")).toBeTruthy();
  });

  it("shows an error the last run ended with", async () => {
    const message = "IBKR rejected the token (Token has expired.). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.";
    stub(status({ lastStatus: "error", lastError: message, lastSummary: summary({ status: "error", error: { kind: "token", message } }) }));
    renderCard();
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says when the Activity statement failed", async () => {
    stub(status({ lastSummary: summary({ activityFailed: true }) }));
    renderCard();
    expect(await screen.findByText("The Activity statement failed; today's fills are in.")).toBeTruthy();
  });

  it("runs a sync on request", async () => {
    const fetchMock = stub(status(), summary({ added: 4 }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(screen.getByTestId("ibkr-status").textContent).toContain("4 added"));
    const post = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/ibkr/sync"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ auto: false });
  });
});
```

The existing Import tests queue their responses with `mockResolvedValueOnce`, in order. Once the card is on the page, its status request on mount would take the preview's response. Make them answer by URL: in `apps/web/src/routes/Import.test.tsx`, add below `json`:

```ts
/** The IBKR card asks for its status on mount; every other request gets the next of `responses`, in order. */
function stubFetch(...responses: Response[]) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).includes("/api/ibkr/status")) {
      return json({ configured: false, since: null, lastRunAt: null, lastStatus: null, lastError: null, lastSummary: null });
    }
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${String(input)}`);
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The requests the Import panel made: all but the IBKR card's status. */
const requests = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter((call) => !String(call[0]).includes("/api/ibkr/status"));
```

Then replace each test's stub:
- "previews the pasted export…": `stubFetch(json(preview), json({ imported: 1, backupFile: "/data/backups/journal-x.db", importedIds: [] }));`
- "drops the preview…": `stubFetch(json(preview));`
- "says so, without calling the server…": `const fetchMock = stubFetch();`, and its last line becomes `expect(requests(fetchMock)).toEqual([]);`
- "shows the server's reason…": `stubFetch(json({ error: 'the "Cost" column is missing' }, 422));`
- "fetches the imported trades' stock prices…": `const fetchMock = stubFetch(json(preview), json({ imported: 1, backupFile: null, importedIds: ["id-1"] }), json({ filled: 1, missing: [{ tradeId: "id-1", underlying: "XYZ", side: "exit", reason: "no_bars" }], unavailable: null }));`, and both `fetchMock.mock.calls[2]` become `requests(fetchMock)[2]`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/IbkrCard.test.tsx apps/web/src/routes/Import.test.tsx`
Expected: IbkrCard FAILs, because `./IbkrCard.js` doesn't exist. The Import tests PASS: their stubs changed, not what they check.

- [ ] **Step 3: Implement**

Create `apps/web/src/routes/IbkrCard.tsx`:

```tsx
import { Panel } from "../components/ui.js";
import { SKIP_REASON, type SyncSummary, useIbkrStatus, useIbkrSync, useIbkrSyncing } from "../ibkr.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const when = (at: number) => ET.format(new Date(at));

function ignoredLine(ignored: SyncSummary["ignored"]): string | null {
  const parts = [
    ignored.beforeStart > 0 ? `${ignored.beforeStart} fills before the start date` : null,
    ignored.stock > 0 ? `${ignored.stock} stock rows` : null,
    ignored.other > 0 ? `${ignored.other} other rows` : null,
    ignored.malformed > 0 ? `${ignored.malformed} unreadable rows` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(", ")} ignored.` : null;
}

/** The IBKR sync on Import / Sync: what the last run did, and a button to run one (spec §9.2). */
export function IbkrCard() {
  const status = useIbkrStatus();
  const sync = useIbkrSync();
  const syncing = useIbkrSyncing();
  const configured = status.data?.configured === true;
  const summary = sync.data ?? status.data?.lastSummary ?? null;

  let line: string;
  if (!status.data) line = "Loading…";
  else if (!configured) line = "Not set up. Add your Flex token and query IDs in Settings.";
  else if (!summary) line = "Not synced yet.";
  else if (summary.status === "error") line = summary.error?.message ?? "The last sync failed.";
  else {
    const account = summary.account
      ? `${summary.account.kind === "paper" ? "Paper" : "Live"} ${summary.account.externalId}`
      : "IBKR";
    const at = summary.lastRunAt != null ? ` · last synced ${when(summary.lastRunAt)} ET` : "";
    line = `${account}${at} · ${summary.added} added, ${summary.updated} updated, ${summary.unchanged} unchanged`;
  }
  const failed = summary?.status === "error";
  const ignored = summary && !failed ? ignoredLine(summary.ignored) : null;

  return (
    <Panel title="IBKR · paper sync">
      <div className="flex flex-wrap items-center gap-3">
        <p data-testid="ibkr-status" className={failed ? "text-down" : "text-fg"}>
          {line}
        </p>
        <button
          type="button"
          disabled={!configured || syncing}
          onClick={() => sync.mutate(false)}
          className="rounded-sm border border-accent bg-[#2962ff1a] px-3 py-1 text-fg disabled:opacity-50"
        >
          {syncing ? "Syncing with IBKR…" : "Sync now"}
        </button>
      </div>
      {summary && !failed && (
        <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
          {summary.activityFailed && <p className="text-down">The Activity statement failed; today's fills are in.</p>}
          {summary.skipped.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {summary.skipped.map((skip) => (
                <li key={`${skip.ticker}-${skip.openedAt}-${skip.reason}`}>
                  Skipped {skip.ticker} · {when(skip.openedAt)} — {SKIP_REASON[skip.reason]}
                </li>
              ))}
            </ul>
          )}
          {summary.keptEdits.length > 0 && (
            <p>
              Kept your edits on{" "}
              {summary.keptEdits.map((kept, index) => (
                <span key={kept.tradeId}>
                  {index > 0 && ", "}
                  <a href={`/trades/${kept.tradeId}`} className="text-accent">
                    {kept.ticker}
                  </a>
                </span>
              ))}
              ; IBKR has different numbers for them.
            </p>
          )}
          {ignored && <p>{ignored}</p>}
        </div>
      )}
    </Panel>
  );
}
```

In `apps/web/src/routes/Import.tsx`, import `IbkrCard` from `./IbkrCard.js`, and render `<IbkrCard />` as the first child of the outer `<div className="flex flex-col gap-3">`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, including the Import tests, where the card says "Not set up…".

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): the IBKR card on Import / Sync: last run, reasons in words, Sync now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The scalp trade page, its fills, and edits kept

**Files:**
- Modify: `apps/web/src/api.ts` (`TradeFill`, `TradeDetailView`)
- Create: `apps/web/src/routes/ScalpTiles.tsx`
- Create: `apps/web/src/routes/FillsPanel.tsx`
- Create: `apps/web/src/routes/SyncedBanner.tsx`
- Modify: `apps/web/src/routes/TradeDetail.tsx`
- Test: `apps/web/src/routes/TradeDetail.test.tsx`

**Interfaces:**
- Consumes: `GET /api/trades/:id` with its `fills`, `POST /api/ibkr/trades/:id/reset` (Task 7), and `useIbkrStatus` (Task 9).
- Produces:

```ts
// api.ts
type TradeFill = { id: string; executedAt: number; quantity: number; price: number; commission: number;
  kind: string; canceled: boolean; openClose: string | null; right: string; strike: number; expiry: string };
type TradeDetailView = TradeView & { fills: TradeFill[] };
// ScalpTiles.tsx
function heldText(ms: number): string;   // "15 min", "3 h 20 min", "2 d 4 h"
function ScalpTiles({ trade }: { trade: TradeView }): JSX.Element;   // test ids tile-contract … tile-return
// FillsPanel.tsx
function FillsPanel({ fills }: { fills: TradeFill[] }): JSX.Element | null;
// SyncedBanner.tsx
function SyncedBanner({ trade }: { trade: TradeView }): JSX.Element | null;
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/routes/TradeDetail.test.tsx`:

```tsx
const NVDA_OPEN = Date.UTC(2026, 8, 28, 13, 31, 5);
const NVDA_CLOSE = Date.UTC(2026, 8, 28, 13, 46, 12);

/** This morning's NVDA scalp, synced from IBKR, with its four fills. */
const nvda = {
  ...trade,
  id: "nvda",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: "Long call",
  source: "ibkr_flex",
  factsEditedAt: null,
  openedAt: NVDA_OPEN,
  closedAt: NVDA_CLOSE,
  netPnl: 44.74,
  fees: 2.26,
  ironFly: null,
  metrics: null,
  legs: [
    { id: "l-nvda", right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06, closePrice: 1.295 },
  ],
  fills: [
    { id: "f1", executedAt: NVDA_OPEN, quantity: 1, price: 1.06, commission: 0.0833, kind: "trade", canceled: false, openClose: "O", right: "C", strike: 232.5, expiry: "2026-09-28" },
    { id: "f2", executedAt: NVDA_OPEN, quantity: 1, price: 1.06, commission: 0.8453, kind: "trade", canceled: false, openClose: "O", right: "C", strike: 232.5, expiry: "2026-09-28" },
    { id: "f3", executedAt: Date.UTC(2026, 8, 28, 13, 31, 49), quantity: -1, price: 1.44, commission: 0.7736, kind: "trade", canceled: false, openClose: "C", right: "C", strike: 232.5, expiry: "2026-09-28" },
    { id: "f4", executedAt: NVDA_CLOSE, quantity: -1, price: 1.15, commission: 0.561, kind: "trade", canceled: false, openClose: "C", right: "C", strike: 232.5, expiry: "2026-09-28" },
  ],
};

/** Answers the trade, the IBKR status (with `keptEdits`), and a reset. */
function stubSynced(body: unknown, keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const payload = url.includes("/api/ibkr/status")
      ? { configured: true, since: "2026-09-28", lastRunAt: 1, lastStatus: "ok", lastError: null, lastSummary: { keptEdits } }
      : url.includes("/reset")
        ? { status: "ok" }
        : body;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TradeDetail for a scalp", () => {
  it("shows the scalp's own tiles", async () => {
    stubSynced(nvda);
    renderDetail();
    expect((await screen.findByTestId("tile-contract")).textContent).toContain("NVDA 232.5C · exp Sep 28");
    expect(screen.getByTestId("tile-size").textContent).toContain("2 contracts");
    expect(screen.getByTestId("tile-entry-exit").textContent).toContain("1.06 → 1.295");
    expect(screen.getByTestId("tile-held").textContent).toContain("15 min");
    expect(screen.getByTestId("tile-fees").textContent).toContain("$2.26");
    expect(screen.getByTestId("tile-return").textContent).toContain("+21.10%");
    expect(screen.queryByTestId("tile-max-loss")).toBeNull();
  });

  it("lists every fill of a synced trade", async () => {
    stubSynced(nvda);
    renderDetail();
    const rows = await screen.findAllByTestId(/^fill-row-/);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("Sep 28 09:31:05");
    expect(rows[0]?.textContent).toContain("BUY");
    expect(rows[3]?.textContent).toContain("SELL");
    expect(rows[3]?.textContent).toContain("1.15");
  });

  it("labels expiries and canceled fills", async () => {
    stubSynced({
      ...nvda,
      fills: [
        { ...nvda.fills[0], id: "e", kind: "expiration", price: 0 },
        { ...nvda.fills[1], id: "c", canceled: true },
      ],
    });
    renderDetail();
    expect((await screen.findByTestId("fill-row-e")).textContent).toContain("expired");
    expect(screen.getByTestId("fill-row-c").textContent).toContain("canceled");
  });

  it("says the user's edits are kept, and hands the trade back to IBKR on request", async () => {
    const fetchMock = stubSynced({ ...nvda, factsEditedAt: 5, netPnl: 50 }, [
      { tradeId: "nvda", ticker: "NVDA", netPnl: 44.74 },
    ]);
    renderDetail();
    expect(
      await screen.findByText("Your edits are kept. Later syncs won't change this trade. IBKR now has +$44.74 net."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use IBKR's numbers" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/ibkr/trades/nvda/reset"))).toBe(true),
    );
  });

  it("shows no banner, and asks nothing of IBKR, on a synced trade the user hasn't changed", async () => {
    const fetchMock = stubSynced(nvda);
    renderDetail();
    await screen.findByTestId("tile-contract");
    expect(screen.queryByRole("button", { name: "Use IBKR's numbers" })).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/ibkr/status"))).toBe(false);
  });
});

describe("heldText", () => {
  it("reads minutes, hours and days", async () => {
    const { heldText } = await import("./ScalpTiles.js");
    expect(heldText(15 * 60_000 + 7_000)).toBe("15 min");
    expect(heldText(3 * 3_600_000 + 20 * 60_000)).toBe("3 h 20 min");
    expect(heldText(2 * 3_600_000)).toBe("2 h");
    expect(heldText(52 * 3_600_000)).toBe("2 d 4 h");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. There are no scalp tiles, no Fills panel and no banner.

- [ ] **Step 3: Add the types and the three components**

Append to `apps/web/src/api.ts`:

```ts
/** One fill on the trade page's Fills panel (spec §9.5). */
export interface TradeFill {
  id: string;
  executedAt: number;
  quantity: number;
  price: number;
  commission: number;
  kind: string;
  canceled: boolean;
  openClose: string | null;
  right: string;
  strike: number;
  expiry: string;
}

/** A trade as its own page loads it: with its fills. */
export type TradeDetailView = TradeView & { fills: TradeFill[] };
```

Create `apps/web/src/routes/ScalpTiles.tsx`:

```tsx
import type { TradeView } from "../api.js";
import { Pct, Tile } from "../components/ui.js";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
/** Up to 4 decimals, trailing zeros dropped: 1.06, 1.295. */
const price = (value: number) => String(Number(value.toFixed(4)));
const expiryText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How long a trade was held: "15 min", "3 h 20 min", "2 d 4 h". */
export function heldText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** A scalp's tiles (spec §9.5): one contract, bought and sold. */
export function ScalpTiles({ trade }: { trade: TradeView }) {
  const leg = trade.legs[0];
  const contracts = leg ? Math.abs(leg.quantity) : 0;
  const cost = leg ? contracts * leg.multiplier * leg.openPrice : 0;
  const returnOnCost = trade.netPnl != null && cost > 0 ? trade.netPnl / cost : null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <Tile label="Contract" testId="tile-contract">
        {leg ? `${trade.underlying} ${leg.strike}${leg.right} · exp ${expiryText(leg.expiry)}` : trade.underlying}
      </Tile>
      <Tile label="Size" testId="tile-size">
        {contracts} contract{contracts === 1 ? "" : "s"}
      </Tile>
      <Tile label="Entry → exit" testId="tile-entry-exit">
        {leg ? `${price(leg.openPrice)} → ${leg.closePrice == null ? "open" : price(leg.closePrice)}` : "—"}
      </Tile>
      <Tile label="Held" testId="tile-held">
        {trade.closedAt == null ? "open" : heldText(trade.closedAt - trade.openedAt)}
      </Tile>
      <Tile label="Fees" testId="tile-fees">
        {usd(trade.fees)}
      </Tile>
      <Tile label="Return on cost" testId="tile-return">
        <Pct value={returnOnCost} />
      </Tile>
    </div>
  );
}
```

Create `apps/web/src/routes/FillsPanel.tsx`:

```tsx
import type { TradeFill } from "../api.js";
import { Panel } from "../components/ui.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
/** "Sep 28 09:31:05" in New York time. */
function fillTime(at: number): string {
  const parts = Object.fromEntries(ET.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const KIND_LABEL: Record<string, string> = { expiration: "expired", exercise: "exercised", assignment: "assigned" };

/** Every fill of a synced trade, as IBKR reported it (spec §9.5). Nothing for a trade typed in by hand. */
export function FillsPanel({ fills }: { fills: TradeFill[] }) {
  if (fills.length === 0) return null;
  return (
    <Panel title="Fills">
      <table className="num w-full border-collapse text-[11px]">
        <thead className="text-[9px] text-muted uppercase tracking-wider">
          <tr>
            <th className="text-left font-medium">Time (ET)</th>
            <th className="text-left font-medium">Side</th>
            <th className="text-left font-medium">Contract</th>
            <th className="text-right font-medium">Size</th>
            <th className="text-right font-medium">Price</th>
            <th className="text-right font-medium">Commission</th>
            <th className="text-left font-medium" />
          </tr>
        </thead>
        <tbody>
          {fills.map((fill) => (
            <tr
              key={fill.id}
              data-testid={`fill-row-${fill.id}`}
              className={`border-line border-t ${fill.canceled ? "text-muted line-through" : ""}`}
            >
              <td>{fillTime(fill.executedAt)}</td>
              <td className={fill.quantity > 0 ? "text-up" : "text-down"}>{fill.quantity > 0 ? "BUY" : "SELL"}</td>
              <td>
                {fill.strike}
                {fill.right}
              </td>
              <td className="text-right">{Math.abs(fill.quantity)}</td>
              <td className="text-right">{fill.price.toFixed(2)}</td>
              <td className="text-right">{usd(fill.commission)}</td>
              <td className="pl-2 text-muted">{fill.canceled ? "canceled" : (KIND_LABEL[fill.kind] ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
```

Create `apps/web/src/routes/SyncedBanner.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TradeView } from "../api.js";
import { useIbkrStatus } from "../ibkr.js";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const ibkrNow = (netPnl: number | null) =>
  netPnl == null ? "IBKR has it still open." : `IBKR now has ${netPnl > 0 ? "+" : ""}${usd(netPnl)} net.`;

/** On a synced trade whose facts the user changed: their edits win until they choose IBKR's numbers (spec §5.3). */
export function SyncedBanner({ trade }: { trade: TradeView }) {
  if (trade.source !== "ibkr_flex" || trade.factsEditedAt == null) return null;
  return <KeptEdits tradeId={trade.id} />;
}

/** Split out so that only these trades ask for the IBKR status. */
function KeptEdits({ tradeId }: { tradeId: string }) {
  const queryClient = useQueryClient();
  const status = useIbkrStatus();
  const reset = useMutation({
    mutationFn: async () => {
      const res = await api.api.ibkr.trades[":id"].reset.$post({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`reset failed: ${res.status}`);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade", tradeId] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
      ]),
  });
  // What IBKR has now, when the last sync found it different (spec §9.5).
  const kept = status.data?.lastSummary?.keptEdits.find((each) => each.tradeId === tradeId);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-accent bg-[#2962ff14] px-3 py-2">
      <p>
        Your edits are kept. Later syncs won't change this trade.
        {kept ? ` ${ibkrNow(kept.netPnl)}` : ""}
      </p>
      <button
        type="button"
        disabled={reset.isPending}
        onClick={() => reset.mutate()}
        className="rounded-sm border border-line px-3 py-1 text-fg hover:border-accent disabled:opacity-50"
      >
        Use IBKR's numbers
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Put them on the trade page**

In `apps/web/src/routes/TradeDetail.tsx`:
- change `import { api, type TradeView } from "../api.js";` to `import { api, type TradeDetailView } from "../api.js";`, and the query's `Promise<TradeView>` to `Promise<TradeDetailView>`;
- import `FillsPanel`, `ScalpTiles` and `SyncedBanner` from `./FillsPanel.js`, `./ScalpTiles.js` and `./SyncedBanner.js`;
- right after `      </header>`, add `      <SyncedBanner trade={trade} />`;
- wrap the fly tiles grid (from `<div className="grid grid-cols-2 gap-2 lg:grid-cols-5">` to its closing `</div>`, just above `{trade.strategy === "iron_fly" && <MoveTiles …`) as:

```tsx
      {trade.strategy === "iron_fly" ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {/* the five fly tiles, unchanged */}
        </div>
      ) : (
        <ScalpTiles trade={trade} />
      )}
```

  (Keep the five `<Tile>` elements as they are inside it.)
- after the closing `</div>` of the Legs / Review grid (`<div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">`), add `      <FillsPanel fills={trade.fills ?? []} />`. The `?? []` covers older cached trades.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS, including every existing TradeDetail test. Their fixtures have no `fills`, so the panel is skipped; they have no `source`, so there's no banner.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): scalp tiles, every fill of a synced trade, and a banner when your edits are kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The scalp form

**Files:**
- Create: `apps/web/src/routes/ScalpForm.tsx`
- Create: `apps/web/src/routes/ScalpForm.test.tsx`
- Create: `apps/web/src/routes/NewScalp.tsx`
- Modify: `apps/web/src/routes/EditTrade.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/routes/EditTrade.test.tsx`

**Interfaces:**
- Consumes: `positionCash` and `PricedLeg` (`@tj/core`); `useChain`, `useCompanyName`, `useSettled`, `todayNy`, `ExpirySelect` and `StrikeSelect` (existing web code).
- Produces:

```ts
interface ScalpFormValues { underlying: string; underlyingName: string; right: "C" | "P"; expiry: string; strike: string;
  size: string; entry: string; exit: string; openedAt: string; closedAt: string; feesOpen: string; feesClose: string;
  book: "live" | "paper"; notes: string }
function ScalpForm(props: { initial?: Partial<ScalpFormValues>; submitLabel: string; busy?: boolean; error?: string | null;
  notice?: ReactNode; onSubmit: (payload: Record<string, unknown>) => void }): JSX.Element;
function NewScalp({ onCreated }: { onCreated?: (id: string) => void }): JSX.Element;
function toScalpFormValues(trade: TradeView): Partial<ScalpFormValues>;   // EditTrade.tsx
// route /scalps/new; Scalps gets onNewScalp.
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/ScalpForm.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewScalp } from "./NewScalp.js";
import { ScalpForm, type ScalpFormValues } from "./ScalpForm.js";

const NO_KEY = {
  symbol: "NVDA",
  expirations: [],
  unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
};

/** No chain (no key), no company name, and `created` for a POST. */
function stubApi(created: unknown = { id: "new-scalp" }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = path.startsWith("/api/chains/")
      ? NO_KEY
      : path.startsWith("/api/company/")
        ? { name: null }
        : method === "POST"
          ? created
          : {};
    return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function setup(initial?: Partial<ScalpFormValues>) {
  stubApi();
  const onSubmit = vi.fn();
  render(
    <QueryClientProvider client={client()}>
      <ScalpForm initial={initial} submitLabel="Save scalp" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

/** This morning's NVDA scalp, typed in. */
function typeNvda() {
  fill("Underlying", "NVDA");
  fill("Call or put", "C");
  fill("Expiry", "2026-09-28");
  fill("Strike", "232.5");
  fill("Size", "2");
  fill("Entry price", "1.06");
  fill("Exit price", "1.295");
  fill("Entry fees", "0.93");
  fill("Exit fees", "1.33");
}

afterEach(() => vi.unstubAllGlobals());

describe("ScalpForm", () => {
  it("works out the cost, P&L and return on cost as you type", () => {
    setup();
    typeNvda();
    const derived = screen.getByTestId("scalp-derived").textContent;
    expect(derived).toContain("$212.00"); // cost: 2 × 100 × 1.06
    expect(derived).toContain("+$47.00"); // before fees
    expect(derived).toContain("+$44.74"); // net
    expect(derived).toContain("+21.10%");
  });

  it("saves one long leg, with the P&L the legs imply", () => {
    const { onSubmit } = setup();
    typeNvda();
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      strategy: "scalp",
      book: "paper",
      underlying: "NVDA",
      structureLabel: "Long call",
      netPnl: 44.74,
      fees: 2.26,
      feesOpen: 0.93,
      feesClose: 1.33,
      legs: [{ right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06, closePrice: 1.295 }],
    });
  });

  it("keeps a scalp with no exit open", () => {
    const { onSubmit } = setup();
    typeNvda();
    fill("Exit price", "");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ netPnl: null, legs: [expect.objectContaining({ closePrice: null })] });
  });

  it("refuses a fractional size, and a scalp without a strike", () => {
    const { onSubmit } = setup();
    typeNvda();
    fill("Size", "1.5");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(screen.getByText("Sizes are whole contracts.")).toBeTruthy();
    fill("Size", "2");
    fill("Strike", "");
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    expect(screen.getByText("A strike, an expiry, a size and an entry price are required.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts from a scalp being edited", () => {
    setup({ underlying: "TSLA", right: "P", strike: "365", size: "2", entry: "1.64", exit: "3.155" });
    expect((screen.getByLabelText("Underlying") as HTMLInputElement).value).toBe("TSLA");
    expect((screen.getByLabelText("Call or put") as HTMLSelectElement).value).toBe("P");
  });

  it("shows a notice above the form", () => {
    stubApi();
    render(
      <QueryClientProvider client={client()}>
        <ScalpForm submitLabel="Save" onSubmit={vi.fn()} notice={<p>Synced from IBKR.</p>} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Synced from IBKR.")).toBeTruthy();
  });
});

describe("NewScalp", () => {
  it("posts the scalp and reports the new id", async () => {
    const fetchMock = stubApi({ id: "new-scalp" });
    const onCreated = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <NewScalp onCreated={onCreated} />
      </QueryClientProvider>,
    );
    typeNvda();
    fireEvent.click(screen.getByRole("button", { name: "Save scalp" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-scalp"));
    const post = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ strategy: "scalp", netPnl: 44.74 });
  });
});
```

Append inside `describe("EditTrade", …)` in `apps/web/src/routes/EditTrade.test.tsx`:

```tsx
  it("edits a scalp in the scalp form, and says a synced trade's edits are kept", async () => {
    const scalp = {
      ...trade,
      strategy: "scalp",
      underlying: "NVDA",
      source: "ibkr_flex",
      structureLabel: "Long call",
      ironFly: null,
      fees: 2.26,
      feesOpen: 0.93,
      feesClose: 1.33,
      legs: [
        { id: "s1", right: "C", strike: 232.5, expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1.06, closePrice: 1.295 },
      ],
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(scalp), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = setup();
    expect(
      await screen.findByText("Synced from IBKR. Changes you make here are kept: later syncs won't overwrite them."),
    ).toBeTruthy();
    expect((screen.getByLabelText("Strike") as HTMLInputElement).value).toBe("232.5");
    fireEvent.change(screen.getByLabelText("Exit price"), { target: { value: "1.40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1"));
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body)).legs[0]).toMatchObject({ closePrice: 1.4, quantity: 2 });
  });

  it("says a synced fly's edits are kept too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...trade, source: "ibkr_flex" }), { headers: { "content-type": "application/json" } })),
    );
    setup();
    expect(
      await screen.findByText("Synced from IBKR. Changes you make here are kept: later syncs won't overwrite them."),
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run apps/web/src/routes/ScalpForm.test.tsx apps/web/src/routes/EditTrade.test.tsx`
Expected: FAIL. There's no `ScalpForm` or `NewScalp`, and EditTrade answers "Only iron flies can be edited here for now."

- [ ] **Step 3: Implement the form**

Create `apps/web/src/routes/ScalpForm.tsx`:

```tsx
import { type PricedLeg, positionCash } from "@tj/core";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Money, Panel, Pct } from "../components/ui.js";
import { todayNy, useChain, useCompanyName, useSettled } from "../market.js";
import { ExpirySelect, StrikeSelect } from "./ChainPickers.js";

export interface ScalpFormValues {
  underlying: string;
  underlyingName: string;
  right: "C" | "P";
  expiry: string;
  strike: string;
  size: string;
  entry: string;
  exit: string;
  openedAt: string;
  closedAt: string;
  feesOpen: string;
  feesClose: string;
  book: "live" | "paper";
  notes: string;
}

const EMPTY: ScalpFormValues = {
  underlying: "",
  underlyingName: "",
  right: "C",
  expiry: "",
  strike: "",
  size: "1",
  entry: "",
  exit: "",
  openedAt: "",
  closedAt: "",
  feesOpen: "0",
  feesClose: "0",
  book: "paper",
  notes: "",
};

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent";
const num = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));
const zeroIfBlank = (value: string): number => (Number.isNaN(num(value)) ? 0 : num(value));
const millis = (value: string): number => (value ? new Date(value).getTime() : Number.NaN);
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export interface ScalpFormProps {
  initial?: Partial<ScalpFormValues>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  /** Shown above the form, e.g. that a synced trade's edits are kept. */
  notice?: ReactNode;
  onSubmit: (payload: Record<string, unknown>) => void;
}

/** One bought call or put, typed in or edited (spec §9.6). Money is derived from the prices, never typed twice. */
export function ScalpForm({ initial, submitLabel, busy, error, notice, onSubmit }: ScalpFormProps) {
  const [values, setValues] = useState<ScalpFormValues>({ ...EMPTY, ...initial });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof ScalpFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const setValue = (key: keyof ScalpFormValues, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const symbol = useSettled(values.underlying.trim().toUpperCase());
  const today = todayNy();
  const openedOn = values.openedAt ? values.openedAt.slice(0, 10) : today;
  const chain = useChain(symbol, openedOn < today ? openedOn : undefined);
  const expirations = chain.data?.expirations ?? [];
  const strikes = expirations.find((expiration) => expiration.date === values.expiry)?.strikes ?? [];

  // A blank Company is filled in from Alpaca; a typed one is never replaced.
  const company = useCompanyName(symbol);
  const companyName = company.isSuccess ? company.data : null;
  useEffect(() => {
    if (!companyName) return;
    setValues((current) =>
      current.underlyingName.trim() === "" ? { ...current, underlyingName: companyName } : current,
    );
  }, [companyName]);

  const derived = useMemo(() => {
    const size = num(values.size);
    const strike = num(values.strike);
    const entry = num(values.entry);
    if (Number.isNaN(size) || size <= 0 || Number.isNaN(strike) || Number.isNaN(entry)) return null;
    const exit = num(values.exit);
    const leg: PricedLeg = {
      right: values.right,
      strike,
      quantity: size,
      multiplier: 100,
      openPrice: entry,
      closePrice: Number.isNaN(exit) ? null : exit,
    };
    const cash = positionCash([leg], { open: zeroIfBlank(values.feesOpen), close: zeroIfBlank(values.feesClose) });
    const cost = size * 100 * entry;
    return { leg, cash, cost, returnOnCost: cash.netPnl != null && cost > 0 ? cash.netPnl / cost : null };
  }, [values]);

  function submit() {
    const size = num(values.size);
    if (!Number.isNaN(size) && !Number.isInteger(size)) {
      setProblem("Sizes are whole contracts.");
      return;
    }
    if (!derived || !values.expiry) {
      setProblem("A strike, an expiry, a size and an entry price are required.");
      return;
    }
    setProblem(null);
    const { leg, cash } = derived;
    onSubmit({
      strategy: "scalp",
      book: values.book,
      underlying: values.underlying,
      underlyingName: values.underlyingName || null,
      structureLabel: values.right === "C" ? "Long call" : "Long put",
      openedAt: Number.isNaN(millis(values.openedAt)) ? Date.now() : millis(values.openedAt),
      closedAt: Number.isNaN(millis(values.closedAt)) ? null : millis(values.closedAt),
      netPnl: cash.netPnl,
      fees: cash.fees,
      feesOpen: zeroIfBlank(values.feesOpen),
      feesClose: zeroIfBlank(values.feesClose),
      notes: values.notes || null,
      legs: [
        {
          right: leg.right,
          strike: leg.strike,
          expiry: values.expiry,
          quantity: leg.quantity,
          multiplier: 100,
          openPrice: leg.openPrice,
          closePrice: leg.closePrice ?? null,
        },
      ],
    });
  }

  const input = (label: string, key: keyof ScalpFormValues, type = "text") => (
    <label className={FIELD}>
      {label}
      <input aria-label={label} type={type} value={values[key]} onChange={set(key)} className={INPUT} />
    </label>
  );

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
      <Panel title="Scalp">
        {notice}
        <div className="grid grid-cols-3 gap-2">
          {input("Underlying", "underlying")}
          {input("Company", "underlyingName")}
          <label className={FIELD}>
            Call or put
            <select aria-label="Call or put" value={values.right} onChange={set("right")} className={INPUT}>
              <option value="C">Call</option>
              <option value="P">Put</option>
            </select>
          </label>
          {input("Opened", "openedAt", "datetime-local")}
          {expirations.length > 0 ? (
            <label className={FIELD}>
              Expiry
              <ExpirySelect
                value={values.expiry}
                expirations={expirations}
                from={openedOn}
                onChange={(expiry) => setValue("expiry", expiry)}
              />
            </label>
          ) : (
            input("Expiry", "expiry", "date")
          )}
          {strikes.length > 0 ? (
            <label className={FIELD}>
              Strike
              <StrikeSelect
                label="Strike"
                value={values.strike}
                strikes={strikes}
                atm={null}
                onChange={(strike) => setValue("strike", strike)}
              />
            </label>
          ) : (
            input("Strike", "strike", "number")
          )}
          {input("Size", "size", "number")}
          {input("Entry price", "entry", "number")}
          {input("Exit price", "exit", "number")}
          {input("Closed", "closedAt", "datetime-local")}
          {input("Entry fees", "feesOpen", "number")}
          {input("Exit fees", "feesClose", "number")}
          <label className={FIELD}>
            Book
            <select aria-label="Book" value={values.book} onChange={set("book")} className={INPUT}>
              <option value="paper">Paper</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        {!chain.isLoading && expirations.length === 0 && chain.data?.unavailable && (
          <p className="mt-2 text-[10px] text-muted">{chain.data.unavailable.message}</p>
        )}
        <label className={`${FIELD} mt-2`}>
          Notes
          <textarea aria-label="Notes" value={values.notes} onChange={set("notes")} className={`${INPUT} min-h-16`} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-3 rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {problem && <p className="mt-2 text-down">{problem}</p>}
        {error && <p className="mt-2 text-down">{error}</p>}
      </Panel>
      <Panel title="Derived">
        {!derived ? (
          <p className="text-muted">Price the contract to see the numbers.</p>
        ) : (
          <dl className="grid gap-1" data-testid="scalp-derived">
            <Row label="Cost">{usd(derived.cost)}</Row>
            <Row label="P&L before fees">
              <Money value={derived.cash.grossPnl} />
            </Row>
            <Row label="Fees">{usd(derived.cash.fees)}</Row>
            <Row label="Net P&L">
              <Money value={derived.cash.netPnl} />
            </Row>
            <Row label="Return on cost">
              <Pct value={derived.returnOnCost} />
            </Row>
          </dl>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
```

Create `apps/web/src/routes/NewScalp.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { api } from "../api.js";
import { ScalpForm } from "./ScalpForm.js";

/** A scalp typed in by hand, such as one from before the IBKR sync's start date. */
export function NewScalp({ onCreated }: { onCreated?: (id: string) => void }) {
  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      // biome-ignore lint/suspicious/noExplicitAny: the RPC client types the body from the schema
      const res = await api.api.trades.$post({ json: payload as any });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => onCreated?.(created.id),
  });
  return (
    <ScalpForm
      submitLabel="Save scalp"
      busy={save.isPending}
      error={save.error ? String(save.error) : null}
      onSubmit={(payload) => save.mutate(payload)}
    />
  );
}
```

- [ ] **Step 4: Edit scalps, note synced trades, and add the route**

In `apps/web/src/routes/EditTrade.tsx`:
- import `ScalpForm` and `type ScalpFormValues` from `./ScalpForm.js`;
- add below `toFormValues`:

```ts
/** A scalp as the scalp form edits it. */
export function toScalpFormValues(trade: TradeView): Partial<ScalpFormValues> {
  const leg = trade.legs[0];
  return {
    underlying: trade.underlying,
    underlyingName: trade.underlyingName ?? "",
    right: leg?.right === "P" ? "P" : "C",
    expiry: leg?.expiry ?? "",
    strike: asText(leg?.strike),
    size: asText(leg ? Math.abs(leg.quantity) : null),
    entry: asText(leg?.openPrice),
    exit: asText(leg?.closePrice),
    openedAt: toLocalInput(trade.openedAt),
    closedAt: toLocalInput(trade.closedAt),
    feesOpen: asText(trade.feesOpen ?? trade.fees),
    feesClose: asText(trade.feesClose ?? 0),
    book: trade.book === "live" ? "live" : "paper",
    notes: trade.notes ?? "",
  };
}

const SYNCED_NOTICE = "Synced from IBKR. Changes you make here are kept: later syncs won't overwrite them.";
```

- in `EditTrade`, after the loading and settle early returns, replace the `if (trade.strategy !== "iron_fly") { … }` block with:

```tsx
  const notice =
    trade.source === "ibkr_flex" ? <p className="mb-2 text-[11px] text-muted">{SYNCED_NOTICE}</p> : null;
  if (trade.strategy === "scalp") {
    return (
      <ScalpForm
        initial={toScalpFormValues(trade)}
        submitLabel="Save changes"
        busy={save.isPending}
        error={save.error ? String(save.error) : null}
        notice={notice}
        onSubmit={(payload) => save.mutate(payload)}
      />
    );
  }
  if (trade.strategy !== "iron_fly") {
    return (
      <Panel title="Edit">
        <p className="text-muted">This kind of trade can't be edited here yet.</p>
      </Panel>
    );
  }
```

- in the fly's return, render `{notice}` as the first child of the wrapping `<div className="flex flex-col gap-2">`, before the settle-proposal paragraph.

In `apps/web/src/router.tsx`:
- import `NewScalp` from `./routes/NewScalp.js`;
- change `scalpsRoute`'s component to `() => <Scalps onOpenTrade={openTrade} onNewScalp={() => router.navigate({ to: "/scalps/new" })} />`;
- add a route:

```tsx
const newScalpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scalps/new",
  component: () => <NewScalp onCreated={openTrade} />,
});
```

- add `newScalpRoute` to `addChildren` after `scalpsRoute`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run apps/web`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add apps/web/src
git commit -m "feat(web): type in a scalp, edit one, and see when a synced trade's edits are kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Docs, and a live and visual check with the real paper account

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md` (§6, §8.1, §12, §13, §16)
- Modify: `docs/superpowers/specs/2026-09-29-ibkr-flex-sync-design.md` (status line, §13)
- Modify: `README.md`
- Scratchpad only, not committed: `serve-ibkr.mts`, and the screenshot script

**Interfaces:**
- Consumes: everything above.
- Produces: the main spec and README describe the sync, the live results are recorded, and there are screenshots at 1280 and 1024 px.

- [ ] **Step 1: Update the main spec** (as this spec's §11 lists)

In `docs/superpowers/specs/2026-09-22-trading-journal-design.md`:
- **§6:** after the `fills` bullet, add "IBKR sync is detailed in [2026-09-29-ibkr-flex-sync-design.md](2026-09-29-ibkr-flex-sync-design.md), which adds `broker_trade_id`, `conid`, the contract, `open_close`, `kind`, `origin` and `canceled` to `fills`, and `facts_edited_at` to `trades`. `sync_state` is keyed by source and keeps the last summary. `scalp_details` comes with R." Add `facts_edited_at` to the trades merge bullet.
- **§8.1**, after "Settings, per account…", add:
  - "Paper accounts support the Flex Web Service, with their own token. Each account has an Activity query and a Trade Confirmation query, because Activity statements stop at the previous business day."
  - "A start date bounds the sync; nothing before it is stored."
- **§8.1, Grouping and Scope:** replace the multi-leg rule with:
  - "Grouping is by position episode, per ticker and expiry, flat to flat: IBKR sends every fly leg as its own order, so one order id never spans contracts."
  - "Episodes that only buy are scalps, one per contract round trip. Iron flies (one short call, one short put, one or two wings) are imported as iron fly trades. Other structures are skipped with a reason."
  - "Two guards skip trades already in the journal: from oQuants, or typed by hand, in both directions."
- **§8.1, Review queue:** "moves to the scalp-review step, with stops, setups and grades."
- **§12:** add "`facts_edited_at`: once the user edits a synced trade's facts, syncs leave it alone until they choose Use IBKR's numbers."
- **§13, Phase 2 item 1:** add "(done: plus the scalp form, the Scalps page and the scalp trade page; the review queue moves to item 3)".
- **§16 item 2:** mark it resolved, pointing at the sync spec's §3.

- [ ] **Step 2: Update this spec and the README**

In `docs/superpowers/specs/2026-09-29-ibkr-flex-sync-design.md`:
- set **Status** to `Approved; implemented on feat/ibkr-sync. Plan: [2026-09-29-ibkr-flex-sync.md](../plans/2026-09-29-ibkr-flex-sync.md)`;
- in §13, record the live results from Step 3.

In `README.md`, "What it tracks":
- in the Scalps bullet, add "synced from IBKR (Flex Web Service) from a start date you choose, or typed in";
- in the Iron flies bullet, add "and synced from IBKR paper, as one trade however many orders its legs took".

- [ ] **Step 3: Live check over a copy of the real journal, with the real paper token**

This fetches both of the user's queries once or twice, read-only, exactly as the Settings test and the sync would. Build first: `pnpm build`.

Create `serve-ibkr.mts` in the scratchpad. It copies the journal read-only, migrates the copy, and serves it with the IBKR block from the token file the spike used:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "/home/kiryu/Projects/TradingJournal/apps/server/node_modules/@hono/node-server/dist/index.mjs";
import { createApp } from "/home/kiryu/Projects/TradingJournal/apps/server/src/app.ts";
import { readSecrets } from "/home/kiryu/Projects/TradingJournal/apps/server/src/config.ts";
import { createMarketData } from "/home/kiryu/Projects/TradingJournal/apps/server/src/marketData.ts";
import { openDatabase, runMigrations } from "/home/kiryu/Projects/TradingJournal/packages/db/src/index.ts";

const require = createRequire("/home/kiryu/Projects/TradingJournal/packages/db/package.json");
const Database = require("better-sqlite3");
const dataDir = join(homedir(), ".local/share/trading-journal");
const copy = join(mkdtempSync(join(process.cwd(), "tj-ibkr-")), "journal.db");
await new Database(join(dataDir, "journal.db"), { readonly: true }).backup(copy);
runMigrations(copy, { migrationsFolder: "/home/kiryu/Projects/TradingJournal/packages/db/migrations" });
// The real token stays in memory for the sync, and is never printed.
const token = readFileSync(join(dataDir, "ibkr-flex-token"), "utf8").trim();
const ibkr = { token, activityQueryId: "1653145", todayQueryId: "1653147", since: "2026-09-28" };
// Settings reads a stand-in secrets file with a dummy token: the page shows the set-up state without the real one.
const secretsFile = join(dirname(copy), "secrets.json");
writeFileSync(secretsFile, JSON.stringify({ ibkr: { ...ibkr, token: "1234567890123456789012" } }), { mode: 0o600 });
serve({
  fetch: createApp({
    db: openDatabase(copy),
    webDir: "/home/kiryu/Projects/TradingJournal/apps/web/dist",
    market: createMarketData(readSecrets(join(dataDir, "secrets.json")).alpaca ?? null),
    settings: { dataDir, secretsFile, checkKeys: async () => "ok", checkIbkr: async () => "ok" },
    ibkrConfig: () => ibkr,
  }).fetch,
  port: 4199,
  hostname: "127.0.0.1",
});
console.log(`stand-in on http://localhost:4199 over ${copy}`);
```

Run it in the background from the scratchpad with `/home/kiryu/Projects/TradingJournal/apps/server/node_modules/.bin/tsx serve-ibkr.mts`. Then:

```bash
curl -s -X POST -H 'content-type: application/json' -d '{"auto":false}' http://localhost:4199/api/ibkr/sync | tee sync1.json
curl -s -X POST -H 'content-type: application/json' -d '{"auto":false}' http://localhost:4199/api/ibkr/sync | tee sync2.json
curl -s 'http://localhost:4199/api/trades?strategy=scalp&all=true'
```

Expected:
- The first sync is `status: "ok"`, and its `added` includes the NVDA 232.5C and TSLA 365P scalps from 2026-09-28.
  - Their net is about +$44.74 and +$300.55. It may differ by a few cents, because the Activity statement's final commissions replace Today's.
  - Any later trades also come in: scalps as scalps and flies as iron flies.
  - Flies also logged in oQuants appear under `skipped` as `duplicate`.
- `ignored.beforeStart` is in the hundreds, and no synced trade opened before 2026-09-28 (check the listed trades' `openedAt`).
- The second sync is `added: 0, updated: 0`, with everything `unchanged`.

Then settle the spec's open item 1 (§13), which the design relies on. The copy never saw 2026-09-28's Today statement, so NVDA's and TSLA's fills came in through Activity. Their keys must be the same execution ids as in that day's Today statement, which the committed fixture keeps (only the account is renamed):

```bash
node -e '
const Database = require("/home/kiryu/Projects/TradingJournal/packages/db/node_modules/better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
for (const row of db.prepare("select broker_exec_key, origin, commission from fills where underlying in (?, ?) order by broker_exec_key").all("NVDA", "TSLA")) console.log(row);
' <the copy's path, printed by the stand-in>
grep -o 'execID="[^"]*"' packages/importers/src/ibkr/fixtures/today.xml | sort
```

Expected: the same seven keys, each with origin `activity`. If they differ, stop and tell the user: the fallback in §13 item 1 (keying fills by `tradeID`) is a design change, not a fix.

Record in spec §13:
- the numbers;
- any skipped trades;
- the commission differences from Today's;
- item 1's result.

Assignments (item 1's third check) stay open until one happens.

- [ ] **Step 4: Visual check**

Use the saved recipe: headless Firefox through `puppeteer-core`, waiting for `document.fonts.ready`. Screenshot at 1280 × 900 and 1024 × 900:
- `/scalps`;
- the NVDA scalp's trade page (its id is in `sync1.json`'s `changedTradeIds`, or open it from `/scalps`);
- `/import`;
- `/settings`;
- `/scalps/new`.

Look at every screenshot. Expected:
- the scalp tiles and the Fills panel;
- the IBKR card with its last run;
- the IBKR section with the token hidden;
- the scalp form with its Derived panel;
- nothing overlapping or cut off at either width.

Stop the server with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`.

- [ ] **Step 5: Check and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/superpowers/specs/2026-09-22-trading-journal-design.md docs/superpowers/specs/2026-09-29-ibkr-flex-sync-design.md README.md
git commit -m "docs: point the main spec and README at the IBKR sync and scalps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand over to the user**

Tell the user how to switch it on in their own app:
1. Run `pnpm start`, which applies migration 0003 after a backup.
2. In **Settings → IBKR Flex**, paste the paper token and enter the query IDs 1653145 and 1653147 with the start date 2026-09-28.
3. Open the app: it syncs by itself.
4. Delete the spike's `~/.local/share/trading-journal/ibkr-flex-token` once Settings holds the token.
