import type { Coverage, GroupStats } from "@tj/core";
import { dollars, rText, winRateText } from "./format.js";

/** What the Scalps tab's bars show (scalp-analytics spec §6.3). */
export type Metric = "net" | "r" | "win";

export const METRICS: readonly { id: Metric; label: string }[] = [
  { id: "net", label: "Net" },
  { id: "r", label: "Avg R" },
  { id: "win", label: "Win %" },
];

/** A row's bar under a metric; null draws no bar (no scalps, or no R). */
/** The fields a row's bar and tooltip read; a missed-only row has no dollars. */
type RowStats = Pick<GroupStats, "trades" | "winRate" | "avgR" | "rCount"> & { net: number | null };

export function metricValue(row: RowStats, metric: Metric): number | null {
  if (row.trades === 0) return null;
  if (metric === "r") return row.avgR;
  return metric === "win" ? row.winRate : row.net;
}

const TICK_CHARS = 12;

/** A name cut to 12 characters for a chart's axis: "Earnings IV…". */
export const shortLabel = (label: string) =>
  label.length > TICK_CHARS ? `${label.slice(0, TICK_CHARS - 1)}…` : label;

/** A bar's axis label, the name cut to 12 characters so neighbours don't overlap: "Earnings IV… · 12". */
export const tickText = (label: string, trades: number) => `${shortLabel(label)} · ${trades}`;

/** A return on cost with its sign: 0.084 → "+8.4%", −0.03 → "−3.0%"; "—" without one. */
export function returnText(value: number | null): string {
  if (value == null) return "—";
  const text = `${Math.abs(value * 100).toFixed(1)}%`;
  if (text === "0.0%") return text;
  return `${value > 0 ? "+" : "−"}${text}`;
}

/** A hold: "45 s" under a minute, "6 min" under an hour, "1 h 12 min" from an hour; "—" without one. */
export function holdText(minutes: number | null): string {
  if (minutes == null) return "—";
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} s`;
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${whole % 60} min`;
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

/** Everything a row says at once, for a bar's tooltip: "12 scalps · +$820 · +0.62R over 10 · win 66.7%". */
export function rowSummary(row: RowStats): string {
  if (row.trades === 0) return "no scalps";
  const r = row.avgR == null ? "no R" : `${rText(row.avgR)} over ${row.rCount}`;
  const money = row.net == null ? "no dollars" : dollars(row.net);
  return `${count(row.trades, "scalp", "scalps")} · ${money} · ${r} · win ${winRateText(row.winRate)}`;
}

/** The backfill's state (spec §8): how many scalps it's fetching prices for, and why it couldn't. */
export interface FillState {
  fetching: number;
  problem: string | null;
}

/** The line under the KPI strip saying which scalps lack R, and why (spec §6.2). Empty without scalps. */
export function coverageText(
  coverage: Coverage,
  fill: FillState = { fetching: 0, problem: null },
  /** With Missed in the books, how many missed trades there are and how many have an R (missed-trades §6.8). */
  missed: { total: number; withR: number } | null = null,
): string {
  const missedPart =
    missed && missed.total > 0
      ? missed.withR === missed.total
        ? missed.total === 1
          ? "the missed trade"
          : `all ${missed.total} missed trades`
        : `${missed.withR} of ${count(missed.total, "missed trade", "missed trades")}`
      : null;
  if (coverage.total === 0) return missedPart ? `R covers ${missedPart}` : "";
  if (fill.fetching > 0) return `Fetching prices for ${count(fill.fetching, "scalp", "scalps")}…`;
  const { total, withR } = coverage;
  let text =
    withR === total
      ? `R covers ${total === 1 ? "the scalp" : `all ${total} scalps`}`
      : `R covers ${withR} of ${count(total, "scalp", "scalps")}`;
  if (missedPart) text += ` and ${missedPart}`;
  const parts = [
    [coverage.noStop, "no stop"],
    [coverage.noStockPrice, "no stock price"],
  ] as const;
  for (const [value, what] of parts) {
    if (value > 0) text += ` · ${value} ${value === 1 ? "has" : "have"} ${what}`;
  }
  if (coverage.cannotPrice > 0) text += ` · ${coverage.cannotPrice} can't be priced`;
  return fill.problem ? `${text}. ${fill.problem}` : text;
}
