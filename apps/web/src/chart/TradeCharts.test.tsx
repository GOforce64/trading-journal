import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addDays, nyWallClock, type PriceBar } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayNy } from "../market.js";
import { TradeCharts } from "./TradeCharts.js";
import { library, resetLibrary, seriesOf } from "./testing.js";

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
        placing: "t2",
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
    expect(screen.getByTestId("placing-hint").textContent).toContain("place T2 · Esc");
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

  it("says why the daily chart is missing, with Retry, instead of a one-candle chart from minute bars", async () => {
    const fetchMock = stub(
      [answer(OK)],
      answer({ error: "unreachable", message: "Alpaca didn't answer. Try again." }, 502),
    );
    renderCharts();
    expect(await screen.findByText("Couldn't load the daily chart: Alpaca didn't answer.")).toBeTruthy();
    expect(screen.queryByTestId("daily-chart")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry the daily chart" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/daily"))).toHaveLength(2),
    );
  });

  it("keeps a drawn chart when a live refresh fails, saying so above it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.UTC(2026, 8, 29, 18, 0) }); // Tue Sep 29, 14:00 ET
    stub([
      answer({ ...OK, partial: true }),
      answer({ error: "unreachable", message: "Alpaca didn't answer. Try again." }, 502),
    ]);
    renderCharts({ ...TRADE, openedAt: nyWallClock("2026-09-29", 571), closedAt: null });
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      await screen.findByText("Couldn't refresh the chart: Alpaca didn't answer. Trying again in a minute."),
    ).toBeTruthy();
    expect(screen.getByTestId("intraday-chart")).toBeTruthy();
    vi.useRealTimers();
  });

  it("notes that today's bars run 15 minutes behind", async () => {
    stub([answer({ ...OK, partial: true })]);
    renderCharts();
    expect(await screen.findByText("Alpaca's free data runs 15 minutes behind.")).toBeTruthy();
  });

  it("doesn't refresh an open trade's chart every minute on a weekend", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.UTC(2026, 9, 3, 18, 0) }); // Sat Oct 3, 14:00 ET
    const fetchMock = stub([answer(OK)]);
    renderCharts({ ...TRADE, openedAt: nyWallClock("2026-10-02", 571), closedAt: null });
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const minuteCalls = () =>
      fetchMock.mock.calls.filter((call) => !String(call[0]).includes("/daily")).length;
    expect(minuteCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(minuteCalls()).toBe(1);
    vi.useRealTimers();
  });

  it("fetches today's bars once more after 20:16, so a partial answer doesn't stay for good", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: Date.UTC(2026, 8, 30, 0, 20) }); // Tue Sep 29, 20:20 ET
    const fetchMock = stub([answer({ ...OK, partial: true }), answer(OK)]);
    renderCharts({
      ...TRADE,
      openedAt: nyWallClock("2026-09-29", 571),
      closedAt: nyWallClock("2026-09-29", 586),
    });
    expect(await screen.findByText("Alpaca's free data runs 15 minutes behind.")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(screen.queryByText("Alpaca's free data runs 15 minutes behind.")).toBeNull());
    const minuteCalls = fetchMock.mock.calls.filter((call) => !String(call[0]).includes("/daily")).length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock.mock.calls.filter((call) => !String(call[0]).includes("/daily")).length).toBe(
      minuteCalls,
    );
    vi.useRealTimers();
  });

  it("remembers a switch to 5m", async () => {
    stub([answer(OK)]);
    renderCharts();
    fireEvent.click(await screen.findByRole("button", { name: "5m" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("tj.chart") ?? "{}").minutes).toBe(5));
    expect(screen.getByRole("button", { name: "5m" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("TradeCharts' option view", () => {
  const CONTRACT = "NVDA260926C00232500";
  const NAME = "NVDA 232.5C Sep 26";
  const OPTION_BARS: PriceBar[] = [
    { t: nyWallClock(DAY, 571), o: 0.97, h: 1.53, l: 0.97, c: 1.1, v: 50 },
    { t: nyWallClock(DAY, 586), o: 1.1, h: 1.32, l: 0.64, c: 1.29, v: 30 },
  ];
  const OPTION_OK = {
    contract: CONTRACT,
    bars: OPTION_BARS,
    partial: false,
    delayMinutes: 16,
    unavailable: null,
  };
  const EMPTY = { ...OPTION_OK, bars: [] };

  /** Answers the stock's bars, and the contract's from `option` (one per call, the last repeating). */
  function stubOption(option: (() => Promise<Response>)[]) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bars/option/")) {
        const next = option.length > 1 ? option.shift() : option[0];
        if (!next) throw new Error("no reply");
        return next();
      }
      if (url.includes("/daily")) return answer({ ...OK, bars: [] });
      return answer(OK);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const reply =
    (body: Record<string, unknown>, status = 200) =>
    async () =>
      answer(body, status);

  function renderOption(view: "stock" | "option", trade: Parameters<typeof TradeCharts>[0]["trade"] = TRADE) {
    const onView = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TradeCharts trade={trade} option={{ contract: CONTRACT, name: NAME, view, onView }} />
      </QueryClientProvider>,
    );
    return onView;
  }
  // Any chart's candles: the daily chart has a candle series too.
  const optionCandles = () =>
    seriesOf("Candlestick").some((series) =>
      (series.data as { open?: number }[]).some((bar) => bar.open === 0.97),
    );

  it("offers the switch on a scalp, and asks for the contract's bars over the stock's days", async () => {
    const fetchMock = stubOption([reply(OPTION_OK)]);
    const onView = renderOption("stock");
    fireEvent.click(await screen.findByRole("button", { name: "Option" }));
    expect(onView).toHaveBeenCalledWith("option");
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContainEqual(
        expect.stringContaining(`/api/bars/option/${CONTRACT}?from=2026-09-21&to=2026-09-28`),
      ),
    );
    expect(optionCandles()).toBe(false);
  });

  it("draws the contract's candles on the option view", async () => {
    stubOption([reply(OPTION_OK)]);
    renderOption("option");
    await waitFor(() => expect(optionCandles()).toBe(true));
  });

  it("says it's loading, then offers Retry when Alpaca didn't answer, and draws once it does", async () => {
    stubOption([() => new Promise<Response>(() => {})]);
    renderOption("option");
    expect(await screen.findByText("Loading the option chart…")).toBeTruthy();
    cleanup();
    stubOption([reply({ error: "unreachable" }, 502), reply(OPTION_OK)]);
    renderOption("option");
    expect(await screen.findByText("Alpaca didn't answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry the option chart" }));
    await waitFor(() => expect(optionCandles()).toBe(true));
  });

  it("says why there are no option bars: too old, none at all, or not out yet today", async () => {
    stubOption([
      reply({
        ...EMPTY,
        unavailable: { reason: "too_old", message: "Alpaca's option bars start on Jan 18, 2024." },
      }),
    ]);
    renderOption("option");
    expect(await screen.findByText("Alpaca's option bars start on Jan 18, 2024.")).toBeTruthy();
    cleanup();
    stubOption([
      reply({ ...EMPTY, unavailable: { reason: "no_bars", message: `No option bars for ${CONTRACT}.` } }),
    ]);
    renderOption("option");
    expect(await screen.findByText(`No option bars for ${NAME}.`)).toBeTruthy();
    cleanup();
    stubOption([reply({ ...EMPTY, partial: true })]);
    const today = todayNy();
    renderOption("option", { ...TRADE, openedAt: nyWallClock(today, 592) + 40_000, closedAt: null });
    expect(await screen.findByText("This contract's bars from 09:52 arrive by 10:08.")).toBeTruthy();
  });

  it("waits for today's bars when only earlier days' are out, rather than marking the fills on them", async () => {
    const today = todayNy();
    const earlier = OPTION_BARS.map((bar) => ({ ...bar, t: nyWallClock(addDays(today, -1), 600) }));
    stubOption([reply({ ...OPTION_OK, bars: earlier, partial: true })]);
    renderOption("option", { ...TRADE, openedAt: nyWallClock(today, 592) + 40_000, closedAt: null });
    expect(await screen.findByText("This contract's bars from 09:52 arrive by 10:08.")).toBeTruthy();
    expect(optionCandles()).toBe(false);
  });

  it("notes how far behind today's option bars run", async () => {
    stubOption([reply({ ...OPTION_OK, partial: true, delayMinutes: 80 })]);
    renderOption("option");
    expect(await screen.findByText("Alpaca's free option data runs up to 80 minutes behind.")).toBeTruthy();
  });

  it("asks for no option bars on a trade without a contract", async () => {
    const fetchMock = stubOption([reply(OPTION_OK)]);
    renderCharts();
    await screen.findByTestId("intraday-chart");
    expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes("/option/"))).toBe(
      false,
    );
    expect(screen.queryByRole("button", { name: "Option" })).toBeNull();
  });
});

