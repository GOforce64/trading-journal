import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { type MissedRow, nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { MissedTab } from "./MissedTab.js";

const bars: { rows: readonly MissedRow[] } = { rows: [] };
vi.mock("../analytics/MissedBars.js", () => ({
  MissedBars: ({ rows }: { rows: readonly MissedRow[] }) => {
    bars.rows = rows;
    return <div data-testid="missed-bars" />;
  },
}));

const at = (date: string, minute: number) => nyWallClock(date, minute);
function missed(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    strategy: "scalp",
    book: "missed",
    underlying: "NVDA",
    openedAt: at("2026-10-07", 9 * 60 + 41),
    closedAt: at("2026-10-07", 9 * 60 + 58),
    netPnl: null,
    fees: 0,
    grade: "B",
    excluded: false,
    setupId: "orb",
    tagIds: ["hes"],
    legs: [],
    ironFly: null,
    risk: null,
    missedRisk: { risk: 0.62, r: 2.39, plannedRR: null, mae: -0.3, mfe: 3.1, problem: null },
    ...overrides,
  };
}
const risk = (r: number | null, problem: string | null = null) => ({
  risk: 0.5,
  r,
  plannedRR: null,
  mae: null,
  mfe: r == null ? null : 1,
  problem,
});
const MISSED = [
  missed("a"),
  missed("b", { setupId: null, tagIds: ["late"], missedRisk: risk(1.15), underlying: "TSLA" }),
  missed("c", { missedRisk: risk(-1), underlying: "SPY" }),
  missed("d", { closedAt: null, tagIds: [], missedRisk: risk(null, "no_exit") }),
];
const taken = (id: string, r: number) => ({
  ...missed(id),
  book: "live",
  netPnl: 50,
  tagIds: [],
  missedRisk: null,
  legs: [
    {
      right: "C",
      strike: 180,
      expiry: "2026-10-07",
      quantity: 1,
      multiplier: 100,
      openPrice: 1,
      closePrice: 1.5,
    },
  ],
  risk: { r, problem: null },
});
const TAKEN = [taken("t1", 0.5), taken("t2", 0.3)];

function setup(search = {}, trades: readonly unknown[] = TAKEN) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/tags")
        ? [
            { id: "hes", name: "Hesitated", kind: "skip", archived: false },
            { id: "late", name: "Saw it late", kind: "skip", archived: false },
          ]
        : [{ id: "orb", name: "ORB pullback", archived: false }];
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  );
  const onSearch = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MissedTab
        trades={trades as unknown as TradeView[]}
        allTrades={[...MISSED, ...TAKEN] as unknown as TradeView[]}
        search={{ tab: "missed", ...search }}
        onSearch={onSearch}
      />
    </QueryClientProvider>,
  );
  return { onSearch };
}

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

afterEach(() => vi.unstubAllGlobals());

describe("MissedTab", () => {
  it("sums up the missed trades, and how many of the setups were taken", async () => {
    setup();
    await screen.findByText("Hesitated");
    expect(kpi("missed")).toBe("Missed trades4");
    expect(kpi("opportunity")).toBe("Missed opportunity+2.54Rhad you taken all 3");
    expect(kpi("won")).toBe("Would have won66.7%2 of 3");
    expect(kpi("avg-r")).toBe("Avg R+0.85Ron the stock");
    expect(kpi("good-skips")).toBe("Good skips1would have lost −1.00R");
    expect(kpi("took")).toBe("Took33%2 taken · 4 missed");
    expect(screen.getByText("R covers 3 of 4 missed trades: the rest lack a stop or an exit.")).toBeTruthy();
  });

  it("takes the taken side from Live and Paper, both when the Book filter keeps only Missed", async () => {
    // Analytics hands the tab the Book-filtered trades: with Missed alone, those are the missed ones.
    setup({ books: "missed" }, MISSED);
    await screen.findByText("Hesitated");
    expect(kpi("took")).toBe("Took33%2 taken · 4 missed");
  });

  it("keeps the Book filter's Live or Paper for the taken side", async () => {
    setup({ books: "paper,missed" }, MISSED);
    await screen.findByText("Hesitated");
    expect(kpi("took")).toBe("Took0%0 taken · 4 missed");
  });

  it("breaks them down by skip reason, with the total R as bars", async () => {
    setup();
    await screen.findByText("Saw it late");
    const table = screen.getByRole("table", { name: "By Skip reason" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Hesitated",
      "Saw it late",
      "no reason",
    ]);
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Hesitated", "2", "50.0%", "+1.39R", "+0.70R", "+2.05R"]);
    expect(bars.rows.map((row) => row.label)).toEqual(["Hesitated", "Saw it late", "no reason"]);
  });

  it("switches the breakdown through the URL", async () => {
    const { onSearch } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Setup" }));
    expect(onSearch).toHaveBeenCalledWith({ mby: "setup" });
    fireEvent.click(screen.getByRole("button", { name: "Skip reason" }));
    expect(onSearch).toHaveBeenLastCalledWith({ mby: undefined });
  });

  it("sets each setup's taken trades beside its missed ones", async () => {
    setup();
    await screen.findByText("ORB pullback");
    const table = screen.getByRole("table", { name: "Taken and missed, by setup" });
    const rows = within(table).getAllByRole("row").slice(2);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["ORB pullback", "2", "100.0%", "+0.40R", "3", "50.0%", "+0.70R", "40%"],
      ["no setup", "0", "—", "—", "1", "100.0%", "+1.15R", "0%"],
    ]);
    expect(screen.getByText("Took = taken ÷ (taken + missed).")).toBeTruthy();
  });

  it("says so when the filters leave no missed trades", async () => {
    setup({ ticker: "AMD" });
    expect(await screen.findByText("No missed trades for these filters.")).toBeTruthy();
  });
});
