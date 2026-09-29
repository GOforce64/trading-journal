import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type TradeView } from "../api.js";
import { useIbkrStatus } from "../ibkr.js";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const ibkrNow = (netPnl: number | null) =>
  netPnl == null ? "IBKR has it still open." : `IBKR now has ${netPnl > 0 ? "+" : ""}${usd(netPnl)} net.`;

/** On a synced trade whose facts the user changed: their edits win until they choose IBKR's numbers (spec §5.3). */
export function SyncedBanner({ trade }: { trade: TradeView }) {
  if (trade.source !== "ibkr_flex" || trade.factsEditedAt == null) return null;
  return <KeptEdits tradeId={trade.id} />;
}

/** Split out so that only these trades ask for the IBKR status. */
function KeptEdits({ tradeId }: { tradeId: string }) {
  const queryClient = useQueryClient();
  const status = useIbkrStatus();
  const reset = useMutation({
    mutationFn: async () => {
      const res = await api.api.ibkr.trades[":id"].reset.$post({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`reset failed: ${res.status}`);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade", tradeId] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["ibkr-status"] }),
      ]),
  });
  // What IBKR has now, when the last sync found it different (spec §9.5).
  const kept = status.data?.lastSummary?.keptEdits.find((each) => each.tradeId === tradeId);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-sm border border-accent bg-[#2962ff14] px-3 py-2">
      <p>
        Your edits are kept. Later syncs won't change this trade.
        {kept ? ` ${ibkrNow(kept.netPnl)}` : ""}
      </p>
      <button
        type="button"
        disabled={reset.isPending}
        onClick={() => reset.mutate()}
        className="rounded-sm border border-line px-3 py-1 text-fg hover:border-accent disabled:opacity-50"
      >
        Use IBKR's numbers
      </button>
    </div>
  );
}
