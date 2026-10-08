import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { nyWallClock } from "@tj/core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lastSession, useDayTrades } from "./data.js";

describe("lastSession", () => {
  it("is today once today's session has closed", () => {
    expect(lastSession(nyWallClock("2026-09-30", 17 * 60))).toBe("2026-09-30");
  });

  it("is the session before while today's is still trading", () => {
    expect(lastSession(nyWallClock("2026-09-30", 10 * 60))).toBe("2026-09-29");
  });

  it("skips the weekend and holidays", () => {
    expect(lastSession(nyWallClock("2026-10-03", 12 * 60))).toBe("2026-10-02");
    // Thanksgiving 2026 is Thursday Nov 26: the Friday morning after reaches back to Wednesday.
    expect(lastSession(nyWallClock("2026-11-27", 9 * 60))).toBe("2026-11-25");
  });

  it("counts a half day closed at 13:00", () => {
    expect(lastSession(nyWallClock("2026-11-27", 13 * 60 + 5))).toBe("2026-11-27");
  });
});

describe("useDayTrades", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the ticker's trades from that New York day, without the trade itself", async () => {
    const trades = [
      { id: "a", underlying: "NVDA", openedAt: nyWallClock("2026-09-30", 600) },
      { id: "b", underlying: "NVDA", openedAt: nyWallClock("2026-09-30", 640) },
      { id: "c", underlying: "NVDA", openedAt: nyWallClock("2026-09-29", 600) },
    ];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify(trades), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDayTrades("NVDA", "2026-09-30", "a"), { wrapper });
    await waitFor(() => expect(result.current.map((trade) => trade.id)).toEqual(["b"]));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("underlying=NVDA");
  });
});
