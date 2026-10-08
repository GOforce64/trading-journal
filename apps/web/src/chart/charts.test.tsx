import { act, fireEvent, render, screen } from "@testing-library/react";
import { nyWallClock, type PriceBar, snapToBar } from "@tj/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartToolbar } from "./ChartToolbar.js";
import { DailyChart } from "./DailyChart.js";
import { IntradayChart } from "./IntradayChart.js";
import { type ChartTrade, dailyModel, intradayModel } from "./model.js";
import { DEFAULT_PREFS } from "./prefs.js";
import { BAR_PX, library, resetLibrary, seriesOf, yOf } from "./testing.js";

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
      null,
    ]);
    expect(lines[5]?.data).toHaveLength(MODEL.levelTimes.length);
    // The last line is a missed trade's dotted entry-to-exit, empty on any other trade.
    expect(lines[9]?.data).toEqual([]);
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

  it("keeps the reader's zoom while a live session's candles arrive", () => {
    const live = (until: number) =>
      intradayModel(minutesOf(DAY, 240, until, 229), TRADE, 3, DEFAULT_PREFS.emaLengths);
    const { rerender } = render(<IntradayChart model={live(605)} show={DEFAULT_PREFS.show} fitKey={0} />);
    const opened = library.ranges.length;
    rerender(<IntradayChart model={live(620)} show={DEFAULT_PREFS.show} fitKey={0} />);
    expect(library.ranges.length).toBe(opened);
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

describe("IntradayChart cleanup", () => {
  it("removes its chart and stops listening when the page leaves", () => {
    // Placing the stop, so a listening chart would take Esc as cancel.
    const edit = { placing: "stop", onPlace: vi.fn(), onDrag: vi.fn(), onDrop: vi.fn(), onCancel: vi.fn() };
    const { unmount } = render(
      <IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={[]} editing={edit} />,
    );
    const removedBefore = library.removed;
    unmount();
    expect(library.removed).toBe(removedBefore + 1);
    // Esc after leaving reaches nothing.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(edit.onCancel).not.toHaveBeenCalled();
  });
});

describe("IntradayChart's legend", () => {
  it("lists two EMAs of the same length, each once, without React confusing them", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const twins = intradayModel(BARS, TRADE, 3, [8, 8, 20, 50]);
    render(<IntradayChart model={twins} show={DEFAULT_PREFS.show} fitKey={0} />);
    act(() => library.crosshair?.({ time: nyWallClock(DAY, 600) / 1000 }));
    const legend = screen.getByTestId("chart-legend").textContent ?? "";
    expect(legend.match(/EMA 8 /g)).toHaveLength(2);
    expect(errors.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
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

describe("IntradayChart editing the review's lines", () => {
  const STOP = { id: "stop", price: 231.8, color: "#ef5350", dashed: true, label: "STOP" };
  const T1 = { id: "t1", price: 234.5, color: "#26a69a", dashed: true, label: "T1 ×1" };
  const editing = (placing: string | null = null) => ({
    placing,
    onPlace: vi.fn(),
    onDrag: vi.fn(),
    onDrop: vi.fn(),
    onCancel: vi.fn(),
  });
  const chart = () => screen.getByTestId("intraday-chart");
  const stopLine = () => seriesOf("Candlestick")[0]?.priceLines[0];
  const renderEditing = (edit: ReturnType<typeof editing>, lines = [STOP]) =>
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={lines} editing={edit} />);

  it("places the stop where the chart is clicked, to the cent", () => {
    const edit = editing("stop");
    renderEditing(edit, []);
    expect(screen.getByTestId("placing-hint").textContent).toBe(
      "Click the chart to place the stop · Esc to cancel",
    );
    expect(chart().dataset.cursor).toBe("crosshair");
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    expect(edit.onPlace).toHaveBeenCalledWith("stop", 231.8);
  });

  it("ignores a click on the price axis while placing, and stops placing on Esc", () => {
    const edit = editing("stop");
    renderEditing(edit, []);
    fireEvent.mouseDown(chart(), { clientX: 850, clientY: yOf(231.8), button: 0 });
    expect(edit.onPlace).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(edit.onCancel).toHaveBeenCalled();
  });

  it("drags a line: it follows, the chart stops panning, and the release saves once", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8) + 3, button: 0 });
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: false, handleScale: false });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(231), buttons: 1 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230.5), buttons: 1 });
    expect(edit.onDrag).toHaveBeenLastCalledWith("stop", 230.5);
    expect(stopLine()?.price).toBe(230.5);
    expect(edit.onDrop).not.toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(edit.onDrop).toHaveBeenCalledTimes(1);
    expect(edit.onDrop).toHaveBeenCalledWith("stop", 230.5);
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: true, handleScale: true });
  });

  it("keeps a drag going outside the chart, saving where it's released", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(document.body, { clientX: 1200, clientY: yOf(229), buttons: 1 });
    fireEvent.mouseUp(document.body);
    expect(edit.onDrop).toHaveBeenCalledTimes(1);
    expect(edit.onDrop).toHaveBeenCalledWith("stop", 229);
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: true, handleScale: true });
  });

  it("ends a drag whose release was lost outside the window, keeping the line where it was", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230.5), buttons: 1 });
    // Released over another window: no mouseup ever comes, and the next move has no button held.
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(229), buttons: 0 });
    expect(edit.onDrop).toHaveBeenCalledTimes(1);
    expect(edit.onDrop).toHaveBeenCalledWith("stop", 230.5);
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(228), buttons: 0 });
    expect(stopLine()?.price).toBe(230.5);
    expect(library.chartOptions.at(-1)).toEqual({ handleScroll: true, handleScale: true });
  });

  it("puts a dragged line back on Esc, saving nothing", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230), buttons: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stopLine()?.price).toBe(231.8);
    expect(edit.onCancel).toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(edit.onDrop).not.toHaveBeenCalled();
  });

  it("shows ↕ only over a line, and leaves a press away from the lines to the chart", () => {
    const edit = editing();
    renderEditing(edit);
    fireEvent.mouseMove(chart(), { clientX: 100, clientY: yOf(231.8) + 2 });
    expect(chart().dataset.cursor).toBe("ns-resize");
    fireEvent.mouseMove(chart(), { clientX: 100, clientY: 300 });
    expect(chart().dataset.cursor).toBeUndefined();
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: 300, button: 0 });
    fireEvent.mouseUp(window);
    expect(library.chartOptions).toEqual([]);
    expect(edit.onDrop).not.toHaveBeenCalled();
  });

  it("does nothing with the mouse without editing, as on a fly's page", () => {
    render(<IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} lines={[STOP]} />);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230), buttons: 1 });
    expect(library.chartOptions).toEqual([]);
    expect(stopLine()?.price).toBe(231.8);
  });

  it("places a target by its id, naming it in the hint", () => {
    const edit = editing("t2");
    renderEditing(edit, [STOP, T1]);
    expect(screen.getByTestId("placing-hint").textContent).toBe(
      "Click the chart to place T2 · Esc to cancel",
    );
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(236), button: 0 });
    expect(edit.onPlace).toHaveBeenCalledWith("t2", 236);
  });

  it("drags a target's line by its id", () => {
    const edit = editing();
    renderEditing(edit, [STOP, T1]);
    fireEvent.mouseDown(chart(), { clientX: 100, clientY: yOf(234.5), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(235.5), buttons: 1 });
    expect(edit.onDrag).toHaveBeenLastCalledWith("t1", 235.5);
    fireEvent.mouseUp(window);
    expect(edit.onDrop).toHaveBeenCalledWith("t1", 235.5);
    expect(seriesOf("Candlestick")[0]?.priceLines[1]?.price).toBe(235.5);
  });
});

