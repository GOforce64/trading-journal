import { describe, expect, it } from "vitest";
import { equityChartData } from "./equityData.js";

describe("equityChartData", () => {
  it("starts at $0 one second before the first close", () => {
    const data = equityChartData([{ id: "a", closedAt: 1_000_000, equity: 100, drawdown: 0 }]);
    expect(data.equity).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 100 },
    ]);
    expect(data.drawdown).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 0 },
    ]);
  });

  it("merges closes in the same second into the last one, so times only increase", () => {
    const data = equityChartData([
      { id: "a", closedAt: 1_000_000, equity: 100, drawdown: 0 },
      { id: "b", closedAt: 1_000_400, equity: 60, drawdown: -40 },
      { id: "c", closedAt: 1_002_000, equity: 90, drawdown: -10 },
    ]);
    expect(data.equity).toEqual([
      { time: 999, value: 0 },
      { time: 1000, value: 60 },
      { time: 1002, value: 90 },
    ]);
    expect(data.drawdown.map((point) => point.value)).toEqual([0, -40, -10]);
  });

  it("is empty without points", () => {
    expect(equityChartData([])).toEqual({ equity: [], drawdown: [] });
  });
});
