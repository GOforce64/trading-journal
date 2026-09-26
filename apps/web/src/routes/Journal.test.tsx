import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Journal } from "./Journal.js";

const trade = {
  id: "t1",
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  grade: "B",
  notes: "Crush did the work; the short put was the loser. Next time hold into the open.",
  excluded: false,
  legs: [],
  ironFly: null,
  tagIds: [],
  metrics: { maxLoss: 2008, returnOnRisk: 0.255, pctOfMaxProfit: 0.4295, pnlPctOfCost: 0.4295 },
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

interface StubbedApi {
  trades?: unknown[];
  /** Live prices by symbol, or an HTTP status for a failed call. */
  quotes?: Record<string, { price: number; at: number }> | number;
  /** Bid and ask by contract code. */
  optionQuotes?: Record<string, { bid: number | null; ask: number | null; at: number }>;
  /** Whether a market data key is set up. */
  marketOn?: boolean;
}

/** Answers the calls the journal makes: its trades, live prices, and option quotes for open trades. */
function stubApi({ trades = [trade], quotes = {}, optionQuotes = {}, marketOn = true }: StubbedApi = {}) {
  // Typed parameters so the recorded call arguments can be inspected.
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/option-quotes"))
      return jsonResponse({ quotes: optionQuotes, available: marketOn });
    if (!url.includes("/api/quotes")) return jsonResponse(trades);
    return typeof quotes === "number" ? new Response("down", { status: quotes }) : jsonResponse({ quotes });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const urlsFor = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes(path));
const quoteUrls = (fetchMock: ReturnType<typeof stubApi>) => urlsFor(fetchMock, "/api/quotes");
const optionQuoteUrls = (fetchMock: ReturnType<typeof stubApi>) => urlsFor(fetchMock, "/api/option-quotes");

const openLeg = (id: string, right: "C" | "P", strike: number, quantity: number, openPrice: number) => ({
  id,
  right,
  strike,
  expiry: "2099-10-02", // far ahead, so the trade is open whenever the test runs
  quantity,
  multiplier: 100,
  openPrice,
  closePrice: null,
});

/** The open M fly from the design mockup: 3 lots, body 22.5, wings 20 / 26, $7.80 entry fees. */
const openTrade = {
  ...trade,
  id: "t2",
  underlying: "M",
  closedAt: null,
  netPnl: null,
  fees: 7.8,
  feesOpen: 7.8,
  feesClose: 0,
  metrics: null,
  legs: [
    openLeg("l1", "C", 22.5, -3, 0.52),
    openLeg("l2", "P", 22.5, -3, 0.41),
    openLeg("l3", "C", 26, 3, 0.05),
    openLeg("l4", "P", 20, 3, 0.03),
  ],
};

const QUOTED = Date.UTC(2026, 8, 25, 19, 59, 51);
const markQuotes = {
  M991002C00022500: { bid: 0.44, ask: 0.58, at: QUOTED },
  M991002P00022500: { bid: 0.31, ask: 0.42, at: QUOTED },
  M991002C00026000: { bid: 0.01, ask: 0.06, at: QUOTED },
  M991002P00020000: { bid: 0.01, ask: 0.05, at: QUOTED },
};

function renderJournal(onOpenTrade?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Journal onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Journal", () => {
  it("lists trades with P&L and return on risk", async () => {
    stubApi();
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    expect(screen.getByText("+$512.00")).toBeTruthy();
    expect(screen.getByText("+25.50%")).toBeTruthy();
    expect(screen.getByText("IRON FLY")).toBeTruthy();
  });

  it("shows an empty state when there are no trades", async () => {
    stubApi({ trades: [] });
    renderJournal();
    await waitFor(() => expect(screen.getByText(/no trades yet/i)).toBeTruthy());
  });

  it("reports a failed load instead of showing an empty journal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    renderJournal();
    await waitFor(() => expect(screen.getByText(/could not load trades/i)).toBeTruthy());
  });

  it("asks the API for one book when a book filter is pressed", async () => {
    const fetchMock = stubApi();
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    screen.getByRole("button", { name: /paper/i }).click();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("book=paper"))).toBe(true);
    });
  });

  it("shows the note, truncated, with the full text available on hover", async () => {
    stubApi();
    renderJournal();
    const note = await screen.findByTestId("note-t1");
    expect(note.textContent).toContain("Crush did the work");
    expect(note.className).toContain("truncate");
    expect(note.getAttribute("title")).toBe(trade.notes);
  });

  it("opens the trade when the row is clicked anywhere", async () => {
    stubApi();
    const onOpenTrade = vi.fn();
    renderJournal(onOpenTrade);
    const row = await screen.findByTestId("row-t1");
    fireEvent.click(row);
    expect(onOpenTrade).toHaveBeenCalledWith("t1");
  });

  it("opens the trade from the keyboard", async () => {
    stubApi();
    const onOpenTrade = vi.fn();
    renderJournal(onOpenTrade);
    const row = await screen.findByTestId("row-t1");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpenTrade).toHaveBeenCalledWith("t1");
  });

  it("shows each symbol's live price beside it, with the trade time on hover", async () => {
    stubApi({
      trades: [trade, { ...trade, id: "t2", underlying: "ABC" }],
      quotes: { XYZ: { price: 22.68, at: Date.UTC(2026, 8, 24, 19, 58, 31) } },
    });
    renderJournal();
    const price = await within(await screen.findByTestId("row-t1")).findByText("22.68");
    expect(price.getAttribute("title")).toContain("Sep 24, 03:58 PM ET");
    expect(within(screen.getByTestId("row-t2")).queryByTestId("price-t2")).toBeNull();
  });

  it("asks for each symbol's price once", async () => {
    const fetchMock = stubApi({
      trades: [trade, { ...trade, id: "t2", underlying: "ABC" }, { ...trade, id: "t3" }],
    });
    renderJournal();
    await waitFor(() => expect(quoteUrls(fetchMock)).toHaveLength(1));
    const url = new URL(quoteUrls(fetchMock)[0] ?? "", "http://localhost");
    expect(url.searchParams.get("symbols")?.split(",").sort()).toEqual(["ABC", "XYZ"]);
  });

  it("lists trades as usual when live prices are unavailable", async () => {
    const fetchMock = stubApi({ quotes: 500 });
    renderJournal();
    await waitFor(() => expect(quoteUrls(fetchMock)).toHaveLength(1));
    // Let the failed answer land before looking.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("XYZ")).toBeTruthy();
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it("refreshes the prices every minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const at = Date.UTC(2026, 8, 24, 19, 58, 31);
    const quotes = { XYZ: { price: 22.68, at } };
    stubApi({ quotes });
    renderJournal();
    await screen.findByText("22.68");
    quotes.XYZ = { price: 23.1, at: at + 60_000 };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await screen.findByText("23.10")).toBeTruthy();
  });

  it("shows an open trade's estimated cost to close, muted, with when and how on hover", async () => {
    stubApi({ trades: [trade, openTrade], optionQuotes: markQuotes });
    renderJournal();
    const estimate = await screen.findByText("est -$46.80");
    expect(estimate.className).toContain("italic");
    expect(estimate.className).not.toMatch(/text-(up|down)/);
    expect(estimate.getAttribute("title")).toContain("Sep 25, 03:59 PM ET");
    expect(estimate.getAttribute("title")).toContain("Not saved");
    // The closed trade keeps its real P&L.
    expect(screen.getByText("+$512.00")).toBeTruthy();
  });

  it("asks once for the open legs of open trades only", async () => {
    const fetchMock = stubApi({ trades: [trade, openTrade], optionQuotes: markQuotes });
    renderJournal();
    await screen.findByText("est -$46.80");
    expect(optionQuoteUrls(fetchMock)).toHaveLength(1);
    const url = new URL(optionQuoteUrls(fetchMock)[0] ?? "", "http://localhost");
    expect(url.searchParams.get("contracts")?.split(",").sort()).toEqual(Object.keys(markQuotes).sort());
  });

  it("flags an open trade past its expiry instead of estimating it", async () => {
    const expired = { ...openTrade, legs: openTrade.legs.map((leg) => ({ ...leg, expiry: "2020-01-17" })) };
    const fetchMock = stubApi({ trades: [expired] });
    renderJournal();
    expect(await screen.findByText("EXPIRED · add exits")).toBeTruthy();
    expect(optionQuoteUrls(fetchMock)).toHaveLength(0);
  });

  it("shows a dash, with the reason on hover, when an open trade has no quotes", async () => {
    const fetchMock = stubApi({ trades: [openTrade] });
    renderJournal();
    await waitFor(() => expect(optionQuoteUrls(fetchMock)).toHaveLength(1));
    const cell = await screen.findByTestId("est-t2");
    expect(cell.textContent).toBe("—");
    expect(cell.getAttribute("title")).toBe("No estimate: no quote for the short call.");
  });

  it("shows a plain dash for an open trade without a market data key", async () => {
    const fetchMock = stubApi({ trades: [openTrade], marketOn: false });
    renderJournal();
    await waitFor(() => expect(optionQuoteUrls(fetchMock)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cell = screen.getByTestId("est-t2");
    expect(cell.textContent).toBe("—");
    expect(cell.getAttribute("title")).toBeNull();
  });
});
