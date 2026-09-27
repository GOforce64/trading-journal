import { HOLD_BUCKETS, holdBucket, nyWeekday, WEEKDAYS } from "./calendar.js";
import { nyDate } from "./marks.js";
import { round2 } from "./money.js";
import { type ClosedTrade, type StatFly, type StatTrade, summarize } from "./stats.js";

export interface SplitRow {
  label: string;
  trades: number;
  winRate: number;
  net: number;
  profitFactor: number | null;
}

const UNKNOWN = "unknown";

function row(label: string, trades: readonly ClosedTrade[]): SplitRow {
  const summary = summarize(trades);
  return {
    label,
    trades: summary.trades,
    winRate: summary.winRate ?? 0,
    net: summary.net,
    profitFactor: summary.profitFactor,
  };
}

/** Rows for the labels trades get: in `order` first, then others as met, "unknown" last; empty buckets left out. */
function group(
  trades: readonly ClosedTrade[],
  labelOf: (trade: ClosedTrade) => string,
  order: readonly string[] = [],
): SplitRow[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const trade of trades) {
    const label = labelOf(trade);
    groups.set(label, [...(groups.get(label) ?? []), trade]);
  }
  const labels = [
    ...order.filter((label) => label !== UNKNOWN && groups.has(label)),
    ...[...groups.keys()].filter((label) => !order.includes(label) && label !== UNKNOWN),
  ];
  if (groups.has(UNKNOWN)) labels.push(UNKNOWN);
  return labels.map((label) => row(label, groups.get(label) ?? []));
}

export type EdgeKind = "usd" | "contracts";

export const DEFAULT_EDGES: Record<EdgeKind, readonly number[]> = {
  usd: [250, 500, 1000],
  contracts: [2, 4, 6],
};

/**
 * Reads edges typed like "250, 500, 1000". Null unless they are increasing and above 0,
 * and for contracts whole numbers from 2. Commas separate edges, so "1,000" is refused.
 */
