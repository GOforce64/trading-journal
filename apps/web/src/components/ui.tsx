import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-line bg-panel p-2.5">
      {(title || right) && (
        <header className="mb-1.5 flex items-center justify-between text-[10px] text-muted uppercase tracking-wider">
          <span>{title}</span>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Dollars, coloured by sign, always monospaced. */
export function Money({ value, className = "" }: { value: number | null; className?: string }) {
  if (value == null) return <span className={`num text-muted ${className}`}>—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg";
  return <span className={`num ${tone} ${className}`}>{value > 0 ? `+${usd(value)}` : usd(value)}</span>;
}

/** Fractions rendered as percentages: 0.2550 shows as +25.50%. */
export function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="num text-muted">—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg";
  return <span className={`num ${tone}`}>{`${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`}</span>;
}

const CHIP_TONES: Record<string, string> = {
  iron_fly: "bg-[#7e57c22a] text-[#b39ddb]",
  scalp: "bg-[#ff980022] text-[#ffb74d]",
  live: "bg-[#26a69a22] text-up",
  paper: "bg-[#2962ff22] text-[#82a8ff]",
  missed: "bg-[#6b738522] text-[#9aa3b5]",
  excluded: "border border-muted border-dashed text-muted",
  default: "bg-[#1c2130] text-[#9aa3b5]",
};

export function Chip({ tone = "default", children }: { tone?: string; children: ReactNode }) {
  const styles = CHIP_TONES[tone] ?? CHIP_TONES.default;
  return (
    <span className={`rounded-[2px] px-1.5 py-0.5 font-semibold text-[9px] tracking-wide ${styles}`}>
      {children}
    </span>
  );
}

export function Tile({
  label,
  children,
  testId,
  empty = false,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
  empty?: boolean;
}) {
  return (
    <div className={`rounded-sm border bg-panel p-2 ${empty ? "border-line border-dashed" : "border-line"}`}>
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <div
        className={`num mt-1 font-semibold text-[15px] ${empty ? "text-[#4b5263]" : ""}`}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-0.5 py-1 ${active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}
