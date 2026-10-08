import {
  addDays,
  aggregate,
  type Candle,
  dailyFromMinutes,
  ema,
  nyClock,
  type PriceBar,
  sessionLevels,
  sessionSlots,
  vwap,
} from "@tj/core";

/** What the chart needs of a trade: its fills, or, for one typed in, its times and legs. */
export interface ChartFill {
  executedAt: number;
  quantity: number;
  price: number;
  kind: string;
  canceled: boolean;
}
export interface ChartTrade {
  openedAt: number;
  closedAt: number | null;
  fills: readonly ChartFill[];
  legs: readonly { quantity: number; openPrice: number; closePrice: number | null }[];
}

export interface Point {
  t: number;
  value: number;
}
export interface Marker {
  t: number;
  side: "buy" | "sell" | "expired" | "held";
  text: string;
  /** The fill's price, for the option view's markers (premium-chart spec §6.2). */
  price?: number;
}
export interface LevelLine {
  label: "PM H" | "PM L" | "PD H" | "PD L";
  kind: "pm" | "pd";
  price: number;
}
export interface EmaLine {
  length: number;
  points: Point[];
}
/** Candle indexes, as the chart's logical range. */
export interface ViewWindow {
  from: number;
  to: number;
}
export interface IntradayModel {
  candles: Candle[];
  emas: EmaLine[];
  vwap: Point[];
  levels: LevelLine[];
  /** The candles of the trade's first day, which the levels span. */
  levelTimes: number[];
  markers: Marker[];
  window: ViewWindow | null;
  /** The option view's slots, empty ones included, which the chart's logical range counts in. */
  slots: number[] | null;
  /** The 1-minute bars the candles are made of, which a missed trade's points are placed on (missed-trades §6.4). */
  bars: readonly PriceBar[];
}
export interface DailyModel {
  candles: PriceBar[];
  emas: EmaLine[];
  markers: Marker[];
  window: ViewWindow | null;
}

/** Candles shown either side of the trade when the chart opens (spec §8). */
export const WINDOW_PAD = 20;
/** About six months of trading days. */
const DAILY_VISIBLE = 126;

/** A price as the trader reads it: two decimals, or more when it has them (1.295). */
export function priceText(value: number): string {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6
    ? value.toFixed(2)
    : String(Number(value.toFixed(4)));
}

/** The trade's fills at their own times (spec §8), or, for a trade typed in by hand, its open and close. */
export function tradeMarks(trade: ChartTrade): Marker[] {
  const fills = trade.fills.filter((fill) => !fill.canceled);
  if (fills.length > 0) {
    return fills.map((fill): Marker => {
      if (fill.kind === "expiration") return { t: fill.executedAt, side: "expired", text: "expired" };
      const bought = fill.quantity > 0;
      return {
        t: fill.executedAt,
        side: bought ? "buy" : "sell",
        text: `${bought ? "B" : "S"} ${Math.abs(fill.quantity)} @ ${priceText(fill.price)}`,
        price: fill.price,
      };
    });
  }
  const [leg] = trade.legs;
  if (trade.legs.length === 1 && leg) {
    const long = leg.quantity > 0;
    const size = Math.abs(leg.quantity);
    const marks: Marker[] = [
      {
        t: trade.openedAt,
        side: long ? "buy" : "sell",
        text: `${long ? "B" : "S"} ${size} @ ${priceText(leg.openPrice)}`,
        price: leg.openPrice,
      },
    ];
    if (trade.closedAt != null && leg.closePrice != null) {
      marks.push({
        t: trade.closedAt,
        side: long ? "sell" : "buy",
        text: `${long ? "S" : "B"} ${size} @ ${priceText(leg.closePrice)}`,
        price: leg.closePrice,
      });
    }
    return marks;
  }
  const marks: Marker[] = [{ t: trade.openedAt, side: "buy", text: "Open" }];
  if (trade.closedAt != null) marks.push({ t: trade.closedAt, side: "sell", text: "Close" });
  return marks;
}

