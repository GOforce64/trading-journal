import type * as Charts from "lightweight-charts";

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
/** The height a price sits at on the fake's scale. */
export const yOf = (price: number) => ((PANE.high - price) / (PANE.high - PANE.low)) * PANE.height;
const priceOf = (y: number) => PANE.high - (y / PANE.height) * (PANE.high - PANE.low);

/** The canvas can't draw in jsdom. This records what the components ask of Lightweight Charts instead. */
export const library = {
  charts: 0,
  removed: 0,
  series: [] as FakeSeries[],
  ranges: [] as unknown[],
  markers: [] as unknown[][],
  crosshair: null as ((param: { time?: unknown }) => void) | null,
  /** Every chart.applyOptions call, in order. */
  chartOptions: [] as Record<string, unknown>[],
};

export function resetLibrary(): void {
  library.charts = 0;
  library.removed = 0;
  library.series = [];
  library.ranges = [];
  library.markers = [];
  library.crosshair = null;
  library.chartOptions = [];
}

/** The real module with `createChart` and `createSeriesMarkers` replaced by recorders. */
export function fakeLibrary(real: typeof Charts): typeof Charts {
  const createChart = () => {
    library.charts++;
    return {
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
        };
      },
      applyOptions: (options: Record<string, unknown>) => {
        library.chartOptions.push(options);
      },
      paneSize: () => ({ width: PANE.width, height: PANE.height }),
      priceScale: () => ({ applyOptions: () => {} }),
      timeScale: () => ({
        setVisibleLogicalRange: (range: unknown) => {
          library.ranges.push(range);
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
