import { round2 } from "./money.js";

export interface PricedLeg {
  right: "C" | "P";
  strike: number;
  /** Signed: negative is short. */
  quantity: number;
  multiplier?: number;
  openPrice: number;
  closePrice?: number | null;
}

export interface PositionFees {
  open?: number;
  close?: number;
}

export interface PositionCash {
  /** Cash at open, fees included: negative means a credit was received. */
  netCost: number;
  /** Credit per share, fees included. Negative for a debit position. */
  creditPerShare: number;
  /** P&L before fees; null while any leg is still open. */
  grossPnl: number | null;
  /** P&L after fees; null while any leg is still open. */
  netPnl: number | null;
  fees: number;
  contracts: number;
  shares: number;
}

const legMultiplier = (leg: PricedLeg) => leg.multiplier ?? 100;

/**
 * Everything the money side of a position can be derived from: the price paid
 * or received per leg, plus commissions on the way in and out. Nothing here is
 * typed in twice, so the numbers cannot disagree with each other.
 */
export function positionCash(legs: PricedLeg[], fees: PositionFees = {}): PositionCash {
  const openFees = fees.open ?? 0;
  const closeFees = fees.close ?? 0;
  const totalFees = round2(openFees + closeFees);

  const openCash = legs.reduce((sum, leg) => sum + leg.quantity * legMultiplier(leg) * leg.openPrice, 0);
  // Round-trip fees land in the cost line, which is how oQuants reports it, so
  // an imported row and a hand-built one reconcile the same way.
  const netCost = round2(openCash + totalFees);

  const contracts = legs.reduce((largest, leg) => Math.max(largest, Math.abs(leg.quantity)), 0);
  const shares = contracts * (legs.length > 0 && legs[0] ? legMultiplier(legs[0]) : 100);

  const allClosed = legs.length > 0 && legs.every((leg) => leg.closePrice != null);
  const grossPnl = allClosed
    ? round2(
        legs.reduce(
          (sum, leg) => sum + leg.quantity * legMultiplier(leg) * ((leg.closePrice ?? 0) - leg.openPrice),
          0,
        ),
      )
    : null;

  return {
    netCost,
    creditPerShare: shares > 0 ? -netCost / shares : 0,
    grossPnl,
    netPnl: grossPnl === null ? null : round2(grossPnl - totalFees),
    fees: totalFees,
    contracts,
    shares,
  };
}

export interface IronFlyStructure {
  bodyPutStrike: number;
  bodyCallStrike: number;
  putWingStrike: number;
  /** Null when there is no long call. */
  callWingStrike: number | null;
}

/**
 * A short iron butterfly is a short call and put at the body, with a long call
 * above and a long put below. Reading the structure back off the legs keeps the
 * stored detail honest when legs are edited. One wing may be missing: without a
 * long put the stock going to zero caps the put side (wing 0); without a long
 * call the call wing is left empty. With neither wing it is not a fly.
 */
export function ironFlyStructureFromLegs(legs: PricedLeg[]): IronFlyStructure | null {
  const shortCall = legs.find((leg) => leg.right === "C" && leg.quantity < 0);
  const shortPut = legs.find((leg) => leg.right === "P" && leg.quantity < 0);
  const longCall = legs.find((leg) => leg.right === "C" && leg.quantity > 0);
  const longPut = legs.find((leg) => leg.right === "P" && leg.quantity > 0);
  if (!shortCall || !shortPut || (!longCall && !longPut)) return null;
  return {
    bodyPutStrike: shortPut.strike,
    bodyCallStrike: shortCall.strike,
    putWingStrike: longPut?.strike ?? 0,
    callWingStrike: longCall?.strike ?? null,
  };
}
