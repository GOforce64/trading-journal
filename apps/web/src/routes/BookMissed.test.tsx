import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCALP_ROWS, SCALP_SETUPS, SCALP_TAGS } from "../analytics/scalps.fixture.js";
import { renderWithClient, stubTrades, tradeRow } from "../analytics/testing.js";
import { Analytics } from "./Analytics.js";

vi.mock("../analytics/EquityCurve.js", () => ({ EquityCurve: () => <div data-testid="equity-curve" /> }));
vi.mock("../analytics/ScalpCharts.js", () => ({
  MetricBars: ({ rows }: { rows: { label: string; trades: number; net: number | null }[] }) => (
    <div data-testid="bars">
      {rows.map((row) => `${row.label} ${row.trades} ${row.net ?? "—"}`).join("; ")}
    </div>
  ),
}));

/** Two missed scalps with an R (one win, one loss) and one without an exit, inside the fixtures' dates. */
const missedRow = (id: string, r: number | null, setupId = "orb") => ({
  ...tradeRow({
    id,
    strategy: "scalp",
    underlying: "NVDA",
    opened: "2026-09-28 09:41",
    closed: r == null ? null : "2026-09-28 09:58",
    netPnl: null,
    setupId,
  }),
  book: "missed",
  legs: [],
  risk: null,
  missed: {
    direction: "long",
    entryPrice: 100,
    stopPrice: 99,
    targetPrice: null,
    exitPrice: r == null ? null : 101,
  },
  missedRisk: { risk: 1, r, plannedRR: null, mae: null, mfe: null, problem: r == null ? "no_exit" : null },
});
const MISSED = [missedRow("m1", 2), missedRow("m2", -1), missedRow("m3", null)];

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent ?? "";
const number = (text: string) => Number(/-?\d+(\.\d+)?/.exec(text.replace(/[,$]/g, ""))?.[0]);

async function render(search: Record<string, unknown>, onSearch = vi.fn()) {
  stubTrades([...SCALP_ROWS, ...MISSED], [], { setups: SCALP_SETUPS, tags: SCALP_TAGS });
  renderWithClient(<Analytics search={search} onSearch={onSearch} />);
  await waitFor(() => expect(screen.getByTestId("kpi-net")).toBeTruthy());
  return onSearch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Missed in the Analytics Book filter", () => {
  it("toggles Missed into the books and back out", async () => {
    const onSearch = await render({});
    expect(
      within(screen.getByRole("group", { name: "Book" }))
        .getByRole("button", { name: "Missed" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Book" })).getByRole("button", { name: "Missed" }),
    );
    expect(onSearch).toHaveBeenLastCalledWith({ books: "live,paper,missed" });
    cleanup();
    const again = await render({ books: "live,paper,missed" });
    expect(
      within(screen.getByRole("group", { name: "Book" }))
        .getByRole("button", { name: "Missed" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Book" })).getByRole("button", { name: "Missed" }),
    );
    expect(again).toHaveBeenLastCalledWith({ books: undefined });
  });

  it("adds missed trades to the Overview's count and Avg R, never its dollars", async () => {
    await render({});
    const before = { net: kpi("net"), trades: number(kpi("trades")) };
    cleanup();
    await render({ books: "live,paper,missed" });
    expect(kpi("net")).toBe(before.net);
    expect(number(kpi("trades"))).toBe(before.trades + 2);
    expect(kpi("avg-r")).toContain("includes 2 missed (stock R)");
  });

  it("adds a Missed row to the Scalps tab's book breakdown, with blank dollars", async () => {
    await render({ tab: "scalps", by: "book", books: "live,paper,missed" });
    const table = await screen.findByRole("table", { name: "By Book" });
    const missedRowCells = [...table.querySelectorAll("tr")]
      .find((row) => row.textContent?.startsWith("Missed"))
      ?.querySelectorAll("td");
    expect([...(missedRowCells ?? [])].map((cell) => cell.textContent)).toEqual([
      "Missed",
      "2",
      "50.0%",
      "—",
      "+0.50R",
      "—",
      "—",
    ]);
  });

  it("says why a contract's breakdown leaves missed trades out", async () => {
    await render({ tab: "scalps", by: "dte", books: "live,paper,missed" });
    expect(
      await screen.findByText("Missed trades have no contract, so they aren't in this breakdown."),
    ).toBeTruthy();
  });

  it("shows missed trades alone without breaking the dollar tiles", async () => {
    await render({ books: "missed" });
    expect(kpi("net")).toBe("Net P&L—");
    expect(number(kpi("trades"))).toBe(2);
    cleanup();
    await render({ tab: "scalps", books: "missed" });
    expect(kpi("net")).toBe("Net P&L—");
    expect(screen.getAllByTestId("bars").length).toBeGreaterThan(0);
  });
});
