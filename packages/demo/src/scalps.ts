import { addDays, type Grade, isTradingDay, type OptionRight, type PriceBar, weekdayOfDate } from "@tj/core";
import { cents, optionBars } from "./prices.js";
import { chance, int, pick, type Rng, uniform, weighted } from "./random.js";
import { strikeStep, symbolInfo } from "./symbols.js";

/** A contract a side: $0.65 commission and $0.02 exchange fees (demo spec §3.3). */
export const FEE_PER_CONTRACT_SIDE = 0.67;
const SECOND_MS = 1_000;

/** A scalp as the demo plans it, before it's written (demo spec §3.3). Setup and tags are names, not ids. */
export interface ScalpPlan {
  symbol: string;
  book: "live" | "paper";
  right: OptionRight;
  strike: number;
  expiry: string;
  contracts: number;
  openedAt: number;
  closedAt: number;
  openPrice: number;
  closePrice: number;
  fees: number;
  netPnl: number;
  /** What ended it: a target, the stop, or the time stop. */
  exit: "target" | "stop" | "time";
  stop: { basis: "stock" | "premium"; price: number };
  targets: { price: number; contracts: number }[];
  setup: string | null;
  grade: Grade | null;
  tags: string[];
  notes: string | null;
  reviewed: boolean;
  /** The contract's bars for the day: the very ones that priced the entry and the exit. */
  optionBars: PriceBar[];
}

/** SPY and QQQ list an expiry every session; the rest trade that week's Friday, or Thursday when it's a holiday. */
export function expiryFor(symbol: string, date: string): string {
  if (symbol === "SPY" || symbol === "QQQ") return date;
  const toFriday = (5 - ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(weekdayOfDate(date)) - 1 + 7) % 7;
  let expiry = addDays(date, toFriday);
  while (!isTradingDay(expiry)) expiry = addDays(expiry, -1);
  return expiry;
}

/** Notes by setup, and by how the trade went, so a winner never reads as a stop-out. */
export const SCALP_NOTES: Record<string, { won: string[]; lost: string[] }> = {
  "ORB breakout": {
    won: [
      "Clean break of the 5-minute range on volume; took it on the first pullback.",
      "Opening range was tight, so the break had room to run.",
      "Waited for the retest of the range high before going in.",
    ],
    lost: [
      "Chased the break a little late; the first push was already done.",
      "Range break failed straight back inside; the stop did its job.",
      "Gap and go that didn't go: faded right after the break.",
    ],
  },
  "VWAP reclaim": {
    won: [
      "Flushed below VWAP, reclaimed it on the 1-minute close, and held.",
      "Second test of VWAP held; sized up a little.",
      "Trend day; VWAP was support all morning.",
    ],
    lost: [
      "Took it before the candle closed back over VWAP: too early.",
      "Lost VWAP again right after the entry; out at the stop.",
      "Reclaim looked weak on volume, and it was.",
    ],
  },
};

const WIN_GRADES: readonly (readonly [Grade, number])[] = [
  ["A", 0.4],
  ["B", 0.45],
  ["C", 0.15],
];
const LOSS_GRADES: readonly (readonly [Grade, number])[] = [
  ["B", 0.3],
  ["C", 0.4],
  ["D", 0.25],
  ["F", 0.05],
];
const MISTAKES = ["Moved stop", "FOMO entry", "Oversized", "Exited early"];

/** One step out of the money: the first strike above the stock for a call, below it for a put. */
const strikeFor = (right: OptionRight, price: number, step: number) =>
  right === "C" ? Math.floor(price / step) * step + step : Math.ceil(price / step) * step - step;

/**
 * Up to two scalps on one symbol's session (demo spec §2): an entry mostly in the first 90 minutes, a direction that
 * reads the next half hour right 74% of the time, and an exit at the first of the target, the stop or the time stop.
 */
export function planScalps(
  rng: Rng,
  date: string,
  symbol: string,
  stock: readonly PriceBar[],
  reviewed: boolean,
): ScalpPlan[] {
  const info = symbolInfo(symbol);
  const plans: ScalpPlan[] = [];
  const wanted = weighted(rng, [
    [1, 0.6],
    [2, 0.4],
  ] as const);
  // The last entry leaves room for the longest hold before the close.
  const lastEntry = stock.length - 45;
  let earliest = 1;
  // One set of bars a contract a day: a second scalp of the same contract is priced from the first's.
  const contractBars = new Map<string, PriceBar[]>();
  for (let count = 0; count < wanted && earliest < lastEntry; count++) {
    const morning = chance(rng, 0.7) && earliest < 90;
    // Morning entries crowd the open, as a scalper's do.
    const entry = morning
      ? earliest + Math.floor((Math.min(90, lastEntry) - earliest) * rng() ** 2)
      : int(rng, Math.max(earliest, 90), lastEntry);
    const plan = planOne(rng, date, symbol, stock, entry, reviewed, info.vol, info.iv, contractBars);
    plans.push(plan);
    earliest = Math.ceil((plan.closedAt - (stock[0]?.t ?? 0)) / 60_000) + 5;
  }
  return plans;
}

