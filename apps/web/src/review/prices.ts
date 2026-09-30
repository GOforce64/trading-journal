import { useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, type TradeView } from "../api.js";

type PriceFillResponse = Awaited<ReturnType<typeof api.api.risk.fill.$post>>;
/** What one run of the scalp price filler did (scalp-R spec §7). */
export type PriceFillResult = Awaited<ReturnType<PriceFillResponse["json"]>>;
type PriceReason = PriceFillResult["missing"][number]["reason"];

export const PRICE_FILL_KEY = ["fill-scalp-prices"];
/** How long to wait before asking again for a price Alpaca's delay held back. */
export const RETRY_MS = 60_000;

export const PRICE_COPY = {
  fetching: "Fetching the stock price…",
  no_bars: "Alpaca has no stock price for the entry minute: type the stock at entry.",
  too_recent: "Alpaca shares prices 15 minutes late: trying again in a minute.",
} as const;

/** Fetches these scalps' missing stock prices. Every trade query refetches after; results stay for the session. */
export function useFillScalpPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PRICE_FILL_KEY,
    mutationFn: async (tradeIds: string[]): Promise<PriceFillResult> => {
      const res = await api.api.risk.fill.$post({ json: { tradeIds } });
      if (!res.ok) throw new Error(`fetching the stock price failed: ${res.status}`);
      return res.json();
    },
    // On the hook rather than on mutate, so it still runs after the page that asked has moved on.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]),
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** Whether a scalp still lacks a price the filler can fetch: the stock at entry, or, once it's closed, its range. */
export function needsPrices(trade: Pick<TradeView, "strategy" | "closedAt" | "scalpPrices">): boolean {
  if (trade.strategy !== "scalp") return false;
  const prices = trade.scalpPrices;
  return prices == null || prices.entryPrice == null || (trade.closedAt != null && prices.holdHigh == null);
}

function useFillResults(): PriceFillResult[] {
  return useMutationState({
    filters: { mutationKey: PRICE_FILL_KEY, status: "success" },
    select: (mutation) => mutation.state.data as PriceFillResult,
  });
}

/** The newest finished fill's word on this scalp: why it lacks a price, or the whole run's trouble. */
function lastWord(
  results: readonly PriceFillResult[],
  tradeId: string,
): PriceReason | { message: string } | null {
  for (let index = results.length - 1; index >= 0; index--) {
    const result = results[index];
    const found = result?.missing.find((gap) => gap.tradeId === tradeId);
    if (found) return found.reason;
    if (result?.unavailable) return { message: result.unavailable.message };
  }
  return null;
}

/** Why this scalp has no stock price yet, in the page's words (scalp-R spec §9.1). */
export function usePriceNote(tradeId: string): string {
  const fetching = useIsMutating({ mutationKey: PRICE_FILL_KEY }) > 0;
  const word = lastWord(useFillResults(), tradeId);
  if (fetching || word == null) return PRICE_COPY.fetching;
  return typeof word === "string" ? PRICE_COPY[word] : word.message;
}

/**
 * Fetches a scalp's missing prices when its page opens and whenever an edit clears them (scalp-R spec §7), once each,
 * StrictMode included. While Alpaca's delay holds a price back, it asks again a minute later.
 */
export function useAutoFillPrices(trade: TradeView): void {
  const { mutate } = useFillScalpPrices();
  const needs = needsPrices(trade);
  const results = useFillResults();
  const waiting = lastWord(results, trade.id) === "too_recent";
  // The trade this page last asked for, so StrictMode's second run asks nothing.
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (!needs) {
      asked.current = null;
      return;
    }
    if (asked.current === trade.id) return;
    asked.current = trade.id;
    mutate([trade.id]);
  }, [needs, trade.id, mutate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each finished fill starts the wait again
  useEffect(() => {
    if (!needs || !waiting) return;
    const timer = setTimeout(() => mutate([trade.id]), RETRY_MS);
    return () => clearTimeout(timer);
  }, [needs, waiting, trade.id, mutate, results.length]);
}
