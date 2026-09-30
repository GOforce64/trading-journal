import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./api.js";
import { useFillMoves } from "./moves.js";
import { useFillScalpPrices } from "./review/prices.js";

type SyncResponse = Awaited<ReturnType<typeof api.api.ibkr.sync.$post>>;
/** What one IBKR sync did (spec §8.2). */
export type SyncSummary = Awaited<ReturnType<SyncResponse["json"]>>;
type StatusResponse = Awaited<ReturnType<typeof api.api.ibkr.status.$get>>;
export type IbkrStatus = Awaited<ReturnType<StatusResponse["json"]>>;

export const SYNC_KEY = ["ibkr-sync"];

/** Why a trade was left out, in the Import card's words. */
export const SKIP_REASON = {
  before_start: "opened before the start date",
  unrecognised: "not an iron fly or a single option: enter it by hand",
  duplicate: "already in the journal",
  deleted: "you deleted it",
} as const;

export function useIbkrStatus() {
  return useQuery({
    queryKey: ["ibkr-status"],
    queryFn: async () => {
      const res = await api.api.ibkr.status.$get();
      if (!res.ok) throw new Error(`IBKR status failed: ${res.status}`);
      return res.json();
    },
  });
}

/**
 * Runs a sync: the button passes `false`, opening the app passes `true`. Afterwards the trade lists refetch,
 * and trades the sync added or changed get their stock prices (move data, and a scalp's R), as after a save.
 */
export function useIbkrSync() {
  const queryClient = useQueryClient();
  const fill = useFillMoves();
  const fillPrices = useFillScalpPrices();
  return useMutation({
    mutationKey: SYNC_KEY,
    mutationFn: async (auto: boolean): Promise<SyncSummary> => {
      const res = await api.api.ibkr.sync.$post({ json: { auto } });
      if (!res.ok) throw new Error(`IBKR sync failed: ${res.status}`);
      return res.json();
    },
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["trade"] }),
      ]);
      if (summary.changedTradeIds.length > 0) {
        fill.mutate(summary.changedTradeIds);
        fillPrices.mutate(summary.changedTradeIds);
      }
    },
  });
}

/** True while a sync runs, wherever it was started. */
export const useIbkrSyncing = () => useIsMutating({ mutationKey: SYNC_KEY }) > 0;

/** One automatic sync per page load (spec §9.3). The server skips it if the last one is under 15 minutes old. */
export function useAutoSync() {
  const sync = useIbkrSync();
  const started = useRef(false);
  useEffect(() => {
    // StrictMode runs effects twice on one component; the ref keeps that to one request.
    if (started.current) return;
    started.current = true;
    sync.mutate(true);
  }, [sync]);
}
