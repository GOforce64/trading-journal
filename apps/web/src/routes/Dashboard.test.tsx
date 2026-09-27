import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { Dashboard } from "./Dashboard.js";

// The canvas chart can't draw in jsdom; this stand-in shows the data the page hands it.
vi.mock("../analytics/EquityCurve.js", () => ({
  EquityCurve: ({ points }: { points: { equity: number }[] }) => (
    <div data-testid="equity-curve">
      {points.length} points, ends {points.at(-1)?.equity ?? "—"}
    </div>
  ),
}));

/*
 * September 2026: AA +100 (Sep 3), BB −40 (Sep 4), CC +200 (Sep 8) → net +260, 2 of 3 won, PF 300 / 40 = 7.50,
 * expectancy +86.67, equity 100, 60, 260, so max drawdown −40. DD +50 closed in August. XX is excluded.
 * EE is open, and its legs expired on Sep 25.
 */
const TRADES = [
  tradeRow({
    id: "a",
    underlying: "AA",
    opened: "2026-09-02 15:45",
    closed: "2026-09-03 09:50",
    netPnl: 100,
  }),
  tradeRow({
    id: "b",
    underlying: "BB",
    opened: "2026-09-03 15:50",
    closed: "2026-09-04 15:40",
    netPnl: -40,
  }),
  tradeRow({
    id: "c",
    underlying: "CC",
    opened: "2026-09-04 15:30",
    closed: "2026-09-08 09:45",
    netPnl: 200,
  }),
  tradeRow({ id: "d", underlying: "DD", opened: "2026-08-19 15:50", closed: "2026-08-20 09:50", netPnl: 50 }),
  tradeRow({
    id: "x",
    underlying: "XX",
    opened: "2026-09-09 15:50",
    closed: "2026-09-10 09:50",
    netPnl: 999,
    excluded: true,
  }),
  tradeRow({
    id: "e",
    underlying: "EE",
    opened: "2026-09-23 15:50",
    closed: null,
    netPnl: null,
    expiry: "2026-09-25",
  }),
];

afterEach(() => vi.unstubAllGlobals());

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

describe("Dashboard", () => {
  it("shows the month's numbers from the trades closed in it, excluded ones left out", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(kpi("win-rate")).toContain("66.7%");
    expect(kpi("profit-factor")).toContain("7.50");
    expect(kpi("expectancy")).toContain("+$86.67");
    expect(kpi("trades")).toContain("3");
    expect(kpi("max-drawdown")).toContain("-$40.00");
    expect(screen.getByTestId("equity-curve").textContent).toBe("3 points, ends 260");
  });

  it("switches and steps the period", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={onSearch} />);
    await waitFor(() => expect(screen.getByText("September 2026")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(onSearch).toHaveBeenLastCalledWith({ period: "year", at: "2026-09-15" });
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
    expect(onSearch).toHaveBeenLastCalledWith({ at: "2026-08-01" });
    rerender(<Dashboard search={{ at: "2026-08-01" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("+$50.00"));
  });

  it("lists a calendar day's trades, each opening its trade page", async () => {
    stubTrades(TRADES);
    const onOpenTrade = vi.fn();
    renderWithClient(
      <Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} onOpenTrade={onOpenTrade} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^2026-09-03:/ }));
    const list = within(screen.getByRole("list", { name: "Trades closed 2026-09-03" }));
    fireEvent.click(list.getByRole("button", { name: "AA" }));
    expect(onOpenTrade).toHaveBeenCalledWith("a");
  });

  it("shows every open trade, flagging one past its expiry", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    const open = within(await screen.findByRole("region", { name: "Open" }));
    await waitFor(() => expect(open.getByText("EXPIRED · add exits")).toBeTruthy());
    expect(open.getByText("EE")).toBeTruthy();
  });

  it("says when the period has nothing closed", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-06-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("trades")).toContain("0"));
    expect(kpi("net")).toContain("—");
    expect(
      within(screen.getByRole("region", { name: "Recent" })).getByText("No closed trades in this range."),
    ).toBeTruthy();
  });
});
