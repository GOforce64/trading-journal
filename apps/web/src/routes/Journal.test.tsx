import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderJournal(onOpenTrade?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Journal onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Journal", () => {
  it("lists trades with P&L and return on risk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([trade])),
    );
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    expect(screen.getByText("+$512.00")).toBeTruthy();
    expect(screen.getByText("+25.50%")).toBeTruthy();
    expect(screen.getByText("IRON FLY")).toBeTruthy();
  });

  it("shows an empty state when there are no trades", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
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
    // Typed parameters so the recorded call arguments can be inspected below.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([trade]));
    vi.stubGlobal("fetch", fetchMock);
    renderJournal();
    await waitFor(() => expect(screen.getByText("XYZ")).toBeTruthy());
    screen.getByRole("button", { name: /paper/i }).click();
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("book=paper"))).toBe(true);
    });
  });

  it("shows the note, truncated, with the full text available on hover", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([trade])),
    );
    renderJournal();
    const note = await screen.findByTestId("note-t1");
    expect(note.textContent).toContain("Crush did the work");
    expect(note.className).toContain("truncate");
    expect(note.getAttribute("title")).toBe(trade.notes);
  });

  it("opens the trade when the row is clicked anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([trade])),
    );
    const onOpenTrade = vi.fn();
    renderJournal(onOpenTrade);
    const row = await screen.findByTestId("row-t1");
    fireEvent.click(row);
    expect(onOpenTrade).toHaveBeenCalledWith("t1");
  });

  it("opens the trade from the keyboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([trade])),
    );
    const onOpenTrade = vi.fn();
    renderJournal(onOpenTrade);
    const row = await screen.findByTestId("row-t1");
    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpenTrade).toHaveBeenCalledWith("t1");
  });
});
