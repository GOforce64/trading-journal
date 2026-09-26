import { useQuery } from "@tanstack/react-query";
import { type MarkableLeg, nyDate, type OptionQuote, occSymbol } from "@tj/core";
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

/** Bid and ask per contract, refreshed each minute and never stored. Empty without a data key. */
export function useOptionQuotes(contracts: string[]) {
  const unique = [...new Set(contracts)].sort();
  return useQuery({
    queryKey: ["option-quotes", unique],
    queryFn: async (): Promise<Map<string, OptionQuote>> => {
      const res = await api.api["option-quotes"].$get({ query: { contracts: unique.join(",") } });
      if (!res.ok) throw new Error(`option quotes failed: ${res.status}`);
      return new Map(Object.entries((await res.json()).quotes));
    },
    enabled: unique.length > 0,
    refetchInterval: 60_000,
  });
}
