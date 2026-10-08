import { nyWeekday, WEEKDAYS } from "./calendar.js";
import { nyDate } from "./marks.js";
import { round2 } from "./money.js";
import {
  BEFORE_OPEN,
  type Breakdown,
  type BreakdownContext,
  type ClosedScalp,
  type GroupStats,
  groupStats,
  HOLD_TIME_BUCKETS,
  holdMinutes,
  holdTimeBucket,
  minutesAfterOpen,
  OPEN_BUCKETS,
  openBucket,
} from "./scalpStats.js";
import { groupTrades, monthLabel } from "./splits.js";
import { type ClosedTrade, type Summary, summarize } from "./stats.js";

/** Missed trades' rollups (missed-trades spec §4.2). Their R is the stock's, so it never mixes with dollars. */

/** The fields the rollups read, as a trade view has them. */
export interface MissedStatTrade {
  id: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
  setupId: string | null;
  grade: string | null;
  tagIds: readonly string[];
  missedRisk: { r: number | null; mfe: number | null } | null;
}

/** A group of missed trades. Win rate and the R figures count only the trades with an R. */
export interface MissedGroup {
  /** Every missed trade in the group, with an R or not. */
  trades: number;
  rCount: number;
  wins: number;
  losses: number;
  /** Wins over the trades with an R; null with none. */
  winRate: number | null;
  /** The sum of R: what taking them all would have made, in R. */
  totalR: number;
  avgR: number | null;
  avgMfe: number | null;
}

export interface MissedSummary extends MissedGroup {
  scratches: number;
  /** Skips that would have lost. */
  goodSkips: number;
  goodSkipsR: number;
  /** The skip reason with the most trades, ties broken by name. */
  topReason: { tagId: string; trades: number; totalR: number } | null;
}

export interface MissedRow extends MissedGroup {
  label: string;
}

const rOf = (trade: MissedStatTrade) => trade.missedRisk?.r ?? null;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function missedGroup(trades: readonly MissedStatTrade[]): MissedGroup {
  const rs = trades.flatMap((trade) => {
    const r = rOf(trade);
    return r == null ? [] : [r];
  });
  const mfes = trades.flatMap((trade) => {
    const mfe = trade.missedRisk?.mfe ?? null;
    return rOf(trade) == null || mfe == null ? [] : [mfe];
  });
  const totalR = sum(rs);
  return {
    trades: trades.length,
    rCount: rs.length,
    wins: rs.filter((r) => r > 0).length,
    losses: rs.filter((r) => r < 0).length,
    winRate: rs.length ? rs.filter((r) => r > 0).length / rs.length : null,
    totalR,
    avgR: rs.length ? totalR / rs.length : null,
    avgMfe: mfes.length ? sum(mfes) / mfes.length : null,
  };
}

/** The Missed page's and tab's KPIs (spec §6.1, §6.6). `skips` holds the skip reasons' names by id. */
export function missedSummary(
  trades: readonly MissedStatTrade[],
  skips: ReadonlyMap<string, string>,
): MissedSummary {
  const group = missedGroup(trades);
  const losers = trades.flatMap((trade) => {
    const r = rOf(trade);
    return r != null && r < 0 ? [r] : [];
  });
  const reasons = groupTrades(trades, (trade) => trade.tagIds.filter((id) => skips.has(id)));
  const [top] = reasons
    .map(([tagId, members]) => ({ tagId, trades: members.length, totalR: missedGroup(members).totalR }))
    .sort(
      (a, b) => b.trades - a.trades || (skips.get(a.tagId) ?? "").localeCompare(skips.get(b.tagId) ?? ""),
    );
  return {
    ...group,
    scratches: group.rCount - group.wins - group.losses,
    goodSkips: losers.length,
    goodSkipsR: sum(losers),
    topReason: top ?? null,
  };
}

/** The Missed tab's dimensions (spec §6.6). */
export const MISSED_BREAKDOWNS = ["skip", "setup", "ticker", "open", "weekday", "grade"] as const;
export type MissedBreakdown = (typeof MISSED_BREAKDOWNS)[number];

const NO_REASON = "no reason";
const NO_SETUP = "no setup";
const UNKNOWN = "unknown";
const GRADE_ORDER = ["A", "B", "C", "D", "F", "ungraded"];
const OPEN_ORDER = [BEFORE_OPEN, ...OPEN_BUCKETS];

