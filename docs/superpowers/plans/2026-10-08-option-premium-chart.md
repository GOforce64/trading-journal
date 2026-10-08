# Option Premium Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scalp's page gets a Stock | Option switch. The Option view charts the contract's own 1-minute bars, with fills at their prices. Premium stops and targets are placed and dragged on it, and a stock-basis scalp's levels show there as "≈" estimates. Premium scalps get MAE and MFE from the option's range.

**Architecture:** Option bars reuse the stock bars cache (`bars`/`bar_days`, keyed by the contract's OCC code) through a new `optionMinute` on the bar service and `GET /api/bars/option/:contract`. The scalp price filler also stores each closed scalp's option range in two new `scalp_prices` columns, and `scalpRisk` reads it on the Premium basis. On the web, `ScalpWorkspace` owns the view, `TradeCharts` draws either model through the same `IntradayChart`, and `useLevels` arms placing on whichever view matches the basis.

**Tech Stack:** TypeScript, Hono, Drizzle and SQLite (better-sqlite3), React 19, TanStack Query, Lightweight Charts 5.2, Vitest, Biome.

**Spec:** [docs/superpowers/specs/2026-10-08-option-premium-chart-design.md](../specs/2026-10-08-option-premium-chart-design.md)

## Global Constraints

- Option history starts at `OPTION_BARS_SINCE = "2024-01-18"`. Days before it are never requested.
- The short delay is the stock's `ALPACA_DELAY_MS` (16 minutes), and the fallback is `OPTION_LONG_DELAY_MS` (80 minutes). The fallback is kept for the rest of the New York day once Alpaca refuses the short one with "OPRA agreement is not signed".
- **Never `report()` an OPRA refusal.** `report` turns any 403 into "Alpaca rejected the saved key."
- Options close at `optionClose(date) = regularClose(date) + 15`.
- Copy, word for word:
  - "Alpaca's option bars start on Jan 18, 2024."
  - "No option bars for {contract}." (server) and "No option bars for NVDA 232.5C Sep 26." (page, named from the leg)
  - "Alpaca's free option data runs up to {16|80} minutes behind."
  - "This contract's bars from 09:52 arrive by 10:08."
  - "Loading the option chart…", "Alpaca didn't answer." with Retry, and "Couldn't refresh the option chart: Alpaca didn't answer. Trying again in a minute."
  - "No option bars for this contract: type the levels.", and "The option chart's bars arrive by 10:08: type the levels or wait."
  - "Options don't trade premarket" (the PM levels tooltip)
  - "≈ STOP" and "≈ T1"
  - MAE/MFE small print: "option low 0.64", "option high 1.37", "fetching the option's range…", "waits for Alpaca's option delay", "Alpaca has no option bars for the hold", "couldn't fetch the option's range", "needs the option's range"
  - The tile tooltip: "From the entry minute through the exit minute. Trades in your entry minute before your fill count too."
- Before every commit: `pnpm format`, `pnpm lint`, `pnpm typecheck`, and the changed packages' tests. The full `pnpm test` runs before the PR.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Flipping views while placing:** + Stop on a Premium scalp arms the Option view. If the reader then flips to Stock, nothing may stay armed there: a click on the stock chart must not save a stock price as a premium stop. → Task 9's ScalpWorkspace test.
2. **Today's trade when Alpaca refuses both delays:** the answer must still be a 200, with no bars and `partial: true`. The page then says when bars arrive, not "Alpaca didn't answer", and the key must not turn "rejected". → Task 5's bar-service tests and Task 9's TradeCharts test.
3. **A scalp from before Jan 18, 2024, or an index option with no Alpaca bars:** the page must say why there's no chart, keep the Stock view working, and leave the premium levels typed. The filler must neither loop on Alpaca nor report a failure. → Task 5 (too old, no bars), Task 6 (no fetch before history), Task 9 (the message).
4. **A thin strike:** the candles keep their place in time (whitespace slots), and a fill in a minute without a bar still marks the nearest candle. → Task 8's model and chart tests.
5. **Switching back and forth keeps the time range,** and falls back to Fit trade when the other view has no candle there. → Task 8's IntradayChart test.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/chart.ts` | + `OPTION_LONG_DELAY_MS`, `OPTION_BARS_SINCE`, `optionClose`, `sessionSlots` |
| `packages/core/src/risk.ts` | `Excursion.move`; premium MAE/MFE from `optionHigh`/`optionLow` |
| `packages/market-data/src/history.ts` | + `OptionBarHistory`, `alpacaOptionHistory`, `optionTooRecent`; shared paging |
| `packages/db/src/schema.ts`, `migrations/0007_option_range.sql` | `scalp_prices.option_high`, `option_low` |
| `packages/db/src/repositories/trades.ts` | gap fields, option gap, `setScalpPrices` option fields, `staleOptionRange` |
| `apps/server/src/marketData.ts`, `testing.ts` | `optionHistory` source |
| `apps/server/src/bars.ts`, `routes/bars.ts` | `optionMinute`, `GET /api/bars/option/:contract` |
| `apps/server/src/scalpPrices.ts` | option range per closed scalp, `optionMissing` |
| `apps/web/src/chart/bars.ts` | `barRange`, `useOptionBars` |
| `apps/web/src/chart/option.ts` (new) | `ChartView`, `viewOf`, `contractOf`, `contractName`, `clockText`, `arriveBy` |
| `apps/web/src/chart/model.ts` | marker prices, `slots` |
| `apps/web/src/chart/IntradayChart.tsx` | whitespace slots, markers at price, keeping the time range per `viewKey` |
| `apps/web/src/chart/ChartToolbar.tsx` | Stock \| Option switch, PM greyed |
| `apps/web/src/chart/TradeCharts.tsx` | the Option view and its states |
| `apps/web/src/review/levels.ts` | `premiumChart` option, `drawable`, `approxLines` |
| `apps/web/src/review/ScalpWorkspace.tsx` | owns the view; lines per view; premium note |
| `apps/web/src/review/LevelFields.tsx` | the premium note prop; + Stop arms when drawable |
| `apps/web/src/review/prices.ts` | `needsPrices` option clause, option words, `optionMissing` |
| `apps/web/src/review/riskText.ts`, `RiskTiles.tsx`, `components/ui.tsx` | premium MAE/MFE text, tile tooltip |

---

### Task 1: core — option session constants and slots

**Files:**
- Modify: `packages/core/src/chart.ts` (after `ALPACA_DELAY_MS`, and a new function after `aggregate`)
- Test: `packages/core/src/chart.test.ts`

**Interfaces:**
- Produces:
  - `OPTION_LONG_DELAY_MS: number` (80 min in ms);
  - `OPTION_BARS_SINCE: "2024-01-18"`;
  - `optionClose(date: string): number`, a minute of the New York day;
  - `sessionSlots(candles: readonly { t: number }[], minutes: number): number[]`, epoch ms sorted ascending.

- [ ] **Step 1: Write the failing tests** (append to `chart.test.ts`; add `optionClose, sessionSlots` to its import from `./chart.js`, and `nyWallClock` from `./calendar.js` if not imported)

```ts
describe("optionClose", () => {
  it("is 16:15, or 13:15 on a half day", () => {
    expect(optionClose("2026-10-06")).toBe(16 * 60 + 15);
    expect(optionClose("2026-11-27")).toBe(13 * 60 + 15);
  });
});

describe("sessionSlots", () => {
  const at = (date: string, minute: number) => ({ t: nyWallClock(date, minute) });

  it("fills a day's session with empty 3-minute slots, from 09:30 to 16:12, around its candles", () => {
    const slots = sessionSlots([at("2026-10-06", 576), at("2026-10-06", 600)], 3);
    expect(slots[0]).toBe(nyWallClock("2026-10-06", 570));
    expect(slots.at(-1)).toBe(nyWallClock("2026-10-06", 972));
    expect(slots).toHaveLength((972 - 570) / 3 + 1);
    expect(slots).toContain(nyWallClock("2026-10-06", 573));
  });

  it("starts an hour's slots at 09:00, on aggregate's boundaries", () => {
    const slots = sessionSlots([at("2026-10-06", 600)], 60);
    expect(slots[0]).toBe(nyWallClock("2026-10-06", 540));
    expect(slots.at(-1)).toBe(nyWallClock("2026-10-06", 960));
  });

  it("ends a half day at 13:12, and reaches a candle past the close", () => {
    expect(sessionSlots([at("2026-11-27", 600)], 3).at(-1)).toBe(nyWallClock("2026-11-27", 792));
    expect(sessionSlots([at("2026-10-06", 990)], 3).at(-1)).toBe(nyWallClock("2026-10-06", 990));
  });

  it("covers each day that has candles, and nothing else", () => {
    const slots = sessionSlots([at("2026-10-05", 600), at("2026-10-06", 600)], 30);
    expect(new Set(slots.map((t) => nyClock(t).date))).toEqual(new Set(["2026-10-05", "2026-10-06"]));
    expect(sessionSlots([], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run packages/core/src/chart.test.ts`
Expected: FAIL, because `optionClose` and `sessionSlots` aren't exported.

- [ ] **Step 3: Implement.** Below `ALPACA_DELAY_MS` in `chart.ts`:

```ts
/** Options trade the regular session, and some, such as SPY's, a quarter-hour past it (premium-chart spec §5). */
const OPTION_EXTRA_MINUTES = 15;
/** How far behind Alpaca serves option bars once it refuses the stock's delay (premium-chart spec §5.2). */
export const OPTION_LONG_DELAY_MS = 80 * 60_000;
/** Alpaca's first day of option bars (premium-chart spec §3). */
export const OPTION_BARS_SINCE = "2024-01-18";

/** The minute options stop trading on `date`: the regular close plus 15 minutes. */
export const optionClose = (date: string): number => regularClose(date) + OPTION_EXTRA_MINUTES;
```

After `aggregate`:

```ts
/**
 * The option view's time slots (premium-chart spec §6.2): every candle's start, and each day's empty slots from the one
 * holding 09:30 to the later of the options' close and the day's last candle, on `aggregate`'s boundaries. The chart
 * draws empty slots as whitespace, so a thin strike's candles keep their place in time.
 */
export function sessionSlots(candles: readonly { t: number }[], minutes: number): number[] {
  const slotOf = (minute: number) => PREMARKET_OPEN + Math.floor((minute - PREMARKET_OPEN) / minutes) * minutes;
  const lastByDay = new Map<string, number>();
  for (const candle of candles) {
    const { date, minute } = nyClock(candle.t);
    lastByDay.set(date, Math.max(lastByDay.get(date) ?? 0, minute));
  }
  const slots = new Set(candles.map((candle) => candle.t));
  for (const [date, lastMinute] of lastByDay) {
    const end = slotOf(Math.max(optionClose(date) - 1, lastMinute));
    for (let slot = slotOf(REGULAR_OPEN); slot <= end; slot += minutes) slots.add(nyWallClock(date, slot));
  }
  return [...slots].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run it to see it pass.** Same command. Expected: PASS. If 2026-11-27 isn't a half day in `calendar.ts`, use the half day `calendar.test.ts` uses.
- [ ] **Step 5: Commit.** Run format, lint and typecheck, then `git commit -m "feat(core): the options' close, Alpaca's option history start, and the option view's slots"`.

---

### Task 2: core — premium MAE and MFE

**Files:**
- Modify: `packages/core/src/risk.ts` (`RiskTrade.scalpPrices`, `Excursion`, the MAE/MFE block in `scalpRisk`)
- Modify: `apps/web/src/review/riskText.ts` (`move.stock` → `move.move` only)
- Test: `packages/core/src/risk.test.ts`; rename `stock:` → `move:` in excursion expectations wherever `grep -rn "mae\|mfe" apps packages --include=*.test.ts*` finds them (`apps/server/src/risk.test.ts`'s `RiskView` type too)

**Interfaces:**
- Produces: `Excursion { move: number; r: number | null }`, and `RiskTrade.scalpPrices` gains `optionHigh?: number | null; optionLow?: number | null`.

- [ ] **Step 1: Write the failing tests.** Add to `risk.test.ts`. Change the premium-basis test's expected `mae: { stock: 0.12, r: null }, mfe: { stock: 2.38, r: null }` to `mae: null, mfe: null`, since the default `nvda()` has no option range. Then rename every remaining `{ stock: … }` excursion to `{ move: … }`.

```ts
const WITH_OPTION = { entryPrice: STOCK, holdHigh: 233.21, holdLow: 230.71, optionHigh: 1.37, optionLow: 0.64 };

it("measures a premium scalp's MAE and MFE on the option's own range, in R against the premium stop", () => {
  const premium = { levelBasis: "premium" as const, stopPrice: 0.6, targets: [] };
  const risk = scalpRisk(nvda({ scalpPrices: WITH_OPTION }, premium));
  expect(risk?.mae).toEqual({ move: 0.42, r: expect.closeTo(0.913, 3) });
  expect(risk?.mfe).toEqual({ move: 0.31, r: expect.closeTo(0.674, 3) });
  // A put loses as its own price falls too: the same reading.
  const put = scalpRisk(nvda({ scalpPrices: WITH_OPTION, legs: [leg({ right: "P", strike: 229 })] }, premium));
  expect(put?.mae).toEqual({ move: 0.42, r: expect.closeTo(0.913, 3) });
});

it("gives premium MAE and MFE no R without a stop under the entry, and none without the option's range", () => {
  const premium = (stopPrice: number | null) => ({ levelBasis: "premium" as const, stopPrice });
  expect(scalpRisk(nvda({ scalpPrices: WITH_OPTION }, premium(1.2)))?.mae).toEqual({ move: 0.42, r: null });
  expect(scalpRisk(nvda({ scalpPrices: WITH_OPTION }, premium(null)))?.mfe).toEqual({ move: 0.31, r: null });
  expect(scalpRisk(nvda({}, premium(0.6)))).toMatchObject({ mae: null, mfe: null });
  // A stop at 0 risks the whole premium: 1R is 1.06.
  expect(scalpRisk(nvda({ scalpPrices: WITH_OPTION }, premium(0)))?.mae?.r).toBeCloseTo(0.3962, 4);
  // Never below the entry: no adverse move at all.
  const low = { ...WITH_OPTION, optionLow: 1.1 };
  expect(scalpRisk(nvda({ scalpPrices: low }, premium(0.6)))?.mae).toEqual({ move: 0, r: 0 });
  expect(scalpRisk(nvda({ closedAt: null, netPnl: null, scalpPrices: WITH_OPTION }, premium(0.6)))?.mae).toBeNull();
});

it("keeps the stock basis on the stock's range, whatever the option's", () => {
  expect(scalpRisk(nvda({ scalpPrices: WITH_OPTION }))?.mae).toEqual({ move: 0.12, r: expect.closeTo(0.0645, 4) });
});
```

- [ ] **Step 2: Run it to see it fail:** `pnpm vitest run packages/core/src/risk.test.ts`, expecting the `move` and option-range assertions to fail.
- [ ] **Step 3: Implement** in `risk.ts`:

```ts
  /** The stock prices the filler fetched (spec §5), and the option's range over the hold (premium-chart spec §9). */
  scalpPrices: {
    entryPrice: number | null;
    holdHigh: number | null;
    holdLow: number | null;
    optionHigh?: number | null;
    optionLow?: number | null;
  } | null;
```

```ts
/** How far the trade went against or for the entry during the hold: in stock dollars on the stock basis, in the
 * option's price on premium (premium-chart spec §9.3), and in R against a stop on the losing side. */
export interface Excursion {
  move: number;
  r: number | null;
}
```

Replace the MAE/MFE block (from `const high = …` to the closing `}` of `if (trade.closedAt != null && …)`):

```ts
  const excursion = (move: number, oneR: number | null): Excursion => ({
    move: round2(move),
    r: oneR ? move / oneR : null,
  });
  let mae: Excursion | null = null;
  let mfe: Excursion | null = null;
  if (trade.closedAt != null && basis === "premium") {
    // A long option loses as its own price falls, call or put; a stop under the entry is 1R (premium-chart spec §9.3).
    const high = trade.scalpPrices?.optionHigh ?? null;
    const low = trade.scalpPrices?.optionLow ?? null;
    const oneR = stop != null && loses(stop) ? premium - stop : null;
    if (high != null && low != null) {
      mae = excursion(Math.max(0, premium - low), oneR);
      mfe = excursion(Math.max(0, high - premium), oneR);
    }
  } else if (trade.closedAt != null && S != null) {
    const high = trade.scalpPrices?.holdHigh ?? null;
    const low = trade.scalpPrices?.holdLow ?? null;
    // In R, MAE and MFE need a stock stop on the losing side: its distance from the entry is the stock's 1R.
    const oneR = stop != null && loses(stop) ? Math.abs(S - stop) : null;
    if (high != null && low != null) {
      const down = Math.max(0, S - low);
      const up = Math.max(0, high - S);
      mae = excursion(right === "C" ? down : up, oneR);
      mfe = excursion(right === "C" ? up : down, oneR);
    }
  }
