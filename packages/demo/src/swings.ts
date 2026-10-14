import {
  addDays,
  bsPrice,
  type Grade,
  isTradingDay,
  nyWallClock,
  type OptionRight,
  regularClose,
  SWING_SHAPES,
  weekdayOfDate,
} from "@tj/core";
import { cents } from "./prices.js";
import { chance, int, pick, type Rng, uniform } from "./random.js";
import { FEE_PER_CONTRACT_SIDE } from "./scalps.js";
import { strikeStep, symbolInfo } from "./symbols.js";

export interface SwingLegPlan {
  right: OptionRight;
  strike: number;
  expiry: string;
  quantity: number;
  openPrice: number;
  closePrice: number;
}

/** A swing as the demo plans it (swing spec §8): a bought option or a debit vertical, held for days. */
export interface SwingPlan {
  symbol: string;
  book: "live" | "paper";
  legs: SwingLegPlan[];
  openedAt: number;
  closedAt: number;
  fees: number;
  netPnl: number;
  grade: Grade | null;
  notes: string | null;
}

const COUNT = 8;
const NOTES = {
  won: [
    "Held through the pullback; the trend did the work.",
    "Took it at the target the week before expiry.",
  ],
  lost: ["Thesis broke on the gap down; cut it.", "Theta ate it while the stock went nowhere."],
};

/** The Friday expiry about `days` after `date`, a Thursday when that Friday is a holiday. */
function expiryAfter(date: string, days: number): string {
  let expiry = addDays(date, days);
  while (weekdayOfDate(expiry) !== "Fri") expiry = addDays(expiry, 1);
  while (!isTradingDay(expiry)) expiry = addDays(expiry, -1);
  return expiry;
}

const yearsBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365 * 86_400_000);

/**
 * Eight swings spread over the sessions, each shape twice, priced by Black-Scholes at the symbol's own volatility from
 * the walk's open (entry, 10:15) and close (exit, 15:30, or half an hour before a half day's close). Every one is
 * closed: an open one would ask the chart for bars up to the real today, which the demo doesn't have.
 */
export function planSwings(
  rng: Rng,
  sessions: readonly string[],
  walks: ReadonlyMap<string, ReadonlyMap<string, { open: number; close: number }>>,
  symbols: readonly string[],
): SwingPlan[] {
  const plans: SwingPlan[] = [];
  const stride = Math.max(1, Math.floor(sessions.length / COUNT));
  // A draw can fail (a short leg priced at or above its long one); the next attempt redraws the same slot.
  for (let attempt = 0; plans.length < COUNT && attempt < COUNT * 5; attempt++) {
    const slot = plans.length;
    const shape = SWING_SHAPES[slot % SWING_SHAPES.length] ?? "long_call";
    const entryAt = Math.min(sessions.length - 2, slot * stride + int(rng, 0, Math.max(0, stride - 1)));
    const exitAt = Math.min(sessions.length - 1, entryAt + int(rng, 1, 15));
    const entry = sessions[entryAt];
    const exit = sessions[exitAt];
    const symbol = pick(rng, symbols);
    const walk = walks.get(symbol);
    const atEntry = entry ? walk?.get(entry) : undefined;
    const atExit = exit ? walk?.get(exit) : undefined;
    if (!entry || !exit || !atEntry || !atExit) continue;
    const { vol } = symbolInfo(symbol);
    const right: OptionRight = shape === "long_call" || shape === "call_debit_spread" ? "C" : "P";
    const spread = shape === "call_debit_spread" || shape === "put_debit_spread";
    const step = strikeStep(atEntry.open);
    const atm = Math.round(atEntry.open / step) * step;
    const long = right === "C" ? atm - step * int(rng, 0, 1) : atm + step * int(rng, 0, 1);
    const short = right === "C" ? long + step * int(rng, 2, 4) : long - step * int(rng, 2, 4);
    const expiry = expiryAfter(entry, int(rng, 28, 42));
    const contracts = int(rng, 1, 3);
    const price = (strike: number, spot: number, date: string) =>
      Math.max(
        0.05,
        cents(bsPrice(right, spot, strike, yearsBetween(date, expiry), vol * uniform(rng, 0.9, 1.1))),
      );
    const legs: SwingLegPlan[] = [
      {
        right,
        strike: long,
        expiry,
        quantity: contracts,
        openPrice: price(long, atEntry.open, entry),
        closePrice: price(long, atExit.close, exit),
      },
      ...(spread
        ? [
            {
              right,
              strike: short,
              expiry,
              quantity: -contracts,
              openPrice: price(short, atEntry.open, entry),
              closePrice: price(short, atExit.close, exit),
            },
          ]
        : []),
    ];
    // A spread's short leg must cost less than its long leg, or it's no debit.
    if (spread && (legs[1]?.openPrice ?? 0) >= (legs[0]?.openPrice ?? 0)) continue;
    const fees = cents(FEE_PER_CONTRACT_SIDE * contracts * legs.length * 2);
    const gross = legs.reduce((sum, leg) => sum + leg.quantity * 100 * (leg.closePrice - leg.openPrice), 0);
    const netPnl = cents(gross - fees);
    plans.push({
      symbol,
      book: chance(rng, 0.5) ? "live" : "paper",
      legs,
      openedAt: nyWallClock(entry, 10 * 60 + 15),
      closedAt: nyWallClock(exit, Math.min(15 * 60 + 30, regularClose(exit) - 30)),
      fees,
      netPnl,
      grade: pick(rng, ["A", "B", "C", null] as const),
      notes: chance(rng, 0.6) ? pick(rng, netPnl > 0 ? NOTES.won : NOTES.lost) : null,
    });
  }
  return plans;
}
