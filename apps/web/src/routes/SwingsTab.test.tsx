import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { SwingsTab } from "./SwingsTab.js";

const leg = (strike: number, quantity: number, openPrice: number, closePrice: number) => ({
  id: `${strike}`,
  right: "C",
  strike,
  expiry: "2026-11-06",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice,
});
const trade = (id: string, open: string, close: string, netPnl: number, legs: unknown[]) =>
  ({
    id,
    strategy: "swing",
    book: "paper",
    underlying: "NVDA",
    openedAt: nyWallClock(open, 615),
    closedAt: nyWallClock(close, 660),
    netPnl,
    fees: 2,
    setupId: null,
    grade: null,
    tagIds: [],
    ironFly: null,
    risk: null,
    excluded: false,
    legs,
  }) as unknown as TradeView;
const TRADES = [
  trade("w1", "2026-10-02", "2026-10-09", 402.1, [leg(230, 1, 5.1, 9), leg(240, -1, 1.3, 1.15)]),
  trade("w2", "2026-10-05", "2026-10-06", 200, [leg(230, 2, 4, 5)]),
  // A scalp in the same list is left out.
  { ...trade("s1", "2026-10-05", "2026-10-05", 50, [leg(230, 1, 1, 1.5)]), strategy: "scalp" } as TradeView,
];

function show(onSearch = vi.fn(), search = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SwingsTab trades={TRADES} search={{ tab: "swings", ...search }} onSearch={onSearch} />
    </QueryClientProvider>,
  );
  return onSearch;
}

afterEach(() => vi.unstubAllGlobals());

describe("SwingsTab (swing spec §6.3)", () => {
  it("sums up the closed swings only", () => {
    show();
    expect(screen.getByTestId("kpi-swings").textContent).toContain("2");
    expect(screen.getByTestId("kpi-avg-held").textContent).toContain("4.0 days");
    expect(screen.getByTestId("kpi-avg-of-max").textContent).toContain("65%");
    expect(screen.getByTestId("kpi-avg-of-max").textContent).toContain("1 of 2 are spreads");
  });

  it("breaks down by structure first, without an R column, and asks for another dimension", () => {
    const onSearch = show();
    const table = screen.getByRole("table", { name: "By Structure" });
    expect(within(table).getByText("Long call")).toBeTruthy();
    expect(within(table).getByText("Call debit spread")).toBeTruthy();
    expect(within(table).queryByText("Avg R")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Days held" }));
    expect(onSearch).toHaveBeenCalledWith({ sby: "held" });
  });

  it("opens on the dimension in the URL", () => {
    show(vi.fn(), { sby: "dte" });
    expect(screen.getByRole("table", { name: "By DTE at open" })).toBeTruthy();
  });
});
