import type { ReactNode } from "react";

export interface Kpi {
  id: string;
  label: string;
  value: ReactNode;
  sub?: string;
}

export function KpiStrip({ kpis }: { kpis: readonly Kpi[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))` }}>
      {kpis.map((kpi) => (
        <div
          key={kpi.id}
          data-testid={`kpi-${kpi.id}`}
          className="min-w-0 rounded-sm border border-line bg-panel px-2.5 py-1.5"
        >
          <div className="truncate text-[9px] text-muted uppercase tracking-wider">{kpi.label}</div>
          <div className="num mt-0.5 text-[14px]">{kpi.value}</div>
          {kpi.sub && <div className="mt-0.5 truncate text-[9px] text-muted">{kpi.sub}</div>}
        </div>
      ))}
    </div>
  );
}
