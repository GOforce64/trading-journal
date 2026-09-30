import type { PriceBar } from "./chart.js";
import type { OptionRight } from "./model.js";
import { round2 } from "./money.js";
import { bsPrice, impliedVol, intrinsic, yearsToExpiry } from "./pricing.js";
import type { LevelBasis } from "./review.js";

/** R for each scalp (scalp-R spec §6–7): the stock at entry, the stop and targets priced, R, R:R, MAE and MFE. */

const MINUTE = 60_000;
const YEAR_MINUTES = 365 * 1_440;

/** A profit target: a price on the trade's basis, and the whole contracts sold there. */
export interface TargetLevel {
  price: number;
  contracts: number;
}

/**
 * The stock at `at` inside the minute bar holding it (spec §7): the open, moved towards the close by the share of the
 * minute gone. A time on the minute, as a typed-in scalp's is, gets the open.
 */
export function stockAt(bar: PriceBar, at: number): number {
  const gone = Math.min(Math.max((at - bar.t) / MINUTE, 0), 1);
  return bar.o + (bar.c - bar.o) * gone;
}

export interface HoldRange {
  high: number;
  low: number;
}

/**
 * The stock's highest high and lowest low from `from`'s minute through `to`'s (spec §7). Null until the bars reach
 * `to`'s minute: a range cut short by minutes not yet published would understate MAE and MFE.
 */
export function holdRange(bars: readonly PriceBar[], from: number, to: number): HoldRange | null {
  const first = Math.floor(from / MINUTE) * MINUTE;
  const last = Math.floor(to / MINUTE) * MINUTE;
  let range: HoldRange | null = null;
  let reached = false;
  for (const bar of bars) {
    if (bar.t >= last) reached = true;
    if (bar.t < first || bar.t > last) continue;
    range = range
      ? { high: Math.max(range.high, bar.h), low: Math.min(range.low, bar.l) }
      : { high: bar.h, low: bar.l };
  }
  return reached ? range : null;
}

/** Targets in the order the trade reaches them (spec §6.4): falling prices for a put on stock, rising otherwise. */
export function sortTargets<T extends { price: number }>(
  targets: readonly T[],
  basis: LevelBasis,
  right: string | null,
): T[] {
  const falling = basis === "stock" && right === "P";
  return [...targets].sort((a, b) => (falling ? b.price - a.price : a.price - b.price));
}

/** The contracts a trade holds across its legs. */
export const contractsHeld = (legs: readonly { quantity: number }[]): number =>
  legs.reduce((sum, leg) => sum + Math.abs(leg.quantity), 0);

/** Why a target list can't be saved (spec §8): it trims more contracts than the position has. */
export function trimProblem(targets: readonly { contracts: number }[], size: number): string | null {
  const trimmed = targets.reduce((sum, target) => sum + target.contracts, 0);
  if (trimmed <= size) return null;
  return `The targets trim ${trimmed} contract${trimmed === 1 ? "" : "s"}; the position has ${size}.`;
}

/** Why a scalp has no planned risk. */
export type RiskProblem = "no_stop" | "no_stock_price" | "wrong_side" | "cannot_price" | "not_single_long";

export interface RiskLeg {
  /** "C" or "P". */
  right: string;
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** Signed: a scalp's one leg is long, so above 0. */
  quantity: number;
  multiplier: number;
  openPrice: number;
}

/** What R reads from a trade. A stored trade, and the web app's trade rows, satisfy it as they are. */
export interface RiskTrade {
  strategy: string;
  openedAt: number;
  closedAt: number | null;
  netPnl: number | null;
  legs: readonly RiskLeg[];
  scalp: {
    levelBasis: LevelBasis;
    stopPrice: number | null;
    stockEntryOverride: number | null;
    riskOverride: number | null;
    targets: readonly TargetLevel[];
  } | null;
  /** The stock prices the filler fetched (spec §5). */
  scalpPrices: { entryPrice: number | null; holdHigh: number | null; holdLow: number | null } | null;
}

/** Levels where the page has them while a line is dragged, over what's saved. */
export interface LiveLevels {
  basis?: LevelBasis;
  stop?: number | null;
  targets?: readonly TargetLevel[];
}

export interface RiskTarget extends TargetLevel {
  /** The option's price with the level reached; null on the stock basis without a stock price. */
  optionAt: number | null;
  /** At or behind the entry, so it earns nothing: left out of the reward. */
  wrongSide: boolean;
}

