/** Missed trades (missed-trades spec §4.1): a setup the user saw and didn't take, scored in R on the stock. */

/** Which way the missed trade would have gone. */
export const DIRECTIONS = ["long", "short"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What a missed trade stores (spec §3); the entry and exit times are the trade's `openedAt` and `closedAt`. */
export interface MissedLevels {
  direction: Direction;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
}

/** Why a missed trade has no R yet, checked in this order. */
export type MissedProblem = "no_stop" | "stop_at_entry" | "wrong_side" | "no_exit";

/**
 * A missed trade's stock R, worked out on read and never stored. Unrounded, like `scalpRisk`'s R: the display and the
 * rollups round.
 */
export interface MissedRisk {
  /** |entry − stop| per share; null without a stop, or with one on the wrong side. */
  risk: number | null;
  /** (exit − entry) ÷ risk, sign-adjusted for a short. */
  r: number | null;
  /** (target − entry) ÷ risk, sign-adjusted; null without a target, or with one on the losing side. */
  plannedRR: number | null;
  /** The hold's worst and best price against the entry, in R: mae ≤ 0 ≤ mfe. Null without the hold range or R. */
  mae: number | null;
  mfe: number | null;
  problem: MissedProblem | null;
}

/** The fields `missedRisk` reads, as a stored trade has them. */
export interface MissedRiskTrade {
  book: string;
  missed: MissedLevels | null;
  scalpPrices?: { holdHigh: number | null; holdLow: number | null } | null;
}

/** Below this, a stop is at the entry: prices are cents, so float noise is far smaller. */
const EPSILON = 1e-9;

const NONE: MissedRisk = { risk: null, r: null, plannedRR: null, mae: null, mfe: null, problem: null };

/** A missed trade's R; null for any other trade. `live` prices levels that are being dragged or typed. */
export function missedRisk(trade: MissedRiskTrade, live: Partial<MissedLevels> = {}): MissedRisk | null {
  if (trade.book !== "missed" || !trade.missed) return null;
  const levels = { ...trade.missed, ...live };
  const sign = levels.direction === "long" ? 1 : -1;
  const entry = levels.entryPrice;
  if (levels.stopPrice == null) return { ...NONE, problem: "no_stop" };
  const risk = (entry - levels.stopPrice) * sign;
  if (Math.abs(risk) < EPSILON) return { ...NONE, problem: "stop_at_entry" };
  if (risk < 0) return { ...NONE, problem: "wrong_side" };
  const inR = (price: number) => ((price - entry) * sign) / risk;
  const toTarget = levels.targetPrice == null ? null : inR(levels.targetPrice);
  const plannedRR = toTarget != null && toTarget > 0 ? toTarget : null;
  if (levels.exitPrice == null) return { ...NONE, risk, plannedRR, problem: "no_exit" };
  const high = trade.scalpPrices?.holdHigh ?? null;
  const low = trade.scalpPrices?.holdLow ?? null;
  let mae: number | null = null;
  let mfe: number | null = null;
  if (high != null && low != null) {
    const [adverse, favourable] = sign > 0 ? [low, high] : [high, low];
    // `|| 0` turns a -0 into 0, so it never prints as "−0.00R".
    mae = Math.min(0, inR(adverse)) || 0;
    mfe = Math.max(0, inR(favourable)) || 0;
  }
  return { risk, r: inR(levels.exitPrice), plannedRR, mae, mfe, problem: null };
}

/** A clicked price kept inside its bar, so a missed trade can't be marked where nothing traded (spec §6.4). */
export function snapToBar(price: number, bar: { high: number; low: number }): number {
  return Math.min(bar.high, Math.max(bar.low, price));
}

/**
 * A click on a candle of several minutes, put on the first minute inside it that traded the price, or the nearest one
 * when none did, so the point's time and price are a real minute's: the panel checks a price against its minute's bar.
 */
export function snapToMinute(
  price: number,
  minutes: readonly { t: number; high: number; low: number }[],
): { t: number; price: number } | null {
  let best: { t: number; price: number } | null = null;
  for (const minute of minutes) {
    const snapped = snapToBar(price, minute);
    if (!best || Math.abs(snapped - price) < Math.abs(best.price - price))
      best = { t: minute.t, price: snapped };
  }
  return best;
}
