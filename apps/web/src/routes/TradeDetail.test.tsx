import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "./TradeDetail.js";

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
  notes: "crush paid",
  grade: null,
  excluded: false,
  excludeReason: null,
  tagIds: [],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    impliedMovePct: null,
    actualMovePct: null,
    ivBefore: null,
    ivAfter: null,
    sourceNotes: null,
  },
  legs: [
    {
      id: "l1",
      right: "C",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 2.1,
      closePrice: 1,
    },
    {
      id: "l2",
      right: "P",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 1.6,
      closePrice: 0.8,
    },
    {
      id: "l3",
      right: "C",
      strike: 58,
      expiry: "2026-10-16",
      quantity: 4,
      multiplier: 100,
      openPrice: 0.35,
      closePrice: 0.05,
    },
    {
      id: "l4",
      right: "P",
      strike: 45,
      expiry: "2026-10-16",
      quantity: 4,
      multiplier: 100,
      openPrice: 0.35,
      closePrice: 0.05,
    },
  ],
  metrics: {
    putWingWidth: 5,
    callWingWidth: 8,
    isBrokenWing: true,
    maxProfit: 1192,
    putSideRisk: 808,
    callSideRisk: 2008,
    maxLoss: 2008,
    riskySide: "call",
    breakevenLow: 47.02,
    breakevenHigh: 52.98,
    returnOnRisk: 0.255,
    pctOfMaxProfit: 0.4295,
    pnlPctOfCost: 0.4295,
  },
};

const jsonResponse = () =>
  new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } });

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TradeDetail tradeId="t1" />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("TradeDetail", () => {
  it("shows the headline metrics and marks the broken wing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText("XYZ Industries")).toBeTruthy());
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("2,008.00");
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("call side");
    expect(screen.getByTestId("tile-structure").textContent).toContain("broken");
    expect(screen.getByTestId("tile-breakevens").textContent).toContain("47.02");
    // Net P&L shows in the header and again in the legs total.
    expect(screen.getAllByText("+$512.00").length).toBeGreaterThan(0);
  });

  it("marks fields the source did not provide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-implied-move")).toBeTruthy());
    expect(screen.getByTestId("tile-implied-move").textContent).toContain("add");
  });

  it("shows every leg straight away, no expander", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getAllByTestId(/^leg-row-/)).toHaveLength(4));
    expect(screen.queryByTestId("legs-details")).toBeNull();
  });

  it("totals the legs in bold above the table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    const totals = await screen.findByTestId("legs-total");
    expect(totals.textContent).toContain("1,200.00"); // cost: credit received
    expect(totals.textContent).toContain("520.00"); // P&L before fees
    expect(totals.textContent).toContain("8.00"); // fees
    expect(totals.textContent).toContain("512.00"); // net
    expect(totals.className).toContain("font-semibold");
  });

  it("shows each leg's own cost and P&L", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    const shortCall = await screen.findByTestId("leg-row-l1");
    expect(shortCall.textContent).toContain("840.00"); // 4 x 100 x 2.10 credit
    expect(shortCall.textContent).toContain("440.00"); // bought back at 1.00
  });

  it("patches the grade when a grade button is pressed", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: "B" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body)).grade).toBe("B");
    });
  });

  it("patches the exclude flag", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();
    await waitFor(() => expect(screen.getByLabelText(/exclude from stats/i)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/exclude from stats/i));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
      expect(JSON.parse(String(patch?.[1]?.body)).excluded).toBe(true);
    });
  });
});
