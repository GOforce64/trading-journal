import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterTrades, type TradeFilter, useAllTrades } from "./data.js";
import { ny } from "./testing.js";

const trade = (
  overrides: Partial<{
    book: string;
    underlying: string;
    setupId: string | null;
    closedAt: number | null;
    excluded: boolean;
  }>,
) => ({
  book: "paper",
  underlying: "AA",
  setupId: null,
  closedAt: ny("2026-09-10 10:00"),
  excluded: false,
  ...overrides,
});
const ALL: TradeFilter = { books: ["live", "paper"], includeExcluded: false };

afterEach(() => vi.unstubAllGlobals());

describe("filterTrades", () => {
  it("keeps the chosen books and ticker", () => {
    const trades = [
      trade({ book: "live" }),
      trade({ book: "paper", underlying: "BB" }),
      trade({ book: "missed" }),
    ];
    expect(filterTrades(trades, ALL)).toHaveLength(2);
    expect(filterTrades(trades, { ...ALL, books: ["paper"] }).map((t) => t.underlying)).toEqual(["BB"]);
    expect(filterTrades(trades, { ...ALL, ticker: "BB" })).toHaveLength(1);
  });

  it("keeps one setup's trades", () => {
    const trades = [trade({ setupId: "orb" }), trade({ setupId: "vwap" }), trade({})];
    expect(filterTrades(trades, { ...ALL, setup: "orb" })).toEqual([trades[0]]);
  });

  it("drops excluded trades unless asked for them", () => {
    const trades = [trade({}), trade({ excluded: true })];
    expect(filterTrades(trades, ALL)).toHaveLength(1);
    expect(filterTrades(trades, { ...ALL, includeExcluded: true })).toHaveLength(2);
  });

  it("uses the New York close date, inclusive at both ends", () => {
    const late = trade({ closedAt: ny("2026-09-30 23:30") }); // Oct 1 in UTC
    expect(filterTrades([late], { ...ALL, from: "2026-09-01", to: "2026-09-30" })).toHaveLength(1);
    expect(filterTrades([late], { ...ALL, from: "2026-10-01" })).toHaveLength(0);
  });

  it("drops open trades only when a date range is set", () => {
    const open = trade({ closedAt: null });
    expect(filterTrades([open], ALL)).toHaveLength(1);
    expect(filterTrades([open], { ...ALL, to: "2026-12-31" })).toHaveLength(0);
  });
});

describe("useAllTrades", () => {
  it("asks the server for every trade, excluded ones too", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("[]", { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAllTrades(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.searchParams.get("all")).toBe("true");
    expect(url.searchParams.get("includeExcluded")).toBe("true");
  });
});
