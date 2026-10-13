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

  it("labels a daily chart's business days itself, day first, whatever the browser's language", () => {
    expect(format("2026-09-28", TickMarkType.DayOfMonth)).toBe("28 Sep");
    expect(format("2026-09-01", TickMarkType.Month)).toBe("Sep");
    expect(format("2026-01-02", TickMarkType.Year)).toBe("2026");
  });

  it("writes a daily bar's crosshair date day first, from a string or a business day", () => {
    const time = chartOptions(false).localization?.timeFormatter as unknown as (time: unknown) => string;
    expect(time("2026-09-28")).toBe("28 Sep 2026");
    expect(time({ year: 2026, month: 9, day: 28 })).toBe("28 Sep 2026");
  });

  it("labels an intraday tick in New York time", () => {
    const at = 1_790_602_200; // Mon 28 Sep 2026, 09:30 ET, in seconds
    expect(format(at, TickMarkType.Time)).toBe(nyTickLabel(at, TickMarkType.Time));
  });
});
