import type { CrushBin, MovePoint } from "@tj/core";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { DOWN, TICK, TOOLTIP, UP } from "./Charts.js";
import { dollars } from "./format.js";

interface Dot {
  id: string;
  ticker: string;
  /** Implied and |actual| move, in percent. */
  x: number;
  y: number;
  size: number;
  pnl: number;
  /** The ticker for the five largest results, empty for the rest. */
  label: string;
}

/**
 * Implied move (x) against |actual| move (y), both in percent, one dot per fly (spec §9.4).
 * Above the y = x line the stock moved more than the options priced in.
 */
export function MoveScatter({ points }: { points: readonly MovePoint[] }) {
  const labelled = new Set(
    [...points]
      .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl))
      .slice(0, 5)
      .map((point) => point.id),
  );
  const dots: Dot[] = points.map((point) => ({
    id: point.id,
    ticker: point.ticker,
    x: point.implied * 100,
    y: point.absActual * 100,
    size: Math.abs(point.netPnl),
    pnl: point.netPnl,
    label: labelled.has(point.id) ? point.ticker : "",
  }));
  const top = Math.ceil(Math.max(10, ...dots.map((dot) => Math.max(dot.x, dot.y))) / 5) * 5;
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, top]}
            unit="%"
            tick={TICK}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, top]}
            unit="%"
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <ZAxis type="number" dataKey="size" range={[20, 260]} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: top, y: top },
            ]}
            stroke="#6b7385"
            strokeDasharray="3 3"
          />
          <Tooltip
            {...TOOLTIP}
            content={({ active, payload }) => {
              const dot = payload?.[0]?.payload as Dot | undefined;
              if (!active || !dot) return null;
              return (
                <div style={TOOLTIP.contentStyle}>
                  {dot.ticker}: implied {dot.x.toFixed(1)}%, actual {dot.y.toFixed(1)}%, {dollars(dot.pnl)}
                </div>
              );
            }}
          />
          <Scatter data={dots} isAnimationActive={false}>
            {dots.map((dot) => (
              <Cell key={dot.id} fill={dot.pnl > 0 ? UP : DOWN} fillOpacity={0.75} />
            ))}
            <LabelList dataKey="label" position="top" fill="#8a91a3" fontSize={9} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {/* Colour is never the only key: a legend in text ink, with the colour on the glyph alone. */}
      <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted">
        <span>
          <span className="text-up">●</span> won
        </span>
        <span>
          <span className="text-down">●</span> lost
        </span>
        <span>dot size: |P&amp;L|</span>
        <span>dashed line: moved exactly as priced</span>
      </p>
    </>
  );
}

/** IV before − after, in points: green where IV fell, red where it rose. */
export function CrushHistogram({
  bins,
  tickers,
}: {
  bins: readonly CrushBin[];
  tickers: ReadonlyMap<string, string>;
}) {
  const data = bins.map((bin) => ({
    label: bin.label,
    count: bin.tradeIds.length,
    crushed: bin.from >= 0,
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
            <Cell key={bin.label} fill={bin.crushed ? UP : DOWN} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
