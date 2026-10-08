import { rText } from "../analytics/format.js";
import { usd } from "../components/ui.js";
import { clockText } from "./option.js";

/** What a day's-trades marker needs of a trade (missed-trades spec §6.4). */
export interface ContextTrade {
  id: string;
  strategy: string;
  book: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
  netPnl: number | null;
  legs: readonly { right: string; strike: number; quantity: number }[];
  risk?: { r: number | null } | null;
  missed: { direction: string; entryPrice: number; exitPrice: number | null } | null;
  missedRisk?: { r: number | null } | null;
}

/** One faint marker for another trade on the missed trade's chart. */
export interface ContextMark {
  tradeId: string;
  t: number;
  /** Where it sits on the price scale; null for a taken scalp's arrow, drawn above or below its candle. */
  price: number | null;
  kind: "buy" | "sell" | "missed";
  /** Shown beside the marker: a missed trade's entry says what it was. */
  label: string;
  /** The hover tooltip's lines. */
  tip: string[];
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const signedUsd = (value: number) => (value > 0 ? `+${usd(value)}` : usd(value));

function takenMarks(trade: ContextTrade): ContextMark[] {
  const leg = trade.legs[0];
  if (!leg) return [];
  const size = Math.abs(leg.quantity);
  const contracts = `${size} contract${size === 1 ? "" : "s"}`;
  const when =
    trade.closedAt == null
      ? `${clockText(trade.openedAt)} · open · ${contracts}`
      : `${clockText(trade.openedAt)} → ${clockText(trade.closedAt)} · ${contracts}`;
  const r = trade.risk?.r ?? null;
  const result = [trade.netPnl == null ? null : signedUsd(trade.netPnl), r == null ? null : rText(r)]
    .filter((part) => part != null)
    .join(" · ");
  const tip = [
    `Taken · ${trade.underlying} ${leg.strike}${leg.right} · ${capital(trade.book)}`,
    when,
    ...(result ? [result] : []),
  ];
  const marks: ContextMark[] = [
    { tradeId: trade.id, t: trade.openedAt, price: null, kind: "buy", label: "", tip },
  ];
  if (trade.closedAt != null) {
    marks.push({ tradeId: trade.id, t: trade.closedAt, price: null, kind: "sell", label: "", tip });
  }
  return marks;
}

function missedMarks(trade: ContextTrade): ContextMark[] {
  const levels = trade.missed;
  if (!levels) return [];
  const r = trade.missedRisk?.r ?? null;
  const exit =
    trade.closedAt != null && levels.exitPrice != null
      ? { t: trade.closedAt, price: levels.exitPrice }
      : null;
  const tip = [
    `Missed · ${capital(levels.direction)}`,
    exit
      ? `${clockText(trade.openedAt)} → ${clockText(exit.t)}`
      : `${clockText(trade.openedAt)} · no exit yet`,
    r == null ? "no R yet" : rText(r),
  ];
  const label = `Missed ${levels.direction}${r == null ? "" : ` ${rText(r)}`}`;
  const marks: ContextMark[] = [
    { tradeId: trade.id, t: trade.openedAt, price: levels.entryPrice, kind: "missed", label, tip },
  ];
  if (exit) marks.push({ tradeId: trade.id, t: exit.t, price: exit.price, kind: "missed", label: "", tip });
  return marks;
}

/** The day's other trades as faint markers: taken scalps' arrows, and missed trades' entries and exits. */
export function contextMarks(trades: readonly ContextTrade[]): ContextMark[] {
  return trades.flatMap((trade) => {
    if (trade.strategy !== "scalp") return [];
    return trade.book === "missed" ? missedMarks(trade) : takenMarks(trade);
  });
}

/** How near, in pixels, the pointer must be to a marker for its tooltip. */
const REACH_PX = 8;

/** The marker under the pointer, the closer of two, within reach. */
export function nearestMark(
  at: { x: number; y: number },
  placed: readonly { mark: ContextMark; x: number; y: number }[],
): ContextMark | null {
  let best: { mark: ContextMark; distance: number } | null = null;
  for (const each of placed) {
    const distance = Math.hypot(each.x - at.x, each.y - at.y);
    if (distance <= REACH_PX && (!best || distance < best.distance)) best = { mark: each.mark, distance };
  }
  return best?.mark ?? null;
}
