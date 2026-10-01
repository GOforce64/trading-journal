import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type LegInput, settleExpiry } from "@tj/core";
import { api, type TradeView } from "../api.js";
import { Money, Panel, usd } from "../components/ui.js";
import { useClose } from "../market.js";
import { useFillMoves } from "../moves.js";
import { dayText, netWorking, noCloseReason, settleProposal } from "../settle.js";

const legName = (leg: { quantity: number; right: string }) =>
  `${leg.quantity < 0 ? "Short" : "Long"} ${leg.right === "C" ? "call" : "put"}`;

const FLAG_TEXT = {
  assigned: "(in the money: assigned, not cash)",
  exercised: "(exercised)",
} as const;
const BUTTON = "rounded-sm border border-line px-3 py-1 text-fg hover:border-accent";

/**
 * Exits at intrinsic value from the expiry-day close, saved only when the user says so (spec §9.5).
 * Equity options settle in shares: an assigned short means the account got stock, so it's flagged.
 */
export function SettlePanel({
  trade,
  onEdit,
  onEditSettled,
}: {
  trade: TradeView;
  onEdit?: (id: string) => void;
  onEditSettled?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const fill = useFillMoves();
  const expiry = settleExpiry(trade.legs);
  const close = useClose(trade.underlying, expiry);
  const price = close.data?.close ?? null;
  const proposal = price != null ? settleProposal(trade, price) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("nothing to save");
      const res = await api.api.trades[":id"].$patch({
        param: { id: trade.id },
        json: {
          closedAt: proposal.closedAt,
          netPnl: proposal.netPnl,
          feesClose: proposal.feesClose,
          legs: proposal.legs.map(
            (leg): LegInput => ({
              right: leg.right === "C" ? "C" : "P",
              strike: leg.strike,
              expiry: leg.expiry,
              quantity: leg.quantity,
              multiplier: leg.multiplier,
              openPrice: leg.openPrice,
              closePrice: leg.closePrice,
            }),
          ),
        },
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trade", trade.id] }),
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
      ]);
      // The close time is new, so the exit stock price is fetched now.
      fill.mutate([trade.id]);
    },
  });

  if (!expiry) return null;
  const reason = noCloseReason(trade.underlying, expiry, close, ", so type the exits in Edit");

  return (
    <Panel title="Settle at expiry">
      {close.isLoading && (
        <p className="text-muted">
          Asking Alpaca for {trade.underlying}'s close on {dayText(expiry)}…
        </p>
      )}
      {!close.isLoading && !proposal && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted">{reason}</p>
          <button type="button" onClick={() => onEdit?.(trade.id)} className={BUTTON}>
            Edit
          </button>
        </div>
      )}
      {proposal && (
        <>
          <p className="mb-2">
            {trade.underlying} closed at {usd(proposal.close)} on {dayText(expiry)}. Proposed exits at
            intrinsic value:
          </p>
          {/* Sized to its columns: stretched, the exits sat a page-width away from their legs. */}
          <table className="num w-auto border-collapse text-[11px] [&_td+td]:pl-6 [&_th+th]:pl-6">
            <thead className="text-[9px] text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium">Leg</th>
                <th className="text-right font-medium">Strike</th>
                <th className="text-right font-medium">Size</th>
                <th className="text-right font-medium">Entry</th>
                <th className="text-right font-medium">Exit at expiry</th>
              </tr>
            </thead>
            <tbody>
              {proposal.legs.map((leg, index) => {
                const settled = proposal.settled.find((item) => item.index === index);
                return (
                  <tr key={leg.id} data-testid={`settle-row-${leg.id}`} className="border-line border-t">
                    <td className={leg.quantity < 0 ? "text-down" : "text-up"}>{legName(leg)}</td>
                    <td className="text-right">{leg.strike}</td>
                    <td className="text-right">{leg.quantity}</td>
                    <td className="text-right">{leg.openPrice.toFixed(2)}</td>
                    <td className="text-right">
                      {leg.closePrice.toFixed(2)}
                      {settled?.flag && <span className="ml-1 text-muted">{FLAG_TEXT[settled.flag]}</span>}
                      {!settled && <span className="ml-1 text-muted">(closed before expiry)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2">
            Net P&amp;L if saved: <Money value={proposal.netPnl} />{" "}
            <span className="text-muted">({netWorking(proposal)})</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-sm bg-accent px-3 py-1 text-white disabled:opacity-50"
            >
              Save these exits
            </button>
            <button type="button" onClick={() => onEditSettled?.(trade.id)} className={BUTTON}>
              Edit them first
            </button>
          </div>
          {save.error && <p className="mt-2 text-down">{String(save.error)}</p>}
        </>
      )}
    </Panel>
  );
}
