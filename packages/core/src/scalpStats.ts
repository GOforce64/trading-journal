import { nyMinuteOfDay, nyWeekday, WEEKDAYS } from "./calendar.js";
import { keptStats } from "./kept.js";
import { nyDate } from "./marks.js";
import { premiumPaid, type ReturnTrade, returnOnCost } from "./risk.js";
import {
  daysToExpiry,
  edgeBucket,
  edgeLabels,
  foldMiddle,
  groupTrades,
  monthLabel,
  tradeSize,
} from "./splits.js";
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

export const BREAKDOWNS = [
  "setup",
  "ticker",
  "dte",
  "side",
  "grade",
  "emotion",
  "weekday",
  "cost",
  "contracts",
  "book",
  "month",
] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

/** What a breakdown needs besides the trades: names by id, and the edges of the bucketed dimensions. */
export interface BreakdownContext {
  setups: ReadonlyMap<string, string>;
  /** Emotion tags only, so a trade's other tags are ignored. */
  emotions: ReadonlyMap<string, string>;
  costEdges: readonly number[];
  contractEdges: readonly number[];
}

export interface BreakdownRow extends GroupStats {
  label: string;
}

const NO_SETUP = "no setup";
const NO_EMOTION = "none";
const DTE_ORDER = ["0", "1", "2–7", "8+"];
const GRADE_ORDER = ["A", "B", "C", "D", "F", "ungraded"];
const SIDES: Record<string, string> = { C: "Calls", P: "Puts" };
const bookLabel = (book: string) => book.charAt(0).toUpperCase() + book.slice(1);

function dteLabel(days: number | null): string {
  if (days == null) return UNKNOWN;
  if (days <= 1) return String(days);
  return days <= 7 ? "2–7" : "8+";
}

const toRows = (groups: [string, ClosedScalp[]][]): BreakdownRow[] =>
  groups.map(([label, members]) => ({ label, ...groupStats(members) }));

/** Rows by net, best first, with the `last` row (such as "no setup") at the end. */
const byNet = (rows: readonly BreakdownRow[], last?: string): BreakdownRow[] => [
  ...rows.filter((row) => row.label !== last).sort((a, b) => b.net - a.net),
  ...rows.filter((row) => row.label === last),
];

/** One dimension's rows (spec §6.4). Empty rows are left out, and "unknown" comes last. */
export function scalpBreakdown(
  trades: readonly ClosedScalp[],
  by: Breakdown,
  context: BreakdownContext,
): BreakdownRow[] {
  switch (by) {
    case "setup":
      return byNet(
        toRows(
          groupTrades(trades, (trade) =>
            trade.setupId == null ? NO_SETUP : (context.setups.get(trade.setupId) ?? "unknown setup"),
          ),
        ),
        NO_SETUP,
      );
    case "ticker":
      return foldMiddle(byNet(toRows(groupTrades(trades, (trade) => trade.underlying))), (middle) => ({
        label: `${middle.size} others`,
        ...groupStats(trades.filter((trade) => middle.has(trade.underlying))),
      }));
    case "dte":
      return toRows(groupTrades(trades, (trade) => dteLabel(daysToExpiry(trade)), DTE_ORDER));
    case "side":
      return toRows(
        groupTrades(trades, (trade) => SIDES[trade.legs[0]?.right ?? ""] ?? UNKNOWN, ["Calls", "Puts"]),
      );
    case "grade":
      return toRows(groupTrades(trades, (trade) => trade.grade ?? "ungraded", GRADE_ORDER));
    case "emotion":
      return byNet(
        toRows(
          groupTrades(trades, (trade) => {
            const names = trade.tagIds.flatMap((id) => {
              const name = context.emotions.get(id);
              return name == null ? [] : [name];
            });
            return names.length > 0 ? names : NO_EMOTION;
          }),
        ),
        NO_EMOTION,
      );
    case "weekday":
      return toRows(groupTrades(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS));
    case "cost":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const cost = premiumPaid(trade);
            return cost == null ? UNKNOWN : edgeBucket(cost, context.costEdges, "usd");
          },
          edgeLabels(context.costEdges, "usd"),
        ),
      );
    case "contracts":
      return toRows(
        groupTrades(
          trades,
          (trade) => {
            const size = tradeSize(trade);
            return size == null ? UNKNOWN : edgeBucket(size, context.contractEdges, "contracts");
          },
          edgeLabels(context.contractEdges, "contracts"),
        ),
      );
    case "book":
      return toRows(groupTrades(trades, (trade) => bookLabel(trade.book), ["Live", "Paper"]));
    case "month": {
      const monthOf = (trade: ClosedScalp) => nyDate(trade.closedAt).slice(0, 7);
      const months = [...new Set(trades.map(monthOf))].sort();
      return toRows(groupTrades(trades, (trade) => monthLabel(monthOf(trade)), months.map(monthLabel)));
    }
  }
}

export const NO_MISTAKES = "no mistakes";

/** A mistake tag's scalps against the rest (spec §6.5). */
export interface MistakeRow {
  /** Null for the "no mistakes" row. */
  tagId: string | null;
  label: string;
  /** The scalps carrying the tag; for "no mistakes", those carrying none. Null when there are none. */
  withTag: GroupStats | null;
  /** The rest of the scalps; for "no mistakes", those carrying at least one. Null when there are none. */
  withoutTag: GroupStats | null;
}

const sideStats = (trades: readonly ClosedScalp[]) => (trades.length > 0 ? groupStats(trades) : null);

/**
 * One row per mistake tag the scalps carry, worst net first, then "no mistakes". Empty when no scalp carries a
 * mistake. `mistakes` holds the mistake tags' names by id, so emotion tags are ignored.
 */