```

In `riskText.ts`, `excursion` reads `move.move.toFixed(2)`. Its text changes come in Task 7.
- [ ] **Step 4: Run the tests to see them pass:** `pnpm vitest run packages/core/src/risk.test.ts apps/web/src/review apps/server/src/risk.test.ts`.
- [ ] **Step 5: Commit:** `feat(core): premium MAE and MFE from the option's range over the hold`.

---

### Task 3: market-data — option bars client

**Files:**
- Modify: `packages/market-data/src/history.ts`
- Test: `packages/market-data/src/history.test.ts`

**Interfaces:**
- Produces:
  - `OPTION_BARS` (url);
  - `interface OptionBarHistory { minuteBars(contract: string, start: number, end: number): Promise<PriceBar[]> }`;
  - `alpacaOptionHistory(keys, options?): OptionBarHistory`;
  - `optionTooRecent(error: unknown): boolean`.

- [ ] **Step 1: Write the failing tests** (append; import `alpacaOptionHistory, optionTooRecent` from `./history.js`)

```ts
describe("alpacaOptionHistory.minuteBars", () => {
  const CONTRACT = "SPY261006C00779000";

  it("asks the option bars endpoint for 1-minute bars, 10,000 at a time, and follows next_page_token", async () => {
    const { fetch, calls } = fakeFetch(
      json({ bars: { [CONTRACT]: [raw("2026-10-06T13:30:00Z", 0.83, 1.09, 0.76, 1.07)] }, next_page_token: "abc" }),
      json({ bars: { [CONTRACT]: [raw("2026-10-06T13:31:00Z", 1.07, 1.1, 1, 1.02)] }, next_page_token: null }),
    );
    const bars = await alpacaOptionHistory(KEYS, { fetch }).minuteBars(
      CONTRACT,
      Date.UTC(2026, 9, 6, 4),
      Date.UTC(2026, 9, 7, 4),
    );
    expect(bars).toEqual([
      { t: Date.UTC(2026, 9, 6, 13, 30), o: 0.83, h: 1.09, l: 0.76, c: 1.07, v: 1200 },
      { t: Date.UTC(2026, 9, 6, 13, 31), o: 1.07, h: 1.1, l: 1, c: 1.02, v: 1200 },
    ]);
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe("https://data.alpaca.markets/v1beta1/options/bars");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      symbols: CONTRACT,
      timeframe: "1Min",
      start: "2026-10-06T04:00:00.000Z",
      end: "2026-10-07T04:00:00.000Z",
      limit: "10000",
    });
    expect(calls[1]?.url.searchParams.get("page_token")).toBe("abc");
  });

  it("answers [] for a contract Alpaca doesn't know, as an empty reply or a refused code", async () => {
    const empty = fakeFetch(json({ bars: {}, next_page_token: null }));
    expect(await alpacaOptionHistory(KEYS, { fetch: empty.fetch }).minuteBars(CONTRACT, 0, 1)).toEqual([]);
    const refused = fakeFetch(
      json({ message: 'invalid symbol: "SPXW1" does not match ^[A-Z]{1,5}\\d{6,7}[CP]\\d{8}$' }, 400),
    );
    expect(await alpacaOptionHistory(KEYS, { fetch: refused.fetch }).minuteBars("SPXW1", 0, 1)).toEqual([]);
  });

  it("throws Alpaca's refusals, telling the OPRA delay apart", async () => {
    const { fetch } = fakeFetch(json({ message: "OPRA agreement is not signed" }, 403));
    const error = await alpacaOptionHistory(KEYS, { fetch })
      .minuteBars(CONTRACT, 0, 1)
      .catch((caught: unknown) => caught);
    expect(optionTooRecent(error)).toBe(true);
    expect(optionTooRecent(new AlpacaError(403, "forbidden"))).toBe(false);
    expect(optionTooRecent(new AlpacaError(403, "subscription does not permit querying recent SIP data"))).toBe(false);
  });
});
```

(If `json()` in `testing.ts` takes no status, build `new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })` inline.)

- [ ] **Step 2: Run it to see it fail:** `pnpm vitest run packages/market-data/src/history.test.ts`.
- [ ] **Step 3: Implement.** Move the body of `alpacaHistory`'s `all` into a module-level pager, and build both clients on it:

