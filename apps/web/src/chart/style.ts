import { dayText, dayTimeText, dayYearText, monthName, nyDate } from "@tj/core";
import {
  type ChartOptions,
  ColorType,
  type DeepPartial,
  TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { nyTickLabel } from "../analytics/equityData.js";

export const COLORS = {
  up: "#26a69a",
  down: "#ef5350",
  volumeUp: "rgba(38, 166, 154, 0.35)",
  volumeDown: "rgba(239, 83, 80, 0.35)",
  vwap: "#e0e0e0",
  pm: "#82a8ff",
  pd: "#ffb74d",
  held: "#2962ff",
  /** A stock scalp's levels on the option view, as estimates (premium-chart spec §7). */
  upFaint: "rgba(38, 166, 154, 0.55)",
  downFaint: "rgba(239, 83, 80, 0.55)",
  /** Pre-market and after-hours backgrounds on the stock view (session-backgrounds spec §1). */
  preBand: "rgba(255, 193, 7, 0.07)",
  postBand: "rgba(124, 77, 255, 0.09)",
};
/** EMA 1–4 (8, 20, 50, 167 by default). */
export const EMA_COLORS = ["#f7c948", "#26c6da", "#ab47bc", "#ff7043"] as const;

/** Epoch ms as the chart's UTC seconds. */
export const seconds = (t: number) => Math.floor(t / 1000) as UTCTimestamp;

/** A candle's time in New York, e.g. "28 Sep 09:30". */
export const nyTimeText = (t: number) => dayTimeText(t);

/** A chart time as a New York date: an intraday time read in New York, a daily bar's business day as is. */
export function chartTimeIso(time: Time): string | null {
  if (typeof time === "number") return nyDate(time * 1000);
  if (typeof time === "string") return time;
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

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
      // Daily bars' business days too, so no label follows the browser's language.
      tickMarkFormatter: (time: Time, type: TickMarkType) => {
        if (typeof time === "number") return nyTickLabel(time, type);
        const iso = chartTimeIso(time);
        if (iso == null) return null;
        if (type === TickMarkType.Year) return iso.slice(0, 4);
        return type === TickMarkType.Month ? monthName(iso) : dayText(iso);
      },
    },
    localization: {
      timeFormatter: (time: Time) =>
        typeof time === "number" ? nyTimeText(time * 1000) : dayYearText(chartTimeIso(time) ?? ""),
    },
  };
}
