import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoSync } from "./ibkr.js";

const SUMMARY = {
  status: "ok",
  ran: true,
  account: { externalId: "DU1234567", kind: "paper" },
  added: 1,
  updated: 0,
  unchanged: 0,
  orphaned: 0,
  skipped: [],
  keptEdits: [],
  ignored: { beforeStart: 0, stock: 0, other: 0, malformed: 0 },
  activityFailed: false,
  changedTradeIds: ["t1"],
  error: null,
  lastRunAt: 1,
};

function AutoSync() {
  useAutoSync();
  return null;
}

afterEach(() => vi.unstubAllGlobals());

describe("useAutoSync", () => {
  it("asks the server for one automatic sync per page load, even under StrictMode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const body = String(input).includes("/api/moves/fill")
        ? { filled: 0, missing: [], unavailable: null }
        : SUMMARY;
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <AutoSync />
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/moves/fill"))).toBe(true),
    );
    const syncs = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/ibkr/sync"));
    expect(syncs).toHaveLength(1);
    expect(JSON.parse(String(syncs[0]?.[1]?.body))).toEqual({ auto: true });
    // Trades the sync added get their stock prices, as after a save.
    const fill = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/moves/fill"));
    expect(JSON.parse(String(fill?.[1]?.body))).toEqual({ tradeIds: ["t1"] });
  });
});
