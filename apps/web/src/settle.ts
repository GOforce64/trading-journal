import {
  expiryMoment,
  type PricedLeg,
  positionCash,
  round2,
  type SettledLeg,
  settleAtExpiry,
  settleExpiry,
} from "@tj/core";
import type { TradeView } from "./api.js";

/** A date as the settle panel and notes write it: "Sep 25". */
export const dayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Why no exits could be proposed at expiry, with `then` saying what to do: ", so type the exits in Edit". */
export function noCloseReason(
  underlying: string,
  expiry: string,
  close: { data?: { unavailable?: { message: string } | null } | null; isError: boolean },
  then: string,
): string {
  if (close.data?.unavailable) return close.data.unavailable.message;
  if (close.isError) return `Alpaca didn't answer${then}.`;
  return `Alpaca has no close for ${underlying} on ${dayText(expiry)}${then}.`;
}

export type SettledTradeLeg = TradeView["legs"][number] & { closePrice: number };

export interface SettleProposal {
  expiry: string;
  close: number;
  /** Every leg, with the proposed exits written into the open ones. */
  legs: SettledTradeLeg[];
  settled: SettledLeg[];
  /** 16:00 New York on the expiry date. */
  closedAt: number;
  netPnl: number;
  /** Cash received at the open. */
  credit: number;
  /** Cash paid to close; negative when closing brought cash in. */
  toClose: number;
  fees: number;
  feesClose: number;
}

/** What saving the exits at intrinsic value would record (spec §9.5); null when the legs can't be settled. */
export function settleProposal(trade: TradeView, close: number): SettleProposal | null {
  const expiry = settleExpiry(trade.legs);
  const settled = settleAtExpiry(trade.legs, close);
  if (!expiry || !settled) return null;
  const legs: SettledTradeLeg[] = trade.legs.map((leg, index) => ({
    ...leg,
    closePrice: leg.closePrice ?? settled.find((item) => item.index === index)?.exit ?? 0,
  }));
  // Expiring legs cost no commission; the fees so far are the entry fees.
  const feesClose = trade.feesClose ?? 0;
  const cash = positionCash(
    legs.map(
      (leg): PricedLeg => ({
        right: leg.right === "C" ? "C" : "P",
        strike: leg.strike,
        quantity: leg.quantity,
        multiplier: leg.multiplier,
        openPrice: leg.openPrice,
        closePrice: leg.closePrice,
      }),
    ),
    { open: trade.feesOpen ?? trade.fees, close: feesClose },
  );
  // −Σ quantity × multiplier × price: the credit at the open, the cost at the close.
  const flow = (price: (leg: SettledTradeLeg) => number) =>
    round2(-legs.reduce((sum, leg) => sum + leg.quantity * leg.multiplier * price(leg), 0));
  return {
    expiry,
    close,
    legs,
    settled,
    closedAt: expiryMoment(expiry),
    netPnl: cash.netPnl ?? 0,
    credit: flow((leg) => leg.openPrice),
    toClose: flow((leg) => leg.closePrice),
    fees: cash.fees,
    feesClose,
  };
}

const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "612 credit − 174 to close − 5 fees": how the net P&L comes about. */
export function netWorking(proposal: SettleProposal): string {
  const closing =
    proposal.toClose >= 0
      ? `− ${amount(proposal.toClose)} to close`
      : `+ ${amount(-proposal.toClose)} from closing`;
  return `${amount(proposal.credit)} credit ${closing} − ${amount(proposal.fees)} fees`;
}
