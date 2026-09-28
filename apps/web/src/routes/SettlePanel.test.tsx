import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { SettlePanel } from "./SettlePanel.js";

const leg = (id: string, right: string, strike: number, quantity: number, openPrice: number) => ({
  id,
  tradeId: "bb",
  right,
  strike,
  expiry: "2026-09-25",
  quantity,
  multiplier: 100,
  openPrice,
  closePrice: null as number | null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

/** BB from the real journal (spec §3): open, expired 2026-09-25, $5 entry fees. */
const BB = {
  id: "bb",
  strategy: "iron_fly",
  underlying: "BB",
  closedAt: null,
  netPnl: null,
  fees: 5,
  feesOpen: 5,
  feesClose: 0,
  legs: [
    leg("b1", "C", 8.5, -6, 0.48),
    leg("b2", "P", 8.5, -6, 0.6),
    leg("b3", "C", 12, 6, 0.04),
    leg("b4", "P", 6, 6, 0.02),
  ],
} as unknown as TradeView;

const CLOSED_AT_821 = { symbol: "BB", date: "2026-09-25", close: 8.21, unavailable: null };

function stub(close: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const body = path.startsWith("/api/close/")
      ? close
      : path === "/api/moves/fill"
        ? { filled: 1, missing: [], unavailable: null }
        : { ok: true };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(trade: TradeView = BB) {
  const onEdit = vi.fn();
  const onEditSettled = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettlePanel trade={trade} onEdit={onEdit} onEditSettled={onEditSettled} />
    </QueryClientProvider>,
  );
  return { onEdit, onEditSettled };
}

afterEach(() => vi.unstubAllGlobals());

describe("SettlePanel", () => {
  it("proposes BB's exits at intrinsic value from the expiry-day close", async () => {
    const fetchMock = stub(CLOSED_AT_821);
    renderPanel();
    expect(
      await screen.findByText("BB closed at $8.21 on Sep 25. Proposed exits at intrinsic value:"),
    ).toBeTruthy();
    const shortPut = screen.getByTestId("settle-row-b2").textContent;
    expect(shortPut).toContain("0.29");
    expect(shortPut).toContain("(in the money: assigned, not cash)");
    expect(screen.getByTestId("settle-row-b1").textContent).not.toContain("assigned");
    expect(screen.getByText(/Net P&L if saved/).textContent).toContain(
      "+$433.00 (612 credit − 174 to close − 5 fees)",
    );
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/close/BB?date=2026-09-25")),
    ).toBe(true);
  });

  it("saves the exits in one PATCH, then fetches the exit stock price", async () => {
    const fetchMock = stub(CLOSED_AT_821);
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Save these exits" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/moves/fill"))).toBe(true),
    );
    const patch = fetchMock.mock.calls.find((call) => String(call[1]?.method).toUpperCase() === "PATCH");
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body).toMatchObject({ closedAt: Date.UTC(2026, 8, 25, 20, 0), netPnl: 433, feesClose: 0 });
    expect(body.legs.map((each: { closePrice: number }) => each.closePrice)).toEqual([0, 0.29, 0, 0]);
    expect(body.fees).toBeUndefined();
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/moves/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["bb"] });
  });

  it("keeps a wing sold before expiry, and nets it in", async () => {
    stub(CLOSED_AT_821);
    const legs = BB.legs.map((each) => (each.id === "b4" ? { ...each, closePrice: 0.01 } : each));
    renderPanel({ ...BB, legs } as TradeView);
    expect((await screen.findByTestId("settle-row-b4")).textContent).toContain("(closed before expiry)");
    expect(screen.getByText(/Net P&L if saved/).textContent).toContain("+$439.00");
  });

  it("offers Edit, and says why, when Alpaca has no close", async () => {
    stub({ symbol: "BB", date: "2026-09-25", close: null, unavailable: null });
    const { onEdit } = renderPanel();
    expect(
      await screen.findByText("Alpaca has no close for BB on Sep 25, so type the exits in Edit."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save these exits" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith("bb");
  });

  it("passes on the server's reason, such as a missing key", async () => {
    stub({
      symbol: "BB",
      date: "2026-09-25",
      close: null,
      unavailable: { reason: "no_key", message: "Add an Alpaca key in Settings to settle from the close." },
    });
    renderPanel();
    expect(await screen.findByText("Add an Alpaca key in Settings to settle from the close.")).toBeTruthy();
  });

  it("opens the edit form on the proposal", async () => {
    stub(CLOSED_AT_821);
    const { onEditSettled } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Edit them first" }));
    expect(onEditSettled).toHaveBeenCalledWith("bb");
  });
});
