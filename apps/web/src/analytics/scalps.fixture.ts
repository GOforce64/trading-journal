import { tradeRow } from "./testing.js";

export const SCALP_SETUPS = [
  { id: "orb", name: "ORB breakout", strategy: "scalp", description: null, archived: false, tradeCount: 3 },
  { id: "vwap", name: "VWAP reclaim", strategy: "scalp", description: null, archived: false, tradeCount: 1 },
];
export const SCALP_TAGS = [
  { id: "calm", name: "Calm", kind: "emotion", archived: false, tradeCount: 2 },
  { id: "chased", name: "Chased entry", kind: "mistake", archived: false, tradeCount: 2 },
  { id: "moved", name: "Moved stop", kind: "mistake", archived: false, tradeCount: 1 },
];

/*
 * The core fixture's five scalps (packages/core/src/scalpStats.fixture.ts) as the server lists them, plus a fly.
 * Net +10, win 40%, Avg R +0.17R over 3 of 5, avg return +4.7%, PF 1.08, holds 2, 1, 15, 45 and 5 minutes.
 */
export const SCALP_ROWS = [
  tradeRow({
    id: "s1",
    strategy: "scalp",
    underlying: "NVDA",
    opened: "2026-09-28 09:31",
    closed: "2026-09-28 09:33",
    netPnl: 100,
    r: 1,
    setupId: "orb",
    grade: "A",
    tagIds: ["calm"],
    contracts: 2,
    expiry: "2026-09-28",
    book: "live",
  }),
  tradeRow({
    id: "s2",
    strategy: "scalp",
    underlying: "NVDA",
    opened: "2026-09-28 09:36",
    closed: "2026-09-28 09:37",
    netPnl: -50,
    r: -0.5,
    setupId: "orb",
    grade: "B",
    tagIds: ["chased"],
    right: "P",
    contracts: 2,
    expiry: "2026-09-28",
    book: "live",
  }),
  tradeRow({
    id: "s3",
    strategy: "scalp",
    underlying: "SPY",
    opened: "2026-09-28 09:50",
    closed: "2026-09-28 10:05",
    netPnl: 30,
    problem: "no_stop",
    setupId: "vwap",
    tagIds: ["chased", "calm"],
    openPrice: 3,
    expiry: "2026-09-29",
  }),
  tradeRow({
    id: "s4",
    strategy: "scalp",
    underlying: "QQQ",
    opened: "2026-09-29 10:45",
    closed: "2026-09-29 11:30",
    netPnl: -70,
    problem: "no_stock_price",
    grade: "A",
    tagIds: ["moved"],
    right: "P",
    contracts: 3,
    openPrice: 2,
    expiry: "2026-10-02",
    book: "live",
  }),
  tradeRow({
    id: "s5",
    strategy: "scalp",
    underlying: "SPY",
    opened: "2026-09-29 09:20",
    closed: "2026-09-29 09:25",
    netPnl: 0,
    r: 0,
    setupId: "orb",
    grade: "C",
    openPrice: 0.5,
    expiry: "2026-09-29",
    book: "live",
  }),
  tradeRow({
    id: "f1",
    underlying: "AA",
    opened: "2026-09-02 15:45",
    closed: "2026-09-03 09:50",
    netPnl: 999,
  }),
];