```ts
import { AlpacaError, type AlpacaKeys, type AlpacaOptions, alpacaGet, DATA_API } from "./http.js";

/** Alpaca's option bars (premium-chart spec §5.1): OPRA trades, regular hours only, from 2024-01-18. */
export const OPTION_BARS = `${DATA_API}/v1beta1/options/bars`;

/** The option chart's history (premium-chart spec §5.1). */
export interface OptionBarHistory {
  /** One contract's 1-minute bars from `start` to `end` (epoch ms), oldest first. [] for an unknown contract. */
  minuteBars(contract: string, start: number, end: number): Promise<PriceBar[]>;
}

/** The free plan's refusal of the newest option bars (premium-chart spec §3): ask again with the long delay. */
export const optionTooRecent = (error: unknown): boolean =>
  error instanceof AlpacaError && error.status === 403 && /OPRA agreement/i.test(error.detail);

/** Every page of one symbol's bars at `url`, 10,000 a page. A symbol Alpaca refuses as invalid answers []. */
async function allPages(
  url: string,
  symbol: string,
  query: Record<string, string>,
  keys: AlpacaKeys,
  options: AlpacaOptions,
): Promise<PriceBar[]> {
  const bars: PriceBar[] = [];
  let token: string | null | undefined;
  do {
    const params = new URLSearchParams({
      symbols: symbol,
      ...query,
      limit: "10000",
      ...(token ? { page_token: token } : {}),
    });
    let page: z.infer<typeof pageSchema>;
    try {
      page = pageSchema.parse(await alpacaGet(`${url}?${params}`, keys, options));
    } catch (error) {
      if (error instanceof AlpacaError && error.status === 400 && INVALID_SYMBOL.test(error.detail)) return [];
      throw error;
    }
    for (const bar of page.bars?.[symbol] ?? []) {
      bars.push({ t: Date.parse(bar.t), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
    }
    token = page.next_page_token;
  } while (token);
  return bars;
}

/** SIP bars from the free plan, raw so they match the strikes, 10,000 a page. */
export function alpacaHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): BarHistory {
  const stock = (symbol: string, query: Record<string, string>) =>
    allPages(STOCK_BARS, symbol, { ...query, feed: "sip", adjustment: "raw" }, keys, options);
  return {
    minuteBars: (symbol, start, end) =>
      stock(symbol, { timeframe: "1Min", start: new Date(start).toISOString(), end: new Date(end).toISOString() }),
    dailyBars: (symbol, from, to) => stock(symbol, { timeframe: "1Day", start: from, end: to }),
  };
}

/** One contract's OPRA bars from the free plan (premium-chart spec §5.1). */
export function alpacaOptionHistory(keys: AlpacaKeys, options: AlpacaOptions = {}): OptionBarHistory {
  return {
    minuteBars: (contract, start, end) =>
      allPages(
        OPTION_BARS,
        contract,
        { timeframe: "1Min", start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        keys,
        options,
      ),
  };
}
```

- [ ] **Step 4: Run it to see it pass** (the stock tests in the same file must stay green).
- [ ] **Step 5: Commit:** `feat(market-data): Alpaca's option bars, and its OPRA delay refusal`.

---

### Task 4: db — the option range columns, gaps and staleness

**Files:**
- Modify: `packages/db/src/schema.ts` (`scalpPrices`)
- Create: `packages/db/migrations/0007_option_range.sql` (generated) and its snapshot and journal entry
- Modify: `packages/db/src/repositories/trades.ts`
- Test: `packages/db/src/repositories/trades.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**
- Produces:
  - `ScalpPricesRow` gains `optionHigh: number | null; optionLow: number | null`;
  - `ScalpPriceGap` gains `entryPrice: number | null; holdHigh: number | null; optionHigh: number | null`;
  - `setScalpPrices(id, found: { entryPrice; holdHigh; holdLow; optionHigh?: number | null; optionLow?: number | null }, fetchedAt)`;
  - `staleOptionRange(existing, next): boolean`, exported.

- [ ] **Step 1: Write the failing tests.**
  - In `migrate.test.ts`'s first test, the `scalp_prices` columns become `["trade_id", "entry_price", "hold_high", "hold_low", "fetched_at", "option_high", "option_low"]`.
  - In `trades.test.ts`'s "lists scalps missing a fetched price…" test:
    - the `missingScalpPrices([open])` expectation becomes `{ tradeId: open, underlying: "NVDA", openedAt: nvda.openedAt + 60_000, closedAt: null, entryPrice: null, holdHigh: null, optionHigh: null }`;
    - after the line storing `holdHigh: 233.21`, it expects `gaps()` to equal `[closed]` (still missing the option's range);
    - then `repo().setScalpPrices(closed, { entryPrice: null, holdHigh: null, holdLow: null, optionHigh: 1.37, optionLow: 0.64 }, 4_000);`, `expect(gaps()).toEqual([]);`;
    - the final `toMatchObject` adds `optionHigh: 1.37, optionLow: 0.64` with `fetchedAt: 4_000`.
  - Add:

```ts
  it("asks for no option range before Alpaca's option history, nor of an open scalp", () => {
    const old = repo().create({ ...nvda, openedAt: nyWallClock("2023-12-15", 600), closedAt: nyWallClock("2023-12-15", 610) }).id;
    repo().setScalpPrices(old, { entryPrice: 470, holdHigh: 471, holdLow: 469 }, 2_000);
    const open = repo().create({ ...nvda, closedAt: null, netPnl: null }).id;
    repo().setScalpPrices(open, { entryPrice: 230.83, holdHigh: null, holdLow: null }, 2_000);
    expect(repo().missingScalpPrices().map((gap) => gap.tradeId)).toEqual([]);
  });

  it("drops a scalp's fetched prices when its contract changes, and keeps them when its legs come back the same", () => {
    const id = repo().create(nvda).id;
    repo().setScalpPrices(id, { entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71, optionHigh: 1.37, optionLow: 0.64 }, 2_000);
    const [leg] = nvda.legs;
    if (!leg) throw new Error("no leg");
    repo().update(id, { legs: [{ ...leg }] });
    expect(repo().get(id)?.scalpPrices?.optionHigh).toBe(1.37);
    repo().update(id, { legs: [{ ...leg, strike: 235 }] });
    expect(repo().get(id)?.scalpPrices).toBeNull();
  });
```

  - And a unit test of `staleOptionRange`:

```ts
describe("staleOptionRange", () => {
  const leg = { right: "C", strike: 232.5, expiry: "2026-09-28" };
  it("is stale only when a strike, expiry or right changes", () => {
    expect(staleOptionRange([leg], undefined)).toBe(false);
    expect(staleOptionRange([leg], [{ ...leg }])).toBe(false);
    expect(staleOptionRange([leg], [{ ...leg, strike: 235 }])).toBe(true);
    expect(staleOptionRange([leg], [{ ...leg, expiry: "2026-10-02" }])).toBe(true);
    expect(staleOptionRange([leg], [{ ...leg, right: "P" }])).toBe(true);
  });
});
```

(Use whatever leg shape `nvda` in this file has. If a patch's legs need more fields, such as `quantity` and `openPrice`, spread the sample leg as above.)

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run packages/db`.
- [ ] **Step 3: Implement.**
  - **Schema** (`scalpPrices`, after `holdLow`):

```ts
  /** The contract's range over the same minutes (premium-chart spec §9.1). */
  optionHigh: real("option_high"),
  optionLow: real("option_low"),
```

  - **Generate:** run `pnpm --filter @tj/db generate --name option_range`. Expect `0007_option_range.sql` with two `ALTER TABLE \`scalp_prices\` ADD …` lines. Adding columns doesn't prompt. If drizzle-kit asks anything anyway, stop and look.
  - **Repository** (`trades.ts`):
    - import `gte` from drizzle-orm, and `nyWallClock, OPTION_BARS_SINCE` from `@tj/core`;
    - `ScalpPriceGap` adds:

```ts
  /** What's stored so far, so the filler fetches only what's missing. */
  entryPrice: number | null;
  holdHigh: number | null;
  optionHigh: number | null;
```

    - module level: `/** Alpaca's first option bars, as an instant (premium-chart spec §3). */ const OPTION_EPOCH = nyWallClock(OPTION_BARS_SINCE, 0);`
    - `missingScalpPrices`: the `or(…)` gains `and(isNotNull(trades.closedAt), gte(trades.openedAt, OPTION_EPOCH), isNull(scalpPrices.optionHigh))`, and the select gains `entryPrice: scalpPrices.entryPrice, holdHigh: scalpPrices.holdHigh, optionHigh: scalpPrices.optionHigh`;
    - `setScalpPrices`: the `found` type gains `optionHigh?: number | null; optionLow?: number | null`, and the row gains `optionHigh: found.optionHigh ?? stored?.optionHigh ?? null, optionLow: found.optionLow ?? stored?.optionLow ?? null`;
    - add next to `staleScalpPrices`:

```ts
/** A scalp's prices go stale with another contract: a new strike, expiry or right (premium-chart spec §9.1). */
export function staleOptionRange(
  existing: readonly { right: string | null; strike: number | null; expiry: string | null }[],
  next: readonly { right?: string | null; strike?: number | null; expiry?: string | null }[] | undefined,
): boolean {
  if (next === undefined) return false;
  const contracts = (legs: readonly { right?: string | null; strike?: number | null; expiry?: string | null }[]) =>
    legs
      .map((leg) => `${leg.right} ${leg.strike} ${leg.expiry}`)
      .sort()
      .join(",");
  return contracts(existing) !== contracts(next);
}
```

    - in `update`'s transaction: `if (staleScalpPrices(existing, patch) || staleOptionRange(record.legs, patch.legs)) { tx.delete(scalpPrices)… }`.
  - **IBKR's apply** (`ibkr.ts`) is left alone. A synced trade is grouped by its contract, so the sync never changes one's contract. Record this as a ruling.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run packages/db`, and also `pnpm vitest run apps/server` (the gap's new fields are additive).
- [ ] **Step 5: Commit:** `feat(db): scalp_prices keeps the option's range over the hold (migration 0007)`.

---

### Task 5: server — option bars service and route

**Files:**
- Modify: `apps/server/src/marketData.ts` (`MarketSources.optionHistory`, built with `alpacaOptionHistory`)
- Modify: `apps/server/src/testing.ts` (`fakeSources` default `optionHistory: { minuteBars: async () => [] }`)
- Modify: `apps/server/src/bars.ts`, `apps/server/src/routes/bars.ts`
- Test: `apps/server/src/bars.test.ts`

**Interfaces:**
- Consumes: `OptionBarHistory`, `optionTooRecent` (Task 3); `OPTION_BARS_SINCE`, `OPTION_LONG_DELAY_MS`, `optionClose` (Task 1).
- Produces:
  - `OptionBarAnswer { bars: PriceBar[]; partial: boolean; delayMinutes: number; unavailable: { reason: "no_key" | "no_bars" | "too_old"; message: string } | null }`;
  - `BarService.optionMinute(contract: string, from: string, to: string): Promise<OptionBarAnswer>`;
  - `GET /api/bars/option/:contract?from&to` → `{ contract, bars, partial, delayMinutes, unavailable }`.

- [ ] **Step 1: Write the failing tests** (a new `describe` in `bars.test.ts`; import `AlpacaError` and `OptionBarHistory`):

