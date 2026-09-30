import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, type TradeView } from "../api.js";
import { usd } from "../components/ui.js";
import { type SyncSummary, useAfterSync, useIbkrStatus } from "../ibkr.js";

const ibkrNow = (netPnl: number | null) =>
  netPnl == null ? "IBKR has it still open." : `IBKR now has ${netPnl > 0 ? "+" : ""}${usd(netPnl)} net.`;

/**
 * On a synced trade whose facts the user changed: their edits win until they choose IBKR's numbers (spec §5.3). What
 * handing it back did stays on the page after the banner goes, since the trade then comes back unmarked.
 */
export function SyncedBanner({ trade }: { trade: TradeView }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  if (trade.source !== "ibkr_flex") return null;
  if (trade.factsEditedAt == null) {
    return outcome ? <p className="text-[11px] text-down">{outcome}</p> : null;
  }
  return <KeptEdits tradeId={trade.id} onOutcome={setOutcome} />;
}

/** Split out so that only these trades ask for the IBKR status. */
function KeptEdits({ tradeId, onOutcome }: { tradeId: string; onOutcome: (outcome: string | null) => void }) {
  const status = useIbkrStatus();
  const afterSync = useAfterSync();
  const reset = useMutation({
    mutationFn: async (): Promise<SyncSummary> => {
      const res = await api.api.ibkr.trades[":id"].reset.$post({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      return (await res.json()) as SyncSummary;
    },
    onSuccess: async (summary) => {
      // The edits are no longer kept either way; a failed sync just means IBKR's numbers come with the next one.
      onOutcome(
        summary.status === "ok"
          ? null
          : `Handed back to IBKR, but the sync failed: ${summary.error?.message ?? "it didn't run"} The next sync brings IBKR's numbers.`,
      );
      await afterSync(summary);
    },
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
        {reset.isPending ? "Asking IBKR…" : "Use IBKR's numbers"}
      </button>
      {reset.error && (
        <p className="basis-full text-[11px] text-down">
          Couldn't hand the trade back to IBKR: {reset.error.message}.
        </p>
      )}
    </div>
  );
}
