import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissedPage, parseMissedSearch } from "./MissedPage.js";

/** Thursday Oct 8, after the close: the last session is today's. */
const NOW = nyWallClock("2026-10-08", 17 * 60);

const at = (date: string, minute: number) => nyWallClock(date, minute);
function missed(id: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    strategy: "scalp",
    book: "missed",
    underlying: "NVDA",
    openedAt: at(date, 9 * 60 + 41),
    closedAt: at(date, 9 * 60 + 58),
    netPnl: null,
    fees: 0,
    grade: "B",
    notes: null,
    excluded: false,
    setupId: "orb",
    tagIds: ["hes"],
    legs: [],
    ironFly: null,
    risk: null,
    missed: { direction: "long", entryPrice: 178.42, stopPrice: 177.8, targetPrice: null, exitPrice: 179.9 },
    missedRisk: { risk: 0.62, r: 2.39, plannedRR: null, mae: -0.3, mfe: 3.1, problem: null },
    ...overrides,
  };
}
const risk = (r: number | null, problem: string | null = null, mfe: number | null = 1) => ({
  risk: 0.5,
  r,
  plannedRR: null,
  mae: null,
  mfe,
  problem,
});

const MISSED = [
  missed("a", "2026-10-07"),
  missed("b", "2026-10-06", { tagIds: ["late"], missedRisk: risk(1.15), underlying: "TSLA" }),
  missed("c", "2026-10-05", { missedRisk: risk(-1), underlying: "SPY", notes: "Volume too thin" }),
  missed("d", "2026-10-07", {
    openedAt: at("2026-10-07", 9 * 60 + 30),
    closedAt: null,
    tagIds: [],
    missedRisk: risk(null, "no_exit", null),
    underlying: "QQQ",
  }),
  // Outside the last 30 days: left out of the KPIs and the list by default.
  missed("old", "2026-08-03", { missedRisk: risk(4) }),
];
const taken = (id: string, r: number) => ({
  ...missed(id, "2026-10-06"),
  book: "live",
  netPnl: 50,
  missed: null,
  missedRisk: null,
  legs: [
    {
      right: "C",
      strike: 180,
      expiry: "2026-10-06",
      quantity: 1,
      multiplier: 100,
      openPrice: 1,
      closePrice: 1.5,
    },
  ],
  risk: { r, problem: null },
});
const TAKEN = [taken("t1", 0.5), taken("t2", 0.3)];

function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (url.includes("/api/tags"))
        return json([
          { id: "hes", name: "Hesitated", kind: "skip", archived: false },
          { id: "late", name: "Saw it late", kind: "skip", archived: false },
        ]);
      if (url.includes("/api/setups")) return json([{ id: "orb", name: "ORB pullback", archived: false }]);
      if (url.includes("book=missed")) return json(MISSED);
      return json([...MISSED, ...TAKEN]);
    }),
  );
  const onOpenTrade = vi.fn();
  const onNewMissed = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MissedPage onOpenTrade={onOpenTrade} onNewMissed={onNewMissed} />
    </QueryClientProvider>,
  );
  return { onOpenTrade, onNewMissed };
}

const kpi = (id: string) => screen.getByTestId(`kpi-${id}`).textContent;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MissedPage", () => {
  it("adds up what the last 30 days' skips would have made", async () => {
    setup();
    await screen.findByText("TSLA");
    expect(kpi("opportunity")).toBe("Missed opportunity+2.54Rthe R of all 3, had you taken them");
    expect(kpi("won")).toBe("Would have won2 of 367%");
    expect(kpi("avg-r")).toBe("Avg R+0.85Rtaken scalps: +0.40R");
    expect(kpi("good-skips")).toBe("Good skips1would have lost −1.00R");
    expect(kpi("reason")).toBe("Top reasonHesitated2 trades · +1.39R");
  });

  it("lists them newest first, with what each still needs", async () => {
    const { onOpenTrade } = setup();
    await screen.findByText("TSLA");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]?.textContent)).toEqual([
      "NVDA",
      "QQQ",
      "TSLA",
      "SPY",
    ]);
    expect(within(rows[1] as HTMLElement).getByText("needs exit")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("+2.39R")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Hesitated")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("ORB pullback")).toBeTruthy();
    fireEvent.click(rows[2] as HTMLElement);
    expect(onOpenTrade).toHaveBeenCalledWith("b");
  });

  it("widens to every missed trade on All time", async () => {
    setup();
    await screen.findByText("TSLA");
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "all" } });
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("asks for a ticker and the last session, then opens that day's chart", async () => {
    const { onNewMissed } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Missed trade" }));
    expect(screen.getByLabelText("Date")).toHaveProperty("value", "2026-10-08");
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "nvda" } });
    fireEvent.click(screen.getByRole("button", { name: "Open chart →" }));
    expect(onNewMissed).toHaveBeenCalledWith("NVDA", "2026-10-08");
  });

  it("won't open a chart on a day the market was shut", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Missed trade" }));
    fireEvent.change(screen.getByLabelText("Ticker"), { target: { value: "NVDA" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-03" } });
    expect(screen.getByText("Not a trading day")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Open chart →" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says how to start when there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MissedPage />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("No missed trades in this period. + Missed trade marks one on a day's chart."),
    ).toBeTruthy();
  });
});

describe("the Missed page's period", () => {
  it("comes from the URL: Last 30 days when it names none, or one the page doesn't have", () => {
    expect(parseMissedSearch({ period: "all" })).toEqual({ period: "all" });
    expect(parseMissedSearch({ period: "90" })).toEqual({ period: "90" });
    expect(parseMissedSearch({ period: "30" })).toEqual({});
    expect(parseMissedSearch({ period: "7" })).toEqual({});
  });

  it("shows the period it's given and hands a new one back, so Back from a trade keeps it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })),
    );
    const onPeriod = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MissedPage period="all" onPeriod={onPeriod} />
      </QueryClientProvider>,
    );
    const select = (await screen.findByRole("combobox", { name: "Period" })) as HTMLSelectElement;
    expect(select.value).toBe("all");
    fireEvent.change(select, { target: { value: "90" } });
    expect(onPeriod).toHaveBeenCalledWith("90");
  });
});
