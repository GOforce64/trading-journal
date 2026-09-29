import { useState } from "react";
import { TabButton } from "../components/ui.js";
import { usePendingReviews } from "../review/data.js";
import { Journal } from "./Journal.js";

/** Every scalp, synced from IBKR or typed in (spec §9.1), and those waiting for review (scalp-review spec §9.3). */
export function Scalps({
  onOpenTrade,
  onNewScalp,
}: {
  onOpenTrade?: (id: string) => void;
  onNewScalp?: () => void;
}) {
  const [tab, setTab] = useState<"all" | "review">("all");
  const waiting = usePendingReviews().data?.length ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Scalps tabs" className="flex gap-4 border-line border-b text-[12px]">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All
        </TabButton>
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          {`To review (${waiting})`}
        </TabButton>
      </nav>
      {tab === "all" ? (
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
      ) : (
        <Journal
          title="To review"
          lockedFilter={{ strategy: "scalp", review: "pending" }}
          emptyText="Nothing to review."
          onOpenTrade={onOpenTrade}
        />
      )}
    </div>
  );
}
