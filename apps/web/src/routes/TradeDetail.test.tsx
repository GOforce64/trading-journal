import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { scalpRisk } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "./TradeDetail.js";

// The charts have their own tests; here they're a placeholder that shows where they go.
vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: ({ trade }: { trade: { underlying: string } }) => (
    <div data-testid="trade-charts">{trade.underlying}</div>
  ),
}));

// The review has its own tests; here it's a placeholder saying which layout it was given.
vi.mock("../review/ReviewPanel.js", () => ({
  ReviewPanel: ({ layout }: { layout: string }) => <div data-testid="review-panel">{layout}</div>,
}));

// A scalp's charts and review strip have their own tests; here they're one placeholder that can ask for Next.
vi.mock("../review/ScalpWorkspace.js", () => ({
  ScalpWorkspace: ({
    trade,
    onOpenTrade,
  }: {
    trade: { underlying: string };
    onOpenTrade?: (id: string) => void;
  }) => (
    <div data-testid="scalp-workspace">
      {trade.underlying}
      <button type="button" onClick={() => onOpenTrade?.("t2")}>
        workspace: next
      </button>
    </div>
  ),
}));

const trade = {
  id: "t1",
  strategy: "iron_fly",
  book: "live",
  underlying: "XYZ",
  underlyingName: "XYZ Industries",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1788_000_000_000,
  closedAt: 1788_086_400_000,
  netPnl: 512,
  fees: 8,
  notes: "crush paid",
  grade: null,
  excluded: false,
  excludeReason: null,
  tagIds: [],
  ironFly: {
    bodyPutStrike: 50,
    bodyCallStrike: 50,
    putWingStrike: 45,
    callWingStrike: 58,
    contracts: 4,
    creditPerShare: 3,
    impliedMovePct: null,
    actualMovePct: null,
    ivBefore: null,
    ivAfter: null,
    sourceNotes: null,
  },
  legs: [
    {
      id: "l1",
      right: "C",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 2.1,
      closePrice: 1,
    },
    {
      id: "l2",
      right: "P",
      strike: 50,
      expiry: "2026-10-16",
      quantity: -4,
      multiplier: 100,
      openPrice: 1.6,
      closePrice: 0.8,
    },
    {
      id: "l3",
      right: "C",
      strike: 58,
      expiry: "2026-10-16",
      quantity: 4,
      multiplier: 100,
      openPrice: 0.35,
      closePrice: 0.05,
    },
    {
      id: "l4",
      right: "P",
      strike: 45,
      expiry: "2026-10-16",
      quantity: 4,
      multiplier: 100,
      openPrice: 0.35,
      closePrice: 0.05,
    },
  ],
  metrics: {
    putWingWidth: 5,
    callWingWidth: 8,
    isBrokenWing: true,
    maxProfit: 1192,
    putSideRisk: 808,
    callSideRisk: 2008,
    maxLoss: 2008,
    riskySide: "call",
    breakevenLow: 47.02,
    breakevenHigh: 52.98,
    returnOnRisk: 0.255,
    pctOfMaxProfit: 0.4295,
    pnlPctOfCost: 0.4295,
  },
};

const jsonResponse = () =>
  new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } });

/** The sample fly while still open: no exits yet, expiring far ahead so it is open whenever the test runs. */
const openTrade = {
  ...trade,
  closedAt: null,
  netPnl: null,
  feesOpen: 5,
  feesClose: 0,
  legs: trade.legs.map((leg) => ({ ...leg, expiry: "2099-10-16", closePrice: null })),
  metrics: { ...trade.metrics, returnOnRisk: null, pctOfMaxProfit: null, pnlPctOfCost: null },
};

const QUOTED = Date.UTC(2026, 8, 25, 19, 59, 51);
const openQuotes = {
  XYZ991016C00050000: { bid: 1.0, ask: 1.2, at: QUOTED },
  XYZ991016P00050000: { bid: 0.7, ask: 0.9, at: QUOTED },
  XYZ991016C00058000: { bid: 0.1, ask: 0.15, at: QUOTED },
  XYZ991016P00045000: { bid: 0.05, ask: 0.1, at: QUOTED },
};

