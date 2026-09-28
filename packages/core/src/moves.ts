import { expiryMoment } from "./calendar.js";
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
