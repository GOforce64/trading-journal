import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nyWallClock, type PriceBar } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeCharts } from "./TradeCharts.js";
import { resetLibrary } from "./testing.js";

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

function renderCharts(trade = TRADE) {
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
  it("asks for the week before the trade through its last day, and the daily bars up to that day", async () => {
    const fetchMock = stub([answer(OK)]);
    renderCharts();
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA?from=2026-09-21&to=2026-09-28"));
    expect(urls).toContainEqual(expect.stringContaining("/api/bars/NVDA/daily?to=2026-09-28"));
    expect(screen.getByRole("button", { name: "3m" }).getAttribute("aria-pressed")).toBe("true");
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
