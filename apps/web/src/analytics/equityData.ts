import type { EquityPoint } from "@tj/core";

export interface ChartPoint {
  /** UTC seconds. */
  time: number;
  value: number;
}

/**
 * Lightweight Charts needs strictly increasing times. Closes in the same second become one point (the last),
 * and a $0 point one second before the first close starts the line.
 */
export function equityChartData(points: readonly EquityPoint[]): {
  equity: ChartPoint[];
  drawdown: ChartPoint[];
} {
  const equity: ChartPoint[] = [];
  const drawdown: ChartPoint[] = [];
  const first = points[0];
  if (first) {
    const start = Math.floor(first.closedAt / 1000) - 1;
    equity.push({ time: start, value: 0 });
    drawdown.push({ time: start, value: 0 });
  }
  for (const point of points) {
    const time = Math.floor(point.closedAt / 1000);
    if (equity.at(-1)?.time === time) {
      equity.pop();
      drawdown.pop();
    }
    equity.push({ time, value: point.equity });
    drawdown.push({ time, value: point.drawdown });
  }
  return { equity, drawdown };
}
