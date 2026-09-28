import { round2 } from "./money.js";
import { intrinsic } from "./pricing.js";

/** A leg as the journal stores it: what settling needs to know. */
export interface SettleLeg {
  /** "C" or "P". */
  right: string;
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** Signed: negative is short. */
  quantity: number;
  closePrice: number | null;
}

export interface SettledLeg {
  /** Position of the leg in the trade's `legs`. */
  index: number;
  /** Intrinsic value at the close, in cents. */
  exit: number;
  /** In the money: a short is assigned and a long exercised. Both settle in shares, not cash. */
  flag: "assigned" | "exercised" | null;
}

/** The expiry every open leg shares; null with nothing open, or with open legs on different dates. */
export function settleExpiry(legs: readonly SettleLeg[]): string | null {
  const open = legs.filter((leg) => leg.closePrice == null);
  const expiry = open[0]?.expiry;
  return expiry !== undefined && open.every((leg) => leg.expiry === expiry) ? expiry : null;
}

/**
 * Exits at intrinsic value for the open legs, from the stock's close on their expiry date (spec §7.5).
 * Legs that already have an exit keep it. P&L is left to positionCash, as in the edit form.
 */
export function settleAtExpiry(legs: readonly SettleLeg[], close: number): SettledLeg[] | null {
  if (settleExpiry(legs) == null) return null;
  return legs.flatMap((leg, index) => {
    if (leg.closePrice != null) return [];
    const exit = round2(intrinsic(leg.right === "C" ? "C" : "P", close, leg.strike));
    const flag = exit > 0 ? (leg.quantity < 0 ? "assigned" : "exercised") : null;
    return [{ index, exit, flag }];
  });
}