/** Answers the trade for its own URL and the given quotes for option quotes. */
function stubTrade(body: unknown, quotes: Record<string, unknown> = openQuotes, available = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const payload = String(input).includes("/api/option-quotes") ? { quotes, available } : body;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDetail(onOpenTrade?: (id: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TradeDetail tradeId="t1" onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("TradeDetail", () => {
  it("puts the review beside a fly's legs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    expect((await screen.findByTestId("review-panel")).textContent).toBe("side");
  });

  it("shows the headline metrics and marks the broken wing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText("XYZ Industries")).toBeTruthy());
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("2,008.00");
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("call side");
    expect(screen.getByTestId("tile-structure").textContent).toContain("broken");
    expect(screen.getByTestId("tile-breakevens").textContent).toContain("47.02");
    // Net P&L shows in the header and again in the legs total.
    expect(screen.getAllByText("+$512.00").length).toBeGreaterThan(0);
  });

  it("says why the move data is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-implied-move")).toBeTruthy());
    expect(screen.getByTestId("tile-implied-move").textContent).toContain("needs the stock at entry");
    // The sample trade opened on a Saturday.
    expect(screen.getByTestId("tile-stock").textContent).toContain(
      "Not a trading day; type the moves in Edit.",
    );
  });

  it("shows every leg straight away, no expander", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getAllByTestId(/^leg-row-/)).toHaveLength(4));
    expect(screen.queryByTestId("legs-details")).toBeNull();
  });

  it("totals the legs in bold above the table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    const totals = await screen.findByTestId("legs-total");
    expect(totals.textContent).toContain("1,200.00"); // cost: credit received
    expect(totals.textContent).toContain("520.00"); // P&L before fees
    expect(totals.textContent).toContain("8.00"); // fees
    expect(totals.textContent).toContain("512.00"); // net
    expect(totals.className).toContain("font-semibold");
  });

  it("shows each leg's own cost and P&L", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    const shortCall = await screen.findByTestId("leg-row-l1");
    expect(shortCall.textContent).toContain("840.00"); // 4 x 100 x 2.10 credit
    expect(shortCall.textContent).toContain("440.00"); // bought back at 1.00
  });

  it("marks each open leg at its cost to close and estimates the trade", async () => {
    stubTrade(openTrade);
    renderDetail();
    // Short call +360, short put +280, long call -100, long put -120, less $5 entry fees.
    await waitFor(() => expect(screen.getByTestId("header-estimate").textContent).toBe("est +$415.00"));
    const shortCall = screen.getByTestId("leg-row-l1");
    expect(shortCall.textContent).toContain("1.20 ask");
    expect(shortCall.textContent).toContain("+$360.00");
    expect(screen.getByTestId("leg-row-l4").textContent).toContain("0.05 bid");
    const note = screen.getByTestId("estimate-note").textContent;
    expect(note).toContain("+$420.00 before fees");
    expect(note).toContain("+$415.00 after the $5.00 fees entered so far");
    expect(note).toContain("Sep 25, 03:59 PM ET");
    expect(note).toContain("never saved");
  });

  it("flags an open trade past its expiry", async () => {
    stubTrade({ ...openTrade, legs: openTrade.legs.map((leg) => ({ ...leg, expiry: "2020-01-17" })) });
    renderDetail();
    expect(await screen.findByText("EXPIRED · add exits")).toBeTruthy();
    expect(screen.queryByText("Mark (to close)")).toBeNull();
    expect(await screen.findByText("Settle at expiry")).toBeTruthy();
  });

  it("leaves a synced fly past its expiry for IBKR to settle, offering no Settle panel", async () => {
    // Today's statement has no expiry bookings; the next Activity statement closes the wings at $0 or their mark.
    stubTrade({
      ...openTrade,
      source: "ibkr_flex",
      factsEditedAt: null,
      fills: [],
      legs: openTrade.legs.map((leg) => ({ ...leg, expiry: "2020-01-17" })),
    });
    renderDetail();
    expect(await screen.findByText("EXPIRED · add exits")).toBeTruthy();
    expect(
      await screen.findByText(
        "IBKR books the expiry overnight: the next sync closes this trade at its expiry values.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Settle at expiry")).toBeNull();
  });

  it("shows no marks, and blames no quote, without a market data key", async () => {
    const fetchMock = stubTrade(openTrade, {}, false);
    renderDetail();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/option-quotes"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Mark (to close)")).toBeNull();
    expect(screen.queryByText(/Marks unavailable/)).toBeNull();
    expect(screen.getByTestId("header-estimate").textContent).toBe("—");
  });

  it("says why marks are missing", async () => {
    stubTrade(openTrade, {});
    renderDetail();
    expect(await screen.findByText("Marks unavailable: no quote for the short call.")).toBeTruthy();
  });

  it("adds no mark columns to a closed trade and asks for no quotes", async () => {
    const fetchMock = stubTrade(trade);
    renderDetail();
    await screen.findByText("XYZ Industries");
    expect(screen.queryByText("Mark (to close)")).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/option-quotes"))).toBe(false);
  });

  it("shows the share of max profit kept, with max loss only for reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-kept")).toBeTruthy());
    expect(screen.getByTestId("tile-kept").textContent).toContain("+42.95%");
    expect(screen.queryByText("Return on risk")).toBeNull();
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("2,008.00");
  });

  it("shows a one-winged fly's P&L % in the header, as its % kept tile does", async () => {
    const oneWing = {
      ...trade,
      ironFly: { ...trade.ironFly, callWingStrike: null },
      metrics: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(oneWing), { headers: { "content-type": "application/json" } }),
      ),
    );
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-kept")).toBeTruthy());
    expect(screen.getByTestId("header-pct").textContent).toBe("+42.95%");
  });

  it("shows the charts under the header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    renderDetail();
    expect((await screen.findByTestId("trade-charts")).textContent).toBe("XYZ");
  });
});

