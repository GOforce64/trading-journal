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
  KeptHistogram: ({ bins }: { bins: { label: string; tradeIds: string[] }[] }) => (
    <div data-testid="kept-histogram">
      {bins
        .filter((bin) => bin.tradeIds.length > 0)
        .map((bin) => `${bin.label}: ${bin.tradeIds.length}`)
        .join("; ")}
    </div>
  ),
}));

vi.mock("../analytics/MoveCharts.js", () => ({
  MoveScatter: ({ points }: { points: { ticker: string; implied: number; absActual: number }[] }) => (
    <div data-testid="move-scatter">
      {points
        .map(
          (point) =>
            `${point.ticker} ${(point.implied * 100).toFixed(1)}/${(point.absActual * 100).toFixed(1)}`,
        )
        .join("; ")}
    </div>
  ),
  CrushHistogram: ({ bins }: { bins: { label: string; tradeIds: string[] }[] }) => (
    <div data-testid="crush-histogram">
      {bins
        .filter((bin) => bin.tradeIds.length > 0)
        .map((bin) => `${bin.label}: ${bin.tradeIds.length}`)
        .join("; ")}
    </div>
  ),
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
    // Whole dollars, so both averages fit on one line of the tile.
    expect(kpi("avg-win-loss")).toBe("Avg win / loss+$190 / −$300");
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

  it("shows Avg R over the scalps that have one", async () => {
    stubTrades([
      ...TRADES,
      tradeRow({
        id: "s1",
        underlying: "NVDA",
        strategy: "scalp",
        opened: "2026-09-28 09:31",
        closed: "2026-09-28 09:46",
        netPnl: 44.74,
        r: 0.43,
      }),
    ]);
    renderWithClient(<Analytics search={{}} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("avg-r")).toBe("Avg R+0.43Rover 1 scalp"));
  });
});

