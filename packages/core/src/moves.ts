import { expiryMoment } from "./calendar.js";
import { sumMoney } from "./money.js";
import { impliedVol, yearsToExpiry } from "./pricing.js";

/** A leg as the journal stores it: what a move needs to know about it. */
export interface MoveLeg {
  /** "C" or "P". */
  right: string;
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** Signed: negative is short. */
  quantity: number;
  openPrice: number;
  closePrice: number | null;
}

/** The fly details a move reads: the two stored stock prices, and the four typed overrides. */
export interface MoveFly {
  underlyingPriceEntry: number | null;
  underlyingPriceExit: number | null;
  /** Typed overrides, in percentage points: 7.3 means 7.3%, IV 123 means 123%. */
  impliedMovePct: number | null;
  actualMovePct: number | null;
  ivBefore: number | null;
  ivAfter: number | null;
}

export interface MoveTrade {
  openedAt: number;
  closedAt: number | null;
  legs: readonly MoveLeg[];
  ironFly: MoveFly | null;
}

/** A move number and where it came from. Fractions: 0.073 = 7.3%, 1.23 = 123% IV. */
export interface MoveValue {
  value: number;
  source: "computed" | "override";
  /** What the fills and stock prices give, shown beside an override; null when they give nothing. */
  computed: number | null;
}

/** Why a computed IV is missing although its prices exist. */
export type IvBlank = "near_expiry" | "unsolvable";

export interface TradeMoves {
  stockAtEntry: number | null;
  stockAtExit: number | null;
  impliedMove: MoveValue | null;
  /** Signed: negative means the stock fell. */
  actualMove: MoveValue | null;
  /** |actual| ÷ implied, from the resolved values, so overrides carry into it. */
  moveRatio: number | null;
  ivBefore: MoveValue | null;
  ivAfter: MoveValue | null;
  ivBeforeBlank: IvBlank | null;
  ivAfterBlank: IvBlank | null;
}

const DAY_MS = 86_400_000;

const positive = (value: number | null | undefined) => (value != null && value > 0 ? value : null);
const rightOf = (leg: MoveLeg) => (leg.right === "C" ? "C" : "P");
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** A typed override, in percentage points, wins; otherwise the computed fraction, if there is one. */
function resolve(overridePct: number | null | undefined, computed: number | null): MoveValue | null {
  if (overridePct != null) return { value: overridePct / 100, source: "override", computed };
  return computed == null ? null : { value: computed, source: "computed", computed };
}

/** The mean IV of the legs that solve, or null when none does. */
function meanIv(
  legs: readonly MoveLeg[],
  price: (leg: MoveLeg) => number,
  S: number,
  at: number,
): number | null {
  const solved = legs.flatMap((leg) => {
    const iv = impliedVol({
      right: rightOf(leg),
      price: price(leg),
      S,
      K: leg.strike,
      T: yearsToExpiry(at, leg.expiry),
    });
    return iv == null ? [] : [iv];
  });
  return solved.length > 0 ? mean(solved) : null;
}

/**
 * Implied and actual move, their ratio, and IV before → after, worked out from the fills and the two
 * stored stock prices (spec §7.3). A typed override replaces its own field.
 */
export function tradeMoves(trade: MoveTrade): TradeMoves {
  const fly = trade.ironFly;
  const entry = positive(fly?.underlyingPriceEntry);
  const exit = positive(fly?.underlyingPriceExit);
  const shorts = trade.legs.filter((leg) => leg.quantity < 0);
  const calls = shorts.filter((leg) => leg.right === "C");
  const puts = shorts.filter((leg) => leg.right === "P");
  const call = calls.length === 1 ? calls[0] : undefined;
  const put = puts.length === 1 ? puts[0] : undefined;
  const pair = call && put ? ([call, put] as const) : null;

  const implied = pair && entry != null ? (pair[0].openPrice + pair[1].openPrice) / entry : null;
  const actual = entry != null && exit != null ? (exit - entry) / entry : null;

  let ivBefore: number | null = null;
  let ivBeforeBlank: IvBlank | null = null;
  if (pair && entry != null) {
    ivBefore = meanIv(pair, (leg) => leg.openPrice, entry, trade.openedAt);
    if (ivBefore == null) ivBeforeBlank = "unsolvable";
  }

  let ivAfter: number | null = null;
  let ivAfterBlank: IvBlank | null = null;
  const closedAt = trade.closedAt;
  if (pair && exit != null && closedAt != null && pair.every((leg) => leg.closePrice != null)) {
    if (expiryMoment(pair[0].expiry) - closedAt < DAY_MS) {
      // A few cents swing the solve wildly this close to expiry (KLAR solved to 665%).
      ivAfterBlank = "near_expiry";
    } else {
      const otm = pair.filter((leg) => (leg.right === "C" ? leg.strike >= exit : leg.strike <= exit));
      ivAfter = meanIv(otm.length > 0 ? otm : pair, (leg) => leg.closePrice ?? 0, exit, closedAt);
      if (ivAfter == null) ivAfterBlank = "unsolvable";
    }
  }

  const impliedMove = resolve(fly?.impliedMovePct, implied);
  const actualMove = resolve(fly?.actualMovePct, actual);
  return {
    stockAtEntry: entry,
    stockAtExit: exit,
    impliedMove,
    actualMove,
    moveRatio:
      impliedMove && actualMove && impliedMove.value > 0
        ? Math.abs(actualMove.value) / impliedMove.value
        : null,
    ivBefore: resolve(fly?.ivBefore, ivBefore),
    ivAfter: resolve(fly?.ivAfter, ivAfter),
    ivBeforeBlank,
    ivAfterBlank,
  };
}

