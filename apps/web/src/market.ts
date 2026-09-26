import { useQuery } from "@tanstack/react-query";
import { type MarkableLeg, nyDate, type OptionQuote, occSymbol } from "@tj/core";
import { useEffect, useState } from "react";
import { api } from "./api.js";

/** Today's date in New York, where options expire. */
export const todayNy = () => nyDate(Date.now());

/** A trade is open while any leg lacks an exit price (spec §7.1). */
export const isOpen = (trade: { legs: { closePrice: number | null }[] }) =>
  trade.legs.some((leg) => leg.closePrice == null);

/** Contract codes of a trade's open, unexpired legs: the only ones worth a quote. */
export function openContracts(trade: { underlying: string; legs: MarkableLeg[] }, today: string): string[] {
  return trade.legs
    .filter((leg) => leg.closePrice == null && leg.expiry >= today)
    .map((leg) => occSymbol({ underlying: trade.underlying, ...leg }));
}

/** Live reference prices, refreshed each minute and never stored. None at all without a data key. */
export function useQuotes(symbols: string[]) {
  const unique = [...new Set(symbols)].sort();
  return useQuery({
    queryKey: ["quotes", unique],
    queryFn: async () => {
      const res = await api.api.quotes.$get({ query: { symbols: unique.join(",") } });
      if (!res.ok) throw new Error(`quotes failed: ${res.status}`);
      return (await res.json()).quotes;
    },
    enabled: unique.length > 0,
    refetchInterval: 60_000,
  });
}

/**
 * Bid and ask per contract, refreshed each minute and never stored, plus whether market data is on
 * at all: "no key" shows nothing, while "Alpaca has no quote" is worth saying.
 */
export function useOptionQuotes(contracts: string[]) {
  const unique = [...new Set(contracts)].sort();
  return useQuery({
    queryKey: ["option-quotes", unique],
    queryFn: async (): Promise<{ quotes: Map<string, OptionQuote>; available: boolean }> => {
      const res = await api.api["option-quotes"].$get({ query: { contracts: unique.join(",") } });
      if (!res.ok) throw new Error(`option quotes failed: ${res.status}`);
      const body = await res.json();
      return { quotes: new Map(Object.entries(body.quotes)), available: body.available };
    },
    enabled: unique.length > 0,
    refetchInterval: 60_000,
  });
}

/** A plain ticker such as M or BRK.B, the only thing worth asking the server about. */
export const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/** `value` once it has stopped changing for `ms`, so typing a symbol doesn't ask the server on every key. */
export function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The listed expirations and strikes for a symbol, back to `since` for a trade opened in the past. */
export function useChain(symbol: string, since: string | undefined) {
  return useQuery({
    queryKey: ["chain", symbol, since ?? ""],
    queryFn: async () => {
      const res = await api.api.chains[":symbol"].$get({ param: { symbol }, query: { since } });
      if (!res.ok) throw new Error(`chain failed: ${res.status}`);
      return res.json();
    },
    enabled: TICKER.test(symbol),
    staleTime: 15 * 60_000,
  });
}

/** The company's name from Alpaca, for filling in a blank Company field. Names don't change, so each is asked once. */
export function useCompanyName(symbol: string) {
  return useQuery({
    queryKey: ["company", symbol],
    queryFn: async () => {
      const res = await api.api.company[":symbol"].$get({ param: { symbol } });
      if (!res.ok) throw new Error(`company failed: ${res.status}`);
      return (await res.json()).name;
    },
    enabled: TICKER.test(symbol),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
