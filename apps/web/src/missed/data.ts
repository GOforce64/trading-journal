import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, isTradingDay, nyDate, nyMinuteOfDay, regularClose } from "@tj/core";
import { useMemo } from "react";
import { api, refusal, type TradeView } from "../api.js";

/** Every missed trade, excluded ones too, for the Missed page (missed-trades spec §6.1). */
export function useMissedTrades() {
  return useQuery({
    queryKey: ["trades", { book: "missed", all: true }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({
        query: { book: "missed", all: "true", includeExcluded: "true" },
      });
      if (!res.ok) throw new Error(`list missed trades failed: ${res.status}`);
      return res.json();
    },
  });
}

/** What the first click on a new missed trade's chart creates: its entry (spec §6.2). */
export interface NewMissed {
  underlying: string;
  openedAt: number;
  entryPrice: number;
}

export function useCreateMissed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ underlying, openedAt, entryPrice }: NewMissed) => {
      const res = await api.api.trades.$post({
        json: {
          strategy: "scalp",
          book: "missed",
          underlying,
          openedAt,
          missed: { direction: "long", entryPrice, stopPrice: null, targetPrice: null, exitPrice: null },
        },
      });
      if (!res.ok) throw await refusal(res, "create");
      return res.json();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["trades"] }),
  });
}

const NONE: TradeView[] = [];

/** The ticker's other trades from that New York day, for the day's-trades markers (spec §6.4). */
export function useDayTrades(symbol: string, date: string, exceptId?: string): TradeView[] {
  const { data } = useQuery({
    queryKey: ["trades", { underlying: symbol, all: true }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({ query: { underlying: symbol, all: "true" } });
      if (!res.ok) throw new Error(`list ${symbol} trades failed: ${res.status}`);
      return res.json();
    },
    enabled: symbol !== "",
  });
  // The same array while nothing changes, so the chart repaints only when the day's trades do.
  return useMemo(
    () => (data ? data.filter((trade) => trade.id !== exceptId && nyDate(trade.openedAt) === date) : NONE),
    [data, date, exceptId],
  );
}

/** The last session whose bars are all in: today once it has closed, otherwise the trading day before (spec §6.1). */
export function lastSession(now: number): string {
  const today = nyDate(now);
  if (isTradingDay(today) && nyMinuteOfDay(now) >= regularClose(today)) return today;
  let date = addDays(today, -1);
  while (!isTradingDay(date)) date = addDays(date, -1);
  return date;
}
