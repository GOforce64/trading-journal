import type { EquityPoint } from "@tj/core";
import {
  BaselineSeries,
  ColorType,
  createChart,
  LineSeries,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { type ChartPoint, equityChartData } from "./equityData.js";

const NY_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});
const NY_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Lightweight Charts has no timezone option; formatting each time in New York is the documented way. */
const nyText = (format: Intl.DateTimeFormat) => (time: Time) =>
  typeof time === "number" ? format.format(new Date(time * 1000)) : String(time);
const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const series = (points: ChartPoint[]) =>
  points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));
const CLEAR = "rgba(0, 0, 0, 0)";

/** Cumulative net P&L with its drawdown in a pane below (spec §9). The canvas can't draw in tests; `equityChartData` is tested instead. */
export function EquityCurve({ points, height = 220 }: { points: readonly EquityPoint[]; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const data = useMemo(() => equityChartData(points), [points]);

  useEffect(() => {
    const element = container.current;
    if (!element || data.equity.length < 2) return;
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#6b7385",
        fontSize: 10,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        panes: { separatorColor: "#1f2430" },
      },
      grid: { vertLines: { color: "#1a1e29" }, horzLines: { color: "#1a1e29" } },
      rightPriceScale: { borderColor: "#1f2430" },
      timeScale: { borderColor: "#1f2430", tickMarkFormatter: nyText(NY_DAY) },
      localization: { timeFormatter: nyText(NY_TIME), priceFormatter: usd },
    });
    chart
      .addSeries(LineSeries, { color: "#2962ff", lineWidth: 2, priceLineVisible: false })
      .setData(series(data.equity));
    chart
      .addSeries(
        BaselineSeries,
        {
          baseValue: { type: "price", price: 0 },
          topLineColor: CLEAR,
          topFillColor1: CLEAR,
          topFillColor2: CLEAR,
          bottomLineColor: "#ef5350",
          bottomFillColor1: "rgba(239, 83, 80, 0.05)",
          bottomFillColor2: "rgba(239, 83, 80, 0.4)",
          lineWidth: 1,
          priceLineVisible: false,
        },
        1,
      )
      .setData(series(data.drawdown));
    chart.panes()[1]?.setHeight(Math.round(height * 0.28));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height]);

  if (data.equity.length < 2) return <p className="text-muted">No closed trades in this range.</p>;
  return <div ref={container} style={{ height }} data-testid="equity-curve" />;
}