export function parseEdges(text: string, kind: EdgeKind): number[] | null {
  const edges = text
    .replaceAll("$", "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (edges.length === 0) return null;
  const valid = edges.every(
    (edge, index) =>
      Number.isFinite(edge) &&
      edge > 0 &&
      (kind === "usd" || (Number.isInteger(edge) && edge >= 2)) &&
      (index === 0 || edge > (edges[index - 1] ?? 0)),
  );
  return valid ? edges : null;
}

const plain = (value: number) => value.toLocaleString("en-US");

/** Bucket names for edges, where each edge starts a bucket. */
export function edgeLabels(edges: readonly number[], kind: EdgeKind): string[] {
  const first = edges[0] ?? 0;
  const last = edges[edges.length - 1] ?? 0;
  const inner = edges.slice(1).map((edge, index) => [edges[index] ?? 0, edge] as const);
  if (kind === "usd") {
    return [
      `< $${plain(first)}`,
      ...inner.map(([from, to]) => `$${plain(from)}–${plain(to)}`),
      `$${plain(last)}+`,
    ];
  }
  const span = (from: number, to: number) => (from === to ? `${from}` : `${from}–${to}`);
  return [span(1, first - 1), ...inner.map(([from, to]) => span(from, to - 1)), `${last}+`];
}

/** The bucket a value falls in. */
export function edgeBucket(value: number, edges: readonly number[], kind: EdgeKind): string {
  return edgeLabels(edges, kind)[edges.filter((edge) => value >= edge).length] ?? UNKNOWN;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

/** Calendar days from the New York open date to the earliest leg expiry; null without one. */
export function daysToExpiry(trade: StatTrade): number | null {
  const expiry = trade.legs
    .map((leg) => leg.expiry)
    .filter((date) => ISO_DATE.test(date))
    .sort()[0];
  if (!expiry) return null;
  const days = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${nyDate(trade.openedAt)}T00:00:00Z`)) / DAY,
  );
  return days >= 0 ? days : null;
}

/** Fly contracts, or for other trades the largest leg quantity. */
export function tradeSize(trade: StatTrade): number | null {
  const size = trade.ironFly?.contracts ?? Math.max(0, ...trade.legs.map((leg) => Math.abs(leg.quantity)));
  return size > 0 ? size : null;
}

/** Gross credit taken in: credit per share × contracts × 100. */
export function flyCredit(trade: StatTrade): number | null {
  const credit = trade.ironFly?.creditPerShare;
  const contracts = trade.ironFly?.contracts;
  return credit != null && contracts != null ? round2(credit * contracts * 100) : null;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-09" → "Sep 2026". */
export const monthLabel = (month: string) => MONTH.format(new Date(`${month}-01T00:00:00Z`));

const DTE_BUCKETS = ["0–1", "2–7", "8–14", "15+"];

function dteLabel(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 1) return "0–1";
  if (days <= 7) return "2–7";
  return days <= 14 ? "8–14" : "15+";
}

export const weekdaySplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS);

export const dteSplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => dteLabel(daysToExpiry(trade)), DTE_BUCKETS);

export function contractsSplit(trades: readonly ClosedTrade[], edges: readonly number[]): SplitRow[] {
  return group(
    trades,
    (trade) => {
      const size = tradeSize(trade);
      return size == null ? UNKNOWN : edgeBucket(size, edges, "contracts");
    },
    edgeLabels(edges, "contracts"),
  );
}

export const holdSplit = (trades: readonly ClosedTrade[]) =>
  group(trades, (trade) => holdBucket(trade.openedAt, trade.closedAt), HOLD_BUCKETS);

export function monthSplit(trades: readonly ClosedTrade[]): SplitRow[] {
  const monthOf = (trade: ClosedTrade) => nyDate(trade.closedAt).slice(0, 7);
  const months = [...new Set(trades.map(monthOf))].sort();
  return group(trades, (trade) => monthLabel(monthOf(trade)), months.map(monthLabel));
}

const TICKER_ROWS = 10;

/** Every ticker by net, best first. Past 10 tickers: the best 5, one row for the rest, and the worst 5. */
export function tickerSplit(trades: readonly ClosedTrade[]): SplitRow[] {
  const rows = group(trades, (trade) => trade.underlying).sort((a, b) => b.net - a.net);
  if (rows.length <= TICKER_ROWS) return rows;
  const middle = new Set(rows.slice(5, -5).map((split) => split.label));
  const others = row(
    `${middle.size} others`,
    trades.filter((trade) => middle.has(trade.underlying)),
  );
  return [...rows.slice(0, 5), others, ...rows.slice(-5)];
}

export function creditSplit(flies: readonly ClosedTrade[], edges: readonly number[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const credit = flyCredit(trade);
      return credit == null ? UNKNOWN : edgeBucket(credit, edges, "usd");
    },
    edgeLabels(edges, "usd"),
  );
}

/** Put and call wing widths in points; null for a missing wing. A put wing at strike 0 is a missing wing. */
function wingWidths(fly: StatFly): { put: number | null; call: number | null } | null {
  if (fly.bodyPutStrike == null || fly.bodyCallStrike == null) return null;
  return {
    put:
      fly.putWingStrike != null && fly.putWingStrike > 0
        ? round2(fly.bodyPutStrike - fly.putWingStrike)
        : null,
    call: fly.callWingStrike != null ? round2(fly.callWingStrike - fly.bodyCallStrike) : null,
  };
}

export function wingsSplit(flies: readonly ClosedTrade[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const widths = trade.ironFly && wingWidths(trade.ironFly);
      if (!widths) return UNKNOWN;
      if (widths.put == null || widths.call == null) return "1-wing";
      return widths.put === widths.call ? "balanced" : "broken";
    },
    ["balanced", "broken", "1-wing"],
  );
}

const WIDTH_BUCKETS = ["≤ 2.5", "2.5–5", "5–10", "10+", "1-wing"];

export function wingWidthSplit(flies: readonly ClosedTrade[]): SplitRow[] {
  return group(
    flies,
    (trade) => {
      const widths = trade.ironFly && wingWidths(trade.ironFly);
      if (!widths) return UNKNOWN;
      if (widths.put == null || widths.call == null) return "1-wing";
      const wider = Math.max(widths.put, widths.call);
      if (wider <= 2.5) return "≤ 2.5";
      if (wider <= 5) return "2.5–5";
      return wider <= 10 ? "5–10" : "10+";
    },
    WIDTH_BUCKETS,
  );
}
