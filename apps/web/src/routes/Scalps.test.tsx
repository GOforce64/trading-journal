import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** Answers the scalps, the scalps waiting (`pending`), and an empty setup list. */
function setup(
  onNewScalp?: () => void,
  pending: unknown[] = [scalp],
  url: { tab?: "review"; onTab?: (tab: "review" | undefined) => void } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const body = url.includes("/api/setups") ? [] : url.includes("review=pending") ? pending : [scalp];
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Scalps onNewScalp={onNewScalp} tab={url.tab} onTab={url.onTab} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Scalps", () => {
  it("shows each scalp's return on the premium paid, under Return", async () => {
    setup();
    // +$44.74 on 2 × 100 × 1.06 = $212 paid.
    expect((await screen.findByTestId("pct-s1")).textContent).toBe("+21.10%");
    expect(screen.getByRole("columnheader", { name: "Return" })).toBeTruthy();
  });

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

  it("counts the scalps to review, and lists them on their own tab", async () => {
    const fetchMock = setup();
    fireEvent.click(await screen.findByRole("button", { name: "To review (1)" }));
    expect(await screen.findByText("To review")).toBeTruthy();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]).includes("review=pending") && String(call[0]).includes("strategy=scalp"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("NVDA")).toBeTruthy();
  });

  it("keeps its tab in the URL, so a reload or a link opens To review", async () => {
    const onTab = vi.fn();
    setup(undefined, [scalp], { tab: "review", onTab });
    expect(await screen.findByText("To review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onTab).toHaveBeenCalledWith(undefined);
    fireEvent.click(await screen.findByRole("button", { name: "To review (1)" }));
    expect(onTab).toHaveBeenLastCalledWith("review");
  });

  it("says so when nothing waits", async () => {
    setup(undefined, []);
    fireEvent.click(await screen.findByRole("button", { name: "To review (0)" }));
    expect(await screen.findByText("Nothing to review.")).toBeTruthy();
  });
});
