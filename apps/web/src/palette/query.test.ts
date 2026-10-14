import { describe, expect, it } from "vitest";
import { matchTrades, type PaletteTrade, parseTradeQuery, type QueryContext } from "./query.js";

const CTX: QueryContext = {
  today: "2026-10-12",
  tickers: new Set(["NVDA", "SPY", "MSFT"]),
  setups: [
    { id: "s1", name: "ORB breakout" },
    { id: "s2", name: "VWAP reclaim" },
    { id: "s3", name: "Spy fade" },
  ],
};
const read = (text: string) => parseTradeQuery(text, CTX);

describe("parseTradeQuery", () => {
  it.each([
    ["today", "2026-10-12"],
    ["yesterday", "2026-10-11"],
    ["mon", "2026-10-12"],
    ["fri", "2026-10-09"],
    ["sunday", "2026-10-11"],
    ["28/9", "2026-09-28"],
    ["28.09", "2026-09-28"],
    ["9/12", "2025-12-09"],
    ["9/12/26", "2026-12-09"],
    ["28-9-2026", "2026-09-28"],
    ["2026-09-28", "2026-09-28"],
  ])("reads %s as the day %s", (text, date) => {
    expect(read(text)).toEqual([{ kind: "day", date }]);
  });

  it("refuses a US date", () => {
    expect(read("9/28")).toEqual([{ kind: "unknown", text: "9/28" }]);
  });

  it.each([
    ["sep", "2026-09"],
    ["september", "2026-09"],
    ["december", "2025-12"],
    ["2026-09", "2026-09"],
  ])("reads %s as the month %s", (text, month) => {
    expect(read(text)).toEqual([{ kind: "month", month }]);
  });

  it("reads strategies and books", () => {
    expect(read("scalp fly missed paper live")).toEqual([
      { kind: "strategy", strategy: "scalp" },
      { kind: "strategy", strategy: "iron_fly" },
      { kind: "book", book: "missed" },
      { kind: "book", book: "paper" },
      { kind: "book", book: "live" },
    ]);
    expect(read("swing swings")).toEqual([
      { kind: "strategy", strategy: "swing" },
      { kind: "strategy", strategy: "swing" },
    ]);
  });

  it("reads tickers, exact or by prefix, in any case", () => {
    expect(read("NVDA nv")).toEqual([
      { kind: "ticker", ticker: "NVDA", exact: true },
      { kind: "ticker", ticker: "NV", exact: false },
    ]);
  });

  it("reads setups by the start of their name, several words included", () => {
    expect(read("orb breakout")).toEqual([{ kind: "setup", ids: ["s1"], text: "orb breakout" }]);
    expect(read("vwap rec")).toEqual([{ kind: "setup", ids: ["s2"], text: "vwap rec" }]);
    expect(read("orb sep")).toEqual([
      { kind: "setup", ids: ["s1"], text: "orb" },
      { kind: "month", month: "2026-09" },
    ]);
  });

  it("keeps a ticker a ticker unless more words make a setup", () => {
    expect(read("spy")).toEqual([{ kind: "ticker", ticker: "SPY", exact: true }]);
    expect(read("spy fade")).toEqual([{ kind: "setup", ids: ["s3"], text: "spy fade" }]);
  });

  it("calls the rest unknown", () => {
    expect(read("nvda xyz")).toEqual([
      { kind: "ticker", ticker: "NVDA", exact: true },
      { kind: "unknown", text: "xyz" },
    ]);
    expect(read("   ")).toEqual([]);
  });
});

const trade = (id: string, iso: string, extra: Partial<PaletteTrade> = {}): PaletteTrade => ({
  id,
  openedAt: Date.parse(iso),
  underlying: "NVDA",
  strategy: "scalp",
  book: "live",
  setupId: null,
  ...extra,
});
const TRADES = [
  trade("t1", "2026-09-28T13:35:00Z", { setupId: "s1" }),
  trade("t2", "2026-09-28T14:00:00Z", { book: "paper", setupId: "s2" }),
  trade("t3", "2026-09-29T14:00:00Z", { underlying: "SPY", strategy: "iron_fly" }),
  trade("t4", "2026-09-28T15:00:00Z", { book: "missed", setupId: "s1" }),
  // 23:30 in New York on the 28th.
  trade("t5", "2026-09-29T03:30:00Z", { underlying: "MSFT" }),
];
const ids = (text: string) => matchTrades(TRADES, read(text)).map((each) => each.id);

describe("matchTrades", () => {
  it("needs every word, newest first", () => {
    expect(ids("nvda 28/9")).toEqual(["t4", "t2", "t1"]);
    expect(ids("nvda 28/9 paper")).toEqual(["t2"]);
    expect(ids("orb")).toEqual(["t4", "t1"]);
    expect(ids("fly")).toEqual(["t3"]);
    expect(ids("sep missed")).toEqual(["t4"]);
  });

  it("uses New York's day", () => {
    expect(ids("msft 28/9")).toEqual(["t5"]);
  });

  it("shows nothing for an unknown word or an empty query", () => {
    expect(ids("nvda xyz")).toEqual([]);
    expect(ids("")).toEqual([]);
  });
});
