import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeDetailView } from "../api.js";
import type { ChartEditing, PointMark } from "../chart/drag.js";
import { MissedWorkspace } from "./MissedWorkspace.js";

/** What the page handed the charts last: the lines, points and editing callbacks. */
const charts: {
  props: {
    levels?: { lines: { id?: string; price: number }[]; editing: ChartEditing };
    points?: PointMark[];
    showDay?: boolean;
    daily?: boolean;
  } | null;
} = { props: null };

vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: (props: typeof charts.props) => {
    charts.props = props;
    return <div data-testid="charts" />;
  },
}));

const ENTRY = nyWallClock("2026-09-30", 9 * 60 + 41);
const EXIT = nyWallClock("2026-09-30", 9 * 60 + 58);

function missedTrade(overrides: Record<string, unknown> = {}, levels: Record<string, unknown> = {}) {
  const missed = {
    direction: "long",
    entryPrice: 178.42,
    stopPrice: 177.8,
    targetPrice: 181.2,
    exitPrice: 179.9,
    ...levels,
  };
  return {
    id: "m1",
    strategy: "scalp",
    book: "missed",
    underlying: "NVDA",
    underlyingName: "NVIDIA",
    openedAt: ENTRY,
    closedAt: missed.exitPrice == null ? null : EXIT,
    createdAt: 1,
    netPnl: null,
    fees: 0,
    grade: null,
    notes: null,
    excluded: false,
    setupId: null,
    tagIds: [],
    legs: [],
    fills: [],
    attachments: [],
    ironFly: null,
    scalp: null,
    scalpPrices: { entryPrice: null, holdHigh: 180.34, holdLow: 178.23, optionHigh: null, optionLow: null },
    risk: null,
    review: null,
    missed,
    missedRisk: { risk: 0.62, r: 2.387, plannedRR: 4.484, mae: -0.306, mfe: 3.097, problem: null },
    ...overrides,
  } as unknown as TradeDetailView;
}

const TAGS = [
  { id: "hes", name: "Hesitated", kind: "skip", archived: false },
  { id: "late", name: "Saw it late", kind: "skip", archived: false },
  { id: "calm", name: "Calm", kind: "emotion", archived: false },
];

function setup(trade = missedTrade(), deleteStatus = 200, patchRefusal: string | null = null) {
  const patches: unknown[] = [];
  const onDeleted = vi.fn();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.includes("/api/tags")) return json(TAGS);
    if (url.includes("/api/setups")) return json([]);
    if (init?.method === "DELETE")
      return new Response(JSON.stringify(deleteStatus === 200 ? { ok: true } : { error: "not found" }), {
        status: deleteStatus,
        headers: { "content-type": "application/json" },
      });
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      if (patchRefusal)
        return new Response(JSON.stringify({ error: "invalid", message: patchRefusal }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      return json(trade);
    }
    if (url.includes("/api/bars") || url.includes("/api/risk"))
      return json({ bars: [], filled: 0, missing: [] });
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["trade", trade.id], trade);
  const page = (shown: TradeDetailView) => (
    <QueryClientProvider client={client}>
      <MissedWorkspace trade={shown} onDeleted={onDeleted} />
    </QueryClientProvider>
  );
  const { rerender } = render(page(trade));
  return { patches, client, onDeleted, rerender: (next: TradeDetailView) => rerender(page(next)) };
}

const editing = () => {
  const found = charts.props?.levels?.editing;
  if (!found) throw new Error("no editing handed to the charts");
  return found;
};

afterEach(() => {
  vi.unstubAllGlobals();
  charts.props = null;
});

