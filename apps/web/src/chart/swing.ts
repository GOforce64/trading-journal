import { ema, mondayOf, nyClock, type PriceBar, type SwingMetrics, weeklyBars } from "@tj/core";
import type { PriceLine } from "./IntradayChart.js";
import {
  type ChartFill,
  type DailyModel,
  dailyModel,
  drawable,
  type Marker,
  openingWindow,
  priceText,
} from "./model.js";

export type SwingPeriod = "daily" | "weekly";

/** A fill with its contract, so a day's fills can be sized per leg. */
export interface SwingChartFill extends ChartFill {
  right: string;
  strike: number;
}
export interface SwingChartLeg {
  right: string;
  strike: number;
  quantity: number;
  openPrice: number;
  closePrice: number | null;
}
export interface SwingChartTrade {
  openedAt: number;
  closedAt: number | null;
  fills: readonly SwingChartFill[];
  legs: readonly SwingChartLeg[];
}

/** A marker before it's placed on a candle: `key` is its New York day, or its week's Monday. */
export interface SwingMark {
  key: string;
  marker: Omit<Marker, "t">;
}

const STRIKE_COLOR = "#f48fb1";
const BREAK_EVEN_COLOR = "#9aa3b5";
/** Without fills to frame, the chart opens on its last 60 candles. */
const FALLBACK_VISIBLE = 60;
const EVENTS: Record<string, string> = {
  expiration: "expired",
  exercise: "exercised",
  assignment: "assigned",
};
const contractOf = (each: { right: string; strike: number }) => `${each.right}${each.strike}`;
const exact = (value: number) => Math.round(value * 1e6) / 1e6;

interface Group {
  key: string;
  cash: number;
  sizes: Map<string, number>;
}

/**
 * The swing's fills as markers (swing spec §4.3): per day (or week), the opening fills make one and the closing fills
 * another. Its size is the most contracts on any one leg, its price the net cash per spread: "B" when it paid, "S" when
 * it received. Expiries, exercises and assignments are markers of their own. A trade typed in by hand opens and closes
 * at its legs' prices.
 */
export function swingMarks(trade: SwingChartTrade, period: SwingPeriod): SwingMark[] {
  const keyOf = (t: number) => {
    const date = nyClock(t).date;
    return period === "weekly" ? mondayOf(date) : date;
  };
  const opensWith = new Map(trade.legs.map((leg) => [contractOf(leg), Math.sign(leg.quantity)]));
  let fills: readonly SwingChartFill[] = trade.fills.filter((fill) => !fill.canceled);
  if (fills.length === 0) {
    const closed = trade.closedAt;
    fills = [
      ...trade.legs.map((leg) => ({
        ...leg,
        executedAt: trade.openedAt,
        price: leg.openPrice,
        kind: "trade",
        canceled: false,
      })),
      ...(closed == null
        ? []
        : trade.legs.flatMap((leg) =>
            leg.closePrice == null
              ? []
              : [
                  {
                    ...leg,
                    quantity: -leg.quantity,
                    executedAt: closed,
                    price: leg.closePrice,
                    kind: "trade",
                    canceled: false,
                  },
                ],
          )),
    ];
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  const marks = new Map<string, SwingMark>();
  for (const fill of [...fills].sort((a, b) => a.executedAt - b.executedAt)) {
    const key = keyOf(fill.executedAt);
    const event = EVENTS[fill.kind];
    if (event) {
      const id = `${key}|${event}`;
      if (!marks.has(id)) {
        marks.set(id, { key, marker: { side: event === "expired" ? "expired" : "sell", text: event } });
        order.push(id);
      }
      continue;
    }
    const opening =
      Math.sign(fill.quantity) === (opensWith.get(contractOf(fill)) ?? Math.sign(fill.quantity));
    const id = `${key}|${opening ? "open" : "close"}`;
    let group = groups.get(id);
    if (!group) {
      group = { key, cash: 0, sizes: new Map() };
      groups.set(id, group);
      order.push(id);
    }
    group.cash += fill.price * fill.quantity;
    group.sizes.set(contractOf(fill), (group.sizes.get(contractOf(fill)) ?? 0) + Math.abs(fill.quantity));
  }
  return order.flatMap((id) => {
    const mark = marks.get(id);
    if (mark) return [mark];
    const group = groups.get(id);
    if (!group) return [];
    const size = Math.max(...group.sizes.values());
    const net = exact(group.cash / size);
    const paid = net > 0;
    return [
      {
        key: group.key,
        marker: {
          side: paid ? "buy" : "sell",
          text: `${paid ? "B" : "S"} ${size} @ ${priceText(Math.abs(net))}`,
          price: Math.abs(net),
        },
      },
    ];
  });
}

/**
 * Everything the swing chart draws (swing spec §5.4): daily candles, today's built from minute bars, or weekly ones
 * made of them; EMAs on the shown candles' closes; the markers on their candles; the trade framed with 20 either side.
 */
export function swingChartModel(
  daily: readonly PriceBar[],
  minuteBars: readonly PriceBar[],
  trade: SwingChartTrade,
  emaLengths: readonly number[],
  lastDay: string,
  period: SwingPeriod,
): DailyModel {
  const days = dailyModel(daily, minuteBars, trade, [], lastDay).candles;
  const candles = period === "weekly" ? weeklyBars(days) : days;
  const keyOf = (t: number) => {
    const date = nyClock(t).date;
    return period === "weekly" ? mondayOf(date) : date;
  };
  const candleOf = new Map(candles.map((candle) => [keyOf(candle.t), candle.t]));
  const markers = swingMarks(trade, period)
    .flatMap((mark): Marker[] => {
      const t = candleOf.get(mark.key);
      return t === undefined ? [] : [{ ...mark.marker, t }];
    })
    .sort((a, b) => a.t - b.t);
  const closes = candles.map((candle) => candle.c);
  return {
    candles,
    emas: emaLengths.map((length) => ({ length, points: drawable(candles, ema(closes, length)) })),
    markers,
    window:
      openingWindow(candles, markers) ??
      (candles.length === 0
        ? null
        : { from: Math.max(0, candles.length - FALLBACK_VISIBLE), to: candles.length - 1 }),
  };
}

/** Each strike and the break-even, titled on the price axis (swing spec §4.4). */
export function swingLines(metrics: SwingMetrics | null, legs: readonly { strike: number }[]): PriceLine[] {
  if (!metrics) return [];
  const strikes = [...new Set(legs.map((leg) => leg.strike))].sort((a, b) => a - b);
  return [
    ...strikes.map((strike) => ({ price: strike, color: STRIKE_COLOR, dashed: true, label: String(strike) })),
    {
      price: metrics.breakEven,
      color: BREAK_EVEN_COLOR,
      dashed: true,
      label: `BE ${priceText(metrics.breakEven)}`,
    },
  ];
}
