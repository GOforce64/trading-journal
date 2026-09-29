import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { TICKER } from "../market.js";

/** The trade's 1-minute bars (spec §6). A live trade refreshes each minute; past days never change. */
export function useMinuteBars(symbol: string, from: string, to: string, live: boolean) {
  return useQuery({
    queryKey: ["bars", symbol, from, to],
    enabled: TICKER.test(symbol),
    staleTime: live ? 30_000 : Number.POSITIVE_INFINITY,
    refetchInterval: live ? 60_000 : false,
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
