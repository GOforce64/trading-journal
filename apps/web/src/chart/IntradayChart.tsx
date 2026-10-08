import { nyClock, round2, snapToBar } from "@tj/core";
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
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ContextMark, nearestMark } from "./context.js";
import {
  type ChartEditing,
  inPane,
  isPointId,
  type LineId,
  lineName,
  nearestLine,
  nearestPoint,
  type PointId,
  type PointMark,
  priceAt,
} from "./drag.js";
import type { IntradayModel, LevelLine, Marker, Point } from "./model.js";
import type { Toggle } from "./prefs.js";
import { COLORS, chartOptions, EMA_COLORS, nyTimeText, seconds } from "./style.js";

/** An extra horizontal line, such as the scalp review's stop or a target. A line with an `id` can be dragged. */
export interface PriceLine {
  id?: LineId;
  price: number;
  color: string;
  dashed: boolean;
  label: string;
}

const LEVELS: LevelLine["label"][] = ["PM H", "PM L", "PD H", "PD L"];
const NO_LINES: readonly PriceLine[] = [];
const NO_POINTS: readonly PointMark[] = [];
const NO_CONTEXT: readonly ContextMark[] = [];

/** A missed trade's own points, bright (missed-trades spec §6.4). */
const POINT_COLOR = "#8fb3ff";
/** The day's other trades, faint: the fill arrows' colours and a grey, at about 45% (spec §6.4). */
const FAINT = { buy: "#26a69a73", sell: "#ef535073", missed: "#9aa3b599" } as const;
/** How far a taken scalp's faint arrow sits from its candle, for hovering it. */
const ARROW_PX = 12;

/** The index of the last candle at or before `t`, or the first. */
function candleIndex(times: readonly number[], t: number): number {
  let low = 0;
  let high = times.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((times[middle] ?? 0) <= t) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** A point moved by a drag that hasn't been saved yet. */
interface PointAt {
  id: PointId;
  t: number;
  price: number;
}

/** The fills' arrows, the day's other trades and the missed trade's own points, in time order. */
function allMarkers(
  model: IntradayModel,
  markersAtPrice: boolean,
  points: readonly PointMark[],
  context: readonly ContextMark[],
): SeriesMarker<Time>[] {
  const times = model.candles.map((candle) => candle.t);
  // Points and context markers sit on their candle, so a typed 09:41 shows on the 3-minute chart's 09:39 bar.
  const at = (t: number) => seconds(model.candles[candleIndex(times, t)]?.t ?? t) as Time;
  const marks: SeriesMarker<Time>[] = [
    ...model.markers.map(
      (marker) =>
        ({
          time: seconds(marker.t),
          text: marker.text,
          ...markerLook(marker, markersAtPrice),
        }) as SeriesMarker<Time>,
    ),
    ...context.map((mark): SeriesMarker<Time> => {
      if (mark.kind === "missed" && mark.price != null) {
        return {
          time: at(mark.t),
          text: mark.label,
          position: "atPriceMiddle",
          shape: "circle",
          color: FAINT.missed,
          price: mark.price,
        };
      }
      return mark.kind === "sell"
        ? { time: at(mark.t), text: mark.label, position: "aboveBar", shape: "arrowDown", color: FAINT.sell }
        : { time: at(mark.t), text: mark.label, position: "belowBar", shape: "arrowUp", color: FAINT.buy };
    }),
    ...points.map(
      (point): SeriesMarker<Time> => ({
        time: at(point.t),
        text: point.label,
        position: "atPriceMiddle",
        shape: "circle",
        color: POINT_COLOR,
        price: point.price,
      }),
    ),
  ];
  return marks.sort((a, b) => Number(a.time) - Number(b.time));
}

/** The dotted line from the entry to the exit, on their candles; nothing without both. */
function holdLine(model: IntradayModel, points: readonly PointMark[]) {
  const times = model.candles.map((candle) => candle.t);
  const entry = points.find((point) => point.id === "entry");
  const exit = points.find((point) => point.id === "exit");
  if (!entry || !exit) return [];
  const from = model.candles[candleIndex(times, entry.t)]?.t;
  const to = model.candles[candleIndex(times, exit.t)]?.t;
  if (from === undefined || to === undefined || to <= from) return [];
  return [
    { time: seconds(from) as Time, value: entry.price },
    { time: seconds(to) as Time, value: exit.price },
  ];
}

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  emas: ISeriesApi<"Line">[];
  vwap: ISeriesApi<"Line">;
  levels: Map<LevelLine["label"], ISeriesApi<"Line">>;
  markers: ISeriesMarkersPluginApi<Time>;
  priceLines: IPriceLine[];
  /** The dotted line from a missed trade's entry to its exit. */
  hold: ISeriesApi<"Line">;
}

