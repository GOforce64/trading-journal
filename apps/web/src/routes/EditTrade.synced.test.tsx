import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LOCAL, testApp } from "@tj/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditTrade } from "./EditTrade.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/importers/src/ibkr/fixtures",
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const STATEMENTS: Record<string, string> = {
  "1653147": fixture("today.xml"),
  "1653145": fixture("activity.xml"),
};

interface Summary {
  added: number;
  updated: number;
  unchanged: number;
  keptEdits: unknown[];
}

/** The real server on a fresh journal, synced from the IBKR fixtures, answering the page's requests. */
function syncedServer() {
  const app = testApp({
    ibkrConfig: () => ({
      token: "1234567890123456789012",
      todayQueryId: "1653147",
      activityQueryId: "1653145",
      since: "2026-07-01",
    }),
    flexClient: () => ({
      statement: async (queryId: string) => STATEMENTS[queryId] ?? "",
      checkQuery: async () => {},
    }),
    now: () => Date.UTC(2026, 8, 29, 1, 0),
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const headers = new Headers(init?.headers);
    headers.set("host", LOCAL.host);
    return app.request(url.pathname + url.search, { ...init, headers });
  });
  return {
    async sync() {
      const res = await app.request("/api/ibkr/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...LOCAL },
        body: JSON.stringify({ auto: false }),
      });
      return (await res.json()) as Summary;
    },
    async trades() {
      const res = await app.request("/api/trades", { headers: LOCAL });
      return (await res.json()) as { id: string; underlying: string; factsEditedAt: number | null }[];
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("EditTrade on a synced trade", () => {
  it("re-saves every synced trade unchanged without marking its facts edited, so later syncs still own it", async () => {
    const server = syncedServer();
    // NVDA, TSLA, the AA fly and CZR's open call and put.
    expect((await server.sync()).added).toBe(5);
    const synced = await server.trades();
    for (const trade of synced) {
      const onSaved = vi.fn();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <EditTrade tradeId={trade.id} onSaved={onSaved} />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(trade.id));
      unmount();
    }
    expect((await server.trades()).map((trade) => [trade.underlying, trade.factsEditedAt])).toEqual(
      synced.map((trade) => [trade.underlying, null]),
    );
    expect(await server.sync()).toMatchObject({ added: 0, updated: 0, unchanged: 5, keptEdits: [] });
  });
});
