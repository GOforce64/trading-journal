import { type EdgeKind, edgeLabels, parseEdges, type SplitRow } from "@tj/core";
import { useState } from "react";
import { dollars, profitFactorText, winRateText } from "./format.js";

export interface EdgeControl {
  kind: EdgeKind;
  edges: readonly number[];
  onChange: (edges: number[] | null) => void;
}

export interface SplitPanel {
  title: string;
  rows: readonly SplitRow[];
  edges?: EdgeControl;
}

/** Every split at once, each a small table with net bars (spec §7.2). */
export function SplitGrid({ panels, columns = 3 }: { panels: readonly SplitPanel[]; columns?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {panels.map((panel) => (
        <SplitTable key={panel.title} panel={panel} />
      ))}
    </div>
  );
}

function SplitTable({ panel }: { panel: SplitPanel }) {
  const widest = Math.max(1, ...panel.rows.map((row) => Math.abs(row.net)));
  return (
    <section aria-label={panel.title} className="min-w-0 rounded-sm border border-line bg-panel p-2">
      <header className="mb-1 flex items-center justify-between gap-2 text-[9px] text-muted uppercase tracking-wider">
        <span>{panel.title}</span>
        {panel.edges && <EdgeEditor title={panel.title} control={panel.edges} />}
      </header>
      {panel.rows.length === 0 ? (
        <p className="text-[10px] text-muted">No closed trades in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {panel.rows.map((row) => (
              <tr
                key={row.label}
                title={`Win rate ${winRateText(row.winRate)} · PF ${profitFactorText(row.profitFactor)}`}
                className="border-line border-t"
              >
                <td className="py-0.5">{row.label}</td>
                <td className="num text-right text-muted">{row.trades}</td>
                <td className="w-36">
                  <div className="flex items-center justify-end gap-1.5">
                    <span
                      className={`num ${row.net > 0 ? "text-up" : row.net < 0 ? "text-down" : "text-muted"}`}
                    >
                      {dollars(row.net)}
                    </span>
                    <span className="flex w-12">
                      <span
                        className={`h-[7px] rounded-[1px] ${row.net >= 0 ? "bg-up" : "bg-down"}`}
                        style={{ width: `${(Math.abs(row.net) / widest) * 100}%` }}
                      />
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const RULES: Record<EdgeKind, string> = {
  usd: "Use increasing amounts above 0, like 250, 500, 1000.",
  contracts: "Use increasing whole numbers from 2, like 2, 4, 6.",
};

/** An "edit" link that opens a field for a split's edges, with Save and Reset. */
export function EdgeEditor({ title, control }: { title: string; control: EdgeControl }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setDraft(null);
    setProblem(null);
  };
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(control.edges.join(", "))}
        className="text-accent normal-case tracking-normal"
      >
        edit
      </button>
    );
  }
  const preview = parseEdges(draft, control.kind);
  const save = () => {
    const edges = parseEdges(draft, control.kind);
    if (!edges) {
      setProblem(RULES[control.kind]);
      return;
    }
    control.onChange(edges);
    close();
  };
  return (
    <span className="flex flex-wrap items-center justify-end gap-1 normal-case tracking-normal">
      <input
        aria-label={`${title} edges`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="num w-28 rounded-sm border border-line bg-[#0e1118] px-1 text-[10px] text-fg outline-none focus:border-accent"
      />
      <button type="button" onClick={save} className="text-accent">
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          control.onChange(null);
          close();
        }}
        className="text-muted"
      >
        Reset
      </button>
      {/* The buckets as typed: "2,500" reads as two edges, 2 and 500, and this shows it. */}
      {!problem && preview && (
        <span data-testid="edge-preview" className="basis-full text-right text-muted">
          {edgeLabels(preview, control.kind).join(" · ")}
        </span>
      )}
      {problem && (
        <span role="alert" className="basis-full text-right text-down">
          {problem}
        </span>
      )}
    </span>
  );
}
