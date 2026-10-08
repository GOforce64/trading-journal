import type { MissedRow } from "@tj/core";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOWN, TICK, TOOLTIP, UP, WITH_ZERO } from "./Charts.js";
import { rText, winRateText } from "./format.js";
import { shortLabel } from "./scalpText.js";

const LINE = "#2a2e39";
/** A row's band, as the scalps' breakdown bars have it. */
const ROW_BAND = 22;

/** What a row's tooltip says it stands for. */
export function missedRowSummary(row: MissedRow): string {
  const trades = `${row.trades} missed`;
  if (row.rCount === 0) return `${trades} · no R yet`;
  return `${trades} · ${rText(row.totalR)} total over ${row.rCount} · would win ${winRateText(row.winRate)}`;
}

/**
 * The Missed tab's breakdown bars (missed-trades spec §6.6): each row's total R, laid down beside the table as the
 * scalps' breakdown bars are, coloured by sign from a zero line, with a tooltip naming what the row stands for.
 */
export function MissedBars({ rows }: { rows: readonly MissedRow[] }) {
  const data = rows.map((row) => ({
    label: row.label,
    tick: shortLabel(row.label),
    value: row.rCount ? row.totalR : null,
    summary: missedRowSummary(row),
  }));
  return (
    <ResponsiveContainer width="100%" height={rows.length * ROW_BAND + 16}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis type="number" hide domain={WITH_ZERO} />
        <YAxis
          type="category"
          dataKey="tick"
          width={104}
          tick={TICK}
          interval={0}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine x={0} stroke={LINE} />
        <Tooltip
          {...TOOLTIP}
          content={({ active, payload }) => {
            const point = active ? payload?.[0]?.payload : undefined;
            if (!point) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="px-2 py-1">
                <div>{point.label}</div>
                <div className="text-muted">{point.summary}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.label} fill={(point.value ?? 0) >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
