import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IntradayModel, LevelLine, Marker, Point } from "./model.js";
import type { Toggle } from "./prefs.js";
import { COLORS, chartOptions, EMA_COLORS, nyTimeText, seconds } from "./style.js";

/** An extra horizontal line, such as the scalp review's stop or target. */
export interface PriceLine {
  price: number;
  color: string;
  dashed: boolean;
  label: string;
}

const LEVELS: LevelLine["label"][] = ["PM H", "PM L", "PD H", "PD L"];
const NO_LINES: readonly PriceLine[] = [];

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  emas: ISeriesApi<"Line">[];
  vwap: ISeriesApi<"Line">;
  levels: Map<LevelLine["label"], ISeriesApi<"Line">>;
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
}

const line = (point: Point) => ({ time: seconds(point.t), value: point.value });

/** How a fill's arrow looks: buys below the candle pointing up, sells above pointing down (spec §8). */
export function markerLook(marker: Marker) {
  if (marker.side === "buy")
    return { position: "belowBar" as const, shape: "arrowUp" as const, color: COLORS.up };
  if (marker.side === "sell")
    return { position: "aboveBar" as const, shape: "arrowDown" as const, color: COLORS.down };
  if (marker.side === "held")
    return { position: "aboveBar" as const, shape: "circle" as const, color: COLORS.held };
  return { position: "aboveBar" as const, shape: "square" as const, color: "#6b7385" };
}

/** The 3-minute (or chosen) chart of the trade's day (spec §8). Built once; data and options update in place. */
export function IntradayChart({
  model,
  show,
  fitKey,
  lines = NO_LINES,
  height = 420,
}: {
  model: IntradayModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  lines?: readonly PriceLine[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const times = useRef<number[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, chartOptions(true));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
      priceLineVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const quiet = {
      lineWidth: 1 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    const emas = EMA_COLORS.map((color) => chart.addSeries(LineSeries, { color, ...quiet }));
    const vwap = chart.addSeries(LineSeries, { color: COLORS.vwap, ...quiet });
    const levels = new Map(
      LEVELS.map((label) => [
        label,
        chart.addSeries(LineSeries, {
          color: label.startsWith("PM") ? COLORS.pm : COLORS.pd,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: label,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        }),
      ]),
    );
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((param) => {
      if (typeof param.time !== "number") {
        setHovered(null);
        return;
      }
      setHovered(times.current.indexOf(param.time * 1000));
    });
    parts.current = { chart, candles, volume, emas, vwap, levels, markers, priceLines: [] };
    return () => {
      chart.remove();
      parts.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    times.current = model.candles.map((candle) => candle.t);
    chart.candles.setData(
      model.candles.map((candle) => {
        const bar = {
          time: seconds(candle.t),
          open: candle.o,
          high: candle.h,
          low: candle.l,
          close: candle.c,
        };
        if (!candle.extended) return bar;
        const color = candle.c >= candle.o ? COLORS.upExtended : COLORS.downExtended;
        return { ...bar, color, wickColor: color, borderColor: color };
      }),
    );
    chart.volume.setData(
      model.candles.map((candle) => ({
        time: seconds(candle.t),
        value: candle.v,
        color: candle.c >= candle.o ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );
    chart.emas.forEach((series, index) => {
      series.setData((model.emas[index]?.points ?? []).map(line));
    });
    chart.vwap.setData(model.vwap.map(line));
    for (const [label, series] of chart.levels) {
      const level = model.levels.find((each) => each.label === label);
      series.setData(level ? model.levelTimes.map((t) => ({ time: seconds(t), value: level.price })) : []);
    }
    chart.markers.setMarkers(
      model.markers.map((marker) => ({ time: seconds(marker.t), text: marker.text, ...markerLook(marker) })),
    );
  }, [model]);

  // The opening view: on first data, on a new timeframe, and on Fit trade.
  const from = model.window?.from;
  const to = model.window?.to;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the Fit trade button's request to re-apply
  useEffect(() => {
    if (from === undefined || to === undefined) return;
    parts.current?.chart.timeScale().setVisibleLogicalRange({ from, to });
  }, [from, to, fitKey]);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    chart.emas.forEach((series, index) => {
      series.applyOptions({ visible: show[`ema${index}` as Toggle] });
    });
    chart.vwap.applyOptions({ visible: show.vwap });
    for (const [label, series] of chart.levels) {
      series.applyOptions({ visible: label.startsWith("PM") ? show.pm : show.pd });
    }
    chart.volume.applyOptions({ visible: show.volume });
  }, [show]);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    for (const priceLine of chart.priceLines) chart.candles.removePriceLine(priceLine);
    chart.priceLines = lines.map((each) =>
      chart.candles.createPriceLine({
        price: each.price,
        color: each.color,
        lineWidth: 1,
        lineStyle: each.dashed ? LineStyle.Dashed : LineStyle.Solid,
        title: each.label,
        axisLabelVisible: true,
      }),
    );
  }, [lines]);

  const values = useMemo(
    () => ({
      emas: model.emas.map((each) => new Map(each.points.map((point) => [point.t, point.value]))),
      vwap: new Map(model.vwap.map((point) => [point.t, point.value])),
    }),
    [model],
  );
  const candle = model.candles[hovered ?? model.candles.length - 1];

  return (
    <div className="relative" style={{ height }}>
      <div ref={container} className="absolute inset-0" data-testid="intraday-chart" />
      {candle && (
        <div
          data-testid="chart-legend"
          className="num pointer-events-none absolute top-1 left-2 z-10 flex flex-wrap gap-x-2 text-[10px] text-muted"
        >
          <span className="text-fg">{nyTimeText(candle.t)}</span>
          <span>
            O {candle.o.toFixed(2)} H {candle.h.toFixed(2)} L {candle.l.toFixed(2)} C {candle.c.toFixed(2)}
          </span>
          <span>V {candle.v.toLocaleString("en-US")}</span>
          {model.emas.map((each, index) => {
            const value = values.emas[index]?.get(candle.t);
            return show[`ema${index}` as Toggle] && value !== undefined ? (
              <span key={each.length} style={{ color: EMA_COLORS[index] }}>
                EMA {each.length} {value.toFixed(2)}
              </span>
            ) : null;
          })}
          {show.vwap && values.vwap.has(candle.t) && (
            <span style={{ color: COLORS.vwap }}>VWAP {values.vwap.get(candle.t)?.toFixed(2)}</span>
          )}
        </div>
      )}
    </div>
  );
}
