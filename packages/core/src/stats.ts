import { nyDate } from "./marks.js";
import { round2 } from "./money.js";

export interface StatLeg {
  expiry: string;
  quantity: number;
}

export interface StatFly {
  contracts: number | null;
  creditPerShare: number | null;
  bodyPutStrike: number | null;
  bodyCallStrike: number | null;
  putWingStrike: number | null;
  callWingStrike: number | null;
}

/** The fields statistics read. The web app's trade rows satisfy it as they are. */
export interface StatTrade {
  id: string;
  strategy: string;
  underlying: string;
  openedAt: number;
  closedAt: number | null;
  netPnl: number | null;
  fees: number;
  legs: readonly StatLeg[];
  ironFly: StatFly | null;
  /** A scalp's R (scalp-R spec §10); absent or null without one. */
  risk?: { r: number | null } | null;
}

export type Closed<T extends StatTrade> = T & { closedAt: number; netPnl: number };
export type ClosedTrade = Closed<StatTrade>;

/** Closed trades only, oldest close first. Trades that close at the same instant keep their order. */
export function closedTrades<T extends StatTrade>(trades: readonly T[]): Closed<T>[] {
  return trades
    .filter((trade): trade is Closed<T> => trade.closedAt != null && trade.netPnl != null)
    .sort((a, b) => a.closedAt - b.closedAt);
}

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  scratches: number;
  net: number;
  grossWins: number;
  grossLosses: number;
  fees: number;
  beforeFees: number;
  /** Wins over all closed trades, scratches included. */
  winRate: number | null;
  /** Gross wins over gross losses; Infinity with wins and no losses. */
  profitFactor: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
  /** The mean R of the trades that have one, to 0.01; null with none (scalp-R spec §10). */
  avgR: number | null;
  /** How many trades have an R. */
  rCount: number;
}

const total = (trades: readonly ClosedTrade[], pick: (trade: ClosedTrade) => number) =>
  round2(trades.reduce((sum, trade) => sum + pick(trade), 0));

/** The headline numbers (spec §5.1). Expects trades in close order, as `closedTrades` returns them. */
export function summarize(trades: readonly ClosedTrade[]): Summary {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = total(wins, (trade) => trade.netPnl);
  const grossLosses = total(losses, (trade) => trade.netPnl);
  const net = total(trades, (trade) => trade.netPnl);
  const fees = total(trades, (trade) => trade.fees);
  const count = trades.length;
  const rs = trades.flatMap((trade) => {
    const r = trade.risk?.r;
    return r == null ? [] : [r];
  });
  let profitFactor: number | null = null;
  if (losses.length > 0) profitFactor = grossWins / -grossLosses;
  else if (wins.length > 0) profitFactor = Number.POSITIVE_INFINITY;
  return {
    trades: count,
    wins: wins.length,
    losses: losses.length,
    scratches: count - wins.length - losses.length,
    net,
    grossWins,
    grossLosses,
    fees,
    beforeFees: round2(net + fees),
    winRate: count ? wins.length / count : null,
    profitFactor,
    expectancy: count ? round2(net / count) : null,
    avgWin: wins.length ? round2(grossWins / wins.length) : null,
    avgLoss: losses.length ? round2(grossLosses / losses.length) : null,
    maxDrawdown: maxDrawdown(trades),
    avgR: rs.length ? round2(rs.reduce((sum, r) => sum + r, 0) / rs.length) : null,
    rCount: rs.length,
  };
}

export interface EquityPoint {
  id: string;
  closedAt: number;
  equity: number;
  /** Equity minus its running peak, which starts at $0; always ≤ 0. */
  drawdown: number;
}

/** Cumulative net P&L after each trade, in close order. */
export function equityCurve(trades: readonly ClosedTrade[]): EquityPoint[] {
  let equity = 0;
  let peak = 0;
  return trades.map((trade) => {
    equity = round2(equity + trade.netPnl);
    peak = Math.max(peak, equity);
    return { id: trade.id, closedAt: trade.closedAt, equity, drawdown: round2(equity - peak) };
  });
}

/** The largest drop from a running peak of cumulative net P&L; 0 with no drop. */
export function maxDrawdown(trades: readonly ClosedTrade[]): number {
  return equityCurve(trades).reduce((lowest, point) => Math.min(lowest, point.drawdown), 0);
}

export interface PeriodResult<T> {
  net: number;
  trades: T[];
}

/** Net P&L and trades per New York close date. */
export function dailyPnl<T extends ClosedTrade>(trades: readonly T[]): Map<string, PeriodResult<T>> {
  const days = new Map<string, PeriodResult<T>>();
  for (const trade of trades) {
    const date = nyDate(trade.closedAt);
    const day = days.get(date) ?? { net: 0, trades: [] };
    day.net = round2(day.net + trade.netPnl);
    day.trades.push(trade);
    days.set(date, day);
  }
  return days;
}

export interface MonthResult {
  /** YYYY-MM */
  month: string;
  net: number;
  trades: number;
}

/** Net P&L and trade count per New York close month, oldest first. */
export function monthlyPnl(trades: readonly ClosedTrade[]): MonthResult[] {
  const months = new Map<string, MonthResult>();
  for (const trade of trades) {
    const month = nyDate(trade.closedAt).slice(0, 7);
    const result = months.get(month) ?? { month, net: 0, trades: 0 };
    result.net = round2(result.net + trade.netPnl);
    result.trades++;
    months.set(month, result);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface RollingPoint {
  closedAt: number;
  value: number;
}

/** The mean net P&L of the last `window` trades, at each trade from the `window`th on. */
export function rollingExpectancy(trades: readonly ClosedTrade[], window = 10): RollingPoint[] {
  const points: RollingPoint[] = [];
  let sum = 0;
  trades.forEach((trade, index) => {
    sum += trade.netPnl;
    const leaving = trades[index - window];
    if (leaving) sum -= leaving.netPnl;
    if (index >= window - 1) points.push({ closedAt: trade.closedAt, value: round2(sum / window) });
  });
  return points;
}

/** The worst losses, worst first. */
export function largestLosses<T extends ClosedTrade>(trades: readonly T[], count = 3): T[] {
  return trades
    .filter((trade) => trade.netPnl < 0)
    .sort((a, b) => a.netPnl - b.netPnl)
    .slice(0, count);
}
