import { round2 } from "./money.js";

export interface IronFlyMetricsInput {
  bodyPutStrike: number;
  bodyCallStrike: number;
  putWingStrike: number;
  callWingStrike: number;
  contracts: number;
  /** Gross credit per share, before fees. */
  creditPerShare: number;
  /** Total fees in dollars for the whole position. */
  fees?: number;
  multiplier?: number;
}

export interface IronFlyMetrics {
  shares: number;
  putWingWidth: number;
  callWingWidth: number;
  isBrokenWing: boolean;
  netCreditPerShare: number;
  maxProfit: number;
  putSideRisk: number;
  callSideRisk: number;
  maxLoss: number;
  riskySide: "put" | "call" | "even";
  breakevenLow: number;
  breakevenHigh: number;
}

/**
 * Wings are treated independently, so broken-wing flies are handled: each side's
 * risk is its own width minus the credit, and max loss is the larger of the two.
 */
export function ironFlyMetrics(input: IronFlyMetricsInput): IronFlyMetrics {
  const multiplier = input.multiplier ?? 100;
  const shares = input.contracts * multiplier;
  const fees = input.fees ?? 0;
  const netCreditPerShare = input.creditPerShare - fees / shares;

  const putWingWidth = round2(input.bodyPutStrike - input.putWingStrike);
  const callWingWidth = round2(input.callWingStrike - input.bodyCallStrike);
  const putSideRisk = round2(Math.max(0, (putWingWidth - netCreditPerShare) * shares));
  const callSideRisk = round2(Math.max(0, (callWingWidth - netCreditPerShare) * shares));
  const maxLoss = Math.max(putSideRisk, callSideRisk);

  return {
    shares,
    putWingWidth,
    callWingWidth,
    isBrokenWing: putWingWidth !== callWingWidth,
    netCreditPerShare,
    maxProfit: round2(netCreditPerShare * shares),
    putSideRisk,
    callSideRisk,
    maxLoss,
    riskySide: callSideRisk === putSideRisk ? "even" : callSideRisk > putSideRisk ? "call" : "put",
    breakevenLow: round2(input.bodyPutStrike - netCreditPerShare),
    breakevenHigh: round2(input.bodyCallStrike + netCreditPerShare),
  };
}

export interface IronFlyOutcome {
  returnOnRisk: number | null;
  pctOfMaxProfit: number | null;
  pnlPctOfCost: number | null;
}

/**
 * Ratios are fractions, not percentages: 0.2550 means +25.50%.
 * pnlPctOfCost mirrors the number oQuants shows, so imported rows reconcile.
 */
export function ironFlyOutcome(metrics: IronFlyMetrics, netPnl: number): IronFlyOutcome {
  return {
    returnOnRisk: metrics.maxLoss > 0 ? netPnl / metrics.maxLoss : null,
    pctOfMaxProfit: metrics.maxProfit !== 0 ? netPnl / metrics.maxProfit : null,
    pnlPctOfCost: metrics.maxProfit !== 0 ? netPnl / Math.abs(metrics.maxProfit) : null,
  };
}

/**
 * Fees are not reported directly by oQuants; they are the difference between the
 * cash the legs imply and the cost on the row. Positive result means fees paid.
 */
export function derivedFees(
  legs: { quantity: number; multiplier: number; openPrice: number }[],
  netCost: number,
): number {
  const legCash = legs.reduce((total, leg) => total + leg.quantity * leg.multiplier * leg.openPrice, 0);
  return round2(netCost - legCash);
}