/** A line being dragged: where it started, and where it is now (scalp-review spec §8.3). */
interface Drag {
  id: LineId;
  line: IPriceLine;
  from: number;
  price: number;
}

const line = (point: Point) => ({ time: seconds(point.t), value: point.value });

/**
 * How a fill's arrow looks: buys below the candle pointing up, sells above pointing down (spec §8). On the option view
 * the arrow's tip is at the fill's own price (premium-chart spec §6.2).
 */
export function markerLook(marker: Marker, atPrice = false) {
  if (atPrice && marker.price != null && marker.side === "buy")
    return {
      position: "atPriceTop" as const,
      shape: "arrowUp" as const,
      color: COLORS.up,
      price: marker.price,
    };
  if (atPrice && marker.price != null && marker.side === "sell")
    return {
      position: "atPriceBottom" as const,
      shape: "arrowDown" as const,
      color: COLORS.down,
      price: marker.price,
    };
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
  editing,
  height = 420,
  markersAtPrice = false,
  viewKey = "stock",
  points = NO_POINTS,
  context = NO_CONTEXT,
  onOpenTrade,
}: {
  model: IntradayModel;
  show: Record<Toggle, boolean>;
  fitKey: number;
  lines?: readonly PriceLine[];
  /** The scalp review's placing and dragging; without it the mouse only pans and zooms. */
  editing?: ChartEditing;
  height?: number;
  /** The option view: fills sit at their prices (premium-chart spec §6.2). */
  markersAtPrice?: boolean;
  /** Which view the model is, so a switch keeps the time range in view (premium-chart spec §6.1). */
  viewKey?: string;
  /** A missed trade's entry and exit (missed-trades spec §6.4), placed and dragged through `editing`. */
  points?: readonly PointMark[];
  /** The day's other trades, faint, with a tooltip; a click opens one through `onOpenTrade`. */
  context?: readonly ContextMark[];
  onOpenTrade?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);
  const times = useRef<number[]>([]);
  // The mouse handlers are attached once, so they read the latest lines and editing from here.
  const current = useRef({ lines, editing, points, context, onOpenTrade, model, markersAtPrice });
  const [hovered, setHovered] = useState<number | null>(null);
  const [grab, setGrab] = useState<"line" | "point" | null>(null);
  const [tip, setTip] = useState<{ mark: ContextMark; x: number; y: number } | null>(null);
  // The view the chart last drew, and the view whose time range was kept on a switch (premium-chart spec §6.1).
  const drawnView = useRef<string | null>(null);
  const keptFor = useRef<string | null>(null);

  useEffect(() => {
    current.current = { lines, editing, points, context, onOpenTrade, model, markersAtPrice };
  });

  /** Draws the markers and the hold line from the latest props, with a dragged point where the drag has it. */
  const paint = useCallback((moved?: PointAt) => {
    const chart = parts.current;
    if (!chart) return;
    const latest = current.current;
    const shown = moved
      ? latest.points.map((point) =>
          point.id === moved.id ? { ...point, t: moved.t, price: moved.price } : point,
        )
      : latest.points;
    chart.markers.setMarkers(allMarkers(latest.model, latest.markersAtPrice, shown, latest.context));
    chart.hold.setData(holdLine(latest.model, shown));
  }, []);

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
    const hold = chart.addSeries(LineSeries, {
      color: "#9aa3b5",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((param) => {
      if (typeof param.time !== "number") {
        setHovered(null);
        return;
      }
      setHovered(times.current.indexOf(param.time * 1000));
    });
    parts.current = { chart, candles, volume, emas, vwap, levels, markers, priceLines: [], hold };

    // Placing and dragging the review's lines (scalp-review spec §8.2–8.3). Lightweight Charts listens to mouse
    // events, so a press on a line is caught on its way down (capture) and kept from the chart, and the drag
    // follows the window, so it goes on outside the chart.
    let drag: Drag | null = null;
    // A missed trade's point being dragged, in time and price (missed-trades spec §6.4).
    let pointDrag: { id: PointId; from: { t: number; price: number }; at: PointAt } | null = null;
    const toY = (price: number) => candles.priceToCoordinate(price);
    const toPrice = (y: number) => candles.coordinateToPrice(y);
    const candleTimes = () => current.current.model.candles.map((candle) => candle.t);
    const xOf = (t: number) => chart.timeScale().logicalToCoordinate(candleIndex(candleTimes(), t) as never);
    /** The candle under x, the nearest one past either end, and a price kept inside it. */
    function pointAt(id: PointId, x: number, y: number): PointAt | null {
      const all = current.current.model.candles;
      const logical = chart.timeScale().coordinateToLogical(x);
      const price = priceAt(y, toPrice);
      if (all.length === 0 || logical == null || price == null) return null;
      const candle = all[Math.min(all.length - 1, Math.max(0, Math.round(Number(logical))))];
      if (!candle) return null;
      return { id, t: candle.t, price: round2(snapToBar(price, { high: candle.h, low: candle.l })) };
    }
    function placedPoints() {
      return current.current.points.flatMap((point) => {
        const x = xOf(point.t);
        const y = toY(point.price);
        return x == null || y == null ? [] : [{ id: point.id, x, y }];
      });
    }
    function placedContext() {
      const all = current.current.model.candles;
      const known = candleTimes();
      return current.current.context.flatMap((mark) => {
        const x = xOf(mark.t);
        const candle = all[candleIndex(known, mark.t)];
        let y: number | null = null;
        if (mark.price != null) y = toY(mark.price);
        else if (candle && mark.kind === "sell") y = (toY(candle.h) ?? 0) - ARROW_PX;
        else if (candle) y = (toY(candle.l) ?? 0) + ARROW_PX;
        return x == null || y == null ? [] : [{ mark, x, y }];
      });
    }
    const pointOf = (event: MouseEvent) => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    function grabbable() {
      return current.current.lines.flatMap((each) => (each.id ? [{ id: each.id, price: each.price }] : []));
    }
    function follow(event: MouseEvent) {
      if (pointDrag) {
        if (event.buttons === 0) {
          finishPoint(true);
          return;
        }
        const { x, y } = pointOf(event);
        const at = pointAt(pointDrag.id, x, y);
        if (!at) return;
        pointDrag.at = at;
        paint(at);
        return;
      }
      if (!drag) return;
      // No button held: the release happened where the window couldn't hear it (over another window), so the
      // drag ends where the line last was.
      if (event.buttons === 0) {
        finish(true);
        return;
      }
      const price = priceAt(pointOf(event).y, toPrice);
      if (price == null) return;
      drag.price = price;
      drag.line.applyOptions({ price });
      current.current.editing?.onDrag(drag.id, price);
    }
    function release() {
      finish(true);
      finishPoint(true);
    }
    function finishPoint(save: boolean) {
      const done = pointDrag;
      if (!done) return;
      pointDrag = null;
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", release);
      chart.applyOptions({ handleScroll: true, handleScale: true });
      const moved = done.at.t !== done.from.t || done.at.price !== done.from.price;
      if (save && moved) {
        current.current.editing?.onDropPoint?.(done.id, done.at.t, done.at.price);
        return;
      }
      paint();
      if (!save) current.current.editing?.onCancel();
    }
    function finish(save: boolean) {
      const done = drag;
      if (!done) return;
      drag = null;
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", release);
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (save && done.price !== done.from) {
        current.current.editing?.onDrop(done.id, done.price);
        return;
      }
      done.line.applyOptions({ price: done.from });
      if (!save) current.current.editing?.onCancel();
    }
    function press(event: MouseEvent) {
      if (event.button !== 0) return;
      const edit = current.current.editing;
      const { x, y } = pointOf(event);
      const onPlot = inPane(x, y, chart.paneSize());
      if (edit?.placing) {
        // While placing, every press is the review's: the typed field keeps its focus, and a press on an axis is
        // ignored, with placing going on (spec §8.2).
        event.preventDefault();
        event.stopPropagation();
        if (!onPlot) return;
        if (isPointId(edit.placing)) {
          const at = pointAt(edit.placing, x, y);
          if (at) edit.onPlacePoint?.(at.id, at.t, at.price);
          return;
        }
        const price = priceAt(y, toPrice);
        if (price != null) edit.onPlace(edit.placing, price);
        return;
      }
      if (!onPlot) return;
      const grabbed = (start: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        chart.applyOptions({ handleScroll: false, handleScale: false });
        start();
        window.addEventListener("mousemove", follow);
        window.addEventListener("mouseup", release);
      };
      // A point first: it sits on a price, where a line may run through it too.
      const point = edit?.onDropPoint
        ? current.current.points.find((each) => each.id === nearestPoint(x, y, placedPoints()))
        : undefined;
      if (point) {
        const from = { t: point.t, price: point.price };
        grabbed(() => {
          pointDrag = { id: point.id, from, at: { id: point.id, ...from } };
        });
        return;
      }
      const id = edit ? nearestLine(grabbable(), y, toY) : null;
      const index = current.current.lines.findIndex((each) => each.id === id);
      const line = parts.current?.priceLines[index];
      const from = current.current.lines[index]?.price;
      if (id && line && from !== undefined) {
        grabbed(() => {
          drag = { id, line, from, price: from };
        });
        return;
      }
      const mark = current.current.onOpenTrade ? nearestMark({ x, y }, placedContext()) : null;
      if (mark) {
        event.preventDefault();
        event.stopPropagation();
        current.current.onOpenTrade?.(mark.tradeId);
      }
    }
    function hover(event: MouseEvent) {
      if (drag || pointDrag) return;
      const { x, y } = pointOf(event);
      const edit = current.current.editing;
      const inside = inPane(x, y, chart.paneSize());
      const overPoint = edit?.onDropPoint != null && inside && nearestPoint(x, y, placedPoints()) != null;
      const overLine = edit != null && inside && nearestLine(grabbable(), y, toY) != null;
      setGrab(overPoint ? "point" : overLine ? "line" : null);
      const mark = inside ? nearestMark({ x, y }, placedContext()) : null;
      setTip(mark ? { mark, x, y } : null);
    }
    function leave() {
      setTip(null);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (drag) finish(false);
      else if (pointDrag) finishPoint(false);
      else if (current.current.editing?.placing) current.current.editing.onCancel();
    }
    element.addEventListener("mousedown", press, true);
    element.addEventListener("mousemove", hover);
    element.addEventListener("mouseleave", leave);
    window.addEventListener("keydown", onEscape);

    return () => {
      element.removeEventListener("mousedown", press, true);
      element.removeEventListener("mousemove", hover);
      element.removeEventListener("mouseleave", leave);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", release);
      chart.remove();
      parts.current = null;
    };
  }, [paint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: markersAtPrice reaches paint through the ref; a change must repaint
  useEffect(() => {
    const chart = parts.current;
    if (!chart) return;
    const switched = drawnView.current != null && drawnView.current !== viewKey;
    const range = switched ? chart.chart.timeScale().getVisibleRange() : null;
    drawnView.current = viewKey;
    times.current = model.candles.map((candle) => candle.t);
    const bars = model.candles.map((candle) => {
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
    });
    if (model.slots) {
      // Empty minutes are whitespace, so a thin strike's candles keep their place in time.
      const byTime = new Map(bars.map((bar) => [bar.time as number, bar]));
      chart.candles.setData(model.slots.map((t) => byTime.get(seconds(t)) ?? { time: seconds(t) }));
    } else chart.candles.setData(bars);
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
    chart.vwap.setData(
      model.vwap.map((point, index) => {
        const next = model.vwap[index + 1];
        // Lightweight Charts joins consecutive points, drawing each segment in its first point's colour. The day's
        // last VWAP is transparent, so the line never bridges the night to the next session (spec §7).
        return next && nyClock(next.t).date !== nyClock(point.t).date
          ? { ...line(point), color: "transparent" }
          : line(point);
      }),
    );
    for (const [label, series] of chart.levels) {
      const level = model.levels.find((each) => each.label === label);
      series.setData(level ? model.levelTimes.map((t) => ({ time: seconds(t), value: level.price })) : []);
    }
    paint();
    // A switch keeps the time range the reader was looking at, when this view has candles there.
    if (
      range &&
      model.candles.some(
        (candle) => seconds(candle.t) >= Number(range.from) && seconds(candle.t) <= Number(range.to),
      )
    ) {
      chart.chart.timeScale().setVisibleRange(range);
      keptFor.current = viewKey;
    }
  }, [model, markersAtPrice, viewKey, paint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: paint reads the points and context from the ref; a change to either repaints
  useEffect(() => {
    paint();
  }, [points, context, paint]);

  // The opening view: on first data, on a new timeframe, and on Fit trade.
  const from = model.window?.from;
  const to = model.window?.to;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey is the Fit trade button's request to re-apply
  useEffect(() => {
    if (keptFor.current === viewKey) {
      keptFor.current = null;
      return;
    }
    if (from === undefined || to === undefined) return;
    parts.current?.chart.timeScale().setVisibleLogicalRange({ from, to });
  }, [from, to, fitKey, viewKey]);

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
      <div
        ref={container}
        className="absolute inset-0"
        data-testid="intraday-chart"
        data-cursor={
          editing?.placing
            ? "crosshair"
            : grab === "line"
              ? "ns-resize"
              : grab === "point"
                ? "move"
                : tip
                  ? "pointer"
                  : undefined
        }
      />
      {tip && (
        <div
          data-testid="context-tip"
          className="pointer-events-none absolute z-20 rounded-sm border border-[#2f3646] bg-[#1c2230] px-2 py-1 text-[10px] leading-snug shadow-lg"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          {tip.mark.tip.map((line, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a tooltip's lines are fixed in order
              key={index}
              className={
                index === 0
                  ? "font-semibold text-fg"
                  : index === tip.mark.tip.length - 1
                    ? "text-muted"
                    : "num text-fg"
              }
            >
              {line}
            </div>
          ))}
        </div>
      )}
      {editing?.placing && (
        <div
          data-testid="placing-hint"
          className="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2 rounded-sm border border-line bg-[#131722e6] px-2 py-0.5 text-[10px] text-fg"
        >
          Click the chart to place {lineName(editing.placing)} · Esc to cancel
        </div>
      )}
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
              // biome-ignore lint/suspicious/noArrayIndexKey: the slot is an EMA's identity, and two can share a length
              <span key={`ema${index}`} style={{ color: EMA_COLORS[index] }}>
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
