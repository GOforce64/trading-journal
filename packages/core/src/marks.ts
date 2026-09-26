import { round2 } from "./money.js";

/** A leg as the journal stores it: enough to name its contract and price it. */
export interface MarkableLeg {
  /** "C" or "P". */
  right: string;
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** Signed: negative is short. */
  quantity: number;
  multiplier: number;
  openPrice: number;
  closePrice: number | null;
}

/** Bid and ask for one contract. A null ask means nobody is offering it. */
export interface OptionQuote {
  bid: number | null;
  ask: number | null;
  /** When the quote was made, in epoch milliseconds. */
  at: number;
}

/**
 * The OCC code Alpaca names a contract by: root, YYMMDD, C or P, then strike x 1000 in 8 digits.
 * The root is the ticker's letters only, so BRK.B becomes BRKB.
 */
export function occSymbol(contract: {
  underlying: string;
  expiry: string;
  right: string;
  strike: number;
}): string {
  const root = contract.underlying.toUpperCase().replace(/[^A-Z]/g, "");
  const [year = "", month = "", day = ""] = contract.expiry.split("-");
  const strike = String(Math.round(contract.strike * 1000)).padStart(8, "0");
  return `${root}${year.slice(2)}${month}${day}${contract.right}${strike}`;
}

const NY_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in New York at an instant, as YYYY-MM-DD. Options expire on New York's clock. */
export function nyDate(epochMs: number): string {
  const parts = NY_DATE.formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((found) => found.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface EstimatedTrade {
  underlying: string;
  legs: MarkableLeg[];
  /** The trade's total fees, used when the open/close split is unknown (imported trades). */
  fees: number;
  feesOpen: number | null;
  feesClose: number | null;
}

export interface MarkedLeg {
  /** Position of the leg in the trade's `legs`. */
  index: number;
  mark: number;
  side: "ask" | "bid";
  pnl: number;
}

export type CloseEstimate =
  | { kind: "closed" }
  | { kind: "expired"; expiry: string }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "estimate";
      /** Open legs only. */
      legs: MarkedLeg[];
      /** Every leg, realised and estimated, before fees. */
      grossPnl: number;
      /** The fees entered so far; exit fees are not guessed. */
      fees: number;
      netPnl: number;
      /** The oldest quote used, in epoch milliseconds. */
      quotedAt: number;
    };

const legName = (leg: MarkableLeg) =>
  `${leg.quantity < 0 ? "short" : "long"} ${leg.right === "C" ? "call" : "put"}`;

/**
 * What closing the open legs right now would realise: shorts bought back at the ask,
 * longs sold at the bid (spec §6.2). An estimate for display only; never stored.
 */
export function closeEstimate(
  trade: EstimatedTrade,
  quotes: ReadonlyMap<string, OptionQuote>,
  todayNy: string,
): CloseEstimate {
  const open = trade.legs.flatMap((leg, index) => (leg.closePrice == null ? [{ leg, index }] : []));
  if (open.length === 0) return { kind: "closed" };
  const expired = open.find(({ leg }) => leg.expiry < todayNy);
  if (expired) return { kind: "expired", expiry: expired.leg.expiry };

  const marked: MarkedLeg[] = [];
  let quotedAt = Number.POSITIVE_INFINITY;
  for (const { leg, index } of open) {
    const quote = quotes.get(occSymbol({ underlying: trade.underlying, ...leg }));
    if (!quote) return { kind: "unavailable", reason: `no quote for the ${legName(leg)}` };
    const short = leg.quantity < 0;
    const mark = short ? quote.ask : quote.bid;
    if (mark == null)
      return { kind: "unavailable", reason: `no ${short ? "ask" : "bid"} for the ${legName(leg)}` };
    marked.push({
      index,
      mark,
      side: short ? "ask" : "bid",
      pnl: round2(leg.quantity * leg.multiplier * (mark - leg.openPrice)),
    });
    quotedAt = Math.min(quotedAt, quote.at);
  }

  const realised = trade.legs
    .filter((leg) => leg.closePrice != null)
    .reduce((sum, leg) => sum + leg.quantity * leg.multiplier * ((leg.closePrice ?? 0) - leg.openPrice), 0);
  const grossPnl = round2(realised + marked.reduce((sum, leg) => sum + leg.pnl, 0));
  const fees =
    trade.feesOpen != null && trade.feesClose != null ? round2(trade.feesOpen + trade.feesClose) : trade.fees;
  return { kind: "estimate", legs: marked, grossPnl, fees, netPnl: round2(grossPnl - fees), quotedAt };
}