export function mistakeCost(
  trades: readonly ClosedScalp[],
  mistakes: ReadonlyMap<string, string>,
): MistakeRow[] {
  const hasMistake = (trade: ClosedScalp) => trade.tagIds.some((id) => mistakes.has(id));
  const carried = new Set(trades.flatMap((trade) => trade.tagIds.filter((id) => mistakes.has(id))));
  if (carried.size === 0) return [];
  const rows = [...carried].map(
    (tagId): MistakeRow => ({
      tagId,
      label: mistakes.get(tagId) ?? "unknown tag",
      withTag: sideStats(trades.filter((trade) => trade.tagIds.includes(tagId))),
      withoutTag: sideStats(trades.filter((trade) => !trade.tagIds.includes(tagId))),
    }),
  );
  rows.sort((a, b) => (a.withTag?.net ?? 0) - (b.withTag?.net ?? 0) || a.label.localeCompare(b.label));
  return [
    ...rows,
    {
      tagId: null,
      label: NO_MISTAKES,
      withTag: sideStats(trades.filter((trade) => !hasMistake(trade))),
      withoutTag: sideStats(trades.filter(hasMistake)),
    },
  ];
}

export interface CumulativePoint {
  id: string;
  closedAt: number;
  underlying: string;
  /** This trade's R, or net $ for a fly setup. */
  value: number;
  /** The running total through this trade. */
  total: number;
}

function cumulative(
  trades: readonly ClosedScalp[],
  pick: (trade: ClosedScalp) => number | null | undefined,
): CumulativePoint[] {
  let total = 0;
  return [...trades]
    .sort((a, b) => a.closedAt - b.closedAt)
    .flatMap((trade) => {
      const value = pick(trade);
      if (value == null) return [];
      total += value;
      return [{ id: trade.id, closedAt: trade.closedAt, underlying: trade.underlying, value, total }];
    });
}

/** R added up trade by trade, in close order, over the trades that have one (spec §7.2). */
export const cumulativeR = (trades: readonly ClosedScalp[]): CumulativePoint[] =>
  cumulative(trades, (trade) => trade.risk?.r);

/** A Playbook card (spec §7.2). */
export interface SetupCard extends GroupStats {
  setupId: string;
  /** "fly" when every closed trade is an iron fly. */
  kind: "scalp" | "fly";
  /** A fly setup's Σ net ÷ Σ max profit; null for a scalp setup. */
  kept: number | null;
  /** Cumulative R for a scalp setup, cumulative net $ for a fly setup. */
  points: CumulativePoint[];
  lastClosedAt: number;
  /** The setup's missed trades (missed-trades spec §6.7), in stock R, beside the taken ones; null without any. */
  missed: { trades: number; winRate: number | null; avgR: number | null } | null;
}

/** What a setup card reads of a missed trade. */
export interface SetupMissed {
  setupId: string | null;
  openedAt: number;
  missedRisk: { r: number | null } | null;
}

function missedOnCard(members: readonly SetupMissed[]): SetupCard["missed"] {
  if (members.length === 0) return null;
  const rs = members.flatMap((trade) => (trade.missedRisk?.r == null ? [] : [trade.missedRisk.r]));
  return {
    trades: members.length,
    winRate: rs.length ? rs.filter((r) => r > 0).length / rs.length : null,
    avgR: mean(rs),
  };
}

/**
 * One card per setup its closed trades name, most trades first, then by name. `names` holds setup names by id, for
 * the order only.
 */
export function setupCards(
  trades: readonly ClosedScalp[],
  names: ReadonlyMap<string, string>,
  missed: readonly SetupMissed[] = [],
): SetupCard[] {
  const bySetup = groupTrades(
    trades.filter((trade) => trade.setupId != null),
    (trade) => trade.setupId ?? "",
  );
  const missedBySetup = new Map(
    groupTrades(
      missed.filter((trade) => trade.setupId != null),
      (trade) => trade.setupId ?? "",
    ),
  );
  const nameOf = (card: SetupCard) => names.get(card.setupId) ?? "";
  const lastEntry = (setupId: string) =>
    Math.max(...(missedBySetup.get(setupId) ?? []).map((trade) => trade.openedAt));
  const taken = bySetup.map(([setupId, members]): SetupCard => {
    const fly = members.every((trade) => trade.strategy === "iron_fly");
    return {
      setupId,
      kind: fly ? "fly" : "scalp",
      ...groupStats(members),
      kept: fly ? keptStats(members).keptOverall : null,
      points: fly ? cumulative(members, (trade) => trade.netPnl) : cumulativeR(members),
      lastClosedAt: Math.max(...members.map((trade) => trade.closedAt), lastEntry(setupId)),
      missed: missedOnCard(missedBySetup.get(setupId) ?? []),
    };
  });
  // A setup only missed trades name still gets its card (missed-trades spec §6.7).
  const known = new Set(bySetup.map(([setupId]) => setupId));
  const missedOnly = [...missedBySetup]
    .filter(([setupId]) => !known.has(setupId))
    .map(
      ([setupId, members]): SetupCard => ({
        setupId,
        kind: "scalp",
        ...groupStats([]),
        kept: null,
        points: [],
        lastClosedAt: lastEntry(setupId),
        missed: missedOnCard(members),
      }),
    );
  return [...taken, ...missedOnly].sort(
    (a, b) =>
      b.trades - a.trades ||
      (b.missed?.trades ?? 0) - (a.missed?.trades ?? 0) ||
      nameOf(a).localeCompare(nameOf(b)),
  );
}
