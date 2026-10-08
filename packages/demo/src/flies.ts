import {
  bsPrice,
  expiryMoment,
  type Grade,
  nyWallClock,
  type OptionRight,
  type PriceBar,
  regularClose,
} from "@tj/core";
import { cents } from "./prices.js";
import { chance, int, normal, pick, type Rng, uniform, weighted } from "./random.js";
import { expiryFor, FEE_PER_CONTRACT_SIDE } from "./scalps.js";
import { strikeStep } from "./symbols.js";

const YEAR_MS = 365 * 86_400_000;
/** Where a fly enters, in minutes before its entry day's close. */
const ENTRY_BEFORE_CLOSE = 15;

/** One earnings report, and the fly's days around it (demo spec §2). */
export interface EarningsEvent {
  symbol: string;
  date: string;
  timing: "BMO" | "AMC";
  /** The session the fly opens on: the report's day after the close, or the session before a morning report. */
  entryDate: string;
  /** The first session after the report, when the stock opens at its gap, and the fly closes. */
  reactionDate: string;
  exitDate: string;
  /** The options' IV into the report, as a fraction. */
  ivBefore: number;
  /** The move the straddle prices, as a fraction of the stock. */
  impliedMove: number;
  /** The stock's open on the reaction day against the close before, as a fraction. */
  gap: number;
}

/**
 * About one report every 13 weeks, from an offset of the symbol's own (demo spec §2). The reaction's gap spreads at
 * about 0.9 of the implied move, so selling the move wins somewhat more often than it loses.
 */
export function earningsSchedule(rng: Rng, symbol: string, sessions: readonly string[]): EarningsEvent[] {
  const events: EarningsEvent[] = [];
  let index = int(rng, 5, 60);
  while (index < sessions.length) {
    const timing = chance(rng, 0.5) ? "AMC" : "BMO";
    const date = sessions[index];
    const before = sessions[index - 1];
    const after = sessions[index + 1];
    const entryDate = timing === "AMC" ? date : before;
    const reactionDate = timing === "AMC" ? after : date;
    if (date && entryDate && reactionDate) {
      const ivBefore = uniform(rng, 0.7, 1.2);
      const expiry = expiryFor(symbol, reactionDate);
      const entryAt = nyWallClock(entryDate, regularClose(entryDate) - ENTRY_BEFORE_CLOSE);
      const years = (expiryMoment(expiry) - entryAt) / YEAR_MS;
      const impliedMove = 0.8 * ivBefore * Math.sqrt(years);
      events.push({
        symbol,
        date,
        timing,
        entryDate,
        reactionDate,
        exitDate: reactionDate,
        ivBefore,
        impliedMove,
        gap: 0.9 * impliedMove * normal(rng),
      });
    }
    // 13 weeks of sessions, give or take a week.
    index += int(rng, 59, 69);
  }
  return events;
}

/** An earnings iron fly as the demo plans it (demo spec §3.3). */
export interface FlyPlan {
  symbol: string;
  book: "live";
  entryDate: string;
  exitDate: string;
  legs: {
    right: OptionRight;
    strike: number;
    expiry: string;
    quantity: number;
    openPrice: number;
    closePrice: number;
  }[];
  contracts: number;
  openedAt: number;
  closedAt: number;
  fees: number;
  netPnl: number;
  creditPerShare: number;
  netCost: number;
  earningsDate: string;
  earningsTiming: "BMO" | "AMC";
  /** Percent, as the trade stores them. */
  impliedMovePct: number;
  actualMovePct: number;
  ivBefore: number;
  ivAfter: number;
  bodyStrike: number;
  putWing: number;
  callWing: number;
  setup: "Earnings IV crush";
  grade: Grade;
  tags: string[];
  notes: string | null;
}

/** Notes by how the fly went, so a winner never reads as a loss. */
export const FLY_NOTES = {
  won: [
    "IV was rich into the print; sold the body at the money.",
    "Move came in inside the wings; IV crush did the rest.",
    "Clean crush: the stock barely moved.",
  ],
  lost: [
    "Gapped through the short strike; the wing capped the damage.",
    "Small credit for the risk; should have passed on this one.",
    "The move beat the implied; the crush wasn't enough.",
  ],
};

