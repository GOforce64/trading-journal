import { render } from "@testing-library/react";
import type { GroupStats } from "@tj/core";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { MetricBars, type MetricRow } from "./ScalpCharts.js";

// jsdom has no layout, so the responsive wrapper would measure 0 × 0; a fixed size lets Recharts draw for real.
vi.mock("recharts", async (importOriginal) => {
  const real = await importOriginal<typeof import("recharts")>();
  return {
    ...real,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
      height: number;
    }) => cloneElement(children, { width: 400, height }),
  };
});

const STATS: GroupStats = {
  trades: 4,
  winRate: 0.5,
  net: 0,
  profitFactor: 1,
  avgR: null,
  rCount: 4,
  avgReturn: null,
  returnCount: 0,
};
const rows = (values: { net?: number; avgR?: number }[]): MetricRow[] =>
  values.map((value, index) => ({ ...STATS, label: `B${index}`, net: 0, ...value }));

const bars = (container: HTMLElement) => container.querySelectorAll(".recharts-bar-rectangle path").length;
const zeroLine = (container: HTMLElement) => container.querySelector(".recharts-reference-line");

describe("MetricBars", () => {
  it("draws every bar from zero when all of them are above it", () => {
    const { container } = render(
      <MetricBars rows={rows([{ avgR: 0.4 }, { avgR: 0.5 }, { avgR: 0.6 }])} metric="r" />,
    );
    expect(bars(container)).toBe(3);
    expect(zeroLine(container)).not.toBeNull();
  });

  it("draws every bar from zero when all of them are below it, and for a single row", () => {
    const below = render(
      <MetricBars rows={rows([{ net: -700 }, { net: -820 }, { net: -760 }])} metric="net" />,
    );
    expect(bars(below.container)).toBe(3);
    expect(zeroLine(below.container)).not.toBeNull();
    const single = render(<MetricBars rows={rows([{ net: 250 }])} metric="net" />);
    expect(bars(single.container)).toBe(1);
  });

  it("gives each breakdown row its own band, so eleven labels never overlap", () => {
    const tickers = [
      "NVDA",
      "SPY",
      "QQQ",
      "AMD",
      "TSLA",
      "META",
      "AAPL",
      "MSFT",
      "AMZN",
      "GOOG",
      "Earnings IV crush",
    ];
    const { container } = render(
      <MetricBars
        rows={tickers.map((label, index) => ({ ...STATS, label, net: 95 - index * 20 }))}
        metric="net"
        layout="rows"
      />,
    );
    expect(bars(container)).toBe(11);
    const labels = [
      ...container.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"),
    ];
    expect(labels.map((label) => label.textContent)).toEqual([...tickers.slice(0, 10), "Earnings IV…"]);
    const ys = labels.map((label) => Number(label.getAttribute("y")));
    for (let index = 1; index < ys.length; index++) {
      expect((ys[index] ?? 0) - (ys[index - 1] ?? 0)).toBeGreaterThanOrEqual(18);
    }
  });
});