const toRows = (groups: [string, MissedStatTrade[]][]): MissedRow[] =>
  groups.map(([label, members]) => ({ label, ...missedGroup(members) }));

/** Rows by total R, best first, with the `last` row (such as "no setup") at the end. */
const byTotalR = (rows: readonly MissedRow[], last?: string): MissedRow[] => [
  ...rows.filter((row) => row.label !== last).sort((a, b) => b.totalR - a.totalR),
  ...rows.filter((row) => row.label === last),
];

const setupLabel = (setups: ReadonlyMap<string, string>) => (trade: MissedStatTrade) =>
  trade.setupId == null ? NO_SETUP : (setups.get(trade.setupId) ?? "unknown setup");
const openLabel = (trade: MissedStatTrade) => openBucket(minutesAfterOpen(trade.openedAt));
const gradeLabel = (trade: MissedStatTrade) => trade.grade ?? "ungraded";

/** One of the Missed tab's breakdowns (spec §6.6). Empty rows are left out. */
export function missedBreakdown(
  trades: readonly MissedStatTrade[],
  by: MissedBreakdown,
  names: { setups: ReadonlyMap<string, string>; skips: ReadonlyMap<string, string> },
): MissedRow[] {
  switch (by) {
    case "skip":
      return byTotalR(
        toRows(
          groupTrades(trades, (trade) => {
            const reason = trade.tagIds.find((id) => names.skips.has(id));
            return reason == null ? NO_REASON : (names.skips.get(reason) ?? NO_REASON);
          }),
        ),
        NO_REASON,
      );
    case "setup":
      return byTotalR(toRows(groupTrades(trades, setupLabel(names.setups))), NO_SETUP);
    case "ticker":
      return byTotalR(toRows(groupTrades(trades, (trade) => trade.underlying)));
    case "open":
      return toRows(groupTrades(trades, openLabel, OPEN_ORDER));
    case "weekday":
      return toRows(groupTrades(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS));
    case "grade":
      return toRows(groupTrades(trades, gradeLabel, GRADE_ORDER));
  }
}

export interface TakenVsMissedRow {
  setupId: string | null;
  label: string;
  taken: { trades: number; winRate: number | null; avgR: number | null };
  missed: { trades: number; winRate: number | null; avgR: number | null };
  /** Taken ÷ (taken + missed). */
  took: number | null;
}

/** Each setup's taken scalps (option R) beside its missed trades (stock R), never averaged together (spec §6.6). */
export function takenVsMissed(
  taken: readonly ClosedScalp[],
  missed: readonly MissedStatTrade[],
  setups: ReadonlyMap<string, string>,
): TakenVsMissedRow[] {
  const ids = [...new Set([...taken, ...missed].map((trade) => trade.setupId ?? null))];
  const rows = ids.map((setupId): TakenVsMissedRow => {
    const takenStats = groupStats(taken.filter((trade) => (trade.setupId ?? null) === setupId));
    const missedStats = missedGroup(missed.filter((trade) => trade.setupId === setupId));
    const all = takenStats.trades + missedStats.trades;
    return {
      setupId,
      label: setupId == null ? NO_SETUP : (setups.get(setupId) ?? "unknown setup"),
      taken: { trades: takenStats.trades, winRate: takenStats.winRate, avgR: takenStats.avgR },
      missed: { trades: missedStats.trades, winRate: missedStats.winRate, avgR: missedStats.avgR },
      took: all ? takenStats.trades / all : null,
    };
  });
  const total = (row: TakenVsMissedRow) => row.taken.trades + row.missed.trades;
  return [
    ...rows
      .filter((row) => row.setupId != null)
      .sort((a, b) => total(b) - total(a) || a.label.localeCompare(b.label)),
    ...rows.filter((row) => row.setupId == null),
  ];
}

/**
 * The Book filter's opt-in (spec §6.8): the taken trades' summary, with the missed trades that have an R added to the
 * counts, win rate and Avg R. Every dollar figure is the taken trades' alone.
 */
