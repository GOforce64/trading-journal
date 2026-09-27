import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { round2 } from "./money.js";
import {
  contractsSplit,
  creditSplit,
  DEFAULT_EDGES,
  dteSplit,
  type EdgeKind,
  edgeLabels,
  holdSplit,
  monthSplit,
  parseEdges,
  type SplitRow,
  tickerSplit,
  weekdaySplit,
  wingsSplit,
  wingWidthSplit,
} from "./splits.js";
import { tradesArbitrary } from "./stats.arbitrary.js";
import { FIXTURE, makeTrade, ny } from "./stats.fixture.js";
import { closedTrades, summarize } from "./stats.js";

const closed = closedTrades(FIXTURE);
const flies = closed.filter((trade) => trade.strategy === "iron_fly");
const rows = (split: SplitRow[]) => split.map((row) => [row.label, row.trades, row.net]);

describe("splits of the fixture", () => {
  it("by weekday opened", () => {
    expect(rows(weekdaySplit(closed))).toEqual([
      ["Mon", 1, -150],
      ["Tue", 1, 0],
      ["Wed", 3, 550],
      ["Thu", 2, -400],
      ["Fri", 1, 200],
    ]);
  });

  it("by days to expiry", () => {
    expect(rows(dteSplit(closed))).toEqual([
      ["0–1", 3, -400],
      ["2–7", 3, 700],
      ["8–14", 1, 50],
      ["15+", 1, -150],
    ]);
  });

  it("by contracts, with the default edges and with others", () => {
    expect(rows(contractsSplit(closed, DEFAULT_EDGES.contracts))).toEqual([
      ["1", 1, 100],
      ["2–3", 3, -200],
      ["4–5", 2, 50],
      ["6+", 2, 250],
    ]);
    expect(rows(contractsSplit(closed, [5, 10]))).toEqual([
      ["1–4", 5, -100],
      ["5–9", 2, -100],
      ["10+", 1, 400],
    ]);
  });

  it("by hold time", () => {
    expect(rows(holdSplit(closed))).toEqual([
      ["same day", 1, 0],
      ["overnight", 3, 400],
      ["1 full day", 2, -250],
      ["weekend", 1, 200],
      ["longer", 1, -150],
    ]);
  });

  it("by close month", () => {
    expect(rows(monthSplit(closed))).toEqual([
      ["Sep 2026", 6, -100],
      ["Oct 2026", 2, 300],
    ]);
  });

  it("by ticker, best first", () => {
    expect(rows(tickerSplit(closed))).toEqual([
      ["GG", 1, 400],
      ["CC", 1, 200],
      ["AA", 2, 150],
      ["DD", 1, 0],
      ["HH", 1, -100],
      ["FF", 1, -150],
      ["BB", 1, -300],
    ]);
  });

  it("by credit, wings and wider wing width, flies only", () => {
    expect(rows(creditSplit(flies, DEFAULT_EDGES.usd))).toEqual([
      ["< $250", 1, 100],
      ["$250–500", 2, -100],
      ["$500–1,000", 3, 250],
      ["$1,000+", 1, 50],
    ]);
    expect(rows(wingsSplit(flies))).toEqual([
      ["balanced", 4, 750],
      ["broken", 2, -450],
      ["1-wing", 1, 0],
    ]);
    expect(rows(wingWidthSplit(flies))).toEqual([
      ["≤ 2.5", 3, 700],
      ["2.5–5", 2, -450],
      ["5–10", 1, 50],
      ["1-wing", 1, 0],
    ]);
  });

  it("gives each row its win rate and profit factor", () => {
    const [mon, , wed, thu] = weekdaySplit(closed);
    expect(wed).toMatchObject({ winRate: 1, profitFactor: Number.POSITIVE_INFINITY });
    expect(thu).toMatchObject({ winRate: 0, profitFactor: 0 });
    expect(mon).toMatchObject({ winRate: 0, profitFactor: 0 });
  });
});

