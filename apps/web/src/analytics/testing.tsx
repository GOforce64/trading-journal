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
  /** A scalp's R, as the server works it out; absent means no R. */
  r?: number | null;
  /** Why a scalp has no R, as the server says. */
  problem?: string | null;
  setupId?: string | null;
  grade?: string | null;
  tagIds?: string[];
  right?: "C" | "P";
  /** The entry premium; 1 by default. */
  openPrice?: number;
  /** A scalp's fetched stock prices; present by default, so pages don't ask the filler. */
  scalpPrices?: unknown;
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
    grade: spec.grade ?? null,
    setupId: spec.setupId ?? null,
    excluded: spec.excluded ?? false,
    excludeReason: null,
    tagIds: spec.tagIds ?? [],
    legs: [
      {
        id: `${spec.id}-l1`,
        right: spec.right ?? "C",
        strike: 10,
        expiry: spec.expiry ?? "2026-09-04",
        quantity: fly ? -contracts : contracts,
        multiplier: 100,
        openPrice: spec.openPrice ?? 1,
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
    risk:
      spec.r === undefined && spec.problem === undefined
        ? null
        : { r: spec.r ?? null, problem: spec.problem ?? null },
    scalpPrices:
      spec.scalpPrices !== undefined
        ? spec.scalpPrices
        : fly
          ? null
          : { entryPrice: 10, holdHigh: 11, holdLow: 9, optionHigh: 1.5, optionLow: 0.5 },
  };
}

export interface Taxonomy {
  setups?: unknown[];
  tags?: unknown[];
}

/**
 * Answers the trade list with `trades`, the review queue with `pending`, setups and tags with `taxonomy`'s, option
 * quotes with none (a key is set up), and the scalp price filler with nothing filled.
 */
export function stubTrades(trades: unknown[], pending: unknown[] = [], taxonomy: Taxonomy = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    let body: unknown = trades;
    if (url.includes("/api/option-quotes")) body = { quotes: {}, available: true };
    else if (url.includes("review=pending")) body = pending;
    else if (url.includes("/api/setups")) body = taxonomy.setups ?? [];
    else if (url.includes("/api/tags")) body = taxonomy.tags ?? [];
    else if (url.includes("/api/risk/fill")) body = { filled: 0, missing: [], unavailable: null };
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