```ts
describe("GET /api/bars/option/:contract", () => {
  const CONTRACT = "NVDA260928C00232500";
  const OPRA = () => new AlpacaError(403, "OPRA agreement is not signed");
  const TODAY_START = nyWallClock("2026-09-29", 0);
  interface OptionAnswer extends Omit<Answer, "symbol"> {
    contract: string;
    delayMinutes: number;
  }

  function setupOption(minuteBars: OptionBarHistory["minuteBars"], withKey = true, now = NOW) {
    const fetchBars = vi.fn(minuteBars);
    const market = createMarketData(withKey ? { keyId: "PKTEST", secretKey: "s" } : null, {
      build: () => fakeSources({ optionHistory: { minuteBars: fetchBars } }),
      log: () => {},
    });
    const app = testApp({ market, now: () => now });
    const get = async (query: string, contract = CONTRACT) => {
      const res = await app.request(`/api/bars/option/${contract}?${query}`, { headers: LOCAL });
      return { status: res.status, body: (await res.json()) as OptionAnswer };
    };
    return { market, fetchBars, get };
  }

  it("fetches a past range's finished days once, then serves them from the cache", async () => {
    const { fetchBars, get } = setupOption(async () => [MONDAY]);
    expect((await get("from=2026-09-21&to=2026-09-28")).body).toEqual({
      contract: CONTRACT,
      bars: [MONDAY],
      partial: false,
      delayMinutes: 16,
      unavailable: null,
    });
    expect(fetchBars).toHaveBeenCalledWith(CONTRACT, nyWallClock("2026-09-21", 0), nyWallClock("2026-09-29", 0));
    await get("from=2026-09-21&to=2026-09-28");
    expect(fetchBars).toHaveBeenCalledTimes(1);
  });

  it("asks for today up to 16 minutes ago, never caching it, and calls it partial until the options close", async () => {
    const { fetchBars, get } = setupOption(async (_contract, start) => (start === TODAY_START ? [TODAY] : [MONDAY]));
    const answer = await get("from=2026-09-28&to=2026-09-29");
    expect(answer.body).toMatchObject({ bars: [MONDAY, TODAY], partial: true, delayMinutes: 16 });
    expect(fetchBars).toHaveBeenLastCalledWith(CONTRACT, TODAY_START, NOW - 16 * 60_000);
  });

  it("asks again 80 minutes back when Alpaca refuses, and keeps the long delay for the day without blaming the key", async () => {
    const { market, fetchBars, get } = setupOption(async (_contract, start, end) => {
      if (start === TODAY_START && end > NOW - 80 * 60_000) throw OPRA();
      return start === TODAY_START ? [TODAY] : [MONDAY];
    });
    expect((await get("from=2026-09-28&to=2026-09-29")).body).toMatchObject({
      bars: [MONDAY, TODAY],
      partial: true,
      delayMinutes: 80,
    });
    expect(fetchBars).toHaveBeenCalledTimes(3);
    await get("from=2026-09-28&to=2026-09-29");
    // Straight to the long delay: one request, not a refusal first.
    expect(fetchBars).toHaveBeenCalledTimes(4);
    expect(fetchBars).toHaveBeenLastCalledWith(CONTRACT, TODAY_START, NOW - 80 * 60_000);
    expect(market.status().state).toBe("on");
  });

  it("answers no bars yet, still partial, when Alpaca refuses both delays", async () => {
    const { get } = setupOption(async (_contract, start) => {
      if (start === TODAY_START) throw OPRA();
      return [];
    });
    const answer = await get("from=2026-09-29&to=2026-09-29");
    expect(answer).toMatchObject({ status: 200, body: { bars: [], partial: true, delayMinutes: 80 } });
  });

  it("never asks for days before Jan 18, 2024", async () => {
    const { fetchBars, get } = setupOption(async () => []);
    expect((await get("from=2023-12-01&to=2023-12-10")).body).toMatchObject({
      bars: [],
      unavailable: { reason: "too_old", message: "Alpaca's option bars start on Jan 18, 2024." },
    });
    expect(fetchBars).not.toHaveBeenCalled();
    await get("from=2024-01-10&to=2024-01-20");
    expect(fetchBars).toHaveBeenCalledWith(CONTRACT, nyWallClock("2024-01-18", 0), nyWallClock("2024-01-21", 0));
  });

  it("says when Alpaca has no bars for the contract, and when there's no key", async () => {
    expect((await setupOption(async () => []).get("from=2026-09-21&to=2026-09-28")).body.unavailable).toEqual({
      reason: "no_bars",
      message: `No option bars for ${CONTRACT}.`,
    });
    expect(
      (await setupOption(async () => [], false).get("from=2026-09-21&to=2026-09-28")).body.unavailable?.reason,
    ).toBe("no_key");
  });

  it("refuses a bad contract or range, and answers 502 without storing anything when Alpaca fails", async () => {
    const { fetchBars, get } = setupOption(async () => {
      throw new AlpacaError(500, "");
    });
    expect((await get("from=2026-09-21&to=2026-09-28", "NVDA")).status).toBe(400);
    expect((await get("from=2026-09-28&to=2026-09-21")).status).toBe(400);
    expect((await get("from=2026-07-01&to=2026-09-28")).status).toBe(400);
    expect((await get("from=2026-09-21&to=2026-09-28")).status).toBe(502);
    await get("from=2026-09-21&to=2026-09-28");
    expect(fetchBars).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run apps/server/src/bars.test.ts`.
- [ ] **Step 3: Implement.**
  - In `marketData.ts`, import `alpacaOptionHistory` and `type OptionBarHistory`. Add `optionHistory: OptionBarHistory;` to `MarketSources`, and `optionHistory: alpacaOptionHistory(keys, options)` where `alpacaSources` builds `history`, following its exact pattern.
  - In `testing.ts`, add `optionHistory: { minuteBars: async () => [] },` to `fakeSources`.
  - In `bars.ts`:

```ts
/** The option chart's answer (premium-chart spec §5.2): how far behind today's bars are, too. */
export interface OptionBarAnswer {
  bars: PriceBar[];
  partial: boolean;
  /** 16, or 80 once Alpaca has refused the short delay today. */
  delayMinutes: number;
  unavailable: { reason: "no_key" | "no_bars" | "too_old"; message: string } | null;
}

const TOO_OLD = { reason: "too_old" as const, message: "Alpaca's option bars start on Jan 18, 2024." };
const noOptionBars = (contract: string) => ({
  reason: "no_bars" as const,
  message: `No option bars for ${contract}.`,
});
```

    Inside `createBarService`, before `return`:

```ts
  // The New York date Alpaca last refused option bars at the short delay: the long one holds for the rest of it.
  let longDelayOn: string | null = null;

  /** Today's option bars, at the short delay, or at the long one once Alpaca refuses it (spec §5.2). */
  async function todaysOptionBars(
    history: OptionBarHistory,
    contract: string,
    today: string,
  ): Promise<{ bars: PriceBar[]; partial: boolean }> {
    const start = nyWallClock(today, 0);
    const close = nyWallClock(today, optionClose(today));
    const ask = async (delay: number) => {
      const end = Math.min(close, now() - delay);
      return { bars: end > start ? await history.minuteBars(contract, start, end) : [], partial: end < close };
    };
    // A refusal is the delay, not a bad key: it's never reported, since report() blames the key for any 403.
    if (longDelayOn !== today) {
      try {
        return await ask(ALPACA_DELAY_MS);
      } catch (error) {
        if (!optionTooRecent(error)) throw error;
        longDelayOn = today;
      }
    }
    try {
      return await ask(OPTION_LONG_DELAY_MS);
    } catch (error) {
      if (!optionTooRecent(error)) throw error;
      return { bars: [], partial: true };
    }
  }
```

    And the method, after `daily`:

```ts
    async optionMinute(contract: string, from: string, to: string): Promise<OptionBarAnswer> {
      const today = nyDate(now());
      const delayMinutes = () => (longDelayOn === today ? OPTION_LONG_DELAY_MS : ALPACA_DELAY_MS) / 60_000;
      if (to < OPTION_BARS_SINCE) return { bars: [], partial: false, delayMinutes: delayMinutes(), unavailable: TOO_OLD };
      const first = from < OPTION_BARS_SINCE ? OPTION_BARS_SINCE : from;
      const last = to < today ? to : today;
      const finished = datesBetween(first, last).filter((date) => date < today);
      const known = repo.knownDays(contract, "1m", finished);
      const missing = finished.filter((date) => !known.has(date));
      const wantsToday =
        last === today && first <= today && isTradingDay(today) && nyClock(now()).minute >= REGULAR_OPEN;
      const sources = market?.sources() ?? null;
      if ((missing.length > 0 || wantsToday) && !sources) {
        return { bars: [], partial: false, delayMinutes: delayMinutes(), unavailable: NO_KEY };
      }

      let todays: PriceBar[] = [];
      let partial = false;
      try {
        if (sources && missing.length > 0) {
          // Options stop by 16:15, so the long delay never cuts a finished day short, and is safe after midnight.
          await fill(contract, "1m", missing, (firstDay, lastDay) =>
            sources.optionHistory.minuteBars(
              contract,
              nyWallClock(firstDay, 0),
              Math.min(nyWallClock(addDays(lastDay, 1), 0), now() - OPTION_LONG_DELAY_MS),
            ),
          );
        }
        if (sources && wantsToday) ({ bars: todays, partial } = await todaysOptionBars(sources.optionHistory, contract, today));
      } catch (error) {
        sources?.report(error);
        throw new BarsUnreachable();
      }

      const lastFinished = finished.at(-1);
      const cached = lastFinished
        ? repo.read(contract, "1m", nyWallClock(first, 0), nyWallClock(addDays(lastFinished, 1), 0) - 1)
        : [];
      const all = [...cached, ...todays];
      return {
        bars: all,
        partial,
        delayMinutes: delayMinutes(),
        unavailable: all.length === 0 && !partial ? noOptionBars(contract) : null,
      };
    },
```

    Import `OPTION_BARS_SINCE, OPTION_LONG_DELAY_MS, optionClose, REGULAR_OPEN` from `@tj/core`, and `optionTooRecent, type OptionBarHistory` from `@tj/market-data`. `unavailable` stays null while today's answer is partial and empty, because the page then says when bars arrive (spec §6.3). That makes the "both refused" test read `unavailable: null`, which is right.
  - In `routes/bars.ts`, before `.get("/:symbol", …)`:

