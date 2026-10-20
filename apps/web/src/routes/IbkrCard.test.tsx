import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IbkrCard } from "./IbkrCard.js";

const RUN_AT = Date.UTC(2026, 8, 29, 14, 32); // 10:32 ET
const summary = (overrides: Record<string, unknown> = {}) => ({
  book: "paper",
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
/** The paper account's status, as the only one set up. */
const status = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  accounts: [
    {
      book: "paper",
      since: "2026-09-28",
      lastRunAt: RUN_AT,
      lastStatus: "ok",
      lastError: null,
      lastSummary: summary(),
      ...overrides,
    },
  ],
});
const report = (...accounts: unknown[]) => ({ ran: true, changedTradeIds: [], accounts });
const LIVE = { externalId: "U7654321", kind: "live" };
const liveSummary = (overrides: Record<string, unknown> = {}) =>
  summary({
    book: "live",
    account: LIVE,
    added: 1,
    updated: 0,
    unchanged: 0,
    skipped: [],
    keptEdits: [],
    ignored: { beforeStart: 0, stock: 0, other: 0, malformed: 0 },
    ...overrides,
  });
/** Both accounts set up, with the live one's own status. */
const both = (live: Record<string, unknown> = {}) => ({
  configured: true,
  accounts: [
    status().accounts[0],
    {
      book: "live",
      since: "2026-01-02",
      lastRunAt: RUN_AT,
      lastStatus: "ok",
      lastError: null,
      lastSummary: liveSummary(),
      ...live,
    },
  ],
});
const lines = () => screen.getAllByTestId("ibkr-status").map((line) => line.textContent);

function stub(statusBody: unknown, syncBody: unknown = report(summary())) {
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
    stub({ configured: false, accounts: [] });
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
        "Paper DU1234567 · last synced 29 Sep 10:32 ET · 2 added, 1 updated, 5 unchanged",
      ),
    );
    expect(screen.getByText(/AA · 28 Sep 13:52 — already in the journal/)).toBeTruthy();
    expect(
      screen.getByText(/SPY · 28 Sep 10:00 — not an iron fly or a single option: enter it by hand/),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "NVDA" }).getAttribute("href")).toBe("/trades/t9");
    expect(screen.getByText("917 fills before the start date, 3 stock rows ignored.")).toBeTruthy();
  });

  it("groups identical skipped trades into one line with a count, so React never sees one key twice", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const twice = { reason: "duplicate", ticker: "AA", openedAt: Date.UTC(2026, 8, 28, 17, 52) };
    stub(status({ lastSummary: summary({ skipped: [twice, twice] }) }));
    renderCard();
    expect(await screen.findByText(/AA · 28 Sep 13:52 — already in the journal ×2/)).toBeTruthy();
    expect(errors.mock.calls.some((call) => String(call[0]).includes("same key"))).toBe(false);
    errors.mockRestore();
  });

  it("shows the first 5 skipped trades and counts the rest, so a year of skips stays short", async () => {
    const skipped = Array.from({ length: 8 }, (_, day) => ({
      reason: "unrecognised",
      ticker: "SPY",
      openedAt: Date.UTC(2026, 8, day + 1, 14, 0),
    }));
    stub(status({ lastSummary: summary({ skipped }) }));
    renderCard();
    expect(await screen.findByText("… and 3 more skipped")).toBeTruthy();
    expect(screen.getAllByText(/^Skipped SPY/)).toHaveLength(5);
  });

  it("counts the hidden skipped trades, not their grouped lines", async () => {
    const day = (date: number) => ({
      reason: "unrecognised",
      ticker: "SPY",
      openedAt: Date.UTC(2026, 8, date, 14, 0),
    });
    // Five lines shown, then two hidden lines of 4 identical trades each: 8 trades.
    const skipped = [1, 2, 3, 4, 5].map(day).concat(Array.from({ length: 4 }, () => [day(6), day(7)]).flat());
    stub(status({ lastSummary: summary({ skipped }) }));
    renderCard();
    expect(await screen.findByText("… and 8 more skipped")).toBeTruthy();
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
    expect(await screen.findByText(`Paper · ${message}`)).toBeTruthy();
  });

  it("says when the Activity statement failed", async () => {
    stub(status({ lastSummary: summary({ activityFailed: true }) }));
    renderCard();
    expect(await screen.findByText("The Activity statement failed; today's fills are in.")).toBeTruthy();
  });

  it("runs a sync on request", async () => {
    const fetchMock = stub(status(), report(summary({ added: 4 })));
    renderCard();
    const button = screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement;
    // Disabled until the status says IBKR is set up.
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("ibkr-status").textContent).toContain("4 added"));
    const post = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/ibkr/sync"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ auto: false });
  });

  it("shows a block per account, paper first (live-sync spec §7)", async () => {
    stub(both());
    renderCard();
    await waitFor(() =>
      expect(lines()).toEqual([
        "Paper DU1234567 · last synced 29 Sep 10:32 ET · 2 added, 1 updated, 5 unchanged",
        "Live U7654321 · last synced 29 Sep 10:32 ET · 1 added, 0 updated, 0 unchanged",
      ]),
    );
    expect(screen.getByText("IBKR sync")).toBeTruthy();
    // Paper's details stay with paper's block.
    expect(screen.getByText("917 fills before the start date, 3 stock rows ignored.")).toBeTruthy();
  });

  it("shows one account's error beside the other's counts", async () => {
    const message = "IBKR rejected the token.";
    stub(
      both({
        lastStatus: "error",
        lastError: message,
        lastSummary: liveSummary({ status: "error", account: null, error: { kind: "token", message } }),
      }),
    );
    renderCard();
    const failed = await screen.findByText(`Live · ${message}`);
    expect(failed.className).toContain("text-down");
    expect(lines()[0]).toContain("2 added, 1 updated, 5 unchanged");
  });

  it("says a configured account hasn't synced yet", async () => {
    stub(both({ lastRunAt: null, lastStatus: null, lastSummary: null }));
    renderCard();
    await waitFor(() => expect(lines()[1]).toBe("Live · Not synced yet."));
  });

  it("after Sync now, shows each account's new summary", async () => {
    stub(both(), report(summary({ added: 4 }), liveSummary({ added: 7 })));
    renderCard();
    const button = screen.getByRole("button", { name: "Sync now" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(lines()[1]).toContain("7 added"));
    expect(lines()[0]).toContain("4 added");
  });
});
