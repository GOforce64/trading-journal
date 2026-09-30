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
  }: {
    levels?: { lines: { label: string; price: number }[]; editing: ChartEditing };
  }) => {
    drawn.push(levels?.lines);
    const edit = levels?.editing;
    return (
      <div data-testid="trade-charts">
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers the trade, an empty queue, and patches. */
function stubApi({ trade = SCALP as unknown, patch = () => json(trade) } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/risk/fill")) return json({ filled: 0, missing: [], unavailable: null });
    if (String(init?.method).toUpperCase() === "PATCH") return patch();
    return json(String(input).includes("review=pending") ? [] : trade);
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

  it("takes 0 on the premium basis, and draws no premium lines", async () => {
    const premium = { ...STOCK, levelBasis: "premium", stopPrice: 0.8, targets: [] };
    const fetchMock = stubApi({ trade: { ...SCALP, scalp: premium } });
    renderWorkspace();
    const stop = await screen.findByRole("textbox", { name: "Stop" });
    expect(screen.getByTestId("chart-lines").textContent).toBe("");
    expect(screen.getByText("Premium levels aren't drawn yet: there's no option chart.")).toBeTruthy();
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