```ts
    .get("/option/:contract", zValidator("query", z.object({ from: isoDate, to: isoDate })), async (c) => {
      const contract = c.req.param("contract").toUpperCase();
      const { from, to } = c.req.valid("query");
      if (!CONTRACT.test(contract) || from > to || addDays(from, MAX_BAR_DAYS) < to) {
        return c.json({ error: "bad request" }, 400);
      }
      try {
        const answer = await service.optionMinute(contract, from, to);
        return c.json(
          {
            contract,
            bars: answer.bars,
            partial: answer.partial,
            delayMinutes: answer.delayMinutes,
            unavailable: answer.unavailable,
          },
          200,
        );
      } catch (error) {
        if (error instanceof BarsUnreachable) return c.json(UNREACHABLE, 502);
        throw error;
      }
    })
```

    Import `CONTRACT` from `@tj/market-data`.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/server`.
- [ ] **Step 5: Commit:** `feat(server): option bars, cached by contract, with Alpaca's long delay as a fallback`.

---

### Task 6: server — the filler stores the option range

**Files:**
- Modify: `apps/server/src/scalpPrices.ts`
- Test: `apps/server/src/risk.test.ts`

**Interfaces:**
- Consumes: `ScalpPriceGap` (Task 4), `BarService.optionMinute` (Task 5), `occSymbol` (core).
- Produces: `ScalpPriceResult.optionMissing: { tradeId: string; reason: "no_bars" | "too_recent" | "unreachable" }[]`.

- [ ] **Step 1: Write the failing tests.**
  - `setup(history, optionBars = async () => OPTION_SEP_28)` builds `fakeSources({ history: …, optionHistory: { minuteBars: optionBars } })`, with the option fake as a `vi.fn` returned as `optionBars`.
  - `FillBody` gains `optionMissing`.
  - `OPTION_SEP_28` is the contract's minutes around the hold: `[bar("2026-09-28", 570, 0.9, 1, 0.85, 0.95), bar("2026-09-28", 571, 0.97, 1.53, 0.97, 1.1), bar("2026-09-28", 580, 1.2, 1.37, 1.15, 1.3), bar("2026-09-28", 586, 1.1, 1.32, 0.64, 1.29), bar("2026-09-28", 587, 1.29, 3, 0.1, 1.2)]`. The hold's range is then high 1.53, low 0.64.
  - Where an existing test compares the whole body with `toEqual`, add `optionMissing: []`. Add:

```ts
  it("stores each closed scalp's option range beside the stock's", async () => {
    const { create, fill, trade, optionBars } = setup();
    const id = await create();
    expect((await fill([id])).body).toMatchObject({ filled: 1, missing: [], optionMissing: [] });
    expect(optionBars).toHaveBeenCalledWith(
      "NVDA260928C00232500",
      nyWallClock("2026-09-28", 0),
      nyWallClock("2026-09-29", 0),
    );
    expect((await trade(id)).scalpPrices).toMatchObject({ optionHigh: 1.53, optionLow: 0.64 });
  });

  it("fetches only the option range when the stock's is stored, and keeps going without it when Alpaca fails", async () => {
    let up = false;
    const { create, fill, trade, minuteBars, optionBars } = setup({}, async () => {
      if (!up) throw new AlpacaError(500, "");
      return OPTION_SEP_28;
    });
    const first = await create();
    const second = await create(nvda({ openedAt: OPENED + 60_000 }));
    const body = (await fill()).body;
    expect(body.filled).toBe(2);
    expect(body.optionMissing).toEqual([
      { tradeId: first, reason: "unreachable" },
      { tradeId: second, reason: "unreachable" },
    ]);
    // One failed option request ends the run's option fetching.
    expect(optionBars).toHaveBeenCalledTimes(1);
    expect((await trade(first)).scalpPrices).toMatchObject({ entryPrice: expect.any(Number), optionHigh: null });

    up = true;
    const stockCalls = minuteBars.mock.calls.length;
    expect((await fill([first])).body).toMatchObject({ filled: 1, optionMissing: [] });
    expect(minuteBars).toHaveBeenCalledTimes(stockCalls);
    expect((await trade(first)).scalpPrices).toMatchObject({ optionHigh: 1.53, optionLow: 0.64 });
  });

  it("waits for Alpaca's delay without asking, and asks nothing before its option history", async () => {
    const { create, fill, optionBars } = setup();
    const recent = await create(nvda({ openedAt: NOW - 20 * 60_000, closedAt: NOW - 10 * 60_000 }));
    expect((await fill([recent])).body.optionMissing).toEqual([{ tradeId: recent, reason: "too_recent" }]);
    const old = await create(
      nvda({
        openedAt: Date.UTC(2023, 11, 15, 15),
        closedAt: Date.UTC(2023, 11, 15, 15, 10),
        legs: [{ right: "C", strike: 470, expiry: "2023-12-15", quantity: 1, openPrice: 1, closePrice: 1.2 }],
      }),
    );
    expect((await fill([old])).body.optionMissing).toEqual([]);
    expect(optionBars).not.toHaveBeenCalled();
  });

  it("calls a finished hold with no option bars no_bars", async () => {
    const { create, fill } = setup({}, async () => []);
    const id = await create();
    expect((await fill([id])).body.optionMissing).toEqual([{ tradeId: id, reason: "no_bars" }]);
  });

  it("drops an option range fetched while the contract was edited", async () => {
    let patchIt: (() => Promise<unknown>) | null = null;
    const { create, fill, trade, patch } = setup({}, async () => {
      await patchIt?.();
      return OPTION_SEP_28;
    });
    const id = await create();
    patchIt = () =>
      patch(id, {
        legs: [{ right: "C", strike: 235, expiry: "2026-09-28", quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
      });
    await fill([id]);
    expect((await trade(id)).scalpPrices?.optionHigh ?? null).toBeNull();
  });
```

  (The edit test follows whatever pattern the existing "edited while Alpaca answered" stock test uses; match its leg shape for `PATCH`.)
- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run apps/server/src/risk.test.ts`.
- [ ] **Step 3: Implement.** The new `scalpPrices.ts` run loop. Keep the file's existing helpers (`minuteOf`, `sameMinute`, `NO_KEY`, `UNREACHABLE`, `published`, the queue):

```ts
import {
  ALPACA_DELAY_MS,
  type HoldRange,
  holdRange,
  nyDate,
  nyWallClock,
  OPTION_BARS_SINCE,
  occSymbol,
  stockAt,
} from "@tj/core";
import { createTradesRepo, type Db, type ScalpPriceGap } from "@tj/db";
import { type BarAnswer, type BarService, BarsUnreachable, type OptionBarAnswer } from "./bars.js";

export interface ScalpPriceResult {
  /** Scalps this run stored a price for. */
  filled: number;
  // Spelled out rather than aliases: the web client infers these types and must be able to print them (TS2742).
  missing: { tradeId: string; reason: "no_bars" | "too_recent" }[];
  /** Scalps whose option range this run couldn't store (premium-chart spec §9.2). */
  optionMissing: { tradeId: string; reason: "no_bars" | "too_recent" | "unreachable" }[];
  unavailable: { reason: "no_key" | "unreachable"; message: string } | null;
}

const OPTION_EPOCH = nyWallClock(OPTION_BARS_SINCE, 0);

type StockFound = { entryPrice: number | null; holdHigh: number | null; holdLow: number | null };
type StockResult =
  | { found: StockFound | null; miss: "no_bars" | "too_recent" | null }
  | { unavailable: NonNullable<ScalpPriceResult["unavailable"]> };
type OptionResult = HoldRange | "no_bars" | "too_recent" | "unreachable" | "no_key";
```

Inside `createScalpPriceFiller`:

```ts
  /** The contract a scalp holds, when it holds exactly one. */
  function contractOf(tradeId: string): string | null {
    const trade = repo.get(tradeId);
    const leg = trade?.legs.length === 1 ? trade.legs[0] : undefined;
    if (!trade || !leg?.right || leg.strike == null || !leg.expiry) return null;
    return occSymbol({ underlying: trade.underlying, expiry: leg.expiry, right: leg.right, strike: leg.strike });
  }

  /** The user may have edited the trade while Alpaca answered; that edit deleted its prices, so these are dropped. */
  function unchanged(gap: ScalpPriceGap, contract: string | null): boolean {
    const current = repo.get(gap.tradeId);
    return (
      current != null &&
      current.underlying === gap.underlying &&
      sameMinute(current.openedAt, gap.openedAt) &&
      sameMinute(current.closedAt, gap.closedAt) &&
      contractOf(gap.tradeId) === contract
    );
  }

  /** The stock at entry and its range over the hold (scalp-R spec §7). */
  async function stockPrices(gap: ScalpPriceGap): Promise<StockResult> {
    if (!published(gap.openedAt)) return { found: null, miss: "too_recent" };
    // An open scalp's range waits for the close, so only its entry day is read.
    const last = gap.closedAt ?? gap.openedAt;
    let answer: BarAnswer;
    try {
      answer = await bars.minute(gap.underlying, nyDate(gap.openedAt), nyDate(last));
    } catch (error) {
      if (error instanceof BarsUnreachable) return { unavailable: UNREACHABLE };
      throw error;
    }
    if (answer.unavailable?.reason === "no_key") return { unavailable: NO_KEY };
    const entryBar = answer.bars.find((each) => each.t === minuteOf(gap.openedAt));
    const entryPrice = entryBar ? stockAt(entryBar, gap.openedAt) : null;
    const closeOut = gap.closedAt != null && published(gap.closedAt);
    // Once the close is published and the answer isn't cut short, these are all the bars there will be.
    const range =
      gap.closedAt != null && closeOut ? holdRange(answer.bars, gap.openedAt, gap.closedAt, !answer.partial) : null;
    let miss: "no_bars" | "too_recent" | null = null;
    if (entryPrice == null) miss = "no_bars";
    // A day still coming in may yet bring a bar at or after the exit: that's for later, not missing.
    else if (gap.closedAt != null && range == null) miss = closeOut && !answer.partial ? "no_bars" : "too_recent";
    const found =
      entryPrice != null || range != null
        ? { entryPrice, holdHigh: range?.high ?? null, holdLow: range?.low ?? null }
        : null;
    return { found, miss };
  }

  /** The contract's high and low over the hold (premium-chart spec §9.2). */
  async function optionRange(contract: string, openedAt: number, closedAt: number): Promise<OptionResult> {
    if (!published(closedAt)) return "too_recent";
    let answer: OptionBarAnswer;
    try {
      answer = await bars.optionMinute(contract, nyDate(openedAt), nyDate(closedAt));
    } catch (error) {
      if (error instanceof BarsUnreachable) return "unreachable";
      throw error;
    }
    if (answer.unavailable?.reason === "no_key") return "no_key";
    const range = holdRange(answer.bars, openedAt, closedAt, !answer.partial);
    return range ?? (answer.partial ? "too_recent" : "no_bars");
  }

  async function run(tradeIds?: readonly string[]): Promise<ScalpPriceResult> {
    let filled = 0;
    const missing: ScalpPriceResult["missing"] = [];
    const optionMissing: ScalpPriceResult["optionMissing"] = [];
    const stop = (unavailable: ScalpPriceResult["unavailable"]) => ({ filled, missing, optionMissing, unavailable });
    // Later option requests would fail the same way, but the stock prices are still worth fetching.
    let optionsDown = false;
    for (const gap of repo.missingScalpPrices(tradeIds)) {
      const contract = contractOf(gap.tradeId);
      let stock: StockFound | null = null;
      let stockMiss: "no_bars" | "too_recent" | null = null;
      if (gap.entryPrice == null || (gap.closedAt != null && gap.holdHigh == null)) {
        const result = await stockPrices(gap);
        // Later calls would fail the same way. What's written stays.
        if ("unavailable" in result) return stop(result.unavailable);
        ({ found: stock, miss: stockMiss } = result);
      }
      let option: HoldRange | null = null;
      let optionMiss: ScalpPriceResult["optionMissing"][number]["reason"] | null = null;
      if (contract && gap.closedAt != null && gap.openedAt >= OPTION_EPOCH && gap.optionHigh == null) {
        const result = optionsDown ? "unreachable" : await optionRange(contract, gap.openedAt, gap.closedAt);
        if (result === "no_key") return stop(NO_KEY);
        if (result === "unreachable") optionsDown = true;
        if (typeof result === "string") optionMiss = result;
        else option = result;
      }
      if (!unchanged(gap, contract)) continue;

      if (stock != null || option != null) {
        repo.setScalpPrices(
          gap.tradeId,
          {
            entryPrice: stock?.entryPrice ?? null,
            holdHigh: stock?.holdHigh ?? null,
            holdLow: stock?.holdLow ?? null,
            optionHigh: option?.high ?? null,
            optionLow: option?.low ?? null,
          },
          now(),
        );
        filled++;
      }
      if (stockMiss) missing.push({ tradeId: gap.tradeId, reason: stockMiss });
      if (optionMiss) optionMissing.push({ tradeId: gap.tradeId, reason: optionMiss });
    }
    return stop(null);
  }
