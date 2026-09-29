import { act, fireEvent, render, screen } from "@testing-library/react";
import { nyWallClock, type PriceBar } from "@tj/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import { IntradayChart } from "./IntradayChart.js";
import { type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { DEFAULT_PREFS } from "./prefs.js";
import { library, resetLibrary, seriesOf } from "./testing.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

const DAY = "2026-09-28";
const minutesOf = (date: string, from: number, to: number, price: number): PriceBar[] =>
  Array.from({ length: to - from }, (_, index) => {
    const c = price + index * 0.01;
    return { t: nyWallClock(date, from + index), o: c, h: c + 0.05, l: c - 0.05, c, v: 1_000 };
  });
const BARS = [...minutesOf("2026-09-25", 570, 960, 200), ...minutesOf(DAY, 240, 1200, 229)];
const TRADE: ChartTrade = {
  openedAt: nyWallClock(DAY, 571),
  closedAt: nyWallClock(DAY, 586),
  fills: [
    { executedAt: nyWallClock(DAY, 571), quantity: 2, price: 1.06, kind: "trade", canceled: false },
    { executedAt: nyWallClock(DAY, 586), quantity: -2, price: 1.295, kind: "trade", canceled: false },
  ],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};
const MODEL = intradayModel(BARS, TRADE, 3, DEFAULT_PREFS.emaLengths);

beforeEach(() => resetLibrary());

describe("IntradayChart", () => {
  it("draws candles, lighter outside 09:30–16:00, with volume, EMAs, VWAP and the four levels", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    expect(library.charts).toBe(1);
    const [candles] = seriesOf("Candlestick");
    const drawn = candles?.data as { time: number; color?: string }[];
    expect(drawn).toHaveLength(MODEL.candles.length);
    expect(drawn[0]?.time).toBe(nyWallClock("2026-09-25", 570) / 1000);
    const premarket = drawn.find((candle) => candle.time === nyWallClock(DAY, 240) / 1000);
    expect(premarket?.color).toBe("rgba(38, 166, 154, 0.45)");
    const open = drawn.find((candle) => candle.time === nyWallClock(DAY, 570) / 1000);
    expect(open?.color).toBeUndefined();
    expect(seriesOf("Histogram")[0]?.data).toHaveLength(MODEL.candles.length);
    const lines = seriesOf("Line");
    expect(lines.map((line) => line.options.title ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      "PM H",
      "PM L",
      "PD H",
      "PD L",
    ]);
    expect(lines[5]?.data).toHaveLength(MODEL.levelTimes.length);
  });

  it("hides the VWAP line between sessions, so it never bridges the night", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const vwap = seriesOf("Line")[4]?.data as { time: number; value: number; color?: string }[];
    const at = (date: string, minute: number) =>
      vwap.find((point) => point.time === nyWallClock(date, minute) / 1000);
    // Lightweight Charts joins consecutive points, drawing each segment in its first point's colour.
    expect(at("2026-09-25", 957)?.color).toBe("transparent");
    expect(at("2026-09-25", 954)?.color).toBeUndefined();
    expect(at(DAY, 240)).toBeUndefined();
    expect(at(DAY, 570)?.color).toBeUndefined();
  });

  it("marks the fills and opens on the trade", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const markers = library.markers.at(-1) as { text: string; position: string }[];
    expect(markers.map((marker) => [marker.text, marker.position])).toEqual([
      ["B 2 @ 1.06", "belowBar"],
      ["S 2 @ 1.295", "aboveBar"],
    ]);
    expect(library.ranges.at(-1)).toEqual(MODEL.window);
  });

  it("goes back to the trade on Fit trade, and builds the chart only once", () => {
    const { rerender } = render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const opened = library.ranges.length;
    rerender(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={1} />);
    expect(library.ranges.length).toBe(opened + 1);
    expect(library.charts).toBe(1);
  });

  it("hides what's toggled off", () => {
    render(
      <IntradayChart model={MODEL} show={{ ...DEFAULT_PREFS.show, vwap: false, pd: false }} fitKey={0} />,
    );
    const lines = seriesOf("Line");
    expect(lines[4]?.applied.at(-1)).toEqual({ visible: false });
    expect(lines[7]?.applied.at(-1)).toEqual({ visible: false });
    expect(lines[5]?.applied.at(-1)).toEqual({ visible: true });
  });

  it("draws extra lines, such as the review's stop and target, on the price axis", () => {
    const lines = [{ price: 228.4, color: "#ef5350", dashed: true, label: "Stop" }];
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={lines} />);
    expect(seriesOf("Candlestick")[0]?.priceLines).toEqual([
      expect.objectContaining({ price: 228.4, color: "#ef5350", title: "Stop" }),
    ]);
  });

  it("shows the hovered candle's prices and indicators in the legend", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} />);
    const candle = MODEL.candles.find((each) => each.t === nyWallClock(DAY, 570));
    act(() => library.crosshair?.({ time: nyWallClock(DAY, 570) / 1000 }));
    const legend = screen.getByTestId("chart-legend").textContent ?? "";
    expect(legend).toContain("09:30");
    expect(legend).toContain(`O ${candle?.o.toFixed(2)}`);
    expect(legend).toContain("VWAP");
  });
});

describe("DailyChart", () => {
  it("draws daily candles by date, with the trade's days marked, opening on the last six months", () => {
    const daily = [
      { t: nyWallClock("2026-09-24", 0), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: nyWallClock("2026-09-25", 0), o: 1.5, h: 2, l: 1, c: 1.8, v: 10 },
      { t: nyWallClock(DAY, 0), o: 1.8, h: 2.2, l: 1.7, c: 2, v: 10 },
    ];
    const model = dailyModel(daily, [], TRADE, DEFAULT_PREFS.emaLengths, DAY);
    render(<DailyChart model={model} show={DEFAULT_PREFS.show} fitKey={0} />);
    const drawn = seriesOf("Candlestick")[0]?.data as { time: string }[];
    expect(drawn.map((candle) => candle.time)).toEqual(["2026-09-24", "2026-09-25", DAY]);
    expect((library.markers.at(-1) as { time: string }[]).map((marker) => marker.time)).toEqual([DAY]);
    expect(library.ranges.at(-1)).toEqual({ from: 0, to: 2 });
  });
});

describe("ChartToolbar", () => {
  it("switches timeframes, toggles indicators, and fits the trade", () => {
    const onChange = vi.fn();
    const onFit = vi.fn();
    render(<ChartToolbar prefs={DEFAULT_PREFS} onChange={onChange} hiddenEmas={[3]} onFit={onFit} />);
    expect(screen.getByRole("button", { name: "3m" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "5m" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_PREFS, minutes: 5 });
    fireEvent.click(screen.getByRole("button", { name: "VWAP" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PREFS,
      show: { ...DEFAULT_PREFS.show, vwap: false },
    });
    expect(screen.getByRole("button", { name: "EMA 167" }).getAttribute("title")).toBe("needs more history");
    expect(screen.getByRole("button", { name: "EMA 8" }).getAttribute("title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fit trade" }));
    expect(onFit).toHaveBeenCalled();
  });
});
