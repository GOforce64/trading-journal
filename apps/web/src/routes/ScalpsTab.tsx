import {
  type BreakdownContext,
  bucketStats,
  closedTrades,
  mistakeCost,
  scalpBreakdown,
  scalpSummary,
} from "@tj/core";
import { useMemo } from "react";
import { BreakdownPanel } from "../analytics/Breakdown.js";
import { useAllTrades } from "../analytics/data.js";
import { rememberEdges, resolveEdges } from "../analytics/edges.js";
import { profitFactorText, rText, segmentClass, winRateText } from "../analytics/format.js";
import { KpiStrip } from "../analytics/KpiStrip.js";
import { MistakeCost } from "../analytics/MistakeCost.js";
import { MetricBars } from "../analytics/ScalpCharts.js";
import { Section } from "../analytics/Section.js";
import type { EdgeControl } from "../analytics/SplitGrid.js";
import { coverageText, holdText, METRICS, type Metric, returnText } from "../analytics/scalpText.js";
import { Money } from "../components/ui.js";
import { type Tag, useSetups, useTags } from "../review/data.js";
import { useBackfillPrices } from "../review/prices.js";
import type { TabProps } from "./OverviewTab.js";

const tagNames = (tags: readonly Tag[] | undefined, kind: "mistake" | "emotion") =>
  new Map((tags ?? []).filter((tag) => tag.kind === kind).map((tag) => [tag.id, tag.name]));

const openTitle = (label: string) => (label === "before open" ? label : `${label} min after the open`);
const holdTitle = (label: string) => {
  if (label === "unknown") return "unknown hold";
  return `held ${label.endsWith("min") ? label : `${label} min`}`;
};

/** Which scalps work: by time of day, hold, setup and the rest (scalp-analytics spec §6). */
export function ScalpsTab({ trades, search, onSearch }: TabProps) {
  const scalps = useMemo(() => closedTrades(trades.filter((trade) => trade.strategy === "scalp")), [trades]);
  const { data: setups = [] } = useSetups();
  const { data: tags, isError: tagsFailed } = useTags();
  // Every scalp, not just the filtered ones: the backfill runs once a visit (spec §8).
  const fill = useBackfillPrices(useAllTrades().data);
  const summary = scalpSummary(scalps);
  const none = summary.trades === 0;
  const metric: Metric = search.metric ?? "net";
  const by = search.by ?? "setup";
  const costEdges = resolveEdges("cost", search.costEdges);
  const contractEdges = resolveEdges("contracts", search.contractEdges);
  const context: BreakdownContext = {
    setups: new Map(setups.map((setup) => [setup.id, setup.name])),
    emotions: tagNames(tags, "emotion"),
    costEdges,
    contractEdges,
  };

  let edges: EdgeControl | undefined;
  if (by === "cost") {
    edges = {
      kind: "usd",
      edges: costEdges,
      onChange: (next) => {
        rememberEdges("cost", next);
        onSearch({ costEdges: next ? next.join(",") : undefined });
      },
    };
  } else if (by === "contracts") {
    edges = {
      kind: "contracts",
      edges: contractEdges,
      onChange: (next) => {
        rememberEdges("contracts", next);
        onSearch({ contractEdges: next ? next.join(",") : undefined });
      },
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        kpis={[
          { id: "net", label: "Net P&L", value: none ? "—" : <Money value={summary.net} /> },
          { id: "win-rate", label: "Win rate", value: winRateText(summary.winRate) },
          {
            id: "avg-r",
            label: "Avg R",
            value: summary.avgR == null ? "—" : rText(summary.avgR),
            sub: none ? undefined : `over ${summary.rCount} of ${summary.trades}`,
          },
          {
            id: "avg-return",
            label: "Avg return",
            value: returnText(summary.avgReturn),
            sub: "on premium paid",
          },
          { id: "profit-factor", label: "Profit factor", value: profitFactorText(summary.profitFactor) },
          {
            id: "expectancy",
            label: "Expectancy",
            value: summary.expectancy == null ? "—" : <Money value={summary.expectancy} />,
          },
          {
            id: "avg-hold",
            label: "Avg hold",
            value: holdText(summary.avgHoldMinutes),
            sub:
              summary.medianHoldMinutes == null ? undefined : `median ${holdText(summary.medianHoldMinutes)}`,
          },
          { id: "scalps", label: "Scalps", value: summary.trades },
        ]}
      />
      {none ? (
        <p className="text-muted">No closed scalps in this range.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="r-coverage" className="text-[10px] text-muted">
              {coverageText(summary.coverage, fill)}
            </p>
            <fieldset aria-label="Bars" className="flex items-center gap-1 text-[11px]">
              <span className="mr-1 text-[9px] text-muted uppercase tracking-wider">Bars</span>
              {METRICS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  aria-pressed={each.id === metric}
                  onClick={() => onSearch({ metric: each.id === "net" ? undefined : each.id })}
                  className={segmentClass(each.id === metric)}
                >
                  {each.label}
                </button>
              ))}
            </fieldset>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Minutes after the open">
              <MetricBars rows={bucketStats(scalps, "open")} metric={metric} title={openTitle} />
            </Section>
            <Section title="Hold time">
              <MetricBars rows={bucketStats(scalps, "hold")} metric={metric} title={holdTitle} />
            </Section>
          </div>
          <BreakdownPanel
            by={by}
            onBy={(next) => onSearch({ by: next === "setup" ? undefined : next })}
            rows={scalpBreakdown(scalps, by, context)}
            metric={metric}
            edges={edges}
          />
          {tags ? (
            <MistakeCost rows={mistakeCost(scalps, tagNames(tags, "mistake"))} />
          ) : (
            <Section title="Mistake cost">
              <p className="text-muted">{tagsFailed ? "Couldn't load the tags." : "Loading…"}</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
