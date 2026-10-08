import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeDetailView } from "../api.js";
import type { ChartEditing } from "../chart/drag.js";
import { ScalpWorkspace } from "./ScalpWorkspace.js";

/** Every `lines` array the chart was handed, to see a redraw. */
const drawn = vi.hoisted(() => [] as unknown[]);

// The chart has its own tests; this stand-in shows its lines and can place, drag and drop them.
vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: ({
    levels,
    option,
  }: {
    levels?: { lines: { label: string; price: number }[]; editing: ChartEditing };
    option?: { view: string; onView: (view: "stock" | "option") => void };
  }) => {
    drawn.push(levels?.lines);
    const edit = levels?.editing;
    return (
      <div data-testid="trade-charts">
        <span data-testid="chart-view">{option?.view ?? "none"}</span>
        <button type="button" onClick={() => option?.onView("stock")}>
          chart: view stock
        </button>
        <button type="button" onClick={() => option?.onView("option")}>
          chart: view option
        </button>
        <span data-testid="chart-lines">
          {levels?.lines.map((line) => `${line.label} ${line.price}`).join(", ")}
        </span>
        <span data-testid="chart-placing">{edit?.placing ?? "none"}</span>
        <button type="button" onClick={() => edit?.onPlace("stop", 231.8)}>
          chart: place the stop
        </button>
        <button type="button" onClick={() => edit?.onDrag("stop", 230.9)}>
          chart: drag the stop
        </button>
        <button type="button" onClick={() => edit?.onDrop("stop", 230.5)}>
          chart: drop the stop
        </button>
        <button type="button" onClick={() => edit?.onPlace("t2", 233)}>
          chart: place T2
        </button>
        <button type="button" onClick={() => edit?.onDrag("t1", 233.5)}>
          chart: drag T1
        </button>
        <button type="button" onClick={() => edit?.onDrop("t1", 235)}>
          chart: drop T1
        </button>
        <button type="button" onClick={() => edit?.onDrag("stop", 228)}>
          chart: drag the stop to 228
        </button>
      </div>
    );
  },
}));

// The rest of the review has its own tests; here the strip shows only the levels column it's given.
vi.mock("./ReviewPanel.js", () => ({
  ReviewPanel: ({ levels }: { levels?: ReactNode }) => <div data-testid="review-panel">{levels}</div>,
}));

const LEG = {
  id: "l1",
  right: "C",
  strike: 232.5,
  expiry: "2026-09-28",
  quantity: 2,
  multiplier: 100,
  openPrice: 1.06,
  closePrice: 1.295,
};
const PRICES = { tradeId: "t1", entryPrice: 230.83, holdHigh: 233.21, holdLow: 230.71, fetchedAt: 1 };
const SCALP = {
  id: "t1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  notes: null,
  grade: null,
  setupId: null,
  excluded: false,
  reviewedAt: null,
  tagIds: [],
  legs: [LEG],
  fills: [],
  ironFly: null,
  scalp: null,
  scalpPrices: PRICES,
  metrics: null,
  review: { status: "pending", missing: ["setup", "grade", "stop"] },
  risk: null,
};
const STOCK = {
  tradeId: "t1",
  levelBasis: "stock",
  stopPrice: 231.8,
  stockEntryOverride: null,
  riskOverride: null,
  targets: [{ price: 234.5, contracts: 2 }],
};
/** The spec's worked example: in at 09:31:05, out at 09:46:12, stop 229, T1 233 ×1, T2 234.50 ×1. */
const WORKED = {
  ...SCALP,
  openedAt: Date.UTC(2026, 8, 28, 13, 31, 5),
  closedAt: Date.UTC(2026, 8, 28, 13, 46, 12),
  scalpPrices: { ...PRICES, entryPrice: 230.78 + (231.355 - 230.78) * (5 / 60) },
  scalp: {
    ...STOCK,
    stopPrice: 229,
    targets: [
      { price: 233, contracts: 1 },
      { price: 234.5, contracts: 1 },
    ],
  },
};
const liveRisk = () => screen.getByTestId("live-risk").textContent;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The contract's bars: none, unless a test gives some. */
const NO_OPTION_BARS = {
  contract: "NVDA260928C00232500",
  bars: [],
  partial: false,
  delayMinutes: 16,
  unavailable: { reason: "no_bars", message: "No option bars for NVDA260928C00232500." },
};
const OPTION_BARS = {
  ...NO_OPTION_BARS,
  bars: [{ t: Date.UTC(2026, 8, 28, 13, 31), o: 0.97, h: 1.53, l: 0.97, c: 1.1, v: 50 }],
  unavailable: null,
};

