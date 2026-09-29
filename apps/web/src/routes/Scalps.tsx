import { Journal } from "./Journal.js";

/** Every scalp, synced from IBKR or typed in (spec §9.1). */
export function Scalps({
  onOpenTrade,
  onNewScalp,
}: {
  onOpenTrade?: (id: string) => void;
  onNewScalp?: () => void;
}) {
  return (
    <Journal
      title="Scalps"
      lockedFilter={{ strategy: "scalp" }}
      onOpenTrade={onOpenTrade}
      actions={
        onNewScalp && (
          <button
            type="button"
            onClick={() => onNewScalp()}
            className="ml-2 rounded-[2px] bg-accent px-2 py-0.5 text-white"
          >
            + New scalp
          </button>
        )
      }
    />
  );
}
