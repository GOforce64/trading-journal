import { nyDate } from "./marks.js";
import {
  type BreakdownContext,
  type BreakdownRow,
  groupStats,
  type ScalpStatLeg,
  type ScalpStatTrade,
  scalpBreakdown,
} from "./scalpStats.js";
import { daysToExpiry, groupTrades } from "./splits.js";
import { type Closed, type Summary, summarize } from "./stats.js";
import { daysHeldOf, SWING_LABELS, SWING_SHAPES, swingMetrics, swingShape } from "./swing.js";

/** The Swings tab (swing spec §4.5, §6.3): buckets, the KPI strip and the breakdowns. */

export const DAYS_HELD_BUCKETS = ["same day", "1–2", "3–5", "6–10", "11–20", "21+"] as const;
export const DTE_BUCKETS = ["0–7", "8–21", "22–45", "46–90", "90+"] as const;
export const SWING_BREAKDOWNS = [
  "structure",
  "held",
  "dte",
  "setup",
  "ticker",
  "weekday",
  "grade",
  "emotion",
  "book",
  "month",
] as const;
export type SwingBreakdown = (typeof SWING_BREAKDOWNS)[number];

export interface SwingStatLeg extends ScalpStatLeg {
  strike: number;
  closePrice: number | null;
}

/** What the swing statistics read. The web app's trade rows satisfy it as they are. */
export interface SwingStatTrade extends ScalpStatTrade {
  legs: readonly SwingStatLeg[];
}

export type ClosedSwing = Closed<SwingStatTrade>;

const UNKNOWN = "unknown";

export function daysHeldBucket(days: number): string {
  if (days <= 0) return "same day";
  if (days <= 2) return "1–2";
  if (days <= 5) return "3–5";
  if (days <= 10) return "6–10";
  return days <= 20 ? "11–20" : "21+";
}

export function dteBucket(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 7) return "0–7";
  if (days <= 21) return "8–21";
  if (days <= 45) return "22–45";
  return days <= 90 ? "46–90" : "90+";
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export interface SwingSummary extends Summary {
  avgReturn: number | null;
  returnCount: number;
  avgDaysHeld: number | null;
  /** Over the spreads only, which have a max profit. */
  avgPctOfMax: number | null;
  spreads: number;
}

/** The Swings tab's KPI strip (spec §6.3). Expects trades in close order, as `closedTrades` returns them. */
export function swingSummary(trades: readonly ClosedSwing[]): SwingSummary {
  const metrics = trades.flatMap((trade) => {
    const each = swingMetrics(trade, nyDate(trade.closedAt));
    return each ? [each] : [];
  });
  const returns = metrics.flatMap((each) => (each.returnOnDebit == null ? [] : [each.returnOnDebit]));
  const ofMax = metrics.flatMap((each) => (each.pctOfMax == null ? [] : [each.pctOfMax]));
  return {
    ...summarize(trades),
    avgReturn: mean(returns),
    returnCount: returns.length,
    avgDaysHeld: mean(trades.map(daysHeldOf)),
    avgPctOfMax: mean(ofMax),
    spreads: metrics.filter((each) => each.width != null).length,
  };
}

const toRows = (groups: [string, ClosedSwing[]][]): BreakdownRow[] =>
  groups.map(([label, members]) => ({ label, ...groupStats(members) }));

/** One dimension's rows (spec §6.3). The dimensions swings share with scalps come from `scalpBreakdown`. */
export function swingBreakdown(
  trades: readonly ClosedSwing[],
  by: SwingBreakdown,
  context: BreakdownContext,
): BreakdownRow[] {
  switch (by) {
    case "structure":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const shape = swingShape(trade.legs);
            return shape ? SWING_LABELS[shape] : UNKNOWN;
          },
          SWING_SHAPES.map((shape) => SWING_LABELS[shape]),
        ),
      );
    case "held":
      return toRows(groupTrades(trades, (trade) => daysHeldBucket(daysHeldOf(trade)), DAYS_HELD_BUCKETS));
    case "dte":
      return toRows(groupTrades(trades, (trade) => dteBucket(daysToExpiry(trade)), DTE_BUCKETS));
    default:
      return scalpBreakdown(trades, by, context);
  }
}
