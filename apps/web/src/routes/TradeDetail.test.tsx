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
    expect(screen.getByText("+$512.00")).toBeTruthy();
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

  it("keeps legs collapsed until the expander is opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText(/legs \(2\)/i)).toBeTruthy());
    expect(screen.getByTestId("legs-details").hasAttribute("open")).toBe(false);
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
