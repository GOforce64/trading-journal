import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Swings } from "./Swings.js";

const swing = {
  id: "w1",
  strategy: "swing",
  chosenStrategy: null,
  book: "paper",
  underlying: "NVDA",
  structureLabel: "Call debit spread",
  openedAt: Date.UTC(2026, 9, 2, 14, 15),
  closedAt: Date.UTC(2026, 9, 9, 15, 0),
  netPnl: 402.1,
  fees: 2.9,
  notes: null,
  grade: null,
  excluded: false,
  setupId: null,
  tagIds: [],
  risk: null,
  missedRisk: null,
  review: null,
  legs: [
    {
      id: "a",
      right: "C",
      strike: 230,
      expiry: "2026-11-06",
      quantity: 1,
      multiplier: 100,
      openPrice: 5.1,
      closePrice: 9,
    },
    {
      id: "b",
      right: "C",
      strike: 240,
      expiry: "2026-11-06",
      quantity: -1,
      multiplier: 100,
      openPrice: 1.3,
      closePrice: 1.15,
    },
  ],
};

function show(trades: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/api/trades") ? trades : [];
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Swings />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Swings", () => {
  it("lists the swings with their chip and return on debit", async () => {
    const fetchMock = show([swing]);
    expect(await screen.findByText("SWING")).toBeTruthy();
    expect(screen.getByText("Return")).toBeTruthy();
    expect(screen.getByTestId("pct-w1").textContent).toBe("+105.82%");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("strategy=swing"))).toBe(true);
  });

  it("says where swings come from when there are none", async () => {
    show([]);
    expect(
      await screen.findByText("Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."),
    ).toBeTruthy();
  });
});
