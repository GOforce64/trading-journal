import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, isTradingDay, nyWallClock, type PriceBar } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayNy } from "../market.js";
import { SwingChart } from "./SwingChart.js";
import { library, resetLibrary, seriesOf } from "./testing.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

function dailyBars(from: string, to: string): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isTradingDay(date)) bars.push({ t: nyWallClock(date, 0), o: 230, h: 236, l: 228, c: 233, v: 1_000 });
  }
  return bars;
}
const DAILY = dailyBars("2021-10-01", "2026-10-09");
const TRADE = {
  underlying: "NVDA",
  openedAt: nyWallClock("2026-10-02", 615),
  closedAt: nyWallClock("2026-10-09", 660),
  fills: [],
  legs: [
    { right: "C", strike: 230, quantity: 1, openPrice: 5.1, closePrice: 9 },
    { right: "C", strike: 240, quantity: -1, openPrice: 1.3, closePrice: 1.15 },
  ],
};
const LINES = [
  { price: 230, color: "#f48fb1", dashed: true, label: "230" },
  { price: 240, color: "#f48fb1", dashed: true, label: "240" },
  { price: 233.8, color: "#9aa3b5", dashed: true, label: "BE 233.80" },
];
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stub({ weeklyFails = false } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("span=weekly") && weeklyFails) return answer({ error: "unreachable" }, 502);
    return answer({ symbol: "NVDA", bars: DAILY, partial: false, unavailable: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SwingChart trade={TRADE} lines={LINES} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  resetLibrary();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SwingChart (swing spec §5.4)", () => {
  it("draws daily candles with wicks, the strike and break-even lines on the axis, and the fills", async () => {
    stub();
    show();
    await waitFor(() => expect(seriesOf("Candlestick")[0]?.data.length).toBeGreaterThan(0));
    const candles = seriesOf("Candlestick")[0];
    expect(candles?.options).toMatchObject({
      wickUpColor: expect.any(String),
      wickDownColor: expect.any(String),
    });
    expect(candles?.options.wickVisible).not.toBe(false);
    expect(candles?.priceLines.map((line) => [line.price, line.title, line.axisLabelVisible])).toEqual([
      [230, "230", true],
      [240, "240", true],
      [233.8, "BE 233.80", true],
    ]);
    const markers = library.markers.at(-1) as { time: string; text: string }[];
    expect(markers.map((marker) => [marker.time, marker.text])).toEqual([
      ["2026-10-02", "B 1 @ 3.80"],
      ["2026-10-09", "S 1 @ 7.85"],
    ]);
  });

  it("runs a closed swing's candles past its exit to the latest day, to show what the stock did after", async () => {
    const today = todayNy();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const bars = url.includes("/daily") ? dailyBars("2021-10-01", addDays(today, -1)) : [];
      return answer({ symbol: "NVDA", bars, partial: false, unavailable: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    show();
    await waitFor(() => expect(seriesOf("Candlestick")[0]?.data.length).toBeGreaterThan(0));
    const daily = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/daily"));
    expect(daily).toEqual([expect.stringContaining(`to=${today}`)]);
    const times = seriesOf("Candlestick")[0]?.data.map((candle) => (candle as { time: string }).time) ?? [];
    expect(times.filter((time) => time > "2026-10-09").length).toBeGreaterThan(0);
  });

  it("ends at the exit, as before, when there's no key to fetch the days after it (the demo has none)", async () => {
    const today = todayNy();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`daily?to=${today}`)) {
        return answer({
          symbol: "NVDA",
          bars: [],
          partial: false,
          unavailable: { reason: "no_key", message: "Add your Alpaca key in Settings to see the chart." },
        });
      }
      const bars = url.includes("/daily") ? DAILY : [];
      return answer({ symbol: "NVDA", bars, partial: false, unavailable: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    show();
    await waitFor(() => expect(seriesOf("Candlestick")[0]?.data.length).toBe(DAILY.length));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("daily?to=2026-10-09"))).toBe(true);
    const markers = library.markers.at(-1) as { time: string; text: string }[];
    expect(markers.map((marker) => marker.text)).toEqual(["B 1 @ 3.80", "S 1 @ 7.85"]);
  });

  it("widens the price scale to every strike and the break-even, so none sits off the chart", async () => {
    stub();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SwingChart
          trade={TRADE}
          lines={[...LINES, { price: 200, color: "#f48fb1", dashed: true, label: "200" }]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(seriesOf("Candlestick")[0]?.data.length).toBeGreaterThan(0));
    const provide = seriesOf("Candlestick")[0]?.options.autoscaleInfoProvider as
      | ((base: () => unknown) => unknown)
      | undefined;
    expect(provide).toBeTypeOf("function");
    // The candles alone span 228–236: a 200 strike and the 240 short strike would be off the scale.
    expect(provide?.(() => ({ priceRange: { minValue: 228, maxValue: 236 } }))).toEqual({
      priceRange: { minValue: 200, maxValue: 240 },
    });
    // With nothing to show yet, there's nothing to widen.
    expect(provide?.(() => null)).toBeNull();
  });

  it("switches to weekly candles from five years of bars, with EMA 167 greyed out", async () => {
    const fetchMock = stub();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Weekly" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("span=weekly"))).toBe(true),
    );
    const ema167 = screen.getByRole("button", { name: "EMA 167" }) as HTMLButtonElement;
    await waitFor(() => expect(ema167.disabled).toBe(true));
    expect(ema167.title).toBe("Needs more history than a weekly chart has");
    expect((screen.getByRole("button", { name: "EMA 50" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the weekly fetch's failure and still draws Daily", async () => {
    stub({ weeklyFails: true });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Weekly" }));
    expect(await screen.findByText("Couldn't load the chart: Alpaca didn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    await waitFor(() => expect(screen.getByTestId("daily-chart")).toBeTruthy());
  });
});
