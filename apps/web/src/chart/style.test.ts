import { TickMarkType } from "lightweight-charts";
import { describe, expect, it } from "vitest";
import { nyTickLabel } from "../analytics/equityData.js";
import { chartOptions } from "./style.js";

describe("chartOptions", () => {
  // DeepPartial drops the formatter's call signature, so it's typed back here.
  const formatter = chartOptions(false).timeScale?.tickMarkFormatter as unknown as (
    time: number | string,
    type: TickMarkType,
    locale: string,
  ) => string | null;
  const format = (time: number | string, type: TickMarkType) => formatter(time, type, "en-US");

  it("leaves a daily chart's business-day ticks to the library, which names months and years", () => {
    expect(format("2026-09-28", TickMarkType.DayOfMonth)).toBeNull();
    expect(format("2026-01-02", TickMarkType.Year)).toBeNull();
  });

  it("labels an intraday tick in New York time", () => {
    const at = 1_790_602_200; // Mon Sep 28 2026, 09:30 ET, in seconds
    expect(format(at, TickMarkType.Time)).toBe(nyTickLabel(at, TickMarkType.Time));
  });
});