/** The minute bar at or after `at`, or the last one. */
function barAt(bars: readonly PriceBar[], at: number): PriceBar {
  const found = bars.find((bar) => bar.t + 60_000 > at) ?? bars.at(-1);
  if (!found) throw new Error("no bars for the fly");
  return found;
}

/**
 * The fly around one report (demo spec §2): opened in the last 20 minutes before the entry day's close, closed 15 to
 * 60 minutes into the reaction day. The body is at the money, the wings 1.5 implied moves out, priced at the IV into
 * the report and closed at the crushed IV.
 */
export function planFly(
  rng: Rng,
  event: EarningsEvent,
  entryStock: readonly PriceBar[],
  exitStock: readonly PriceBar[],
): FlyPlan {
  // The last 20 minutes before the entry day's own close: 15:40–15:54, or 12:40–12:54 on a half day.
  const close = regularClose(event.entryDate);
  const openedAt = nyWallClock(event.entryDate, int(rng, close - 20, close - 6)) + int(rng, 0, 59) * 1_000;
  const closedAt = nyWallClock(event.exitDate, int(rng, 9 * 60 + 45, 10 * 60 + 29)) + int(rng, 0, 59) * 1_000;
  const entryPrice = barAt(entryStock, openedAt).c;
  const exitPrice = barAt(exitStock, closedAt).c;
  const expiry = expiryFor(event.symbol, event.exitDate);
  const step = strikeStep(entryPrice);
  const body = Math.round(entryPrice / step) * step;
  const width = Math.max(step, Math.round((1.5 * event.impliedMove * entryPrice) / step) * step);
  const ivAfter = uniform(rng, 0.3, 0.45);
  const contracts = int(rng, 1, 3);

  const price = (right: OptionRight, strike: number, S: number, at: number, iv: number) =>
    Math.max(0.01, cents(bsPrice(right, S, strike, (expiryMoment(expiry) - at) / YEAR_MS, iv)));
  const shape: [OptionRight, number, number][] = [
    ["P", body - width, contracts],
    ["P", body, -contracts],
    ["C", body, -contracts],
    ["C", body + width, contracts],
  ];
  const legs = shape.map(([right, strike, quantity]) => ({
    right,
    strike,
    expiry,
    quantity,
    openPrice: price(right, strike, entryPrice, openedAt, event.ivBefore),
    closePrice: price(right, strike, exitPrice, closedAt, ivAfter),
  }));
  // What the fly took in a share, and what closing it cost: the shorts less the longs.
  const credit = cents(-legs.reduce((sum, leg) => sum + leg.openPrice * Math.sign(leg.quantity), 0));
  const fees = cents(4 * contracts * 2 * FEE_PER_CONTRACT_SIDE);
  const legPnl = legs.reduce((sum, leg) => sum + (leg.closePrice - leg.openPrice) * leg.quantity * 100, 0);
  const netPnl = cents(legPnl - fees);
  const straddle = (legs[1]?.openPrice ?? 0) + (legs[2]?.openPrice ?? 0);
  const previousClose = entryStock.at(-1)?.c ?? entryPrice;
  const reactionOpen = exitStock[0]?.o ?? exitPrice;
  const won = netPnl > 0;

  return {
    symbol: event.symbol,
    book: "live",
    entryDate: event.entryDate,
    exitDate: event.exitDate,
    legs,
    contracts,
    openedAt,
    closedAt,
    fees,
    netPnl,
    creditPerShare: credit,
    netCost: cents(-credit * contracts * 100 + fees / 2),
    earningsDate: event.date,
    earningsTiming: event.timing,
    impliedMovePct: cents((straddle / entryPrice) * 100),
    actualMovePct: cents((reactionOpen / previousClose - 1) * 100),
    ivBefore: cents(event.ivBefore * 100),
    ivAfter: cents(ivAfter * 100),
    bodyStrike: body,
    putWing: body - width,
    callWing: body + width,
    setup: "Earnings IV crush",
    grade: weighted(
      rng,
      won
        ? [
            ["A", 0.5],
            ["B", 0.5],
          ]
        : [
            ["B", 0.4],
            ["C", 0.4],
            ["D", 0.2],
          ],
    ),
    tags: [won ? "Calm" : pick(rng, ["Calm", "Rushed"])],
    notes: chance(rng, 0.5) ? pick(rng, won ? FLY_NOTES.won : FLY_NOTES.lost) : null,
  };
}
