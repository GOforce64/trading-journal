import type { EquityPoint } from "@tj/core";
import {
  BaselineSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";
import { type ChartPoint, equityChartData, nyTickLabel } from "./equityData.js";

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
  const chartRef = useRef<{
    chart: IChartApi;
    equity: ISeriesApi<"Line">;
    drawdown: ISeriesApi<"Baseline">;
  } | null>(null);
  /** The data the chart shows, so a parent's fresh array with the same points changes nothing. */
  const shown = useRef<string | null>(null);
  const data = useMemo(() => equityChartData(points), [points]);
  const drawable = data.equity.length >= 2;

  // Built once while there is something to draw: rebuilding on every re-render (a calendar click, the
  // minute's quote refresh) would throw away the user's zoom and pan.
  useEffect(() => {
    const element = container.current;
    if (!element || !drawable) return;
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
      timeScale: {
        borderColor: "#1f2430",
        // Several trades can close on one day; their ticks show the time rather than repeating the date.
        timeVisible: true,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          typeof time === "number" ? nyTickLabel(time, type) : String(time),
      },
      localization: { timeFormatter: nyText(NY_TIME), priceFormatter: usd },
    });
    const equity = chart.addSeries(LineSeries, { color: "#2962ff", lineWidth: 2, priceLineVisible: false });
    const drawdown = chart.addSeries(
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
    );
    chartRef.current = { chart, equity, drawdown };
    return () => {
      chart.remove();
      chartRef.current = null;
      shown.current = null;
    };
  }, [drawable]);

  useEffect(() => {
    if (!drawable) return;
    chartRef.current?.chart.panes()[1]?.setHeight(Math.round(height * 0.28));
  }, [drawable, height]);

  // Hands the chart new data only when the numbers change, and only then fits it to the new range.
  useEffect(() => {
    const parts = chartRef.current;
    if (!parts || !drawable) return;
    const signature = JSON.stringify(data);
    if (signature === shown.current) return;
    shown.current = signature;
    parts.equity.setData(series(data.equity));
    parts.drawdown.setData(series(data.drawdown));
    parts.chart.timeScale().fitContent();
  }, [data, drawable]);

  if (!drawable) return <p className="text-muted">No closed trades in this range.</p>;
  return <div ref={container} style={{ height }} data-testid="equity-curve" />;
}