```

  `holdRange` returns null when the bars have nothing between the entry and exit minutes, even with `complete`. So a complete answer without the hold reads `no_bars`.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/server`, plus `pnpm typecheck`. The web infers `PriceFillResult` from this, so it gains `optionMissing`.
- [ ] **Step 5: Commit:** `feat(server): the price filler stores each closed scalp's option range`.

---

### Task 7: web — option words, needsPrices, and the premium tiles

**Files:**
- Modify: `apps/web/src/review/prices.ts`, `apps/web/src/review/riskText.ts`, `apps/web/src/review/RiskTiles.tsx`, `apps/web/src/components/ui.tsx` (`Tile` takes `title`)
- Modify: the analytics backfill's "Fetching stock prices for N scalps…" copy, which becomes "Fetching prices for N scalps…", wherever `grep -rn "Fetching stock prices" apps/web/src` finds it
- Test: `apps/web/src/review/prices.test.tsx`, `riskText.test.ts`, `RiskTiles.test.tsx`

**Interfaces:**
- Consumes: `PriceFillResult.optionMissing` (Task 6), `OPTION_BARS_SINCE` (core).
- Produces:
  - `needsPrices(trade: Pick<TradeView, "strategy" | "openedAt" | "closedAt" | "legs" | "scalpPrices">)`;
  - `OPTION_RANGE_COPY`;
  - `useOptionRangeNote(tradeId): string`;
  - `riskTileText(risk, trade, rangeNote?)` reading `trade.scalpPrices.optionHigh/optionLow` on premium.

- [ ] **Step 1: Write the failing tests.**
  - `riskText.test.ts`:

```ts
it("reads a premium scalp's MAE and MFE on the option's range", () => {
  const prices = { entryPrice: STOCK, holdHigh: 233.21, holdLow: 230.71, optionHigh: 1.37, optionLow: 0.64 };
  const text = tiles({ scalpPrices: prices }, { levelBasis: "premium", stopPrice: 0.6, targets: [] });
  expect(text.mae).toEqual({ value: "−0.42", working: "−0.91R · option low 0.64" });
  expect(text.mfe).toEqual({ value: "+0.31", working: "+0.67R · option high 1.37" });
  const waiting = nvda({}, { levelBasis: "premium", stopPrice: 0.6 });
  expect(riskTileText(waiting.risk, waiting.trade, "waits for Alpaca's option delay").mae).toEqual({
    value: "—",
    working: "waits for Alpaca's option delay",
  });
});
```

  - `prices.test.tsx`:
    - `needsPrices` is true for a closed 2026 scalp with full stock prices and `optionHigh: null`;
    - false once `optionHigh` is set;
    - false for a 2023 scalp with full stock prices;
    - false for an open scalp;
    - `useAutoFillPrices` asks again a minute later when the run's `optionMissing` says `too_recent` for the trade. Copy the existing too_recent retry test, with the reason in `optionMissing` and `missing: []`;
    - `useOptionRangeNote` reads "waits for Alpaca's option delay" after such a run.
  - `RiskTiles.test.tsx`: the MAE tile's wrapper has the `title` "From the entry minute through the exit minute. Trades in your entry minute before your fill count too.", and a premium trade with `optionHigh: null` shows the option note.
- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run apps/web/src/review`.
- [ ] **Step 3: Implement.**
  - **`prices.ts`:**

```ts
import { nyWallClock, OPTION_BARS_SINCE } from "@tj/core";
type OptionReason = PriceFillResult["optionMissing"][number]["reason"];
const OPTION_EPOCH = nyWallClock(OPTION_BARS_SINCE, 0);

/** Whether a scalp still lacks a price the filler can fetch: the stock at entry, or, once it's closed, the stock's
 * range and, from Alpaca's option history on, the option's (premium-chart spec §9.1). */
export function needsPrices(
  trade: Pick<TradeView, "strategy" | "openedAt" | "closedAt" | "legs" | "scalpPrices">,
): boolean {
  if (trade.strategy !== "scalp") return false;
  const prices = trade.scalpPrices;
  if (prices == null || prices.entryPrice == null) return true;
  if (trade.closedAt == null) return false;
  return (
    prices.holdHigh == null ||
    (trade.openedAt >= OPTION_EPOCH && trade.legs.length === 1 && prices.optionHigh == null)
  );
}
```

    - In `useFillScalpPrices`, the merge adds `optionMissing: [...merged.optionMissing, ...result.optionMissing]`, starting from `optionMissing: []`.
    - Add next to `lastWord`:

```ts
/** The newest finished fill's word on this scalp's option range (premium-chart spec §9.4). */
function lastOptionWord(outcomes: readonly FillOutcome[], tradeId: string): OptionReason | "failed" | null {
  for (let index = outcomes.length - 1; index >= 0; index--) {
    const outcome = outcomes[index];
    if (!outcome) continue;
    if (!outcome.result) {
      if (outcome.tradeIds.includes(tradeId)) return "failed";
      continue;
    }
    const found = outcome.result.optionMissing.find((gap) => gap.tradeId === tradeId);
    if (found) return found.reason;
    if (outcome.tradeIds.includes(tradeId)) return null;
  }
  return null;
}

/** Why a closed scalp's premium MAE and MFE wait for the option's range, in the tiles' small print. */
export const OPTION_RANGE_COPY = {
  fetching: "fetching the option's range…",
  failed: "couldn't fetch the option's range",
  unreachable: "couldn't fetch the option's range",
  too_recent: "waits for Alpaca's option delay",
  no_bars: "Alpaca has no option bars for the hold",
  unavailable: "needs the option's range",
} as const;

export function useOptionRangeNote(tradeId: string): string {
  const fetching = useIsMutating({ mutationKey: PRICE_FILL_KEY }) > 0;
  const word = lastOptionWord(useFillResults(), tradeId);
  if (fetching) return OPTION_RANGE_COPY.fetching;
  return word == null ? OPTION_RANGE_COPY.unavailable : OPTION_RANGE_COPY[word];
}
```

    - In `useAutoFillPrices`: `const optionWord = lastOptionWord(results, trade.id);` and `const waiting = word === "too_recent" || word === "failed" || optionWord === "too_recent" || optionWord === "unreachable";`.
    - In `useBackfillPrices`, `later` also takes `result.optionMissing`'s `too_recent` ids, deduplicated: `const later = new Set<string>()`, then `setRecent([...later])`.
  - **`ui.tsx`:** `Tile` takes `title?: string` and puts it on the outer `div`.
  - **`riskText.ts`:**

```ts
  const premium = risk.basis === "premium";
  const prices = trade.scalpPrices;
  const low = premium ? `option low ${prices?.optionLow?.toFixed(2)}` : `stock low ${prices?.holdLow?.toFixed(2)}`;
  const high = premium ? `option high ${prices?.optionHigh?.toFixed(2)}` : `stock high ${prices?.holdHigh?.toFixed(2)}`;
  // A put gains as the stock falls; on premium every long option gains as its own price rises.
  const put = !premium && risk.right === "P";
```

    The default `rangeNote` stays "needs the stock's range". `RiskTileTrade`'s `scalpPrices` type takes the optional option fields.
  - **`RiskTiles.tsx`:** call both `useRangeNote(trade.id)` and `useOptionRangeNote(trade.id)`, and pass `risk.basis === "premium" ? optionNote : rangeNote`. Add `title` to the MAE and MFE entries of `TILES`, as `EXCURSION_TIP = "From the entry minute through the exit minute. Trades in your entry minute before your fill count too."`, and pass `title={tile.title}`.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/web`.
- [ ] **Step 5: Commit:** `feat(web): premium MAE and MFE in the tiles, and the option range in the price fill`.

---

### Task 8: web — the chart model, markers at price, whitespace, view switch in the toolbar

