import type { TradeView } from "../api.js";
import { usePendingReviews } from "./data.js";
import { queueNav } from "./queue.js";
import { needsText } from "./text.js";

const BUTTON = "rounded-sm border border-line bg-panel px-2 py-0.5 text-fg hover:border-accent";

/** Where this scalp stands in the To review queue, and the way to the next one (scalp-review spec §7.2). */
export function QueueBar({ trade, onOpenTrade }: { trade: TradeView; onOpenTrade?: (id: string) => void }) {
  const { data: pending = [] } = usePendingReviews();
  const status = trade.review?.status ?? null;
  const nav = queueNav(pending, trade, status === "pending");
  if (status !== "pending" && nav.left === 0) return null;
  const go = (id: string | null) => {
    if (id) onOpenTrade?.(id);
  };
  return (
    <div
      data-testid="queue-bar"
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[#2962ff55] bg-[#2962ff14] px-2 py-1 text-[11px]"
    >
      {status === "pending" ? (
        <>
          <b className="text-[#82a8ff]">TO REVIEW</b>
          <span className="num">
            {nav.position} of {nav.total}
          </span>
          <span className="text-muted">{needsText(trade.review?.missing ?? [])}</span>
        </>
      ) : status === "done" ? (
        <>
          <b className="text-up">REVIEWED ✓</b>
          <span className="num text-muted">{nav.left} left</span>
        </>
      ) : (
        <span className="num text-muted">{nav.left} to review</span>
      )}
      <span className="ml-auto flex gap-1">
        {status === "pending" && nav.prev && (
          <button type="button" onClick={() => go(nav.prev)} className={BUTTON}>
            ← Prev
          </button>
        )}
        {nav.next && (
          <button type="button" onClick={() => go(nav.next)} className={BUTTON}>
            Next →
          </button>
        )}
      </span>
    </div>
  );
}