/** The index of the candle holding `t`: the last one that starts at or before it, or −1 before the first. */
function candleAt(candles: readonly { t: number }[], t: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((candles[middle]?.t ?? Number.POSITIVE_INFINITY) <= t) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** The candle holding `t` on its own New York day, else that day's first candle after it; none on a day without one. */
function sameDayCandle<T extends { t: number }>(candles: readonly T[], t: number): T | undefined {
  const date = nyClock(t).date;
  const index = candleAt(candles, t);
  const at = candles[index];
  if (at && nyClock(at.t).date === date) return at;
  const next = candles[index + 1];
  return next && nyClock(next.t).date === date ? next : undefined;
}

const drawable = (candles: readonly { t: number }[], values: readonly (number | null)[]): Point[] =>
  values.flatMap((value, index) => {
    const candle = candles[index];
    return value === null || !candle ? [] : [{ t: candle.t, value }];
  });

/**
 * The opening view (spec §8): WINDOW_PAD candles before the first mark to as many after the last. The end may lie past
 * the last candle, as empty space, so a live session's new candles don't move the view and undo the reader's zoom.
 */
function openingWindow(candles: readonly { t: number }[], marks: readonly Marker[]): ViewWindow | null {
  if (candles.length === 0 || marks.length === 0) return null;
  const times = marks.map((mark) => mark.t);
  const first = Math.max(0, candleAt(candles, Math.min(...times)));
  const last = Math.max(first, candleAt(candles, Math.max(...times)));
  return { from: Math.max(0, first - WINDOW_PAD), to: last + WINDOW_PAD };
}

/**
 * Everything the intraday chart draws, from 1-minute bars (spec §7–8). With `slots`, the option view's empty minutes
 * are counted too (premium-chart spec §6.2), so the window is in slots rather than candles.
 */
export function intradayModel(
  bars: readonly PriceBar[],
  trade: ChartTrade,
  minutes: number,
  emaLengths: readonly number[],
  options: { slots?: boolean } = {},
): IntradayModel {
  const candles = aggregate(bars, minutes);
  const slots = options.slots ? sessionSlots(candles, minutes) : null;
  const closes = candles.map((candle) => candle.c);
  const firstDay = nyClock(trade.openedAt).date;
  const found = sessionLevels(bars, firstDay);
  const levels = (
    [
      ["PM H", "pm", found.pmHigh],
      ["PM L", "pm", found.pmLow],
      ["PD H", "pd", found.pdHigh],
      ["PD L", "pd", found.pdLow],
    ] as const
  ).flatMap(([label, kind, price]): LevelLine[] => (price === null ? [] : [{ label, kind, price }]));
  const marks = tradeMarks(trade);
  const markers = marks
    .flatMap((mark) => {
      // The option view keeps a fill on its own day: a thin strike's last candle may be days old (premium-chart §6.2).
      const candle = slots ? sameDayCandle(candles, mark.t) : candles[candleAt(candles, mark.t)];
      return candle ? [{ ...mark, t: candle.t }] : [];
    })
    .sort((a, b) => a.t - b.t);
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    vwap: drawable(candles, vwap(bars, candles)),
    levels,
    levelTimes: candles.filter((candle) => nyClock(candle.t).date === firstDay).map((candle) => candle.t),
    markers,
    window: openingWindow(slots ? slots.map((t) => ({ t })) : candles, marks),
    slots,
    bars,
  };
}

/**
 * The daily chart beside it (spec §8). Alpaca's daily bars end the day before; the trade's own later days, such as
 * today, are built from their regular-session minute bars.
 */
export function dailyModel(
  daily: readonly PriceBar[],
  minuteBars: readonly PriceBar[],
  trade: ChartTrade,
  emaLengths: readonly number[],
  lastDay: string,
): DailyModel {
  const candles = [...daily];
  const firstDay = nyClock(trade.openedAt).date;
  const newest = candles.at(-1);
  const covered = newest ? nyClock(newest.t).date : "";
  for (let date = firstDay; date <= lastDay; date = addDays(date, 1)) {
    if (date <= covered) continue;
    const day = dailyFromMinutes(minuteBars, date);
    if (day) candles.push(day);
  }
  const closes = candles.map((candle) => candle.c);
  const markers = candles
    .filter((candle) => {
      const date = nyClock(candle.t).date;
      return date >= firstDay && date <= lastDay;
    })
    .map((candle): Marker => ({ t: candle.t, side: "held", text: "" }));
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    markers,
    window:
      candles.length === 0
        ? null
        : { from: Math.max(0, candles.length - DAILY_VISIBLE), to: candles.length - 1 },
  };
}
