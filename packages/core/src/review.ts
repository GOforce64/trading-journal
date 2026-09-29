/** The scalp review (scalp-review spec §6.1): whether a trade waits in the To review queue, and what it lacks. */

/** What a scalp's stop and target are measured on: the stock's price, or the option's premium. */
export const LEVEL_BASES = ["stock", "premium"] as const;
export type LevelBasis = (typeof LEVEL_BASES)[number];

/** What a scalp needs before it leaves the queue on its own. */
export type ReviewNeed = "setup" | "grade" | "stop";

export interface ReviewStatus {
  status: "pending" | "done";
  /** What's absent, in the order setup, grade, stop. Filled in for a trade marked done by hand too. */
  missing: ReviewNeed[];
}

/** The fields the status reads, as a stored trade has them. */
export interface ReviewInput {
  strategy: string;
  book: string;
  closedAt: number | null;
  excluded: boolean;
  reviewedAt: number | null;
  setupId: string | null;
  grade: string | null;
  scalp: { stopPrice: number | null } | null;
}

/** Null where the queue doesn't apply: not a scalp, a missed trade, still open, or excluded. */
export function reviewStatus(trade: ReviewInput): ReviewStatus | null {
  if (trade.strategy !== "scalp" || trade.book === "missed" || trade.closedAt == null || trade.excluded) {
    return null;
  }
  const missing: ReviewNeed[] = [];
  if (trade.setupId == null) missing.push("setup");
  if (trade.grade == null) missing.push("grade");
  if (trade.scalp?.stopPrice == null) missing.push("stop");
  return { status: trade.reviewedAt != null || missing.length === 0 ? "done" : "pending", missing };
}
