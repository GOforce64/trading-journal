import type { GroupStats } from "@tj/core";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOWN, TICK, TOOLTIP, UP } from "./Charts.js";
import { type Metric, metricValue, rowSummary, tickText } from "./scalpText.js";

const ACCENT = "#5b8cff";
const LINE = "#2a2e39";

export interface MetricRow extends GroupStats {
  label: string;
}

/**
 * One bar per row under the chosen metric (scalp-analytics spec §6.3): net and avg R coloured by sign from a zero line,
 * win % in the accent colour against a 50% line. The tooltip says everything the row stands for.
 */
export function MetricBars({
  rows,
  metric,
  title = (label) => label,
  height = 140,
}: {
  rows: readonly MetricRow[];
  metric: Metric;
  /** The tooltip's heading for a row, such as "0–5 min". */
  title?: (label: string) => string;
  height?: number;
}) {
  const data = rows.map((row) => ({
    tick: tickText(row.label, row.trades),
    value: metricValue(row, metric),
    heading: title(row.label),
    summary: rowSummary(row),
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="tick" tick={TICK} interval={0} axisLine={false} tickLine={false} />
        <YAxis hide domain={metric === "win" ? [0, 1] : ["auto", "auto"]} />
        {metric === "win" ? (
          <ReferenceLine y={0.5} stroke={LINE} strokeDasharray="3 3" />
        ) : (
          <ReferenceLine y={0} stroke={LINE} />
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
            <Cell key={point.tick} fill={metric === "win" ? ACCENT : (point.value ?? 0) >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
