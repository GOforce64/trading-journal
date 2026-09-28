import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { isTradingDay, nyDate, sessionMoment } from "@tj/core";
import { api, type FillResult } from "./api.js";

export type PriceSide = FillResult["missing"][number]["side"];
export type MissingReason = FillResult["missing"][number]["reason"];

export const FILL_KEY = ["fill-moves"];

/** Alpaca's free plan shares SIP prices 15 minutes after the fact; the server waits a minute more. */
const RECENT_MS = 16 * 60_000;

export const MOVE_COPY = {
  noKey: "Add an Alpaca key in Settings to fetch stock prices.",
  fetching: "Fetching from Alpaca…",
  notFetched: "Not fetched yet.",
  no_bars: "Alpaca has no price for this time; type the moves in Edit.",
  no_session: "Not a trading day; type the moves in Edit.",
  too_recent: "Alpaca shares prices 15 min after the fact; try Fill in missing later.",
} as const;

/**
 * Fetches missing stock prices: these trades', or every fly's without ids (spec §9.1).
 * Every trade query refetches after, and the result stays for the session, so pages can say what's missing.
 */
export function useFillMoves() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: FILL_KEY,
    mutationFn: async (tradeIds?: string[]): Promise<FillResult> => {
      const res = await api.api.moves.fill.$post({ json: tradeIds ? { tradeIds } : {} });
      if (!res.ok) throw new Error(`fill failed: ${res.status}`);
      return res.json();
    },
    // On the hook rather than on mutate, so it still runs after the page that saved has moved on.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]),
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** True while any fill runs, wherever it was started. */
export const useFilling = () => useIsMutating({ mutationKey: FILL_KEY }) > 0;

/** This session's finished fills, oldest first. */
export function useFillResults(): FillResult[] {
  return useMutationState({
    filters: { mutationKey: FILL_KEY, status: "success" },
    select: (mutation) => mutation.state.data as FillResult,
  });
}

/** Whether a working Alpaca key is set up, from the Settings status. */
export function useMarketOn(): boolean {
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.api.settings.$get();
      if (!res.ok) throw new Error(`settings failed: ${res.status}`);
      return res.json();
    },
  });
  return data?.marketData?.state === "on";
}

/** Why the newest fill that tried this trade's price for that side couldn't fill it. */
export function lastReason(
  results: readonly FillResult[],
  tradeId: string,
  side: PriceSide,
): MissingReason | null {
  for (let index = results.length - 1; index >= 0; index--) {
    const found = results[index]?.missing.find((gap) => gap.tradeId === tradeId && gap.side === side);
    if (found) return found.reason;
  }
  return null;
}

export interface PriceNoteInput {
  /** When the price should have been read: the trade's openedAt or closedAt. */
  at: number;
  fetching: boolean;
  marketOn: boolean;
  lastReason: MissingReason | null;
  now: number;
}

/** Why a stock price is missing, in the trade page's words (spec §9.2). */
export function priceNote({ at, fetching, marketOn, lastReason: reason, now }: PriceNoteInput): string {
  if (fetching) return MOVE_COPY.fetching;
  const moment = sessionMoment(at);
  if (!isTradingDay(nyDate(moment))) return MOVE_COPY.no_session;
  if (moment > now - RECENT_MS) return MOVE_COPY.too_recent;
  if (!marketOn) return MOVE_COPY.noKey;
  return reason ? MOVE_COPY[reason] : MOVE_COPY.notFetched;
}

const stockPrices = (count: number) => `stock price${count === 1 ? "" : "s"}`;

/** One line on how a fill went, e.g. "Filled 80 of 82 stock prices. 2 missing." */
export function fillSummary(result: FillResult, missingHint = ""): string {
  if (result.unavailable?.reason === "no_key") return result.unavailable.message;
  const tried = result.filled + result.missing.length;
  if (tried === 0 && !result.unavailable) return "Nothing to fill: every fly has its stock prices.";
  const parts = [
    result.unavailable
      ? `Filled ${result.filled} ${stockPrices(result.filled)}.`
      : `Filled ${result.filled} of ${tried} ${stockPrices(tried)}.`,
  ];
  if (result.missing.length > 0) parts.push(`${result.missing.length} missing${missingHint}.`);
  if (result.unavailable) parts.push(result.unavailable.message);
  return parts.join(" ");
}

/** A move as the tiles show it: 0.073 → "7.3%". Signed spells out the sign: "−5.3%", "+18.0%". */
export function movePct(value: number, signed = false): string {
  const text = `${Math.abs(value * 100).toFixed(1)}%`;
  if (!signed || text === "0.0%") return text;
  return `${value > 0 ? "+" : "−"}${text}`;
}

/** IV as a whole percentage: 1.2346 → "123%". */
export const ivPct = (value: number) => `${Math.round(value * 100)}%`;

const ET_MINUTE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Sep 9 15:54": the New York minute a price was read at. */
export function etMinute(at: number): string {
  const parts = Object.fromEntries(
    ET_MINUTE.formatToParts(new Date(at)).map((part) => [part.type, part.value]),
  );
  return `${parts.month} ${parts.day} ${parts.hour}:${parts.minute}`;
}
