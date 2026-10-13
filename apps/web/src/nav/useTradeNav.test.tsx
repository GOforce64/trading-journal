import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "../api.js";
import { listOf, QUEUE } from "./tradeList.js";
import { useTradeNav } from "./useTradeNav.js";

const at = (minute: number) => Date.UTC(2026, 8, 28, 13, 30 + minute);
const trade = (id: string, minute: number, extra: Partial<Record<string, unknown>> = {}) =>
  ({
    id,
    openedAt: at(minute),
    strategy: "scalp",
    book: "live",
    review: { status: "pending", missing: ["stop"] },
    ...extra,
  }) as unknown as TradeView;
const PENDING = [trade("a", 1), trade("b", 5), trade("c", 9)];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
afterEach(() => vi.unstubAllGlobals());
const stubQueue = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify(PENDING), { headers: { "content-type": "application/json" } }),
    ),
  );

describe("useTradeNav", () => {
  it("steps through a list of ids without wrapping", () => {
    stubQueue();
    const list = listOf([{ id: "x" }, { id: "y" }, { id: "z" }], "Journal · Paper");
    const middle = renderHook(() => useTradeNav("y", trade("y", 3), list), { wrapper }).result.current;
    expect(middle).toEqual({
      next: "z",
      prev: "x",
      place: { position: 2, total: 3, label: "Journal · Paper" },
      list,
    });
    const last = renderHook(() => useTradeNav("z", trade("z", 3), list), { wrapper }).result.current;
    expect(last.next).toBeNull();
    expect(last.prev).toBe("y");
  });

  it("follows the live queue, which wraps", async () => {
    stubQueue();
    const { result } = renderHook(() => useTradeNav("c", trade("c", 9), QUEUE), { wrapper });
    await waitFor(() => expect(result.current.next).toBe("a"));
    expect(result.current).toEqual({ next: "a", prev: "b", place: null, list: QUEUE });
  });

  it("falls back to the queue for a scalp with no list, or one not in its list", async () => {
    stubQueue();
    const none = renderHook(() => useTradeNav("b", trade("b", 5), null), { wrapper });
    await waitFor(() => expect(none.result.current.next).toBe("c"));
    expect(none.result.current.list).toEqual(QUEUE);
    const stray = renderHook(() => useTradeNav("b", trade("b", 5), listOf([{ id: "q" }], "Recent")), {
      wrapper,
    });
    await waitFor(() => expect(stray.result.current.next).toBe("c"));
  });

  it("keeps a list going past a trade that's gone", () => {
    stubQueue();
    const list = listOf([{ id: "x" }, { id: "gone" }, { id: "z" }], "Journal");
    const { result } = renderHook(() => useTradeNav("gone", undefined, list), { wrapper });
    expect(result.current).toEqual({
      next: "z",
      prev: "x",
      place: { position: 2, total: 3, label: "Journal" },
      list,
    });
  });

  it("gives an iron fly or a missed trade with no list nothing", () => {
    stubQueue();
    const fly = renderHook(
      () => useTradeNav("f", trade("f", 1, { strategy: "iron_fly", review: null }), null),
      { wrapper },
    );
    expect(fly.result.current).toEqual({ next: null, prev: null, place: null, list: null });
    const missed = renderHook(() => useTradeNav("m", trade("m", 1, { book: "missed", review: null }), null), {
      wrapper,
    });
    expect(missed.result.current.list).toBeNull();
  });
});
