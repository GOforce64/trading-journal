import type { GroupStats, MissedOnlyRow } from "@tj/core";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOWN, TICK, TOOLTIP, UP, WITH_ZERO } from "./Charts.js";
import { type Metric, metricValue, rowSummary, shortLabel, tickText } from "./scalpText.js";

const ACCENT = "#5b8cff";
const LINE = "#2a2e39";
/** A breakdown row's band: room for its 9 px label, so labels never overlap however many rows there are. */
const ROW_BAND = 22;

export interface MetricRow extends GroupStats {
  label: string;
}

/** A bar's row: a taken trades' group, or one only missed trades have, with blank dollars. */
type BarRow = MetricRow | MissedOnlyRow;

/**
 * One bar per row under the chosen metric (scalp-analytics spec §6.3): net and avg R coloured by sign from a zero line,
 * win % in the accent colour against a 50% line. The tooltip says everything the row stands for.
 *
 * "columns" stands the bars up under their labels, for the five time buckets. "rows" lays them down, one band per row
 * with its name beside it, for a breakdown whose rows (11 tickers, a year of months) would crowd an axis of columns.
 */
export function MetricBars({
  rows,
  metric,
  title = (label) => label,
  height = 140,
  layout = "columns",
}: {
  rows: readonly BarRow[];
  metric: Metric;
  /** The tooltip's heading for a row, such as "0–5 min". */
  title?: (label: string) => string;
  /** The columns layout's height; the rows layout grows with its rows. */
  height?: number;
  layout?: "columns" | "rows";
}) {
  const data = rows.map((row) => ({
    label: row.label,
    // The rows layout sits beside the table, which already shows each row's count.
    tick: layout === "rows" ? shortLabel(row.label) : tickText(row.label, row.trades),
    value: metricValue(row, metric),
    heading: title(row.label),
    summary: rowSummary(row),
  }));
  const domain = metric === "win" ? [0, 1] : WITH_ZERO;
  const reference = metric === "win" ? 0.5 : 0;
  const lying = layout === "rows";
  return (
    <ResponsiveContainer width="100%" height={lying ? rows.length * ROW_BAND + 16 : height}>
      <BarChart
        data={data}
        layout={lying ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        {lying ? (
          <>
            <XAxis type="number" hide domain={domain} />
            <YAxis
              type="category"
              dataKey="tick"
              // Room for a 12-character label on one line; at 80 px "VWAP reclaim" wrapped in Firefox.
              width={104}
              tick={TICK}
              interval={0}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine
              x={reference}
              stroke={LINE}
              strokeDasharray={metric === "win" ? "3 3" : undefined}
            />
          </>
        ) : (
          <>
            <XAxis dataKey="tick" tick={TICK} interval={0} axisLine={false} tickLine={false} />
            <YAxis hide domain={domain} />
            <ReferenceLine
              y={reference}
              stroke={LINE}
              strokeDasharray={metric === "win" ? "3 3" : undefined}
            />
          </>
        )}
        <Tooltip
          {...TOOLTIP}
          content={({ active, payload }) => {
            const point = active ? payload?.[0]?.payload : undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="px-2 py-1">
                <div>{point.heading}</div>
                <div className="text-muted">{point.summary}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.label} fill={metric === "win" ? ACCENT : (point.value ?? 0) >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
