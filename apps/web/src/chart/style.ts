import {
  type ChartOptions,
  ColorType,
  type DeepPartial,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { nyTickLabel } from "../analytics/equityData.js";

export const COLORS = {
  up: "#26a69a",
  down: "#ef5350",
  upExtended: "rgba(38, 166, 154, 0.45)",
  downExtended: "rgba(239, 83, 80, 0.45)",
  volumeUp: "rgba(38, 166, 154, 0.35)",
  volumeDown: "rgba(239, 83, 80, 0.35)",
  vwap: "#e0e0e0",
  pm: "#82a8ff",
  pd: "#ffb74d",
  held: "#2962ff",
};
/** EMA 1–4 (8, 20, 50, 167 by default). */
export const EMA_COLORS = ["#f7c948", "#26c6da", "#ab47bc", "#ff7043"] as const;

/** Epoch ms as the chart's UTC seconds. */
export const seconds = (t: number) => Math.floor(t / 1000) as UTCTimestamp;

const NY_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** A candle's time in New York, e.g. "Sep 28, 09:30". */
export const nyTimeText = (t: number) => NY_TIME.format(new Date(t));

/** The app's chart look (the Terminal theme). Lightweight Charts has no timezone option, so times are formatted in New York. */
export function chartOptions(intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#131722" },
      textColor: "#6b7385",
      fontSize: 10,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
    },
    grid: { vertLines: { color: "#1a1e29" }, horzLines: { color: "#1a1e29" } },
    rightPriceScale: { borderColor: "#1f2430" },
    timeScale: {
      borderColor: "#1f2430",
      timeVisible: intraday,
      tickMarkFormatter: (time: Time, type: TickMarkType) =>
        typeof time === "number" ? nyTickLabel(time, type) : String(time),
    },
    localization: {
      timeFormatter: (time: Time) => (typeof time === "number" ? nyTimeText(time * 1000) : String(time)),
    },
  };
}