/** Answers the trade (or what `trade` makes of it now), an empty queue, the contract's bars, and patches. */
function stubApi({
  trade = SCALP as unknown,
  patch = () => json(typeof trade === "function" ? trade() : trade),
  option = NO_OPTION_BARS as unknown,
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/risk/fill"))
      return json({ filled: 0, missing: [], optionMissing: [], unavailable: null });
    if (String(input).includes("/api/bars/option/")) return json(option);
    if (String(init?.method).toUpperCase() === "PATCH") return patch();
    return json(
      String(input).includes("review=pending") ? [] : typeof trade === "function" ? trade() : trade,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patches = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls
    .filter((call) => String(call[1]?.method).toUpperCase() === "PATCH")
    .map((call) => JSON.parse(String(call[1]?.body)));

function Harness() {
  const { data } = useQuery({
    queryKey: ["trade", "t1"],
    queryFn: async () => (await (await fetch("/api/trades/t1")).json()) as TradeDetailView,
  });
  return data ? <ScalpWorkspace trade={data} /> : null;
}

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

beforeEach(() => {
  drawn.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ScalpWorkspace levels", () => {
  it("draws a saved stop and target, and shows them in the fields", async () => {
    stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId("chart-lines").textContent).toBe("STOP 231.8, T1 ×2 234.5"),
    );
    expect(field("Stop").value).toBe("231.80");
    expect(field("T1 price").value).toBe("234.50");
    expect(field("T1 contracts").value).toBe("2");
  });

  it("+ Stop opens the field and arms the chart, and a click on the chart saves the stop there", async () => {
    const fetchMock = stubApi();
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Stop" }));
    expect(document.activeElement).toBe(field("Stop"));
    expect(screen.getByTestId("chart-placing").textContent).toBe("stop");
    expect(screen.getByText("or click the chart")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "chart: place the stop" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 231.8 } }]),
    );
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
  });

  it("follows a drag in the field, and saves once when it's dropped", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "chart: drag the stop" }));
    await waitFor(() => expect(field("Stop").value).toBe("230.90"));
    expect(patches(fetchMock)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "chart: drop the stop" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 230.5 } }]),
    );
  });

  it("saves a typed price once on Enter, though the field then loses focus", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "231.75" } });
    fireEvent.keyDown(stop, { key: "Enter" });
    fireEvent.blur(stop);
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 231.75 } }]);
  });

  it("refuses a price it can't read, and 0 on stock, sending nothing", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    for (const typed of ["$231.80", "231,80", "-1"]) {
      act(() => stop.focus());
      fireEvent.change(stop, { target: { value: typed } });
      fireEvent.blur(stop);
      expect(screen.getByText("Enter a price like 231.80")).toBeTruthy();
    }
    fireEvent.change(stop, { target: { value: "0" } });
    fireEvent.blur(stop);
    expect(screen.getByText("A stock price must be above 0")).toBeTruthy();
    expect(patches(fetchMock)).toEqual([]);
  });

  it("takes 0 on the premium basis, and with no option bars draws no premium lines, saying so", async () => {
    const premium = { ...STOCK, levelBasis: "premium", stopPrice: 0.8, targets: [] };
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: premium } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    expect(screen.getByTestId("chart-lines").textContent).toBe("");
    expect(await screen.findByText("No option bars for this contract: type the levels.")).toBeTruthy();
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "0" } });
    fireEvent.blur(stop);
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "premium", stopPrice: 0 } }]),
    );
  });

  it("puts the saved price back on Esc, and clears a level with ✕", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    act(() => stop.focus());
    fireEvent.change(stop, { target: { value: "230" } });
    fireEvent.keyDown(stop, { key: "Escape" });
    expect(field("Stop").value).toBe("231.80");
    fireEvent.click(screen.getByRole("button", { name: "Remove T1" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", targets: [] } }]),
    );
  });

  it("asks before switching the basis with levels set, and does nothing if you cancel", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Premium" }));
    expect(confirm).toHaveBeenCalledWith("Switching to premium clears the stop and targets.");
    expect(patches(fetchMock)).toEqual([]);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Premium" }));
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "premium" } }]));
  });

  it("starts from the Settings default, and switches at once with nothing set", async () => {
    localStorage.setItem("tj.review", JSON.stringify({ levelBasis: "premium" }));
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const fetchMock = stubApi();
    renderWorkspace();
    expect((await screen.findByRole("button", { name: "Premium" })).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
    // Premium levels are typed: the chart isn't armed.
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Stock" }));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock" } }]));
  });

  it("puts the line back where it's saved when a save is refused, saying why", async () => {
    stubApi({
      trade: { ...SCALP, scalp: STOCK },
      patch: () => json({ error: "invalid", message: "A stock price must be above 0" }, 400),
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "chart: drop the stop" }));
    const before = drawn.at(-1);
    expect(await screen.findByText("Couldn't save: A stock price must be above 0")).toBeTruthy();
    // A fresh array of the saved lines: the chart redraws them where they're saved.
    await waitFor(() => expect(drawn.at(-1)).not.toBe(before));
    expect(drawn.at(-1)).toEqual(before);
    await waitFor(() => expect(field("Stop").value).toBe("231.80"));
  });

  it("puts the queue bar above the charts", async () => {
    stubApi();
    renderWorkspace();
    const bar = await screen.findByTestId("queue-bar");
    expect(
      bar.compareDocumentPosition(screen.getByTestId("trade-charts")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bar.textContent).toContain("1 of 1");
  });

  it("asks for the scalp's stock prices when its page opens without them", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalpPrices: null } });
    renderWorkspace();
    await waitFor(() => {
      const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/risk/fill"));
      expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["t1"] });
    });
  });

  it("+ Target opens the next target with the contracts left, arms the chart, and a click saves the list", async () => {
    const fetchMock = stubApi({
      trade: { ...SCALP, scalp: { ...STOCK, targets: [{ price: 234.5, contracts: 1 }] } },
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Target" }));
    expect(document.activeElement).toBe(field("T2 price"));
    expect(field("T2 contracts").value).toBe("1");
    expect(screen.getByTestId("chart-placing").textContent).toBe("t2");
    fireEvent.click(screen.getByRole("button", { name: "chart: place T2" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        {
          scalp: {
            levelBasis: "stock",
            targets: [
              { price: 234.5, contracts: 1 },
              { price: 233, contracts: 1 },
            ],
          },
        },
      ]),
    );
  });

  it("keeps a typed target price when Tab moves to its contracts, and saves both on leaving the row", async () => {
    const fetchMock = stubApi({
      trade: {
        ...SCALP,
        legs: [{ ...LEG, quantity: 3 }],
        scalp: { ...STOCK, targets: [{ price: 234.5, contracts: 1 }] },
      },
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Target" }));
    fireEvent.change(field("T2 price"), { target: { value: "236" } });
    act(() => field("T2 contracts").focus());
    // Nothing is saved with the default 2 contracts: the row stays open for the count.
    expect(patches(fetchMock)).toEqual([]);
    expect(field("T2 price").value).toBe("236");
    fireEvent.change(field("T2 contracts"), { target: { value: "1" } });
    act(() => field("T2 contracts").blur());
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        {
          scalp: {
            levelBasis: "stock",
            targets: [
              { price: 234.5, contracts: 1 },
              { price: 236, contracts: 1 },
            ],
          },
        },
      ]),
    );
  });

  it("drops the new target on Esc in its contracts field, as Esc in its price field does", async () => {
    const fetchMock = stubApi({
      trade: {
        ...SCALP,
        legs: [{ ...LEG, quantity: 3 }],
        scalp: { ...STOCK, targets: [{ price: 234.5, contracts: 1 }] },
      },
    });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Target" }));
    fireEvent.change(field("T2 price"), { target: { value: "236" } });
    act(() => field("T2 contracts").focus());
    fireEvent.keyDown(field("T2 contracts"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "T2 price" })).toBeNull());
    expect(patches(fetchMock)).toEqual([]);
  });

  it("builds a second edit on the first while the first is still saving", async () => {
    let answer: () => void = () => {};
    const trade = {
      ...SCALP,
      legs: [{ ...LEG, quantity: 3 }],
      scalp: {
        ...STOCK,
        targets: [
          { price: 233, contracts: 1 },
          { price: 234.5, contracts: 1 },
        ],
      },
    };
    const fetchMock = stubApi({
      trade,
      patch: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(json(trade));
        }) as unknown as Response,
    });
    renderWorkspace();
    const contracts = await screen.findByRole("textbox", { name: "T1 contracts" });
    act(() => contracts.focus());
    fireEvent.change(contracts, { target: { value: "2" } });
    act(() => contracts.blur());
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    // Before the first save answers, T2 goes: the list sent keeps T1's new contracts.
    fireEvent.click(screen.getByRole("button", { name: "Remove T2" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(2));
    expect(patches(fetchMock)[1]).toEqual({
      scalp: { levelBasis: "stock", targets: [{ price: 233, contracts: 2 }] },
    });
    act(() => answer());
  });

  it("changes a target's contracts", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    const contracts = await screen.findByRole("textbox", { name: "T1 contracts" });
    act(() => contracts.focus());
    fireEvent.change(contracts, { target: { value: "1" } });
    fireEvent.blur(contracts);
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { scalp: { levelBasis: "stock", targets: [{ price: 234.5, contracts: 1 }] } },
      ]),
    );
  });

  it("warns when the saved targets trim more than the position holds, as after a size edit", async () => {
    stubApi({
      trade: {
        ...SCALP,
        legs: [{ ...LEG, quantity: 1 }],
        scalp: {
          ...STOCK,
          targets: [
            { price: 233, contracts: 1 },
            { price: 234.5, contracts: 1 },
          ],
        },
      },
    });
    renderWorkspace();
    expect(
      await screen.findByText(
        "The targets trim 2 contracts; the position has 1. Lower a target's contracts or remove one.",
      ),
    ).toBeTruthy();
  });

  it("refuses a list that trims more than the position, sending nothing", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "+ Target" }));
    fireEvent.change(field("T2 price"), { target: { value: "236" } });
    fireEvent.keyDown(field("T2 price"), { key: "Enter" });
    expect(await screen.findByText("The targets trim 3 contracts; the position has 2.")).toBeTruthy();
    expect(patches(fetchMock)).toEqual([]);
  });

  it("follows a target's drag in its field, and saves the list once at the drop", async () => {
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: STOCK } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "chart: drag T1" }));
    await waitFor(() => expect(field("T1 price").value).toBe("233.50"));
    expect(patches(fetchMock)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "chart: drop T1" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { scalp: { levelBasis: "stock", targets: [{ price: 235, contracts: 2 }] } },
      ]),
    );
  });

  it("counts untrimmed contracts as a runner at the farthest target, and flags a target on the wrong side", async () => {
    stubApi({
      trade: {
        ...SCALP,
        legs: [{ ...LEG, quantity: 3 }],
        scalp: {
          ...STOCK,
          stopPrice: 229,
          targets: [
            { price: 230, contracts: 1 },
            { price: 234.5, contracts: 1 },
          ],
        },
      },
    });
    renderWorkspace();
    expect(await screen.findByText("1 runner, counted at T2")).toBeTruthy();
    expect(screen.getAllByText("on the wrong side")).toHaveLength(1);
  });
});

