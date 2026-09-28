import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

/** Epoch ms for a New York wall-clock time in daylight time (UTC−4). */
export const ny = (stamp: string) => Date.parse(`${stamp.replace(" ", "T")}:00-04:00`);

interface RowSpec {
  id: string;
  underlying: string;
  opened: string;
  /** Null for an open trade. */
  closed: string | null;
  netPnl: number | null;
  fees?: number;
  book?: "live" | "paper";
  excluded?: boolean;
  expiry?: string;
  contracts?: number;
  creditPerShare?: number;
  strategy?: "iron_fly" | "scalp";
  /** Fly detail fields to set, such as typed moves or stock prices. */
  fly?: Record<string, unknown>;
}

/** A trade as GET /api/trades returns it: a balanced 9 / 10 / 11 fly unless the strategy says scalp. */
export function tradeRow(spec: RowSpec) {
  const fly = spec.strategy !== "scalp";
  const contracts = spec.contracts ?? 1;
  return {
    id: spec.id,
    strategy: fly ? "iron_fly" : "scalp",
    book: spec.book ?? "paper",
    underlying: spec.underlying,
    underlyingName: null,
    structureLabel: fly ? "Short Iron Butterfly" : null,
    openedAt: ny(spec.opened),
    closedAt: spec.closed ? ny(spec.closed) : null,
    netPnl: spec.netPnl,
    fees: spec.fees ?? 4,
    feesOpen: null,
    feesClose: null,
    notes: null,
    grade: null,
    excluded: spec.excluded ?? false,
    excludeReason: null,
    tagIds: [],
    legs: [
      {
        id: `${spec.id}-l1`,
        right: "C",
        strike: 10,
        expiry: spec.expiry ?? "2026-09-04",
        quantity: fly ? -contracts : contracts,
        multiplier: 100,
        openPrice: 1,
        closePrice: spec.closed ? 0.5 : null,
      },
    ],
    ironFly: fly
      ? {
          bodyPutStrike: 10,
          bodyCallStrike: 10,
          putWingStrike: 9,
          callWingStrike: 11,
          contracts,
          creditPerShare: spec.creditPerShare ?? 2.04,
          netCost: null,
          earningsDate: null,
          earningsTiming: null,
          impliedMovePct: null,
          actualMovePct: null,
          ivBefore: null,
          ivAfter: null,
          underlyingPriceEntry: null,
          underlyingPriceExit: null,
          sourceNotes: null,
          ...spec.fly,
        }
      : null,
    metrics: null,
  };
}

/** Answers the trade list with `trades`, and option quotes with none (a key is set up). */
export function stubTrades(trades: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const body = String(input).includes("/api/option-quotes") ? { quotes: {}, available: true } : trades;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Renders inside a fresh QueryClient; a `wrapper` keeps the provider when a test calls `rerender`. */
export function renderWithClient(ui: ReactElement): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
