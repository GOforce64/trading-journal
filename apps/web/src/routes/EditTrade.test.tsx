import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditTrade } from "./EditTrade.js";

const trade = {
  id: "t1",
  strategy: "iron_fly",
  book: "paper",
  underlying: "ACME",
  underlyingName: "Acme Corp",
  structureLabel: "Short Iron Butterfly",
  openedAt: 1787_500_000_000,
  closedAt: 1787_586_400_000,
  netPnl: -310,
  fees: 8,
  feesOpen: 5,
  feesClose: 3,
  notes: "sat on it too long",
  grade: null,
  excluded: false,
  excludeReason: null,
  tagIds: [],
  ironFly: { bodyPutStrike: 30, bodyCallStrike: 30, putWingStrike: 25, callWingStrike: 35, contracts: 3 },
  legs: [
    {
      id: "l1",
      right: "C",
      strike: 30,
      expiry: "2026-09-18",
      quantity: -3,
      multiplier: 100,
      openPrice: 1.4,
      closePrice: 2.6,
    },
    {
      id: "l2",
      right: "P",
      strike: 30,
      expiry: "2026-09-18",
      quantity: -3,
      multiplier: 100,
      openPrice: 1.1,
      closePrice: 0.2,
    },
    {
      id: "l3",
      right: "C",
      strike: 35,
      expiry: "2026-09-18",
      quantity: 3,
      multiplier: 100,
      openPrice: 0.2,
      closePrice: 0.5,
    },
    {
      id: "l4",
      right: "P",
      strike: 25,
      expiry: "2026-09-18",
      quantity: 3,
      multiplier: 100,
      openPrice: 0.2,
      closePrice: 0.02,
    },
  ],
  metrics: null,
};

const jsonResponse = () =>
  new Response(JSON.stringify(trade), { headers: { "content-type": "application/json" } });

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <EditTrade tradeId="t1" onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

afterEach(() => vi.unstubAllGlobals());

describe("EditTrade", () => {
  it("keeps the imported source notes and structure label when saving", async () => {
    const imported = {
      ...trade,
      structureLabel: "Short Iron Condor",
      ironFly: { ...trade.ironFly, sourceNotes: "from oQuants", creditPerShare: 1, netCost: -300 },
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(imported), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = setup();
    await waitFor(() => expect(screen.getByLabelText("Short call exit")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1"));
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body.structureLabel).toBe("Short Iron Condor");
    expect(body.ironFly.sourceNotes).toBe("from oQuants");
    expect(body.ironFly.putWingStrike).toBe(25);
    expect(body.ironFly.tradeId).toBeUndefined();
  });

  it("loads the trade into the builder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse()),
    );
    setup();
    await waitFor(() => expect(screen.getByLabelText("Underlying")).toBeTruthy());
    expect((screen.getByLabelText("Underlying") as HTMLInputElement).value).toBe("ACME");
    expect((screen.getByLabelText("Short call entry") as HTMLInputElement).value).toBe("1.4");
    expect((screen.getByLabelText("Long put exit") as HTMLInputElement).value).toBe("0.02");
    expect((screen.getByLabelText("Entry fees") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("Book") as HTMLSelectElement).value).toBe("paper");
  });

  it("patches the edited position and recomputes the P&L", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { onSaved } = setup();
    await waitFor(() => expect(screen.getByLabelText("Short call exit")).toBeTruthy());

    // Closed the short call cheaper than recorded: the loss should shrink.
    fireEvent.change(screen.getByLabelText("Short call exit"), { target: { value: "1.00" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("t1"));
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    const body = JSON.parse(String(patch?.[1]?.body));
    // short call +120, short put +270, long call +90, long put -54, fees -8
    expect(body.netPnl).toBe(418);
    expect(body.legs).toHaveLength(4);
    expect(body.underlying).toBe("ACME");
  });
});
