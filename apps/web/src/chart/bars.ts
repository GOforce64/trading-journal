import { useQuery } from "@tanstack/react-query";
import { addDays, MAX_BAR_DAYS, nyDate } from "@tj/core";
import { api } from "../api.js";
import { TICKER, todayNy } from "../market.js";

/**
 * The days a trade's intraday charts ask for (spec §6): the warm-up week before it through its last day, at most
 * MAX_BAR_DAYS, so a trade held for months shows its last weeks.
 */
export function barRange(trade: { openedAt: number; closedAt: number | null }) {
  const firstDay = nyDate(trade.openedAt);
  const lastDay = trade.closedAt != null ? nyDate(trade.closedAt) : todayNy();
  const weekBefore = addDays(firstDay, -7);
  const earliest = addDays(lastDay, -MAX_BAR_DAYS);
  return { firstDay, lastDay, from: weekBefore > earliest ? weekBefore : earliest };
}

/**
 * The trade's 1-minute bars (spec §6). A live trade refreshes each minute; past days never change. An answer still
 * partial once the day is over (fetched just before 20:16) is fetched again until it's final.
 */
export function useMinuteBars(symbol: string, from: string, to: string, live: boolean) {
  return useQuery({
    queryKey: ["bars", symbol, from, to],
    enabled: TICKER.test(symbol),
    staleTime: (query) => (live || query.state.data?.partial ? 30_000 : Number.POSITIVE_INFINITY),
    refetchInterval: (query) => (live || query.state.data?.partial ? 60_000 : false),
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars[":symbol"].$get({ param: { symbol }, query: { from, to } });
      if (!res.ok) throw new Error(`bars failed: ${res.status}`);
      return res.json();
    },
  });
}

/** Two years of daily bars up to the trade's last day. */
export function useDailyBars(symbol: string, to: string) {
  return useQuery({
    queryKey: ["daily-bars", symbol, to],
    enabled: TICKER.test(symbol),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars[":symbol"].daily.$get({ param: { symbol }, query: { to } });
      if (!res.ok) throw new Error(`daily bars failed: ${res.status}`);
      return res.json();
    },
  });
}

/** The contract's 1-minute bars (premium-chart spec §6.4), refreshed each minute while today's are coming in. */
export function useOptionBars(contract: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["option-bars", contract, from, to],
    enabled: contract != null,
    staleTime: (query) => (query.state.data?.partial ? 30_000 : Number.POSITIVE_INFINITY),
    refetchInterval: (query) => (query.state.data?.partial ? 60_000 : false),
    retry: false,
    queryFn: async () => {
      const res = await api.api.bars.option[":contract"].$get({
        param: { contract: contract ?? "" },
        query: { from, to },
      });
      if (!res.ok) throw new Error(`option bars failed: ${res.status}`);
      return res.json();
    },
  });
}
