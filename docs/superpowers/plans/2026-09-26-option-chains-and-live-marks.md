# Option Chains and Live Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iron fly builder picks expiry and strikes from Alpaca's listed contracts, every open trade shows an estimated cost to close (never stored), and a Settings page saves the Alpaca key without a restart.

**Architecture:** `@tj/market-data` gains Alpaca clients for option contracts, option quotes, company names and a key check, all built on one shared `alpacaGet`. A pure `closeEstimate` in `@tj/core` turns legs plus quotes into marks and an estimated P&L, and the web app uses it in the lists, the trade page and the builder. The server wraps the Alpaca clients in a `MarketData` holder that the Settings routes rebuild when the key changes, and exposes read-only `/api/chains`, `/api/option-quotes` and `/api/company` routes.

**Tech Stack:** TypeScript, zod 4, Hono + `@hono/zod-validator` (typed RPC client in the web app), React 19 + TanStack Query/Router, Tailwind 4, Vitest (jsdom for web), Biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-26-option-chains-and-live-marks-design.md`

**Branch:** `feat/option-chains` (stacked on `feat/live-quotes`, PR #3).

**Deviations from the spec, agreed while planning (the spec is updated in the same commit as this plan):**

- §7.1: the error state clears when a key is saved or removed, not after the next successful call. A revoked key does not recover by itself, and this avoids wrapping every source to watch for successes.
- §5.1: `cachedChains` keeps each (symbol, since) answer for 15 minutes, rather than keeping expired listings forever. That costs one cheap extra call per 15 minutes and keeps the cache to a single rule.
- §8: the chain loads 400 ms after the last keystroke in Underlying. There is no separate trigger when the field loses focus.

## Global Constraints

- **Estimates are never stored.** No estimate or mark goes into a request body, the database or `secrets.json`. Exit fields stay empty until real fills are typed.
- **Mark = cost to close.** Short legs are marked at the **ask** and long legs at the **bid**. A bid of 0 is a valid mark. A missing ask on a short leg means no estimate.
- **Alpaca endpoints (exact):**
  - Data API `https://data.alpaca.markets`: `/v2/stocks/trades/latest?feed=iex` and `/v1beta1/options/quotes/latest?feed=indicative`.
  - Paper trading API `https://paper-api.alpaca.markets`: `/v2/options/contracts` and `/v2/assets/{symbol}`.
  - Headers `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`, with a 10 s timeout.
- **Contract codes** match `^[A-Z]{1,5}\d{6,7}[CP]\d{8}$`. At most 100 go in one Alpaca call.
- **"Today"** is always the New York date, from `nyDate` in `@tj/core`.
- **The secret key** is never logged, never returned by a route, never echoed in an error, and never in a fixture. Tests use `test-secret-do-not-log`.
- **`secrets.json` writes:**
  - write a temp file, `chmod 0600` it, then rename it into place;
  - keep entries the app doesn't know;
  - refuse a file that is not a JSON object;
  - never quote the file's contents.
- **UI copy (exact):** `est ` prefix, `EXPIRED · add exits`, `Est. P&L if closed now`, `Mark (to close)`, `Est. P&L`, `type instead`, `pick from the chain`, `not listed`, `(ATM)`, `Save and test`, `Remove key`.
- **Estimate styling:** muted italics (`num italic text-[#8a91a3]`), never `text-up` or `text-down`.
- **Refresh:** the web app refetches every 60 s. The server caches quotes and option quotes for 30 s, and chains for 15 min.
- **CI runs on Ubuntu and Windows.** File-mode assertions use `it.skipIf(process.platform === "win32")`. Build paths with `node:path`.
- **Before every commit** run `pnpm lint`, `pnpm typecheck` and `pnpm test`; all three must pass.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each of these conditions is one the spec implies but none of the obvious tests exercise. The owning task carries a test for each:

1. **Editing an old trade whose stored strike or expiry is not in the chain.** The value stays selected, marked `not listed`, and saves unchanged. Test: Task 11.
2. **An expiry typed before the chain arrives.** When the fields turn into dropdowns, the typed value stays selected (or `not listed`), and nothing is lost. Test: Task 11.
3. **Changing the symbol after Company was auto-filled.** The auto-filled name follows the new symbol; a hand-typed name never changes. Test: Task 12.
4. **More than 100 open contracts across the lists.** The browser makes one call, and the server splits it into Alpaca calls of at most 100. Test: Tasks 2 and 7.
5. **A `secrets.json` holding other entries** (future IBKR tokens). Saving or removing the Alpaca key keeps them. Test: Tasks 5 and 8.

---

### Task 1: Contract codes, New York dates and close estimates in core

**Files:**
- Create: `packages/core/src/marks.ts`
- Create: `packages/core/src/marks.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `round2` from `packages/core/src/money.ts`.
- Produces (exported from `@tj/core`):
  - `interface MarkableLeg { right: string; strike: number; expiry: string; quantity: number; multiplier: number; openPrice: number; closePrice: number | null }`. `right` is `"C"` or `"P"`; it is typed `string` because the web receives legs from the database that way.
  - `interface OptionQuote { bid: number | null; ask: number | null; at: number }`
  - `occSymbol(contract: { underlying: string; expiry: string; right: string; strike: number }): string`
  - `nyDate(epochMs: number): string` (`YYYY-MM-DD`)
  - `interface EstimatedTrade { underlying: string; legs: MarkableLeg[]; fees: number; feesOpen: number | null; feesClose: number | null }`
  - `type CloseEstimate`, and `closeEstimate(trade: EstimatedTrade, quotes: ReadonlyMap<string, OptionQuote>, todayNy: string): CloseEstimate`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/marks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { closeEstimate, type MarkableLeg, nyDate, type OptionQuote, occSymbol } from "./marks.js";

describe("occSymbol", () => {
  it.each([
    [{ underlying: "M", expiry: "2026-10-02", right: "C", strike: 22.5 }, "M261002C00022500"],
    [{ underlying: "M", expiry: "2026-10-02", right: "P", strike: 21 }, "M261002P00021000"],
    [{ underlying: "BB", expiry: "2026-09-25", right: "C", strike: 8.5 }, "BB260925C00008500"],
    [{ underlying: "NVDA", expiry: "2026-10-02", right: "P", strike: 225 }, "NVDA261002P00225000"],
    [{ underlying: "M", expiry: "2026-10-02", right: "C", strike: 7.1 }, "M261002C00007100"],
    [{ underlying: "brk.b", expiry: "2027-01-15", right: "C", strike: 500 }, "BRKB270115C00500000"],
  ])("names %o as %s", (contract, code) => {
    expect(occSymbol(contract)).toBe(code);
  });
});

describe("nyDate", () => {
  it("gives New York's date, not UTC's, late in the evening", () => {
    expect(nyDate(Date.UTC(2026, 8, 26, 3, 30))).toBe("2026-09-25"); // 23:30 EDT
    expect(nyDate(Date.UTC(2026, 8, 26, 4, 30))).toBe("2026-09-26"); // 00:30 EDT
  });

  it("follows standard time in winter", () => {
    expect(nyDate(Date.UTC(2026, 0, 15, 4, 30))).toBe("2026-01-14"); // 23:30 EST
  });
});

const leg = (
  right: "C" | "P",
  strike: number,
  quantity: number,
  openPrice: number,
  closePrice: number | null = null,
): MarkableLeg => ({ right, strike, expiry: "2026-10-02", quantity, multiplier: 100, openPrice, closePrice });

/** The open M fly from the design mockup: 3 lots, body 22.5, wings 20 / 26, $7.80 entry fees. */
const fly = {
  underlying: "M",
  fees: 7.8,
  feesOpen: 7.8,
  feesClose: 0,
  legs: [leg("C", 22.5, -3, 0.52), leg("P", 22.5, -3, 0.41), leg("C", 26, 3, 0.05), leg("P", 20, 3, 0.03)],
};

const AT = Date.UTC(2026, 8, 25, 19, 59, 51);

/** Friday's closing quotes for the fly's contracts; `undefined` removes one. */
function quotes(overrides: Record<string, OptionQuote | undefined> = {}) {
  const all: Record<string, OptionQuote | undefined> = {
    M261002C00022500: { bid: 0.44, ask: 0.58, at: AT },
    M261002P00022500: { bid: 0.31, ask: 0.42, at: AT + 1000 },
    M261002C00026000: { bid: 0.01, ask: 0.06, at: AT - 5000 },
    M261002P00020000: { bid: 0.01, ask: 0.05, at: AT },
    ...overrides,
  };
  return new Map(
    Object.entries(all).filter((entry): entry is [string, OptionQuote] => entry[1] !== undefined),
  );
}

const TODAY = "2026-09-26";

describe("closeEstimate", () => {
  it("buys the shorts back at the ask and sells the longs at the bid", () => {
    expect(closeEstimate(fly, quotes(), TODAY)).toEqual({
      kind: "estimate",
      legs: [
        { index: 0, mark: 0.58, side: "ask", pnl: -18 },
        { index: 1, mark: 0.42, side: "ask", pnl: -3 },
        { index: 2, mark: 0.01, side: "bid", pnl: -12 },
        { index: 3, mark: 0.01, side: "bid", pnl: -6 },
      ],
      grossPnl: -39,
      fees: 7.8,
      netPnl: -46.8,
      quotedAt: AT - 5000,
    });
  });

  it("sells a long with no bid for nothing", () => {
    const estimate = closeEstimate(fly, quotes({ M261002P00020000: { bid: 0, ask: 0.05, at: AT } }), TODAY);
    expect(estimate.kind === "estimate" && estimate.legs[3]).toEqual({ index: 3, mark: 0, side: "bid", pnl: -9 });
  });

  it("gives no estimate when a short leg has no ask", () => {
    const noAsk = quotes({ M261002C00022500: { bid: 0.44, ask: null, at: AT } });
    expect(closeEstimate(fly, noAsk, TODAY)).toEqual({ kind: "unavailable", reason: "no ask for the short call" });
  });

  it("gives no estimate when a leg has no quote", () => {
    expect(closeEstimate(fly, quotes({ M261002P00020000: undefined }), TODAY)).toEqual({
      kind: "unavailable",
      reason: "no quote for the long put",
    });
  });

  it("uses the real exit price of a leg already closed, and needs no quote for it", () => {
    const partly = { ...fly, legs: [...fly.legs.slice(0, 3), leg("P", 20, 3, 0.03, 0.02)] };
    const estimate = closeEstimate(partly, quotes({ M261002P00020000: undefined }), TODAY);
    expect(estimate.kind === "estimate" && estimate.legs.map((marked) => marked.index)).toEqual([0, 1, 2]);
    // -18 - 3 - 12 marked, plus 3 x 100 x (0.02 - 0.03) = -3 realised
    expect(estimate.kind === "estimate" && estimate.grossPnl).toBe(-36);
  });

  it("has nothing to estimate once every leg is closed", () => {
    const closed = { ...fly, legs: fly.legs.map((open) => ({ ...open, closePrice: 0.1 })) };
    expect(closeEstimate(closed, quotes(), TODAY)).toEqual({ kind: "closed" });
  });

  it("still marks a trade on its expiry day", () => {
    expect(closeEstimate(fly, quotes(), "2026-10-02").kind).toBe("estimate");
  });

  it("calls a trade expired the day after its expiry, before looking at quotes", () => {
    expect(closeEstimate(fly, new Map(), "2026-10-03")).toEqual({ kind: "expired", expiry: "2026-10-02" });
  });

  it("falls back to the trade's total fees when the open/close split is unknown", () => {
    const imported = { ...fly, fees: 5, feesOpen: null, feesClose: null };
    const estimate = closeEstimate(imported, quotes(), TODAY);
    expect(estimate.kind === "estimate" && [estimate.fees, estimate.netPnl]).toEqual([5, -44]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/src/marks.test.ts`
Expected: FAIL. The run reports that `./marks.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/marks.ts`:

```ts
import { round2 } from "./money.js";

/** A leg as the journal stores it: enough to name its contract and price it. */
export interface MarkableLeg {
  /** "C" or "P". */
  right: string;
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** Signed: negative is short. */
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}

/** Bid and ask for one contract. A null ask means nobody is offering it. */
export interface OptionQuote {
  bid: number | null;
  ask: number | null;
  /** When the quote was made, in epoch milliseconds. */
  at: number;
}

/**
 * The OCC code Alpaca names a contract by: root, YYMMDD, C or P, then strike x 1000 in 8 digits.
 * The root is the ticker's letters only, so BRK.B becomes BRKB.
 */
export function occSymbol(contract: { underlying: string; expiry: string; right: string; strike: number }): string {
  const root = contract.underlying.toUpperCase().replace(/[^A-Z]/g, "");
  const [year = "", month = "", day = ""] = contract.expiry.split("-");
  const strike = String(Math.round(contract.strike * 1000)).padStart(8, "0");
  return `${root}${year.slice(2)}${month}${day}${contract.right}${strike}`;
}

const NY_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in New York at an instant, as YYYY-MM-DD. Options expire on New York's clock. */
export function nyDate(epochMs: number): string {
  const parts = NY_DATE.formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((found) => found.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface EstimatedTrade {
  underlying: string;
  legs: MarkableLeg[];
  /** The trade's total fees, used when the open/close split is unknown (imported trades). */
  fees: number;
  feesOpen: number | null;
  feesClose: number | null;
}

export interface MarkedLeg {
  /** Position of the leg in the trade's `legs`. */
  index: number;
  mark: number;
  side: "ask" | "bid";
  pnl: number;
}

export type CloseEstimate =
  | { kind: "closed" }
  | { kind: "expired"; expiry: string }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "estimate";
      /** Open legs only. */
      legs: MarkedLeg[];
      /** Every leg, realised and estimated, before fees. */
      grossPnl: number;
      /** The fees entered so far; exit fees are not guessed. */
      fees: number;
      netPnl: number;
      /** The oldest quote used, in epoch milliseconds. */
      quotedAt: number;
    };

const legName = (leg: MarkableLeg) => `${leg.quantity < 0 ? "short" : "long"} ${leg.right === "C" ? "call" : "put"}`;

/**
 * What closing the open legs right now would realise: shorts bought back at the ask,
 * longs sold at the bid (spec §6.2). An estimate for display only; never stored.
 */
export function closeEstimate(
  trade: EstimatedTrade,
  quotes: ReadonlyMap<string, OptionQuote>,
  todayNy: string,
): CloseEstimate {
  const open = trade.legs.flatMap((leg, index) => (leg.closePrice == null ? [{ leg, index }] : []));
  if (open.length === 0) return { kind: "closed" };
  const expired = open.find(({ leg }) => leg.expiry < todayNy);
  if (expired) return { kind: "expired", expiry: expired.leg.expiry };

  const marked: MarkedLeg[] = [];
  let quotedAt = Number.POSITIVE_INFINITY;
  for (const { leg, index } of open) {
    const quote = quotes.get(occSymbol({ underlying: trade.underlying, ...leg }));
    if (!quote) return { kind: "unavailable", reason: `no quote for the ${legName(leg)}` };
    const short = leg.quantity < 0;
    const mark = short ? quote.ask : quote.bid;
    if (mark == null) return { kind: "unavailable", reason: `no ${short ? "ask" : "bid"} for the ${legName(leg)}` };
    marked.push({
      index,
      mark,
      side: short ? "ask" : "bid",
      pnl: round2(leg.quantity * leg.multiplier * (mark - leg.openPrice)),
    });
    quotedAt = Math.min(quotedAt, quote.at);
  }

  const realised = trade.legs
    .filter((leg) => leg.closePrice != null)
    .reduce((sum, leg) => sum + leg.quantity * leg.multiplier * ((leg.closePrice ?? 0) - leg.openPrice), 0);
  const grossPnl = round2(realised + marked.reduce((sum, leg) => sum + leg.pnl, 0));
  const fees =
    trade.feesOpen != null && trade.feesClose != null ? round2(trade.feesOpen + trade.feesClose) : trade.fees;
  return { kind: "estimate", legs: marked, grossPnl, fees, netPnl: round2(grossPnl - fees), quotedAt };
}
```

Add the export to `packages/core/src/index.ts`, keeping the list alphabetical:

```ts
export * from "./ironFly.js";
export * from "./marks.js";
export * from "./model.js";
export * from "./money.js";
export * from "./position.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/src/marks.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass. If `pnpm lint` reports formatting, run `pnpm format` and re-run.

```bash
git add packages/core/src/marks.ts packages/core/src/marks.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): contract codes and the cost to close an open trade

occSymbol names a contract the way Alpaca does, nyDate gives New York's
date, and closeEstimate marks each open leg at what closing it would
cost: shorts at the ask, longs at the bid. For display only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: One Alpaca request helper, a generic cache, and option quotes