describe("Analytics' Setup filter", () => {
  const SETUPS = [
    { id: "orb", name: "ORB breakout", strategy: "scalp", description: null, archived: false, tradeCount: 1 },
    { id: "old", name: "Old setup", strategy: null, description: null, archived: true, tradeCount: 1 },
  ];
  /* AA +100 under ORB, BB −300 under the archived Old setup, CC +280 with none: +$80 in all. */
  const TAGGED = [
    tradeRow({
      id: "a",
      underlying: "AA",
      opened: "2026-09-02 15:45",
      closed: "2026-09-03 09:50",
      netPnl: 100,
      setupId: "orb",
    }),
    tradeRow({
      id: "b",
      underlying: "BB",
      opened: "2026-09-03 15:50",
      closed: "2026-09-04 15:40",
      netPnl: -300,
      setupId: "old",
    }),
    tradeRow({
      id: "c",
      underlying: "CC",
      opened: "2026-09-04 15:30",
      closed: "2026-09-08 09:45",
      netPnl: 280,
    }),
  ];

  it("lists the setups that aren't archived, and narrows every tab to the chosen one", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    const onSearch = vi.fn();
    const { rerender } = renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    const select = await screen.findByRole("combobox", { name: "Setup" });
    await waitFor(() =>
      expect([...(select as HTMLSelectElement).options].map((option) => option.text)).toEqual([
        "All",
        "ORB breakout",
      ]),
    );
    fireEvent.change(select, { target: { value: "orb" } });
    expect(onSearch).toHaveBeenCalledWith({ setup: "orb" });
    rerender(<Analytics search={{ setup: "orb" }} onSearch={onSearch} />);
    await waitFor(() => expect(kpi("net")).toContain("+$100.00"));
  });

  it("lists an archived setup the link names", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    renderWithClient(<Analytics search={{ setup: "old" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("-$300.00"));
    const select = screen.getByRole("combobox", { name: "Setup" }) as HTMLSelectElement;
    expect(select.value).toBe("old");
    expect([...select.options].map((option) => option.text)).toEqual(["All", "Old setup", "ORB breakout"]);
  });

  it("keeps showing the linked setup when the setups couldn't load, rather than All", async () => {
    const fetchMock = stubTrades(TAGGED, [], { setups: SETUPS });
    const answered = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes("/api/setups")
        ? new Response("{}", { status: 500 })
        : (answered?.(input, init) as Promise<Response>),
    );
    renderWithClient(<Analytics search={{ setup: "orb" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$100.00"));
    const select = screen.getByRole("combobox", { name: "Setup" }) as HTMLSelectElement;
    await waitFor(() => expect(select.selectedOptions[0]?.text).toBe("this setup"));
    expect(select.value).toBe("orb");
  });

  it("counts a setup the journal doesn't have as All", async () => {
    stubTrades(TAGGED, [], { setups: SETUPS });
    renderWithClient(<Analytics search={{ setup: "gone" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$80.00"));
    expect((screen.getByRole("combobox", { name: "Setup" }) as HTMLSelectElement).value).toBe("");
  });
});

describe("Analytics with an old link", () => {
  it("ignores a ticker the journal doesn't have, instead of showing an empty page under All", async () => {
    stubTrades(TRADES);
    renderWithClient(<Analytics search={{ ticker: "ZZZ" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("net")).toContain("+$80.00"));
    expect((screen.getByRole("combobox", { name: "Ticker" }) as HTMLSelectElement).value).toBe("");
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

describe("Analytics Iron flies", () => {
  /*
   * Flies AA, BB, CC: credits 204, 306, 402 (avg $304); max profits 200, 300, 400 (avg $300).
   * AA keeps 50%, CC keeps 280 / 400 = 70%: winners keep a mean and median of 60%.
   * BB loses all of its 300 max profit: 100%. Kept overall: 80 / 900 = 9%. The scalp SS is left out.
   */
  const FLIES = [
    ...TRADES,
    tradeRow({
      id: "s",
      underlying: "SS",
      opened: "2026-09-09 09:35",
      closed: "2026-09-09 10:05",
      netPnl: 50,
      strategy: "scalp",
    }),
  ];

  it("switches tabs through the URL", async () => {
    stubTrades(FLIES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{}} onSearch={onSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iron flies" }));
    expect(onSearch).toHaveBeenCalledWith({ tab: "flies" });
  });

  it("measures the flies against max profit", async () => {
    stubTrades(FLIES);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    await waitFor(() => expect(kpi("avg-credit")).toContain("$304"));
    expect(kpi("avg-max-profit")).toContain("$300");
    expect(kpi("winners-keep")).toContain("60%");
    expect(kpi("winners-keep")).toContain("median 60%");
    expect(kpi("losers-lose")).toContain("100%");
    expect(kpi("kept-overall")).toContain("9%");
    expect(screen.getByTestId("kept-histogram").textContent).toBe("−100% to −75%: 1; 50% to 75%: 2");
  });

  it("shows the fly splits, and saves new credit edges", async () => {
    stubTrades(FLIES);
    const onSearch = vi.fn();
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={onSearch} />);
    for (const title of ["Credit", "Wings", "Wider wing width"]) {
      expect(await screen.findByRole("region", { name: title })).toBeTruthy();
    }
    const credit = within(screen.getByRole("region", { name: "Credit" }));
    fireEvent.click(credit.getByRole("button", { name: "edit" }));
    fireEvent.change(credit.getByLabelText("Credit edges"), { target: { value: "300" } });
    fireEvent.click(credit.getByRole("button", { name: "Save" }));
    expect(onSearch).toHaveBeenCalledWith({ creditEdges: "300" });
    expect(localStorage.getItem("tj.edges.credit")).toBe("300");
  });

  it("says how many flies have move data, and what each panel lacks without any", async () => {
    stubTrades(FLIES);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    expect((await screen.findByTestId("move-coverage")).textContent).toContain(
      "Move data for 0 of 3 closed flies",
    );
    expect(screen.getByText("No move data in this range.")).toBeTruthy();
    expect(screen.getByText("No IV data in this range.")).toBeTruthy();
  });
});

describe("Analytics Iron flies: move data", () => {
  /* AA moved 0.4× its implied move and won; BB moved 1.5× and lost; CC has no move data. */
  const MOVED = [
    tradeRow({
      id: "a",
      underlying: "AA",
      opened: "2026-09-02 15:45",
      closed: "2026-09-03 09:50",
      netPnl: 100,
      fly: { impliedMovePct: 10, actualMovePct: -4, ivBefore: 120, ivAfter: 60 },
    }),
    tradeRow({
      id: "b",
      underlying: "BB",
      opened: "2026-09-03 15:50",
      closed: "2026-09-04 15:40",
      netPnl: -300,
      fly: { impliedMovePct: 10, actualMovePct: 15, ivBefore: 100, ivAfter: 75 },
    }),
    tradeRow({
      id: "c",
      underlying: "CC",
      opened: "2026-09-04 15:30",
      closed: "2026-09-08 09:45",
      netPnl: 280,
    }),
  ];

  it("shows the three move panels for the flies that have move data", async () => {
    stubTrades(MOVED);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    expect((await screen.findByTestId("move-coverage")).textContent).toContain(
      "Move data for 2 of 3 closed flies",
    );
    expect(screen.getByTestId("move-scatter").textContent).toBe("AA 10.0/4.0; BB 10.0/15.0");
    const ratio = within(screen.getByRole("region", { name: "P&L by move ratio" }));
    // Short headers that never wrap: at 1024 px a long first header pushed "Trades" into "Won".
    expect(ratio.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Ratio",
      "Trades",
      "Won",
      "Net",
    ]);
    expect(ratio.getByRole("row", { name: /Ratio/ }).className).toContain("whitespace-nowrap");
    expect(ratio.getByText("< 0.5×").closest("tr")?.textContent).toContain("+$100");
    expect(ratio.getByText("1.5×+").closest("tr")?.textContent).toContain("−$300");
    expect(ratio.getByText(/Moved more than implied/).textContent).toBe(
      "Moved more than implied: 1 trade, 0 won, net −$300.",
    );
    expect(screen.getByTestId("crush-histogram").textContent).toBe("25…50: 1; 50+: 1");
    expect(screen.getByText(/Median crush/).textContent).toBe(
      "Median crush 43 pts over 2 trades. IV after is left blank within 24 h of expiry.",
    );
  });

  it("disables Fill in missing without a key, saying why", async () => {
    stubTrades(MOVED);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    const button = await screen.findByRole("button", { name: "Fill in missing" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // "Checking the Alpaca key…" until the settings answer; then why.
    await waitFor(() =>
      expect(button.getAttribute("title")).toBe("Add an Alpaca key in Settings to fetch stock prices."),
    );
  });

  it("says so when Fill in missing failed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/moves/fill") return new Response("{}", { status: 500 });
      const body =
        path === "/api/settings"
          ? { dataDir: null, marketData: { state: "on", message: null, keyIdHint: null } }
          : path === "/api/setups" || path === "/api/tags"
            ? []
            : MOVED;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    const button = await screen.findByRole("button", { name: "Fill in missing" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText("Couldn't fetch stock prices: the server answered 500.")).toBeTruthy();
  });

  it("fills every fly's missing stock prices on request, and says how it went", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const body =
        path === "/api/settings"
          ? { dataDir: null, marketData: { state: "on", message: null, keyIdHint: null } }
          : path === "/api/moves/fill"
            ? {
                filled: 2,
                missing: [{ tradeId: "c", underlying: "CC", side: "exit", reason: "no_bars" }],
                unavailable: null,
              }
            : path === "/api/option-quotes"
              ? { quotes: {}, available: true }
              : path === "/api/setups" || path === "/api/tags"
                ? []
                : MOVED;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(<Analytics search={{ tab: "flies" }} onSearch={() => {}} />);
    const button = await screen.findByRole("button", { name: "Fill in missing" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText("Filled 2 of 3 stock prices. 1 missing.")).toBeTruthy();
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/moves/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({});
  });
});
