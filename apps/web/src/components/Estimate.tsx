import type { CloseEstimate } from "@tj/core";
import { Chip } from "./ui.js";

const ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Muted italics and no colour: an estimate must never look like a result. */
export const ESTIMATE_STYLE = "num italic text-[#8a91a3]";

/** "+$12.00" / "-$46.80". The sign is spelled out because estimates carry no colour. */
export const signedUsd = (value: number) => (value > 0 ? `+${usd(value)}` : usd(value));

export const quotedAtText = (at: number) => `${ET.format(new Date(at))} ET`;

export function estimateTitle(estimate: Extract<CloseEstimate, { kind: "estimate" }>): string {
  return `Estimated cost to close, from quotes at ${quotedAtText(estimate.quotedAt)} (indicative feed), after the fees entered so far. Not saved.`;
}

/**
 * An open trade's estimated P&L, or why there is none. `explain` is false without a market data key,
 * when a missing quote says nothing about the trade.
 */
export function EstimatedPnl({
  estimate,
  testId,
  explain = true,
}: {
  estimate: CloseEstimate;
  testId?: string;
  explain?: boolean;
}) {
  switch (estimate.kind) {
    case "estimate":
      return (
        <span data-testid={testId} className={ESTIMATE_STYLE} title={estimateTitle(estimate)}>
          est {signedUsd(estimate.netPnl)}
        </span>
      );
    case "expired":
      return <Chip>EXPIRED · add exits</Chip>;
    case "unavailable":
      return (
        <span
          data-testid={testId}
          className="num text-muted"
          title={explain ? `No estimate: ${estimate.reason}.` : undefined}
        >
          —
        </span>
      );
    default:
      return (
        <span data-testid={testId} className="num text-muted">
          —
        </span>
      );
  }
}
