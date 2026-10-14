import { nyClock } from "@tj/core";
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
import { useEffect, useRef } from "react";
import { markerLook, type PriceLine } from "./IntradayChart.js";
import type { DailyModel } from "./model.js";
import type { Toggle } from "./prefs.js";
import { COLORS, chartOptions, EMA_COLORS } from "./style.js";

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  emas: ISeriesApi<"Line">[];
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
}

const NO_LINES: readonly PriceLine[] = [];

/** A daily bar's date, which the chart takes as a business day. */
const day = (t: number) => nyClock(t).date;

/** The daily chart beside the intraday one (spec §8): about six months up to the trade, with its days marked. */
export function DailyChart({
  model,
  show,
  fitKey,
  height = 420,
  lines = NO_LINES,
}: {
  model: DailyModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  height?: number;
  /** A swing's strikes and break-even (swing spec §4.4). */
  lines?: readonly PriceLine[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, chartOptions(false));
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
    const emas = EMA_COLORS.map((color) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );
    parts.current = {
      chart,
      candles,
      volume,
      emas,
      markers: createSeriesMarkers(candles, []),
      priceLines: [],
    };
    return () => {
      chart.remove();
      parts.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    chart.candles.setData(
      model.candles.map((candle) => ({
        time: day(candle.t),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
      })),
    );
    chart.volume.setData(
      model.candles.map((candle) => ({
        time: day(candle.t),
        value: candle.v,
        color: candle.c >= candle.o ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );
    chart.emas.forEach((series, index) => {
      series.setData(
        (model.emas[index]?.points ?? []).map((point) => ({ time: day(point.t), value: point.value })),
      );
    });
    chart.markers.setMarkers(
      model.markers.map((marker) => ({ time: day(marker.t), text: marker.text, ...markerLook(marker) })),
    );
  }, [model]);

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
    chart.volume.applyOptions({ visible: show.volume });
  }, [show]);

  // A swing's strikes and break-even (swing spec §4.4): the library titles each on the price axis at its own price.
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

  return <div ref={container} style={{ height }} data-testid="daily-chart" />;
}
