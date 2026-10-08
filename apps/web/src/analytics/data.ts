import { useQuery } from "@tanstack/react-query";
import { nyDate } from "@tj/core";
import { api, type TradeView } from "../api.js";

/** Every trade, excluded ones too, for pages that filter in the browser. The key's "trades" prefix means edits refresh it. */
export function useAllTrades() {
  return useQuery({
    queryKey: ["trades", { all: true }],
    queryFn: async (): Promise<TradeView[]> => {
      const res = await api.api.trades.$get({ query: { all: "true", includeExcluded: "true" } });
      if (!res.ok) throw new Error(`list trades failed: ${res.status}`);
      return res.json();
    },
  });
}

/** The Analytics books (missed-trades spec §6.8): missed trades join only when asked for. */
export type Book = "live" | "paper" | "missed";

export interface TradeFilter {
  books: readonly Book[];
  ticker?: string;
  /** A setup's id. */
  setup?: string;
  /** YYYY-MM-DD, New York close date, inclusive. */
  from?: string;
  to?: string;
  includeExcluded: boolean;
}

/** The trades a filter keeps. A date range applies to the New York close date, so it drops open trades. */
export function filterTrades<
  T extends {
    book: string;
    underlying: string;
    setupId?: string | null;
    closedAt: number | null;
    excluded: boolean;
  },
>(trades: readonly T[], filter: TradeFilter): T[] {
  const books: readonly string[] = filter.books;
  return trades.filter((trade) => {
    if (!books.includes(trade.book)) return false;
    if (filter.ticker && trade.underlying !== filter.ticker) return false;
    if (filter.setup && trade.setupId !== filter.setup) return false;
    if (trade.excluded && !filter.includeExcluded) return false;
    if (!filter.from && !filter.to) return true;
    if (trade.closedAt == null) return false;
    const date = nyDate(trade.closedAt);
    return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
  });
}
