import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TradeView } from "../api.js";
import { Panel } from "../components/ui.js";
import { IronFlyForm, type IronFlyFormValues, type LegFields } from "./IronFlyForm.js";

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
    legs: {
      shortCall: legFields(trade.legs, "C", true),
      shortPut: legFields(trade.legs, "P", true),
      longCall: legFields(trade.legs, "C", false),
      longPut: legFields(trade.legs, "P", false),
    },
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

export function EditTrade({ tradeId, onSaved }: { tradeId: string; onSaved?: (id: string) => void }) {
  const queryClient = useQueryClient();

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
      onSaved?.(tradeId);
    },
  });

  if (isLoading || !trade) return <p className="text-muted">Loading…</p>;
  if (trade.strategy !== "iron_fly") {
    return (
      <Panel title="Edit">
        <p className="text-muted">Only iron flies can be edited here for now.</p>
      </Panel>
    );
  }

  return (
    <IronFlyForm
      initial={toFormValues(trade)}
      submitLabel="Save changes"
      busy={save.isPending}
      error={save.error ? String(save.error) : null}
      onSubmit={(payload) => save.mutate(keepIronFlyExtras(payload, trade))}
    />
  );
}