describe("ScalpWorkspace R", () => {
  it("shows the live line, and it follows a drag of the stop before anything is saved", async () => {
    const fetchMock = stubApi({ trade: WORKED });
    renderWorkspace();
    await waitFor(() => expect(liveRisk()).toBe("Risk $104.05 · R +0.43 · R:R 2.8"));
    fireEvent.click(screen.getByRole("button", { name: "chart: drag the stop to 228" }));
    await waitFor(() => expect(liveRisk()).toBe("Risk $141.22 · R +0.32 · R:R 2.0"));
    expect(patches(fetchMock)).toEqual([]);
  });

  it("gives the reason instead without a planned risk", async () => {
    stubApi({ trade: { ...WORKED, scalp: null } });
    renderWorkspace();
    await waitFor(() => expect(liveRisk()).toBe("Set a stop in the review strip to get R."));
  });

  it("types the stock at entry, refusing 0", async () => {
    const fetchMock = stubApi({ trade: WORKED });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Type the stock at entry" }));
    const stock = field("Stock at entry");
    expect(stock.value).toBe("230.83");
    fireEvent.change(stock, { target: { value: "0" } });
    fireEvent.blur(stock);
    expect(screen.getByText("A stock price must be above 0")).toBeTruthy();
    fireEvent.change(stock, { target: { value: "231" } });
    fireEvent.keyDown(stock, { key: "Enter" });
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stockEntryOverride: 231 } }]),
    );
  });

  it("shows a typed stock price, and ✕ goes back to the fetched one", async () => {
    const fetchMock = stubApi({ trade: { ...WORKED, scalp: { ...WORKED.scalp, stockEntryOverride: 231 } } });
    renderWorkspace();
    expect(await screen.findByText("231.00")).toBeTruthy();
    expect(screen.getAllByText("(typed)")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use the fetched stock price" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", stockEntryOverride: null } }]),
    );
  });

  it("types a planned risk in dollars, refusing 0, and a typed one replaces the model", async () => {
    const fetchMock = stubApi({ trade: WORKED });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Type the planned risk" }));
    const risk = field("Planned risk");
    expect(risk.value).toBe("104.05");
    fireEvent.change(risk, { target: { value: "0" } });
    fireEvent.blur(risk);
    expect(screen.getByText("A planned risk must be above 0")).toBeTruthy();
    fireEvent.change(risk, { target: { value: "120" } });
    fireEvent.keyDown(risk, { key: "Enter" });
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", riskOverride: 120 } }]),
    );
  });

  it("types nothing when ✎ is followed by a click away, so the model keeps pricing the risk", async () => {
    const fetchMock = stubApi({ trade: WORKED });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Type the planned risk" }));
    fireEvent.blur(field("Planned risk"));
    fireEvent.click(screen.getByRole("button", { name: "Type the stock at entry" }));
    fireEvent.blur(field("Stock at entry"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Stock at entry" })).toBeNull());
    expect(patches(fetchMock)).toEqual([]);
    expect(screen.queryByText("(typed)")).toBeNull();
  });

  it("prices a typed planned risk, with ✕ to go back to the model", async () => {
    const fetchMock = stubApi({ trade: { ...WORKED, scalp: { ...WORKED.scalp, riskOverride: 120 } } });
    renderWorkspace();
    await waitFor(() => expect(liveRisk()).toBe("Risk $120.00 · R +0.37 · R:R 2.4"));
    expect(screen.getByText("$120.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the model's planned risk" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ scalp: { levelBasis: "stock", riskOverride: null } }]),
    );
  });

  it("prices from a typed stock at entry when none was fetched", async () => {
    stubApi({
      trade: { ...WORKED, scalpPrices: null, scalp: { ...WORKED.scalp, stockEntryOverride: 230.83 } },
    });
    renderWorkspace();
    await waitFor(() => expect(liveRisk()).toMatch(/^Risk \$104\.\d\d · R \+0\.43 · R:R 2\.8$/));
  });
});

