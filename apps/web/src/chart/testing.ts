import type * as Charts from "lightweight-charts";

/** What a chart asked of one series. */
export interface FakeSeries {
  type: string;
  options: Record<string, unknown>;
  data: unknown[];
  applied: Record<string, unknown>[];
  priceLines: Record<string, unknown>[];
}

/** The canvas can't draw in jsdom. This records what the components ask of Lightweight Charts instead. */
export const library = {
  charts: 0,
  removed: 0,
  series: [] as FakeSeries[],
  ranges: [] as unknown[],
  markers: [] as unknown[][],
  crosshair: null as ((param: { time?: unknown }) => void) | null,
};

export function resetLibrary(): void {
  library.charts = 0;
  library.removed = 0;
  library.series = [];
  library.ranges = [];
  library.markers = [];
  library.crosshair = null;
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
          createPriceLine: (line: Record<string, unknown>) => {
            series.priceLines.push(line);
            return line;
          },
          removePriceLine: (line: Record<string, unknown>) => {
            series.priceLines = series.priceLines.filter((each) => each !== line);
          },
        };
      },
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