/** How far the stock went during the hold, in dollars and, against a stock stop, in R. */
export interface Excursion {
  stock: number;
  r: number | null;
}

export interface ScalpRisk {
  basis: LevelBasis;
  /** Why there's no planned risk; null when there is one. */
  problem: RiskProblem | null;
  right: OptionRight | null;
  entryPremium: number | null;
  stop: number | null;
  stockAtEntry: { price: number; typed: boolean } | null;
  /** Null on premium, or when there's nothing to solve for. */
  iv: number | null;
  /** Priced without IV: intrinsic value plus the time value at entry. */
  estimated: boolean;
  minutesToExpiry: number | null;
  optionAtStop: number | null;
  plannedRisk: number | null;
  riskTyped: boolean;
  /** In the order they were given. */
  targets: RiskTarget[];
  /** Contracts no target trims, counted at the farthest target; `atTarget` is 1-based. */
  runner: { contracts: number; atTarget: number } | null;
  plannedReward: number | null;
  rewardRisk: number | null;
  r: number | null;
  mae: Excursion | null;
  mfe: Excursion | null;
}

const positive = (value: number | null | undefined) => (value != null && value > 0 ? value : null);

function unpriced(basis: LevelBasis, stop: number | null): ScalpRisk {
  return {
    basis,
    problem: "not_single_long",
    right: null,
    entryPremium: null,
    stop,
    stockAtEntry: null,
    iv: null,
    estimated: false,
    minutesToExpiry: null,
    optionAtStop: null,
    plannedRisk: null,
    riskTyped: false,
    targets: [],
    runner: null,
    plannedReward: null,
    rewardRisk: null,
    r: null,
    mae: null,
    mfe: null,
  };
}

/**
 * A scalp's planned risk and reward, R, R:R, MAE and MFE (spec §6), worked out on read. `live` prices the levels
 * where the page has them while a line is dragged. Null for a trade that isn't a scalp.
 */