describe("TradeCharts for a missed trade", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderMissed(props: Partial<Parameters<typeof TradeCharts>[0]> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TradeCharts trade={{ ...TRADE, legs: [] }} daily={false} showDay {...props} />
      </QueryClientProvider>,
    );
  }

  it("draws the intraday chart alone, with the Day's trades toggle and whatever the page adds", async () => {
    const fetchMock = stub([answer(OK)]);
    renderMissed({ toolbarExtra: <button type="button">+ Missed</button> });
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/daily"))).toBe(false);
    expect(screen.queryByText("Loading the daily chart…")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Day's trades" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Day's trades" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "+ Missed" })).toBeTruthy();
  });

  it("draws only a missed trade's own points, none of a taken trade's open and close marks", async () => {
    stub([answer(OK)]);
    const point = { id: "entry" as const, t: nyWallClock(DAY, 575), price: 229.1, label: "Entry 229.10" };
    renderMissed({ points: [point] });
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    const drawn = (library.markers.at(-1) ?? []) as { text: string }[];
    expect(drawn.map((marker) => marker.text)).toEqual(["Entry 229.10"]);
  });

  it("says what the page asks when there are no bars", async () => {
    stub([answer({ ...OK, bars: [] })]);
    renderMissed({ emptyText: "No bars for XYZ on Sep 30. Check the ticker." });
    expect(await screen.findByText("No bars for XYZ on Sep 30. Check the ticker.")).toBeTruthy();
  });

  it("leaves the Day's trades toggle off other trades' toolbars", async () => {
    stub([answer(OK)]);
    renderCharts();
    expect(await screen.findByTestId("intraday-chart")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Day's trades" })).toBeNull();
  });
});
