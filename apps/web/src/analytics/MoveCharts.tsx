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

/** How close, as shares of the chart's span, a name may sit to one already placed. */
const LABEL_GAP = { x: 0.08, y: 0.06 };

/**
 * The dots to name: the five largest results, largest first, skipping any that would sit on a name already placed
 * (CRM and CRWD a point apart). `top` is the charts' span, in the dots' units.
 */
export function pickLabels(
  dots: readonly { id: string; x: number; y: number; pnl: number }[],
  top: number,
  count = 5,
): Set<string> {
  const placed: { x: number; y: number }[] = [];
  const names = new Set<string>();
  for (const each of [...dots].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))) {
    if (names.size === count) break;
    const crowded = placed.some(
      (other) =>
        Math.abs(other.x - each.x) < LABEL_GAP.x * top && Math.abs(other.y - each.y) < LABEL_GAP.y * top,
    );
    if (crowded) continue;
    placed.push(each);
    names.add(each.id);
  }
  return names;
}

/**
 * Implied move (x) against |actual| move (y), both in percent, one dot per fly (spec §9.4).
 * Above the y = x line the stock moved more than the options priced in.
 */
export function MoveScatter({ points }: { points: readonly MovePoint[] }) {
  const placed = points.map((point) => ({
    id: point.id,
    ticker: point.ticker,
    x: point.implied * 100,
    y: point.absActual * 100,
    size: Math.abs(point.netPnl),
    pnl: point.netPnl,
  }));
  const top = Math.ceil(Math.max(10, ...placed.map((dot) => Math.max(dot.x, dot.y))) / 5) * 5;
  const labelled = pickLabels(placed, top);
  const dots: Dot[] = placed.map((dot) => ({ ...dot, label: labelled.has(dot.id) ? dot.ticker : "" }));
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
        {/* Labels that would collide are dropped; every bar keeps its count, and its tooltip its range. */}
        <XAxis
          dataKey="label"
          tick={TICK}
          interval="preserveStartEnd"
          minTickGap={10}
          axisLine={false}
          tickLine={false}
        />
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
