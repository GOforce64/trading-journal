import type { TradeView } from "../api.js";
import { usePendingReviews } from "../review/data.js";
import { queueNav } from "../review/queue.js";
import { QUEUE, type TradeList } from "./tradeList.js";

export interface TradeNav {
  next: string | null;
  prev: string | null;
  /** Where the trade sits in a list of ids; null for the queue (its bar says) and for no list. */
  place: { position: number; total: number; label: string } | null;
  /** The list J and K carry on; null when they don't apply. */
  list: TradeList | null;
}

const NONE: TradeNav = { next: null, prev: null, place: null, list: null };

/**
 * Next and previous from a trade's page (spec §5): a list of ids in its order, not wrapping; the live queue,
 * wrapping, as the queue bar does; and for a scalp opened from no list, the queue.
 */
export function useTradeNav(tradeId: string, trade: TradeView | undefined, list: TradeList | null): TradeNav {
  const { data: pending = [] } = usePendingReviews();
  if (list?.kind === "ids") {
    // By the page's id, so a list carries on past a trade deleted since it was opened (spec §9).
    const at = list.ids.indexOf(tradeId);
    if (at >= 0) {
      return {
        next: list.ids[at + 1] ?? null,
        prev: at > 0 ? (list.ids[at - 1] ?? null) : null,
        place: { position: at + 1, total: list.ids.length, label: list.label },
        list,
      };
    }
  }
  if (!trade) return NONE;
  const scalp = trade.strategy === "scalp" && trade.book !== "missed";
  if (list?.kind !== "queue" && !scalp) return NONE;
  const nav = queueNav(pending, trade, trade.review?.status === "pending");
  return { next: nav.next, prev: nav.prev, place: null, list: QUEUE };
}
