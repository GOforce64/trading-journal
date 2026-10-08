import { addDays, isTradingDay, nyDate, nyWallClock, occSymbol, type PriceBar } from "@tj/core";
import type { Db } from "@tj/db";
import { type EarningsEvent, earningsSchedule, type FlyPlan, planFly } from "./flies.js";
import { dailyBar, dailyWalk, minuteBars, syntheticDailyBar, tradingDays } from "./prices.js";
import { chance, int, pick, stream } from "./random.js";
import { planScalps, type ScalpPlan } from "./scalps.js";
import { FLY_SYMBOLS, SCALP_SYMBOLS, SYMBOLS, symbolInfo } from "./symbols.js";
import { type DemoBars, writeDemo } from "./write.js";

export interface DemoOptions {
  /** The last session to trade, YYYY-MM-DD. */
  end: string;
  seed?: number;
  months?: number;
  /** The clock the journal's own timestamps come from; by default the evening after `end`. */
  now?: () => number;
}

export interface DemoSummary {
  from: string;
  to: string;
  scalps: number;
  flies: number;
  bars: number;
}

/** How far back the daily chart reaches from a trade's last day (the server's `DAILY_DAYS`). */
const DAILY_REACH = 1_095;
/** How far before its entry a trade's minute chart starts (`barRange` in the web app). */
const MINUTE_REACH = 7;

/** The latest session before today in New York: the last one whose bars are all final. */
export function lastFinishedSession(now: number): string {
  let date = addDays(nyDate(now), -1);
  while (!isTradingDay(date)) date = addDays(date, -1);
  return date;
}

/**
 * Six months of fake trades and the bars their charts need (demo spec §3), written through the journal's own
 * repositories in one transaction. The same seed and end give the same trades, prices and bars.
 */
