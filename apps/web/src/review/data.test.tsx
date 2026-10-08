import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSaveTrade } from "./data.js";

afterEach(() => vi.unstubAllGlobals());

describe("useSaveTrade", () => {
  it("shows a missed trade's moved point at once, keeping its other levels", async () => {
    // The save never answers, so what the page shows is the optimistic trade.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const missed = {
      direction: "long",
      entryPrice: 178.42,
      stopPrice: 177.8,
      targetPrice: null,
      exitPrice: 179.9,
    };
    client.setQueryData(["trade", "m1"], {
      id: "m1",
      book: "missed",
      openedAt: 1_000,
      closedAt: 2_000,
      missed,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveTrade("m1"), { wrapper });
    act(() => result.current.mutate({ openedAt: 1_060, missed: { entryPrice: 178.6 } }));
    await waitFor(() =>
      expect(client.getQueryData(["trade", "m1"])).toMatchObject({
        openedAt: 1_060,
        closedAt: 2_000,
        missed: { ...missed, entryPrice: 178.6 },
      }),
    );
  });
});