describe("IntradayChart's option view", () => {
  const OPTION_BARS: PriceBar[] = [
    { t: nyWallClock(DAY, 571), o: 0.97, h: 1.53, l: 0.97, c: 1.1, v: 50 },
    { t: nyWallClock(DAY, 580), o: 1.2, h: 1.37, l: 1.15, c: 1.3, v: 20 },
    { t: nyWallClock(DAY, 586), o: 1.1, h: 1.32, l: 0.64, c: 1.29, v: 30 },
  ];
  const OPTION = intradayModel(OPTION_BARS, TRADE, 1, DEFAULT_PREFS.emaLengths, { slots: true });
  const at = (minute: number) => nyWallClock(DAY, minute) / 1000;

  it("draws empty minutes as whitespace, so the candles keep their place in time", () => {
    render(
      <IntradayChart model={OPTION} show={DEFAULT_PREFS.show} fitKey={0} viewKey="option" markersAtPrice />,
    );
    const drawn = seriesOf("Candlestick")[0]?.data as { time: number; open?: number }[];
    expect(drawn).toHaveLength(OPTION.slots?.length ?? -1);
    expect(drawn.find((item) => item.time === at(572))).toEqual({ time: at(572) });
    expect(drawn.find((item) => item.time === at(580))?.open).toBe(1.2);
  });

  it("puts the fills at their prices", () => {
    render(
      <IntradayChart model={OPTION} show={DEFAULT_PREFS.show} fitKey={0} viewKey="option" markersAtPrice />,
    );
    expect(library.markers.at(-1)).toEqual([
      expect.objectContaining({ position: "atPriceTop", price: 1.06, shape: "arrowUp", text: "B 2 @ 1.06" }),
      expect.objectContaining({
        position: "atPriceBottom",
        price: 1.295,
        shape: "arrowDown",
        text: "S 2 @ 1.295",
      }),
    ]);
  });

  it("keeps the time range in view across a switch", () => {
    const { rerender } = render(
      <IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} viewKey="stock" />,
    );
    const opened = library.ranges.length;
    const range = { from: at(575), to: at(600) };
    library.visibleRange = range;
    rerender(
      <IntradayChart model={OPTION} show={DEFAULT_PREFS.show} fitKey={0} viewKey="option" markersAtPrice />,
    );
    expect(library.timeRanges).toEqual([range]);
    expect(library.ranges).toHaveLength(opened);
  });

  it("opens on the trade instead when the other view has nothing in that range", () => {
    const { rerender } = render(
      <IntradayChart model={MODEL} show={DEFAULT_PREFS.show} fitKey={0} viewKey="stock" />,
    );
    const opened = library.ranges.length;
    library.visibleRange = { from: at(1100), to: at(1150) };
    rerender(
      <IntradayChart model={OPTION} show={DEFAULT_PREFS.show} fitKey={0} viewKey="option" markersAtPrice />,
    );
    expect(library.timeRanges).toEqual([]);
    expect(library.ranges).toHaveLength(opened + 1);
  });
});

