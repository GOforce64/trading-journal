import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { IntradayChart } from "../chart/IntradayChart.js";
import { intradayModel } from "../chart/model.js";
import { DEFAULT_PREFS } from "../chart/prefs.js";
import { resetLibrary, yOf } from "../chart/testing.js";
import { LevelFields } from "./LevelFields.js";
import { useLevels } from "./levels.js";

vi.mock("lightweight-charts", async (importOriginal) => {
  const { fakeLibrary } = await import("../chart/testing.js");
  return fakeLibrary(await importOriginal<typeof import("lightweight-charts")>());
});

// The seam between a focused level field and the chart (final review): the real chart over the fake library,
// the real levels and fields, and a server that keeps what it's sent.
const MODEL = intradayModel(
  [],
  { openedAt: Date.UTC(2026, 8, 28, 13, 31), closedAt: Date.UTC(2026, 8, 28, 13, 46), fills: [], legs: [] },
  3,
  DEFAULT_PREFS.emaLengths,
);

let stored: Record<string, unknown>;
let patches: Record<string, unknown>[];

function serve(scalp: Record<string, unknown> | null) {
  stored = {
    id: "t1",
    strategy: "scalp",
    book: "paper",
    underlying: "NVDA",
    closedAt: 1,
    tagIds: [],
    legs: [],
    scalp,
    review: { status: "pending", missing: ["setup", "grade", "stop"] },
  };
  patches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(init?.method).toUpperCase() === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { scalp: Record<string, unknown> };
        patches.push(body);
        // A first level creates the whole row, as the repository does.
        const row = stored.scalp ?? {
          tradeId: "t1",
          stopPrice: null,
          stockEntryOverride: null,
          riskOverride: null,
          targets: [],
        };
        stored = { ...stored, scalp: { ...(row as object), ...body.scalp } };
      }
      return new Response(JSON.stringify(stored), { headers: { "content-type": "application/json" } });
    }),
  );
}

function Page() {
  const { data } = useQuery({
    queryKey: ["trade", "t1"],
    queryFn: async () => (await (await fetch("/api/trades/t1")).json()) as TradeView,
  });
  return data ? <Levels trade={data} /> : null;
}

function Levels({ trade }: { trade: TradeView }) {
  const levels = useLevels(trade);
  return (
    <>
      <IntradayChart
        model={MODEL}
        show={DEFAULT_PREFS.show}
        fitKey={0}
        lines={levels.chart.lines}
        editing={levels.chart.editing}
      />
      <LevelFields levels={levels} />
    </>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

/** A press as the browser does it: unless the page prevents it, focus leaves the field. */
function press(target: Element, init: MouseEventInit) {
  const notPrevented = fireEvent.mouseDown(target, init);
  if (notPrevented) act(() => (document.activeElement as HTMLElement | null)?.blur());
}

const chart = () => screen.getByTestId("intraday-chart");
const stopField = () => screen.getByRole("textbox", { name: "Stop" }) as HTMLInputElement;

beforeEach(() => resetLibrary());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("a level field and the chart together", () => {
  it("lets a drag on the chart win over a focused field: it follows, and saves once, at the drop", async () => {
    serve({
      tradeId: "t1",
      levelBasis: "stock",
      stopPrice: 231.8,
      stockEntryOverride: null,
      riskOverride: null,
      targets: [],
    });
    renderPage();
    const field = await screen.findByRole("textbox", { name: "Stop" });
    act(() => field.focus());
    press(chart(), { clientX: 100, clientY: yOf(231.8), button: 0 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: yOf(230.5) });
    expect(stopField().value).toBe("230.50");
    fireEvent.mouseUp(window);
    await waitFor(() => expect(patches).toHaveLength(1));
    act(() => stopField().blur());
    await waitFor(() => expect(stopField().value).toBe("230.50"));
    expect(patches).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 230.5 } }]);
  });

  it("keeps placing after a press on the price axis", async () => {
    serve(null);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "+ Stop" }));
    expect(screen.getByTestId("placing-hint")).toBeTruthy();
    press(chart(), { clientX: 850, clientY: 100, button: 0 });
    expect(screen.getByTestId("placing-hint")).toBeTruthy();
    expect(patches).toEqual([]);
  });

  it("saves the chart's click, not text typed before it, when the field loses focus", async () => {
    serve(null);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "+ Stop" }));
    fireEvent.change(stopField(), { target: { value: "231" } });
    press(chart(), { clientX: 100, clientY: yOf(229), button: 0 });
    await waitFor(() => expect(patches).toHaveLength(1));
    act(() => stopField().blur());
    await waitFor(() => expect(stopField().value).toBe("229.00"));
    expect(patches).toEqual([{ scalp: { levelBasis: "stock", stopPrice: 229 } }]);
  });
});
