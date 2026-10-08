import { type Direction, type MissedRisk, nyWallClock, round2 } from "@tj/core";
import { rText } from "../analytics/format.js";
import { clockText } from "../chart/option.js";

/** "+2.39", "−1.00": R without its unit. */
const signed = (value: number) => rText(value).slice(0, -1);

/** Why a missed trade has no R yet (missed-trades spec §6.3). */
export function problemText(problem: NonNullable<MissedRisk["problem"]>, direction: Direction): string {
  switch (problem) {
    case "no_stop":
      return "Place the stop to see R";
    case "stop_at_entry":
      return "The stop can't be at the entry";
    case "wrong_side":
      return direction === "long"
        ? "The stop is above the entry for a long"
        : "The stop is below the entry for a short";
    case "no_exit":
      return "Place the exit to see R";
  }
}

/** The panel's R line: "R +2.39 · R:R 4.48", or what's missing. */
export function missedLine(risk: MissedRisk | null, direction: Direction): string {
  if (!risk) return "";
  if (risk.problem) return problemText(risk.problem, direction);
  const parts = [`R ${signed(risk.r ?? 0)}`];
  if (risk.plannedRR != null) parts.push(`R:R ${risk.plannedRR.toFixed(2)}`);
  return parts.join(" · ");
}

/** "MAE −0.31R · MFE +3.10R", once the hold range is in. */
export function excursionLine(risk: MissedRisk | null): string | null {
  if (risk?.mae == null || risk.mfe == null) return null;
  return `MAE ${rText(risk.mae)} · MFE ${rText(risk.mfe)}`;
}

/**
 * A typed price outside its minute's bar (spec §6.3): it still saves, with this under the field. The range is judged
 * in cents, as it's shown, since a point placed on a sub-cent high or low (237.2505) is stored rounded (237.25).
 */
export function rangeWarning(price: number, bar: { t: number; h: number; l: number } | null): string | null {
  if (!bar || (price >= round2(bar.l) && price <= round2(bar.h))) return null;
  return `Outside ${clockText(bar.t)}'s range (${bar.l.toFixed(2)}–${bar.h.toFixed(2)})`;
}

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "Sep 30", for a New York date. */
export const dayText = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

/** "09:41" on the trade's New York date, or a message. */
export function parseClock(text: string, date: string): number | string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) return "Type a time like 09:41";
  return nyWallClock(date, hour * 60 + minute);
}
