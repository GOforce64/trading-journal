import { nyMinuteOfDay } from "./calendar.js";
import { type ReturnTrade, returnOnCost } from "./risk.js";
import { groupTrades } from "./splits.js";
import { type Closed, type StatTrade, type Summary, summarize } from "./stats.js";

/** The scalp analytics (scalp-analytics spec §6, §7, §9): time buckets, breakdowns, mistake cost and setup cards. */

export interface ScalpStatLeg {
  right: string;
  expiry: string;
  quantity: number;
  multiplier: number;
  openPrice: number;
}

/** What the scalp statistics read. The web app's trade rows satisfy it as they are. */
export interface ScalpStatTrade extends StatTrade, ReturnTrade {
  book: string;
  setupId: string | null;
  grade: string | null;
  tagIds: readonly string[];
  legs: readonly ScalpStatLeg[];
  risk?: { r: number | null; problem: string | null } | null;
}

export type ClosedScalp = Closed<ScalpStatTrade>;

const UNKNOWN = "unknown";
const MINUTE = 60_000;
/** 09:30 in minutes since midnight. */
const OPEN = 9 * 60 + 30;

export const OPEN_BUCKETS = ["0–5", "5–15", "15–30", "30–60", "60+"] as const;
export const HOLD_TIME_BUCKETS = ["< 1 min", "1–3", "3–10", "10–30", "30+"] as const;
export const BEFORE_OPEN = "before open";

/** Minutes from 09:30 New York to the first entry, by the minute: 09:34:59 is 4. */
export const minutesAfterOpen = (openedAt: number): number => nyMinuteOfDay(openedAt) - OPEN;

/** Minutes held: close − open. */
export const holdMinutes = (trade: { openedAt: number; closedAt: number }): number =>
  (trade.closedAt - trade.openedAt) / MINUTE;

/** The minutes-after-open bucket (spec §6.3); each includes its lower edge. */
export function openBucket(minutes: number): string {
  if (minutes < 0) return BEFORE_OPEN;
  if (minutes < 5) return "0–5";
  if (minutes < 15) return "5–15";
  if (minutes < 30) return "15–30";
  return minutes < 60 ? "30–60" : "60+";
}

/** The hold-time bucket (spec §6.3); each includes its lower edge. `calendar.ts`'s `holdBucket` is the flies'. */
export function holdTimeBucket(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return UNKNOWN;
  if (minutes < 1) return "< 1 min";
  if (minutes < 3) return "1–3";
  if (minutes < 10) return "3–10";
  return minutes < 30 ? "10–30" : "30+";
}

/** The numbers every row of the Scalps tab shows. */
export interface GroupStats {
  trades: number;
  /** Null with no trades. */
  winRate: number | null;
  net: number;
  profitFactor: number | null;
  /** The mean R of the trades that have one, to 0.01. */
  avgR: number | null;
  rCount: number;
  /** The mean return on cost of the trades that have one: 0.084 is +8.4%. */
  avgReturn: number | null;
  returnCount: number;
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const returnsOf = (trades: readonly ClosedScalp[]) =>
  trades.flatMap((trade) => {
    const value = returnOnCost(trade);
    return value == null ? [] : [value];
  });

export function groupStats(trades: readonly ClosedScalp[]): GroupStats {
  const summary = summarize(trades);
  const returns = returnsOf(trades);
  return {
    trades: summary.trades,
    winRate: summary.winRate,
    net: summary.net,
    profitFactor: summary.profitFactor,
    avgR: summary.avgR,
    rCount: summary.rCount,
    avgReturn: mean(returns),
    returnCount: returns.length,
  };
}

/** How many scalps have an R, and why the rest don't (spec §6.2). */
export interface Coverage {
  total: number;
  withR: number;
  noStop: number;
  noStockPrice: number;
  /** Any other reason: the stop on the wrong side, a model that can't price, not a single long option. */
  cannotPrice: number;
}

export function rCoverage(trades: readonly ClosedScalp[]): Coverage {
  const coverage: Coverage = { total: trades.length, withR: 0, noStop: 0, noStockPrice: 0, cannotPrice: 0 };
  for (const trade of trades) {
    if (trade.risk?.r != null) coverage.withR++;
    else if (trade.risk?.problem === "no_stop") coverage.noStop++;
    else if (trade.risk?.problem === "no_stock_price") coverage.noStockPrice++;
    else coverage.cannotPrice++;
  }
  return coverage;
}

export interface ScalpSummary extends Summary {
  avgReturn: number | null;
  returnCount: number;
  avgHoldMinutes: number | null;
  medianHoldMinutes: number | null;
  coverage: Coverage;
}

/** The Scalps tab's KPI strip (spec §6.1). Expects trades in close order, as `closedTrades` returns them. */
export function scalpSummary(trades: readonly ClosedScalp[]): ScalpSummary {
  const returns = returnsOf(trades);
  const holds = trades.map(holdMinutes).filter((minutes) => minutes >= 0);
  return {
    ...summarize(trades),
    avgReturn: mean(returns),
    returnCount: returns.length,
    avgHoldMinutes: mean(holds),
    medianHoldMinutes: median(holds),
    coverage: rCoverage(trades),
  };
}

export interface BucketRow extends GroupStats {
  label: string;
}

/**
 * One row per time bucket (spec §6.3). The five main buckets are always there, empty or not, so a chart's axis never
 * shifts; "before open" (first) and "unknown" (last) only when trades fall in them.
 */
export function bucketStats(trades: readonly ClosedScalp[], by: "open" | "hold"): BucketRow[] {
  const labelOf =
    by === "open"
      ? (trade: ClosedScalp) => openBucket(minutesAfterOpen(trade.openedAt))
      : (trade: ClosedScalp) => holdTimeBucket(holdMinutes(trade));
  const groups = new Map(groupTrades(trades, labelOf));
  const main: readonly string[] = by === "open" ? OPEN_BUCKETS : HOLD_TIME_BUCKETS;
  const labels = [
    ...(groups.has(BEFORE_OPEN) ? [BEFORE_OPEN] : []),
    ...main,
    ...(groups.has(UNKNOWN) ? [UNKNOWN] : []),
  ];
  return labels.map((label) => ({ label, ...groupStats(groups.get(label) ?? []) }));
}
