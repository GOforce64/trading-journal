import { useState } from "react";
import { TabButton } from "../components/ui.js";
import { usePendingReviews } from "../review/data.js";
import { Journal } from "./Journal.js";

/** Every scalp, synced from IBKR or typed in (spec §9.1), and those waiting for review (scalp-review spec §9.3). */
export function Scalps({
  onOpenTrade,
  onNewScalp,
  tab: urlTab,
  onTab,
}: {
  onOpenTrade?: (id: string) => void;
  onNewScalp?: () => void;
  /** The tab from the URL (`?tab=review`); absent means All. */
  tab?: "review";
  /** Puts the tab in the URL. Without it the tab lives here. */
  onTab?: (tab: "review" | undefined) => void;
}) {
  const [ownTab, setOwnTab] = useState<"all" | "review">("all");
  const tab = onTab ? (urlTab ?? "all") : ownTab;
  const setTab = (next: "all" | "review") =>
    onTab ? onTab(next === "review" ? "review" : undefined) : setOwnTab(next);
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
          lockedFilter={{ strategy: "scalp", taken: true }}
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
