import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type MoveValue, settleExpiry, tradeMoves } from "@tj/core";
import { api, type TradeView } from "../api.js";
import { Panel } from "../components/ui.js";
import { useClose } from "../market.js";
import { useFillMoves } from "../moves.js";
import { settleProposal } from "../settle.js";
import { IronFlyForm, type IronFlyFormValues, type LegFields, type OverrideKey } from "./IronFlyForm.js";

/** datetime-local wants local wall-clock text, not an ISO instant. */
function toLocalInput(epochMs: number | null): string {
  if (epochMs == null) return "";
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

const asText = (value: number | null | undefined): string => (value == null ? "" : String(value));
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

function legFields(legs: TradeView["legs"], right: "C" | "P", short: boolean): LegFields {
  const leg = legs.find((candidate) => candidate.right === right && candidate.quantity < 0 === short);
  if (!leg) return { strike: "", size: "", entry: "", exit: "" };
  return {
    strike: asText(leg.strike),
    size: asText(Math.abs(leg.quantity)),
    entry: asText(leg.openPrice),
    exit: asText(leg.closePrice),
  };
}

export function toFormValues(trade: TradeView): Partial<IronFlyFormValues> {
  return {
    underlying: trade.underlying,
    underlyingName: trade.underlyingName ?? "",
    structureLabel: trade.structureLabel ?? "Short Iron Butterfly",
    book: trade.book === "paper" ? "paper" : "live",
    openedAt: toLocalInput(trade.openedAt),
    closedAt: toLocalInput(trade.closedAt),
    expiry: trade.legs[0]?.expiry ?? "",
    feesOpen: asText(trade.feesOpen ?? trade.fees),
    feesClose: asText(trade.feesClose ?? 0),
    notes: trade.notes ?? "",
    impliedMovePct: asText(trade.ironFly?.impliedMovePct),
    actualMovePct: asText(trade.ironFly?.actualMovePct),
    ivBefore: asText(trade.ironFly?.ivBefore),
    ivAfter: asText(trade.ironFly?.ivAfter),
    legs: {
      shortCall: legFields(trade.legs, "C", true),
      shortPut: legFields(trade.legs, "P", true),
      longCall: legFields(trade.legs, "C", false),
      longPut: legFields(trade.legs, "P", false),
    },
  };
}

/** The computed moves, as the override fields' placeholders: what a blank field stands for. */
export function movePlaceholders(trade: TradeView): Record<OverrideKey, string> {
  const moves = tradeMoves(trade);
  const shown = (value: MoveValue | null, digits: number) =>
    value?.computed == null ? "auto" : (value.computed * 100).toFixed(digits);
  return {
    impliedMovePct: shown(moves.impliedMove, 1),
    actualMovePct: shown(moves.actualMove, 1),
    ivBefore: shown(moves.ivBefore, 0),
    ivAfter: shown(moves.ivAfter, 0),
  };
}

/**
 * The builder only knows the position, but saving replaces the iron-fly details
 * wholesale, so carry over what it cannot see (source notes, earnings data).
 */
function keepIronFlyExtras(payload: Record<string, unknown>, trade: TradeView): Record<string, unknown> {
  if (!trade.ironFly || !payload.ironFly) return payload;
  const { tradeId: _tradeId, ...stored } = trade.ironFly;
  return { ...payload, ironFly: { ...stored, ...(payload.ironFly as Record<string, unknown>) } };
}

export function EditTrade({
  tradeId,
  settle = false,
  onSaved,
}: {
  tradeId: string;
  settle?: boolean;
  onSaved?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const fill = useFillMoves();

  const { data: trade, isLoading } = useQuery({
    queryKey: ["trade", tradeId],
    queryFn: async (): Promise<TradeView> => {
      const res = await api.api.trades[":id"].$get({ param: { id: tradeId } });
      if (!res.ok) throw new Error(`load failed: ${res.status}`);
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await api.api.trades[":id"].$patch({
        param: { id: tradeId },
        // biome-ignore lint/suspicious/noExplicitAny: the RPC client types the body from the schema
        json: payload as any,
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trade", tradeId] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      // The saved times may have moved, which clears their prices.
      fill.mutate([tradeId]);
      onSaved?.(tradeId);
    },
  });

  // Asked to settle: start from the exits proposed at expiry (spec §9.5).
  const expiry = settle && trade ? settleExpiry(trade.legs) : null;
  const close = useClose(trade?.underlying ?? "", expiry);

  if (isLoading || !trade) return <p className="text-muted">Loading…</p>;
  if (expiry && close.isLoading) return <p className="text-muted">Asking Alpaca for the close…</p>;
  const proposal = expiry && close.data?.close != null ? settleProposal(trade, close.data.close) : null;
  const initial = proposal
    ? toFormValues({
        ...trade,
        legs: proposal.legs,
        closedAt: proposal.closedAt,
        feesClose: proposal.feesClose,
      })
    : toFormValues(trade);
  if (trade.strategy !== "iron_fly") {
    return (
      <Panel title="Edit">
        <p className="text-muted">Only iron flies can be edited here for now.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {proposal && (
        <p className="text-[11px] text-muted">
          Exits proposed at intrinsic value from {trade.underlying}'s {usd(proposal.close)} close on{" "}
          {proposal.expiry}. Check them and the fees, then save.
        </p>
      )}
      <IronFlyForm
        initial={initial}
        movePlaceholders={movePlaceholders(trade)}
        submitLabel="Save changes"
        busy={save.isPending}
        error={save.error ? String(save.error) : null}
        onSubmit={(payload) => save.mutate(keepIronFlyExtras(payload, trade))}
      />
    </div>
  );
}