**Files:**
- Create: `packages/market-data/src/http.ts`
- Create: `packages/market-data/src/testing.ts` (test helpers, not exported from the package)
- Create: `packages/market-data/src/options.ts`
- Create: `packages/market-data/src/options.test.ts`
- Modify: `packages/market-data/src/alpaca.ts`
- Modify: `packages/market-data/src/alpaca.test.ts`
- Modify: `packages/market-data/src/quotes.ts`
- Modify: `packages/market-data/src/cache.ts`
- Modify: `packages/market-data/src/cache.test.ts`
- Modify: `packages/market-data/src/index.ts`
- Modify: `packages/market-data/package.json`
- Modify: `packages/market-data/tsconfig.json`
- Modify: `apps/server/src/index.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Consumes: `OptionQuote` from `@tj/core` (Task 1).
- Produces (exported from `@tj/market-data`):
  - `interface AlpacaKeys { keyId: string; secretKey: string }` (moved from `alpaca.ts`)
  - `interface AlpacaOptions { fetch?: (input: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number }` (moved)
  - `DATA_API`, `TRADING_API` (base URLs)
  - `class AlpacaError extends Error { status: number; detail: string }`
  - `alpacaGet(url: string, keys: AlpacaKeys, options?: AlpacaOptions): Promise<unknown>`
  - `LATEST_TRADES` (the stock latest-trades URL)
  - `interface LatestSource<T> { latest(keys: readonly string[]): Promise<Map<string, T>> }`, and `type QuoteSource = LatestSource<Quote>`
  - `cachedLatest<T>(source: LatestSource<T>, options: { ttlMs: number; now?: () => number; onError: (error: unknown) => void }): LatestSource<T>`. This replaces `cachedQuotes`.
  - `CONTRACT` (the contract-code RegExp), `type OptionQuoteSource = LatestSource<OptionQuote>`, and `alpacaOptionQuotes(keys, options?): OptionQuoteSource`
  - Test helpers in `src/testing.ts`: `json(body, status?)` and `fakeFetch(...replies)`, which returns `{ fetch, calls }`.

- [ ] **Step 1: Depend on `@tj/core`**

In `packages/market-data/package.json`, change `dependencies` to:

```json
  "dependencies": {
    "@tj/core": "workspace:*",
    "zod": "^4.0.0"
  }
```

In `packages/market-data/tsconfig.json`, add the reference after `"include"`:

```json
  "include": ["src"],
  "references": [{ "path": "../core" }]
```

Run: `pnpm install`
Expected: completes, and `pnpm-lock.yaml` gains `'@tj/core': link:../core` under `packages/market-data`.

- [ ] **Step 2: Move the shared request code into `http.ts`**

Create `packages/market-data/src/http.ts`:

```ts
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
export async function alpacaGet(url: string, keys: AlpacaKeys, options: AlpacaOptions = {}): Promise<unknown> {
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
```

Replace `packages/market-data/src/alpaca.ts` with:

```ts
import { z } from "zod";
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";
import type { Quote, QuoteSource } from "./quotes.js";

export const LATEST_TRADES = `${DATA_API}/v2/stocks/trades/latest`;

const latestTradesSchema = z.object({
  trades: z.record(z.string(), z.object({ p: z.number().positive(), t: z.iso.datetime({ offset: true }) })),
});

/** How Alpaca names the one symbol that sank a batch: `code=400, message=invalid symbol: GME1`. */
const INVALID_SYMBOL = /invalid symbol: ([^\s",]+)/;

/**
 * Last-trade prices from Alpaca's free Basic plan, where only the IEX feed is real time.
 * IEX is a single exchange, which is fine for a reference price.
 */
export function alpacaQuotes(keys: AlpacaKeys, options: AlpacaOptions = {}): QuoteSource {
  return {
    async latest(symbols) {
      let pending = [...symbols];
      while (pending.length > 0) {
        const query = new URLSearchParams({ symbols: pending.join(","), feed: "iex" });
        try {
          return toQuotes(latestTradesSchema.parse(await alpacaGet(`${LATEST_TRADES}?${query}`, keys, options)));
        } catch (error) {
          // One unknown symbol fails the whole batch, so leave it out and ask again for the rest.
          const rejected =
            error instanceof AlpacaError && error.status === 400 ? INVALID_SYMBOL.exec(error.detail)?.[1] : undefined;
          if (!rejected || !pending.includes(rejected)) throw error;
          pending = pending.filter((symbol) => symbol !== rejected);
        }
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
```

Create `packages/market-data/src/testing.ts` (it holds the helpers `alpaca.test.ts` defined for itself, so the new tests can share them):

```ts
/** A JSON reply as Alpaca sends it. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Plays back one reply per call and records what each call asked for. */
export function fakeFetch(...replies: Response[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ url: new URL(input), headers: new Headers(init?.headers) });
    const reply = replies.shift();
    if (!reply) throw new Error("Alpaca was called more often than expected");
    return reply;
  };
  return { fetch, calls };
}
```

In `packages/market-data/src/alpaca.test.ts`, delete the local `json` and `fakeFetch` definitions (and their doc comments), and import them instead. The top of the file becomes:

```ts
import { describe, expect, it } from "vitest";
import { alpacaQuotes } from "./alpaca.js";
import { fakeFetch, json } from "./testing.js";
```

Keep `invalidSymbol`, which uses `json`, where it is.

- [ ] **Step 3: Run the existing Alpaca tests to confirm the move changed nothing**

Run: `pnpm vitest run packages/market-data/src/alpaca.test.ts`
Expected: PASS (10 tests, as before).

- [ ] **Step 4: Make the cache generic**

Replace `packages/market-data/src/quotes.ts` with:

```ts
/** The last trade seen for a symbol: a reference price, never a record (spec §8.6). */
export interface Quote {
  price: number;
  /** When that trade printed, in epoch milliseconds. */
  at: number;
}

/** Answers "what is the latest value for each of these keys". Keys it knows nothing about are left out, never guessed. */
export interface LatestSource<T> {
  latest(keys: readonly string[]): Promise<Map<string, T>>;
}

export type QuoteSource = LatestSource<Quote>;
```

Replace `packages/market-data/src/cache.ts` with:

```ts
import type { LatestSource } from "./quotes.js";

export interface LatestCacheOptions {
  ttlMs: number;
  now?: () => number;
  /** A failed refresh never throws; it is reported here and those keys go without a value. */
  onError: (error: unknown) => void;
}

/** Remembers each key's value (or its lack of one) for `ttlMs`, asking the source only for the rest. */
export function cachedLatest<T>(source: LatestSource<T>, options: LatestCacheOptions): LatestSource<T> {
  const { ttlMs, now = Date.now, onError } = options;
  const cache = new Map<string, { value: T | null; fetchedAt: number }>();

  return {
    async latest(keys) {
      const time = now();
      const stale = keys.filter((key) => {
        const hit = cache.get(key);
        return !hit || time - hit.fetchedAt >= ttlMs;
      });
      if (stale.length > 0) {
        try {
          const fetched = await source.latest(stale);
          for (const key of stale) cache.set(key, { value: fetched.get(key) ?? null, fetchedAt: time });
        } catch (error) {
          // A stale value shown as current would mislead, so it goes rather than stays.
          for (const key of stale) cache.delete(key);
          onError(error);
        }
      }
      const found = new Map<string, T>();
      for (const key of keys) {
        const value = cache.get(key)?.value;
        if (value != null) found.set(key, value);
      }
      return found;
    },
  };
}
```

In `packages/market-data/src/cache.test.ts`, rename every `cachedQuotes` to `cachedLatest`: the import, the `describe` title and the call in `beforeEach`. Nothing else changes.

In `apps/server/src/index.ts`, change the import and the call:

```ts
import { alpacaQuotes, cachedLatest } from "@tj/market-data";
```

```ts
const quotes = secrets.alpaca
  ? cachedLatest(alpacaQuotes(secrets.alpaca), {
```

- [ ] **Step 5: Run the cache tests to confirm the rename changed nothing**

Run: `pnpm vitest run packages/market-data/src/cache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing option-quote tests**

Create `packages/market-data/src/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alpacaOptionQuotes } from "./options.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const CALL = "M261002C00022500";
const PUT = "M261002P00021000";

/** Alpaca's latest-quotes answer for two M contracts on 2026-09-26 (indicative feed), every field kept. */
const latestQuotes = {
  quotes: {
    [CALL]: { ap: 0.58, as: 101, ax: "A", bp: 0.44, bs: 150, bx: "A", c: "A", t: "2026-09-25T19:59:51.022502126Z" },
    [PUT]: { ap: 0.25, as: 1208, ax: "E", bp: 0, bs: 0, bx: "?", c: "A", t: "2026-09-25T19:59:49.671074315Z" },
  },
};

describe("alpacaOptionQuotes", () => {
  it("asks the indicative feed for every contract in one call, with the key", async () => {
    const { fetch, calls } = fakeFetch(json(latestQuotes));
    await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, PUT]);

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://data.alpaca.markets/v1beta1/options/quotes/latest");
    expect(url?.searchParams.get("symbols")).toBe(`${CALL},${PUT}`);
    expect(url?.searchParams.get("feed")).toBe("indicative");
    expect(calls[0]?.headers.get("APCA-API-KEY-ID")).toBe("PKTESTKEYID");
  });

  it("returns bid, ask and quote time, leaving out contracts Alpaca does not know", async () => {
    const { fetch } = fakeFetch(json(latestQuotes));
    const quotes = await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, PUT, "M261002C00022300"]);

    expect(quotes).toEqual(
      new Map([
        [CALL, { bid: 0.44, ask: 0.58, at: Date.UTC(2026, 8, 25, 19, 59, 51, 22) }],
        [PUT, { bid: 0, ask: 0.25, at: Date.UTC(2026, 8, 25, 19, 59, 49, 671) }],
      ]),
    );
  });

  it("treats an ask of 0 as no ask at all", async () => {
    const { fetch } = fakeFetch(
      json({ quotes: { [CALL]: { ap: 0, as: 0, bp: 0, bs: 0, t: "2026-09-25T19:59:51Z" } } }),
    );
    const quotes = await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL]);
    expect(quotes.get(CALL)).toEqual({ bid: 0, ask: null, at: Date.UTC(2026, 8, 25, 19, 59, 51) });
  });

  it("never sends a malformed code, and asks for each contract once", async () => {
    // One malformed code would fail Alpaca's whole batch with a 400.
    const { fetch, calls } = fakeFetch(json({ quotes: {} }));
    await alpacaOptionQuotes(KEYS, { fetch }).latest([CALL, "NOTASYMBOL", "M261002C0002250", CALL]);
    expect(calls[0]?.url.searchParams.get("symbols")).toBe(CALL);
  });

  it("asks in batches of at most 100", async () => {
    const contracts = Array.from({ length: 150 }, (_, i) => `M261002C${String(10_000 + i * 500).padStart(8, "0")}`);
    const { fetch, calls } = fakeFetch(json({ quotes: {} }), json({ quotes: {} }));
    await alpacaOptionQuotes(KEYS, { fetch }).latest(contracts);
    expect(calls.map((call) => call.url.searchParams.get("symbols")?.split(",").length)).toEqual([100, 50]);
  });

  it("does not call Alpaca when nothing valid is asked for", async () => {
    const { fetch, calls } = fakeFetch();
    expect((await alpacaOptionQuotes(KEYS, { fetch }).latest(["NOTASYMBOL"])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("fails with Alpaca's status, never echoing the key", async () => {
    const { fetch } = fakeFetch(json({ message: "forbidden" }, 403));
    const error = await alpacaOptionQuotes(KEYS, { fetch })
      .latest([CALL])
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("403");
    expect(String(error)).not.toContain(KEYS.secretKey);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `pnpm vitest run packages/market-data/src/options.test.ts`
Expected: FAIL. The run reports that `./options.js` cannot be resolved.

- [ ] **Step 8: Write the option-quote source**

Create `packages/market-data/src/options.ts`:

```ts
import type { OptionQuote } from "@tj/core";
import { z } from "zod";
import { type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";
import type { LatestSource } from "./quotes.js";

const LATEST_OPTION_QUOTES = `${DATA_API}/v1beta1/options/quotes/latest`;

/** Alpaca's own pattern for a contract code. Anything else fails a whole batch with a 400. */
export const CONTRACT = /^[A-Z]{1,5}\d{6,7}[CP]\d{8}$/;

/** Alpaca refuses more symbols than this in one call ("symbol limit is 100"). */
const BATCH = 100;

const latestQuotesSchema = z.object({
  quotes: z.record(
    z.string(),
    z.object({ bp: z.number().nonnegative(), ap: z.number().nonnegative(), t: z.iso.datetime({ offset: true }) }),
  ),
});

export type OptionQuoteSource = LatestSource<OptionQuote>;

/**
 * Bid and ask per contract from the free plan's indicative feed: quotes derived from OPRA,
 * good enough for an estimate. Unknown and expired contracts are simply left out.
 */
export function alpacaOptionQuotes(keys: AlpacaKeys, options: AlpacaOptions = {}): OptionQuoteSource {
  return {
    async latest(contracts) {
      const wanted = [...new Set(contracts)].filter((contract) => CONTRACT.test(contract));
      const found = new Map<string, OptionQuote>();
      for (let start = 0; start < wanted.length; start += BATCH) {
        const query = new URLSearchParams({ symbols: wanted.slice(start, start + BATCH).join(","), feed: "indicative" });
        const reply = latestQuotesSchema.parse(await alpacaGet(`${LATEST_OPTION_QUOTES}?${query}`, keys, options));
        for (const [contract, quote] of Object.entries(reply.quotes)) {
          // A missing bid comes as 0, which is what a long leg would fetch. A missing ask is no offer at all.
          found.set(contract, { bid: quote.bp, ask: quote.ap > 0 ? quote.ap : null, at: Date.parse(quote.t) });
        }
      }
      return found;
    },
  };
}
```

Replace `packages/market-data/src/index.ts` with:

```ts
export * from "./alpaca.js";
export * from "./cache.js";
export * from "./http.js";
export * from "./options.js";
export * from "./quotes.js";
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run packages/market-data`
Expected: PASS (all market-data tests, including 7 new ones).

- [ ] **Step 10: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass.

```bash
git add packages/market-data apps/server/src/index.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(market-data): option quotes from Alpaca's indicative feed

Bid, ask and time per contract, asked in batches of 100 and never with a
malformed code, which would fail the whole batch. The request code is
shared with stock quotes now, and the cache works for any latest-value
source.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Listed expirations and strikes (option chains)

**Files:**
- Create: `packages/market-data/src/chains.ts`
- Create: `packages/market-data/src/chains.test.ts`
- Modify: `packages/market-data/src/index.ts`

**Interfaces:**
- Consumes: `alpacaGet`, `AlpacaKeys`, `AlpacaOptions`, `TRADING_API` (Task 2); `nyDate` from `@tj/core` (Task 1).
- Produces (exported from `@tj/market-data`):
  - `interface ListedExpiration { date: string; expired: boolean; strikes: number[] }`
  - `interface ChainSource { listed(symbol: string, since?: string): Promise<ListedExpiration[]> }`
  - `alpacaChains(keys: AlpacaKeys, options?: AlpacaOptions & { today?: () => string }): ChainSource`
  - `cachedChains(source: ChainSource, options: { ttlMs: number; now?: () => number }): ChainSource`

- [ ] **Step 1: Write the failing tests**

Create `packages/market-data/src/chains.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alpacaChains, type ChainSource, cachedChains, type ListedExpiration } from "./chains.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const today = () => "2026-09-26";

/** One contract as Alpaca's contracts endpoint lists it (every field, as seen on 2026-09-26). */
function contract(expiry: string, strike: string, type: "call" | "put", status = "active") {
  const [year, month, day] = expiry.split("-");
  const code = `M${year?.slice(2)}${month}${day}${type === "call" ? "C" : "P"}${String(Number(strike) * 1000).padStart(8, "0")}`;
  return {
    id: "1fb904df-961a-4a07-a924-53a437626db2",
    symbol: code,
    name: `M ${expiry} ${strike} ${type}`,
    status,
    tradable: status === "active",
    expiration_date: expiry,
    root_symbol: "M",
    underlying_symbol: "M",
    underlying_asset_id: "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
    type,
    style: "american",
    strike_price: strike,
    multiplier: "100",
    size: "100",
    open_interest: "3",
    open_interest_date: "2026-09-24",
    close_price: "0.42",
    close_price_date: "2026-09-24",
    ppind: true,
  };
}

const page = (contracts: unknown[], next: string | null = null) =>
  json({ option_contracts: contracts, next_page_token: next });

describe("alpacaChains", () => {
  it("asks for active contracts from today to three years out, with the key", async () => {
    const { fetch, calls } = fakeFetch(page([]));
    await alpacaChains(KEYS, { fetch, today }).listed("M");

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://paper-api.alpaca.markets/v2/options/contracts");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      underlying_symbols: "M",
      status: "active",
      expiration_date_gte: "2026-09-26",
      expiration_date_lte: "2029-12-31",
      limit: "10000",
    });
    expect(calls[0]?.headers.get("APCA-API-SECRET-KEY")).toBe(KEYS.secretKey);
  });

  it("groups strikes by expiration, calls and puts together, in order", async () => {
    const { fetch } = fakeFetch(
      page([
        contract("2026-10-09", "23", "call"),
        contract("2026-10-02", "22.5", "call"),
        contract("2026-10-02", "22.5", "put"),
        contract("2026-10-02", "22", "call"),
        contract("2026-10-02", "21", "put"),
      ]),
    );
    expect(await alpacaChains(KEYS, { fetch, today }).listed("M")).toEqual<ListedExpiration[]>([
      { date: "2026-10-02", expired: false, strikes: [21, 22, 22.5] },
      { date: "2026-10-09", expired: false, strikes: [23] },
    ]);
  });

  it("also asks for expired contracts back to `since`, and marks them expired", async () => {
    const { fetch, calls } = fakeFetch(
      page([contract("2026-10-02", "22.5", "call")]),
      page([contract("2026-09-25", "8.5", "call", "inactive")]),
    );
    const listed = await alpacaChains(KEYS, { fetch, today }).listed("M", "2026-09-01");

    expect(calls).toHaveLength(2);
    expect(Object.fromEntries(calls[1]?.url.searchParams ?? [])).toEqual({
      underlying_symbols: "M",
      status: "inactive",
      expiration_date_gte: "2026-09-01",
      expiration_date_lte: "2026-09-26",
      limit: "10000",
    });
    expect(listed).toEqual([
      { date: "2026-09-25", expired: true, strikes: [8.5] },
      { date: "2026-10-02", expired: false, strikes: [22.5] },
    ]);
  });

  it("does not ask for expired contracts when `since` is today or later", async () => {
    for (const since of ["2026-09-26", "2026-10-01"]) {
      const { fetch, calls } = fakeFetch(page([]));
      await alpacaChains(KEYS, { fetch, today }).listed("M", since);
      expect(calls).toHaveLength(1);
    }
  });

  it("follows the page token until it runs out", async () => {
    const { fetch, calls } = fakeFetch(
      page([contract("2026-10-02", "22", "call")], "MTAw"),
      page([contract("2026-10-02", "23", "call")]),
    );
    const listed = await alpacaChains(KEYS, { fetch, today }).listed("M");

    expect(calls[1]?.url.searchParams.get("page_token")).toBe("MTAw");
    expect(listed).toEqual([{ date: "2026-10-02", expired: false, strikes: [22, 23] }]);
  });

  it("returns nothing when nothing is listed", async () => {
    const { fetch } = fakeFetch(page([]));
    expect(await alpacaChains(KEYS, { fetch, today }).listed("ZZZZ")).toEqual([]);
  });

  it("gives up rather than follow page tokens forever", async () => {
    const replies = Array.from({ length: 20 }, () => page([], "again"));
    const { fetch } = fakeFetch(...replies);
    await expect(alpacaChains(KEYS, { fetch, today }).listed("M")).rejects.toThrow(/pages/);
  });

  it("fails with Alpaca's status, keeping its error page out of the message", async () => {
    const { fetch } = fakeFetch(new Response("<html>401</html>", { status: 401 }));
    const error = await alpacaChains(KEYS, { fetch, today })
      .listed("M")
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("<html>");
  });
});

describe("cachedChains", () => {
  const OCT = [{ date: "2026-10-02", expired: false, strikes: [22.5] }];

  function fakeSource() {
    const asked: [string, string | undefined][] = [];
    const state = { error: null as Error | null };
    const source: ChainSource = {
      async listed(symbol, since) {
        asked.push([symbol, since]);
        if (state.error) throw state.error;
        return OCT;
      },
    };
    return { source, asked, state };
  }

  it("reuses an answer for the same symbol and date within the TTL", async () => {
    const fake = fakeSource();
    let clock = 0;
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => clock });
    await chains.listed("M", "2026-09-01");
    clock = 999;
    expect(await chains.listed("M", "2026-09-01")).toEqual(OCT);
    expect(fake.asked).toHaveLength(1);
  });

  it("asks again for a different date, and once the TTL is up", async () => {
    const fake = fakeSource();
    let clock = 0;
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => clock });
    await chains.listed("M");
    await chains.listed("M", "2026-09-01");
    clock = 1000;
    await chains.listed("M");
    expect(fake.asked).toEqual([
      ["M", undefined],
      ["M", "2026-09-01"],
      ["M", undefined],
    ]);
  });

  it("does not remember a failure", async () => {
    const fake = fakeSource();
    const chains = cachedChains(fake.source, { ttlMs: 1000, now: () => 0 });
    fake.state.error = new Error("Alpaca answered 500");
    await expect(chains.listed("M")).rejects.toThrow("500");
    fake.state.error = null;
    expect(await chains.listed("M")).toEqual(OCT);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/market-data/src/chains.test.ts`
Expected: FAIL. The run reports that `./chains.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `packages/market-data/src/chains.ts`:

```ts
import { nyDate } from "@tj/core";
import { z } from "zod";
import { type AlpacaKeys, type AlpacaOptions, alpacaGet, TRADING_API } from "./http.js";

const CONTRACTS = `${TRADING_API}/v2/options/contracts`;

/** A runaway page token must not loop forever; 20 pages of 10,000 is far beyond any real chain. */
const MAX_PAGES = 20;

export interface ListedExpiration {
  /** YYYY-MM-DD */
  date: string;
  /** Before today in New York. */
  expired: boolean;
  /** Every strike listed for this date, calls and puts together, ascending. */
  strikes: number[];
}

export interface ChainSource {
  /** Every expiration on or after `since` (today when omitted), with its strikes. Empty when nothing is listed. */
  listed(symbol: string, since?: string): Promise<ListedExpiration[]>;
}

export interface ChainOptions extends AlpacaOptions {
  /** Today's New York date; injectable for tests. */
  today?: () => string;
}

const contractsSchema = z.object({
  option_contracts: z.array(z.object({ expiration_date: z.string(), strike_price: z.string() })).nullish(),
  next_page_token: z.string().nullish(),
  page_token: z.string().nullish(),
});

type ListedContract = { expiration_date: string; strike_price: string };

/**
 * The listed contracts for a symbol, from the paper trading API. Its default window ends at the
 * coming weekend, so a range is always given; expired contracts need `status=inactive`.
 */
export function alpacaChains(keys: AlpacaKeys, options: ChainOptions = {}): ChainSource {
  const today = options.today ?? (() => nyDate(Date.now()));

  async function contracts(params: Record<string, string>): Promise<ListedContract[]> {
    const found: ListedContract[] = [];
    let token: string | null | undefined;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const query = new URLSearchParams({ ...params, limit: "10000" });
      if (token) query.set("page_token", token);
      const reply = contractsSchema.parse(await alpacaGet(`${CONTRACTS}?${query}`, keys, options));
      found.push(...(reply.option_contracts ?? []));
      token = reply.next_page_token ?? reply.page_token;
      if (!token) return found;
    }
    throw new Error(`Alpaca kept sending pages of contracts past ${MAX_PAGES} pages`);
  }

  return {
    async listed(symbol, since) {
      const now = today();
      const lastYear = Number(now.slice(0, 4)) + 3;
      const found = await contracts({
        underlying_symbols: symbol,
        status: "active",
        expiration_date_gte: now,
        expiration_date_lte: `${lastYear}-12-31`,
      });
      if (since && since < now) {
        found.push(
          ...(await contracts({
            underlying_symbols: symbol,
            status: "inactive",
            expiration_date_gte: since,
            expiration_date_lte: now,
          })),
        );
      }
      return byExpiration(found, now);
    },
  };
}

function byExpiration(contracts: ListedContract[], today: string): ListedExpiration[] {
  const strikes = new Map<string, Set<number>>();
  for (const listed of contracts) {
    const strike = Number(listed.strike_price);
    if (!Number.isFinite(strike)) continue;
    const forDate = strikes.get(listed.expiration_date) ?? new Set<number>();
    forDate.add(strike);
    strikes.set(listed.expiration_date, forDate);
  }
  return [...strikes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, set]) => ({ date, expired: date < today, strikes: [...set].sort((a, b) => a - b) }));
}

/** Keeps each (symbol, since) answer for `ttlMs`. A failure is never kept, so the next call tries again. */
export function cachedChains(source: ChainSource, options: { ttlMs: number; now?: () => number }): ChainSource {
  const { ttlMs, now = Date.now } = options;
  const cache = new Map<string, { value: ListedExpiration[]; fetchedAt: number }>();
  return {
    async listed(symbol, since) {
      const key = `${symbol}|${since ?? ""}`;
      const time = now();
      const hit = cache.get(key);
      if (hit && time - hit.fetchedAt < ttlMs) return hit.value;
      const value = await source.listed(symbol, since);
      cache.set(key, { value, fetchedAt: time });
      return value;
    },
  };
}
```

Add `export * from "./chains.js";` to `packages/market-data/src/index.ts`, keeping the list alphabetical (after `./cache.js`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/market-data/src/chains.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add packages/market-data/src/chains.ts packages/market-data/src/chains.test.ts packages/market-data/src/index.ts
git commit -m "$(cat <<'EOF'
feat(market-data): listed expirations and strikes from Alpaca

One call for active contracts and, for a trade opened in the past, one
for expired ones back to its open date, merged per expiration. Alpaca's
default window ends at the coming weekend, so a range is always given.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Company names and the key check

**Files:**
- Create: `packages/market-data/src/assets.ts`
- Create: `packages/market-data/src/assets.test.ts`
- Modify: `packages/market-data/src/index.ts`

**Interfaces:**
- Consumes: `alpacaGet`, `AlpacaError`, `AlpacaKeys`, `AlpacaOptions`, `TRADING_API` (Task 2); `LATEST_TRADES` from `alpaca.ts` (Task 2).
- Produces (exported from `@tj/market-data`):
  - `interface CompanyNames { name(symbol: string): Promise<string | null> }`
  - `alpacaCompanyNames(keys: AlpacaKeys, options?: AlpacaOptions): CompanyNames`
  - `type KeyCheck = "ok" | "rejected" | "not_paper" | "unreachable"`
  - `checkAlpacaKeys(keys: AlpacaKeys, options?: AlpacaOptions): Promise<KeyCheck>`

- [ ] **Step 1: Write the failing tests**

Create `packages/market-data/src/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alpacaCompanyNames, checkAlpacaKeys } from "./assets.js";
import { fakeFetch, json } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };

/** Alpaca's asset record for M, as seen on 2026-09-26 (trimmed to the fields it always sends). */
const asset = (name: string) =>
  json({
    id: "b3001dcc-4903-413c-b91a-985feacf5284",
    class: "us_equity",
    exchange: "NYSE",
    symbol: "M",
    name,
    status: "active",
    tradable: true,
    marginable: true,
  });

describe("alpacaCompanyNames", () => {
  it("asks the trading API for the asset and answers with its name", async () => {
    const { fetch, calls } = fakeFetch(asset("Macy's Inc."));
    expect(await alpacaCompanyNames(KEYS, { fetch }).name("M")).toBe("Macy's Inc.");
    expect(calls[0]?.url.href).toBe("https://paper-api.alpaca.markets/v2/assets/M");
  });

  it("drops the trailing 'Common Stock'", async () => {
    const { fetch } = fakeFetch(asset("NVIDIA Corporation Common Stock"));
    expect(await alpacaCompanyNames(KEYS, { fetch }).name("NVDA")).toBe("NVIDIA Corporation");
  });

  it("asks only once per symbol", async () => {
    const { fetch, calls } = fakeFetch(asset("Macy's Inc."));
    const names = alpacaCompanyNames(KEYS, { fetch });
    await names.name("M");
    expect(await names.name("M")).toBe("Macy's Inc.");
    expect(calls).toHaveLength(1);
  });

  it("answers null for a symbol Alpaca does not know, and remembers that", async () => {
    const { fetch, calls } = fakeFetch(json({ message: "asset not found for ZZZZ" }, 404));
    const names = alpacaCompanyNames(KEYS, { fetch });
    expect(await names.name("ZZZZ")).toBeNull();
    expect(await names.name("ZZZZ")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("passes other failures on without remembering them", async () => {
    const { fetch } = fakeFetch(json({ message: "internal error" }, 500), asset("Macy's Inc."));
    const names = alpacaCompanyNames(KEYS, { fetch });
    await expect(names.name("M")).rejects.toThrow("500");
    expect(await names.name("M")).toBe("Macy's Inc.");
  });
});

describe("checkAlpacaKeys", () => {
  it("is ok when both the data and the trading API accept the key", async () => {
    const { fetch, calls } = fakeFetch(json({ trades: {} }), asset("SPDR S&P 500 ETF Trust"));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("ok");
    expect(calls.map((call) => `${call.url.origin}${call.url.pathname}`)).toEqual([
      "https://data.alpaca.markets/v2/stocks/trades/latest",
      "https://paper-api.alpaca.markets/v2/assets/SPY",
    ]);
  });

  it("is rejected when the data API refuses the key", async () => {
    const { fetch, calls } = fakeFetch(new Response("<html>401</html>", { status: 401 }));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("rejected");
    expect(calls).toHaveLength(1);
  });

  it("is not_paper when only the paper trading API refuses it", async () => {
    const { fetch } = fakeFetch(json({ trades: {} }), json({ message: "forbidden" }, 403));
    expect(await checkAlpacaKeys(KEYS, { fetch })).toBe("not_paper");
  });

  it("is unreachable when Alpaca fails or does not answer", async () => {
    const down = fakeFetch(json({ message: "internal error" }, 500));
    expect(await checkAlpacaKeys(KEYS, { fetch: down.fetch })).toBe("unreachable");
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await checkAlpacaKeys(KEYS, { fetch: offline })).toBe("unreachable");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/market-data/src/assets.test.ts`
Expected: FAIL. The run reports that `./assets.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `packages/market-data/src/assets.ts`:

```ts
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
        const asset = assetSchema.parse(await alpacaGet(`${ASSETS}/${encodeURIComponent(symbol)}`, keys, options));
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
```

Add `export * from "./assets.js";` to `packages/market-data/src/index.ts` as the first line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/market-data/src/assets.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add packages/market-data/src/assets.ts packages/market-data/src/assets.test.ts packages/market-data/src/index.ts
git commit -m "$(cat <<'EOF'
feat(market-data): company names, and a check before a key is saved

The key check makes two read-only calls, so a live-account key (which
the paper trading API refuses) is told apart from a wrong one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 5: Write the Alpaca key into secrets.json safely

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `AlpacaKeys` type from `@tj/market-data` (Task 2).
- Produces:
  - `class SecretsFileBroken extends Error`
  - `writeAlpacaKeys(file: string, keys: AlpacaKeys | null): void`. Passing null removes the key.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/config.test.ts`, replace the first and last import lines with:

```ts
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
```

```ts
import { dataPaths, readSecrets, resolveDataDir, SecretsFileBroken, writeAlpacaKeys } from "./config.js";
```

and append:

```ts
describe("writeAlpacaKeys", () => {
  const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
  const place = (contents?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "tj-secrets-"));
    const file = join(dir, "secrets.json");
    if (contents !== undefined) writeFileSync(file, contents);
    return { dir, file };
  };
  const onWindows = process.platform === "win32";

  it("creates the file with the key", () => {
    const { file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(readSecrets(file)).toEqual({ alpaca: KEYS });
  });

  it.skipIf(onWindows)("makes the file readable by its owner only", () => {
    const { file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(onWindows)("tightens a hand-made file that others could read", () => {
    const { file } = place(JSON.stringify({ alpaca: { keyId: "PKOLD", secretKey: "old" } }));
    writeAlpacaKeys(file, KEYS);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("replaces the old key and keeps entries it does not know", () => {
    const { file } = place(
      JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: { keyId: "PKOLD", secretKey: "old" } }),
    );
    writeAlpacaKeys(file, KEYS);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS });
  });

  it("removes the key and keeps the rest", () => {
    const { file } = place(JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS }));
    writeAlpacaKeys(file, null);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" } });
  });

  it("refuses to overwrite a file it cannot read, without repeating what it holds", () => {
    const broken = '{"ibkr": {"flexToken": shh-token}}';
    const { file } = place(broken);
    expect(() => writeAlpacaKeys(file, KEYS)).toThrow(SecretsFileBroken);
    expect(() => writeAlpacaKeys(file, KEYS)).not.toThrow(/shh-token/);
    expect(readFileSync(file, "utf8")).toBe(broken);
  });

  it("refuses a file that holds something other than an object", () => {
    const { file } = place("[]");
    expect(() => writeAlpacaKeys(file, KEYS)).toThrow(SecretsFileBroken);
  });

  it("leaves no temporary file behind", () => {
    const { dir, file } = place();
    writeAlpacaKeys(file, KEYS);
    expect(readdirSync(dir)).toEqual(["secrets.json"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/config.test.ts`
Expected: FAIL. The run reports that `writeAlpacaKeys` / `SecretsFileBroken` are not exported.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/config.ts`, change the `node:fs` import and add the type import:

```ts
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import type { AlpacaKeys } from "@tj/market-data";
import { z } from "zod";
```

and append:

```ts
/** secrets.json exists but is not a JSON object. It is left alone, since it may hold other secrets. */
export class SecretsFileBroken extends Error {
  constructor(file: string, problem: string) {
    super(`${file} ${problem}; fix or delete it by hand`);
    this.name = "SecretsFileBroken";
  }
}

/**
 * Sets (or, with null, removes) the Alpaca key in secrets.json and keeps every other entry.
 * The new file is written beside the old one, made readable by its owner only, then renamed
 * into place, so a crash never leaves half a file.
 */
export function writeAlpacaKeys(file: string, keys: AlpacaKeys | null): void {
  const { alpaca: _replaced, ...rest } = readSecretsObject(file);
  const next = keys ? { ...rest, alpaca: { keyId: keys.keyId, secretKey: keys.secretKey } } : rest;
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  // The mode above only applies to a new file; a temp file left by a crash keeps its old one.
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

/** The file as a plain object, entries this app does not know included. No file is an empty object. */
function readSecretsObject(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // As in readSecrets: the parser's message would quote the text around the mistake.
    throw new SecretsFileBroken(file, "is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SecretsFileBroken(file, "does not hold a JSON object");
  }
  return data as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server/src/config.test.ts`
Expected: PASS (all config tests, 8 new).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts
git commit -m "$(cat <<'EOF'
feat(server): write the Alpaca key into secrets.json safely

Owner-only, written beside the old file and renamed into place, keeping
entries this version does not know. A file it cannot read is refused
rather than overwritten, since it may hold other secrets.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A market data holder that can change keys while running

**Files:**
- Create: `apps/server/src/marketData.ts`
- Create: `apps/server/src/marketData.test.ts`
- Create: `apps/server/src/testing.ts` (test helpers)
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes/quotes.ts`
- Modify: `apps/server/src/quotes.test.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: everything `@tj/market-data` exports from Tasks 2–4.
- Produces:
  - `interface MarketSources { quotes: QuoteSource; optionQuotes: OptionQuoteSource; chains: ChainSource; companies: CompanyNames }`
  - `interface MarketStatus { state: "on" | "off" | "error"; message: string | null }`
  - `interface MarketData { sources(): MarketSources | null; configure(keys: AlpacaKeys | null): void; status(): MarketStatus; keyIdHint(): string | null; report(error: unknown): void }`
  - `createMarketData(keys: AlpacaKeys | null, options?: { build?: (keys, report) => MarketSources; log?: (message: string) => void }): MarketData`
  - `AppDeps.market?: MarketData`. This replaces `AppDeps.quotes`.
  - `TICKER` exported from `routes/quotes.ts`.
  - Test helpers in `apps/server/src/testing.ts`: `fakeSources(overrides?)`, `testApp(deps?)`, `LOCAL`.

- [ ] **Step 1: Add the test helpers**

Create `apps/server/src/testing.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations } from "@tj/db";
import { type AppDeps, createApp } from "./app.js";
import type { MarketSources } from "./marketData.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

/** Passes the server's Host check. */
export const LOCAL = { host: "localhost" };

/** Market sources that know nothing, with any of them replaced. */
export function fakeSources(overrides: Partial<MarketSources> = {}): MarketSources {
  return {
    quotes: { latest: async () => new Map() },
    optionQuotes: { latest: async () => new Map() },
    chains: { listed: async () => [] },
    companies: { name: async () => null },
    ...overrides,
  };
}

/** The app on a fresh, migrated database, with whatever else a test needs. */
export function testApp(deps: Omit<AppDeps, "db"> = {}) {
  const file = join(mkdtempSync(join(tmpdir(), "tj-app-")), "journal.db");
  runMigrations(file, { migrationsFolder: MIGRATIONS });
  return createApp({ db: openDatabase(file), ...deps });
}
```

- [ ] **Step 2: Write the failing holder tests**

Create `apps/server/src/marketData.test.ts`:

```ts
import { AlpacaError, type AlpacaKeys } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources } from "./testing.js";

const KEYS = { keyId: "PKTESTKEY7QXA", secretKey: "test-secret-do-not-log" };

/** Builds fake sources and records which key each build was for. */
function recordingBuild() {
  const built: string[] = [];
  const build = (keys: AlpacaKeys) => {
    built.push(keys.keyId);
    return fakeSources();
  };
  return { built, build };
}

describe("createMarketData", () => {
  it("has no sources and is off without a key", () => {
    const market = createMarketData(null, { build: recordingBuild().build });
    expect(market.sources()).toBeNull();
    expect(market.status()).toEqual({ state: "off", message: null });
    expect(market.keyIdHint()).toBeNull();
  });

  it("builds the sources for the key it starts with, and shows only a hint of the key ID", () => {
    const { built, build } = recordingBuild();
    const market = createMarketData(KEYS, { build });
    expect(market.sources()).not.toBeNull();
    expect(built).toEqual(["PKTESTKEY7QXA"]);
    expect(market.status()).toEqual({ state: "on", message: null });
    expect(market.keyIdHint()).toBe("PK…7QXA");
  });

  it("rebuilds the sources for a new key, and drops them when the key is removed", () => {
    const { built, build } = recordingBuild();
    const market = createMarketData(KEYS, { build });
    const first = market.sources();
    market.configure({ keyId: "PKNEWKEYABCD", secretKey: "another-secret" });
    expect(built).toEqual(["PKTESTKEY7QXA", "PKNEWKEYABCD"]);
    expect(market.sources()).not.toBe(first);
    market.configure(null);
    expect(market.sources()).toBeNull();
    expect(market.status().state).toBe("off");
  });

  it("turns to error when Alpaca refuses the key, until a key is saved again", () => {
    const logs: string[] = [];
    const market = createMarketData(KEYS, { build: recordingBuild().build, log: (line) => logs.push(line) });
    market.report(new AlpacaError(401, "request is not authorized"));
    expect(market.status()).toEqual({
      state: "error",
      message: "Alpaca rejected the saved key. Save a new one below.",
    });
    expect(logs).toEqual(["Market data unavailable: Alpaca answered 401: request is not authorized"]);
    market.configure(KEYS);
    expect(market.status().state).toBe("on");
  });

  it("logs other failures and stays on", () => {
    const logs: string[] = [];
    const market = createMarketData(KEYS, { build: recordingBuild().build, log: (line) => logs.push(line) });
    market.report(new AlpacaError(500, "internal error"));
    market.report(new Error("The operation was aborted due to timeout"));
    expect(market.status().state).toBe("on");
    expect(logs).toHaveLength(2);
  });

  it("hands its sources a way to report failures", () => {
    let fromSource: ((error: unknown) => void) | undefined;
    const market = createMarketData(KEYS, {
      build: (_keys, report) => {
        fromSource = report;
        return fakeSources();
      },
      log: () => {},
    });
    fromSource?.(new AlpacaError(403, "forbidden"));
    expect(market.status().state).toBe("error");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/marketData.test.ts`
Expected: FAIL. The run reports that `./marketData.js` cannot be resolved.

- [ ] **Step 4: Write the holder**

Create `apps/server/src/marketData.ts`:

```ts
import {
  AlpacaError,
  type AlpacaKeys,
  alpacaChains,
  alpacaCompanyNames,
  alpacaOptionQuotes,
  alpacaQuotes,
  type ChainSource,
  type CompanyNames,
  cachedChains,
  cachedLatest,
  type OptionQuoteSource,
  type QuoteSource,
} from "@tj/market-data";

export interface MarketSources {
  quotes: QuoteSource;
  optionQuotes: OptionQuoteSource;
  chains: ChainSource;
  companies: CompanyNames;
}

export interface MarketStatus {
  state: "on" | "off" | "error";
  message: string | null;
}

/** The Alpaca clients for the current key, rebuilt in place when Settings saves or removes one. */
export interface MarketData {
  /** Null without a key; routes then answer as if nothing were known. */
  sources(): MarketSources | null;
  configure(keys: AlpacaKeys | null): void;
  status(): MarketStatus;
  /** The key ID's first 2 and last 4 characters, e.g. PK…7QXA. Never the secret. */
  keyIdHint(): string | null;
  /** Logs a failed call. A refused key turns the status to error until a key is saved or removed. */
  report(error: unknown): void;
}

export interface MarketDataOptions {
  /** Builds the sources for a key; tests pass fakes. */
  build?: (keys: AlpacaKeys, report: (error: unknown) => void) => MarketSources;
  log?: (message: string) => void;
}

const REJECTED = "Alpaca rejected the saved key. Save a new one below.";

export function createMarketData(keys: AlpacaKeys | null, options: MarketDataOptions = {}): MarketData {
  const { build = alpacaSources, log = console.warn } = options;
  let current: { keys: AlpacaKeys; sources: MarketSources } | null = null;
  let rejected = false;

  const market: MarketData = {
    sources: () => current?.sources ?? null,
    configure(next) {
      rejected = false;
      current = next ? { keys: next, sources: build(next, market.report) } : null;
    },
    status() {
      if (!current) return { state: "off", message: null };
      return rejected ? { state: "error", message: REJECTED } : { state: "on", message: null };
    },
    keyIdHint: () => (current ? `${current.keys.keyId.slice(0, 2)}…${current.keys.keyId.slice(-4)}` : null),
    report(error) {
      log(`Market data unavailable: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof AlpacaError && (error.status === 401 || error.status === 403)) rejected = true;
    },
  };
  market.configure(keys);
  return market;
}

/** The live Alpaca clients, each behind its cache. */
function alpacaSources(keys: AlpacaKeys, report: (error: unknown) => void): MarketSources {
  return {
    // Shorter than the page's one-minute refresh, so every refresh gets a new price.
    quotes: cachedLatest(alpacaQuotes(keys), { ttlMs: 30_000, onError: report }),
    optionQuotes: cachedLatest(alpacaOptionQuotes(keys), { ttlMs: 30_000, onError: report }),
    chains: cachedChains(alpacaChains(keys), { ttlMs: 15 * 60_000 }),
    companies: alpacaCompanyNames(keys),
  };
}
```

- [ ] **Step 5: Run the holder tests to verify they pass**

Run: `pnpm vitest run apps/server/src/marketData.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Move `/api/quotes` onto the holder (test first)**

Replace the top of `apps/server/src/quotes.test.ts`, everything up to `const getQuotes`, with:

```ts
import type { Quote, QuoteSource } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const M = { price: 22.68, at: 1_790_279_911_052 };
const ENVX = { price: 9.87, at: 1_790_279_999_246 };

/** Knows prices for M and ENVX, and records every list of symbols it is asked for. */
function fakeSource() {
  const prices: Record<string, Quote> = { M, ENVX };
  const asked: string[][] = [];
  const source: QuoteSource = {
    async latest(symbols) {
      asked.push([...symbols]);
      return new Map(
        symbols.flatMap((symbol) => (prices[symbol] ? [[symbol, prices[symbol]] as const] : [])),
      );
    },
  };
  return { source, asked };
}

function appWith(quotes?: QuoteSource) {
  return testApp({
    market: quotes ? createMarketData(KEYS, { build: () => fakeSources({ quotes }) }) : undefined,
  });
}
```

Keep `getQuotes` and the four existing tests unchanged, and add this test at the end of the `describe`:

```ts
  it("answers from a newly configured key on the very next request", async () => {
    const { source } = fakeSource();
    const market = createMarketData(null, { build: () => fakeSources({ quotes: source }) });
    const app = testApp({ market });
    expect((await getQuotes(app, "M")).body).toEqual({ quotes: {} });
    market.configure(KEYS);
    expect((await getQuotes(app, "M")).body).toEqual({ quotes: { M } });
  });
```

Run: `pnpm vitest run apps/server/src/quotes.test.ts`
Expected: FAIL. `pnpm typecheck` also flags that `AppDeps` has no `market`. The run fails because `createApp` ignores `market`, so every test gets `{ quotes: {} }`.

- [ ] **Step 7: Wire the holder through the app**

In `apps/server/src/app.ts`, replace the `QuoteSource` import with `import type { MarketData } from "./marketData.js";`, and in `AppDeps` replace the `quotes` field with:

```ts
  /** Live market data. Omitted in tests that don't need it; the app then answers as if no key were set up. */
  market?: MarketData;
```

and change the quotes route line to:

```ts
    .route("/api/quotes", quoteRoutes(deps.market));
```

In `apps/server/src/routes/quotes.ts`, export the ticker pattern and read the source on every request:

```ts
import { zValidator } from "@hono/zod-validator";
import type { Quote } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import type { MarketData } from "../marketData.js";

/** A plain ticker such as M or BRK.B. Anything else is dropped rather than sent on. */
export const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

const querySchema = z.object({ symbols: z.string() });

/** Reference prices only: they are shown, never stored (spec §8.6). */
export function quoteRoutes(market?: MarketData) {
  return new Hono().get("/", zValidator("query", querySchema), async (c) => {
    const requested = c.req.valid("query").symbols.split(",");
    const symbols = [...new Set(requested.map((symbol) => symbol.trim().toUpperCase()))].filter((symbol) =>
      TICKER.test(symbol),
    );
    // Asked on every request, so a key saved in Settings is used straight away.
    const quotes = market?.sources()?.quotes;
    const found = quotes ? await quotes.latest(symbols) : new Map<string, Quote>();
    return c.json({ quotes: Object.fromEntries(found) }, 200);
  });
}
```

Replace `apps/server/src/index.ts` with:

```ts
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { backupDatabase, openDatabase, runMigrations } from "@tj/db";
import type { AlpacaKeys } from "@tj/market-data";
import { createApp } from "./app.js";
import { dataPaths, readSecrets, resolveDataDir } from "./config.js";
import { createMarketData } from "./marketData.js";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
const PORT = Number(process.env.TJ_PORT ?? 4178);

const paths = dataPaths(resolveDataDir(process.env, process.platform, homedir()));
mkdirSync(paths.dataDir, { recursive: true });
mkdirSync(paths.attachmentsDir, { recursive: true });

runMigrations(paths.dbFile, { migrationsFolder: MIGRATIONS, backupDir: paths.backupDir });

// The built UI is optional: `pnpm dev:server` runs before the web app is built.
const webDir = existsSync(WEB_DIST) ? WEB_DIST : undefined;

// Market data is optional too: without a usable key the journal runs without it.
let keys: AlpacaKeys | null = null;
try {
  keys = readSecrets(paths.secretsFile).alpaca ?? null;
} catch (error) {
  console.warn(`Market data off: ${(error as Error).message}`);
}
const market = createMarketData(keys);

const app = createApp({
  db: openDatabase(paths.dbFile),
  webDir,
  backup: () => backupDatabase(paths.dbFile, paths.backupDir),
  market,
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`Trading journal on http://127.0.0.1:${PORT}`);
  console.log(`Data directory: ${paths.dataDir}`);
  console.log(
    market.sources()
      ? "Market data: Alpaca (IEX stock prices, indicative option quotes)"
      : "Market data: off (add an Alpaca key in Settings)",
  );
  if (!webDir) console.log("UI not built yet — run `pnpm build`, or use `pnpm dev:web`.");
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server`
Expected: PASS (all server tests, including the new quotes test).

- [ ] **Step 9: Check the startup line against a throwaway data directory**

Run: `TJ_DATA_DIR=$(mktemp -d) TJ_PORT=4191 timeout 15 pnpm --filter @tj/server start`
Expected: the output includes `Market data: off (add an Alpaca key in Settings)`. `timeout` then stops the server, which is expected.

- [ ] **Step 10: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/server/src
git commit -m "$(cat <<'EOF'
feat(server): a market data holder that can change keys while running

Routes ask it for the current Alpaca clients on every request, so a key
saved from Settings is used straight away. A key Alpaca refuses turns
its status to error until a new one is saved.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Chains, option quotes and company names over the API

**Files:**
- Create: `apps/server/src/routes/market.ts`
- Create: `apps/server/src/market.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `MarketData`, `MarketSources` (Task 6); `TICKER` (Task 6); `CONTRACT`, `ListedExpiration`, `AlpacaError` from `@tj/market-data`; `OptionQuote` from `@tj/core`.
- Produces (read by the web app through the typed Hono client):
  - `GET /api/chains/:symbol?since=YYYY-MM-DD` → `{ symbol: string; expirations: ListedExpiration[]; unavailable: { reason: "no_key" | "none_listed" | "unreachable"; message: string } | null }`
  - `GET /api/option-quotes?contracts=…` → `{ quotes: Record<string, OptionQuote> }`
  - `GET /api/company/:symbol` → `{ name: string | null }`
  - Web clients call these as `api.api.chains[":symbol"].$get`, `api.api["option-quotes"].$get` and `api.api.company[":symbol"].$get`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/market.test.ts`:

```ts
import { AlpacaError, type ListedExpiration } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import type { createApp } from "./app.js";
import { createMarketData, type MarketSources } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEYID", secretKey: "test-secret-do-not-log" };
const OCT: ListedExpiration[] = [{ date: "2026-10-02", expired: false, strikes: [21, 22, 22.5] }];
const QUOTE = { bid: 0.44, ask: 0.58, at: Date.UTC(2026, 8, 25, 19, 59, 51) };

function withSources(overrides: Partial<MarketSources>) {
  const market = createMarketData(KEYS, { build: () => fakeSources(overrides), log: () => {} });
  return { app: testApp({ market }), market };
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  const res = await app.request(path, { headers: LOCAL });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/chains/:symbol", () => {
  it("answers with the listed expirations, asking in capitals from the given date", async () => {
    const asked: [string, string | undefined][] = [];
    const { app } = withSources({
      chains: {
        listed: async (symbol, since) => {
          asked.push([symbol, since]);
          return OCT;
        },
      },
    });
    const { status, body } = await get(app, "/api/chains/m?since=2026-09-01");
    expect(status).toBe(200);
    expect(body).toEqual({ symbol: "M", expirations: OCT, unavailable: null });
    expect(asked).toEqual([["M", "2026-09-01"]]);
  });

  it("says when nothing is listed", async () => {
    const { app } = withSources({});
    const { body } = await get(app, "/api/chains/ZZZZ");
    expect(body.unavailable).toEqual({ reason: "none_listed", message: "No listed options for ZZZZ in that period." });
  });

  it("says a key is needed when none is set up", async () => {
    const { body } = await get(testApp(), "/api/chains/M");
    expect(body).toEqual({
      symbol: "M",
      expirations: [],
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
    });
  });

  it("says Alpaca didn't answer, and reports the failure", async () => {
    const { app, market } = withSources({
      chains: {
        listed: async () => {
          throw new AlpacaError(401, "request is not authorized");
        },
      },
    });
    const { status, body } = await get(app, "/api/chains/M");
    expect(status).toBe(200);
    expect(body.unavailable).toEqual({
      reason: "unreachable",
      message: "Alpaca didn't answer, so type the expiry and strikes.",
    });
    expect(market.status().state).toBe("error");
  });

  it.each(["/api/chains/SPX%20INDEX", "/api/chains/M?since=yesterday", "/api/chains/M?since=2026-13-45"])(
    "refuses %s",
    async (path) => {
      const { app } = withSources({});
      expect((await get(app, path)).status).toBe(400);
    },
  );
});

describe("GET /api/option-quotes", () => {
  it("answers with bid, ask and time for each contract the source knows", async () => {
    const { app } = withSources({ optionQuotes: { latest: async () => new Map([["M261002C00022500", QUOTE]]) } });
    const { body } = await get(app, "/api/option-quotes?contracts=M261002C00022500,M261002C00022300");
    expect(body).toEqual({ quotes: { M261002C00022500: QUOTE } });
  });

  it("asks for each well-formed contract once, in capitals", async () => {
    const asked: string[][] = [];
    const { app } = withSources({
      optionQuotes: {
        latest: async (contracts) => {
          asked.push([...contracts]);
          return new Map();
        },
      },
    });
    await get(app, "/api/option-quotes?contracts=m261002c00022500,M261002C00022500,NOTASYMBOL,%20M261002P00021000");
    expect(asked).toEqual([["M261002C00022500", "M261002P00021000"]]);
  });

  it("passes a long list on in one piece; the source splits it for Alpaca", async () => {
    const contracts = Array.from({ length: 150 }, (_, i) => `M261002C${String(10_000 + i * 500).padStart(8, "0")}`);
    const asked: number[] = [];
    const { app } = withSources({
      optionQuotes: {
        latest: async (codes) => {
          asked.push(codes.length);
          return new Map();
        },
      },
    });
    const { status } = await get(app, `/api/option-quotes?contracts=${contracts.join(",")}`);
    expect(status).toBe(200);
    expect(asked).toEqual([150]);
  });

  it("answers with no quotes without a key", async () => {
    expect((await get(testApp(), "/api/option-quotes?contracts=M261002C00022500")).body).toEqual({ quotes: {} });
  });
});

describe("GET /api/company/:symbol", () => {
  it("answers with the company's name", async () => {
    const { app } = withSources({ companies: { name: async (symbol) => (symbol === "M" ? "Macy's Inc." : null) } });
    expect((await get(app, "/api/company/m")).body).toEqual({ name: "Macy's Inc." });
  });

  it("answers null without a key", async () => {
    expect((await get(testApp(), "/api/company/M")).body).toEqual({ name: null });
  });

  it("answers null when Alpaca fails, and reports it", async () => {
    const { app, market } = withSources({
      companies: {
        name: async () => {
          throw new AlpacaError(403, "forbidden");
        },
      },
    });
    expect((await get(app, "/api/company/M")).body).toEqual({ name: null });
    expect(market.status().state).toBe("error");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/market.test.ts`
Expected: FAIL. The routes return 404, so status and body assertions fail.

- [ ] **Step 3: Write the routes**

Create `apps/server/src/routes/market.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import type { OptionQuote } from "@tj/core";
import { CONTRACT, type ListedExpiration } from "@tj/market-data";
import { Hono } from "hono";
import { z } from "zod";
import type { MarketData } from "../marketData.js";
import { TICKER } from "./quotes.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => !Number.isNaN(Date.parse(date)), "not a date");

interface Unavailable {
  reason: "no_key" | "none_listed" | "unreachable";
  message: string;
}

const NO_KEY: Unavailable = { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." };
const UNREACHABLE: Unavailable = {
  reason: "unreachable",
  message: "Alpaca didn't answer, so type the expiry and strikes.",
};

/** Read-only market data for the builder and the marks (spec §7.2). Estimates are made in the browser, never here. */
export function marketRoutes(market?: MarketData) {
  return new Hono()
    .get("/chains/:symbol", zValidator("query", z.object({ since: isoDate.optional() })), async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      if (!TICKER.test(symbol)) return c.json({ error: "not a ticker" }, 400);
      const answer = (expirations: ListedExpiration[], unavailable: Unavailable | null) =>
        c.json({ symbol, expirations, unavailable }, 200);
      const sources = market?.sources();
      if (!sources) return answer([], NO_KEY);
      try {
        const expirations = await sources.chains.listed(symbol, c.req.valid("query").since);
        if (expirations.length > 0) return answer(expirations, null);
        return answer([], { reason: "none_listed", message: `No listed options for ${symbol} in that period.` });
      } catch (error) {
        market?.report(error);
        return answer([], UNREACHABLE);
      }
    })
    .get("/option-quotes", zValidator("query", z.object({ contracts: z.string() })), async (c) => {
      const requested = c.req.valid("query").contracts.split(",");
      const contracts = [...new Set(requested.map((code) => code.trim().toUpperCase()))].filter((code) =>
        CONTRACT.test(code),
      );
      const sources = market?.sources();
      // The cached source reports its own failures and answers with what it has.
      const found =
        sources && contracts.length > 0
          ? await sources.optionQuotes.latest(contracts)
          : new Map<string, OptionQuote>();
      return c.json({ quotes: Object.fromEntries(found) }, 200);
    })
    .get("/company/:symbol", async (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      if (!TICKER.test(symbol)) return c.json({ error: "not a ticker" }, 400);
      const sources = market?.sources();
      let name: string | null = null;
      if (sources) {
        try {
          name = await sources.companies.name(symbol);
        } catch (error) {
          market?.report(error);
        }
      }
      return c.json({ name }, 200);
    });
}
```

In `apps/server/src/app.ts`, import it and mount it after the quotes route:

```ts
import { marketRoutes } from "./routes/market.js";
```

```ts
    .route("/api/quotes", quoteRoutes(deps.market))
    .route("/api", marketRoutes(deps.market));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server/src/market.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/server/src/routes/market.ts apps/server/src/market.test.ts apps/server/src/app.ts
git commit -m "$(cat <<'EOF'
feat(server): chains, option quotes and company names over the API

Read-only routes for the builder's pickers and the marks. Without a key,
or when Alpaca fails, each answers with an empty result and a reason the
builder can show, never an error.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Settings routes that save, test and remove the key

**Files:**
- Create: `apps/server/src/routes/settings.ts`
- Create: `apps/server/src/settings.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `writeAlpacaKeys`, `SecretsFileBroken`, `readSecrets` (Task 5); `MarketData`, `createMarketData` (Task 6); `checkAlpacaKeys`, `KeyCheck`, `AlpacaKeys` from `@tj/market-data` (Task 4).
- Produces:
  - `interface SettingsDeps { dataDir: string; secretsFile: string; checkKeys: (keys: AlpacaKeys) => Promise<KeyCheck> }`, and `AppDeps.settings?: SettingsDeps`
  - `GET /api/settings` → `{ dataDir: string | null; marketData: { state: "on" | "off" | "error"; message: string | null; keyIdHint: string | null } }`
  - `PUT /api/settings/market-data` with body `{ keyId, secretKey }` → 200 with the same shape as GET, or 400/409/503 `{ error: string; message: string }`
  - `DELETE /api/settings/market-data` → 200 with the same shape as GET, or 409/503 `{ error, message }`
  - Web clients call these as `api.api.settings.$get`, `api.api.settings["market-data"].$put({ json })` and `.$delete()`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/settings.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AlpacaKeys, KeyCheck, QuoteSource } from "@tj/market-data";
import { describe, expect, it } from "vitest";
import type { createApp } from "./app.js";
import { readSecrets } from "./config.js";
import { createMarketData } from "./marketData.js";
import { fakeSources, LOCAL, testApp } from "./testing.js";

const KEYS = { keyId: "PKTESTKEY7QXA", secretKey: "test-secret-do-not-log" };
const M = { price: 22.68, at: 1_790_279_911_052 };
const JSON_HEADERS = { ...LOCAL, "content-type": "application/json" };

interface Setup {
  check?: KeyCheck;
  keys?: AlpacaKeys | null;
  /** What secrets.json holds before the test; omitted means no file. */
  contents?: string;
}

function setup({ check = "ok", keys = null, contents }: Setup = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tj-settings-"));
  const secretsFile = join(dir, "secrets.json");
  if (contents !== undefined) writeFileSync(secretsFile, contents);
  const checked: AlpacaKeys[] = [];
  // Knows a price for every symbol, so a working key is easy to see through /api/quotes.
  const quotes: QuoteSource = { latest: async (symbols) => new Map(symbols.map((symbol) => [symbol, M])) };
  const market = createMarketData(keys, { build: () => fakeSources({ quotes }), log: () => {} });
  const app = testApp({
    market,
    settings: {
      dataDir: dir,
      secretsFile,
      checkKeys: async (tried) => {
        checked.push(tried);
        return check;
      },
    },
  });
  return { app, market, dir, secretsFile, checked };
}

const put = (app: ReturnType<typeof createApp>, body: string, headers: Record<string, string> = JSON_HEADERS) =>
  app.request("/api/settings/market-data", { method: "PUT", headers, body });

describe("GET /api/settings", () => {
  it("shows the data directory and that market data is off", async () => {
    const { app, dir } = setup();
    const res = await app.request("/api/settings", { headers: LOCAL });
    expect(await res.json()).toEqual({ dataDir: dir, marketData: { state: "off", message: null, keyIdHint: null } });
  });

  it("shows a hint of the saved key ID and never the secret", async () => {
    const { app } = setup({ keys: KEYS });
    const text = await (await app.request("/api/settings", { headers: LOCAL })).text();
    expect(JSON.parse(text).marketData).toEqual({ state: "on", message: null, keyIdHint: "PK…7QXA" });
    expect(text).not.toContain(KEYS.secretKey);
  });
});

describe("PUT /api/settings/market-data", () => {
  it("tests the key, saves it, and uses it from the next request on", async () => {
    const { app, secretsFile, checked } = setup();
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ marketData: { state: "on", keyIdHint: "PK…7QXA" } });
    expect(checked).toEqual([KEYS]);
    expect(readSecrets(secretsFile)).toEqual({ alpaca: KEYS });
    const quotes = await app.request("/api/quotes?symbols=M", { headers: LOCAL });
    expect(await quotes.json()).toEqual({ quotes: { M } });
  });

  it("keeps the other entries in the file", async () => {
    const { app, secretsFile } = setup({ contents: JSON.stringify({ ibkr: { flexToken: "keep-me" } }) });
    await put(app, JSON.stringify(KEYS));
    expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS });
  });

  it.each([
    ["rejected", "Alpaca rejected this key"],
    ["not_paper", "use your Paper account's key"],
    ["unreachable", "Couldn't reach Alpaca"],
  ] as const)("refuses a key that fails the check (%s) and changes nothing", async (check, message) => {
    const { app, market, secretsFile } = setup({ check });
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe(check);
    expect(body.message).toContain(message);
    expect(existsSync(secretsFile)).toBe(false);
    expect(market.status().state).toBe("off");
  });

  it("refuses to overwrite a broken file, and leaves the running key alone", async () => {
    const broken = '{"ibkr": {"flexToken": ';
    const { app, market, secretsFile } = setup({ contents: broken });
    const res = await put(app, JSON.stringify(KEYS));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("not valid JSON");
    expect(readFileSync(secretsFile, "utf8")).toBe(broken);
    expect(market.status().state).toBe("off");
  });

  it.each([
    ["text/plain", JSON.stringify(KEYS)],
    ["application/x-www-form-urlencoded", `keyId=${KEYS.keyId}&secretKey=${KEYS.secretKey}`],
  ])("refuses a %s body, the kind another site could send, without testing or saving anything", async (type, body) => {
    const { app, secretsFile, checked } = setup();
    const res = await put(app, body, { ...LOCAL, "content-type": type });
    expect(res.status).toBe(400);
    expect(checked).toEqual([]);
    expect(existsSync(secretsFile)).toBe(false);
  });

  it("never repeats the secret in an answer", async () => {
    const incomplete = await put(setup().app, JSON.stringify({ secretKey: KEYS.secretKey }));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.text()).not.toContain(KEYS.secretKey);
    const refused = await put(setup({ check: "rejected" }).app, JSON.stringify(KEYS));
    expect(await refused.text()).not.toContain(KEYS.secretKey);
  });
});

describe("DELETE /api/settings/market-data", () => {
  it("removes the key, keeps the rest of the file, and turns market data off", async () => {
    const { app, market, secretsFile } = setup({
      keys: KEYS,
      contents: JSON.stringify({ ibkr: { flexToken: "keep-me" }, alpaca: KEYS }),
    });
    const res = await app.request("/api/settings/market-data", { method: "DELETE", headers: LOCAL });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ marketData: { state: "off", keyIdHint: null } });
    expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({ ibkr: { flexToken: "keep-me" } });
    expect(market.sources()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/server/src/settings.test.ts`
Expected: FAIL. `/api/settings` is not routed, so requests get 404.

- [ ] **Step 3: Write the routes**

Create `apps/server/src/routes/settings.ts`:

```ts
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
          if (error instanceof SecretsFileBroken) return c.json({ error: "broken_file", message: error.message }, 409);
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
        if (error instanceof SecretsFileBroken) return c.json({ error: "broken_file", message: error.message }, 409);
        throw error;
      }
      return c.json(view(), 200);
    });
}
```

In `apps/server/src/app.ts`, import the routes and their deps type, add the field to `AppDeps`, and mount the routes:

```ts
import { type SettingsDeps, settingsRoutes } from "./routes/settings.js";
```

```ts
  /** Where Settings saves the key, and how it tests one first. Omitted in tests that don't need it. */
  settings?: SettingsDeps;
```

```ts
    .route("/api/quotes", quoteRoutes(deps.market))
    .route("/api/settings", settingsRoutes(deps.market, deps.settings))
    .route("/api", marketRoutes(deps.market));
```

In `apps/server/src/index.ts`, import the check:

```ts
import { type AlpacaKeys, checkAlpacaKeys } from "@tj/market-data";
```

and pass the settings to `createApp`:

```ts
  market,
  settings: { dataDir: paths.dataDir, secretsFile: paths.secretsFile, checkKeys: (keys) => checkAlpacaKeys(keys) },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/server/src/settings.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/server/src/routes/settings.ts apps/server/src/settings.test.ts apps/server/src/app.ts apps/server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): save, test and remove the Alpaca key from Settings

A key is tested with Alpaca before it is written, and used from the next
request on. Only JSON bodies are read, so another site cannot post a key
here, and no answer ever repeats the secret.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 9: Estimated P&L for open trades in the Journal and Iron Flies lists

**Files:**
- Create: `apps/web/src/market.ts`
- Create: `apps/web/src/components/Estimate.tsx`
- Modify: `apps/web/src/routes/Journal.tsx`
- Modify: `apps/web/src/routes/Journal.test.tsx`

**Interfaces:**
- Consumes: `closeEstimate`, `nyDate`, `occSymbol`, `MarkableLeg`, `OptionQuote`, `CloseEstimate` from `@tj/core` (Task 1); `GET /api/option-quotes` (Task 7).
- Produces:
  - `apps/web/src/market.ts`:
    - `todayNy(): string`
    - `isOpen(trade: { legs: { closePrice: number | null }[] }): boolean`
    - `openContracts(trade: { underlying: string; legs: MarkableLeg[] }, today: string): string[]`
    - `useQuotes(symbols: string[])` (moved from `Journal.tsx`, unchanged)
    - `useOptionQuotes(contracts: string[])`, whose query data is `Map<string, OptionQuote>`
  - `apps/web/src/components/Estimate.tsx`:
    - `ESTIMATE_STYLE`
    - `signedUsd(value: number): string`
    - `quotedAtText(at: number): string`
    - `estimateTitle(estimate: Extract<CloseEstimate, { kind: "estimate" }>): string`
    - `EstimatedPnl({ estimate, testId? })`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/routes/Journal.test.tsx`, replace `StubbedApi`, `stubApi` and `quoteUrls` with:

```ts
interface StubbedApi {
  trades?: unknown[];
  /** Live prices by symbol, or an HTTP status for a failed call. */
  quotes?: Record<string, { price: number; at: number }> | number;
  /** Bid and ask by contract code. */
  optionQuotes?: Record<string, { bid: number | null; ask: number | null; at: number }>;
}

/** Answers the calls the journal makes: its trades, live prices, and option quotes for open trades. */
function stubApi({ trades = [trade], quotes = {}, optionQuotes = {} }: StubbedApi = {}) {
  // Typed parameters so the recorded call arguments can be inspected.
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/option-quotes")) return jsonResponse({ quotes: optionQuotes });
    if (!url.includes("/api/quotes")) return jsonResponse(trades);
    return typeof quotes === "number" ? new Response("down", { status: quotes }) : jsonResponse({ quotes });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const urlsFor = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes(path));
const quoteUrls = (fetchMock: ReturnType<typeof stubApi>) => urlsFor(fetchMock, "/api/quotes");
const optionQuoteUrls = (fetchMock: ReturnType<typeof stubApi>) => urlsFor(fetchMock, "/api/option-quotes");

const openLeg = (id: string, right: "C" | "P", strike: number, quantity: number, openPrice: number) => ({
  id,
  right,
  strike,
  expiry: "2099-10-02", // far ahead, so the trade is open whenever the test runs
  quantity,
  multiplier: 100,
  openPrice,
  closePrice: null,
});

/** The open M fly from the design mockup: 3 lots, body 22.5, wings 20 / 26, $7.80 entry fees. */
const openTrade = {
  ...trade,
  id: "t2",
  underlying: "M",
  closedAt: null,
  netPnl: null,
  fees: 7.8,
  feesOpen: 7.8,
  feesClose: 0,
  metrics: null,
  legs: [
    openLeg("l1", "C", 22.5, -3, 0.52),
    openLeg("l2", "P", 22.5, -3, 0.41),
    openLeg("l3", "C", 26, 3, 0.05),
    openLeg("l4", "P", 20, 3, 0.03),
  ],
};

const QUOTED = Date.UTC(2026, 8, 25, 19, 59, 51);
const markQuotes = {
  M991002C00022500: { bid: 0.44, ask: 0.58, at: QUOTED },
  M991002P00022500: { bid: 0.31, ask: 0.42, at: QUOTED },
  M991002C00026000: { bid: 0.01, ask: 0.06, at: QUOTED },
  M991002P00020000: { bid: 0.01, ask: 0.05, at: QUOTED },
};
```

and add these tests at the end of the `describe`:

```ts
  it("shows an open trade's estimated cost to close, muted, with when and how on hover", async () => {
    stubApi({ trades: [trade, openTrade], optionQuotes: markQuotes });
    renderJournal();
    const estimate = await screen.findByText("est -$46.80");
    expect(estimate.className).toContain("italic");
    expect(estimate.className).not.toMatch(/text-(up|down)/);
    expect(estimate.getAttribute("title")).toContain("Sep 25, 03:59 PM ET");
    expect(estimate.getAttribute("title")).toContain("Not saved");
    // The closed trade keeps its real P&L.
    expect(screen.getByText("+$512.00")).toBeTruthy();
  });

  it("asks once for the open legs of open trades only", async () => {
    const fetchMock = stubApi({ trades: [trade, openTrade], optionQuotes: markQuotes });
    renderJournal();
    await screen.findByText("est -$46.80");
    expect(optionQuoteUrls(fetchMock)).toHaveLength(1);
    const url = new URL(optionQuoteUrls(fetchMock)[0] ?? "", "http://localhost");
    expect(url.searchParams.get("contracts")?.split(",").sort()).toEqual(Object.keys(markQuotes).sort());
  });

  it("flags an open trade past its expiry instead of estimating it", async () => {
    const expired = { ...openTrade, legs: openTrade.legs.map((leg) => ({ ...leg, expiry: "2020-01-17" })) };
    const fetchMock = stubApi({ trades: [expired] });
    renderJournal();
    expect(await screen.findByText("EXPIRED · add exits")).toBeTruthy();
    expect(optionQuoteUrls(fetchMock)).toHaveLength(0);
  });

  it("shows a dash, with the reason on hover, when an open trade has no quotes", async () => {
    const fetchMock = stubApi({ trades: [openTrade] });
    renderJournal();
    await waitFor(() => expect(optionQuoteUrls(fetchMock)).toHaveLength(1));
    const cell = await screen.findByTestId("est-t2");
    expect(cell.textContent).toBe("—");
    expect(cell.getAttribute("title")).toBe("No estimate: no quote for the short call.");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/Journal.test.tsx`
Expected: FAIL. The four new tests fail: there is no `est -$46.80`, no option-quote call, no expired chip and no `est-t2` cell. The existing tests still pass.

- [ ] **Step 3: Write the shared market helpers and the estimate display**

Create `apps/web/src/market.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { type MarkableLeg, nyDate, type OptionQuote, occSymbol } from "@tj/core";
import { api } from "./api.js";

/** Today's date in New York, where options expire. */
export const todayNy = () => nyDate(Date.now());

/** A trade is open while any leg lacks an exit price (spec §7.1). */
export const isOpen = (trade: { legs: { closePrice: number | null }[] }) =>
  trade.legs.some((leg) => leg.closePrice == null);

/** Contract codes of a trade's open, unexpired legs: the only ones worth a quote. */
export function openContracts(trade: { underlying: string; legs: MarkableLeg[] }, today: string): string[] {
  return trade.legs
    .filter((leg) => leg.closePrice == null && leg.expiry >= today)
    .map((leg) => occSymbol({ underlying: trade.underlying, ...leg }));
}

/** Live reference prices, refreshed each minute and never stored. None at all without a data key. */
export function useQuotes(symbols: string[]) {
  const unique = [...new Set(symbols)].sort();
  return useQuery({
    queryKey: ["quotes", unique],
    queryFn: async () => {
      const res = await api.api.quotes.$get({ query: { symbols: unique.join(",") } });
      if (!res.ok) throw new Error(`quotes failed: ${res.status}`);
      return (await res.json()).quotes;
    },
    enabled: unique.length > 0,
    refetchInterval: 60_000,
  });
}

/** Bid and ask per contract, refreshed each minute and never stored. Empty without a data key. */
export function useOptionQuotes(contracts: string[]) {
  const unique = [...new Set(contracts)].sort();
  return useQuery({
    queryKey: ["option-quotes", unique],
    queryFn: async (): Promise<Map<string, OptionQuote>> => {
      const res = await api.api["option-quotes"].$get({ query: { contracts: unique.join(",") } });
      if (!res.ok) throw new Error(`option quotes failed: ${res.status}`);
      return new Map(Object.entries((await res.json()).quotes));
    },
    enabled: unique.length > 0,
    refetchInterval: 60_000,
  });
}
```

Create `apps/web/src/components/Estimate.tsx`:

```tsx
import type { CloseEstimate } from "@tj/core";
import { Chip } from "./ui.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Muted italics and no colour: an estimate must never look like a result. */
export const ESTIMATE_STYLE = "num italic text-[#8a91a3]";

/** "+$12.00" / "-$46.80". The sign is spelled out because estimates carry no colour. */
export const signedUsd = (value: number) => (value > 0 ? `+${usd(value)}` : usd(value));

export const quotedAtText = (at: number) => `${ET.format(new Date(at))} ET`;

export function estimateTitle(estimate: Extract<CloseEstimate, { kind: "estimate" }>): string {
  return `Estimated cost to close, from quotes at ${quotedAtText(estimate.quotedAt)} (indicative feed), after the fees entered so far. Not saved.`;
}

/** An open trade's estimated P&L, or why there is none. */
export function EstimatedPnl({ estimate, testId }: { estimate: CloseEstimate; testId?: string }) {
  switch (estimate.kind) {
    case "estimate":
      return (
        <span data-testid={testId} className={ESTIMATE_STYLE} title={estimateTitle(estimate)}>
          est {signedUsd(estimate.netPnl)}
        </span>
      );
    case "expired":
      return <Chip>EXPIRED · add exits</Chip>;
    case "unavailable":
      return (
        <span data-testid={testId} className="num text-muted" title={`No estimate: ${estimate.reason}.`}>
          —
        </span>
      );
    default:
      return (
        <span data-testid={testId} className="num text-muted">
          —
        </span>
      );
  }
}
```

- [ ] **Step 4: Show the estimates in the list**

In `apps/web/src/routes/Journal.tsx`:

1. Delete the `useQuotes` function and its doc comment. It now lives in `market.ts`.
2. Replace the imports with:

```tsx
import { useQuery } from "@tanstack/react-query";
import { closeEstimate, type OptionQuote } from "@tj/core";
import { useState } from "react";
import { api, type TradeView } from "../api.js";
import { EstimatedPnl } from "../components/Estimate.js";
import { Chip, Money, Panel, Pct } from "../components/ui.js";
import { isOpen, openContracts, todayNy, useOptionQuotes, useQuotes } from "../market.js";
```

3. Below the `PRICE` constant, add:

```tsx
const NO_QUOTES = new Map<string, OptionQuote>();
```

4. In `Journal`, after the `useQuotes` line, add:

```tsx
  const today = todayNy();
  // One call for the open legs of every open trade on screen; the server splits it for Alpaca.
  const { data: optionQuotes } = useOptionQuotes(
    data?.filter(isOpen).flatMap((trade) => openContracts(trade, today)) ?? [],
  );
```

5. Replace the Net P&L cell:

```tsx
                <td className="text-right">
                  <Money value={trade.netPnl} />
                </td>
```

with:

```tsx
                <td className="text-right">
                  {isOpen(trade) ? (
                    <EstimatedPnl
                      estimate={closeEstimate(trade, optionQuotes ?? NO_QUOTES, today)}
                      testId={`est-${trade.id}`}
                    />
                  ) : (
                    <Money value={trade.netPnl} />
                  )}
                </td>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web/src/routes/Journal.test.tsx`
Expected: PASS (all Journal tests, including the 4 new ones).

- [ ] **Step 6: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/market.ts apps/web/src/components/Estimate.tsx apps/web/src/routes/Journal.tsx apps/web/src/routes/Journal.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): estimated P&L for open trades in the trade lists

What closing each open trade would realise right now, in muted italics
with the quote time on hover, refreshed each minute and never stored.
A trade past its expiry asks for its exits instead.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Marks on the trade page

**Files:**
- Modify: `apps/web/src/routes/TradeDetail.tsx`
- Modify: `apps/web/src/routes/TradeDetail.test.tsx`

**Interfaces:**
- Consumes: `closeEstimate`, `OptionQuote` (Task 1); `isOpen`, `openContracts`, `todayNy`, `useOptionQuotes` from `../market.js`, and `EstimatedPnl`, `ESTIMATE_STYLE`, `signedUsd`, `quotedAtText` from `../components/Estimate.js` (Task 9).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/routes/TradeDetail.test.tsx`, add after `jsonResponse`:

```ts
/** The sample fly while still open: no exits yet, expiring far ahead so it is open whenever the test runs. */
const openTrade = {
  ...trade,
  closedAt: null,
  netPnl: null,
  feesOpen: 5,
  feesClose: 0,
  legs: trade.legs.map((leg) => ({ ...leg, expiry: "2099-10-16", closePrice: null })),
  metrics: { ...trade.metrics, returnOnRisk: null, pctOfMaxProfit: null, pnlPctOfCost: null },
};

const QUOTED = Date.UTC(2026, 8, 25, 19, 59, 51);
const openQuotes = {
  XYZ991016C00050000: { bid: 1.0, ask: 1.2, at: QUOTED },
  XYZ991016P00050000: { bid: 0.7, ask: 0.9, at: QUOTED },
  XYZ991016C00058000: { bid: 0.1, ask: 0.15, at: QUOTED },
  XYZ991016P00045000: { bid: 0.05, ask: 0.1, at: QUOTED },
};

/** Answers the trade for its own URL and the given quotes for option quotes. */
function stubTrade(body: unknown, quotes: Record<string, unknown> = openQuotes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const payload = String(input).includes("/api/option-quotes") ? { quotes } : body;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
```

and add these tests at the end of the `describe`:

```ts
  it("marks each open leg at its cost to close and estimates the trade", async () => {
    stubTrade(openTrade);
    renderDetail();
    // Short call +360, short put +280, long call -100, long put -120, less $5 entry fees.
    await waitFor(() => expect(screen.getByTestId("header-estimate").textContent).toBe("est +$415.00"));
    const shortCall = screen.getByTestId("leg-row-l1");
    expect(shortCall.textContent).toContain("1.20 ask");
    expect(shortCall.textContent).toContain("+$360.00");
    expect(screen.getByTestId("leg-row-l4").textContent).toContain("0.05 bid");
    const note = screen.getByTestId("estimate-note").textContent;
    expect(note).toContain("+$420.00 before fees");
    expect(note).toContain("+$415.00 after the $5.00 fees entered so far");
    expect(note).toContain("Sep 25, 03:59 PM ET");
    expect(note).toContain("never saved");
  });

  it("flags an open trade past its expiry", async () => {
    stubTrade({ ...openTrade, legs: openTrade.legs.map((leg) => ({ ...leg, expiry: "2020-01-17" })) });
    renderDetail();
    expect(await screen.findByText("EXPIRED · add exits")).toBeTruthy();
  });

  it("says why marks are missing", async () => {
    stubTrade(openTrade, {});
    renderDetail();
    expect(await screen.findByText("Marks unavailable: no quote for the short call.")).toBeTruthy();
  });

  it("adds no mark columns to a closed trade and asks for no quotes", async () => {
    const fetchMock = stubTrade(trade);
    renderDetail();
    await screen.findByText("XYZ Industries");
    expect(screen.queryByText("Mark (to close)")).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/option-quotes"))).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/TradeDetail.test.tsx`
Expected: FAIL. The first three new tests fail (no `header-estimate`, no expired chip, no "Marks unavailable"); the fourth passes already.

- [ ] **Step 3: Show the marks**

In `apps/web/src/routes/TradeDetail.tsx`:

1. Replace the `@tj/core` import and add two imports:

```tsx
import { closeEstimate, type OptionQuote, round2 } from "@tj/core";
```

```tsx
import { ESTIMATE_STYLE, EstimatedPnl, quotedAtText, signedUsd } from "../components/Estimate.js";
import { isOpen, openContracts, todayNy, useOptionQuotes } from "../market.js";
```

2. Below the `ET` formatter, add:

```tsx
const NO_QUOTES = new Map<string, OptionQuote>();
```

3. In `TradeDetail`, before `if (isLoading || !trade) return …` (hooks must run on every render), add:

```tsx
  const today = todayNy();
  const { data: optionQuotes } = useOptionQuotes(trade && isOpen(trade) ? openContracts(trade, today) : []);
```

4. After `const detail = trade.ironFly;`, add:

```tsx
  // What closing now would realise; shown, never stored (spec §9).
  const estimate = isOpen(trade) ? closeEstimate(trade, optionQuotes ?? NO_QUOTES, today) : null;
  const markOf = (index: number) =>
    estimate?.kind === "estimate" ? estimate.legs.find((marked) => marked.index === index) : undefined;
```

5. In the header, replace:

```tsx
        <span className="ml-auto text-[18px]">
          <Money value={trade.netPnl} />
        </span>
```

with:

```tsx
        <span className="ml-auto text-[18px]">
          {estimate ? <EstimatedPnl estimate={estimate} testId="header-estimate" /> : <Money value={trade.netPnl} />}
        </span>
```

6. In the legs table header row, after the `P&amp;L` header cell, add:

```tsx
                {estimate && (
                  <>
                    <th className="text-right font-medium">Mark (to close)</th>
                    <th className="text-right font-medium">Est. P&amp;L</th>
                  </>
                )}
```

7. Replace the whole `{trade.legs.map((leg) => ( … ))}` block with this version, which finds each row's mark. The first nine cells are the existing ones, unchanged:

```tsx
              {trade.legs.map((leg, index) => {
                const mark = markOf(index);
                return (
                  <tr key={leg.id} data-testid={`leg-row-${leg.id}`} className="border-line border-t">
                    <td className={leg.quantity < 0 ? "text-down" : "text-up"}>
                      {leg.quantity < 0 ? "SHORT" : "LONG"}
                    </td>
                    <td>{leg.right === "C" ? "Call" : "Put"}</td>
                    <td>{leg.strike.toFixed(2)}</td>
                    <td>{leg.expiry.slice(5)}</td>
                    <td className="text-right">{leg.quantity}</td>
                    <td className="text-right">{leg.openPrice.toFixed(2)}</td>
                    <td className="text-right">{leg.closePrice?.toFixed(2) ?? "—"}</td>
                    <td className="text-right">
                      <Money value={legCost(leg)} />
                    </td>
                    <td className="text-right">
                      <Money value={legPnl(leg)} />
                    </td>
                    {estimate && (
                      <>
                        <td className={`text-right ${ESTIMATE_STYLE}`}>
                          {mark ? `${mark.mark.toFixed(2)} ${mark.side}` : "—"}
                        </td>
                        <td className={`text-right ${ESTIMATE_STYLE}`}>{mark ? signedUsd(mark.pnl) : "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
```

8. Directly after the closing `</table>` of the legs table, add:

```tsx
          {estimate?.kind === "estimate" && (
            <p data-testid="estimate-note" className="mt-2 text-[10px] text-muted">
              Estimate {signedUsd(estimate.grossPnl)} before fees, {signedUsd(estimate.netPnl)} after the{" "}
              {usd(estimate.fees)} fees entered so far (exit fees not included). Quotes as of{" "}
              {quotedAtText(estimate.quotedAt)} · indicative feed · refreshes every minute · never saved.
            </p>
          )}
          {estimate?.kind === "unavailable" && (
            <p className="mt-2 text-[10px] text-muted">Marks unavailable: {estimate.reason}.</p>
          )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web/src/routes/TradeDetail.test.tsx`
Expected: PASS (all trade page tests, 4 new).

- [ ] **Step 5: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/routes/TradeDetail.tsx apps/web/src/routes/TradeDetail.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): marks and an estimated P&L on an open trade's page

Each open leg shows its cost to close (the ask for shorts, the bid for
longs) and what it would realise, with a note giving the fees, the quote
time and that nothing is saved.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---
### Task 11: Expiry and strike dropdowns in the builder

**Files:**
- Create: `apps/web/src/routes/ChainPickers.tsx`
- Modify: `apps/web/src/market.ts`
- Modify: `apps/web/src/routes/IronFlyForm.tsx`
- Modify: `apps/web/src/routes/IronFlyForm.test.tsx`
- Modify: `apps/web/src/routes/NewIronFly.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/chains/:symbol` (Task 7): `{ symbol, expirations: { date, expired, strikes }[], unavailable: { reason, message } | null }`
  - `useQuotes` and `todayNy` (Task 9)
- Produces:
  - `market.ts`:
    - `TICKER`
    - `useSettled<T>(value: T, ms?: number): T`
    - `useChain(symbol: string, since: string | undefined)`, whose query data is the route's body
  - `ChainPickers.tsx`:
    - `interface Expiration { date: string; expired: boolean; strikes: number[] }`
    - `expiryLabel(expiration, from): string`
    - `nearestStrike(strikes, price): number | null`
    - `ExpirySelect({ value, expirations, from, onChange })`
    - `StrikeSelect({ label, value, strikes, atm, onChange })`
  - `IronFlyForm` requires an expiry to save, and no longer sends `2100-01-01`.
  - `IronFlyForm.test.tsx` test helpers, reused by Task 12:
    - `stubApi(stub)`, where `stub` is `{ chain?, quotes?, optionQuotes?, companies? }`
    - `setup(initial?, stub?)`, which returns `{ onSubmit, fetchMock }`
    - `M_CHAIN`, `priceFromTheChain()`, `value(label)`

- [ ] **Step 1: Wrap the form tests in a query client and a stubbed API**

The form now asks the server for chains, so every test needs a `QueryClientProvider` and a stubbed `fetch`. In `apps/web/src/routes/IronFlyForm.test.tsx`, replace the imports and the `setup` function with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IronFlyForm, type IronFlyFormValues } from "./IronFlyForm.js";
```

```tsx
const NO_KEY = {
  symbol: "XYZ",
  expirations: [],
  unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to pick from the chain." },
};

interface Stub {
  /** The body /api/chains answers with. */
  chain?: unknown;
  /** Stock prices by symbol. */
  quotes?: Record<string, { price: number; at: number }>;
  /** Bid and ask by contract code. */
  optionQuotes?: Record<string, { bid: number | null; ask: number | null; at: number }>;
  /** Company names by symbol. */
  companies?: Record<string, string>;
}

/** Answers the market-data calls the builder makes. Without a chain it behaves as if no key were set up. */
function stubApi({ chain = NO_KEY, quotes = {}, optionQuotes = {}, companies = {} }: Stub = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    let body: unknown = {};
    if (path.startsWith("/api/chains/")) body = chain;
    else if (path === "/api/option-quotes") body = { quotes: optionQuotes };
    else if (path === "/api/quotes") body = { quotes };
    else if (path.startsWith("/api/company/")) body = { name: companies[path.slice("/api/company/".length)] ?? null };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setup(initial?: Partial<IronFlyFormValues>, stub?: Stub) {
  const fetchMock = stubApi(stub);
  const onSubmit = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IronFlyForm initial={initial} submitLabel="Save trade" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return { onSubmit, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());
```

Run: `pnpm vitest run apps/web/src/routes/IronFlyForm.test.tsx`
Expected: PASS. The existing tests don't depend on the chain yet.

- [ ] **Step 2: Write the failing tests**

Add to `apps/web/src/routes/IronFlyForm.test.tsx`, above the `describe`:

```tsx
/** M's chain for two far-off Fridays, so the tests never go stale. */
const M_CHAIN = {
  symbol: "M",
  expirations: [
    { date: "2099-10-02", expired: false, strikes: [20, 21, 22, 22.5, 23, 26] },
    { date: "2099-10-09", expired: false, strikes: [20, 22, 23, 26] },
  ],
  unavailable: null,
};

const isSelect = (label: string) => screen.getByLabelText(label).tagName === "SELECT";
const options = (label: string) =>
  [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((option) => option.textContent);
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

/** The open M fly from the design mockup, built from the chain: 3 lots, body 22.5, wings 20 / 26. */
async function priceFromTheChain() {
  fill("Underlying", "M");
  await waitFor(() => expect(isSelect("Expiry")).toBe(true));
  fill("Expiry", "2099-10-02");
  for (const [leg, strike, entry] of [
    ["Short call", "22.5", "0.52"],
    ["Short put", "22.5", "0.41"],
    ["Long call", "26", "0.05"],
    ["Long put", "20", "0.03"],
  ] as const) {
    fill(`${leg} strike`, strike);
    fill(`${leg} size`, "3");
    fill(`${leg} entry`, entry);
  }
}
```

and add a second `describe` at the end of the file:

```tsx
describe("IronFlyForm with an option chain", () => {
  it("turns expiry and strikes into lists of what is listed", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    expect(options("Expiry")[1]).toMatch(/^Oct 2 · Fri · \d+d$/);
    fill("Expiry", "2099-10-02");
    expect(options("Short call strike")).toEqual(["—", "20", "21", "22", "22.5", "23", "26"]);
  });

  it("saves a 1-wing trade when a long leg's strike is left blank", async () => {
    const { onSubmit } = setup(undefined, { chain: M_CHAIN });
    await priceFromTheChain();
    for (const field of ["strike", "size", "entry"]) fill(`Long put ${field}`, "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs).toHaveLength(3);
    expect(payload.legs[0].expiry).toBe("2099-10-02");
    expect(payload.ironFly.putWingStrike).toBe(0);
  });

  it("keeps the strikes a new expiry lists and clears the rest, saying which", async () => {
    setup(undefined, { chain: M_CHAIN });
    await priceFromTheChain();
    fill("Expiry", "2099-10-09");
    expect(value("Short call strike")).toBe("");
    expect(value("Short put strike")).toBe("");
    expect(value("Long call strike")).toBe("26");
    expect(value("Long put strike")).toBe("20");
    expect(screen.getByText("Cleared strikes not listed for 2099-10-09: short call, short put.")).toBeTruthy();
  });

  it("keeps a saved strike the chain does not list, marked not listed, and saves it unchanged", async () => {
    const { onSubmit } = setup(
      {
        underlying: "M",
        expiry: "2099-10-02",
        legs: {
          shortCall: { strike: "22.25", size: "3", entry: "0.52", exit: "" },
          shortPut: { strike: "22.25", size: "3", entry: "0.41", exit: "" },
          longCall: { strike: "26", size: "3", entry: "0.05", exit: "" },
          longPut: { strike: "20", size: "3", entry: "0.03", exit: "" },
        },
      },
      { chain: M_CHAIN },
    );
    await waitFor(() => expect(isSelect("Short call strike")).toBe(true));
    const select = screen.getByLabelText("Short call strike") as HTMLSelectElement;
    expect(select.value).toBe("22.25");
    expect(select.selectedOptions[0]?.textContent).toBe("22.25 · not listed");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit.mock.calls[0]?.[0].legs[0].strike).toBe(22.25);
  });

  it("keeps an expiry typed before the chain arrived", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    fill("Expiry", "2099-10-09");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    expect(value("Expiry")).toBe("2099-10-09");
  });

  it("falls back to typing, with the reason, when there is no chain", async () => {
    setup(undefined, { chain: NO_KEY });
    fill("Underlying", "M");
    expect(await screen.findByText("Add an Alpaca key in Settings to pick from the chain.")).toBeTruthy();
    expect(isSelect("Expiry")).toBe(false);
  });

  it("switches to typing on request, and back", async () => {
    setup(undefined, { chain: M_CHAIN });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "type instead" }));
    expect(isSelect("Expiry")).toBe(false);
    expect(isSelect("Short call strike")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "pick from the chain" }));
    expect(isSelect("Expiry")).toBe(true);
  });

  it("labels the strike nearest the stock's price for a trade opened today", async () => {
    setup(undefined, { chain: M_CHAIN, quotes: { M: { price: 22.64, at: Date.UTC(2026, 8, 25, 19, 59) } } });
    fill("Underlying", "M");
    await waitFor(() => expect(isSelect("Expiry")).toBe(true));
    fill("Expiry", "2099-10-02");
    await waitFor(() => expect(options("Short call strike")).toContain("22.5 (ATM)"));
  });

  it("refuses to save without an expiry", () => {
    const { onSubmit } = setup();
    priceTheSampleFly();
    fill("Expiry", "");
    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("An expiry is required.")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/IronFlyForm.test.tsx`
Expected: FAIL. The new tests fail: Expiry never becomes a `SELECT`, and a blank expiry is saved as `2100-01-01`.

- [ ] **Step 4: Add the chain hooks**

Add to `apps/web/src/market.ts` (merge the `react` import with the existing ones):

```ts
import { useEffect, useState } from "react";
```

```ts
/** A plain ticker such as M or BRK.B, the only thing worth asking the server about. */
export const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/** `value` once it has stopped changing for `ms`, so typing a symbol doesn't ask the server on every key. */
export function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The listed expirations and strikes for a symbol, back to `since` for a trade opened in the past. */
export function useChain(symbol: string, since: string | undefined) {
  return useQuery({
    queryKey: ["chain", symbol, since ?? ""],
    queryFn: async () => {
      const res = await api.api.chains[":symbol"].$get({ param: { symbol }, query: { since } });
      if (!res.ok) throw new Error(`chain failed: ${res.status}`);
      return res.json();
    },
    enabled: TICKER.test(symbol),
    staleTime: 15 * 60_000,
  });
}
```

- [ ] **Step 5: Write the pickers**

Create `apps/web/src/routes/ChainPickers.tsx`:

```tsx
export interface Expiration {
  date: string;
  expired: boolean;
  strikes: number[];
}

const DAY = 86_400_000;
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** "Oct 2 · Fri · 6d", counting days from `from` (the open date); "… · expired" once it has passed. */
export function expiryLabel(expiration: Expiration, from: string): string {
  const at = new Date(midnight(expiration.date));
  const days = Math.round((midnight(expiration.date) - midnight(from)) / DAY);
  return `${MONTH_DAY.format(at)} · ${WEEKDAY.format(at)} · ${expiration.expired ? "expired" : `${days}d`}`;
}

/** The listed strike closest to the stock's price, for the (ATM) hint. */
export function nearestStrike(strikes: number[], price: number | undefined): number | null {
  if (price === undefined || strikes.length === 0) return null;
  return strikes.reduce((best, strike) => (Math.abs(strike - price) < Math.abs(best - price) ? strike : best));
}

const SELECT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg outline-none focus:border-accent disabled:opacity-50";

/** A value the chain doesn't list stays selectable and says so, so nothing is silently dropped. */
function NotListed({ value, listed }: { value: string; listed: boolean }) {
  return value && !listed ? <option value={value}>{value} · not listed</option> : null;
}

export function ExpirySelect({
  value,
  expirations,
  from,
  onChange,
}: {
  value: string;
  expirations: Expiration[];
  from: string;
  onChange: (value: string) => void;
}) {
  return (
    <select aria-label="Expiry" value={value} onChange={(event) => onChange(event.target.value)} className={SELECT}>
      <option value="">—</option>
      <NotListed value={value} listed={expirations.some((expiration) => expiration.date === value)} />
      {expirations.map((expiration) => (
        <option key={expiration.date} value={expiration.date}>
          {expiryLabel(expiration, from)}
        </option>
      ))}
    </select>
  );
}

export function StrikeSelect({
  label,
  value,
  strikes,
  atm,
  onChange,
}: {
  label: string;
  value: string;
  strikes: number[];
  atm: number | null;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={strikes.length === 0 && !value}
      className={`${SELECT} w-full text-right`}
    >
      {/* Blank: no strike yet, or, on a long leg, no wing at all (a 1-wing trade). */}
      <option value="">—</option>
      <NotListed value={value} listed={strikes.some((strike) => String(strike) === value)} />
      {strikes.map((strike) => (
        <option key={strike} value={String(strike)}>
          {strike === atm ? `${strike} (ATM)` : String(strike)}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 6: Use them in the builder**

In `apps/web/src/routes/IronFlyForm.tsx`:

1. Add imports:

```tsx
import { todayNy, useChain, useQuotes, useSettled } from "../market.js";
import { ExpirySelect, nearestStrike, StrikeSelect } from "./ChainPickers.js";
```

2. Below `type LegKey = …`, add:

```tsx
const FIELD_LABEL = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
```

3. In `IronFlyForm`, after the `problem` state, add:

```tsx
  /** The user chose to type the expiry and strikes although a chain is available. */
  const [typed, setTyped] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
```

4. Replace `setLeg` with a value setter plus the event adapter:

```tsx
  const setLegValue = (key: LegKey, field: keyof LegFields, value: string) =>
    setValues((current) => ({
      ...current,
      legs: { ...current.legs, [key]: { ...current.legs[key], [field]: value } },
    }));

  const setLeg = (key: LegKey, field: keyof LegFields) => (event: { target: { value: string } }) =>
    setLegValue(key, field, event.target.value);

  // The chain from the open date on, so an old trade can still pick its expired contracts (spec §8).
  const symbol = useSettled(values.underlying.trim().toUpperCase());
  const today = todayNy();
  const openedOn = values.openedAt ? values.openedAt.slice(0, 10) : today;
  const chain = useChain(symbol, openedOn < today ? openedOn : undefined);
  const expirations = chain.data?.expirations ?? [];
  const pickers = !typed && expirations.length > 0;
  const strikes = expirations.find((expiration) => expiration.date === values.expiry)?.strikes ?? [];
  const { data: stockQuotes } = useQuotes(pickers && openedOn === today ? [symbol] : []);
  const atm = nearestStrike(strikes, stockQuotes?.[symbol]?.price);

  /** Switching expiry keeps the strikes it lists and clears the others, naming them. */
  function pickExpiry(expiry: string) {
    const listed = new Set(
      (expirations.find((expiration) => expiration.date === expiry)?.strikes ?? []).map(String),
    );
    const dropped = expiry
      ? LEG_ROLES.filter((role) => {
          const strike = values.legs[role.key].strike;
          return strike !== "" && !listed.has(strike);
        })
      : [];
    setValues((current) => {
      const legs = { ...current.legs };
      for (const role of dropped) legs[role.key] = { ...legs[role.key], strike: "" };
      return { ...current, expiry, legs };
    });
    setCleared(
      dropped.length > 0
        ? `Cleared strikes not listed for ${expiry}: ${dropped.map((role) => role.label.toLowerCase()).join(", ")}.`
        : null,
    );
  }
```

5. In `submit()`, directly after the `if (!derived?.structure) { … }` block, add:

```tsx
    if (!values.expiry) {
      setProblem("An expiry is required.");
      return;
    }
```

and change the leg payload's expiry from `values.expiry || "2100-01-01"` to:

```tsx
        expiry: values.expiry,
```

6. In the Trade panel grid, replace `{input("Expiry", values.expiry, set("expiry"), "date")}` with:

```tsx
            {pickers ? (
              <div className="flex flex-col gap-1">
                <label className={FIELD_LABEL}>
                  Expiry
                  <ExpirySelect
                    value={values.expiry}
                    expirations={expirations}
                    from={openedOn}
                    onChange={pickExpiry}
                  />
                </label>
                <button type="button" onClick={() => setTyped(true)} className="self-start text-[10px] text-accent">
                  type instead
                </button>
              </div>
            ) : (
              input("Expiry", values.expiry, set("expiry"), "date")
            )}
```

and after the grid's closing `</div>`, still inside the Trade panel, add:

```tsx
          {!typed && chain.data?.unavailable && (
            <p className="mt-2 text-[10px] text-muted">{chain.data.unavailable.message}</p>
          )}
          {typed && expirations.length > 0 && (
            <p className="mt-2 text-[10px] text-muted">
              Typing the expiry and strikes.{" "}
              <button type="button" onClick={() => setTyped(false)} className="text-accent">
                pick from the chain
              </button>
            </p>
          )}
          {pickers && cleared && <p className="mt-2 text-[10px] text-muted">{cleared}</p>}
```

7. In the Position table, replace the strike cell `<td className="px-1">{legInput(role.key, `${role.label} strike`, "strike")}</td>` with:

```tsx
                    <td className="px-1">
                      {pickers ? (
                        <StrikeSelect
                          label={`${role.label} strike`}
                          value={values.legs[role.key].strike}
                          strikes={strikes}
                          atm={atm}
                          onChange={(strike) => setLegValue(role.key, "strike", strike)}
                        />
                      ) : (
                        legInput(role.key, `${role.label} strike`, "strike")
                      )}
                    </td>
```

- [ ] **Step 7: Find the POST by method in the NewIronFly test**

The builder now makes market-data calls too, so the first recorded call is no longer guaranteed to be the save. In `apps/web/src/routes/NewIronFly.test.tsx`, replace:

```ts
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
```

with:

```ts
    const post = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS (all web tests, including the 9 new builder tests; NewIronFly and EditTrade unchanged in behaviour).

- [ ] **Step 9: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/market.ts apps/web/src/routes/ChainPickers.tsx apps/web/src/routes/IronFlyForm.tsx apps/web/src/routes/IronFlyForm.test.tsx apps/web/src/routes/NewIronFly.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): pick the expiry and strikes from the listed chain

The builder's Expiry and Strike fields become lists of what Alpaca
listed, back to the trade's open date. A saved value the chain doesn't
list is kept and flagged, and without a chain the fields fall back to
typing. An expiry is now required: the hidden 2100-01-01 placeholder
could never be marked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Company fill-in and mark hints in the builder

**Files:**
- Modify: `apps/web/src/market.ts`
- Modify: `apps/web/src/routes/IronFlyForm.tsx`
- Modify: `apps/web/src/routes/IronFlyForm.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/company/:symbol` (Task 7)
  - `closeEstimate`, `MarkableLeg`, `OptionQuote` (Task 1)
  - `openContracts`, `useOptionQuotes`, `useSettled`, `TICKER` (Tasks 9 and 11)
  - `ESTIMATE_STYLE`, `estimateTitle`, `signedUsd` (Task 9)
  - The test helpers from Task 11
- Produces: `useCompanyName(symbol: string)` in `market.ts`, whose query data is `string | null`.

- [ ] **Step 1: Write the failing tests**

Add to the `IronFlyForm with an option chain` describe in `apps/web/src/routes/IronFlyForm.test.tsx`:

```tsx
  it("fills Company from the symbol, and follows the symbol while the name is its own", async () => {
    setup(undefined, { companies: { M: "Macy's Inc.", NVDA: "NVIDIA Corporation" } });
    fill("Underlying", "M");
    await waitFor(() => expect(value("Company")).toBe("Macy's Inc."));
    fill("Underlying", "NVDA");
    await waitFor(() => expect(value("Company")).toBe("NVIDIA Corporation"));
  });

  it("never replaces a company name typed by hand", async () => {
    const { fetchMock } = setup(undefined, { companies: { M: "Macy's Inc." } });
    fill("Company", "Macy's");
    fill("Underlying", "M");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/company/M"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(value("Company")).toBe("Macy's");
  });

  it("shows each open leg's mark as a hint in its empty exit, and never saves it", async () => {
    const at = Date.UTC(2026, 8, 25, 19, 59, 51);
    const { onSubmit } = setup(undefined, {
      chain: M_CHAIN,
      optionQuotes: {
        M991002C00022500: { bid: 0.44, ask: 0.58, at },
        M991002P00022500: { bid: 0.31, ask: 0.42, at },
        M991002C00026000: { bid: 0.01, ask: 0.06, at },
        M991002P00020000: { bid: 0.01, ask: 0.05, at },
      },
    });
    await priceFromTheChain();
    fill("Entry fees", "7.80");
    await waitFor(() => expect(screen.getByLabelText("Short call exit").getAttribute("placeholder")).toBe("0.58"));
    expect(screen.getByLabelText("Long put exit").getAttribute("placeholder")).toBe("0.01");
    expect(screen.getByTestId("derived-estimate").textContent).toBe("est -$46.80");

    fireEvent.click(screen.getByRole("button", { name: /save trade/i }));
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload.legs.map((leg: { closePrice: number | null }) => leg.closePrice)).toEqual([null, null, null, null]);
    expect(payload.netPnl).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/IronFlyForm.test.tsx`
Expected: FAIL. Company stays empty, the exit placeholders are null, and there is no `derived-estimate`.

- [ ] **Step 3: Add the company hook**

Add to `apps/web/src/market.ts`:

```ts
/** The company's name from Alpaca, for filling in a blank Company field. Names don't change, so each is asked once. */
export function useCompanyName(symbol: string) {
  return useQuery({
    queryKey: ["company", symbol],
    queryFn: async () => {
      const res = await api.api.company[":symbol"].$get({ param: { symbol } });
      if (!res.ok) throw new Error(`company failed: ${res.status}`);
      return (await res.json()).name;
    },
    enabled: TICKER.test(symbol),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
```

- [ ] **Step 4: Fill Company and show the marks**

In `apps/web/src/routes/IronFlyForm.tsx`:

1. Update the imports:

```tsx
import {
  closeEstimate,
  ironFlyMetrics,
  ironFlyStructureFromLegs,
  type MarkableLeg,
  type OptionQuote,
  type PricedLeg,
  positionCash,
} from "@tj/core";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ESTIMATE_STYLE, estimateTitle, signedUsd } from "../components/Estimate.js";
import { Money, Panel } from "../components/ui.js";
import {
  openContracts,
  todayNy,
  useChain,
  useCompanyName,
  useOptionQuotes,
  useQuotes,
  useSettled,
} from "../market.js";
import { ExpirySelect, nearestStrike, StrikeSelect } from "./ChainPickers.js";
```

2. Below `FIELD_LABEL`, add:

```tsx
const NO_QUOTES = new Map<string, OptionQuote>();
```

3. After the `atm` line, add the company fill-in:

```tsx
  // Fill a blank Company from Alpaca, or replace a name this form filled in for another symbol.
  // A name typed by hand is never touched.
  const company = useCompanyName(symbol);
  const autoName = useRef<string | null>(null);
  useEffect(() => {
    const name = company.data;
    if (!name) return;
    const previous = autoName.current;
    autoName.current = name;
    setValues((current) =>
      current.underlyingName.trim() === "" || current.underlyingName === previous
        ? { ...current, underlyingName: name }
        : current,
    );
  }, [company.data]);
```

4. After the `derived` memo, add the marks:

```tsx
  // What closing the open legs now would realise: exit-field hints and a Derived row, never a value (spec §8).
  const markLegs = useMemo<MarkableLeg[]>(
    () =>
      values.expiry && derived
        ? derived.legs.map((leg) => ({
            right: leg.right,
            strike: leg.strike,
            expiry: values.expiry,
            quantity: leg.quantity,
            multiplier: leg.multiplier ?? 100,
            openPrice: leg.openPrice,
            closePrice: leg.closePrice ?? null,
          }))
        : [],
    [derived, values.expiry],
  );
  const markTrade = {
    underlying: symbol,
    legs: markLegs,
    fees: derived?.cash.fees ?? 0,
    feesOpen: zeroIfBlank(values.feesOpen),
    feesClose: zeroIfBlank(values.feesClose),
  };
  const { data: optionQuotes } = useOptionQuotes(openContracts(markTrade, today));
  const estimate = markLegs.length > 0 ? closeEstimate(markTrade, optionQuotes ?? NO_QUOTES, today) : null;
  const markFor = (role: (typeof LEG_ROLES)[number]) => {
    if (estimate?.kind !== "estimate") return undefined;
    const index = markLegs.findIndex((leg) => leg.right === role.right && leg.quantity < 0 === role.short);
    return estimate.legs.find((marked) => marked.index === index)?.mark.toFixed(2);
  };
```

5. Give `legInput` an optional placeholder, styled as a hint:

```tsx
  const legInput = (key: LegKey, label: string, field: keyof LegFields, placeholder?: string) => (
    <input
      aria-label={label}
      type="number"
      step={field === "size" ? "1" : "0.01"}
      min={field === "size" ? 1 : undefined}
      value={values.legs[key][field]}
      placeholder={placeholder}
      onChange={setLeg(key, field)}
      className="num w-full rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-right text-[13px] text-fg outline-none placeholder:text-[#4a5163] placeholder:italic focus:border-accent"
    />
  );
```

6. Pass each leg's mark to its exit field:

```tsx
                    <td className="px-1">{legInput(role.key, `${role.label} exit`, "exit", markFor(role))}</td>
```

7. In the Derived panel, after the `Net P&L` row, add:

```tsx
            {estimate?.kind === "estimate" && (
              <Row label="Est. P&L if closed now">
                <span data-testid="derived-estimate" className={ESTIMATE_STYLE} title={estimateTitle(estimate)}>
                  est {signedUsd(estimate.netPnl)}
                </span>
              </Row>
            )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS (all web tests, 3 new).

- [ ] **Step 6: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/market.ts apps/web/src/routes/IronFlyForm.tsx apps/web/src/routes/IronFlyForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): fill in the company, and hint each leg's mark in the builder

Company comes from Alpaca when it is blank and never overwrites a typed
name. An open leg's empty Exit shows what closing it would cost as a
placeholder, so it is seen but never saved.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: The Settings page

**Files:**
- Create: `apps/web/src/routes/Settings.tsx`
- Create: `apps/web/src/routes/Settings.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT` and `DELETE /api/settings/market-data` (Task 8).
- Produces: `Settings({ confirm? })` at `/settings`. `confirm` defaults to `window.confirm`, and tests pass their own.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/routes/Settings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings.js";

const DATA_DIR = "/home/t/.local/share/trading-journal";
const OFF = { state: "off", message: null, keyIdHint: null };
const ON = { state: "on", message: null, keyIdHint: "PK…7QXA" };
const view = (marketData: unknown) => ({ dataDir: DATA_DIR, marketData });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** GET answers `state.current`; PUT and DELETE answer `reply`, or move to `after` when it is a 200. */
function stubApi(initial: unknown, reply?: { status: number; body: unknown }) {
  const state = { current: view(initial) };
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") return json(state.current);
    if (!reply) throw new Error(`unexpected ${method}`);
    if (reply.status === 200) state.current = reply.body as ReturnType<typeof view>;
    return json(reply.body, reply.status);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string) =>
  fetchMock.mock.calls.filter((call) => String(call[1]?.method).toUpperCase() === method);

function renderSettings(confirm: (text: string) => boolean = () => true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Settings confirm={confirm} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Settings", () => {
  it("says market data is off and where the data lives", async () => {
    stubApi(OFF);
    renderSettings();
    expect(await screen.findByText("Not set up: live prices, chains and marks are off")).toBeTruthy();
    expect(screen.getByText(DATA_DIR)).toBeTruthy();
  });

  it("shows a saved key only as a hint, and hides what is typed as the secret", async () => {
    stubApi(ON);
    renderSettings();
    expect(await screen.findByText("Connected · key PK…7QXA · paper account")).toBeTruthy();
    const secret = screen.getByLabelText("Secret key") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
  });

  it("tests and saves a key, then shows the new status and clears the fields", async () => {
    const fetchMock = stubApi(OFF, { status: 200, body: view(ON) });
    renderSettings();
    await screen.findByText(/Not set up/);
    fireEvent.change(screen.getByLabelText("Key ID"), { target: { value: "PKTESTKEY7QXA" } });
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "test-secret-do-not-log" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    expect(await screen.findByText("Connected · key PK…7QXA · paper account")).toBeTruthy();
    const put = calls(fetchMock, "PUT")[0];
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ keyId: "PKTESTKEY7QXA", secretKey: "test-secret-do-not-log" });
    expect((screen.getByLabelText("Secret key") as HTMLInputElement).value).toBe("");
  });

  it("shows why a key was refused and keeps what was typed", async () => {
    const message =
      "Alpaca accepted this key for prices but not for option chains. It looks like a live-account key, so use your Paper account's key instead.";
    stubApi(OFF, { status: 400, body: { error: "not_paper", message } });
    renderSettings();
    await screen.findByText(/Not set up/);
    fireEvent.change(screen.getByLabelText("Key ID"), { target: { value: "AKLIVEKEY" } });
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "live-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect((screen.getByLabelText("Key ID") as HTMLInputElement).value).toBe("AKLIVEKEY");
  });

  it("asks before removing the key", async () => {
    const confirm = vi.fn(() => false);
    const fetchMock = stubApi(ON, { status: 200, body: view(OFF) });
    renderSettings(confirm);
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(confirm).toHaveBeenCalled();
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(await screen.findByText("Not set up: live prices, chains and marks are off")).toBeTruthy();
    expect(calls(fetchMock, "DELETE")).toHaveLength(1);
  });

  it("shows the message when Alpaca has rejected the saved key", async () => {
    stubApi({ state: "error", message: "Alpaca rejected the saved key. Save a new one below.", keyIdHint: "PK…7QXA" });
    renderSettings();
    expect(await screen.findByText("Alpaca rejected the saved key. Save a new one below.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/web/src/routes/Settings.test.tsx`
Expected: FAIL. The run reports that `./Settings.js` cannot be resolved.

- [ ] **Step 3: Write the page**

Create `apps/web/src/routes/Settings.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api.js";
import { Panel } from "../components/ui.js";

/** Everything that shows market data, refetched once a key changes. */
const MARKET_QUERIES = ["settings", "quotes", "option-quotes", "chain", "company"];

const FIELD = "flex flex-col gap-1 text-[10px] text-muted uppercase tracking-wider";
const INPUT =
  "num rounded-sm border border-line bg-[#0e1118] px-2 py-1 text-[13px] text-fg normal-case tracking-normal outline-none focus:border-accent";

/** The server explains a refusal in `message`; fall back to the status. */
async function refusal(res: { status: number; json(): Promise<unknown> }, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(body.message ?? `${action} failed: ${res.status}`);
}

export function Settings({ confirm = (text: string) => window.confirm(text) }: { confirm?: (text: string) => boolean }) {
  const queryClient = useQueryClient();
  const [keyId, setKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.api.settings.$get();
      if (!res.ok) throw new Error(`settings failed: ${res.status}`);
      return res.json();
    },
  });

  const refresh = () => Promise.all(MARKET_QUERIES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings["market-data"].$put({ json: { keyId, secretKey } });
      if (!res.ok) throw await refusal(res, "save");
    },
    onSuccess: async () => {
      setKeyId("");
      setSecretKey("");
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings["market-data"].$delete();
      if (!res.ok) throw await refusal(res, "remove");
    },
    onSuccess: refresh,
  });

  const market = data?.marketData;
  const status = !market
    ? "Loading…"
    : market.state === "on"
      ? `Connected · key ${market.keyIdHint} · paper account`
      : market.state === "error"
        ? (market.message ?? "Alpaca rejected the saved key.")
        : "Not set up: live prices, chains and marks are off";
  const dot = market?.state === "on" ? "bg-up" : market?.state === "error" ? "bg-down" : "bg-muted";

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Panel title="Market data · Alpaca">
        <p className="mb-2 flex items-center gap-2 rounded-sm border border-line bg-[#0e1118] px-2 py-1">
          <span className={`inline-block size-2 rounded-full ${dot}`} />
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
            Key ID
            <input
              aria-label="Key ID"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
              placeholder={market?.keyIdHint ? `${market.keyIdHint} (saved)` : "PK…"}
              autoComplete="off"
              className={INPUT}
            />
          </label>
          <label className={FIELD}>
            Secret key
            <input
              aria-label="Secret key"
              type="password"
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder={market?.keyIdHint ? "saved, never shown" : ""}
              autoComplete="new-password"
              className={INPUT}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending || !keyId.trim() || !secretKey.trim()}
              className="rounded-sm bg-accent px-3 py-1.5 text-white disabled:opacity-50"
            >
              {save.isPending ? "Testing…" : "Save and test"}
            </button>
            {market?.keyIdHint && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Remove the Alpaca key? Live prices, chains and marks will stop.")) remove.mutate();
                }}
                className="rounded-sm border border-line px-3 py-1.5 text-fg hover:border-accent"
              >
                Remove key
              </button>
            )}
          </div>
        </form>
        {save.error && <p className="mt-2 text-down">{save.error.message}</p>}
        {remove.error && <p className="mt-2 text-down">{remove.error.message}</p>}
        <p className="mt-3 text-[11px] text-muted">
          Use your <strong>Paper</strong> account's API keys: they're free and need no funding. The key is kept in
          secrets.json in the data directory below, readable only by you, and never in the repository or an
          export. It powers live prices, option chains and marks.
        </p>
      </Panel>
      <Panel title="Data">
        <p className="text-muted">
          Data directory <span className="num text-fg">{data?.dataDir}</span>
        </p>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 4: Route to it**

In `apps/web/src/router.tsx`, import the page:

```tsx
import { Settings } from "./routes/Settings.js";
```

add a route after `importRoute`:

```tsx
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <Settings />,
});
```

delete the `/settings` entry from `PLACEHOLDERS`, and add `settingsRoute` to the `rootRoute.addChildren([...])` list beside `importRoute`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web`
Expected: PASS (all web tests, 6 new).

- [ ] **Step 6: Run the full checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/web/src/routes/Settings.tsx apps/web/src/routes/Settings.test.tsx apps/web/src/router.tsx
git commit -m "$(cat <<'EOF'
feat(web): a Settings page for the Alpaca key

Save and test, or remove, the key without touching secrets.json by hand.
The page shows the key only as a hint, explains a refused key, and
lists the data directory.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Docs, a visual check and the live check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-trading-journal-design.md`
- Modify: `docs/superpowers/specs/2026-09-26-option-chains-and-live-marks-design.md` (§14, after the live check)
- Modify: `README.md`

**Interfaces:**
- Consumes: the whole feature.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update the parent spec**

In `docs/superpowers/specs/2026-09-22-trading-journal-design.md`, make four replacements.

§4: replace the `market-data/` line of the tree with:

```
│  └─ market-data/    Alpaca clients (prices, option chains and quotes); later the Massive adapter, rate-limited queue, bar cache
```

§5: replace the `secrets.json` bullet with:

```markdown
  - `secrets.json`: the Alpaca key (saved from Settings), IBKR Flex tokens and the Massive API key; file mode `0600` on Linux
```

§8.6: add this as the section's last bullet:

```markdown
- **Detailed design:** [2026-09-26-option-chains-and-live-marks-design.md](2026-09-26-option-chains-and-live-marks-design.md). Marks use the cost to close (shorts at the ask, longs at the bid), and chains need a paper-account key.
```

§16: replace item 3 with:

```markdown
3. **Alpaca:** resolved 2026-09-26 by the option chains spec, §3. Still open: how fresh indicative quotes are during a session (that spec, §14).
```

- [ ] **Step 2: Add a short README section**

In `README.md`, at the end of "Your data stays yours" (after the paragraph about the data directory), add:

```markdown
### Live prices and option chains (optional)

With a free [Alpaca](https://alpaca.markets) paper-account key, saved on the Settings
page, the journal shows each symbol's last price, lets the builder pick expiries and
strikes from the listed chain, and estimates what closing an open trade would realise.
Estimates are shown, never stored. Without a key everything else works as before.
```

- [ ] **Step 3: Run the full checks and commit the docs**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass. Note the test count for the PR description.

```bash
git add docs/superpowers/specs/2026-09-22-trading-journal-design.md README.md
git commit -m "$(cat <<'EOF'
docs: point the main spec and README at option chains and live marks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Visual check with a stand-in data source**

Use the recipe in the `visual-check-recipe` memory: a scratchpad `serve.ts` run with `apps/server/node_modules/.bin/tsx` against a `.backup()` copy of the real journal, on port 4199. Pass a `createMarketData(fakeKeys, { build: () => fakeSources(...) })` that answers:

- a chain for `M` with two expirations;
- option quotes for an open M fly;
- `Macy's Inc.` for the company.

Drive headless Firefox with `puppeteer-core` and wait for `document.fonts.ready` before each screenshot. Take four screenshots:

1. `/journal`: an open trade shows `est …` in muted italics, and BB shows `EXPIRED · add exits`.
2. The trade page of the open fly: the Mark and Est. P&L columns and the footnote.
3. `/iron-flies/new`: dropdowns after typing `M`, a strike list, grey exit hints, and the Derived row.
4. `/settings`.

Stop the server with `lsof -ti:4199 -sTCP:LISTEN | xargs -r kill`. Fix anything that looks wrong, test first, before going on.

- [ ] **Step 5: Live check with the user's key (needs the user, on a weekday session)**

The user runs `pnpm start`. The startup line must read `Market data: Alpaca (IEX stock prices, indicative option quotes)`. Then:

1. **Builder:** open New trade, type an earnings name the user trades. The expiry list matches IBKR's; the strikes match for the chosen expiry; Company fills in.
2. **Marks:** with a real or paper open fly (or a hand-entered open trade on a live contract), confirm that the grey exit hints and `est …` are in line with IBKR's bid/ask for the legs.
3. **Freshness (spec §14):** note each leg's quote time from the tooltip at two refreshes a minute apart, during the session. Record in the spec's §14 whether indicative quotes kept up within the 60 s refresh.
4. **Settings:** Remove key, then Save and test the same key again. Prices return without a restart.

Record the result under §14 of `docs/superpowers/specs/2026-09-26-option-chains-and-live-marks-design.md`, then commit:

```bash
git add docs/superpowers/specs/2026-09-26-option-chains-and-live-marks-design.md
git commit -m "$(cat <<'EOF'
docs: record the live check of option chains and marks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §3 facts | Global Constraints, plus Tasks 2–4 |
  | §5.1 chains | Task 3 |
  | §5.2 option quotes and the generic cache | Task 2 |
  | §5.3 company names and the key check | Task 4 |
  | §6 core | Task 1 |
  | §7.1 holder | Task 6 |
  | §7.2 read-only routes | Task 7 |
  | §7.3 settings routes and `writeAlpacaKeys` | Tasks 5 and 8 |
  | §8 builder | Tasks 11 and 12 |
  | §9 lists and trade page | Tasks 9 and 10 |
  | §10 Settings page | Task 13 |
  | §11 errors | Spread across Tasks 7–13 |
  | §12 parent spec | Task 14 |
  | §13 testing | Every task |
  | §14 open item | Task 14, Step 5 |

- **Deviations** are listed in the header; the spec was edited to match in the same commit as this plan.
- **Types used across tasks:**
  - `OptionQuote` is defined once, in core (Task 1). market-data (Task 2) and the web (Task 9) both use it.
  - `ListedExpiration` (Task 3) is the shape the web receives as `Expiration` (Task 11).
  - `MarketSources` (Task 6) is the shape `fakeSources` builds.
