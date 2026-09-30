import { type KeptBin, type MonthResult, monthLabel, type RollingPoint } from "@tj/core";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dollars } from "./format.js";

/**
 * An axis that always takes in zero. Fitted to the data alone, bars that all share a sign start from the smallest,
 * which then draws no bar at all, and the rest lose their proportions.
 */
export const WITH_ZERO: [(low: number) => number, (high: number) => number] = [
  (low) => Math.min(0, low),
  (high) => Math.max(0, high),
];

export const UP = "#26a69a";
export const DOWN = "#ef5350";
const LINE = "#2a2e39";
export const TICK = { fill: "#6b7385", fontSize: 9, fontFamily: "JetBrains Mono, ui-monospace, monospace" };
export const TOOLTIP = {
  contentStyle: {
    background: "#1c2030",
    border: `1px solid ${LINE}`,
    borderRadius: 3,
    fontSize: 10,
    color: "#d1d4dc",
  },
  cursor: { fill: "#ffffff08" },
};
const NY_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

/** Net P&L per close month, labelled with the trade count. */
export function MonthBars({ months }: { months: readonly MonthResult[] }) {
  if (months.length === 0) return <p className="text-muted">No closed trades in this range.</p>;
  const data = months.map((month) => ({
    label: `${monthLabel(month.month)} · ${month.trades}`,
    net: month.net,
  }));
  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis hide domain={WITH_ZERO} />
        <ReferenceLine y={0} stroke={LINE} />
        <Tooltip {...TOOLTIP} formatter={(value) => dollars(Number(value))} />
        <Bar dataKey="net" isAnimationActive={false}>
          {data.map((month) => (
            <Cell key={month.label} fill={month.net >= 0 ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Expectancy over the last 10 trades, with its current value. */
export function RollingLine({ points }: { points: readonly RollingPoint[] }) {
  const data = points.map((point) => ({
    label: NY_DAY.format(new Date(point.closedAt)),
    value: point.value,
  }));
  const last = data.at(-1);
  return (
    <div>
      <ResponsiveContainer width="100%" height={70}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <ReferenceLine y={0} stroke={LINE} strokeDasharray="3 3" />
          <Tooltip {...TOOLTIP} formatter={(value) => `${dollars(Number(value))} per trade`} />
          <Line dataKey="value" stroke="#8a91a3" strokeWidth={1.4} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {last && (
        <p className={`num text-right text-[10px] ${last.value >= 0 ? "text-up" : "text-down"}`}>
          {dollars(last.value)} per trade now
        </p>
      )}
    </div>
  );
}

/** How many trades kept each share of max profit; hovering a bar names them. */
export function KeptHistogram({
  bins,
  tickers,
}: {
  bins: readonly KeptBin[];
  tickers: ReadonlyMap<string, string>;
}) {
  const data = bins.map((bin) => ({
    label: bin.label,
    count: bin.tradeIds.length,
    kept: bin.from >= 0,
    names: bin.tradeIds.map((id) => tickers.get(id) ?? id).join(", "),
  }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="label" tick={TICK} interval={0} axisLine={false} tickLine={false} />
        <YAxis hide allowDecimals={false} />
        <Tooltip
          {...TOOLTIP}
          formatter={(value, _name, item) => [`${value} · ${item.payload?.names ?? ""}`, "trades"]}
        />
        <Bar
          dataKey="count"
          isAnimationActive={false}
          label={{ position: "top", fill: "#8a91a3", fontSize: 9 }}
        >
          {data.map((bin) => (
            <Cell key={bin.label} fill={bin.kept ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
