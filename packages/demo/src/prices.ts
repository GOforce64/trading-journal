import {
  addDays,
  bsPrice,
  expiryMoment,
  intrinsic,
  isTradingDay,
  nyWallClock,
  type OptionRight,
  type PriceBar,
  REGULAR_OPEN,
  regularClose,
} from "@tj/core";
import { normal, type Rng, uniform } from "./random.js";
import { symbolInfo } from "./symbols.js";

const TRADING_DAYS_A_YEAR = 252;
/** The walk's drift: markets that end a little higher than they started. */
const DRIFT = 0.07;
const MINUTE_MS = 60_000;
/** As core's pricing counts a year. */
const YEAR_MS = 365 * 86_400_000;

export const cents = (value: number): number => Math.round(value * 100) / 100;

/** The sessions from `from` through `to`, both included. */
export function tradingDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) if (isTradingDay(date)) days.push(date);
  return days;
}

/**
 * Each session's open and close (demo spec §3.2): a geometric random walk with a small upward drift. A session in
 * `gaps` opens at the previous close moved by its gap (an earnings reaction); any other opens within 0.4% of it.
 */
export function dailyWalk(
  rng: Rng,
  symbol: string,
  sessions: readonly string[],
  gaps: ReadonlyMap<string, number>,
): Map<string, { open: number; close: number }> {
  const { start, vol } = symbolInfo(symbol);
  const walk = new Map<string, { open: number; close: number }>();
  const dt = 1 / TRADING_DAYS_A_YEAR;
  let previous = start;
  for (const date of sessions) {
    const gap = gaps.get(date);
    const open = cents(previous * (1 + (gap ?? uniform(rng, -0.004, 0.004))));
    const close = cents(open * Math.exp((DRIFT - (vol * vol) / 2) * dt + vol * Math.sqrt(dt) * normal(rng)));
    walk.set(date, { open, close });
    previous = close;
  }
  return walk;
}

/**
 * One session's 1-minute bars (demo spec §3.2): a Brownian bridge in log price from `open` to `close`, livelier in
 * the first and last half hour, each bar's high and low from three points inside its minute.
 */
export function minuteBars(
  rng: Rng,
  date: string,
  open: number,
  close: number,
  vol: number,
  volume: number,
): PriceBar[] {
  const count = regularClose(date) - REGULAR_OPEN;
  const weights = Array.from({ length: count }, (_, index) => (index < 30 || index >= count - 30 ? 2 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // The day's variance, shared out by weight, so a half day is as lively a minute as a full one.
  const dayVariance = ((vol * vol) / TRADING_DAYS_A_YEAR) * (count / 390);
  const walk = [0];
  for (const weight of weights) {
    walk.push((walk.at(-1) ?? 0) + Math.sqrt((dayVariance * weight) / total) * normal(rng));
  }
  const end = walk.at(-1) ?? 0;
  const lift = Math.log(close / open);
  const prices: number[] = [];
  let share = 0;
  for (let index = 0; index <= count; index++) {
    const fraction = share / total;
    prices.push(cents(open * Math.exp((walk[index] ?? 0) - fraction * end + fraction * lift)));
    share += weights[index] ?? 0;
  }
  prices[0] = open;
  prices[count] = close;

  // A session never spans a clock change, so its minutes follow from its open; New York time is slow to work out.
  const openAt = nyWallClock(date, REGULAR_OPEN);
  const bars: PriceBar[] = [];
  for (let index = 0; index < count; index++) {
    const o = prices[index] ?? open;
    const c = prices[index + 1] ?? close;
    const step = Math.sqrt((dayVariance * (weights[index] ?? 1)) / total);
    let h = Math.max(o, c);
    let l = Math.min(o, c);
    for (let sub = 1; sub <= 3; sub++) {
      const along = Math.log(o) + (Math.log(c) - Math.log(o)) * (sub / 4);
      const inside = cents(Math.exp(along + step * Math.sqrt((sub * (4 - sub)) / 16) * normal(rng)));
      h = Math.max(h, inside);
      l = Math.min(l, inside);
    }
    const middle = (index - count / 2) / (count / 2);
    const v = Math.round(volume * (0.6 + 1.6 * middle * middle) * uniform(rng, 0.6, 1.4));
    bars.push({ t: openAt + index * MINUTE_MS, o, h, l, c, v });
  }
  return bars;
}

/** A day's bar from its minutes: the first open, the highest high, the lowest low, the last close. */
export function dailyBar(date: string, minutes: readonly PriceBar[]): PriceBar {
  const first = minutes[0];
  const last = minutes.at(-1);
  if (!first || !last) throw new Error(`no minutes on ${date}`);
  return {
    t: nyWallClock(date, 0),
    o: first.o,
    h: Math.max(...minutes.map((bar) => bar.h)),
    l: Math.min(...minutes.map((bar) => bar.l)),
    c: last.c,
    v: minutes.reduce((sum, bar) => sum + bar.v, 0),
  };
}

/** A day's bar where no minutes were made: a range about one day's volatility wide around its open and close. */
export function syntheticDailyBar(
  rng: Rng,
  date: string,
  open: number,
  close: number,
  vol: number,
  volume: number,
): PriceBar {
  const range = (vol / Math.sqrt(TRADING_DAYS_A_YEAR)) * Math.max(open, close);
  return {
    t: nyWallClock(date, 0),
    o: open,
    h: cents(Math.max(open, close) + range * uniform(rng, 0.05, 0.5)),
    l: cents(Math.max(0.01, Math.min(open, close) - range * uniform(rng, 0.05, 0.5))),
    c: close,
    v: Math.round(volume * 390 * uniform(rng, 0.7, 1.3)),
  };
}

/** A contract the demo trades. */
export interface DemoContract {
  right: OptionRight;
  strike: number;
  expiry: string;
}

/**
 * The contract's 1-minute bars on the stock's (demo spec §2): Black-Scholes at each of the stock's prices, with the
 * IV moved up to 2% a minute, never below intrinsic plus a cent.
 */
export function optionBars(
  stock: readonly PriceBar[],
  contract: DemoContract,
  iv: number,
  rng: Rng,
): PriceBar[] {
  const { right, strike, expiry } = contract;
  const expiresAt = expiryMoment(expiry);
  return stock.map((bar) => {
    const sigma = iv * (1 + uniform(rng, -0.02, 0.02));
    const price = (S: number, at: number) =>
      cents(
        Math.max(
          bsPrice(right, S, strike, (expiresAt - at) / YEAR_MS, sigma),
          intrinsic(right, S, strike) + 0.01,
        ),
      );
    const o = price(bar.o, bar.t);
    const c = price(bar.c, bar.t + MINUTE_MS);
    // A call is dearest at the stock's high, a put at its low.
    const up = price(right === "C" ? bar.h : bar.l, bar.t);
    const down = price(right === "C" ? bar.l : bar.h, bar.t + MINUTE_MS);
    return {
      t: bar.t,
      o,
      h: Math.max(o, c, up, down),
      l: Math.min(o, c, up, down),
      c,
      v: Math.max(1, Math.round(bar.v / 2_000 + uniform(rng, 0, 40))),
    };
  });
}
