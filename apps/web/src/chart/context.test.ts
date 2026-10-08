import { nyWallClock } from "@tj/core";
import { describe, expect, it } from "vitest";
import { type ContextTrade, contextMarks, nearestMark } from "./context.js";

const DAY = "2026-09-30";
const taken: ContextTrade = {
  id: "s1",
  strategy: "scalp",
  book: "live",
  underlying: "NVDA",
  openedAt: nyWallClock(DAY, 10 * 60 + 4),
  closedAt: nyWallClock(DAY, 10 * 60 + 16),
  netPnl: 186.4,
  legs: [{ right: "C", strike: 180, quantity: 3 }],
  risk: { r: 1.62 },
  missed: null,
  missedRisk: null,
};
const missedShort: ContextTrade = {
  id: "m1",
  strategy: "scalp",
  book: "missed",
  underlying: "NVDA",
  openedAt: nyWallClock(DAY, 10 * 60 + 52),
  closedAt: nyWallClock(DAY, 11 * 60 + 6),
  netPnl: null,
  legs: [],
  risk: null,
  missed: { direction: "short", entryPrice: 179.6, exitPrice: 179.9 },
  missedRisk: { r: -0.62 },
};

describe("contextMarks", () => {
  it("draws a taken scalp as a buy at its entry and a sell at its exit, with what it was", () => {
    const tip = ["Taken · NVDA 180C · Live", "10:04 → 10:16 · 3 contracts", "+$186.40 · +1.62R"];
    expect(contextMarks([taken])).toEqual([
      { tradeId: "s1", t: taken.openedAt, price: null, kind: "buy", label: "", tip },
      { tradeId: "s1", t: taken.closedAt, price: null, kind: "sell", label: "", tip },
    ]);
  });

  it("draws a missed trade at its entry and exit prices, labelled at the entry", () => {
    const marks = contextMarks([missedShort]);
    expect(marks.map((mark) => [mark.kind, mark.price, mark.label])).toEqual([
      ["missed", 179.6, "Missed short −0.62R"],
      ["missed", 179.9, ""],
    ]);
    expect(marks[0]?.tip).toEqual(["Missed · Short", "10:52 → 11:06", "−0.62R"]);
  });

  it("draws a missed trade without an exit at its entry alone", () => {
    const open = { ...missedShort, closedAt: null, missedRisk: { r: null } };
    const marks = contextMarks([open]);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.label).toBe("Missed short");
    expect(marks[0]?.tip).toEqual(["Missed · Short", "10:52 · no exit yet", "no R yet"]);
  });

  it("leaves out iron flies, and an open taken scalp's missing exit", () => {
    const fly = { ...taken, id: "f1", strategy: "iron_fly", legs: [] };
    const open = { ...taken, closedAt: null, netPnl: null };
    expect(contextMarks([fly])).toEqual([]);
    expect(contextMarks([open]).map((mark) => mark.kind)).toEqual(["buy"]);
    expect(contextMarks([open])[0]?.tip[1]).toBe("10:04 · open · 3 contracts");
  });
});

describe("nearestMark", () => {
  it("finds the mark under the pointer, the closer of two, within reach", () => {
    const [a, b] = contextMarks([taken]);
    if (!a || !b) throw new Error("no marks");
    const placed = [
      { mark: a, x: 100, y: 200 },
      { mark: b, x: 160, y: 120 },
    ];
    expect(nearestMark({ x: 104, y: 203 }, placed)).toBe(a);
    expect(nearestMark({ x: 158, y: 118 }, placed)).toBe(b);
    expect(nearestMark({ x: 130, y: 160 }, placed)).toBeNull();
  });
});
