import type { StatTrade } from "./stats.js";

/** Epoch ms for a New York wall-clock time. Every fixture date is in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);

/*
 * Eight closed trades, worked by hand. H is a 3-lot scalp; the rest are flies (body 10).
 *
 * id ticker opened (NY)        closed (NY)       net   fees expiry  wings P/C  lots credit/sh  max profit  kept
 * A  AA     Wed 09-02 15:45    Thu 09-03 09:50   +100  4    09-04   9 / 11     1    2.04        200         +50%
 * B  BB     Thu 09-03 15:50    Fri 09-04 15:40   -300  6    09-04   8 / 13     2    1.53        300        -100%
 * C  CC     Fri 09-04 15:30    Tue 09-08 09:45   +200  2    09-11   9 / 11     3    1.34        400         +50%
 * D  DD     Tue 09-08 07:45    Tue 09-08 09:45      0  2    09-08   5 / none   4    1.505       600           0%
 * E  AA     Wed 09-09 15:50    Thu 09-10 12:00    +50  4    09-18   4 / 16     5    2.008      1000          +5%
 * F  FF     Mon 09-14 15:40    Wed 09-16 10:00   -150  6    10-16   7 / 14     6    1.01        600         -25%
 * G  GG     Wed 09-30 15:50    Thu 10-01 09:55   +400  8    10-02   8 / 12    10    0.808       800         +50%
 * H  HH     Thu 10-01 15:50    Fri 10-02 09:40   -100  4    10-02   scalp      3    —           —           —
 *
 * C and D close at the same instant. Net +200, fees 36, before fees 236. Equity by close:
 * 100, -200, 0, 0, 50, -100, 300, 200. Running peak from $0: 100 ×6, then 300 ×2, so max drawdown is -300.
 */
interface Row {
  id: string;
  underlying: string;
  opened: string;
  closed: string;
  netPnl: number;
  fees: number;
  expiry: string;
  /** Put wing, body, call wing (null for a 1-wing fly), contracts, credit per share. Absent for a scalp. */
  fly?: [number, number, number | null, number, number];
}

const ROWS: Row[] = [
  {
    id: "A",
    underlying: "AA",
    opened: "2026-09-02 15:45",
    closed: "2026-09-03 09:50",
    netPnl: 100,
    fees: 4,
    expiry: "2026-09-04",
    fly: [9, 10, 11, 1, 2.04],
  },
  {
    id: "B",
    underlying: "BB",
    opened: "2026-09-03 15:50",
    closed: "2026-09-04 15:40",
    netPnl: -300,
    fees: 6,
    expiry: "2026-09-04",
    fly: [8, 10, 13, 2, 1.53],
  },
  {
    id: "C",
    underlying: "CC",
    opened: "2026-09-04 15:30",
    closed: "2026-09-08 09:45",
    netPnl: 200,
    fees: 2,
    expiry: "2026-09-11",
    fly: [9, 10, 11, 3, 1.34],
  },
  {
    id: "D",
    underlying: "DD",
    opened: "2026-09-08 07:45",
    closed: "2026-09-08 09:45",
    netPnl: 0,
    fees: 2,
    expiry: "2026-09-08",
    fly: [5, 10, null, 4, 1.505],
  },
  {
    id: "E",
    underlying: "AA",
    opened: "2026-09-09 15:50",
    closed: "2026-09-10 12:00",
    netPnl: 50,
    fees: 4,
    expiry: "2026-09-18",
    fly: [4, 10, 16, 5, 2.008],
  },
  {
    id: "F",
    underlying: "FF",
    opened: "2026-09-14 15:40",
    closed: "2026-09-16 10:00",
    netPnl: -150,
    fees: 6,
    expiry: "2026-10-16",
    fly: [7, 10, 14, 6, 1.01],
  },
  {
    id: "G",
    underlying: "GG",
    opened: "2026-09-30 15:50",
    closed: "2026-10-01 09:55",
    netPnl: 400,
    fees: 8,
    expiry: "2026-10-02",
    fly: [8, 10, 12, 10, 0.808],
  },
  {
    id: "H",
    underlying: "HH",
    opened: "2026-10-01 15:50",
    closed: "2026-10-02 09:40",
    netPnl: -100,
    fees: 4,
    expiry: "2026-10-02",
  },
];

export const FIXTURE: StatTrade[] = ROWS.map((row) => ({
  id: row.id,
  strategy: row.fly ? "iron_fly" : "scalp",
  underlying: row.underlying,
  openedAt: ny(row.opened),
  closedAt: ny(row.closed),
  netPnl: row.netPnl,
  fees: row.fees,
  legs: [{ expiry: row.expiry, quantity: row.fly ? -row.fly[3] : 3 }],
  ironFly: row.fly
    ? {
        putWingStrike: row.fly[0],
        bodyPutStrike: row.fly[1],
        bodyCallStrike: row.fly[1],
        callWingStrike: row.fly[2],
        contracts: row.fly[3],
        creditPerShare: row.fly[4],
      }
    : null,
}));

/** One closed 1-lot fly, with whatever the test changes. */
export function makeTrade(overrides: Partial<StatTrade> = {}): StatTrade {
  return {
    id: "T",
    strategy: "iron_fly",
    underlying: "TT",
    openedAt: ny("2026-09-01 15:45"),
    closedAt: ny("2026-09-02 09:50"),
    netPnl: 100,
    fees: 4,
    legs: [{ expiry: "2026-09-04", quantity: -1 }],
    ironFly: {
      putWingStrike: 9,
      bodyPutStrike: 10,
      bodyCallStrike: 10,
      callWingStrike: 11,
      contracts: 1,
      creditPerShare: 2.04,
    },
    ...overrides,
  };
}
