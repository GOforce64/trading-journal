import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { QueueBar } from "./QueueBar.js";

const at = (minute: number) => Date.UTC(2026, 8, 28, 13, 30 + minute);
const scalp = (id: string, minute: number, review: unknown = { status: "pending", missing: ["stop"] }) =>
  ({ id, openedAt: at(minute), review }) as unknown as TradeView;
const PENDING = [scalp("a", 1), scalp("b", 5), scalp("c", 9)];

function renderBar(trade: TradeView, pending: TradeView[] = PENDING) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(pending), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onOpenTrade = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueueBar trade={trade} onOpenTrade={onOpenTrade} />
    </QueryClientProvider>,
  );
  return { fetchMock, onOpenTrade };
}

afterEach(() => vi.unstubAllGlobals());

describe("QueueBar", () => {
  it("shows a pending scalp's place and what it needs, with the way on both sides", async () => {
    const { fetchMock, onOpenTrade } = renderBar(
      scalp("b", 5, { status: "pending", missing: ["setup", "stop"] }),
    );
    const bar = await screen.findByTestId("queue-bar");
    await waitFor(() => expect(bar.textContent).toContain("2 of 3"));
    expect(bar.textContent).toContain("TO REVIEW");
    expect(bar.textContent).toContain("needs a setup and a stop");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
    expect(onOpenTrade.mock.calls).toEqual([["c"], ["a"]]);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("strategy=scalp");
    expect(url).toContain("review=pending");
  });

  it("wraps from the newest scalp to the oldest", async () => {
    const { onOpenTrade } = renderBar(scalp("c", 9));
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("a");
  });

  it("says a reviewed scalp is done and how many are left, even before the list has caught up", async () => {
    const { onOpenTrade } = renderBar(scalp("b", 5, { status: "done", missing: [] }));
    const bar = await screen.findByTestId("queue-bar");
    expect(bar.textContent).toContain("REVIEWED ✓");
    expect(bar.textContent).toContain("2 left");
    expect(bar.textContent).not.toContain(" of ");
    expect(screen.queryByRole("button", { name: "← Prev" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("c");
  });

  it("counts the scalps waiting from one the queue doesn't apply to", async () => {
    const { onOpenTrade } = renderBar(scalp("x", 3, null));
    const bar = await screen.findByTestId("queue-bar");
    expect(bar.textContent).toContain("3 to review");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(onOpenTrade).toHaveBeenCalledWith("b");
  });

  it("shows a lone pending scalp as 1 of 1, with no way on", async () => {
    renderBar(scalp("a", 1), [scalp("a", 1)]);
    const bar = await screen.findByTestId("queue-bar");
    await waitFor(() => expect(bar.textContent).toContain("1 of 1"));
    expect(screen.queryByRole("button", { name: "Next →" })).toBeNull();
  });

  it("shows nothing on a reviewed scalp when nothing else waits", async () => {
    const { fetchMock } = renderBar(scalp("a", 1, { status: "done", missing: [] }), []);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("queue-bar")).toBeNull();
  });
});
