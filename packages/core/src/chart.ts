import { nyMinuteOfDay, nyWallClock } from "./calendar.js";
import { nyDate } from "./marks.js";

/** One bar of prices. `t` is its start, as epoch ms; `v` is shares. */
export interface PriceBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A candle on a chart's timeframe. `extended`: it starts outside the regular session, 09:30–16:00 ET. */
export interface Candle extends PriceBar {
  extended: boolean;
}

/** Minutes since midnight, New York. */
export const PREMARKET_OPEN = 4 * 60;
export const REGULAR_OPEN = 9 * 60 + 30;
export const REGULAR_CLOSE = 16 * 60;
export const SESSION_END = 20 * 60;
/** An EMA is drawn once it has this many times its length of values behind it (spec §7). */
export const EMA_WARMUP = 3;
/** The longest intraday range the server serves: a trade held a few weeks, plus its warm-up week. */
export const MAX_BAR_DAYS = 45;

const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const offsets = new Map<number, number>();

/**
 * The New York date and minute of an instant, fast enough for thousands of bars. New York's offset from UTC is
 * worked out once per hour, since it only changes on the hour (at 02:00), instead of formatting every instant.
 */
export function nyClock(t: number): { date: string; minute: number } {
  const hour = Math.floor(t / HOUR);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    const start = hour * HOUR;
    offset = Date.parse(`${nyDate(start)}T00:00:00Z`) + nyMinuteOfDay(start) * 60_000 - start;
    offsets.set(hour, offset);
  }
  const wall = t + offset;
  return {
    date: new Date(wall).toISOString().slice(0, 10),
    minute: Math.floor((((wall % DAY_MS) + DAY_MS) % DAY_MS) / 60_000),
  };
}

/**
 * Candles of `minutes` each from 1-minute bars, oldest first. Boundaries count from 04:00 ET, so a 3-minute
 * candle covers 09:30–09:33 as on TradingView, and 1-hour candles start at 04:00, 05:00 and so on. A candle
 * never spans two days; a minute without trades just leaves its candle with fewer bars.
 */
export function aggregate(bars: readonly PriceBar[], minutes: number): Candle[] {
  const candles: Candle[] = [];
  let current = "";
  for (const bar of bars) {
    const { date, minute } = nyClock(bar.t);
    const slot = PREMARKET_OPEN + Math.floor((minute - PREMARKET_OPEN) / minutes) * minutes;
    const key = `${date} ${slot}`;
    const last = candles.at(-1);
    if (last && key === current) {
      last.h = Math.max(last.h, bar.h);
      last.l = Math.min(last.l, bar.l);
      last.c = bar.c;
      last.v += bar.v;
      continue;
    }
    current = key;
    candles.push({
      t: bar.t - (minute - slot) * 60_000,
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
      extended: slot < REGULAR_OPEN || slot >= REGULAR_CLOSE,
    });
  }
  return candles;
}

/**
 * The exponential moving average: α = 2 ÷ (length + 1), seeded with the first value, as TradingView's `ta.ema`.
 * Values before index EMA_WARMUP × length − 1 are null: too little history for the seed to have faded.
 */
export function ema(values: readonly number[], length: number): (number | null)[] {
  const alpha = 2 / (length + 1);
  let current: number | null = null;
  return values.map((value, index) => {
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    return index >= EMA_WARMUP * length - 1 ? current : null;
  });
}

/** Midnight in New York on `date`, as Alpaca stamps a daily bar. */
export const nyMidnight = (date: string): number => nyWallClock(date, 0);

/**
 * Session VWAP (spec §7): the regular session only, 09:30–16:00 ET, restarting each day. Each 1-minute bar's
 * typical price, (h + l + c) ÷ 3, is weighted by its volume. Each candle gets the VWAP as of its last
 * regular-session minute, and null with none. `candles` must be built from the same bars.
 */
export function vwap(bars: readonly PriceBar[], candles: readonly Candle[]): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  let date = "";
  let weighted = 0;
  let volume = 0;
  let index = 0;
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date !== date) {
      date = clock.date;
      weighted = 0;
      volume = 0;
    }
    if (clock.minute < REGULAR_OPEN || clock.minute >= REGULAR_CLOSE) continue;
    weighted += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    volume += bar.v;
    while (index + 1 < candles.length && (candles[index + 1]?.t ?? Number.POSITIVE_INFINITY) <= bar.t)
      index++;
    const candle = candles[index];
    if (candle && candle.t <= bar.t && volume > 0) out[index] = weighted / volume;
  }
  return out;
}

export interface SessionLevels {
  pmHigh: number | null;
  pmLow: number | null;
  pdHigh: number | null;
  pdLow: number | null;
}

/**
 * The day's premarket high and low (04:00–09:29 ET), and the regular-session high and low of the last earlier
 * day that traded (spec §7): a holiday is skipped, and a half day's range is taken as it is.
 */
export function sessionLevels(bars: readonly PriceBar[], date: string): SessionLevels {
  let pmHigh: number | null = null;
  let pmLow: number | null = null;
  const regular = new Map<string, { h: number; l: number }>();
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date === date && clock.minute >= PREMARKET_OPEN && clock.minute < REGULAR_OPEN) {
      pmHigh = pmHigh === null ? bar.h : Math.max(pmHigh, bar.h);
      pmLow = pmLow === null ? bar.l : Math.min(pmLow, bar.l);
    } else if (clock.date < date && clock.minute >= REGULAR_OPEN && clock.minute < REGULAR_CLOSE) {
      const day = regular.get(clock.date);
      regular.set(
        clock.date,
        day ? { h: Math.max(day.h, bar.h), l: Math.min(day.l, bar.l) } : { h: bar.h, l: bar.l },
      );
    }
  }
  const prior = [...regular.keys()].sort().at(-1);
  const range = prior ? regular.get(prior) : undefined;
  return { pmHigh, pmLow, pdHigh: range?.h ?? null, pdLow: range?.l ?? null };
}

/**
 * A day's daily candle from its regular-session minute bars, stamped at New York midnight as Alpaca stamps daily
 * bars. The daily chart uses it for today, which Alpaca only has once the day is over. Null without bars.
 */
export function dailyFromMinutes(bars: readonly PriceBar[], date: string): PriceBar | null {
  let day: PriceBar | null = null;
  for (const bar of bars) {
    const clock = nyClock(bar.t);
    if (clock.date !== date || clock.minute < REGULAR_OPEN || clock.minute >= REGULAR_CLOSE) continue;
    if (!day) {
      day = { t: nyMidnight(date), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v };
      continue;
    }
    day.h = Math.max(day.h, bar.h);
    day.l = Math.min(day.l, bar.l);
    day.c = bar.c;
    day.v += bar.v;
  }
  return day;
}