**Files:**
- Create: `apps/web/src/chart/option.ts`
- Modify: `apps/web/src/chart/model.ts`, `IntradayChart.tsx`, `ChartToolbar.tsx`, `testing.ts` (the fake time scale's `getVisibleRange`/`setVisibleRange`)
- Test: `apps/web/src/chart/model.test.ts`, `charts.test.tsx`, and a new `option.test.ts`

**Interfaces:**
- Produces:
  - `type ChartView = "stock" | "option"`;
  - `viewOf(basis: LevelBasis): ChartView`;
  - `contractOf(trade: { underlying: string; legs: readonly { right: string | null; strike: number | null; expiry: string | null }[] }): string | null`;
  - `contractName(trade): string`, e.g. "NVDA 232.5C Sep 26";
  - `clockText(t: number): string`, e.g. "09:52";
  - `arriveBy(openedAt: number, delayMinutes: number): string`, e.g. "10:08";
  - `Marker.price?: number`;
  - `intradayModel(bars, trade, minutes, emaLengths, options?: { slots?: boolean })`, with `IntradayModel.slots: number[] | null`;
  - `IntradayChart` props `markersAtPrice?: boolean`, `viewKey?: string`;
  - `ChartToolbar` prop `view?: { current: ChartView; onChange(view: ChartView): void }`.

- [ ] **Step 1: Write the failing tests.**
  - `option.test.ts`:

```ts
import { nyWallClock } from "@tj/core";
import { describe, expect, it } from "vitest";
import { arriveBy, clockText, contractName, contractOf, viewOf } from "./option.js";

const SCALP = {
  underlying: "NVDA",
  legs: [{ right: "C", strike: 232.5, expiry: "2026-09-26" }],
};

describe("the option view's helpers", () => {
  it("names a scalp's contract as Alpaca does, and as a trader reads it", () => {
    expect(contractOf(SCALP)).toBe("NVDA260926C00232500");
    expect(contractName(SCALP)).toBe("NVDA 232.5C Sep 26");
    expect(contractOf({ underlying: "AA", legs: [...SCALP.legs, ...SCALP.legs] })).toBeNull();
  });
  it("opens on the basis's view, and says when today's bars arrive", () => {
    expect(viewOf("premium")).toBe("option");
    expect(viewOf("stock")).toBe("stock");
    const opened = nyWallClock("2026-10-07", 592) + 40_000; // 09:52:40
    expect(clockText(opened)).toBe("09:52");
    expect(arriveBy(opened, 16)).toBe("10:08");
    expect(arriveBy(opened, 80)).toBe("11:12");
  });
});
```

  - `model.test.ts`:
    - `tradeMarks` gives fills their prices (`price: 1.06` and `1.295`), and a hand-typed single leg its open and close prices;
    - `intradayModel(bars, trade, 3, lengths, { slots: true })` returns `slots` equal to `sessionSlots(candles, 3)`, with the window counted over the slots. Use sparse bars, such as at 09:30, 09:45 and 10:30: the window's `from` is the slot index of the entry candle minus 20, clamped at 0;
    - without the option, `slots` is null.
  - `charts.test.tsx`:
    - with `model.slots`, the candle series' data holds whitespace items (`{ time }` only) for the empty slots, and its length equals the slots;
    - with `markersAtPrice`, the buy marker is `{ position: "atPriceTop", price: 1.06, shape: "arrowUp" }` and the sell is `{ position: "atPriceBottom", price: 1.295 }`;
    - **the time range survives a view switch:** render with `viewKey="stock"`, set the fake's visible range to the trade's minutes, rerender with another model and `viewKey="option"`, and expect `setVisibleRange` called with that range and no new logical range applied. A second rerender to a model with no candles in the range applies its window instead;
    - **ChartToolbar:** with `view`, the Stock and Option buttons show, with `aria-pressed` on the current one, and a click calls `onChange("option")`. On the Option view, the PM levels button is disabled with the title "Options don't trade premarket". Without `view` there's no switch.
- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run apps/web/src/chart`.
- [ ] **Step 3: Implement.**
  - **`option.ts`:**

```ts
import { type LevelBasis, nyClock, occSymbol } from "@tj/core";

/** Which intraday chart a scalp's page shows (premium-chart spec §6.1). */
export type ChartView = "stock" | "option";

/** The view a basis's levels are drawn on. */
export const viewOf = (basis: LevelBasis): ChartView => (basis === "premium" ? "option" : "stock");

interface ContractTrade {
  underlying: string;
  legs: readonly { right: string | null; strike: number | null; expiry: string | null }[];
}

/** The OCC code of a scalp's one contract, as Alpaca names it; null for anything else. */
export function contractOf(trade: ContractTrade): string | null {
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (!leg?.right || leg.strike == null || !leg.expiry) return null;
  return occSymbol({ underlying: trade.underlying, expiry: leg.expiry, right: leg.right, strike: leg.strike });
}

const EXPIRY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** The contract as a trader reads it: "NVDA 232.5C Sep 26". */
export function contractName(trade: ContractTrade): string {
  const leg = trade.legs[0];
  if (!leg?.expiry) return trade.underlying;
  return `${trade.underlying} ${leg.strike}${leg.right} ${EXPIRY.format(new Date(`${leg.expiry}T00:00:00Z`))}`;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** An instant's minute in New York: "09:52". */
export function clockText(t: number): string {
  const { minute } = nyClock(t);
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** When a minute's bars are out, `delayMinutes` after it (premium-chart spec §6.3). */
export const arriveBy = (openedAt: number, delayMinutes: number): string =>
  clockText(Math.floor(openedAt / 60_000) * 60_000 + delayMinutes * 60_000);
```

  - **`model.ts`:**
    - `Marker` gets `/** The fill's price, for the option view's markers (premium-chart spec §6.2). */ price?: number;`.
    - In `tradeMarks`, fills get `price: fill.price`. The hand-typed single leg gets `price: leg.openPrice` and, at the close, `price: leg.closePrice`.
    - `IntradayModel` gets `/** The option view's slots, empty ones included, which the chart's logical range counts in. */ slots: number[] | null;`.
    - `intradayModel(…, options: { slots?: boolean } = {})`: compute `const slots = options.slots ? sessionSlots(candles, minutes) : null;` and `window: openingWindow(slots ? slots.map((t) => ({ t })) : candles, marks)`, and return `slots`. Import `sessionSlots`.
  - **`IntradayChart.tsx`:**
    - `markerLook(marker, atPrice = false)`: when `atPrice && marker.price != null` and the side is buy, return `{ position: "atPriceTop" as const, shape: "arrowUp" as const, color: COLORS.up, price: marker.price }`; when sell, `{ position: "atPriceBottom" as const, shape: "arrowDown" as const, color: COLORS.down, price: marker.price }`. Otherwise keep what it does now.
    - Props: `markersAtPrice = false` and `viewKey = "stock"`.
    - Candle data: when `model.slots`, map each slot to the candle starting at it, as now, or to `{ time: seconds(t) }`.
    - **Keeping the time range** in the data effect:

```ts
  // The view the chart last drew, and one whose time range was kept on a switch (premium-chart spec §6.1).
  const drawnView = useRef<string | null>(null);
  const keptFor = useRef<string | null>(null);
```

      At the top of the `[model, viewKey, markersAtPrice]` effect: `const switched = drawnView.current != null && drawnView.current !== viewKey; const range = switched ? chart.chart.timeScale().getVisibleRange() : null; drawnView.current = viewKey;`. After the `setData` calls: `if (range && model.candles.some((candle) => seconds(candle.t) >= Number(range.from) && seconds(candle.t) <= Number(range.to))) { chart.chart.timeScale().setVisibleRange(range); keptFor.current = viewKey; }`.
      The window effect's deps become `[from, to, fitKey, viewKey]`, and it opens with `if (keptFor.current === viewKey) { keptFor.current = null; return; }`.
  - **`testing.ts`:** the fake `timeScale()` gets `getVisibleRange: () => library.visibleRange` and `setVisibleRange: (range) => { library.timeRanges.push(range); library.visibleRange = range; }`, with `visibleRange: null as unknown` and `timeRanges: [] as unknown[]` on `library`, both reset.
  - **`ChartToolbar.tsx`:** a `view` prop. After the timeframes, when given:

```tsx
      {view && (
        <>
          <span className="mx-1 h-4 w-px bg-line" />
          {(["stock", "option"] as const).map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={view.current === each}
              onClick={() => view.onChange(each)}
              className={`${BUTTON} ${on(view.current === each)}`}
            >
              {each === "stock" ? "Stock" : "Option"}
            </button>
          ))}
        </>
      )}
```

    The PM toggle gets `disabled={view?.current === "option"}`, the title "Options don't trade premarket" on the Option view, and `disabled:opacity-40`.
- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/web/src/chart`.
- [ ] **Step 5: Commit:** `feat(web): the option view's chart parts: fills at price, empty minutes, the switch, the time range kept`.

---

### Task 9: web — the Option view on a scalp's page

**Files:**
- Modify: `apps/web/src/chart/bars.ts` (`barRange`, `useOptionBars`), `apps/web/src/chart/TradeCharts.tsx`
- Modify: `apps/web/src/review/levels.ts` (`premiumChart`, `drawable`, `approxLines`), `ScalpWorkspace.tsx`, `LevelFields.tsx`
- Test: `apps/web/src/chart/TradeCharts.test.tsx`, `apps/web/src/review/ScalpWorkspace.test.tsx`, `levels.test.ts`

**Interfaces:**
- Consumes: Task 8's helpers and props; `GET /api/bars/option/:contract` (Task 5).
- Produces:
  - `barRange(trade: { openedAt: number; closedAt: number | null }): { firstDay: string; lastDay: string; from: string }`;
  - `useOptionBars(contract: string | null, from: string, to: string)`;
  - `TradeCharts` prop `option?: { contract: string; name: string; view: ChartView; onView(view: ChartView): void }`;
  - `useLevels(trade, { premiumChart }?)` with `Levels.drawable: boolean`;
  - `approxLines(risk: ScalpRisk | null): PriceLine[]`;
  - `LevelFields` prop `premiumNote?: string | null`.

- [ ] **Step 1: Write the failing tests.**
  - **`TradeCharts.test.tsx`.** Extend `stub` so URLs with `/api/bars/option/` answer from an `option` queue. Tests:
    - with `option={{ contract, name, view: "stock", onView }}`, the toolbar shows Stock and Option, and clicking Option calls `onView("option")`;
    - with `view: "option"`, it asks for `/api/bars/option/NVDA260926C00232500?from=2026-09-21&to=2026-09-28`, and the candle series holds the option bars;
    - "Loading the option chart…" shows while pending;
    - a 502 shows "Alpaca didn't answer." with a Retry that refetches;
    - `{ bars: [], partial: false, unavailable: { reason: "too_old", … } }` shows "Alpaca's option bars start on Jan 18, 2024.";
    - a `no_bars` answer shows "No option bars for NVDA 232.5C Sep 26.";
    - for a trade from today, `{ bars: [], partial: true, delayMinutes: 16 }` shows "This contract's bars from {clockText(openedAt)} arrive by {arriveBy(openedAt, 16)}." (build the trade's times from `todayNy()`);
    - with bars and `partial: true, delayMinutes: 80`, the banner "Alpaca's free option data runs up to 80 minutes behind." shows;
    - with no `option` prop, nothing asks for option bars.
  - **`ScalpWorkspace.test.tsx`.** The `TradeCharts` mock also shows `option?.view`, and has buttons that call `option.onView("stock")` and `option.onView("option")`. The test's fetch stub answers `/api/bars/option/` with bars, or with none. Tests:
    - a Premium scalp opens on "option", and switching the basis to Stock flips the view to "stock";
    - **on Premium, the Option view gets the STOP line and placing; flipping to Stock leaves no lines and placing "none"** (Review Focus 1);
    - **+ Stop on Premium, while on the Stock view, switches to "option" and arms "stop"**;
    - on Stock, the Option view gets "≈ STOP 0.54" and "≈ T1 …" lines from the live risk, and placing "none";
    - with no option bars, Premium + Stop opens the field without arming the chart, and the strip reads "No option bars for this contract: type the levels.".
  - **`levels.test.ts`:** `approxLines` gives "≈ STOP" at `optionAtStop` (rounded to the cent) and "≈ T1"/"≈ T2" at each target's `optionAt`. A null price draws nothing, the lines have no `id`, and `approxLines(null)` is `[]`.
- [ ] **Step 2: Run them to see them fail:** `pnpm vitest run apps/web/src/chart/TradeCharts.test.tsx apps/web/src/review`.
- [ ] **Step 3: Implement.**
  - **`bars.ts`:**

```ts
/** The days a trade's intraday charts ask for (spec §6): the warm-up week before it through its last day, at most
 * MAX_BAR_DAYS, so a trade held for months shows its last weeks. */
export function barRange(trade: { openedAt: number; closedAt: number | null }) {
  const firstDay = nyDate(trade.openedAt);
  const lastDay = trade.closedAt != null ? nyDate(trade.closedAt) : todayNy();
  const weekBefore = addDays(firstDay, -7);
  const earliest = addDays(lastDay, -MAX_BAR_DAYS);
  return { firstDay, lastDay, from: weekBefore > earliest ? weekBefore : earliest };
}

/** The contract's 1-minute bars (premium-chart spec §6.4), refreshed each minute while today's are coming in. */
export function useOptionBars(contract: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["option-bars", contract, from, to],
    enabled: contract != null,
    staleTime: (query) => (query.state.data?.partial ? 30_000 : Number.POSITIVE_INFINITY),
    refetchInterval: (query) => (query.state.data?.partial ? 60_000 : false),
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars.option[":contract"].$get({
        param: { contract: contract ?? "" },
        query: { from, to },
      });
      if (!res.ok) throw new Error(`option bars failed: ${res.status}`);
      return res.json();
    },
  });
}
```

    `TradeCharts` uses `barRange(trade)` in place of its own `firstDay`/`lastDay`/`weekBefore`/`earliest` lines.
  - **`TradeCharts.tsx`:**
    - Add the `option` prop. Call `const optionBars = useOptionBars(option?.contract ?? null, from, lastDay);`.
    - Build `optionModel` with `useMemo(() => intradayModel(optionBars.data?.bars ?? NO_BARS, chartTrade, prefs.minutes, prefs.emaLengths, { slots: true }), [...])`.
    - `const onOption = option?.view === "option"; const shown = onOption ? optionModel : intraday;`, and `hiddenEmas` reads `shown.emas`, adding the daily check only when `!onOption`.
    - Pass `view={option ? { current: option.view, onChange: option.onView } : undefined}` to `ChartToolbar`.
    - **The banner line on the Option view:** if `optionBars.isError && optionBars.data`, "Couldn't refresh the option chart: Alpaca didn't answer. Trying again in a minute."; else if `optionBars.data?.partial`, "Alpaca's free option data runs up to {delayMinutes} minutes behind.". The stock banners show on the Stock view.
    - **The intraday cell on the Option view**, when there's no chart to draw, is a 420px-tall centred box, the same height as the chart, holding:
      - `optionBars.isError && !optionBars.data` → `<p className="text-down">Alpaca didn't answer.</p>` and a Retry button (`aria-label="Retry the option chart"`, `onClick={() => optionBars.refetch()}`);
      - pending → "Loading the option chart…";
      - no bars → `optionEmptyText(optionBars.data, trade, option.name)`:

```ts
/** Why the option view has nothing to draw (premium-chart spec §8). */
function optionEmptyText(
  answer: { partial: boolean; delayMinutes: number; unavailable: { reason: string; message: string } | null },
  trade: { openedAt: number },
  name: string,
): string {
  if (answer.unavailable?.reason === "no_key" || answer.unavailable?.reason === "too_old") return answer.unavailable.message;
  if (answer.partial) return `This contract's bars from ${clockText(trade.openedAt)} arrive by ${arriveBy(trade.openedAt, answer.delayMinutes)}.`;
  return `No option bars for ${name}.`;
}
```

    - Otherwise `<IntradayChart model={shown} … markersAtPrice={onOption} viewKey={onOption ? "option" : "stock"} lines={levels?.lines} editing={levels?.editing} />`.
  - **`levels.ts`:**
    - `useLevels(trade: TradeView, { premiumChart = false }: { premiumChart?: boolean } = {})`, with `const drawable = basis === "stock" || premiumChart;`.
    - The lines memo returns `[]` when `!drawable` (in place of `basis !== "stock"`), with `drawable` in its deps.
    - `startTarget` arms when `drawable`, and `editing.placing` is `drawable ? placing : null`. Add `drawable` to `Levels` and its return.
    - Add:

```ts
/**
 * A stock-basis scalp's levels on the option view (premium-chart spec §7): faint, solid, not draggable, at the
 * option prices R estimates for them. A level with no option price draws nothing.
 */
export function approxLines(risk: ScalpRisk | null): PriceLine[] {
  if (!risk) return [];
  const stop: PriceLine[] =
    risk.optionAtStop == null
      ? []
      : [{ price: round2(risk.optionAtStop), dashed: false, color: COLORS.downFaint, label: "≈ STOP" }];
  return [
    ...stop,
    ...risk.targets.flatMap((target, index): PriceLine[] =>
      target.optionAt == null
        ? []
        : [{ price: round2(target.optionAt), dashed: false, color: COLORS.upFaint, label: `≈ T${index + 1}` }],
    ),
  ];
}
```

    `COLORS` in `style.ts` gets `upFaint: "rgba(38, 166, 154, 0.55)"` and `downFaint: "rgba(239, 83, 80, 0.55)"`.
  - **`LevelFields.tsx`:**
    - The `premiumNote?: string | null` prop replaces the fixed "Premium levels aren't drawn yet" paragraph with `{levels.basis === "premium" && premiumNote && (<p className="max-w-60 text-[10px] text-muted">{premiumNote}</p>)}`.
    - + Stop reads `if (levels.drawable) levels.setPlacing("stop");`.
  - **`ScalpWorkspace.tsx`:**

```tsx
export function ScalpWorkspace({ trade, onOpenTrade }: { trade: TradeDetailView; onOpenTrade?: (id: string) => void }) {
  const contract = contractOf(trade);
  const { from, lastDay } = barRange(trade);
  const optionBars = useOptionBars(contract, from, lastDay);
  const premiumChart = (optionBars.data?.bars.length ?? 0) > 0;
  const levels = useLevels(trade, { premiumChart });
  const home = viewOf(levels.basis);
  const [view, setView] = useState<ChartView>(home);
  // The view follows the basis, and + Stop or + Target brings up the chart that places it (premium-chart spec §6.1, §7).
  useEffect(() => setView(home), [home]);
  useEffect(() => {
    if (levels.placing) setView(home);
  }, [levels.placing, home]);
  useAutoFillPrices(trade);
  // Priced where the lines are right now, so the strip follows a drag (scalp-R spec §9.2).
  const live = scalpRisk(trade, { basis: levels.basis, stop: levels.stop.shown, targets: levels.targets.shown });
  const approx = approxLines(view === "option" && levels.basis === "stock" ? live : null);
  const approxKey = approx.map((line) => `${line.label}@${line.price}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the lines, which are rebuilt each render
  const approxShown = useMemo(() => approx, [approxKey]);
  const onHome = view === home;
  const chart = {
    lines: onHome ? levels.chart.lines : approxShown,
    editing: { ...levels.chart.editing, placing: onHome ? levels.chart.editing.placing : null },
  };
  const answer = optionBars.data;
  let premiumNote: string | null = null;
  if (levels.basis === "premium" && !premiumChart && answer) {
    premiumNote = answer.partial
      ? `The option chart's bars arrive by ${arriveBy(trade.openedAt, answer.delayMinutes)}: type the levels or wait.`
      : "No option bars for this contract: type the levels.";
  }
  return (
    <>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
      <TradeCharts
        trade={trade}
        levels={chart}
        option={contract ? { contract, name: contractName(trade), view, onView: setView } : undefined}
      />
      <ReviewPanel
        trade={trade}
        layout="strip"
        levels={
          <div className="flex flex-col gap-1.5">
            <LevelFields levels={levels} risk={live} premiumNote={premiumNote} />
            <RiskLine trade={trade} levels={levels} risk={live} />
          </div>
        }
      />
    </>
  );
}
```

- [ ] **Step 4: Run them to see them pass:** `pnpm vitest run apps/web`, then `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 5: Commit:** `feat(web): the Stock | Option switch on a scalp's page, with premium levels placed and dragged on the option chart`.

---

### Task 10: docs, the full check, and the live check

**Files:**
- Modify:
  - the spec: Status, plus deviations;
  - `docs/superpowers/specs/2026-09-29-trade-chart-design.md` §13 item 1;
  - `docs/superpowers/specs/2026-09-29-scalp-review-design.md` §8 and §16 item 1;
  - `docs/superpowers/specs/2026-09-29-scalp-r-design.md` §9.1;
  - `docs/superpowers/specs/2026-09-30-scalp-analytics-design.md` §1;
  - `README.md` (the features list, if it has one).

- [ ] **Step 1: Point the other specs here.** Per the spec's §11, add one line each, linking `2026-10-08-option-premium-chart-design.md`.
- [ ] **Step 2: Run the full check:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. Every test must pass, with the count recorded.
- [ ] **Step 3: Live check** on a scratchpad stand-in, following the visual-check recipe:
  - copy the real journal with `.backup()`;
  - add a scalp by hand with `POST /api/trades`: SPY 779C expiring 2026-10-06, bought 2 at 0.95 at 09:35:20 and sold at 1.20 at 10:02:05 on 2026-10-06 (adjust the fills to the bars the probe returned);
  - serve it on port 4199 with the real key.
- [ ] **Step 4: Time the endpoint and look.**
  - Time `GET /api/bars/option/SPY261006C00779000?from=2026-09-29&to=2026-10-06` cold, then cached.
  - Run `POST /api/risk/fill` and check the trade's `scalpPrices.optionHigh/optionLow`.
  - Take screenshots at 1280 and 1024 px with headless Firefox:
    - the Stock view;
    - the Option view, with fills at price and empty minutes;
    - Premium: + Stop placed by clicking the Option chart, then dragged;
    - Stock: the "≈" lines;
    - the premium MAE/MFE tiles;
    - a thin strike's gaps, from a second hand-added scalp far out of the money.
  - Stack them with ImageMagick and look once.
- [ ] **Step 5: Fold findings into the spec** (a "Live check (2026-10-08)" section and a deviations list), then commit: `docs: the premium chart's live check`.
- [ ] **Step 6: Run the final review, then hand off.**
  - Run a whole-branch review: superpowers:requesting-code-review.
  - Fix the Critical and Important findings test-first, and record the Minors in the spec.
  - Push `feat/premium-chart`, run `gh pr create`, and watch CI with `gh pr checks N --watch`.
  - When it's green, merge: `gh pr merge N --merge --match-head-commit <full sha>`. The user granted this for this run.