const M_ID = "81e7c863-a5ed-522b-b87a-3cb922029179";

/** The M fly from the real journal (spec §3), with both stock prices filled. */
const mTrade = {
  ...trade,
  id: M_ID,
  underlying: "M",
  underlyingName: "Macy's",
  openedAt: Date.UTC(2026, 8, 9, 19, 54),
  closedAt: Date.UTC(2026, 8, 10, 19, 44),
  netPnl: 224.06,
  fees: 10.94,
  legs: [
    {
      id: "m1",
      right: "C",
      strike: 21.5,
      expiry: "2026-09-11",
      quantity: -5,
      multiplier: 100,
      openPrice: 0.88,
      closePrice: 0.05,
    },
    {
      id: "m2",
      right: "P",
      strike: 21.5,
      expiry: "2026-09-11",
      quantity: -5,
      multiplier: 100,
      openPrice: 0.7,
      closePrice: 1.03,
    },
    {
      id: "m3",
      right: "C",
      strike: 27,
      expiry: "2026-09-11",
      quantity: 5,
      multiplier: 100,
      openPrice: 0.01,
      closePrice: 0,
    },
    {
      id: "m4",
      right: "P",
      strike: 18,
      expiry: "2026-09-11",
      quantity: 5,
      multiplier: 100,
      openPrice: 0.02,
      closePrice: 0,
    },
  ],
  ironFly: {
    ...trade.ironFly,
    bodyPutStrike: 21.5,
    bodyCallStrike: 21.5,
    putWingStrike: 18,
    callWingStrike: 27,
    contracts: 5,
    creditPerShare: 1.55,
    underlyingPriceEntry: 21.66,
    underlyingPriceExit: 20.505,
  },
};
const noPrices = {
  ...mTrade,
  ironFly: { ...mTrade.ironFly, underlyingPriceEntry: null, underlyingPriceExit: null },
};

