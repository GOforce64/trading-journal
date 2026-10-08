import { useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type TradeView } from "../api.js";

type PriceFillResponse = Awaited<ReturnType<typeof api.api.risk.fill.$post>>;
/** What one run of the scalp price filler did (scalp-R spec §7). */
export type PriceFillResult = Awaited<ReturnType<PriceFillResponse["json"]>>;
type PriceReason = PriceFillResult["missing"][number]["reason"];

export const PRICE_FILL_KEY = ["fill-scalp-prices"];
/** The filler takes at most this many ids a request. */
const BATCH = 1000;
/** How long to wait before asking again for a price Alpaca's delay held back. */
export const RETRY_MS = 60_000;

export const PRICE_COPY = {
  fetching: "Fetching the stock price…",
  failed: "Couldn't fetch the stock price: trying again in a minute.",
  no_bars: "Alpaca has no stock price for the entry minute: type the stock at entry.",
  too_recent: "Alpaca shares prices 15 minutes late: trying again in a minute.",
} as const;

/** Fetches these scalps' missing stock prices. Every trade query refetches after; results stay for the session. */
export function useFillScalpPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PRICE_FILL_KEY,
    mutationFn: async (tradeIds: string[]): Promise<PriceFillResult> => {
      // The server takes 1,000 ids a request; a longer list, such as a first sync's, goes in batches answered as one.
      let merged: PriceFillResult = { filled: 0, missing: [], optionMissing: [], unavailable: null };
      for (let start = 0; start < tradeIds.length; start += BATCH) {
        const res = await api.api.risk.fill.$post({
          json: { tradeIds: tradeIds.slice(start, start + BATCH) },
        });
        if (!res.ok) throw new Error(`fetching the stock price failed: ${res.status}`);
        const result = await res.json();
        merged = {
          filled: merged.filled + result.filled,
          missing: [...merged.missing, ...result.missing],
          optionMissing: [...merged.optionMissing, ...result.optionMissing],
          unavailable: result.unavailable,
        };
        if (result.unavailable) break;
      }
      return merged;
    },
    // On the hook rather than on mutate, so it still runs after the page that asked has moved on. A run that
    // stored nothing (Alpaca's delay held every price back) changes no trade, so nothing refetches.
    onSettled: (result) =>
      result && result.filled === 0
        ? undefined
        : Promise.all([
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

/** A finished fill: the ids it asked for, and its answer, or null when the request itself failed. */
interface FillOutcome {
  tradeIds: readonly string[];
  result: PriceFillResult | null;
}

function useFillResults(): FillOutcome[] {
  return useMutationState({
    filters: { mutationKey: PRICE_FILL_KEY },
    select: (mutation) => ({
      status: mutation.state.status,
      tradeIds: (mutation.state.variables as string[] | undefined) ?? [],
      result: mutation.state.status === "success" ? (mutation.state.data as PriceFillResult) : null,
    }),
  }).filter((outcome) => outcome.status === "success" || outcome.status === "error");
}

/**
 * The newest finished fill's word on this scalp: why it lacks a price, the whole run's trouble, or "failed" when the
 * request asking for it failed (a 500, the network).
 */
function lastWord(
  outcomes: readonly FillOutcome[],
  tradeId: string,
): PriceReason | "failed" | { message: string } | null {
  for (let index = outcomes.length - 1; index >= 0; index--) {
    const outcome = outcomes[index];
    if (!outcome) continue;
    if (!outcome.result) {
      if (outcome.tradeIds.includes(tradeId)) return "failed";
      continue;
    }
    const found = outcome.result.missing.find((gap) => gap.tradeId === tradeId);
    if (found) return found.reason;
    if (outcome.result.unavailable) return { message: outcome.result.unavailable.message };
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

/** Why a closed scalp's MAE and MFE wait for the hold's range, in the tiles' small print (scalp-R spec §9.1). */
export const RANGE_COPY = {
  fetching: "fetching the stock's range…",
  failed: "couldn't fetch the stock's range",
  too_recent: "waits for Alpaca's 15-minute delay",
  no_bars: "Alpaca has no bars for the hold",
  unavailable: "needs the stock's range",
} as const;

/** The range's word for this scalp: fetching, held back by Alpaca's delay, or missing. */
export function useRangeNote(tradeId: string): string {
  const fetching = useIsMutating({ mutationKey: PRICE_FILL_KEY }) > 0;
  const word = lastWord(useFillResults(), tradeId);
  if (fetching || word == null) return RANGE_COPY.fetching;
  return typeof word === "string" ? RANGE_COPY[word] : RANGE_COPY.unavailable;
}

/**
 * Fetches a scalp's missing prices when its page opens and whenever an edit clears them (scalp-R spec §7), once each,
 * StrictMode included. While Alpaca's delay holds a price back, it asks again a minute later.
 */
export function useAutoFillPrices(trade: TradeView): void {
  const { mutate } = useFillScalpPrices();
  const needs = needsPrices(trade);
  const results = useFillResults();
  // Alpaca's delay held the price back, or the request failed: either way, ask again a minute later.
  const word = lastWord(results, trade.id);
  const waiting = word === "too_recent" || word === "failed";
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

/** The backfill's words when the filler can't run (scalp-analytics spec §6.2). */
export const BACKFILL_COPY = {
  no_key: "Add an Alpaca key in Settings to fetch the missing stock prices.",
  unreachable: "Alpaca didn't answer: reload to try again.",
  failed: "Couldn't fetch stock prices: reload to try again.",
} as const;

export interface BackfillState {
  /** How many scalps a fill is running for; 0 when none is. */
  fetching: number;
  /** Why the last fill couldn't run, in the page's words. */
  problem: string | null;
}

/**
 * Fetches every scalp's missing stock prices once per visit (scalp-analytics spec §8), so scalps reviewed before R
 * existed get their R without opening each page. Scalps Alpaca's delay held back are asked about again a minute later.
 */
export function useBackfillPrices(trades: readonly TradeView[] | undefined): BackfillState {
  const { mutateAsync } = useFillScalpPrices();
  const [state, setState] = useState<BackfillState>({ fetching: 0, problem: null });
  const [recent, setRecent] = useState<string[]>([]);
  // Whether this visit has asked, so StrictMode's second run and later refetches ask nothing.
  const asked = useRef(false);

  const run = useCallback(
    async (ids: string[]) => {
      setState({ fetching: ids.length, problem: null });
      let problem: string | null = null;
      const later: string[] = [];
      try {
        const result = await mutateAsync(ids);
        if (result.unavailable) problem = BACKFILL_COPY[result.unavailable.reason];
        for (const gap of result.missing) if (gap.reason === "too_recent") later.push(gap.tradeId);
      } catch {
        problem = BACKFILL_COPY.failed;
      }
      setState({ fetching: 0, problem });
      setRecent(later);
    },
    [mutateAsync],
  );

  useEffect(() => {
    if (!trades || asked.current) return;
    asked.current = true;
    const ids = trades.filter(needsPrices).map((trade) => trade.id);
    if (ids.length > 0) void run(ids);
  }, [trades, run]);

  useEffect(() => {
    if (recent.length === 0) return;
    const timer = setTimeout(() => void run(recent), RETRY_MS);
    return () => clearTimeout(timer);
  }, [recent, run]);

  return state;
}
