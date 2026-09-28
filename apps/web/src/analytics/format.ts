export const winRateText = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

export function profitFactorText(value: number | null): string {
  if (value == null) return "—";
  return value === Number.POSITIVE_INFINITY ? "∞" : value.toFixed(2);
}

/** A share such as % kept: 0.32 → "32%", -0.1 → "−10%". */
export const shareText = (value: number | null) =>
  value == null ? "—" : `${value < 0 ? "−" : ""}${Math.abs(Math.round(value * 100))}%`;

/** Whole dollars with the sign spelled out: "+$410", "−$2,324", "$0". */
export function dollars(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** A toggle in a row of toggles, like the Journal's book buttons. */
export const segmentClass = (active: boolean) =>
  `rounded-[2px] border px-2 py-0.5 ${active ? "border-accent bg-[#2962ff1a] text-fg" : "border-line text-muted"}`;