/** Answers the Settings status, a fill, and the trade for everything else. */
function stubMoves(body: unknown, { marketOn = true, fillResult = {} as unknown } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const payload =
      path === "/api/settings"
        ? { dataDir: null, marketData: { state: marketOn ? "on" : "off", message: null, keyIdHint: null } }
        : path === "/api/moves/fill"
          ? fillResult
          : path === "/api/option-quotes"
            ? { quotes: {}, available: marketOn }
            : body;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TradeDetail move tiles", () => {
  it("works out the moves from the fills, and shows the working", async () => {
    stubMoves(mTrade);
    renderDetail();
    const implied = await screen.findByTestId("tile-implied-move");
    expect(implied.textContent).toContain("7.3%");
    expect(implied.textContent).toContain("straddle 1.58 ÷ $21.66 at entry");
    const actual = screen.getByTestId("tile-actual-move").textContent;
    expect(actual).toContain("−5.3%");
    expect(actual).toContain("$21.66 → $20.51 · 0.73× implied");
    const iv = screen.getByTestId("tile-iv").textContent;
    expect(iv).toContain("123% → 77%");
    // The crush is the difference of the percentages shown (123 − 77), as spec §9.2 has it.
    expect(iv).toContain("crush 46 pts · from your fills");
    const stock = screen.getByTestId("tile-stock").textContent;
    expect(stock).toContain("$21.66 / $20.51");
    expect(stock).toContain("Alpaca, Sep 9 15:54 → Sep 10 15:44 ET");
  });

  it("shows a typed value as typed, beside the computed one", async () => {
    stubMoves({ ...mTrade, ironFly: { ...mTrade.ironFly, impliedMovePct: 7.1 } });
    renderDetail();
    const implied = await screen.findByTestId("tile-implied-move");
    expect(implied.textContent).toContain("7.1%");
    expect(implied.textContent).toContain("typed (computed 7.3%)");
  });

  it("fills a missing price on request, and says why it is still missing", async () => {
    const fetchMock = stubMoves(noPrices, {
      fillResult: {
        filled: 0,
        missing: [
          { tradeId: M_ID, underlying: "M", side: "entry", reason: "no_bars" },
          { tradeId: M_ID, underlying: "M", side: "exit", reason: "no_bars" },
        ],
        unavailable: null,
      },
    });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId("tile-stock").textContent).toContain("Not fetched yet."));
    fireEvent.click(await screen.findByRole("button", { name: "Fill in missing" }));
    await waitFor(() =>
      expect(screen.getByTestId("tile-stock").textContent).toContain(
        "Alpaca has no price for this time; type the moves in Edit.",
      ),
    );
    const post = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/moves/fill"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ tradeIds: [M_ID] });
    expect(screen.getByTestId("tile-implied-move").textContent).toContain("needs the stock at entry");
  });

  it("asks for a key, and offers no button, when none is set up", async () => {
    stubMoves(noPrices, { marketOn: false });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId("tile-stock").textContent).toContain(
        "Add an Alpaca key in Settings to fetch stock prices.",
      ),
    );
    expect(screen.queryByRole("button", { name: "Fill in missing" })).toBeNull();
  });

  it("shows an open trade's entry side, with the exit still open", async () => {
    stubMoves({
      ...mTrade,
      closedAt: null,
      netPnl: null,
      legs: mTrade.legs.map((leg) => ({ ...leg, closePrice: null })),
      ironFly: { ...mTrade.ironFly, underlyingPriceExit: null },
    });
    renderDetail();
    expect((await screen.findByTestId("tile-stock")).textContent).toContain("$21.66 / open");
    expect(screen.getByTestId("tile-actual-move").textContent).toContain("open");
    expect(screen.getByTestId("tile-implied-move").textContent).toContain("7.3%");
  });
});

const NVDA_OPEN = Date.UTC(2026, 8, 28, 13, 31, 5);
const NVDA_CLOSE = Date.UTC(2026, 8, 28, 13, 46, 12);

/** This morning's NVDA scalp, synced from IBKR, with its four fills. */
const nvda = {
  ...trade,
  id: "nvda",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: "Long call",
  source: "ibkr_flex",
  factsEditedAt: null,
  openedAt: NVDA_OPEN,
  closedAt: NVDA_CLOSE,
  netPnl: 44.74,
  fees: 2.26,
  ironFly: null,
  metrics: null,
  legs: [
    {
      id: "l-nvda",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
      quantity: 2,
      multiplier: 100,
      openPrice: 1.06,
      closePrice: 1.295,
    },
  ],
  fills: [
    {
      id: "f1",
      executedAt: NVDA_OPEN,
      quantity: 1,
      price: 1.06,
      commission: 0.0833,
      kind: "trade",
      canceled: false,
      openClose: "O",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
    },
    {
      id: "f2",
      executedAt: NVDA_OPEN,
      quantity: 1,
      price: 1.06,
      commission: 0.8453,
      kind: "trade",
      canceled: false,
      openClose: "O",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
    },
    {
      id: "f3",
      executedAt: Date.UTC(2026, 8, 28, 13, 31, 49),
      quantity: -1,
      price: 1.44,
      commission: 0.7736,
      kind: "trade",
      canceled: false,
      openClose: "C",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
    },
    {
      id: "f4",
      executedAt: NVDA_CLOSE,
      quantity: -1,
      price: 1.15,
      commission: 0.561,
      kind: "trade",
      canceled: false,
      openClose: "C",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
    },
  ],
};

