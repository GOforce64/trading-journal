import { isTradingDay, nyDate, sessionMoment } from "@tj/core";
import { createTradesRepo, type Db, type PriceSide } from "@tj/db";
import type { MarketData } from "./marketData.js";

export interface MissingPrice {
  tradeId: string;
  underlying: string;
  side: PriceSide;
  // Spelled out rather than an alias: the web client infers this type and must be able to print it (TS2742).
  reason: "no_bars" | "no_session" | "too_recent";
}

export type MissingReason = MissingPrice["reason"];

export interface FillUnavailable {
  reason: "no_key" | "unreachable";
  message: string;
}

export interface FillResult {
  /** Prices this run wrote. */
  filled: number;
  /** Sides this run tried and couldn't fill. After a stop, sides not yet tried are left out. */
  missing: MissingPrice[];
  unavailable: FillUnavailable | null;
}

export interface MoveFiller {
  /** Fetches the missing stock prices of these flies, or of every fly without ids. One run at a time. */
  fill(tradeIds?: readonly string[]): Promise<FillResult>;
}

/** Alpaca's free plan shares SIP prices 15 minutes after the fact; a minute more allows for clock drift. */
export const RECENT_MS = 16 * 60_000;

const NO_KEY: FillUnavailable = {
  reason: "no_key",
  message: "Add an Alpaca key in Settings to fetch stock prices.",
};
const UNREACHABLE: FillUnavailable = {
  reason: "unreachable",
  message: "Alpaca didn't answer. Try Fill in missing again in a moment.",
};

/** Fills iron flies' stock prices at entry and exit from Alpaca's minute bars (spec §8.1). */
export function createMoveFiller({
  db,
  market,
  now = Date.now,
}: {
  db: Db;
  market?: MarketData;
  now?: () => number;
}): MoveFiller {
  const repo = createTradesRepo(db, now);
  let queue: Promise<unknown> = Promise.resolve();

  async function run(tradeIds?: readonly string[]): Promise<FillResult> {
    // Asked on every run, so a key saved in Settings is used straight away.
    const sources = market?.sources();
    if (!sources) return { filled: 0, missing: [], unavailable: NO_KEY };
    let filled = 0;
    const missing: MissingPrice[] = [];
    for (const gap of repo.missingPrices(tradeIds)) {
      const sides: [PriceSide, number][] = [];
      if (gap.missingEntry) sides.push(["entry", gap.openedAt]);
      if (gap.missingExit && gap.closedAt != null) sides.push(["exit", gap.closedAt]);
      for (const [side, at] of sides) {
        const miss = (reason: MissingReason) =>
          missing.push({ tradeId: gap.tradeId, underlying: gap.underlying, side, reason });
        const moment = sessionMoment(at);
        if (!isTradingDay(nyDate(moment))) {
          miss("no_session");
          continue;
        }
        if (moment > now() - RECENT_MS) {
          miss("too_recent");
          continue;
        }
        let price: number | null;
        try {
          price = await sources.bars.priceAt(gap.underlying, moment);
        } catch (error) {
          // Later calls would fail the same way. What's written stays.
          sources.report(error);
          return { filled, missing, unavailable: UNREACHABLE };
        }
        if (price == null) {
          miss("no_bars");
          continue;
        }
        // The user may have edited the trade while Alpaca answered. A price read for the old ticker or
        // minute would never be corrected, so it's dropped; the fill after that edit fetches the right one.
        const current = repo.get(gap.tradeId);
        const time = side === "entry" ? current?.openedAt : current?.closedAt;
        if (
          !current ||
          current.underlying !== gap.underlying ||
          time == null ||
          sessionMoment(time) !== moment
        ) {
          continue;
        }
        if (repo.setUnderlyingPrice(gap.tradeId, side, price)) filled++;
      }
    }
    return { filled, missing, unavailable: null };
  }

  return {
    fill(tradeIds) {
      // Queued, so a click during the fill after a save finds that price already written.
      const next = queue.then(() => run(tradeIds));
      queue = next.catch(() => {});
      return next;
    },
  };
}
