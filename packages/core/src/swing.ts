import { nyWallClock, regularClose, sessionsBetween } from "./calendar.js";
import { nyDate } from "./marks.js";
import { round2 } from "./money.js";

/** A swing's shapes (swing spec §3.1): one bought call or put, or a debit vertical. */
export const SWING_SHAPES = ["long_call", "long_put", "call_debit_spread", "put_debit_spread"] as const;
export type SwingShape = (typeof SWING_SHAPES)[number];

export const SWING_LABELS: Record<SwingShape, string> = {
  long_call: "Long call",
  long_put: "Long put",
  call_debit_spread: "Call debit spread",
  put_debit_spread: "Put debit spread",
};

/** What the user can choose for a single bought option (swing spec §3.5). */
export const CHOSEN_STRATEGIES = ["scalp", "swing"] as const;
export type ChosenStrategy = (typeof CHOSEN_STRATEGIES)[number];

export interface SwingShapeLeg {
  right: string;
  strike: number;
  expiry: string;
  quantity: number;
}

/**
 * The one rule for what a swing is, used by the model, the sync and the maths (spec §3.1). A debit vertical is one
 * long and one short leg of the same right and expiry, the same size, with the long strike nearer the money.
 */
export function swingShape(legs: readonly SwingShapeLeg[]): SwingShape | null {
  const [first, second] = legs;
  if (!first) return null;
  if (legs.length === 1) {
    if (first.quantity <= 0) return null;
    if (first.right === "C") return "long_call";
    return first.right === "P" ? "long_put" : null;
  }
  if (legs.length !== 2 || !second) return null;
  if (first.right !== second.right || first.expiry !== second.expiry) return null;
  if (first.quantity === 0 || first.quantity + second.quantity !== 0) return null;
  const long = first.quantity > 0 ? first : second;
  const short = first.quantity > 0 ? second : first;
  if (long.right === "C") return long.strike < short.strike ? "call_debit_spread" : null;
  if (long.right === "P") return long.strike > short.strike ? "put_debit_spread" : null;
  return null;
}

/** Calendar days from one YYYY-MM-DD date to another. */
export const calendarDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A closed trade's calendar days held, New York day to day: the one rule the scalp and swing stats share. */
export const daysHeldOf = (trade: { openedAt: number; closedAt: number }): number =>
  calendarDays(nyDate(trade.openedAt), nyDate(trade.closedAt));

/** Only a single bought call or put that isn't missed can be a scalp or a swing at the user's word (spec §3.5). */
export function canSwitchStrategy(trade: { book: string; legs: readonly { quantity: number }[] }): boolean {
  return trade.book !== "missed" && trade.legs.length === 1 && (trade.legs[0]?.quantity ?? 0) > 0;
}

/**
 * Whether a trade crossed a close (spec §5.3): it closed on a later New York day than it opened, or it's still open
 * after its opening day's regular close (13:00 on a half day).
 */
export function heldOvernight(trade: { openedAt: number; closedAt: number | null }, now: number): boolean {
  const openDay = nyDate(trade.openedAt);
  if (trade.closedAt != null) return nyDate(trade.closedAt) > openDay;
  return now >= nyWallClock(openDay, regularClose(openDay));
}

/** The "Held overnight: a swing?" hint: a switchable scalp the user hasn't decided on, held past a close. */
export function showsSwingHint(
  trade: {
    strategy: string;
    chosenStrategy?: string | null;
    book: string;
    legs: readonly { quantity: number }[];
    openedAt: number;
    closedAt: number | null;
  },
  now: number,
): boolean {
  return (
    trade.strategy === "scalp" &&
    trade.chosenStrategy == null &&
    canSwitchStrategy(trade) &&
    heldOvernight(trade, now)
  );
}

export interface SwingLeg extends SwingShapeLeg {
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}

export interface SwingTrade {
  legs: readonly SwingLeg[];
  netPnl: number | null;
  openedAt: number;
  closedAt: number | null;
}

export interface SwingMetrics {
  shape: SwingShape;
  /** The long leg's contracts. */
  contracts: number;
  /** The long open, less the short open on a spread. */
  debitPerShare: number;
  /** Gross, before fees, like the fly's credit. */
  debit: number;
  /** Spreads only: the distance between the strikes. */
  width: number | null;
  /** Spreads only: (width − debit per share) × multiplier × contracts. */
  maxProfit: number | null;
  breakEven: number;
  /** Closed spreads: net P&L over max profit. */
  pctOfMax: number | null;
  /** Closed swings: net P&L over the debit. */
  returnOnDebit: number | null;
  daysHeld: number;
  sessionsHeld: number;
  dteAtOpen: number;
  expiry: string;
}

const exact = (value: number) => Math.round(value * 1e6) / 1e6;

/** A swing's numbers, from its legs and P&L (spec §4.1); null when its legs aren't a swing shape. */
export function swingMetrics(trade: SwingTrade, today: string): SwingMetrics | null {
  const shape = swingShape(trade.legs);
  const long = trade.legs.find((leg) => leg.quantity > 0);
  if (!shape || !long) return null;
  const short = trade.legs.find((leg) => leg.quantity < 0) ?? null;
  const contracts = long.quantity;
  const debitPerShare = exact(long.openPrice - (short?.openPrice ?? 0));
  const debit = round2(debitPerShare * long.multiplier * contracts);
  const width = short ? exact(Math.abs(short.strike - long.strike)) : null;
  const maxProfit = width == null ? null : round2((width - debitPerShare) * long.multiplier * contracts);
  const net = trade.closedAt != null ? trade.netPnl : null;
  const openDay = nyDate(trade.openedAt);
  const endDay = trade.closedAt != null ? nyDate(trade.closedAt) : today;
  return {
    shape,
    contracts,
    debitPerShare,
    debit,
    width,
    maxProfit,
    breakEven: exact(long.right === "C" ? long.strike + debitPerShare : long.strike - debitPerShare),
    pctOfMax: net != null && maxProfit != null && maxProfit > 0 ? net / maxProfit : null,
    returnOnDebit: net != null && debit > 0 ? net / debit : null,
    daysHeld: calendarDays(openDay, endDay),
    sessionsHeld: sessionsBetween(openDay, endDay),
    dteAtOpen: calendarDays(openDay, long.expiry),
    expiry: long.expiry,
  };
}
