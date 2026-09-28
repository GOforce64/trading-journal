import { Journal } from "./Journal.js";

export function IronFlies({
  onOpenTrade,
  onNewTrade,
}: {
  onOpenTrade?: (id: string) => void;
  onNewTrade?: () => void;
}) {
  return (
    <Journal
      title="Iron Flies"
      lockedFilter={{ strategy: "iron_fly" }}
      onOpenTrade={onOpenTrade}
      actions={
        <button
          type="button"
          onClick={() => onNewTrade?.()}
          className="ml-2 rounded-[2px] bg-accent px-2 py-0.5 text-white"
        >
          + New trade
        </button>
      }
    />
  );
}