describe("ticker split past ten tickers", () => {
  it("keeps the best 5 and worst 5, with one row for the rest", () => {
    const trades = closedTrades(
      Array.from({ length: 12 }, (_, index) =>
        makeTrade({
          id: `t${index}`,
          underlying: `T${String(index + 1).padStart(2, "0")}`,
          netPnl: 1200 - index * 100,
        }),
      ),
    );
    expect(rows(tickerSplit(trades))).toEqual([
      ["T01", 1, 1200],
      ["T02", 1, 1100],
      ["T03", 1, 1000],
      ["T04", 1, 900],
      ["T05", 1, 800],
      ["2 others", 2, 1300],
      ["T08", 1, 500],
      ["T09", 1, 400],
      ["T10", 1, 300],
      ["T11", 1, 200],
      ["T12", 1, 100],
    ]);
  });
});

describe("trades a split can't place", () => {
  it("go under unknown, last", () => {
    const noExpiry = makeTrade({ id: "n", legs: [], closedAt: ny("2026-09-02 09:50") });
    const backwards = makeTrade({
      id: "b",
      openedAt: ny("2026-09-03 10:00"),
      closedAt: ny("2026-09-02 09:50"),
    });
    expect(dteSplit(closedTrades([noExpiry])).map((row) => row.label)).toEqual(["unknown"]);
    expect(holdSplit(closedTrades([backwards])).map((row) => row.label)).toEqual(["unknown"]);
  });
});

describe("parseEdges", () => {
  it.each<[string, EdgeKind, number[]]>([
    ["250, 500, 1000", "usd", [250, 500, 1000]],
    ["$250 $500", "usd", [250, 500]],
    ["0.5, 1.5", "usd", [0.5, 1.5]],
    ["2,4,6", "contracts", [2, 4, 6]],
    ["3", "contracts", [3]],
  ])("reads %s", (text, kind, edges) => {
    expect(parseEdges(text, kind)).toEqual(edges);
  });

  it.each<[string, EdgeKind]>([
    ["", "usd"],
    ["abc", "usd"],
    ["500, 250", "usd"],
    ["250, 250", "usd"],
    ["1,000", "usd"],
    ["0, 5", "usd"],
    ["1, 3", "contracts"],
    ["2.5, 4", "contracts"],
  ])("refuses %s", (text, kind) => {
    expect(parseEdges(text, kind)).toBeNull();
  });
});

describe("edgeLabels", () => {
  it("names dollar and contract buckets", () => {
    expect(edgeLabels([250, 500, 1000], "usd")).toEqual(["< $250", "$250–500", "$500–1,000", "$1,000+"]);
    expect(edgeLabels([2, 4, 6], "contracts")).toEqual(["1", "2–3", "4–5", "6+"]);
    expect(edgeLabels([3], "contracts")).toEqual(["1–2", "3+"]);
  });
});

describe("split properties", () => {
  it("adds each split's rows up to the total net", () => {
    const sum = (split: SplitRow[]) => round2(split.reduce((total, row) => total + row.net, 0));
    fc.assert(
      fc.property(tradesArbitrary, (trades) => {
        const all = closedTrades(trades);
        const onlyFlies = all.filter((trade) => trade.strategy === "iron_fly");
        const net = summarize(all).net;
        const flyNet = summarize(onlyFlies).net;
        for (const split of [
          weekdaySplit(all),
          dteSplit(all),
          contractsSplit(all, DEFAULT_EDGES.contracts),
          holdSplit(all),
          monthSplit(all),
          tickerSplit(all),
        ]) {
          expect(sum(split)).toBeCloseTo(net, 6);
        }
        for (const split of [
          creditSplit(onlyFlies, DEFAULT_EDGES.usd),
          wingsSplit(onlyFlies),
          wingWidthSplit(onlyFlies),
        ]) {
          expect(sum(split)).toBeCloseTo(flyNet, 6);
        }
      }),
    );
  });
});