function planOne(
  rng: Rng,
  date: string,
  symbol: string,
  stock: readonly PriceBar[],
  entry: number,
  reviewed: boolean,
  vol: number,
  iv: number,
  contractBars: Map<string, PriceBar[]>,
): ScalpPlan {
  const bar = (index: number) => {
    const found = stock[Math.min(index, stock.length - 1)];
    if (!found) throw new Error(`no bar ${index} on ${date}`);
    return found;
  };
  const start = bar(entry);
  const drift = bar(entry + 30).c - start.c;
  const right: OptionRight = drift >= 0 === chance(rng, 0.74) ? "C" : "P";
  const contract = {
    right,
    strike: strikeFor(right, start.o, strikeStep(start.o)),
    expiry: expiryFor(symbol, date),
  };
  const key = `${contract.right}${contract.strike}`;
  const options = contractBars.get(key) ?? optionBars(stock, contract, iv, rng);
  contractBars.set(key, options);
  const premium = (index: number) => options[Math.min(index, options.length - 1)] ?? options[0];
  const contracts = int(rng, 1, 5);

  const entrySecond = int(rng, 0, 59);
  const openBar = premium(entry);
  if (!openBar) throw new Error(`no option bars on ${date}`);
  const openPrice = Math.max(0.01, cents(openBar.o + ((openBar.c - openBar.o) * entrySecond) / 60));
  const up = right === "C" ? 1 : -1;

  const basis = chance(rng, 0.8) ? "stock" : "premium";
  const stockEntry = start.o + ((start.c - start.o) * entrySecond) / 60;
  // Stock levels sit a share of the stock's daily move away, so a quiet index gets tighter ones than a wild stock.
  const dailyMove = vol / Math.sqrt(252);
  const stop =
    basis === "stock"
      ? cents(stockEntry * (1 - up * dailyMove * uniform(rng, 0.08, 0.13)))
      : cents(openPrice * (1 - uniform(rng, 0.25, 0.4)));
  const target =
    basis === "stock"
      ? cents(stockEntry * (1 + up * dailyMove * uniform(rng, 0.12, 0.22)))
      : cents(openPrice * (1 + uniform(rng, 0.4, 0.8)));
  const maxHold = int(rng, 5, 40);

  let exit: ScalpPlan["exit"] = "time";
  let exitIndex = Math.min(entry + maxHold, stock.length - 1);
  let closePrice = premium(exitIndex)?.c ?? openPrice;
  for (let index = entry + 1; index <= Math.min(entry + maxHold, stock.length - 1); index++) {
    const under = bar(index);
    const option = premium(index);
    if (!option) break;
    const stopped = basis === "stock" ? (up > 0 ? under.l <= stop : under.h >= stop) : option.l <= stop;
    const reached = basis === "stock" ? (up > 0 ? under.h >= target : under.l <= target) : option.h >= target;
    if (stopped) {
      exit = "stop";
      exitIndex = index;
      closePrice = basis === "premium" ? Math.min(stop, option.c) : option.c;
      break;
    }
    if (reached) {
      exit = "target";
      exitIndex = index;
      // A limit order at a premium target fills there; a stock level is acted on at the minute's close.
      closePrice = basis === "premium" ? target : option.c;
      break;
    }
  }
  closePrice = Math.max(0.01, cents(closePrice));
  const exitSecond = int(rng, 0, 59);
  const fees = cents(contracts * 2 * FEE_PER_CONTRACT_SIDE);
  const netPnl = cents((closePrice - openPrice) * contracts * 100 - fees);

  const targets =
    contracts >= 2 && chance(rng, 0.4)
      ? [
          {
            price: cents(basis === "stock" ? (stockEntry + target) / 2 : (openPrice + target) / 2),
            contracts: Math.floor(contracts / 2),
          },
          { price: target, contracts: contracts - Math.floor(contracts / 2) },
        ]
      : [{ price: target, contracts }];

  const won = netPnl > 0;
  const setup =
    entry < 30
      ? chance(rng, 0.7)
        ? "ORB breakout"
        : "VWAP reclaim"
      : chance(rng, 0.75)
        ? "VWAP reclaim"
        : "ORB breakout";
  const grade = weighted(rng, won ? WIN_GRADES : LOSS_GRADES);
  const tags = [
    weighted(
      rng,
      won
        ? [
            ["Calm", 0.8],
            ["Rushed", 0.2],
          ]
        : [
            ["Calm", 0.4],
            ["Rushed", 0.45],
            ["Revenge", 0.15],
          ],
    ),
  ];
  if (!won && chance(rng, 1 / 3)) tags.push(pick(rng, MISTAKES));
  const notes = chance(rng, 0.5) ? pick(rng, SCALP_NOTES[setup]?.[won ? "won" : "lost"] ?? []) : null;
  const dropGrade = !reviewed && chance(rng, 0.5);

  return {
    symbol,
    book: chance(rng, 0.7) ? "live" : "paper",
    ...contract,
    contracts,
    openedAt: start.t + entrySecond * SECOND_MS,
    closedAt: bar(exitIndex).t + exitSecond * SECOND_MS,
    openPrice,
    closePrice,
    fees,
    netPnl,
    exit,
    stop: { basis, price: stop },
    targets,
    setup: reviewed || dropGrade ? setup : null,
    grade: reviewed || !dropGrade ? grade : null,
    tags,
    notes,
    reviewed,
    optionBars: options,
  };
}
