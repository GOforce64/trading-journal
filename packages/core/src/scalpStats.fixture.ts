import type { ClosedScalp } from "./scalpStats.js";
import { ny } from "./stats.fixture.js";

/** One closed NVDA 0DTE call scalp, 2 contracts at 1.00 (premium $200), with whatever the test changes. */
export function scalp(overrides: Partial<ClosedScalp> & { id: string }): ClosedScalp {
  return {
    strategy: "scalp",
    underlying: "NVDA",
    book: "live",
    openedAt: ny("2026-09-28 09:31"),
    closedAt: ny("2026-09-28 09:46"),
    netPnl: 0,
    fees: 1.3,
    setupId: null,
    grade: null,
    tagIds: [],
    legs: [{ right: "C", expiry: "2026-09-28", quantity: 2, multiplier: 100, openPrice: 1 }],
    ironFly: null,
    risk: { r: null, problem: "no_stop" },
    ...overrides,
  };
}

const leg = (right: "C" | "P", expiry: string, quantity: number, openPrice: number) => [
  { right, expiry, quantity, multiplier: 100, openPrice },
];

/*
 * Five closed scalps, worked by hand. Sep 28 is a Monday.
 *
 * id  setup ticker opened (NY)   held    net   R     grade tags          side  DTE  premium  return   book
 * S1  orb   NVDA   Mon 09:31     2 min   +100  1.00  A     calm          C     0    $200     +50%     live
 * S2  orb   NVDA   Mon 09:36     30 s    −50   −0.50 B     chased        P     0    $200     −25%     live
 * S3  vwap  SPY    Mon 09:50     15 min  +30   —     —     chased, calm  C     1    $300     +10%     paper
 *                                                  (no stop)
 * S4  —     QQQ    Tue 10:45     45 min  −70   —     A     moved         P     3    $600     −11.67%  live
 *                                                  (no stock price)
 * S5  orb   SPY    Tue 09:20     5 min   0     0.00  C     —             C     0    $50      0%       live
 *
 * Net +10: 2 wins, 2 losses, 1 scratch. PF 130 / 120. Avg R (1 − 0.5 + 0) ÷ 3 = 0.17 over 3.
 * Avg return (0.5 − 0.25 + 0.1 − 0.11667 + 0) ÷ 5 = 0.046667. Holds 0.5, 2, 5, 15, 45: mean 13.5, median 5.
 */
export const SCALPS: ClosedScalp[] = [
  scalp({
    id: "S1",
    setupId: "orb",
    openedAt: ny("2026-09-28 09:31"),
    closedAt: ny("2026-09-28 09:33"),
    netPnl: 100,
    grade: "A",
    tagIds: ["calm"],
    risk: { r: 1, problem: null },
  }),
  scalp({
    id: "S2",
    setupId: "orb",
    openedAt: ny("2026-09-28 09:36"),
    closedAt: ny("2026-09-28 09:36") + 30_000,
    netPnl: -50,
    grade: "B",
    tagIds: ["chased"],
    legs: leg("P", "2026-09-28", 2, 1),
    risk: { r: -0.5, problem: null },
  }),
  scalp({
    id: "S3",
    setupId: "vwap",
    underlying: "SPY",
    book: "paper",
    openedAt: ny("2026-09-28 09:50"),
    closedAt: ny("2026-09-28 10:05"),
    netPnl: 30,
    tagIds: ["chased", "calm"],
    legs: leg("C", "2026-09-29", 1, 3),
  }),
  scalp({
    id: "S4",
    underlying: "QQQ",
    openedAt: ny("2026-09-29 10:45"),
    closedAt: ny("2026-09-29 11:30"),
    netPnl: -70,
    grade: "A",
    tagIds: ["moved"],
    legs: leg("P", "2026-10-02", 3, 2),
    risk: { r: null, problem: "no_stock_price" },
  }),
  scalp({
    id: "S5",
    setupId: "orb",
    underlying: "SPY",
    openedAt: ny("2026-09-29 09:20"),
    closedAt: ny("2026-09-29 09:25"),
    netPnl: 0,
    grade: "C",
    legs: leg("C", "2026-09-29", 1, 0.5),
    risk: { r: 0, problem: null },
  }),
];

export const SETUP_NAMES = new Map([
  ["orb", "ORB breakout"],
  ["vwap", "VWAP reclaim"],
]);
export const EMOTIONS = new Map([["calm", "Calm"]]);
export const MISTAKES = new Map([
  ["chased", "Chased entry"],
  ["moved", "Moved stop"],
]);
