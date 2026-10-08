import {
  ALPACA_DELAY_MS,
  addDays,
  isTradingDay,
  nyClock,
  nyDate,
  nyWallClock,
  OPTION_BARS_SINCE,
  OPTION_LONG_DELAY_MS,
  optionClose,
  PREMARKET_OPEN,
  type PriceBar,
  REGULAR_OPEN,
  SESSION_END,
} from "@tj/core";
import { type BarTimeframe, createBarsRepo, type Db } from "@tj/db";
import { type OptionBarHistory, optionTooRecent, tooRecent } from "@tj/market-data";
import type { MarketData } from "./marketData.js";

/**
 * Three years of daily bars, about 750 trading days: EMA 167 draws from its 501st close, and the daily chart opens
 * on the last 126 (spec §6).
 */
const DAILY_DAYS = 1_095;

export interface BarAnswer {
  bars: PriceBar[];
  /** Today's bars stop short of now: Alpaca's free data runs 15 minutes behind. */
  partial: boolean;
  unavailable: { reason: "no_key" | "no_bars"; message: string } | null;
}

/** The option chart's answer (premium-chart spec §5.2): how far behind today's bars are, too. */
export interface OptionBarAnswer {
  bars: PriceBar[];
  partial: boolean;
  /** 16, or 80 once Alpaca has refused the short delay today. */
  delayMinutes: number;
  unavailable: { reason: "no_key" | "no_bars" | "too_old"; message: string } | null;
}

/** Alpaca failed, and the cache didn't cover the range. */
export class BarsUnreachable extends Error {
  constructor() {
    super("Alpaca didn't answer. Try again.");
    this.name = "BarsUnreachable";
  }
}

const NO_KEY = { reason: "no_key" as const, message: "Add your Alpaca key in Settings to see the chart." };
const noBars = (symbol: string) => ({ reason: "no_bars" as const, message: `No stock bars for ${symbol}.` });

const TOO_OLD = { reason: "too_old" as const, message: "Alpaca's option bars start on Jan 18, 2024." };
const noOptionBars = (contract: string) => ({
  reason: "no_bars" as const,
  message: `No option bars for ${contract}.`,
});

/** Every New York date from `from` to `to`, inclusive. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/**
 * The chart's bars (trade-chart spec §6): cached finished days, the missing ones fetched in one request and stored,
 * and today fetched on its own and never stored. Nothing is stored unless the fetch succeeded.
 */
