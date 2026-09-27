import type { EquityPoint } from "@tj/core";
import { TickMarkType } from "lightweight-charts";

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

const ny = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...options });

const TICK_FORMATS: Record<TickMarkType, Intl.DateTimeFormat> = {
  [TickMarkType.Year]: ny({ year: "numeric" }),
  [TickMarkType.Month]: ny({ month: "short" }),
  [TickMarkType.DayOfMonth]: ny({ month: "short", day: "numeric" }),
  [TickMarkType.Time]: ny({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  [TickMarkType.TimeWithSeconds]: ny({
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }),
};

/**
 * A time-axis label in New York time, at the detail Lightweight Charts asks for: a year, a month, a day or a
 * time of day. One day label for every tick repeated "Sep 1" for two closes on the same day.
 */
export function nyTickLabel(seconds: number, type: TickMarkType): string {
  return TICK_FORMATS[type].format(new Date(seconds * 1000));
}