describe("MissedWorkspace", () => {
  it("shows the stored levels, the R line and the excursions", () => {
    setup();
    expect(screen.getByLabelText("Entry price")).toHaveProperty("value", "178.42");
    expect(screen.getByLabelText("Entry time")).toHaveProperty("value", "09:41");
    expect(screen.getByLabelText("Stop")).toHaveProperty("value", "177.80");
    expect(screen.getByLabelText("Exit time")).toHaveProperty("value", "09:58");
    expect(screen.getByText("R +2.39 · R:R 4.48")).toBeTruthy();
    expect(screen.getByText("MAE −0.31R · MFE +3.10R")).toBeTruthy();
    expect(charts.props?.daily).toBe(false);
    expect(charts.props?.showDay).toBe(true);
    expect(charts.props?.points?.map((point) => point.id)).toEqual(["entry", "exit"]);
  });

  it("saves a typed stop", async () => {
    const { patches } = setup();
    fireEvent.change(screen.getByLabelText("Stop"), { target: { value: "177.5" } });
    fireEvent.blur(screen.getByLabelText("Stop"));
    await waitFor(() => expect(patches).toEqual([{ missed: { stopPrice: 177.5 } }]));
  });

  it("flips the direction alone, leaving the stop where it is", async () => {
    const { patches } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Short" }));
    await waitFor(() => expect(patches).toEqual([{ missed: { direction: "short" } }]));
  });

  it("says the stop is on the wrong side after a flip", () => {
    setup(
      missedTrade(
        { missedRisk: { risk: null, r: null, plannedRR: null, mae: null, mfe: null, problem: "wrong_side" } },
        { direction: "short" },
      ),
    );
    expect(screen.getByText("The stop is below the entry for a short")).toBeTruthy();
  });

  it("takes the direction from the side a first stop is clicked on, then places the exit", async () => {
    const { patches } = setup(
      missedTrade(
        {
          closedAt: null,
          missedRisk: { risk: null, r: null, plannedRR: null, mae: null, mfe: null, problem: "no_stop" },
        },
        { stopPrice: null, targetPrice: null, exitPrice: null },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Stop" }));
    expect(editing().placing).toBe("stop");
    act(() => editing().onPlace("stop", 179.1));
    await waitFor(() => expect(patches).toEqual([{ missed: { stopPrice: 179.1, direction: "short" } }]));
    expect(editing().placing).toBe("exit");
  });

  it("saves a dragged exit's time and price together", async () => {
    const { patches } = setup();
    act(() => editing().onDropPoint?.("exit", EXIT + 3 * 60_000, 180.2));
    await waitFor(() =>
      expect(patches).toEqual([{ closedAt: EXIT + 3 * 60_000, missed: { exitPrice: 180.2 } }]),
    );
  });

  it("clears the exit's time and price together", async () => {
    const { patches } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear the exit" }));
    await waitFor(() => expect(patches).toEqual([{ closedAt: null, missed: { exitPrice: null } }]));
  });

  it("swaps one skip reason for another", async () => {
    const { patches } = setup(missedTrade({ tagIds: ["hes", "calm"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Saw it late" }));
    await waitFor(() => expect(patches).toEqual([{ tagIds: ["calm", "late"] }]));
  });

  it("deletes after confirming, then drops the trade from every list before leaving", async () => {
    vi.stubGlobal("confirm", () => true);
    const trade = missedTrade();
    const { client, onDeleted } = setup(trade);
    const list = ["trades", { book: "missed", all: true }];
    client.setQueryData(list, [trade]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
    expect(client.getQueryData(["trade", trade.id])).toBeUndefined();
  });

  it("says so when the delete fails, and stays", async () => {
    vi.stubGlobal("confirm", () => true);
    const { onDeleted } = setup(missedTrade(), 404);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Couldn't delete: delete failed: 404")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  const type = (label: string, text: string) => {
    const field = screen.getByLabelText(label);
    fireEvent.change(field, { target: { value: text } });
    fireEvent.blur(field);
    return field;
  };
  const justCreated = () =>
    missedTrade(
      {
        createdAt: Date.now(),
        closedAt: null,
        missedRisk: { risk: null, r: null, plannedRR: null, mae: null, mfe: null, problem: "no_stop" },
      },
      { stopPrice: null, targetPrice: null, exitPrice: null },
    );

  it("forgets a typed exit time once the exit is cleared, so a new exit needs its time again", async () => {
    const { patches, rerender } = setup();
    type("Exit time", "10:30");
    await waitFor(() => expect(patches).toEqual([{ closedAt: nyWallClock("2026-09-30", 10 * 60 + 30) }]));
    // × cleared the exit: the trade comes back without one, and the time field shows empty.
    rerender(missedTrade({}, { exitPrice: null }));
    type("Exit price", "179");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(patches).toHaveLength(1);
  });

  it("goes on to the exit when the stop being placed is typed instead", async () => {
    const { patches } = setup(justCreated());
    expect(editing().placing).toBe("stop");
    type("Stop", "177.9");
    await waitFor(() => expect(patches).toEqual([{ missed: { stopPrice: 177.9 } }]));
    expect(editing().placing).toBe("exit");
  });

  it("stops placing the target once it's typed", async () => {
    const { patches } = setup(missedTrade({}, { targetPrice: null }));
    fireEvent.click(screen.getByRole("button", { name: "+ Target" }));
    expect(editing().placing).toBe("target");
    type("Target", "181");
    await waitFor(() => expect(patches).toEqual([{ missed: { targetPrice: 181 } }]));
    expect(editing().placing).toBeNull();
  });

  it("shows a refused save under the field that sent it", async () => {
    setup(missedTrade(), 200, "The exit can't be before the entry");
    const time = type("Exit time", "09:30");
    await waitFor(() =>
      expect(time.parentElement?.textContent).toContain("The exit can't be before the entry"),
    );
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  it("keeps a dragged point on the trade's day, saying so under its time", async () => {
    const { patches } = setup(missedTrade({}, { exitPrice: null }));
    act(() => editing().onDropPoint?.("entry", nyWallClock("2026-09-29", 15 * 60), 177.1));
    const time = screen.getByLabelText("Entry time");
    await waitFor(() => expect(time.parentElement?.textContent).toContain("Place it on Sep 30"));
    expect(patches).toEqual([]);
  });
});
