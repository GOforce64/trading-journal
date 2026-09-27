import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presetRange } from "../analytics/search.js";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { todayNy } from "../market.js";
import { Analytics } from "./Analytics.js";

// Charts can't draw in jsdom; these stand-ins show the data the page hands them.
vi.mock("../analytics/EquityCurve.js", () => ({
  EquityCurve: ({ points }: { points: { equity: number }[] }) => (
    <div data-testid="equity-curve">
      {points.length} points, ends {points.at(-1)?.equity ?? "—"}
    </div>
  ),
}));
vi.mock("../analytics/Charts.js", () => ({
  MonthBars: ({ months }: { months: { month: string; net: number }[] }) => (
    <div data-testid="month-bars">{months.map((month) => `${month.month} ${month.net}`).join("; ")}</div>
  ),
  RollingLine: ({ points }: { points: unknown[] }) => <div data-testid="rolling-line">{points.length}</div>,
}));

/*
 * AA +100 (paper, fees 4), BB −300 (paper, fees 6), CC +280 (live, fees 2): net +80, 2 of 3 won, PF 380 / 300 = 1.27.
 * XX +999 is excluded.
 */
const TRADES = [
  tradeRow({
    id: "a",
    underlying: "AA",
    opened: "2026-09-02 15:45",
    closed: "2026-09-03 09:50",
    netPnl: 100,
    fees: 4,
  }),
  tradeRow({
    id: "b",
    underlying: "BB",
    opened: "2026-09-03 15:50",
    closed: "2026-09-04 15:40",
    netPnl: -300,
    fees: 6,
    contracts: 2,
    creditPerShare: 1.53,
  }),
  tradeRow({
    id: "c",
    underlying: "CC",
    opened: "2026-09-04 15:30",
    closed: "2026-09-08 09:45",
    netPnl: 280,
    fees: 2,
    contracts: 3,
    creditPerShare: 1.34,
    book: "live",
  }),
  tradeRow({
    id: "x",
    underlying: "XX",
    opened: "2026-09-09 15:50",
    closed: "2026-09-10 09:50",
    netPnl: 999,
    excluded: true,
  }),
];

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Analytics filters", () => {
  it("shows the headline numbers for the trades the filter keeps", async () => {
    stubTrades(TRADES);
    renderWithClient(<Analytics search={{}} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$80.00"));
    expect(kpi("win-rate")).toContain("66.7%");
    expect(kpi("profit-factor")).toContain("1.27");
    expect(kpi("trades")).toContain("3");
  });

  it("narrows to one book when the other is switched off", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Live" }));
    expect(onSearch).toHaveBeenCalledWith({ books: "paper" });
    rerender(<Analytics search={{ books: "paper" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("-$200.00"));
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("includes excluded trades when asked", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByLabelText("Include excluded"));
    expect(onSearch).toHaveBeenCalledWith({ excluded: true });
    rerender(<Analytics search={{ excluded: true }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("trades")).toContain("4"));
  });

  it("picks a date preset, and shows a custom range in date fields", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.change(await screen.findByLabelText("Dates"), { target: { value: "last-month" } });
    expect(onSearch).toHaveBeenCalledWith(presetRange("last-month", todayNy()));
    rerender(<Analytics search={{ from: "2026-09-04", to: "2026-09-08" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("-$20.00"));
    expect((screen.getByLabelText("Dates") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-09-04");
  });

  it("filters to one ticker", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    // The Ticker split panel is labelled "Ticker" too, so ask for the filter by its role.
    fireEvent.change(await screen.findByRole("combobox", { name: "Ticker" }), { target: { value: "CC" } });
    expect(onSearch).toHaveBeenCalledWith({ ticker: "CC" });
  });
});

describe("Analytics Overview", () => {
  it("shows where the money goes, with the largest losses", async () => {
    stubTrades(TRADES);
    const onOpenTrade = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={() => {}} onOpenTrade={onOpenTrade} />);
    const money = within(await screen.findByRole("region", { name: "Where the money goes" }));
    expect(money.getByText("Before fees").nextSibling?.nextSibling?.textContent).toBe("+$92.00");
    expect(money.getByText("Fees").nextSibling?.nextSibling?.textContent).toBe("-$12.00");
    fireEvent.click(money.getByRole("button", { name: "BB" }));
    expect(onOpenTrade).toHaveBeenCalledWith("b");
    expect(money.getByText("kept −100%")).toBeTruthy();
  });

  it("hands the charts their data", async () => {
    stubTrades(TRADES);
    renderWithClient(<Analytics search={{}} onSearch={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("equity-curve").textContent).toBe("3 points, ends 80"));
    expect(screen.getByTestId("month-bars").textContent).toBe("2026-09 80");
    expect(screen.getByText("Needs 10 trades.")).toBeTruthy();
  });

  it("shows every split, and saves new contract edges to the URL and this browser", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    for (const title of ["Weekday opened", "Days to expiry", "Contracts", "Hold time", "Month", "Ticker"]) {
      expect(await screen.findByRole("region", { name: title })).toBeTruthy();
    }
    const contracts = within(screen.getByRole("region", { name: "Contracts" }));
    fireEvent.click(contracts.getByRole("button", { name: "edit" }));
    fireEvent.change(contracts.getByLabelText("Contracts edges"), { target: { value: "3" } });
    fireEvent.click(contracts.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ contractEdges: "3" });
    expect(localStorage.getItem("tj.edges.contracts")).toBe("3");
  });
});
