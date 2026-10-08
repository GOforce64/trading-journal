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

export interface ScalpPriceFiller {
  /** Fetches the prices these scalps lack, or every scalp's without ids. One run at a time. */
  fill(tradeIds?: readonly string[]): Promise<ScalpPriceResult>;
}

const MINUTE = 60_000;
const minuteOf = (at: number) => Math.floor(at / MINUTE) * MINUTE;
const sameMinute = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && minuteOf(a) === minuteOf(b));

/** Alpaca's first option bars, as an instant (premium-chart spec §3). */
const OPTION_EPOCH = nyWallClock(OPTION_BARS_SINCE, 0);

interface StockFound {
  entryPrice: number | null;
  holdHigh: number | null;
  holdLow: number | null;
}
type StockResult =
  | { found: StockFound | null; miss: "no_bars" | "too_recent" | null }
  | { unavailable: NonNullable<ScalpPriceResult["unavailable"]> };
type OptionResult = HoldRange | "no_bars" | "too_recent" | "unreachable" | "no_key";

const NO_KEY = {
  reason: "no_key" as const,
  message: "Add an Alpaca key in Settings to fetch the stock price.",
};
const UNREACHABLE = {
  reason: "unreachable" as const,
  message: "Alpaca didn't answer. Reopen the trade to try again.",
};

/**
 * Fills scalps' prices from the bar service's minute bars (scalp-R spec §7): the stock at entry, interpolated by the
 * second, and, once the trade is closed, the stock's range over the hold and the contract's (premium-chart spec §9.2).
 * The charts have usually cached those bars, so this seldom asks Alpaca for anything.
 */
export function createScalpPriceFiller({
  db,
  bars,
  now = Date.now,
}: {
  db: Db;
  bars: BarService;
  now?: () => number;
}): ScalpPriceFiller {
  const repo = createTradesRepo(db, now);
  let queue: Promise<unknown> = Promise.resolve();
  // A minute's bar is out once the minute has closed and Alpaca's delay has passed.
  const published = (at: number) => minuteOf(at) + MINUTE <= now() - ALPACA_DELAY_MS;

  /** The contract a scalp holds, when it holds exactly one. */
  function contractOf(tradeId: string): string | null {
    const trade = repo.get(tradeId);
    const leg = trade?.legs.length === 1 ? trade.legs[0] : undefined;
    if (!trade || !leg) return null;
    return occSymbol({
      underlying: trade.underlying,
      expiry: leg.expiry,
      right: leg.right,
      strike: leg.strike,
    });
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

  /** The stock at entry, interpolated by the second, and its range over the hold (scalp-R spec §7). */
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
      gap.closedAt != null && closeOut
        ? holdRange(answer.bars, gap.openedAt, gap.closedAt, !answer.partial)
        : null;
    let miss: "no_bars" | "too_recent" | null = null;
    if (entryPrice == null) miss = "no_bars";
    // A day still coming in may yet bring a bar at or after the exit: that's for later, not missing.
    else if (gap.closedAt != null && range == null)
      miss = closeOut && !answer.partial ? "no_bars" : "too_recent";
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
    const answer = (unavailable: ScalpPriceResult["unavailable"]): ScalpPriceResult => ({
      filled,
      missing,
      optionMissing,
      unavailable,
    });
    // Later option requests would fail the same way, but the stock prices are still worth fetching.
    let optionsDown = false;
    for (const gap of repo.missingScalpPrices(tradeIds)) {
      const contract = contractOf(gap.tradeId);
      let stock: StockFound | null = null;
      let stockMiss: "no_bars" | "too_recent" | null = null;
      if (gap.entryPrice == null || (gap.closedAt != null && gap.holdHigh == null)) {
        const result = await stockPrices(gap);
        // Later calls would fail the same way. What's written stays.
        if ("unavailable" in result) return answer(result.unavailable);
        stock = result.found;
        stockMiss = result.miss;
      }
      let option: HoldRange | null = null;
      let optionMiss: ScalpPriceResult["optionMissing"][number]["reason"] | null = null;
      if (contract && gap.closedAt != null && gap.openedAt >= OPTION_EPOCH && gap.optionHigh == null) {
        const result = optionsDown ? "unreachable" : await optionRange(contract, gap.openedAt, gap.closedAt);
        if (result === "no_key") return answer(NO_KEY);
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
    return answer(null);
  }

  return {
    fill(tradeIds) {
      // Queued, so a second call finds what the first one wrote.
      const next = queue.then(() => run(tradeIds));
      queue = next.catch(() => {});
      return next;
    },
  };
}