/** A closed fly as the Iron flies tab has it. */
export interface MoveRow extends MoveTrade {
  id: string;
  underlying: string;
  netPnl: number;
}

/** One dot on the implied-vs-actual scatter. */
export interface MovePoint {
  id: string;
  ticker: string;
  implied: number;
  absActual: number;
  netPnl: number;
}

/** A dot for every fly with both an implied and an actual move, computed or typed (spec §7.4). */
export function movePoints(flies: readonly MoveRow[]): MovePoint[] {
  return flies.flatMap((trade) => {
    const { impliedMove, actualMove } = tradeMoves(trade);
    if (!impliedMove || !actualMove) return [];
    return [
      {
        id: trade.id,
        ticker: trade.underlying,
        implied: impliedMove.value,
        absActual: Math.abs(actualMove.value),
        netPnl: trade.netPnl,
      },
    ];
  });
}

export interface RatioTally {
  trades: number;
  won: number;
  net: number;
}

export interface RatioBucket extends RatioTally {
  label: string;
  from: number;
  to: number;
}

export interface RatioSummary {
  buckets: RatioBucket[];
  /** Flies with a move ratio, and flies without one. */
  withRatio: number;
  without: number;
  /** The flies whose ratio is 1 or more: the stock moved at least as much as priced. */
  beyondImplied: RatioTally;
}

const RATIO_EDGES = [
  { label: "< 0.5×", from: 0, to: 0.5 },
  { label: "0.5–1×", from: 0.5, to: 1 },
  { label: "1–1.5×", from: 1, to: 1.5 },
  { label: "1.5×+", from: 1.5, to: Number.POSITIVE_INFINITY },
];

/** Float noise only: 0.15 / 0.1 is 1.4999999999999998. The 0.1% rounding the spec warns about is far coarser. */
const denoise = (ratio: number) => Math.round(ratio * 1e9) / 1e9;

/** P&L by move ratio, on unrounded ratios (spec §7.4). */
export function moveRatioBuckets(flies: readonly MoveRow[]): RatioSummary {
  const rated = flies.flatMap((trade) => {
    const ratio = tradeMoves(trade).moveRatio;
    return ratio == null ? [] : [{ trade, ratio: denoise(ratio) }];
  });
  const tally = (items: readonly { trade: MoveRow }[]): RatioTally => ({
    trades: items.length,
    won: items.filter(({ trade }) => trade.netPnl > 0).length,
    net: sumMoney(items.map(({ trade }) => trade.netPnl)),
  });
  return {
    buckets: RATIO_EDGES.map((edge) => ({
      ...edge,
      ...tally(rated.filter(({ ratio }) => ratio >= edge.from && ratio < edge.to)),
    })),
    withRatio: rated.length,
    without: flies.length - rated.length,
    beyondImplied: tally(rated.filter(({ ratio }) => ratio >= 1)),
  };
}

export interface CrushBin {
  label: string;
  from: number;
  to: number;
  tradeIds: string[];
}

export interface CrushSummary {
  bins: CrushBin[];
  /** The median of IV before − IV after, in points. */
  median: number | null;
  count: number;
}

const CRUSH_EDGES = [
  { label: "< −50", from: Number.NEGATIVE_INFINITY, to: -50 },
  { label: "−50…−25", from: -50, to: -25 },
  { label: "−25…0", from: -25, to: 0 },
  { label: "0…25", from: 0, to: 25 },
  { label: "25…50", from: 25, to: 50 },
  { label: "50+", from: 50, to: Number.POSITIVE_INFINITY },
];

/** IV before − IV after, in points, for every fly with both (spec §7.4). */
export function ivCrushHistogram(flies: readonly MoveRow[]): CrushSummary {
  const crushed = flies.flatMap((trade) => {
    const { ivBefore, ivAfter } = tradeMoves(trade);
    return ivBefore && ivAfter ? [{ id: trade.id, points: (ivBefore.value - ivAfter.value) * 100 }] : [];
  });
  const sorted = crushed.map((item) => item.points).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? (sorted[middle] ?? null)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return {
    bins: CRUSH_EDGES.map((edge) => ({
      ...edge,
      tradeIds: crushed.filter(({ points }) => points >= edge.from && points < edge.to).map(({ id }) => id),
    })),
    median,
    count: crushed.length,
  };
}
