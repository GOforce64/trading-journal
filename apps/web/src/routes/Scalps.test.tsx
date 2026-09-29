import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scalps } from "./Scalps.js";

const scalp = {
  id: "s1",
  strategy: "scalp",
  book: "paper",
  underlying: "NVDA",
  underlyingName: null,
  structureLabel: "Long call",
  source: "ibkr_flex",
  openedAt: Date.UTC(2026, 8, 28, 13, 31),
  closedAt: Date.UTC(2026, 8, 28, 13, 46),
  netPnl: 44.74,
  fees: 2.26,
  grade: null,
  notes: null,
  excluded: false,
  tagIds: [],
  ironFly: null,
  metrics: null,
  legs: [
    {
      id: "l1",
      right: "C",
      strike: 232.5,
      expiry: "2026-09-28",
      quantity: 2,
      multiplier: 100,
      openPrice: 1.06,
      closePrice: 1.295,
    },
  ],
};

function setup(onNewScalp?: () => void) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([scalp]), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Scalps onNewScalp={onNewScalp} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Scalps", () => {
  it("asks for scalps only, and lists them under its own title", async () => {
    const fetchMock = setup();
    expect(await screen.findByText("NVDA")).toBeTruthy();
    expect(screen.getByText("Scalps")).toBeTruthy();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("strategy=scalp"))).toBe(true);
    expect(screen.queryByRole("button", { name: "+ New scalp" })).toBeNull();
  });

  it("opens the scalp form from + New scalp", async () => {
    const onNewScalp = vi.fn();
    setup(onNewScalp);
    fireEvent.click(await screen.findByRole("button", { name: "+ New scalp" }));
    expect(onNewScalp).toHaveBeenCalled();
  });
});