describe("ChartToolbar's view switch", () => {
  const toolbar = (view?: { current: "stock" | "option"; onChange: (view: "stock" | "option") => void }) => (
    <ChartToolbar prefs={DEFAULT_PREFS} onChange={vi.fn()} hiddenEmas={[]} onFit={vi.fn()} view={view} />
  );

  it("switches between the stock and the option, greying PM levels on the option", () => {
    const onChange = vi.fn();
    const { rerender } = render(toolbar({ current: "stock", onChange }));
    expect(screen.getByRole("button", { name: "Stock" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Option" }));
    expect(onChange).toHaveBeenCalledWith("option");
    expect((screen.getByRole("button", { name: "PM levels" }) as HTMLButtonElement).disabled).toBe(false);
    rerender(toolbar({ current: "option", onChange }));
    const pm = screen.getByRole("button", { name: "PM levels" }) as HTMLButtonElement;
    expect(pm.disabled).toBe(true);
    expect(pm.title).toBe("Options don't trade premarket");
  });

  it("has no switch without a view", () => {
    render(toolbar());
    expect(screen.queryByRole("button", { name: "Option" })).toBeNull();
  });
});

describe("IntradayChart and a missed trade's points", () => {
  const editing = (placing: string | null = null) => ({
    placing,
    onPlace: vi.fn(),
    onDrag: vi.fn(),
    onDrop: vi.fn(),
    onCancel: vi.fn(),
    onPlacePoint: vi.fn(),
    onDropPoint: vi.fn(),
  });
  const chart = () => screen.getByTestId("intraday-chart");
  const candle = (index: number) => {
    const found = MODEL.candles[index];
    if (!found) throw new Error(`no candle ${index}`);
    return found;
  };
  const last = MODEL.candles.length - 1;
  const ENTRY = 200;
  const EXIT = 210;
  const points = [
    { id: "entry" as const, t: candle(ENTRY).t, price: candle(ENTRY).c, label: "Entry" },
    { id: "exit" as const, t: candle(EXIT).t, price: candle(EXIT).c, label: "Exit" },
  ];
  type Drawn = { time: number; shape: string; position: string; price?: number; text: string; color: string };
  const drawn = () => (library.markers.at(-1) ?? []) as Drawn[];
  const renderPoints = (edit: ReturnType<typeof editing> | undefined, extra: Record<string, unknown> = {}) =>
    render(
      <IntradayChart
        model={MODEL}
        show={DEFAULT_PREFS.show}
        fitKey={0}
        points={points}
        editing={edit}
        {...extra}
      />,
    );

  it("draws the entry and exit as circles at their prices, joined by a dotted line", () => {
    renderPoints(undefined);
    expect(drawn()).toContainEqual(
      expect.objectContaining({
        time: candle(ENTRY).t / 1000,
        shape: "circle",
        position: "atPriceMiddle",
        price: candle(ENTRY).c,
        text: "Entry",
      }),
    );
    expect(seriesOf("Line").at(-1)?.data).toEqual([
      { time: candle(ENTRY).t / 1000, value: candle(ENTRY).c },
      { time: candle(EXIT).t / 1000, value: candle(EXIT).c },
    ]);
  });

  it("places the entry at the bar under the pointer, its price kept inside the bar", () => {
    const edit = editing("entry");
    renderPoints(edit, { points: [] });
    expect(screen.getByTestId("placing-hint").textContent).toBe(
      "Click the chart to place the entry · Esc to cancel",
    );
    fireEvent.mouseDown(chart(), { clientX: ENTRY * BAR_PX + 0.6, clientY: yOf(239.5), button: 0 });
    expect(edit.onPlacePoint).toHaveBeenCalledWith(
      "entry",
      candle(ENTRY).t,
      expect.closeTo(candle(ENTRY).h, 2),
    );
    expect(edit.onPlace).not.toHaveBeenCalled();
  });

  it("drags a point in time and price, onto the last candle when pulled past the end", () => {
    const edit = editing();
    renderPoints(edit);
    fireEvent.mouseDown(chart(), { clientX: EXIT * BAR_PX, clientY: yOf(candle(EXIT).c), button: 0 });
    fireEvent.mouseMove(window, {
      clientX: (MODEL.candles.length + 20) * BAR_PX,
      clientY: yOf(candle(last).c),
      buttons: 1,
    });
    expect(drawn()).toContainEqual(expect.objectContaining({ time: candle(last).t / 1000, text: "Exit" }));
    fireEvent.mouseUp(window);
    expect(edit.onDropPoint).toHaveBeenCalledTimes(1);
    const [id, t, price] = edit.onDropPoint.mock.calls[0] as [string, number, number];
    expect([id, t]).toEqual(["exit", candle(last).t]);
    expect(price).toBeCloseTo(snapToBar(candle(last).c, { high: candle(last).h, low: candle(last).l }), 2);
    expect(edit.onDrop).not.toHaveBeenCalled();
  });

  it("puts a dragged point back on Esc, saving nothing", () => {
    const edit = editing();
    renderPoints(edit);
    fireEvent.mouseDown(chart(), { clientX: ENTRY * BAR_PX, clientY: yOf(candle(ENTRY).c), button: 0 });
    fireEvent.mouseMove(window, { clientX: (ENTRY + 5) * BAR_PX, clientY: yOf(candle(ENTRY).c), buttons: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(edit.onDropPoint).not.toHaveBeenCalled();
    expect(edit.onCancel).toHaveBeenCalled();
    expect(drawn()).toContainEqual(expect.objectContaining({ time: candle(ENTRY).t / 1000, text: "Entry" }));
  });

  it("shows another trade faintly, says what it was on hover, and opens it on a click", () => {
    const onOpenTrade = vi.fn();
    const mark = {
      tradeId: "m9",
      t: candle(220).t,
      price: candle(220).c,
      kind: "missed" as const,
      label: "Missed short −0.62R",
      tip: ["Missed · Short", "10:52 → 11:06", "−0.62R", "Click to open"],
    };
    render(
      <IntradayChart
        model={MODEL}
        show={DEFAULT_PREFS.show}
        fitKey={0}
        context={[mark]}
        onOpenTrade={onOpenTrade}
      />,
    );
    const faint = drawn().find((each) => each.text === "Missed short −0.62R");
    expect(faint).toMatchObject({ shape: "circle", position: "atPriceMiddle", price: candle(220).c });
    expect(faint?.color).toMatch(/^#[0-9a-f]{8}$/);
    fireEvent.mouseMove(chart(), { clientX: 220 * BAR_PX + 1, clientY: yOf(candle(220).c) });
    expect(screen.getByTestId("context-tip").textContent).toBe(
      "Missed · Short10:52 → 11:06−0.62RClick to open",
    );
    fireEvent.mouseDown(chart(), { clientX: 220 * BAR_PX + 1, clientY: yOf(candle(220).c), button: 0 });
    expect(onOpenTrade).toHaveBeenCalledWith("m9");
  });
});