export function scalpRisk(trade: RiskTrade, live: LiveLevels = {}): ScalpRisk | null {
  if (trade.strategy !== "scalp") return null;
  const saved = trade.scalp;
  const basis = live.basis ?? saved?.levelBasis ?? "stock";
  const stop = live.stop !== undefined ? live.stop : (saved?.stopPrice ?? null);
  const levels = live.targets ?? saved?.targets ?? [];
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (!leg || leg.quantity <= 0) return unpriced(basis, stop);

  const right: OptionRight = leg.right === "P" ? "P" : "C";
  const premium = leg.openPrice;
  const K = leg.strike;
  const T = yearsToExpiry(trade.openedAt, leg.expiry);
  const typedStock = positive(saved?.stockEntryOverride);
  const fetchedStock = positive(trade.scalpPrices?.entryPrice);
  let stockAtEntry: ScalpRisk["stockAtEntry"] = null;
  if (typedStock != null) stockAtEntry = { price: typedStock, typed: true };
  else if (fetchedStock != null) stockAtEntry = { price: fetchedStock, typed: false };
  const S = stockAtEntry?.price ?? null;
  const iv = basis === "stock" && S != null ? impliedVol({ right, price: premium, S, K, T }) : null;
  const estimated = basis === "stock" && S != null && iv == null;

  /** The option's price with the stock (or, on premium, the option itself) at `level`. */
  const optionAt = (level: number): number | null => {
    if (basis === "premium") return level;
    if (S == null) return null;
    if (iv != null) return bsPrice(right, level, K, T, iv);
    return intrinsic(right, level, K) + Math.max(0, premium - intrinsic(right, S, K));
  };
  // Where the trade starts, and which way it gains: a put on the stock basis gains as the stock falls.
  const start = basis === "premium" ? premium : S;
  const direction = basis === "stock" && right === "P" ? -1 : 1;
  const gains = (level: number) => start != null && (level - start) * direction > 0;
  const loses = (level: number) => start != null && (level - start) * direction < 0;

  const optionAtStop = stop == null ? null : optionAt(stop);
  let problem: RiskProblem | null = null;
  let computedRisk: number | null = null;
  if (stop == null) problem = "no_stop";
  else if (optionAtStop == null) problem = "no_stock_price";
  else if (!loses(stop)) problem = "wrong_side";
  else {
    const risk = round2((premium - optionAtStop) * leg.quantity * leg.multiplier);
    if (risk > 0) computedRisk = risk;
    else problem = "cannot_price";
  }
  const typedRisk = positive(saved?.riskOverride);
  if (typedRisk != null) problem = null;
  const plannedRisk = typedRisk ?? computedRisk;

  const targets: RiskTarget[] = levels.map((target) => ({
    price: target.price,
    contracts: target.contracts,
    optionAt: optionAt(target.price),
    wrongSide: start != null && !gains(target.price),
  }));
  // Targets trim only the contracts held, nearest first: a size edit can leave the saved ones trimming more (§8).
  const trimmed = new Array<number>(levels.length).fill(0);
  let left = leg.quantity;
  for (const { index } of sortTargets(
    levels.map((target, index) => ({ price: target.price, index })),
    basis,
    right,
  )) {
    const contracts = Math.min(levels[index]?.contracts ?? 0, left);
    trimmed[index] = contracts;
    left -= contracts;
  }
  const priced = targets.flatMap((target, index) =>
    !target.wrongSide && target.optionAt != null
      ? [{ index, optionAt: target.optionAt, contracts: trimmed[index] ?? 0 }]
      : [],
  );
  let plannedReward: number | null = null;
  let runner: ScalpRisk["runner"] = null;
  if (priced.length > 0) {
    let reward = 0;
    for (const target of priced) reward += (target.optionAt - premium) * target.contracts * leg.multiplier;
    if (left > 0) {
      // The farthest target prices highest, whatever the list's order while a line is dragged.
      const last = priced.reduce((best, target) => (target.optionAt >= best.optionAt ? target : best));
      reward += (last.optionAt - premium) * left * leg.multiplier;
      runner = { contracts: left, atTarget: last.index + 1 };
    }
    plannedReward = round2(reward);
  }

  const high = trade.scalpPrices?.holdHigh ?? null;
  const low = trade.scalpPrices?.holdLow ?? null;
  // In R, MAE and MFE need a stock stop on the losing side: its distance from the entry is the stock's 1R.
  const oneR = basis === "stock" && stop != null && S != null && loses(stop) ? Math.abs(S - stop) : null;
  const excursion = (stock: number): Excursion => ({ stock: round2(stock), r: oneR ? stock / oneR : null });
  let mae: Excursion | null = null;
  let mfe: Excursion | null = null;
  if (trade.closedAt != null && S != null && high != null && low != null) {
    const down = Math.max(0, S - low);
    const up = Math.max(0, high - S);
    mae = excursion(right === "C" ? down : up);
    mfe = excursion(right === "C" ? up : down);
  }

  return {
    basis,
    problem,
    right,
    entryPremium: premium,
    stop,
    stockAtEntry,
    iv,
    estimated,
    minutesToExpiry: Math.max(0, T * YEAR_MINUTES),
    optionAtStop,
    plannedRisk,
    riskTyped: typedRisk != null,
    targets,
    runner,
    plannedReward,
    rewardRisk: plannedReward != null && plannedRisk != null ? plannedReward / plannedRisk : null,
    r:
      trade.closedAt != null && trade.netPnl != null && plannedRisk != null
        ? trade.netPnl / plannedRisk
        : null,
    mae,
    mfe,
  };
}

/** What `returnOnCost` reads from a trade. A stored trade, and the web app's trade rows, satisfy it as they are. */
export interface ReturnTrade {
  strategy: string;
  netPnl: number | null;
  legs: readonly { quantity: number; multiplier: number; openPrice: number }[];
}

/** The premium paid for a single long option: contracts × multiplier × entry premium. Null for anything else. */
export function premiumPaid(trade: Pick<ReturnTrade, "strategy" | "legs">): number | null {
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (trade.strategy !== "scalp" || !leg || leg.quantity <= 0) return null;
  const cost = leg.quantity * leg.multiplier * leg.openPrice;
  return cost > 0 ? cost : null;
}

/**
 * A scalp's net P&L over the premium paid, contracts × multiplier × entry premium: 0.211 is +21.1%.
 * Null for an open trade, a fly, or anything but a single long option.
 */
export function returnOnCost(trade: ReturnTrade): number | null {
  const cost = premiumPaid(trade);
  return trade.netPnl == null || cost == null ? null : trade.netPnl / cost;
}