describe("ScalpWorkspace's option view", () => {
  const PREMIUM = { ...STOCK, levelBasis: "premium", stopPrice: 0.8, targets: [] };
  const PREMIUM_NO_STOP = { ...PREMIUM, stopPrice: null };

  it("opens a premium scalp on the option view, and follows the basis to the stock view", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    let current: unknown = { ...SCALP, scalp: PREMIUM };
    stubApi({
      trade: () => current,
      option: OPTION_BARS,
      patch: () => {
        current = { ...SCALP, scalp: { ...STOCK, stopPrice: null, targets: [] } };
        return json(current);
      },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("chart-view").textContent).toBe("option"));
    await waitFor(() => expect(screen.getByTestId("chart-lines").textContent).toBe("STOP 0.8"));
    fireEvent.click(screen.getByRole("button", { name: "Stock" }));
    await waitFor(() => expect(screen.getByTestId("chart-view").textContent).toBe("stock"));
  });

  it("draws and arms premium levels on the option view only: flipping to stock leaves nothing to click", async () => {
    stubApi({ trade: { ...SCALP, scalp: PREMIUM_NO_STOP }, option: OPTION_BARS });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("chart-view").textContent).toBe("option"));
    // Wait for the bars, which make the option chart one to place on.
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
      expect(screen.getByTestId("chart-placing").textContent).toBe("stop");
    });
    fireEvent.click(screen.getByRole("button", { name: "chart: view stock" }));
    expect(screen.getByTestId("chart-view").textContent).toBe("stock");
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
    expect(screen.getByTestId("chart-lines").textContent).toBe("");
  });

  it("brings the option view back for + Stop on a premium scalp", async () => {
    stubApi({ trade: { ...SCALP, scalp: PREMIUM_NO_STOP }, option: OPTION_BARS });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("chart-view").textContent).toBe("option"));
    fireEvent.click(screen.getByRole("button", { name: "chart: view stock" }));
    expect(screen.getByTestId("chart-view").textContent).toBe("stock");
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
      expect(screen.getByTestId("chart-placing").textContent).toBe("stop");
    });
    expect(screen.getByTestId("chart-view").textContent).toBe("option");
  });

  it("types premium levels while today's option bars haven't reached the trade, saying when they will", async () => {
    const now = new Date();
    const openedAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * 3_600_000;
    const behind = {
      ...OPTION_BARS,
      partial: true,
      bars: [{ ...OPTION_BARS.bars[0], t: openedAt - 3_600_000 }],
    };
    stubApi({ trade: { ...SCALP, openedAt, closedAt: null, scalp: PREMIUM_NO_STOP }, option: behind });
    renderWorkspace();
    expect(
      await screen.findByText(/^The option chart's bars arrive by \d\d:\d\d: type the levels or wait\.$/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
  });

  it("shows a stock scalp's levels on the option view as estimates, which can't be placed or dragged", async () => {
    stubApi({ trade: WORKED, option: OPTION_BARS });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId("chart-view").textContent).toBe("stock"));
    fireEvent.click(screen.getByRole("button", { name: "chart: view option" }));
    expect(screen.getByTestId("chart-lines").textContent).toMatch(
      /^≈ STOP 0\.54, ≈ T1 \d+\.\d+, ≈ T2 \d+\.\d+$/,
    );
    expect(screen.getByTestId("chart-placing").textContent).toBe("none");
  });
});
