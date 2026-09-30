import { ALPACA_DELAY_MS, holdRange, nyDate, stockAt } from "@tj/core";
import { createTradesRepo, type Db, type ScalpPriceGap } from "@tj/db";
import { type BarAnswer, type BarService, BarsUnreachable } from "./bars.js";

export interface ScalpPriceResult {
  /** Scalps this run stored a price for. */
  filled: number;
  // Spelled out rather than aliases: the web client infers these types and must be able to print them (TS2742).
  missing: { tradeId: string; reason: "no_bars" | "too_recent" }[];
  unavailable: { reason: "no_key" | "unreachable"; message: string } | null;
}

export interface ScalpPriceFiller {
  /** Fetches the stock prices these scalps lack, or every scalp's without ids. One run at a time. */
  fill(tradeIds?: readonly string[]): Promise<ScalpPriceResult>;
}

const MINUTE = 60_000;
const minuteOf = (at: number) => Math.floor(at / MINUTE) * MINUTE;
const sameMinute = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && minuteOf(a) === minuteOf(b));

const NO_KEY = {
  reason: "no_key" as const,
  message: "Add an Alpaca key in Settings to fetch the stock price.",
};
const UNREACHABLE = {
  reason: "unreachable" as const,
  message: "Alpaca didn't answer. Reopen the trade to try again.",
};

/**
 * Fills scalps' stock prices from the bar service's minute bars (scalp-R spec §7): the stock at entry, interpolated by
 * the second, and the stock's range over the hold once the trade is closed. The chart has usually cached those bars,
 * so this seldom asks Alpaca for anything.
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

  /** The user may have edited the trade while Alpaca answered; that edit deleted its prices, so these are dropped. */
  function unchanged(gap: ScalpPriceGap): boolean {
    const current = repo.get(gap.tradeId);
    return (
      current != null &&
      current.underlying === gap.underlying &&
      sameMinute(current.openedAt, gap.openedAt) &&
      sameMinute(current.closedAt, gap.closedAt)
    );
  }

  async function run(tradeIds?: readonly string[]): Promise<ScalpPriceResult> {
    let filled = 0;
    const missing: ScalpPriceResult["missing"] = [];
    for (const gap of repo.missingScalpPrices(tradeIds)) {
      const miss = (reason: "no_bars" | "too_recent") => missing.push({ tradeId: gap.tradeId, reason });
      if (!published(gap.openedAt)) {
        miss("too_recent");
        continue;
      }
      // An open scalp's range waits for the close, so only its entry day is read.
      const last = gap.closedAt ?? gap.openedAt;
      let answer: BarAnswer;
      try {
        answer = await bars.minute(gap.underlying, nyDate(gap.openedAt), nyDate(last));
      } catch (error) {
        // Later calls would fail the same way. What's written stays.
        if (error instanceof BarsUnreachable) return { filled, missing, unavailable: UNREACHABLE };
        throw error;
      }
      if (answer.unavailable?.reason === "no_key") return { filled, missing, unavailable: NO_KEY };

      const entryBar = answer.bars.find((each) => each.t === minuteOf(gap.openedAt));
      const entryPrice = entryBar ? stockAt(entryBar, gap.openedAt) : null;
      const closeOut = gap.closedAt != null && published(gap.closedAt);
      // Once the close is published and the answer isn't cut short, these are all the bars there will be.
      const range =
        gap.closedAt != null && closeOut
          ? holdRange(answer.bars, gap.openedAt, gap.closedAt, !answer.partial)
          : null;
      if (!unchanged(gap)) continue;

      if (entryPrice != null || range != null) {
        repo.setScalpPrices(
          gap.tradeId,
          { entryPrice, holdHigh: range?.high ?? null, holdLow: range?.low ?? null },
          now(),
        );
        filled++;
      }
      if (entryPrice == null) miss("no_bars");
      else if (gap.closedAt != null && range == null) miss(closeOut ? "no_bars" : "too_recent");
    }
    return { filled, missing, unavailable: null };
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
