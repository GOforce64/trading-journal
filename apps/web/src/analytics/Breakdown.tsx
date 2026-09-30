import type { Breakdown, BreakdownRow } from "@tj/core";
import { dollars, profitFactorText, rText, segmentClass, winRateText } from "./format.js";
import { MetricBars } from "./ScalpCharts.js";
import { Section } from "./Section.js";
import { type EdgeControl, EdgeEditor } from "./SplitGrid.js";
import { type Metric, returnText } from "./scalpText.js";

export const DIMENSIONS: readonly { id: Breakdown; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "ticker", label: "Ticker" },
  { id: "dte", label: "DTE" },
  { id: "side", label: "Call/Put" },
  { id: "grade", label: "Grade" },
  { id: "emotion", label: "Emotion" },
  { id: "weekday", label: "Weekday" },
  { id: "cost", label: "Option cost" },
  { id: "contracts", label: "Contracts" },
  { id: "book", label: "Book" },
  { id: "month", label: "Month" },
];

const tone = (value: number | null) => {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
};

const HEADERS = ["n", "Win %", "Net", "Avg R", "Avg return", "PF"];

/** One dimension at a time: the picker, a table, and its bars (scalp-analytics spec §6.4). */
export function BreakdownPanel({
  by,
  onBy,
  rows,
  metric,
  edges,
}: {
  by: Breakdown;
  onBy: (by: Breakdown) => void;
  rows: readonly BreakdownRow[];
  metric: Metric;
  /** The edit link for a bucketed dimension's edges. */
  edges?: EdgeControl;
}) {
  const label = DIMENSIONS.find((dimension) => dimension.id === by)?.label ?? by;
  return (
    <Section title="Break down by" right={edges && <EdgeEditor title={label} control={edges} />}>
      <fieldset aria-label="Dimension" className="mb-2 flex flex-wrap gap-1 text-[11px]">
        {DIMENSIONS.map((dimension) => (
          <button
            key={dimension.id}
            type="button"
            aria-pressed={dimension.id === by}
            onClick={() => onBy(dimension.id)}
            className={segmentClass(dimension.id === by)}
          >
            {dimension.label}
          </button>
        ))}
      </fieldset>
      <div className="grid items-start gap-3 lg:grid-cols-[3fr_2fr]">
        <table aria-label={`By ${label}`} className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-[9px] text-muted uppercase tracking-wider">
              <th className="py-1 text-left font-medium">{label}</th>
              {HEADERS.map((header) => (
                <th key={header} className="text-right font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-line border-t">
                <td className="py-0.5">{row.label}</td>
                <td className="num text-right text-muted">{row.trades}</td>
                <td className="num text-right">{winRateText(row.winRate)}</td>
                <td className={`num text-right ${tone(row.net)}`}>{dollars(row.net)}</td>
                <td
                  className={`num text-right ${tone(row.avgR)}`}
                  title={`over ${row.rCount} of ${row.trades}`}
                >
                  {row.avgR == null ? "—" : rText(row.avgR)}
                </td>
                <td className={`num text-right ${tone(row.avgReturn)}`}>{returnText(row.avgReturn)}</td>
                <td className="num text-right">{profitFactorText(row.profitFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <MetricBars rows={rows} metric={metric} layout="rows" />
      </div>
    </Section>
  );
}
