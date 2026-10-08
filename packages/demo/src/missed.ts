import type { Direction, Grade, PriceBar } from "@tj/core";
import { cents } from "./prices.js";
import { chance, int, pick, type Rng, uniform, weighted } from "./random.js";
import { symbolInfo } from "./symbols.js";

/** A missed trade the demo marks (missed-trades spec §8): a setup seen and not taken, scored on the stock. */
export interface MissedPlan {
  symbol: string;
  direction: Direction;
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitPrice: number;
  setup: string;
  grade: Grade;
  /** The skip reason, then an emotion now and then. */
  tags: string[];
  notes: string | null;
}

/** Why a missed trade was skipped: mostly the ones a trader would rather not admit to. */
const SKIPS: readonly (readonly [string, number])[] = [
  ["Hesitated", 0.35],
  ["Saw it late", 0.25],
  ["Already in a trade", 0.15],
  ["Didn't meet my rules", 0.1],
  ["Away from screen", 0.1],
  ["Hit daily loss limit", 0.05],
];

const NOTES: Record<string, string[]> = {
  Hesitated: ["Waited for a second touch that never came.", "Had the order typed and didn't send it."],
  "Saw it late": ["Was watching the other chart.", "Spotted it after the move had started."],
  "Already in a trade": ["Didn't want two positions on at once."],
  "Didn't meet my rules": ["Volume too thin on the break.", "Against the day's trend, so I let it go."],
  "Away from screen": ["Stepped away for a minute."],
  "Hit daily loss limit": ["Stopped trading after two losers."],
};

/**
 * One missed trade on a symbol's session (missed-trades spec §8): an entry in the first 90 minutes, crowding the open,
 * stock levels like the scalps', and the exit at the first of the target, the stop or a 5–40 minute time stop. The
 * direction follows the next 30 minutes' drift 80% of the time, so most would have won.
 */
export function planMissed(rng: Rng, symbol: string, stock: readonly PriceBar[]): MissedPlan | null {
  // Minute 0 is 09:30; the bars are the regular session's, one a minute.
  const entry = Math.min(stock.length - 2, Math.floor(uniform(rng, 0, 1) ** 1.6 * 90));
  const start = stock[entry];
  const ahead = stock[Math.min(entry + 30, stock.length - 1)];
  if (!start || !ahead) return null;
  const drift = ahead.c - start.c;
  const long = drift >= 0 === chance(rng, 0.8);
  const up = long ? 1 : -1;
  const entryPrice = cents(start.c);
  const dailyMove = symbolInfo(symbol).vol / Math.sqrt(252);
  const stopPrice = cents(entryPrice * (1 - up * dailyMove * uniform(rng, 0.11, 0.17)));
  const targetPrice = cents(entryPrice * (1 + up * dailyMove * uniform(rng, 0.12, 0.2)));
  if (stopPrice === entryPrice || targetPrice === entryPrice) return null;

  const maxHold = int(rng, 5, 40);
  const lastIndex = Math.min(entry + maxHold, stock.length - 1);
  let exitIndex = lastIndex;
  let exitPrice = cents(stock[lastIndex]?.c ?? entryPrice);
  for (let index = entry + 1; index <= lastIndex; index++) {
    const bar = stock[index];
    if (!bar) break;
    if (long ? bar.l <= stopPrice : bar.h >= stopPrice) {
      exitIndex = index;
      exitPrice = stopPrice;
      break;
    }
    if (long ? bar.h >= targetPrice : bar.l <= targetPrice) {
      exitIndex = index;
      exitPrice = targetPrice;
      break;
    }
  }
  const exitBar = stock[exitIndex];
  if (!exitBar || exitIndex <= entry) return null;

  const won = (exitPrice - entryPrice) * up > 0;
  const skip = weighted(rng, SKIPS);
  const tags = [skip];
  if (chance(rng, 0.3)) tags.push(skip === "Hesitated" ? "Rushed" : "Calm");
  return {
    symbol,
    direction: long ? "long" : "short",
    openedAt: start.t,
    closedAt: exitBar.t,
    entryPrice,
    stopPrice,
    targetPrice,
    exitPrice,
    setup: entry < 30 ? "ORB breakout" : "VWAP reclaim",
    grade: weighted(
      rng,
      won
        ? [
            ["A", 0.4],
            ["B", 0.5],
            ["C", 0.1],
          ]
        : [
            ["B", 0.4],
            ["C", 0.5],
            ["D", 0.1],
          ],
    ),
    tags,
    notes: chance(rng, 0.5) ? pick(rng, NOTES[skip] ?? [""]) || null : null,
  };
}
