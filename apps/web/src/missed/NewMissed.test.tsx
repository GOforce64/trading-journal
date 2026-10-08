import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChartEditing } from "../chart/drag.js";
import { NewMissed } from "./NewMissed.js";

const charts: {
  props: {
    levels?: { editing: ChartEditing };
    emptyText?: string;
    trade?: { openedAt: number };
    points?: readonly unknown[];
    context?: readonly { tradeId: string }[];
    showDay?: boolean;
  } | null;
} = { props: null };

vi.mock("../chart/TradeCharts.js", () => ({
  TradeCharts: (props: typeof charts.props) => {
    charts.props = props;
    return <div data-testid="charts" />;
  },
}));

/** A taken scalp from the same day, which the chart shows faintly. */
const DAY_TRADES = [
  {
    id: "t1",
    strategy: "scalp",
    book: "live",
    underlying: "NVDA",
    openedAt: nyWallClock("2026-09-30", 10 * 60 + 4),
    closedAt: nyWallClock("2026-09-30", 10 * 60 + 16),
    netPnl: 186.4,
    legs: [{ right: "C", strike: 180, quantity: 3 }],
    risk: null,
    missed: null,
  },
];

function setup() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      else if (String(input).includes("/api/trades"))
        return new Response(JSON.stringify(DAY_TRADES), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ id: "new-1" }), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NewMissed symbol="NVDA" date="2026-09-30" onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { posts, onCreated };
}

afterEach(() => {
  vi.unstubAllGlobals();
  charts.props = null;
});

describe("NewMissed", () => {
  it("opens the day's chart ready to place the entry", () => {
    setup();
    expect(charts.props?.levels?.editing.placing).toBe("entry");
    expect(charts.props?.trade?.openedAt).toBe(nyWallClock("2026-09-30", 9 * 60 + 30));
    expect(charts.props?.emptyText).toBe("No bars for NVDA on Sep 30. Check the ticker.");
    expect(screen.getByText("Click the chart to place the entry")).toBeTruthy();
  });

  it("draws no open and close marks for the session it spans", () => {
    setup();
    expect(charts.props?.points).toEqual([]);
  });

  it("creates the trade from the first click, then opens it", async () => {
    const { posts, onCreated } = setup();
    const at = nyWallClock("2026-09-30", 9 * 60 + 41);
    act(() => charts.props?.levels?.editing.onPlacePoint?.("entry", at, 178.42));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-1"));
    expect(posts).toEqual([
      {
        strategy: "scalp",
        book: "missed",
        underlying: "NVDA",
        openedAt: at,
        missed: {
          direction: "long",
          entryPrice: 178.42,
          stopPrice: null,
          targetPrice: null,
          exitPrice: null,
        },
      },
    ]);
  });

  it("takes a typed entry when the chart has nothing to click", async () => {
    const { posts, onCreated } = setup();
    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Entry time"), { target: { value: "09:41" } });
    fireEvent.change(screen.getByLabelText("Entry price"), { target: { value: "178.42" } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-1"));
    expect(posts).toMatchObject([
      { openedAt: nyWallClock("2026-09-30", 9 * 60 + 41), missed: { entryPrice: 178.42 } },
    ]);
  });

  it("won't create a trade from a typed time that isn't on the clock", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Entry time"), { target: { value: "25:00" } });
    fireEvent.change(screen.getByLabelText("Entry price"), { target: { value: "178.42" } });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Type a time like 09:41")).toBeTruthy();
  });

  it("keeps the entry on the day picked: a click on the warm-up days says so and creates nothing", async () => {
    const { posts } = setup();
    act(() =>
      charts.props?.levels?.editing.onPlacePoint?.("entry", nyWallClock("2026-09-29", 15 * 60), 177.1),
    );
    expect(await screen.findByText("Place it on Sep 30")).toBeTruthy();
    expect(posts).toEqual([]);
  });

  it("shows the day's other trades faintly on the chart", async () => {
    setup();
    expect(charts.props?.showDay).toBe(true);
    await waitFor(() => expect(charts.props?.context?.map((mark) => mark.tradeId)).toContain("t1"));
  });
});
