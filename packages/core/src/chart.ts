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
