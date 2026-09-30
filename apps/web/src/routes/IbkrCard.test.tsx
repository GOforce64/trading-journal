import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IbkrCard } from "./IbkrCard.js";

const RUN_AT = Date.UTC(2026, 8, 29, 14, 32); // 10:32 ET
const summary = (overrides: Record<string, unknown> = {}) => ({
  status: "ok",
  ran: true,
  account: { externalId: "DU1234567", kind: "paper" },
  added: 2,
  updated: 1,
  unchanged: 5,
  orphaned: 0,
  skipped: [
    { reason: "duplicate", ticker: "AA", openedAt: Date.UTC(2026, 8, 28, 17, 52) },
    { reason: "unrecognised", ticker: "SPY", openedAt: Date.UTC(2026, 8, 28, 14, 0) },
  ],
  keptEdits: [{ tradeId: "t9", ticker: "NVDA", netPnl: 44.74 }],
  ignored: { beforeStart: 917, stock: 3, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: [],
  error: null,
  lastRunAt: RUN_AT,
  ...overrides,
});
const status = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  since: "2026-09-28",
  lastRunAt: RUN_AT,
  lastStatus: "ok",
  lastError: null,
  lastSummary: summary(),
  ...overrides,
});

function stub(statusBody: unknown, syncBody: unknown = summary()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/ibkr/status")
      ? statusBody
      : url.includes("/api/ibkr/sync")
        ? syncBody
        : {};
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IbkrCard />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("IbkrCard", () => {
  it("points to Settings when IBKR isn't set up", async () => {
    stub(status({ configured: false, lastRunAt: null, lastStatus: null, lastSummary: null }));
    renderCard();
    // The line reads "Loading…" until the status arrives.
    await waitFor(() =>
      expect(screen.getByTestId("ibkr-status").textContent).toBe(
        "Not set up. Add your Flex token and query IDs in Settings.",
      ),
    );
    expect((screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the last run in plain words", async () => {
    stub(status());
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId("ibkr-status").textContent).toBe(
        "Paper DU1234567 · last synced Sep 29, 10:32 ET · 2 added, 1 updated, 5 unchanged",
      ),
    );
    expect(screen.getByText(/AA · Sep 28, 13:52 — already in the journal/)).toBeTruthy();
    expect(
      screen.getByText(/SPY · Sep 28, 10:00 — not an iron fly or a single option: enter it by hand/),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "NVDA" }).getAttribute("href")).toBe("/trades/t9");
    expect(screen.getByText("917 fills before the start date, 3 stock rows ignored.")).toBeTruthy();
  });

  it("groups identical skipped trades into one line with a count, so React never sees one key twice", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const twice = { reason: "duplicate", ticker: "AA", openedAt: Date.UTC(2026, 8, 28, 17, 52) };
    stub(status({ lastSummary: summary({ skipped: [twice, twice] }) }));
    renderCard();
    expect(await screen.findByText(/AA · Sep 28, 13:52 — already in the journal ×2/)).toBeTruthy();
    expect(errors.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("shows an error the last run ended with", async () => {
    const message =
      "IBKR rejected the token (Token has expired.). It may have expired: tokens last up to a year. Generate a new one in Client Portal and save it in Settings.";
    stub(
      status({
        lastStatus: "error",
        lastError: message,
        lastSummary: summary({ status: "error", error: { kind: "token", message } }),
      }),
    );
    renderCard();
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("says when the Activity statement failed", async () => {
    stub(status({ lastSummary: summary({ activityFailed: true }) }));
    renderCard();
    expect(await screen.findByText("The Activity statement failed; today's fills are in.")).toBeTruthy();
  });

  it("runs a sync on request", async () => {
    const fetchMock = stub(status(), summary({ added: 4 }));
    renderCard();
    const button = screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement;
    // Disabled until the status says IBKR is set up.
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("ibkr-status").textContent).toContain("4 added"));
    const post = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/ibkr/sync"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ auto: false });
  });
});
