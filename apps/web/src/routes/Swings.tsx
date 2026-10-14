import type { OpenTrade } from "../nav/tradeList.js";
import { Journal } from "./Journal.js";

/** Every swing (swing spec §6.2): debit verticals from the sync, and single options the user switched. */
export function Swings({ onOpenTrade }: { onOpenTrade?: OpenTrade }) {
  return (
    <Journal
      title="Swings"
      lockedFilter={{ strategy: "swing", taken: true }}
      onOpenTrade={onOpenTrade}
      emptyText="Swings arrive from the IBKR sync, or switch a scalp to Swing on its page."
    />
  );
}
