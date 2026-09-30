import type { CumulativePoint } from "@tj/core";

const WIDTH = 130;
const HEIGHT = 40;
const PAD = 4;
const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

/**
 * A running total, trade by trade, on a zero line (scalp-analytics spec §7.2): green when it ends at or above 0, red
 * below. Hovering a point names the trade. Nothing with fewer than 2 points.
 */
export function Sparkline({
  points,
  format,
  label,
}: {
  points: readonly CumulativePoint[];
  format: (value: number) => string;
  label: string;
}) {
  if (points.length < 2) return null;
  const values = [0, ...points.map((point) => point.total)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const x = (index: number) => PAD + (index * (WIDTH - 2 * PAD)) / (points.length - 1);
  const y = (value: number) => PAD + ((high - value) * (HEIGHT - 2 * PAD)) / span;
  const up = (points.at(-1)?.total ?? 0) >= 0;
  return (
    <svg
      role="img"
      aria-label={label}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="shrink-0"
    >
      <line x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} stroke="#2a2e39" />
      <polyline
        data-testid="sparkline"
        points={points.map((point, index) => `${x(index)},${y(point.total)}`).join(" ")}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        className={up ? "stroke-up" : "stroke-down"}
      />
      {points.map((point, index) => (
        <circle key={point.id} cx={x(index)} cy={y(point.total)} r={6} fill="transparent">
          <title>
            {`${ET_DAY.format(new Date(point.closedAt))} · ${point.underlying} · ${format(point.value)} · total ${format(point.total)}`}
          </title>
        </circle>
      ))}
    </svg>
  );
}