export function withMissed(taken: readonly ClosedTrade[], missed: readonly MissedStatTrade[]): Summary {
  const summary = summarize(taken);
  const extra = missedGroup(missed);
  const takenRs = taken.flatMap((trade) => {
    const r = trade.risk?.r;
    return r == null ? [] : [r];
  });
  const rCount = takenRs.length + extra.rCount;
  const trades = summary.trades + extra.rCount;
  const wins = summary.wins + extra.wins;
  const losses = summary.losses + extra.losses;
  return {
    ...summary,
    trades,
    wins,
    losses,
    scratches: trades - wins - losses,
    winRate: trades ? wins / trades : null,
    avgR: rCount ? round2((sum(takenRs) + extra.totalR) / rCount) : null,
    rCount,
  };
}

/**
 * Missed trades grouped the way `scalpBreakdown` or `bucketStats` labels the same dimension, for the Book filter's
 * opt-in. Null for the dimensions only a contract has.
 */
export function missedRows(
  trades: readonly MissedStatTrade[],
  by: Breakdown | "open" | "hold",
  context: BreakdownContext,
): MissedRow[] | null {
  switch (by) {
    case "dte":
    case "side":
    case "cost":
    case "contracts":
      return null;
    case "setup":
      return byTotalR(toRows(groupTrades(trades, setupLabel(context.setups))), NO_SETUP);
    case "ticker":
      return toRows(groupTrades(trades, (trade) => trade.underlying));
    case "grade":
      return toRows(groupTrades(trades, gradeLabel, GRADE_ORDER));
    case "emotion":
      return toRows(
        groupTrades(trades, (trade) => {
          const names = trade.tagIds.flatMap((id) => {
            const name = context.emotions.get(id);
            return name == null ? [] : [name];
          });
          return names.length > 0 ? names : "none";
        }),
      );
    case "weekday":
      return toRows(groupTrades(trades, (trade) => nyWeekday(trade.openedAt), WEEKDAYS));
    case "book":
      return trades.length ? [{ label: "Missed", ...missedGroup(trades) }] : [];
    case "month":
      return toRows(
        groupTrades(trades, (trade) => monthLabel(nyDate(trade.closedAt ?? trade.openedAt).slice(0, 7))),
      );
    case "open":
      return toRows(groupTrades(trades, openLabel, OPEN_ORDER));
    case "hold":
      return toRows(
        groupTrades(
          trades.filter((trade): trade is MissedStatTrade & { closedAt: number } => trade.closedAt != null),
          (trade) => holdTimeBucket(holdMinutes(trade)),
          [...HOLD_TIME_BUCKETS, UNKNOWN],
        ),
      );
  }
}

/** A breakdown row only missed trades have: its dollar columns are blank. */
export type MissedOnlyRow = Omit<GroupStats, "net" | "profitFactor" | "avgReturn"> & {
  label: string;
  net: null;
  profitFactor: null;
  avgReturn: null;
  missedOnly: true;
};

/**
 * Taken rows with the missed trades that have an R added, label by label (spec §6.8): N, win % and avg R gain them,
 * and the dollar columns stay the taken trades'. A label only missed trades have is appended with blank dollars.
 * Avg R is weighted from the row's rounded avg R and its R count, close enough at two decimals.
 */
export function withMissedGroups<R extends GroupStats & { label: string }>(
  rows: readonly R[],
  missed: readonly MissedRow[],
): (R | MissedOnlyRow)[] {
  const byLabel = new Map(missed.filter((row) => row.rCount > 0).map((row) => [row.label, row]));
  const merged = rows.map((row): R => {
    const extra = byLabel.get(row.label);
    if (!extra) return row;
    const wins = Math.round((row.winRate ?? 0) * row.trades) + extra.wins;
    const trades = row.trades + extra.rCount;
    const rCount = row.rCount + extra.rCount;
    return {
      ...row,
      trades,
      winRate: trades ? wins / trades : null,
      avgR: round2(((row.avgR ?? 0) * row.rCount + extra.totalR) / rCount),
      rCount,
    };
  });
  const labels = new Set(rows.map((row) => row.label));
  const added = [...byLabel.values()]
    .filter((row) => !labels.has(row.label))
    .map(
      (row): MissedOnlyRow => ({
        label: row.label,
        trades: row.rCount,
        winRate: row.winRate,
        net: null,
        profitFactor: null,
        avgR: round2(row.totalR / row.rCount),
        rCount: row.rCount,
        avgReturn: null,
        returnCount: 0,
        missedOnly: true,
      }),
    );
  return [...merged, ...added];
}
