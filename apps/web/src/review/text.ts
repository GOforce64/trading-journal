import type { ReviewNeed } from "@tj/core";

const NEED_WORDS: Record<ReviewNeed, string> = { setup: "a setup", grade: "a grade", stop: "a stop" };

/** What a scalp still needs, for the queue bar: "needs a setup and a stop". */
export function needsText(missing: readonly ReviewNeed[]): string {
  const words = missing.map((need) => NEED_WORDS[need]);
  const last = words.at(-1);
  if (!last) return "";
  return words.length === 1 ? `needs ${last}` : `needs ${words.slice(0, -1).join(", ")} and ${last}`;
}

/** What a scalp lacks, for the Dashboard's rows: "setup, stop". */
export const missingList = (missing: readonly ReviewNeed[]) => missing.join(", ");

/** The contract a scalp traded: "NVDA 232.5C". */
export function contractText(trade: {
  underlying: string;
  legs: readonly { strike: number; right: string }[];
}) {
  const leg = trade.legs[0];
  return leg ? `${trade.underlying} ${leg.strike}${leg.right}` : trade.underlying;
}
