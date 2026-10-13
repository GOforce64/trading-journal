import type * as Charts from "lightweight-charts";
import type { ISeriesPrimitive, Time } from "lightweight-charts";

/** What a chart asked of one series. */
export interface FakeSeries {
  type: string;
  options: Record<string, unknown>;
  data: unknown[];
  applied: Record<string, unknown>[];
  /** The price lines it holds now, each as its current options. */
  priceLines: Record<string, unknown>[];
}

/** The fake's plot: 800 × 400 px, with 240 at the top and 220 at the bottom, so 0.05 a pixel. */
export const PANE = { width: 800, height: 400, high: 240, low: 220 };
/** Each candle's width on the fake's time scale: candle `i` sits at x = i × BAR_PX. */
export const BAR_PX = 2;
/** The height a price sits at on the fake's scale. */
export const yOf = (price: number) => ((PANE.high - price) / (PANE.high - PANE.low)) * PANE.height;
const priceOf = (y: number) => PANE.high - (y / PANE.height) * (PANE.high - PANE.low);

/** The canvas can't draw in jsdom. This records what the components ask of Lightweight Charts instead. */
export const library = {
  charts: 0,
  removed: 0,
  series: [] as FakeSeries[],
  ranges: [] as unknown[],
  /** Every setVisibleRange call: a time range kept across a view switch. */
  timeRanges: [] as unknown[],
  /** What getVisibleRange answers: the time range the reader is looking at. */
  visibleRange: null as unknown,
  markers: [] as unknown[][],
  crosshair: null as ((param: { time?: unknown }) => void) | null,
  /** Every chart.applyOptions call, in order. */
  chartOptions: [] as Record<string, unknown>[],
  /** The primitives attached to a series, such as the session backgrounds. */
  primitives: [] as { type: string; primitive: ISeriesPrimitive<Time> }[],
};

export function resetLibrary(): void {
  library.charts = 0;
  library.removed = 0;
  library.series = [];
  library.ranges = [];
  library.timeRanges = [];
  library.visibleRange = null;
  library.markers = [];
  library.crosshair = null;
  library.chartOptions = [];
  library.primitives = [];
}

/** The real module with `createChart` and `createSeriesMarkers` replaced by recorders. */
export function fakeLibrary(real: typeof Charts): typeof Charts {
  const createChart = () => {
    library.charts++;
    const chart = {
      addSeries: (definition: { type?: string }, options: Record<string, unknown> = {}) => {
        const series: FakeSeries = {
          type: definition.type ?? "?",
          options,
          data: [],
          applied: [],
          priceLines: [],
        };
        library.series.push(series);
        return {
          setData: (data: unknown[]) => {
            series.data = data;
          },
          applyOptions: (applied: Record<string, unknown>) => {
            series.applied.push(applied);
          },
          priceToCoordinate: (price: number) => yOf(price),
          coordinateToPrice: (y: number) => priceOf(y),
          createPriceLine: (line: Record<string, unknown>) => {
            const record = { ...line };
            series.priceLines.push(record);
            return {
              record,
              applyOptions: (next: Record<string, unknown>) => {
                Object.assign(record, next);
              },
            };
          },
          removePriceLine: (handle: { record: Record<string, unknown> }) => {
            series.priceLines = series.priceLines.filter((each) => each !== handle.record);
          },
          attachPrimitive: (primitive: ISeriesPrimitive<Time>) => {
            library.primitives.push({ type: series.type, primitive });
            primitive.attached?.({ chart, requestUpdate: () => {} } as never);
          },
        };
      },
      applyOptions: (options: Record<string, unknown>) => {
        library.chartOptions.push(options);
      },
      paneSize: () => ({ width: PANE.width, height: PANE.height }),
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({
        coordinateToLogical: (x: number) => x / BAR_PX,
        logicalToCoordinate: (logical: number) => logical * BAR_PX,
        setVisibleLogicalRange: (range: unknown) => {
          library.ranges.push(range);
        },
        getVisibleRange: () => library.visibleRange,
        setVisibleRange: (range: unknown) => {
          library.timeRanges.push(range);
          library.visibleRange = range;
        },
      }),
      subscribeCrosshairMove: (handler: (param: { time?: unknown }) => void) => {
        library.crosshair = handler;
      },
      unsubscribeCrosshairMove: () => {},
      remove: () => {
        library.removed++;
      },
    };
    return chart;
  };
  const createSeriesMarkers = () => ({
    setMarkers: (markers: unknown[]) => {
      library.markers.push(markers);
    },
  });
  return {
    ...real,
    createChart: createChart as unknown as typeof real.createChart,
    createSeriesMarkers: createSeriesMarkers as unknown as typeof real.createSeriesMarkers,
  };
}

/** The series of one kind, in the order the chart added them. */
export const seriesOf = (type: string): FakeSeries[] =>
  library.series.filter((series) => series.type === type);

/** One fillRect a primitive's background made, in bitmap pixels. */
export interface Fill {
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a primitive paints in the background layer of the fake's pane, at a pixel ratio. */
export function paintedBackground(primitive: ISeriesPrimitive<Time>, pixelRatio = 1): Fill[] {
  const fills: Fill[] = [];
  const context = {
    fillStyle: "",
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ color: String(context.fillStyle), x, y, width, height });
    },
  };
  const target = {
    useBitmapCoordinateSpace: (draw: (scope: unknown) => void) =>
      draw({
        context,
        mediaSize: { width: PANE.width, height: PANE.height },
        bitmapSize: { width: PANE.width * pixelRatio, height: PANE.height * pixelRatio },
        horizontalPixelRatio: pixelRatio,
        verticalPixelRatio: pixelRatio,
      }),
  };
  for (const view of primitive.paneViews?.() ?? []) view.renderer()?.drawBackground?.(target as never);
  return fills;
}
