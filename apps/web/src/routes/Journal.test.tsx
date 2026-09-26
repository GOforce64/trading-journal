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
}

/** Answers the two calls the journal makes: its trades, and live prices for their symbols. */
function stubApi({ trades = [trade], quotes = {} }: StubbedApi = {}) {
  // Typed parameters so the recorded call arguments can be inspected.
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (!String(input).includes("/api/quotes")) return jsonResponse(trades);
    return typeof quotes === "number" ? new Response("down", { status: quotes }) : jsonResponse({ quotes });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const quoteUrls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/api/quotes"));

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
});
