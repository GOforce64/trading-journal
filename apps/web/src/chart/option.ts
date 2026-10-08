import { type LevelBasis, nyClock, occSymbol } from "@tj/core";

/** Which intraday chart a scalp's page shows (premium-chart spec §6.1). */
export type ChartView = "stock" | "option";

/** The view a basis's levels are drawn on. */
export const viewOf = (basis: LevelBasis): ChartView => (basis === "premium" ? "option" : "stock");

interface ContractTrade {
  underlying: string;
  legs: readonly { right: string; strike: number; expiry: string }[];
}

/** The OCC code of a scalp's one contract, as Alpaca names it; null for anything else. */
export function contractOf(trade: ContractTrade): string | null {
  const leg = trade.legs.length === 1 ? trade.legs[0] : undefined;
  if (!leg) return null;
  return occSymbol({
    underlying: trade.underlying,
    expiry: leg.expiry,
    right: leg.right,
    strike: leg.strike,
  });
}

const EXPIRY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** The contract as a trader reads it: "NVDA 232.5C Sep 26". */
export function contractName(trade: ContractTrade): string {
  const leg = trade.legs[0];
  if (!leg) return trade.underlying;
  return `${trade.underlying} ${leg.strike}${leg.right} ${EXPIRY.format(new Date(`${leg.expiry}T00:00:00Z`))}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** An instant's minute in New York: "09:52". */
export function clockText(t: number): string {
  const { minute } = nyClock(t);
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** When a minute's bars are out: `delayMinutes` after it (premium-chart spec §6.3). */
export const arriveBy = (openedAt: number, delayMinutes: number): string =>
  clockText(Math.floor(openedAt / 60_000) * 60_000 + delayMinutes * 60_000);
