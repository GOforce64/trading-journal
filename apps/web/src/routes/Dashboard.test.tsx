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

  it("steps the calendar a month at a time with its own arrows, leaving the period alone", async () => {
    stubTrades(TRADES);
    const onSearch = vi.fn();
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={onSearch} />);
    expect(await screen.findByText("Calendar · Sep 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("Calendar · Oct 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("Calendar · Aug 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^2026-08-20:/ })).toBeTruthy();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("drops a selected day when the calendar moves to another month or the period changes", async () => {
    stubTrades(TRADES);
    const { rerender } = renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /^2026-09-03:/ }));
    expect(screen.getByRole("list", { name: "Trades closed 2026-09-03" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.queryByRole("list", { name: "Trades closed 2026-09-03" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: /^2026-09-03:/ }));
    rerender(<Dashboard search={{ period: "year", at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Trades closed 2026-09-03" })).toBeNull());
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

  it("lists the oldest scalps waiting for review, with what each lacks, and starts on the first", async () => {
    const scalps = Array.from({ length: 6 }, (_, index) => ({
      ...tradeRow({
        id: `s${index}`,
        underlying: "NVDA",
        opened: `2026-09-28 09:3${index}`,
        closed: `2026-09-28 09:4${index}`,
        netPnl: 10 + index,
        strategy: "scalp",
      }),
      review: { status: "pending", missing: ["setup", "stop"] },
    }));
    stubTrades(TRADES, scalps);
    const onOpenTrade = vi.fn();
    renderWithClient(
      <Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} onOpenTrade={onOpenTrade} />,
    );
    const section = await screen.findByRole("region", { name: "To review · 6" });
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]?.textContent).toContain("NVDA 10C");
    expect(rows[0]?.textContent).toContain("setup, stop");
    fireEvent.click(within(section).getByRole("button", { name: "Start reviewing →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("s0");
  });

  it("shows no To review section when nothing waits", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(screen.queryByRole("region", { name: /To review/ })).toBeNull();
  });

  it("shows Avg R over the period's scalps that have one, leaving excluded ones out", async () => {
    stubTrades([
      tradeRow({
        id: "s1",
        underlying: "NVDA",
        strategy: "scalp",
        opened: "2026-09-28 09:31",
        closed: "2026-09-28 09:46",
        netPnl: 44.74,
        r: 0.43,
      }),
      tradeRow({
        id: "s2",
        underlying: "NVDA",
        strategy: "scalp",
        opened: "2026-09-29 09:40",
        closed: "2026-09-29 09:50",
        netPnl: -100,
        r: -1.07,
      }),
      tradeRow({
        id: "s3",
        underlying: "AMD",
        strategy: "scalp",
        opened: "2026-09-29 10:00",
        closed: "2026-09-29 10:10",
        netPnl: 20,
        r: 5,
        excluded: true,
      }),
      tradeRow({
        id: "a",
        underlying: "AA",
        opened: "2026-09-02 15:45",
        closed: "2026-09-03 09:50",
        netPnl: 100,
      }),
    ]);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("avg-r")).toBe("Avg R−0.32Rover 2 scalps"));
  });

  it("reads — for Avg R when nothing in the period has an R", async () => {
    stubTrades(TRADES);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(kpi("avg-r")).toBe("Avg R—");
  });
});

describe("Dashboard and missed trades", () => {
  it("leaves missed trades out of every number and the open trades", async () => {
    const skipped = {
      ...tradeRow({ id: "m", underlying: "MM", opened: "2026-09-10 09:41", closed: null, netPnl: null }),
      strategy: "scalp",
      book: "missed",
      legs: [],
      missedRisk: { risk: 1, r: null, plannedRR: null, mae: null, mfe: null, problem: "no_exit" },
    };
    stubTrades([...TRADES, skipped]);
    renderWithClient(<Dashboard search={{ at: "2026-09-15" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$260.00"));
    expect(kpi("trades")).toContain("3");
    expect(screen.queryByText("MM")).toBeNull();
  });
});