/** Answers the trade, the IBKR status (with `keptEdits`), and a reset. */
function stubSynced(
  body: unknown,
  keptEdits: { tradeId: string; ticker: string; netPnl: number | null }[] = [],
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const payload = url.includes("/api/ibkr/status")
      ? {
          configured: true,
          since: "2026-09-28",
          lastRunAt: 1,
          lastStatus: "ok",
          lastError: null,
          lastSummary: { keptEdits },
        }
      : url.includes("/reset")
        ? { status: "ok" }
        : body;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TradeDetail for a scalp", () => {
  it("opens the trade the queue bar asks for", async () => {
    stubSynced(nvda);
    const onOpenTrade = vi.fn();
    renderDetail(onOpenTrade);
    fireEvent.click(await screen.findByRole("button", { name: "workspace: next" }));
    expect(onOpenTrade).toHaveBeenCalledWith("t2");
  });

  it("puts a scalp's charts and review strip under the header, above the tiles", async () => {
    stubSynced(nvda);
    renderDetail();
    const workspace = await screen.findByTestId("scalp-workspace");
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(workspace, screen.getByTestId("tile-contract"))).toBe(true);
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });

  it("shows the scalp's own tiles", async () => {
    stubSynced(nvda);
    renderDetail();
    expect((await screen.findByTestId("tile-contract")).textContent).toContain("NVDA 232.5C · exp Sep 28");
    expect(screen.getByTestId("tile-size").textContent).toContain("2 contracts");
    expect(screen.getByTestId("tile-entry-exit").textContent).toContain("1.06 → 1.295");
    expect(screen.getByTestId("tile-held").textContent).toContain("15 min");
    expect(screen.getByTestId("tile-fees").textContent).toContain("$2.26");
    expect(screen.getByTestId("tile-return").textContent).toContain("+21.10%");
    expect(screen.queryByTestId("tile-max-loss")).toBeNull();
  });

  it("shows a scalp's return on cost in the header, and keeps its contract on one line", async () => {
    stubSynced(nvda);
    renderDetail();
    expect((await screen.findByTestId("header-pct")).textContent).toBe("+21.10%");
    expect(screen.getByText("NVDA 232.5C").className).toContain("whitespace-nowrap");
  });

  it("lists every fill of a synced trade", async () => {
    stubSynced(nvda);
    renderDetail();
    const rows = await screen.findAllByTestId(/^fill-row-/);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain("Sep 28 09:31:05");
    expect(rows[0]?.textContent).toContain("BUY");
    expect(rows[3]?.textContent).toContain("SELL");
    expect(rows[3]?.textContent).toContain("1.15");
  });

  it("labels expiries and canceled fills", async () => {
    stubSynced({
      ...nvda,
      fills: [
        { ...nvda.fills[0], id: "e", kind: "expiration", price: 0 },
        { ...nvda.fills[1], id: "c", canceled: true },
      ],
    });
    renderDetail();
    expect((await screen.findByTestId("fill-row-e")).textContent).toContain("expired");
    expect(screen.getByTestId("fill-row-c").textContent).toContain("canceled");
  });

  it("says the user's edits are kept, and hands the trade back to IBKR on request", async () => {
    const fetchMock = stubSynced({ ...nvda, factsEditedAt: 5, netPnl: 50 }, [
      { tradeId: "nvda", ticker: "NVDA", netPnl: 44.74 },
    ]);
    renderDetail();
    expect(
      await screen.findByText(
        "Your edits are kept. Later syncs won't change this trade. IBKR now has +$44.74 net.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use IBKR's numbers" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/ibkr/trades/nvda/reset")),
      ).toBe(true),
    );
  });

  it("shows no banner, and asks nothing of IBKR, on a synced trade the user hasn't changed", async () => {
    const fetchMock = stubSynced(nvda);
    renderDetail();
    await screen.findByTestId("tile-contract");
    expect(screen.queryByRole("button", { name: "Use IBKR's numbers" })).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/ibkr/status"))).toBe(false);
  });

  it("puts the R row under the scalp's own tiles", async () => {
    const scalp = { ...nvda, scalp: null, scalpPrices: null };
    stubSynced({ ...scalp, risk: scalpRisk(scalp) });
    renderDetail();
    const contract = await screen.findByTestId("tile-contract");
    const risk = screen.getByTestId("tile-planned-risk");
    expect(contract.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("risk-reason").textContent).toBe("Set a stop in the review strip to get R.");
  });
});

describe("heldText", () => {
  it("reads minutes, hours and days", async () => {
    const { heldText } = await import("./ScalpTiles.js");
    expect(heldText(15 * 60_000 + 7_000)).toBe("15 min");
    expect(heldText(3 * 3_600_000 + 20 * 60_000)).toBe("3 h 20 min");
    expect(heldText(2 * 3_600_000)).toBe("2 h");
    expect(heldText(52 * 3_600_000)).toBe("2 d 4 h");
  });
});