export function generateDemo(db: Db, options: DemoOptions): DemoSummary {
  const seed = options.seed ?? 42;
  const months = options.months ?? 6;
  const sessions = tradingDays(addDays(options.end, -Math.round(months * 30.4)), options.end);
  const first = sessions[0];
  const last = sessions.at(-1);
  if (!first || !last) throw new Error(`no sessions up to ${options.end}`);
  const now = options.now ?? (() => nyWallClock(addDays(last, 1), 18 * 60));
  const walkFrom = addDays(first, -DAILY_REACH);
  const walkSessions = tradingDays(walkFrom, last);

  const events = new Map<string, EarningsEvent[]>();
  for (const symbol of FLY_SYMBOLS) {
    events.set(symbol, earningsSchedule(stream(seed, `${symbol}:earnings`), symbol, sessions));
  }
  const walks = new Map(
    Object.keys(SYMBOLS).map((symbol) => {
      const gaps = new Map((events.get(symbol) ?? []).map((event) => [event.reactionDate, event.gap]));
      return [symbol, dailyWalk(stream(seed, `${symbol}:walk`), symbol, walkSessions, gaps)] as const;
    }),
  );

  // Each symbol's minute bars, made once a day on first use, bridged to the walk's close.
  const minutes = new Map<string, Map<string, PriceBar[]>>();
  const minutesOf = (symbol: string, date: string): PriceBar[] => {
    const days = minutes.get(symbol) ?? new Map<string, PriceBar[]>();
    minutes.set(symbol, days);
    const known = days.get(date);
    if (known) return known;
    const day = walks.get(symbol)?.get(date);
    if (!day) throw new Error(`no walk for ${symbol} on ${date}`);
    const { vol, volume } = symbolInfo(symbol);
    const bars = minuteBars(
      stream(seed, `${symbol}:${date}:minutes`),
      date,
      day.open,
      day.close,
      vol,
      volume,
    );
    days.set(date, bars);
    return bars;
  };

  const reviewedBefore = sessions.at(-3) ?? first;
  const scalps: ScalpPlan[] = [];
  for (const date of sessions) {
    const rng = stream(seed, `scalps:${date}`);
    if (!chance(rng, 0.6)) continue;
    const symbols = new Set([pick(rng, SCALP_SYMBOLS)]);
    if (chance(rng, 0.45)) symbols.add(pick(rng, SCALP_SYMBOLS));
    for (const symbol of symbols) {
      const rngFor = stream(seed, `${symbol}:${date}:scalps`);
      scalps.push(...planScalps(rngFor, date, symbol, minutesOf(symbol, date), date < reviewedBefore));
    }
  }
  const flies: FlyPlan[] = [];
  for (const [symbol, list] of events) {
    for (const event of list) {
      const rng = stream(seed, `${symbol}:${event.date}:fly`);
      flies.push(planFly(rng, event, minutesOf(symbol, event.entryDate), minutesOf(symbol, event.exitDate)));
    }
  }

  // Every chart range: the minute days each trade's chart asks for, and its contract's for a scalp.
  const minuteDays = new Map<string, Set<string>>();
  const options_ = new Map<string, { days: Set<string>; bars: Map<string, PriceBar[]> }>();
  const cover = (symbol: string, openedAt: number, closedAt: number): string[] => {
    const days: string[] = [];
    for (
      let date = addDays(nyDate(openedAt), -MINUTE_REACH);
      date <= nyDate(closedAt);
      date = addDays(date, 1)
    ) {
      days.push(date);
    }
    const known = minuteDays.get(symbol) ?? new Set<string>();
    minuteDays.set(symbol, known);
    for (const date of days) {
      known.add(date);
      if (isTradingDay(date) && date >= walkFrom) minutesOf(symbol, date);
    }
    return days;
  };
  for (const plan of scalps) {
    const days = cover(plan.symbol, plan.openedAt, plan.closedAt);
    const code = occSymbol({ underlying: plan.symbol, ...plan });
    const entry = options_.get(code) ?? { days: new Set<string>(), bars: new Map<string, PriceBar[]>() };
    options_.set(code, entry);
    for (const date of days) entry.days.add(date);
    entry.bars.set(nyDate(plan.openedAt), plan.optionBars);
  }
  for (const plan of flies) cover(plan.symbol, plan.openedAt, plan.closedAt);

  const bars: DemoBars = [];
  for (const symbol of Object.keys(SYMBOLS)) {
    const walk = walks.get(symbol);
    const made = minutes.get(symbol) ?? new Map<string, PriceBar[]>();
    const { vol, volume } = symbolInfo(symbol);
    const daily: { date: string; bars: PriceBar[] }[] = [];
    for (let date = walkFrom; date <= last; date = addDays(date, 1)) {
      const day = walk?.get(date);
      const own = made.get(date);
      if (!day) daily.push({ date, bars: [] });
      else if (own) daily.push({ date, bars: [dailyBar(date, own)] });
      else {
        const rng = stream(seed, `${symbol}:${date}:daily`);
        daily.push({ date, bars: [syntheticDailyBar(rng, date, day.open, day.close, vol, volume)] });
      }
    }
    bars.push({ symbol, timeframe: "1d", days: daily });
    const wanted = [...(minuteDays.get(symbol) ?? [])].sort();
    if (wanted.length > 0) {
      bars.push({
        symbol,
        timeframe: "1m",
        days: wanted.map((date) => ({ date, bars: made.get(date) ?? [] })),
      });
    }
  }
  for (const [code, entry] of options_) {
    const days = [...entry.days].sort().map((date) => ({ date, bars: entry.bars.get(date) ?? [] }));
    bars.push({ symbol: code, timeframe: "1m", days });
  }

  const written = writeDemo(db, {
    scalps,
    flies,
    bars,
    minutesOf,
    now,
    jitter: (key) => int(stream(seed, key), 3, 30),
  });
  return { from: first, to: last, scalps: scalps.length, flies: flies.length, bars: written };
}
