/** Where J and K go from a trade's page (launcher-keys-palette spec §5): the live queue, or a list's snapshot. */
export type TradeList = { kind: "queue" } | { kind: "ids"; ids: readonly string[]; label: string };

export const QUEUE: TradeList = { kind: "queue" };

/** Opens a trade, with the list it was opened from. */
export type OpenTrade = (id: string, list?: TradeList) => void;

/** The list in a history entry's state. Anything else, such as an entry from before this change, is none. */
export function readTradeList(state: unknown): TradeList | null {
  const list = (state as { tradeList?: unknown } | null | undefined)?.tradeList;
  if (list == null || typeof list !== "object") return null;
  const { kind, ids, label } = list as { kind?: unknown; ids?: unknown; label?: unknown };
  if (kind === "queue") return QUEUE;
  if (kind !== "ids" || typeof label !== "string" || !Array.isArray(ids)) return null;
  return ids.every((id) => typeof id === "string") ? { kind: "ids", ids: ids as string[], label } : null;
}

/** A list of rows, in the order shown. */
export const listOf = (rows: readonly { id: string }[], label: string): TradeList => ({
  kind: "ids",
  ids: rows.map((row) => row.id),
  label,
});