export function createBarService({
  db,
  market,
  now = Date.now,
}: {
  db: Db;
  market?: MarketData;
  now?: () => number;
}) {
  const repo = createBarsRepo(db);

  async function fill(
    symbol: string,
    timeframe: BarTimeframe,
    missing: readonly string[],
    fetch: (first: string, last: string) => Promise<PriceBar[]>,
  ): Promise<void> {
    const first = missing[0];
    const last = missing.at(-1);
    if (!first || !last) return;
    const byDay = new Map<string, PriceBar[]>();
    for (const bar of await fetch(first, last)) {
      const date = nyClock(bar.t).date;
      const day = byDay.get(date);
      if (day) day.push(bar);
      else byDay.set(date, [bar]);
    }
    repo.store(
      symbol,
      timeframe,
      missing.map((date) => ({ date, bars: byDay.get(date) ?? [] })),
      now(),
    );
  }

  // The New York date Alpaca last refused option bars at the short delay: the long one holds for the rest of it.
  let longDelayOn: string | null = null;

  /** Today's option bars, at the short delay, or at the long one once Alpaca refuses it (premium-chart spec §5.2). */
  async function todaysOptionBars(
    history: OptionBarHistory,
    contract: string,
    today: string,
  ): Promise<{ bars: PriceBar[]; partial: boolean }> {
    const start = nyWallClock(today, 0);
    const close = nyWallClock(today, optionClose(today));
    const ask = async (delay: number) => {
      const end = Math.min(close, now() - delay);
      return {
        bars: end > start ? await history.minuteBars(contract, start, end) : [],
        partial: end < close,
      };
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

  return {
    async minute(symbol: string, from: string, to: string): Promise<BarAnswer> {
      const today = nyDate(now());
      const last = to < today ? to : today;
      const finished = datesBetween(from, last).filter((date) => date < today);
      const known = repo.knownDays(symbol, "1m", finished);
      const missing = finished.filter((date) => !known.has(date));
      // A weekend or holiday has no session, and a session day none before the premarket opens: nothing to fetch,
      // and nothing partial about it.
      const wantsToday =
        last === today && from <= today && isTradingDay(today) && nyClock(now()).minute >= PREMARKET_OPEN;
      const sources = market?.sources() ?? null;
      if ((missing.length > 0 || wantsToday) && !sources)
        return { bars: [], partial: false, unavailable: NO_KEY };

      let todays: PriceBar[] = [];
      let partial = false;
      try {
        if (sources && missing.length > 0) {
          // Just after midnight, the next midnight is inside Alpaca's 15-minute window, which it refuses.
          await fill(symbol, "1m", missing, (first, lastDay) =>
            sources.history.minuteBars(
              symbol,
              nyWallClock(first, 0),
              Math.min(nyWallClock(addDays(lastDay, 1), 0), now() - ALPACA_DELAY_MS),
            ),
          );
        }
        if (sources && wantsToday) {
          const start = nyWallClock(today, 0);
          const close = nyWallClock(today, SESSION_END);
          const end = Math.min(close, now() - ALPACA_DELAY_MS);
          partial = end < close;
          if (end > start) {
            todays = await sources.history.minuteBars(symbol, start, end).catch((error: unknown) => {
              if (tooRecent(error)) return [];
              throw error;
            });
          }
        }
      } catch (error) {
        sources?.report(error);
        throw new BarsUnreachable();
      }

      const lastFinished = finished.at(-1);
      const cached = lastFinished
        ? repo.read(symbol, "1m", nyWallClock(from, 0), nyWallClock(addDays(lastFinished, 1), 0) - 1)
        : [];
      const all = [...cached, ...todays];
      return { bars: all, partial, unavailable: all.length === 0 ? noBars(symbol) : null };
    },

    async daily(symbol: string, to: string): Promise<BarAnswer> {
      const today = nyDate(now());
      const last = to < today ? to : addDays(today, -1);
      const dates = datesBetween(addDays(last, -DAILY_DAYS), last);
      const known = repo.knownDays(symbol, "1d", dates);
      const missing = dates.filter((date) => !known.has(date));
      const sources = market?.sources() ?? null;
      if (missing.length > 0 && !sources) return { bars: [], partial: false, unavailable: NO_KEY };
      try {
        if (sources && missing.length > 0) {
          await fill(symbol, "1d", missing, (first, lastDay) =>
            sources.history.dailyBars(symbol, first, lastDay),
          );
        }
      } catch (error) {
        sources?.report(error);
        throw new BarsUnreachable();
      }
      const first = dates[0] ?? last;
      const all = repo.read(symbol, "1d", nyWallClock(first, 0), nyWallClock(last, 0));
      return { bars: all, partial: false, unavailable: all.length === 0 ? noBars(symbol) : null };
    },

    /** One contract's 1-minute bars (premium-chart spec §5.2), cached by its code like a stock's. */
    async optionMinute(contract: string, from: string, to: string): Promise<OptionBarAnswer> {
      const today = nyDate(now());
      const delayMinutes = () => (longDelayOn === today ? OPTION_LONG_DELAY_MS : ALPACA_DELAY_MS) / 60_000;
      if (to < OPTION_BARS_SINCE) {
        return { bars: [], partial: false, delayMinutes: delayMinutes(), unavailable: TOO_OLD };
      }
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
        if (sources && wantsToday) {
          ({ bars: todays, partial } = await todaysOptionBars(sources.optionHistory, contract, today));
        }
      } catch (error) {
        // A refusal is Alpaca's delay, not a bad key: report() would mark the key rejected for any 403.
        if (!optionTooRecent(error)) sources?.report(error);
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
        // An empty today still coming in isn't "no bars": the page says when they arrive (spec §6.3).
        unavailable: all.length === 0 && !partial ? noOptionBars(contract) : null,
      };
    },
  };
}

export type BarService = ReturnType<typeof createBarService>;
