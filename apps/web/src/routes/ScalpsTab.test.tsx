import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALP_ROWS, SCALP_SETUPS, SCALP_TAGS } from "../analytics/scalps.fixture.js";
import { renderWithClient, stubTrades } from "../analytics/testing.js";
import { Analytics } from "./Analytics.js";

// Neither chart library can draw in jsdom. The Overview's equity curve is left blank; the bars show the rows and
// the metric the page hands them.
vi.mock("../analytics/EquityCurve.js", () => ({ EquityCurve: () => <div data-testid="equity-curve" /> }));
vi.mock("../analytics/ScalpCharts.js", () => ({
  MetricBars: ({ rows, metric }: { rows: { label: string; trades: number }[]; metric: string }) => (
    <div data-testid="bars">
      {metric}: {rows.map((row) => `${row.label} ${row.trades}`).join("; ")}
    </div>
  ),
}));

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

function renderTab(search = {}, onSearch = vi.fn()) {
  stubTrades(SCALP_ROWS, [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
  const view = renderWithClient(<Analytics search={{ tab: "scalps", ...search }} onSearch={onSearch} />);
  return { ...view, onSearch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Analytics Scalps tab", () => {
  it("opens from the tab row", async () => {
    stubTrades(SCALP_ROWS);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Scalps" }));
    expect(onSearch).toHaveBeenCalledWith({ tab: "scalps" });
  });

  it("shows the scalps' KPIs, leaving the fly out", async () => {
    renderTab();
    await waitFor(() => expect(kpi("net")).toContain("+$10.00"));
    expect(kpi("win-rate")).toContain("40.0%");
    expect(kpi("avg-r")).toBe("Avg R+0.17Rover 3 of 5");
    expect(kpi("avg-return")).toBe("Avg return+4.7%on premium paid");
    expect(kpi("profit-factor")).toContain("1.08");
    expect(kpi("expectancy")).toContain("+$2.00");
    expect(kpi("avg-hold")).toBe("Avg hold14 minmedian 5 min");
    expect(kpi("scalps")).toContain("5");
  });

  it("says which scalps lack R, and why", async () => {
    renderTab();
    expect((await screen.findByTestId("r-coverage")).textContent).toBe(
      "R covers 3 of 5 scalps · 1 has no stop · 1 has no stock price",
    );
  });

  it("hands the time charts every bucket, and switches every bar's metric through the URL", async () => {
    const { onSearch, rerender } = renderTab();
    const open = within(await screen.findByRole("region", { name: "Minutes after the open" }));
    expect(open.getByTestId("bars").textContent).toBe(
      "net: before open 1; 0–5 1; 5–15 1; 15–30 1; 30–60 0; 60+ 1",
    );
    const hold = within(screen.getByRole("region", { name: "Hold time" }));
    expect(hold.getByTestId("bars").textContent).toBe("net: < 1 min 0; 1–3 2; 3–10 1; 10–30 1; 30+ 1");
    fireEvent.click(screen.getByRole("button", { name: "Avg R" }));
    expect(onSearch).toHaveBeenCalledWith({ metric: "r" });
    rerender(<Analytics search={{ tab: "scalps", metric: "r" }} onSearch={onSearch} />);
    await waitFor(() =>
      expect(screen.getAllByTestId("bars").every((bars) => bars.textContent?.startsWith("r:"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Net" }));
    expect(onSearch).toHaveBeenLastCalledWith({ metric: undefined });
  });

  it("breaks down by setup first, then by the dimension picked", async () => {
    const { onSearch, rerender } = renderTab();
    const table = await screen.findByRole("table", { name: "By Setup" });
    await waitFor(() => expect(within(table).getByText("ORB breakout")).toBeTruthy());
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["ORB breakout", "3", "33.3%", "+$50", "+0.17R", "+8.3%", "2.00"],
      ["VWAP reclaim", "1", "100.0%", "+$30", "—", "+10.0%", "∞"],
      ["no setup", "1", "0.0%", "−$70", "—", "−11.7%", "0.00"],
    ]);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Dimension" })).getByRole("button", { name: "Emotion" }),
    );
    expect(onSearch).toHaveBeenCalledWith({ by: "emotion" });
    rerender(<Analytics search={{ tab: "scalps", by: "emotion" }} onSearch={onSearch} />);
    const emotion = await screen.findByRole("table", { name: "By Emotion" });
    expect(within(emotion).getByText("Calm").closest("tr")?.textContent).toContain("+$130");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Dimension" })).getByRole("button", { name: "Setup" }),
    );
    expect(onSearch).toHaveBeenLastCalledWith({ by: undefined });
  });

  it("edits the option-cost edges, saving them to the URL and this browser", async () => {
    const { onSearch } = renderTab({ by: "cost" });
    const table = await screen.findByRole("table", { name: "By Option cost" });
    expect(within(table).getByText("< $250").closest("tr")?.textContent).toContain("+$50");
    const panel = within(screen.getByRole("region", { name: "Break down by" }));
    fireEvent.click(panel.getByRole("button", { name: "edit" }));
    fireEvent.change(panel.getByLabelText("Option cost edges"), { target: { value: "100" } });
    fireEvent.click(panel.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ costEdges: "100" });
    expect(localStorage.getItem("tj.edges.cost")).toBe("100");
  });

  it("fetches the stock prices scalps lack, saying so, then why it couldn't", async () => {
    let answer: (value: Response) => void = () => {};
    const rows = [...SCALP_ROWS.slice(0, 3), { ...SCALP_ROWS[3], scalpPrices: null }, ...SCALP_ROWS.slice(4)];
    const fetchMock = stubTrades(rows, [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
    const answered = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).includes("/api/risk/fill")) return answered?.(input, init) as Promise<Response>;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    });
    renderWithClient(<Analytics search={{ tab: "scalps" }} onSearch={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("r-coverage").textContent).toBe("Fetching stock prices for 1 scalp…"),
    );
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/risk/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["s4"] });
    const noKey = { reason: "no_key", message: "Add an Alpaca key in Settings to fetch the stock price." };
    answer(
      new Response(JSON.stringify({ filled: 0, missing: [], unavailable: noKey }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("r-coverage").textContent).toBe(
        "R covers 3 of 5 scalps · 1 has no stop · 1 has no stock price. Add an Alpaca key in Settings to fetch the missing stock prices.",
      ),
    );
  });

  it("sets each mistake against the rest, worst first, with no mistakes last", async () => {
    renderTab();
    // The section shows "Loading…" until the tags arrive, so it's looked up again once they have.
    const region = () => within(screen.getByRole("region", { name: "Mistake cost" }));
    await waitFor(() => expect(region().getByText("Moved stop")).toBeTruthy());
    const section = region();
    const labels = section
      .getAllByRole("row")
      .slice(1, -1)
      .map((row) => row.querySelector("td")?.textContent);
    expect(labels).toEqual(["Moved stop", "Chased entry", "no mistakes"]);
  });

  it("says so when the range has no closed scalps", async () => {
    renderTab({ ticker: "AA" });
    expect(await screen.findByText("No closed scalps in this range.")).toBeTruthy();
    expect(kpi("net")).toContain("—");
    expect(kpi("avg-r")).toBe("Avg R—");
    expect(screen.queryByTestId("r-coverage")).toBeNull();
  });
});
