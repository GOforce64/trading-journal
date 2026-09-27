import { flyMaxProfit, pctKept } from "./ironFly.js";
import { round2 } from "./money.js";
import { flyCredit } from "./splits.js";
import type { ClosedTrade } from "./stats.js";

export interface KeptSide {
  mean: number;
  median: number;
}

export interface KeptStats {
  /** Flies with a max profit above 0. Every figure below uses only these. */
  counted: number;
  /** Flies left out: fees at or above the credit, or no credit recorded. */
  skipped: number;
  avgCredit: number | null;
  avgMaxProfit: number | null;
  /** The share of max profit winners keep. */
  winnersKeep: KeptSide | null;
  /** The share of max profit losers lose, as a positive number. */
  losersLose: KeptSide | null;
  /** Σ net ÷ Σ max profit. */
  keptOverall: number | null;
}

function side(values: readonly number[]): KeptSide | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, median };
}

const mean = (values: readonly number[]) =>
  values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

/** How much of max profit the flies keep (spec §5.3). */
export function keptStats(flies: readonly ClosedTrade[]): KeptStats {
  const measured = flies.flatMap((trade) => {
    const kept = pctKept(trade);
    const credit = flyCredit(trade);
    const fly = trade.ironFly;
    if (kept == null || credit == null || fly?.creditPerShare == null || fly.contracts == null) return [];
    return [{ trade, kept, credit, maxProfit: flyMaxProfit(fly.creditPerShare, fly.contracts, trade.fees) }];
  });
  const totalMaxProfit = measured.reduce((sum, item) => sum + item.maxProfit, 0);
  return {
    counted: measured.length,
    skipped: flies.length - measured.length,
    avgCredit: mean(measured.map((item) => item.credit)),
    avgMaxProfit: mean(measured.map((item) => item.maxProfit)),
    winnersKeep: side(measured.filter((item) => item.trade.netPnl > 0).map((item) => item.kept)),
    losersLose: side(measured.filter((item) => item.trade.netPnl < 0).map((item) => -item.kept)),
    keptOverall: measured.length
      ? measured.reduce((sum, item) => sum + item.trade.netPnl, 0) / totalMaxProfit
      : null,
  };
}

export interface KeptBin {
  label: string;
  from: number;
  to: number;
  tradeIds: string[];
}

const FLOOR = -1.5;
const STEP = 0.25;
const percent = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100))}%`;

/** % kept per trade in 25-point bins from −150% to 100%, plus one bin below −150%. 100% goes in the last bin. */
export function keptHistogram(flies: readonly ClosedTrade[]): KeptBin[] {
  const bins: KeptBin[] = [
    { label: `< ${percent(FLOOR)}`, from: Number.NEGATIVE_INFINITY, to: FLOOR, tradeIds: [] },
  ];
  for (let from = FLOOR; from < 1; from = round2(from + STEP)) {
    const to = round2(from + STEP);
    bins.push({ label: `${percent(from)} to ${percent(to)}`, from, to, tradeIds: [] });
  }
  for (const trade of flies) {
    const kept = pctKept(trade);
    if (kept == null) continue;
    const index = kept < FLOOR ? 0 : Math.min(bins.length - 1, 1 + Math.floor((kept - FLOOR) / STEP));
    bins[index]?.tradeIds.push(trade.id);
  }
  return bins;
}
