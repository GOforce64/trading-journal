import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, nyWallClock, type PriceBar } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayNy } from "../market.js";
import { TradeCharts } from "./TradeCharts.js";
import { resetLibrary, seriesOf } from "./testing.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("./testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

const DAY = "2026-09-28";
const BARS: PriceBar[] = Array.from({ length: 60 }, (_, index) => ({
  t: nyWallClock(DAY, 570 + index),
  o: 229,
  h: 229.2,
  l: 228.8,
  c: 229.1,
  v: 1_000,
}));
const TRADE = {
  underlying: "NVDA",
  openedAt: nyWallClock(DAY, 571),
  closedAt: nyWallClock(DAY, 586),
  fills: [],
  legs: [{ quantity: 2, openPrice: 1.06, closePrice: 1.295 }],
};
const answer = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK = { symbol: "NVDA", bars: BARS, partial: false, unavailable: null };

/** Answers the minute bars with `minute` (one per call, the last repeating) and the daily bars with `daily`. */
function stub(minute: Response[], daily = answer({ ...OK, bars: [] })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/daily")) return daily.clone();
    const next = minute.length > 1 ? minute.shift() : minute[0];
    if (!next) throw new Error("no reply");
    return next.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCharts(trade: Parameters<typeof TradeCharts>[0]["trade"] = TRADE) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TradeCharts trade={trade} />
    </QueryClientProvider>,
  );
}

beforeEach(() => resetLibrary());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("TradeCharts", () => {
  it("hands the review's lines and editing to the intraday chart", async () => {
    stub([answer(OK)]);
    const levels = {
      lines: [{ id: "stop" as const, price: 229, color: "#ef5350", dashed: true, label: "STOP" }],
      editing: {
        placing: "target" as const,
        onPlace: vi.fn(),
        onDrag: vi.fn(),
        onDrop: vi.fn(),
        onCancel: vi.fn(),
      },
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TradeCharts trade={TRADE} levels={levels} />
      </QueryClientProvider>,
    );
    await screen.findByTestId("intraday-chart");
    expect(seriesOf("Candlestick")[0]?.priceLines).toEqual([
      expect.objectContaining({ price: 229, title: "STOP" }),
    ]);
    expect(screen.getByTestId("placing-hint").textContent).toContain("place the target");
  });

  it("asks for the week before the trade through its last day, and the daily bars up to that day", async () => {
    const fetchMock = stub([answer(OK)]);
    renderCharts();
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA?from=2026-09-21&to=2026-09-28"));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA/daily?to=2026-09-28"));
    expect(screen.getByRole("button", { name: "3m" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says an EMA needs more history when the daily chart can't draw it", async () => {
    // Two hours of 3m candles draw EMA 8 on the intraday chart; two daily bars and the trade's day can't.
    const morning = Array.from(
      { length: 120 },
      (_, index) => ({ ...BARS[0], t: nyWallClock(DAY, 570 + index) }) as PriceBar,
    );
    const daily = [nyWallClock("2026-09-24", 0), nyWallClock("2026-09-25", 0)].map((t) => ({
      t,
      o: 1,
      h: 1,
      l: 1,
      c: 1,
      v: 1,
    }));
    stub([answer({ ...OK, bars: morning })], answer({ ...OK, bars: daily }));
    renderCharts();
    await screen.findByTestId("daily-chart");
    expect(screen.getByRole("button", { name: "EMA 8" }).getAttribute("title")).toBe("needs more history");
  });

  it("charts the last 45 days of a trade held longer, as much as the server serves", async () => {
    const fetchMock = stub([answer(OK)]);
    const today = todayNy();
    renderCharts({ ...TRADE, openedAt: nyWallClock(addDays(today, -90), 600), closedAt: null });
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(
      expect.stringContaining(`/api/bars/NVDA?from=${addDays(today, -45)}&to=${today}`),
    );
  });

  it("says why there's no chart without a key, or for a symbol Alpaca doesn't carry", async () => {
    stub([
      answer({
        ...OK,
        bars: [],
        unavailable: { reason: "no_key", message: "Add your Alpaca key in Settings to see the chart." },
      }),
    ]);
    renderCharts();
    expect(await screen.findByText("Add your Alpaca key in Settings to see the chart.")).toBeTruthy();
    expect(screen.queryByTestId("intraday-chart")).toBeNull();
  });

  it("offers Retry when Alpaca didn't answer, and draws once it does", async () => {
    stub([answer({ error: "unreachable", message: "Alpaca didn't answer. Try again." }, 502), answer(OK)]);
    renderCharts();
    expect(await screen.findByText("Alpaca didn't answer. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
  });

  it("notes that today's bars run 15 minutes behind", async () => {
    stub([answer({ ...OK, partial: true })]);
    renderCharts();
    expect(await screen.findByText("Alpaca's free data runs 15 minutes behind.")).toBeTruthy();
  });

  it("remembers a switch to 5m", async () => {
    stub([answer(OK)]);
    renderCharts();
    fireEvent.click(await screen.findByRole("button", { name: "5m" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("tj.chart") ?? "{}").minutes).toBe(5));
    expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("true");
  });
});
